import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordTaskPass, recordSpeedPass } from "../lib/control-plane/live-audit-log.ts";
import { TASK_SCRIPTS, judgeTask, type ResidentTaskFile, type TaskStepRecord } from "../lib/health/resident-tasks.ts";
import { runTaskPlaces } from "../lib/health/resident-task-run.ts";
import { speedTargets, judgeSpeed, type SpeedRun } from "../lib/health/worst-case-speed.ts";
import { measuredCompletion } from "../scripts/rh01-completion.mts";
import { observeResidentPlaces, observeResidentPass, observeResidentScreen, observeAskRequest,
  prepareSpeedObservation, observeSpeedTarget, observeSpeedPass } from "../scripts/rh01-browser-evidence.mts";

const file = JSON.parse(readFileSync(join(process.cwd(), "data/health/resident-tasks.json"), "utf8")) as ResidentTaskFile;
function delivered(question: string, zip: string, mode: "full" | "validation" | "no-context" | "aborted" = "full") {
  const finish = observeAskRequest({ url: "https://fixture.invalid/api/ask/grounded", method: "POST",
    headers: {}, body: JSON.stringify({ question, approximateLocation: mode === "no-context" ? undefined : zip }) });
  if (mode === "aborted") { finish(); return; }
  finish({ status: mode === "validation" ? 400 : 200, headers: { "content-type": "application/json" }, body: JSON.stringify(mode === "validation"
    ? { error: "question is required" } : { mode: "NO_EVIDENCE", records: [], gaps: [{ code: "NOT_HELD" }], contacts: [],
      trace: { preloads: { registry: 4 }, sourcesLoaded: "ALL", totalMs: 8 } }) });
}
async function capture(work: () => Promise<void>): Promise<string> {
  const output: string[] = [], original = console.log;
  console.log = (...args) => { output.push(args.join(" ")); };
  try { await work(); return output.join("\n"); } finally { console.log = original; }
}
const completion = (script: string, stdout: string) => measuredCompletion({ script, stdout, stderr: "", code: 0, timedOut: false });

test("native resident passes prove exact interactions, retained screenshots and scoped Ask replies separately from product failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "rh01-native-task-evidence-"));
  const priorRoot = process.env.WTP_RH01_DIRECTORY, priorShared = process.env.WTP_RH01_SHARED_STATE_DIRECTORY;
  process.env.WTP_RH01_DIRECTORY = directory; process.env.WTP_RH01_SHARED_STATE_DIRECTORY = directory;
  const tasks = file.tasks.filter(task => ["ballot-in-plain-english", "ask-next-council-meeting"].includes(task.id));
  try {
    for (const problem of [null, "missing-step", "missing-shot", "missing-scope", "navigation", "validation", "no-context", "aborted", "not-durable"] as const) {
      const repos = createMemoryRepositories();
      let sequence = 0;
      const output = await capture(async () => {
        await observeResidentPlaces({ tasks, zips: ["85701", "85201"], queued: { has: () => false }, askZips: 1,
          runId: `native-${problem ?? "complete"}`, now: () => new Date(Date.UTC(2026, 9, 20, 0, 0, ++sequence)).toISOString(),
          run: async (task, zip, profile) => {
            const script = TASK_SCRIPTS[task.id], steps: TaskStepRecord[] = [];
            const add = async (says: string) => {
              const key = `resident-tasks/fixture/${task.id}-${zip}-${profile}-${steps.length}.png`, path = join(directory, "screenshots", key);
              await mkdir(dirname(path), { recursive: true }); await writeFile(path, new Uint8Array([1, 2, 3]));
              steps.push({ says, ms: 4500, shot: problem === "missing-shot" ? null : key, issues: {} });
            };
            await add("Opened the home page");
            let taps = 0;
            for (const step of script.steps) {
              if (step.kind === "ask") {
                delivered(task.question!, zip, ["validation", "no-context", "aborted"].includes(problem ?? "") ? problem as "validation" | "no-context" | "aborted" : "full");
                if (problem !== "missing-step") { await add(`Asked "${task.question}"`); taps += 2; }
              } else { await add(`Tapped ${step.finders[0].says}`); taps++; }
            }
            await observeResidentScreen({ evaluate: async () => problem !== "missing-scope" }, script.scope, script.checks);
            return judgeTask(task, { taskId: task.id, zip, profile, steps, taps,
              deadEnd: problem === "navigation" ? "the page failed" : null, missing: [script.checks[0].says] });
          },
          record: async pass => { if (problem !== "not-durable") await recordTaskPass(repos, pass); await observeResidentPass(repos, pass); },
        }, runTaskPlaces);
      });
      const checked = completion("scripts/resident-tasks.mts", output);
      assert.equal(checked.complete, problem === null, problem ?? checked.reason);
      if (problem === null) { assert.equal(checked.successful, false); assert.equal(checked.units, 5); }
    }
  } finally {
    if (priorRoot === undefined) delete process.env.WTP_RH01_DIRECTORY; else process.env.WTP_RH01_DIRECTORY = priorRoot;
    if (priorShared === undefined) delete process.env.WTP_RH01_SHARED_STATE_DIRECTORY; else process.env.WTP_RH01_SHARED_STATE_DIRECTORY = priorShared;
    await rm(directory, { recursive: true, force: true });
  }
});

test("a persisted native speed pass can finish slowly while missing visits and aborted or context-free Ask remain incomplete", async () => {
  const targets = speedTargets(file, ["85701"]);
  for (const problem of [null, "omitted-target", "navigation", "validation", "no-context", "aborted", "not-durable"] as const) {
    const repos = createMemoryRepositories(), runs: SpeedRun[] = [];
    const output = await capture(async () => {
      prepareSpeedObservation(targets, 2);
      for (const target of problem === "omitted-target" ? targets.slice(1) : targets) {
        for (let index = 0; index < (target.surface === "ask" ? 1 : 2); index++) {
          runs.push(await observeSpeedTarget(target, async () => {
            if (target.question) delivered(target.question, target.zip,
              ["validation", "no-context", "aborted"].includes(problem ?? "") ? problem as "validation" | "no-context" | "aborted" : "full");
            return { ...target, ms: problem === "navigation" ? null : 4500 };
          }));
        }
      }
      const pass = judgeSpeed(runs, "2026-10-20T10:00:00Z");
      if (problem !== "not-durable") await recordSpeedPass(repos, pass);
      await observeSpeedPass(repos, pass);
    });
    const checked = completion("scripts/worst-case-speed-pass.mts", output);
    assert.equal(checked.complete, problem === null, problem ?? checked.reason);
    if (problem === null) { assert.equal(checked.successful, false); assert.ok(checked.units! > 6); }
  }
  assert.equal(completion("scripts/resident-tasks.mts", "resident tasks: 15 passed, 0 failed, at 85701").complete, false);
  assert.equal(completion("scripts/worst-case-speed-pass.mts", "speed: 15 within three seconds, 0 too slow or unfinished, at 85701").complete, false);
});
