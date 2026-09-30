/**
 * `pnpm window:run` — the research/control-plane evidence window.
 *
 *   pnpm window:run --shadow                  run the window now, in shadow
 *   pnpm window:run --shadow --force          run even if today's window ran
 *   pnpm window:run --wakeup                  explicit owner wakeup: nudge a
 *                                             live runner with RUN_WINDOW_NOW,
 *                                             or run under the same lease when
 *                                             the runner is dead
 *   --provider=file      the file store instead of Postgres
 *   --trigger=<T>        RUNNER_CLOCK | CATCH_UP | WAKEUP | MANUAL; the
 *                        runner passes what its clock decided
 *
 * INVARIANTS
 *   this window is research-only: it evaluates evidence and writes control-
 *   plane/run records, but has no civic-data acquisition, promotion, Reader
 *   materialization, Git, build, deploy, or served-surface verification path
 *   every research-stage failure opens an incident and the window names it
 *   one window at a time, host-global, through the CAS lease
 *
 * Env var names only, never values.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  CONTROL_PLANE_URL_VAR,
  controlPlaneUrlFromEnv,
  createPgRepositories,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { livenessOf } from "../lib/control-plane/owner-surface.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { mapEvidenceIntoPipeline, mappingLines } from "../lib/control-plane/promotion/mapping.ts";
import {
  WINDOW_LEASE_TTL_MS,
  WINDOW_ZONE,
  WindowLockHeld,
  localDateOf,
  buildWindowDigest,
  evaluateItems,
  openIncident,
  windowHeadline,
  windowId as makeWindowId,
  withNightlyWindowLease,
} from "../lib/control-plane/promotion/window.ts";
import {
  WINDOW_FORMAT_VERSION,
  WINDOW_TRIGGERS,
  type WindowIncident,
  type WindowIntent,
  type WindowRunRecord,
  type WindowStageRecord,
  type WindowTrigger,
} from "../lib/control-plane/promotion/types.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { today } from "./doc-dates.mjs";
import { readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { readMethodStore } from "../lib/method/candidate.ts";
import { METHOD_STORE, readMethodCandidateStore } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { readConclusionStore } from "../lib/method/conclusions.ts";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";

const ROOT = process.cwd();
const HOST = hostname();
const NOW = new Date().toISOString();
const nowIso = (): string => new Date().toISOString();
const argv = process.argv.slice(2);

const shadow = argv.includes("--shadow");
const wakeup = argv.includes("--wakeup");
const force = argv.includes("--force");
const useFile = argv.includes("--provider=file");
if (!useFile) {
  assertRuntimeAuthority({ capabilities: ["NIGHTLY_RESEARCH"] });
}
const triggerArg = argv.find((a) => a.startsWith("--trigger="))?.slice("--trigger=".length) ?? null;

if (!shadow && !wakeup) {
  console.error("window:run · pass --shadow (run the window in shadow) or --wakeup (an explicit owner wakeup). Nothing ran.");
  process.exit(1);
}
if (triggerArg !== null && !(WINDOW_TRIGGERS as readonly string[]).includes(triggerArg)) {
  console.error(`window:run · --trigger must be one of ${WINDOW_TRIGGERS.join(", ")}`);
  process.exit(1);
}

const WINDOW_INTENT_KEY = "nightly-window";
const MIRROR = process.env.WTP_MIRROR ?? "G:/My Drive/we-the-people";
const FALLBACK = join(ROOT, ".mirror");
const RUNS_DIR = join(ROOT, ".runtime", "nightly-window-runs");
const HOLDER = `nightly-window@${HOST}#${process.pid}`;

/* ------------------------------------------------------------- provider --- */

let repos: ControlPlaneRepositories;
if (useFile) {
  const root = join(ROOT, ".runtime", "control-plane", "freshness-shadow");
  mkdirSync(root, { recursive: true });
  repos = await createFileRepositories(root);
} else {
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    console.error(`window:run · ${CONTROL_PLANE_URL_VAR} is not set and --provider=file was not asked for. Nothing ran.`);
    process.exit(1);
  }
  repos = await createPgRepositories(url, NOW);
}
console.log(`window:run · ${repos.describe()}\n  mode SHADOW · host ${HOST} · holder ${HOLDER}`);

/* --------------------------------------------------------------- wakeup --- */

if (wakeup) {
  const beat = await repos.runnerHeartbeat.read(RUNNER_ID);
  const liveness = livenessOf(beat?.value ?? null, nowIso());
  if (liveness.state === "ALIVE") {
    const requestedAt = nowIso();
    const intent: WindowIntent = {
      formatVersion: WINDOW_FORMAT_VERSION,
      kind: "INTENT",
      intentId: `RUN_WINDOW_NOW:${requestedAt}`,
      action: "RUN_WINDOW_NOW",
      requestedAt,
      actor: `explicit owner wakeup on ${HOST}`,
    };
    const out = await repos.windowIntents.append(WINDOW_INTENT_KEY, intent.intentId, intent, requestedAt);
    console.log(
      `  runner ${RUNNER_ID} is ${liveness.state} (${liveness.detail}); appended RUN_WINDOW_NOW ` +
        `${intent.intentId} (${out.appended ? "new" : "already held"}). The runner runs the window on its own clock; this process runs nothing.`,
    );
    process.exit(0);
  }
  console.log(`  runner ${RUNNER_ID} is ${liveness.state} (${liveness.detail}); the wakeup runs the window itself under the lease.`);
}

/* ---------------------------------------------------------------- due? --- */

const trigger: WindowTrigger = (triggerArg as WindowTrigger | null) ?? (wakeup ? "WAKEUP" : force ? "MANUAL" : "RUNNER_CLOCK");
const localDate = localDateOf(NOW);
const windowId = makeWindowId(localDate, NOW, HOST);
console.log(`  window ${windowId} for ${localDate}, trigger ${trigger}`);

/* ------------------------------------------------------------- helpers --- */

type StageOutcome = WindowStageRecord["outcome"];

const stages: WindowStageRecord[] = [];
const incidents: WindowIncident[] = [];

function recordStage(stage: WindowStageRecord["stage"], startedAt: string, outcome: StageOutcome, reason: string | null): void {
  stages.push({ stage, outcome, startedAt, finishedAt: nowIso(), reason });
  console.log(`  ${stage} ${outcome}${reason ? ` — ${reason}` : ""}`);
}

function incident(stage: WindowIncident["stage"], code: string, detail: string, missedScope: readonly string[]): void {
  const i = openIncident({ windowId, stage, code, detail, openedAt: nowIso(), missedScope });
  incidents.push(i);
  console.error(`  INCIDENT ${i.incidentId} at ${stage}: ${code} — ${detail}`);
}

/* ---------------------------------------------------------------- deliver --- */

function deliver(body: string, headline: string): { where: string; mirrored: boolean } {
  const target = existsSync(MIRROR) ? MIRROR : FALLBACK;
  const mirrored = target === MIRROR;
  if (!mirrored) mkdirSync(FALLBACK, { recursive: true });
  const path = join(target, "nightly-window-digest.md");
  writeFileSync(path, body, "utf8");
  appendFileSync(join(target, "nightly-window-log.md"), `${headline}\n`, "utf8");
  return { where: path, mirrored };
}

/* ------------------------------------------------------------- the window --- */

let exitCode = 0;
try {
  await withNightlyWindowLease(
    repos,
    HOLDER,
    nowIso,
    async (lock) => {
      const startedAt = nowIso();
      console.log(`  lease ${lock.leaseId} held until ${lock.expiresAt}`);

      /* Research pipeline evaluation. It records decisions and never promotes. */
      const s2 = nowIso();
      const gate = readActivationGate(ROOT);
      console.log(`  gate: ${gate.reason}`);
      let evaluation: ReturnType<typeof evaluateItems> = { verdicts: [], byRecordClass: [] };
      let counts = { items: 0, byStage: { SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 }, refused: 0 };
      try {
        const mapping = await mapEvidenceIntoPipeline(repos, ROOT, nowIso());
        for (const line of mappingLines(mapping)) console.log(line);
        counts = { items: mapping.counts.items, byStage: mapping.counts.byStage, refused: mapping.counts.refused };
        evaluation = evaluateItems(mapping.states, gate);
        console.log("  research-only window: evaluation recorded; no civic-data promotion door is wired here");
        const none = mapping.counts.items === 0 ? "the pipeline holds no item; a zero here is the mapped state, not an empty read" : undefined;
        for (const [subject, verdict] of [["items the window WOULD promote", "PROMOTE_WOULD"], ["items REFUSED with a stated reason", "REFUSE_WOULD"], ["items DEFERRED with a stated reason", "DEFER"]] as const) {
          console.log(
            `  ${floorLine(floored(subject, "the pipeline this window evaluated", mapping.counts.items, evaluation.verdicts.filter((v) => v.verdict === verdict).length, none))}`,
          );
        }
        recordStage("PIPELINE_EVALUATION", s2, "COMPLETED", none ?? null);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        recordStage("PIPELINE_EVALUATION", s2, "FAILED", detail);
        incident("PIPELINE_EVALUATION", "PIPELINE_EVALUATION_THREW", detail, ["the pipeline evaluation for this local date"]);
      }

      /* Digest and record. */
      const s4 = nowIso();
      const finishedAt = nowIso();
      let researchProgression: WindowRunRecord["researchProgression"];
      try {
        researchProgression = await readResearchProgression(repos, {
          windowId, through: finishedAt, gate,
          candidates: (await readMethodCandidateStore(repos)).candidates,
          knowledge: readMethodStore(join(ROOT,...METHOD_STORE)),
          conclusions: readConclusionStore(join(ROOT,"data","method","conclusions.json")),
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        incident("DIGEST", "RESEARCH_PROGRESSION_UNAVAILABLE", detail, ["research advancement and bottleneck facts for this completed window"]);
        exitCode = 2;
      }
      const record: WindowRunRecord = {
        formatVersion: WINDOW_FORMAT_VERSION,
        windowId,
        localDate: localDate,
        zone: WINDOW_ZONE,
        scheduledFor: NOW,
        trigger,
        mode: "SHADOW",
        startedAt,
        finishedAt,
        host: HOST,
        testedSha: headSha(ROOT),
        provider: repos.describe(),
        caughtUp: [],
        lock: { ...lock, releasedAt: null },
        activationGate: gate,
        stages: [...stages, { stage: "DIGEST", outcome: "COMPLETED", startedAt: s4, finishedAt: nowIso(), reason: null }],
        pipeline: { items: counts.items, byStage: counts.byStage, refused: counts.refused, verdicts: evaluation.verdicts, byRecordClass: evaluation.byRecordClass },
        ...(researchProgression ? {researchProgression} : {}),
        promoted: 0,
        controls: null,
        incidents,
        digestPath: null,
        mirrored: null,
        recordPath: null,
      };
      /* The durable control-plane record is the authority and is written first. */
      await repos.windowRuns.append(localDate, windowId, record, nowIso());
      for (const i of incidents) await repos.windowIncidents.append(windowId, i.incidentId, i, nowIso());
      const pending = (await repos.windowIntents.read(WINDOW_INTENT_KEY)).filter(
        (r): r is Extract<WindowIntent, { kind: "INTENT" }> => r.kind === "INTENT",
      );
      const honored = new Set((await repos.windowIntents.read(WINDOW_INTENT_KEY)).filter((r) => r.kind === "HONORED").map((r) => (r as Extract<WindowIntent, { kind: "HONORED" }>).honors));
      for (const p of pending) {
        if (honored.has(p.intentId)) continue;
        const honoredAt = nowIso();
        await repos.windowIntents.append(WINDOW_INTENT_KEY, `${p.intentId}:honored`, { formatVersion: WINDOW_FORMAT_VERSION, kind: "HONORED", intentId: `${p.intentId}:honored`, honors: p.intentId, action: p.action, honoredAt, honoredBy: HOLDER, detail: `honored by window ${windowId}` }, honoredAt);
      }
      const delivered = deliver(buildWindowDigest(record), windowHeadline(record));
      mkdirSync(RUNS_DIR, { recursive: true });
      const diagnosticPath = nextRunRecordPath(RUNS_DIR, today());
      writeFileSync(diagnosticPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
      console.log(`  digest: ${delivered.where}${delivered.mirrored ? "" : "  (MIRROR NOT REACHABLE — repo fallback)"}`);
      console.log(`  canonical outcome: ${windowId}`);
      console.log(`  local diagnostic: ${diagnosticPath}`);
      console.log(`  ${windowHeadline(record)}`);
      if (stages.some((s) => s.outcome === "FAILED")) exitCode = 2;
    },
    WINDOW_LEASE_TTL_MS,
  );
} catch (error) {
  if (error instanceof WindowLockHeld) {
    console.error(`window:run · REFUSED — ${error.message}`);
    process.exit(3);
  }
  const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
  console.error(`window:run · the window did not finish: ${detail}`);
  try {
    const i = openIncident({ windowId, stage: "DIGEST", code: "WINDOW_CRASHED", detail: detail.split("\n")[0], openedAt: nowIso(), missedScope: [`the whole window for ${localDate}`] });
    await repos.windowIncidents.append(windowId, i.incidentId, i, nowIso());
    mkdirSync(RUNS_DIR, { recursive: true });
    const diagnosticPath = nextRunRecordPath(RUNS_DIR, today());
    writeFileSync(diagnosticPath, `${JSON.stringify({ windowId, localDate: localDate, crashed: true, error: detail, stages, incidents: [...incidents, i] }, null, 2)}\n`, "utf8");
    console.error(`window:run · canonical incident ${i.incidentId}; local diagnostic ${diagnosticPath}`);
  } catch (writeError) {
    console.error(`window:run · and the crash record could not be written: ${writeError instanceof Error ? writeError.message : String(writeError)}`);
  }
  process.exit(1);
}
process.exit(exitCode);
