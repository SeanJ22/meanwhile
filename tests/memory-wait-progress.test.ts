import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RUNTIME_NO_PROGRESS_MS, STALL_PROBE_LEAD_MS, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";
import { MEMORY_WAIT_REPORT_EVERY_MS, reportingWorkerSlots, workerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { lastChildLines, recordFailedCycle } from "../lib/control-plane/scheduler/cycle-finalization.ts";

const slotsModule = JSON.stringify(new URL("../lib/control-plane/workers/worker-slots.ts", import.meta.url).href);

const QUIET_MS = 600;
const scale = QUIET_MS / RUNTIME_NO_PROGRESS_MS;
const DISPATCH_WAIT_MS = Math.round(15 * 60_000 * scale);

const waitingRound = (report: boolean) => `
  console.log('boot started');
  const boot = setInterval(() => console.log('boot ' + Date.now()), ${Math.round(QUIET_MS / 3)});
  const { reportingWorkerSlots, workerProcessSlots } = await import(${slotsModule});
  clearInterval(boot);
  // A host whose memory never frees.
  const host = workerProcessSlots(() => Number.MAX_SAFE_INTEGER, { availableBytes: () => 0 });
  const slots = ${report ? `reportingWorkerSlots(host, { everyMs: ${Math.round(MEMORY_WAIT_REPORT_EVERY_MS * scale)}, minuteMs: ${60_000 * scale} })` : "host"};
  console.log('phase dispatch: started');
  try { await slots.acquire('lib/control-plane/workers/lease-worker.ts', Date.now() + ${DISPATCH_WAIT_MS}); console.log('admitted'); }
  catch (error) { console.log(String(error.message)); }
  console.log('round finished');
`;

test("a silent memory wait longer than the quiet allowance loses the round (the live failure)", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", waitingRound(false)] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: QUIET_MS });
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /RESEARCH_CHILD_NO_PROGRESS/);
});

test("the same wait, reporting each minute, ends as a deferral and the round finishes", async () => {
  const [result] = await runRuntimeChildren([{ id: "research-cycle", executable: process.execPath,
    args: ["--experimental-strip-types", "--input-type=module", "-e", waitingRound(true)] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: QUIET_MS });
  assert.equal(result!.termination, "EXITED");
  assert.equal(result!.status, 0);
  assert.match(result!.stdout, /waiting for memory: wait 1 \(lease-worker\.ts\) 1 of 15 min; the work stays owed/);
  assert.match(result!.stdout, /WORKER_MEMORY_DEADLINE: memory wait deferred; work remains owed/);
  assert.match(result!.stdout, /round finished/);
  assert.doesNotMatch(`${result!.stdout}${result!.stderr}`, /RESEARCH_CHILD_NO_PROGRESS/);
});

test("the round's memory waits report, and report well inside the runner's limit", () => {
  assert.ok(MEMORY_WAIT_REPORT_EVERY_MS < RUNTIME_NO_PROGRESS_MS - STALL_PROBE_LEAD_MS);
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const reportedHostSlots = reportingWorkerSlots\(hostWorkerSlots\);/);
  assert.match(round, /const workerSlots = \{ acquire: \(entry\?: string, deadlineMs = dispatchDeadlineMs\) =>\s+reportedHostSlots\.acquire\(/);
  assert.doesNotMatch(round.replace(/const reportedHostSlots = reportingWorkerSlots\(hostWorkerSlots\);/, ""), /hostWorkerSlots\.acquire\(/,
    "no round path waits on host memory unreported");
});

test("a quick admission prints nothing, and each wait line is new output", async () => {
  const lines: string[] = [];
  const free = reportingWorkerSlots(workerProcessSlots(() => 1, { availableBytes: () => Number.MAX_SAFE_INTEGER, headroomBytes: 0 }),
    { write: line => lines.push(line), everyMs: 20 });
  const release = await free.acquire("lease-worker.ts", Date.now() + 1000);
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(lines.length, 0);
  release();
  const full = reportingWorkerSlots(workerProcessSlots(() => 1, { availableBytes: () => 0 }), { write: line => lines.push(line), everyMs: 20 });
  await assert.rejects(full.acquire("lease-worker.ts", Date.now() + 90), /WORKER_MEMORY_DEADLINE/);
  await assert.rejects(full.acquire("lease-worker.ts", Date.now() + 90), /WORKER_MEMORY_DEADLINE/);
  const count = lines.length;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(lines.length, count, "a settled wait stops reporting");
  assert.ok(lines.some(line => line.includes("wait 1 ")) && lines.some(line => line.includes("wait 2 ")));
});

test("a round the runner ended carries the child's last lines into its crash record", async () => {
  const output = [
    "phase dispatch: 812ms", "", "  round progress: dispatch 40 finished",
    "  research stall report: pending: autonomous-workers; last phase: dispatch",
    "RESEARCH_CHILD_NO_PROGRESS: no completed phase, worker admission or changed child output for 600000ms; ending owned child research-cycle process tree pid 42",
  ].join("\n");
  const last = lastChildLines(output);
  assert.deepEqual(last, ["phase dispatch: 812ms", "round progress: dispatch 40 finished",
    "research stall report: pending: autonomous-workers; last phase: dispatch"]);
  assert.equal(lastChildLines(Array.from({ length: 30 }, (_, i) => `line ${i}`).join("\n")).length, 12);

  const repos = createMemoryRepositories();
  const records: Record<string, unknown>[] = [];
  const result = await recordFailedCycle({ repos, error: new Error("RESEARCH_CHILD_NO_PROGRESS"), cycleId: "research-supervisor:test:2026-10-05",
    startedAt: "2026-10-05T19:00:00.000Z", finishedAt: "2026-10-05T19:15:00.000Z", testedSha: null, host: "test", pending: null,
    lastOutput: last, writeLocalRecord: record => { records.push(record); return "local-record"; }, log: () => {} });
  assert.equal(result.canonical, "APPENDED");
  assert.ok(result.lines.includes("        research stall report: pending: autonomous-workers; last phase: dispatch"));
  assert.deepEqual(records[0]!.lastOutput, last);
  const [digest] = await repos.ownerDigests.readAll();
  const failure = (digest!.runtimeOutcome as { failure?: { detail?: string } } | null)?.failure?.detail ?? "";
  assert.match(failure, /last output before it stopped:\nphase dispatch: 812ms/);
});

test("a standing child that keeps printing still ends at its lane deadline, and is told the deadline", async () => {
  const deadlineMs = Date.now() + 800;
  const started = Date.now();
  const [result] = await runRuntimeChildren([{ id: "routine-civic-data", executable: process.execPath,
    args: ["-e", "console.log('deadline ' + process.env.WTP_PASS_DEADLINE_AT); setInterval(() => console.log('progress ' + Date.now()), 50)"] }], {
    cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 20, deadlineMs });
  assert.equal(result!.termination, "TIMED_OUT");
  assert.match(result!.errorMessage!, /^PASS_TIME_BUDGET: routine-civic-data reached its lane deadline/);
  assert.match(result!.stdout, new RegExp(`deadline ${new Date(deadlineMs).toISOString()}`));
  assert.ok(Date.now() - started < 5_000, "the drain waited for the deadline, not for the child to go quiet");
});
