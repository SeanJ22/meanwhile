import { boundedAuditTransport } from "../lib/control-plane/workers/model-audit.ts";
import { runHeldWorkerFleetCycle } from "../lib/control-plane/workers/standing.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { projectFleetPipeline } from "../lib/control-plane/workers/pipeline.ts";
/**
 * `pnpm freshness:shadow` — ONE UNATTENDED CYCLE OF THE FRESHNESS SCHEDULER.
 * (Session B, W3.5, 2026-08-30. Rewritten Session B resume, W3.B/C/E/F,
 * 2026-08-31. Rewritten again Session C, PART D, 2026-08-31. Level 1 —
 * Research wired in, 2026-09-01, RULING 240 / RULING 241.)
 *
 * It observes, ACQUIRES for real, records, normalizes, STAGES — and **promotes
 * nothing to canonical reader truth**. `runCycle` has no parameter that could,
 * and the promotion tail writes only under `data/control-plane/staging/`.
 *
 * ## Two lanes, one cycle (Level 1)
 *
 * The input is the OBLIGATION-PROVIDER REGISTRY
 * (`lib/control-plane/scheduler/registry.ts`) — five providers, one scheduled
 * unit per (RECORD x REPRESENTATION). Every due unit is decided ONCE by the
 * canonical executor rule (`decideExecutor`):
 *
 * ```
 *   a machine-executable shape exists       ->  DETERMINISTIC   the route executor, serial
 *   no shape exists — unresolved novelty    ->  BOUNDED_MODEL_WORKER   a real Scout, pooled
 * ```
 *
 * The Scout lane is ADMITTED per row or DEFERRED BY CODE: `LANE_DISABLED`
 * (no credential in this process, `--dry`, `--no-model`), `PAUSED` (an owner
 * intent), `CEILING` (the rolling $/day ceiling, RULING 241), `CYCLE_MAX`
 * (the per-cycle Scout maximum), `BUDGET` (it could not finish inside the
 * dispatch budget). A deferred row keeps its next-due; nothing is dropped and
 * nothing is reported complete.
 *
 * **The bytes reach a real vault** through `DurableEvidenceStore`; the Scout's
 * tools vault before the model sees anything. The typed Scout result is
 * appended to `scout_results`; route candidates are PROPOSED and VALIDATED
 * into `data/method/candidates.json` and never admitted here.
 *
 * ## What this process writes about itself
 *
 * A `research_state` record (id `level-1`) at cycle start, on every Scout
 * start and end, and at cycle end — lane state, the credential CONFIRMED BY
 * NAME, the bounds, the rolling spend, the queue, the Scouts running. A runner
 * heartbeat (`pilot-runner`). Pending RUN_CYCLE_NOW intents are marked
 * HONORED by this cycle; so is a pending DISPATCH (ADM-8: the owner's target is
 * parsed, the matching registered units go FIRST in both lanes, and the HONORED
 * detail states what matched of what was registered), and the latest lane
 * PAUSE / RESUME the cycle applied. The admin Research view DERIVES its verdict
 * from these; none of them stores a verdict.
 *
 * ## Flags
 *
 * ```
 *   --provider=postgres   the durable control plane named by
 *                         WTP_CONTROL_PLANE_DATABASE_URL; default is the file store
 *   --dry                 a recorded executor instead of the network. Labelled
 *                         SIMULATED, and by construction discharges nothing
 *   --max=N               the stated deterministic dispatch ceiling for this cycle
 *   --scout-max=N         the stated Scout ceiling for this cycle (default RESEARCH_BOUNDS)
 *   --no-model            hold the Scout lane closed for this cycle (a diagnostic)
 *   --interval=N          the runner's minutes between cycles, so the heartbeat
 *                         can state when the next cycle is due
 *   --only=<prefix>       work only obligations whose id starts with <prefix>.
 *                         A DIAGNOSTIC filter: the count it skipped is printed,
 *                         so a filtered cycle can never read as a full one
 * ```
 *
 * Env var names only, never values. `WTP_WORKERS_ANTHROPIC_API_KEY` is read
 * by NAME to build the Scout transport; its value reaches nothing but the
 * provider request header.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { hostname, platform } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { digestLines, placeFirstRows, runCycle } from "../lib/control-plane/scheduler/shadow-loop.ts";
import {
  describeDispatchMatch,
  parseDispatchTarget,
  unitMatchesTarget,
} from "../lib/control-plane/scheduler/dispatch-target.ts";
import { REGISTERED_STATES } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { WindowLockHeld, acquireWindowLease, releaseWindowLease } from "../lib/control-plane/promotion/window.ts";
import { scheduleObligation, isScheduled, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { retryable } from "../lib/control-plane/scheduler/debt.ts";
import { buildRegistry, registryLines } from "../lib/control-plane/scheduler/registry.ts";
import { meetingsProvider } from "../lib/control-plane/scheduler/providers/meetings.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { trackerIntakeProvider } from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { candidateEnrichmentProvider } from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { methodMaturityFrom } from "../lib/control-plane/scheduler/maturity.ts";
import {
  closeOccurrence,
  loadDebts,
  openOccurrence,
  resumeOpenOccurrence,
  persistDebts,
  recordNextDue,
  syncObligations,
} from "../lib/control-plane/scheduler/durable.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { routeExecutor } from "../lib/control-plane/scheduler/route-executor.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import {
  promotionLines,
  stageOne,
  writeStagingManifest,
  type StagedEntry,
} from "../lib/control-plane/scheduler/promotion-tail.ts";
import {
  decideExecutor,
  type DeclaredExecutor,
  type DispatchResult,
  type ExecutorDecision,
  type RunWork,
  type WorkArtifact,
} from "../lib/control-plane/scheduler/dispatch.ts";
import { anthropicTransport, scoutExecutor } from "../lib/control-plane/scheduler/scout-executor.ts";
import { buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import type { ArtifactProvenance, InheritedEvidence, PriorRung } from "../lib/control-plane/scheduler/scout-contract.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import {
  RESEARCH_BOUNDS,
  RESEARCH_FORMAT_VERSION,
  RESEARCH_INTENT_LOG_KEY,
  RESEARCH_STATE_ID,
  SCOUT_MODEL,
  WORKER_CREDENTIAL_VAR,
  ceilingPermits,
  readIntents,
  researchSpendInWindow,
  type HostSupervision,
  type RelaunchProof,
  type ResearchIntent,
  type ResearchIntentRequest,
  type ResearchState,
  type RunningScout,
} from "../lib/control-plane/scheduler/research-policy.ts";
import { candidateStoreCounts, proposeScoutCandidates, METHOD_STORE, type ProposalReport } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { readCandidateStore, readMethodStore } from "../lib/method/candidate.ts";
import { readConclusionStore } from "../lib/method/conclusions.ts";
import {
  NO_PIPELINE_RECORDED,
  cacheDefectCounts,
  cacheHitRateByRole,
  costPerUsefulOutcome,
  graduationFunnel,
  modelShareTrend,
  orderByReaderImpact,
  scoutCapacity,
  type DispatchOrdering,
  type OrderingInputs,
  type ResearchMetrics,
} from "../lib/control-plane/research-metrics.ts";
import { researchDigestLines } from "../lib/control-plane/research-digest.ts";
import { PILOT_ZIPS } from "../lib/health/owner-corpus-compile.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
import {
  FLEET_SAFETY_BOUNDS,
  FleetSafetyController,
  scheduledBlackoutAt,
  type ProviderCircuit,
} from "../lib/control-plane/fleet-safety.ts";
import { installNeonCircuitBreaker } from "../lib/control-plane/neon-circuit.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";

const ROOT = process.cwd();
const CONTROL_PLANE_ROOT = join(ROOT, "data", "control-plane", "freshness-shadow");
const RUNS_DIR = join(ROOT, "data", "health", "freshness-shadow-runs");
const NOW = new Date().toISOString();
const HOST = hostname();
const nowIso = (): string => new Date().toISOString();

/*
 * **A CRASHED CYCLE WRITES A LEGIBLE RECORD; IT DOES NOT VANISH.**
 * (Autonomy-recovery session, 2026-09-01.)
 *
 * Every await in this script is unguarded by construction — it is a script, not
 * a function. A last-resort handler writes a run record marking the cycle
 * FAILED with the error, prints the `run record:` line the runner greps for,
 * and exits non-zero. A rejected top-level await surfaces here as
 * `uncaughtException` on this runtime; both events are handled and the handler
 * fires at most once.
 */
let crashRecorded = false;
function recordCrash(error: unknown): void {
  if (crashRecorded) return;
  crashRecorded = true;
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const headline = message.split("\n")[0];
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const path = nextRunRecordPath(RUNS_DIR, today());
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          startedAt: NOW,
          finishedAt: new Date().toISOString(),
          testedSha: headSha(ROOT),
          crashed: true,
          error: message,
          digest: [
            "PILOT HEALTH",
            "  the cycle CRASHED before completing — a failed cycle, never an idle one",
            `      ${headline}`,
            "  ROLLUP    NOT GREEN — the cycle did not finish",
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.error(`\n  freshness:shadow CRASHED — ${headline}`);
    console.log(`  run record: ${path}`);
  } catch (writeError) {
    console.error(
      `\n  freshness:shadow CRASHED and could not write a run record (${
        writeError instanceof Error ? writeError.message : String(writeError)
      }): ${headline}`,
    );
  }
  process.exit(1);
}
process.on("uncaughtException", recordCrash);
process.on("unhandledRejection", recordCrash);

const argv = process.argv.slice(2);
const wantsPostgres = argv.includes("--provider=postgres");
const dry = argv.includes("--dry");
const noModel = argv.includes("--no-model");
const canary = argv.includes("--canary");
const boundedNumber = (raw: string | undefined, fallback: number, maximum: number): number => {
  const parsed = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
};
const ceilingArg = argv.find((a) => a.startsWith("--max="));
const requestedMaxDispatches = boundedNumber(
  ceilingArg?.slice("--max=".length),
  FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle,
  FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle,
);
const MAX_DISPATCHES = canary
  ? 1
  : Math.min(requestedMaxDispatches, FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle);
const scoutMaxArg = argv.find((a) => a.startsWith("--scout-max="));
const SCOUT_MAX = boundedNumber(
  scoutMaxArg?.slice("--scout-max=".length),
  canary ? 1 : RESEARCH_BOUNDS.maxScoutDispatchesPerCycle,
  canary ? 1 : RESEARCH_BOUNDS.maxScoutDispatchesPerCycle,
);
const intervalArg = argv.find((a) => a.startsWith("--interval="));
const INTERVAL_MIN = intervalArg ? Number(intervalArg.slice("--interval=".length)) : null;
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;
/* Exact obligation ids, comma-separated. A DIAGNOSTIC filter like --only, for a proof run. */
const idsArg = argv.find((a) => a.startsWith("--ids="));
const IDS = idsArg ? new Set(idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;
if (canary && (IDS === null || IDS.size !== 1)) {
  console.error("freshness:shadow · --canary requires exactly one registered obligation via --ids=<id>.");
  process.exit(1);
}
/*
 * The hard wall budget, in minutes from PROCESS START. The runner kills a child
 * at fifteen minutes; dispatch admission stops two minutes earlier,
 * so it finishes cleanly — record written, occurrences closable — instead of
 * dying mid-write. Measured from process start because that is what the
 * supervisor's ceiling is measured from.
 */
const budgetArg = argv.find((a) => a.startsWith("--budget-min="));
const BUDGET_MIN = boundedNumber(
  budgetArg?.slice("--budget-min=".length),
  FLEET_SAFETY_BOUNDS.maxWallMsPerCycle / 60_000,
  FLEET_SAFETY_BOUNDS.maxWallMsPerCycle / 60_000,
);
const CYCLE_STARTED_MS = Date.now();
/** Leave two minutes inside the 15-minute hard process ceiling to close records and publish state. */
const FINALIZATION_RESERVE_MS = 2 * 60_000;
const DISPATCH_DEADLINE_MS = CYCLE_STARTED_MS + Math.max(0, BUDGET_MIN * 60_000 - FINALIZATION_RESERVE_MS);
const scheduledBlackout = scheduledBlackoutAt(NOW);

/* ------------------------------------------------------------- provider --- */

let repos: ControlPlaneRepositories;
if (wantsPostgres) {
  installNeonCircuitBreaker(ROOT, nowIso);
  const url = controlPlaneUrlFromEnv();
  if (url === null) {
    console.error(
      `freshness:shadow · --provider=postgres was asked for and ${CONTROL_PLANE_URL_VAR} is not ` +
        "set. Refusing to silently fall back to the file store: a run that changed provider " +
        "without saying so would attribute this cycle's state to the wrong place.",
    );
    process.exit(1);
  }
  repos = await createPgRepositories(url, NOW);
} else {
  mkdirSync(CONTROL_PLANE_ROOT, { recursive: true });
  repos = await createFileRepositories(CONTROL_PLANE_ROOT);
}

/*
 * THE CYCLE AND THE NIGHTLY WINDOW NEVER WRITE CONCURRENTLY (RULING 242). One
 * CAS lease on the fixed aggregate id `nightly-window` serializes them: a cycle
 * that finds the window holding it is REFUSED by name (exit 3) rather than
 * interleaved, and the runner's digest carries the refusal. The lease is
 * released at the run record; a crashed cycle holds nothing past the TTL.
 */
const CYCLE_LEASE_HOLDER = `cycle@${HOST}#${process.pid}`;
const CYCLE_LEASE_TTL_MS = 25 * 60_000;
try {
  await acquireWindowLease(repos, CYCLE_LEASE_HOLDER, nowIso(), CYCLE_LEASE_TTL_MS);
} catch (error) {
  if (error instanceof WindowLockHeld) {
    console.error(`freshness:shadow · REFUSED under the nightly window: ${error.message}`);
    process.exit(3);
  }
  throw error;
}

/* ----------------------------------------------------------- the registry --- */

/*
 * FIVE PROVIDERS. (Session C3, lane C, 2026-09-01. RULING 229.) `local-jurisdictions`
 * gives every named filing officer and election custodian a clock, and
 * `candidate-enrichment` makes campaign sites, positions, bios, photos and
 * contact standing obligations against each state's CANONICAL CANDIDATE
 * ACQUISITION DENOMINATOR — labelled by `lib/candidates/population-label.ts`,
 * never assumed statewide (R-C9).
 */
const registry = buildRegistry(
  [
    meetingsProvider(),
    campaignFinanceProvider(),
    trackerIntakeProvider(),
    localJurisdictionsProvider(),
    candidateEnrichmentProvider(),
  ],
  { root: ROOT, nowIso: NOW },
);

const allUnits = registry.units;
const units = allUnits.filter(
  (u) => (ONLY === null || u.obligation.id.startsWith(ONLY)) && (IDS === null || IDS.has(u.obligation.id)),
);
const corpus = units.map((u) => u.obligation);

console.log(
  `freshness:shadow · ${corpus.length} obligation(s) from the obligation-provider registry\n` +
    `  provider: ${repos.describe()}\n` +
    `  executor: ${dry ? "SIMULATED (--dry, no retrieval)" : "route-aware (real retrieval) + Scout lane (Level 1)"}`,
);
for (const line of registryLines(registry)) console.log(line);
if (ONLY !== null || IDS !== null) {
  console.log(
    `  ${ONLY !== null ? `--only=${ONLY}` : ""}${IDS !== null ? ` --ids=(${IDS.size})` : ""} FILTERED this cycle to ${units.length} of ${allUnits.length} registered ` +
      `unit(s); ${allUnits.length - units.length} were not looked at. A filtered cycle is a ` +
      "diagnostic and is never a reading of the whole corpus.",
  );
}

/* ---------------------------------------------- non-meeting share, stated --- */

const nonMeeting = units.filter((u) => u.providerId !== "meetings");
console.log(
  `  ${floorLine(
    floored(
      "scheduled units that are NOT meetings",
      "the obligation-provider registry",
      units.length,
      nonMeeting.length,
      units.length === 0 ? "the registry produced no units at all this cycle" : undefined,
    ),
  )}`,
);

const sync = await syncObligations(repos, corpus, NOW, { exactReads: canary });
console.log(
  `  ${floorLine(
    floored(
      "obligations already durable from an earlier cycle",
      "the freshness control plane",
      corpus.length,
      sync.alreadyDurable.length,
      corpus.length === 0 ? "the registry yielded no obligations to register" : undefined,
    ),
  )} · ${sync.registered.length} newly registered this cycle`,
);
if (sync.refreshed.length > 0) {
  console.log(
    `  provider signals REFRESHED on ${sync.refreshed.length} durable row(s) — a corrected ` +
      "derivation reaching rows that were registered under the old one:",
  );
  for (const r of sync.refreshed.slice(0, 5)) {
    console.log(`      ${r.id}  ->  ${r.changed.join(", ")}`);
  }
  if (sync.refreshed.length > 5) console.log(`      … and ${sync.refreshed.length - 5} more`);
}

/* ---------------------------------------------- the executor decision --- */

/*
 * ONE decision per unit, from the descriptor and the method store together
 * (`decideExecutor`). Made here, before any occurrence is opened, so the
 * deterministic ceiling and the Scout ceiling each see their own queue.
 */
const maturity = methodMaturityFrom(ROOT);
const decisions = new Map<string, ExecutorDecision>();
const decisionFor = (obligationId: string, routeId: string | null): ExecutorDecision => {
  const held = decisions.get(obligationId);
  if (held !== undefined) return held;
  const d = decideExecutor({ routeId, descriptor: registry.routeFor(obligationId), maturity });
  decisions.set(obligationId, d);
  return d;
};
for (const u of units) decisionFor(u.obligation.id, u.obligation.routeId);
const modelClassUnits = units.filter((u) => decisions.get(u.obligation.id)?.kind === "BOUNDED_MODEL_WORKER");
const decisionDisagreements = units
  .map((u) => ({ obligationId: u.obligation.id, disagreement: decisions.get(u.obligation.id)?.disagreement ?? null }))
  .filter((d) => d.disagreement !== null);

/* ------------------------------------------------------- the occurrences --- */

const nowMs = Date.parse(NOW);
/** Named runtime conditions, accumulated from here on; the research state carries them. */
const runtimeConditions: string[] = [];
const occurrenceByObligation = new Map<string, { id: string; routeTaskId: string }>();
const nextDueByObligation = new Map<string, string>();
let openedDeterministic = 0;
let openedModel = 0;
/** Due obligations this cycle deliberately did not START. Never silent. */
let deferredForCeiling = 0;
/** Occurrences a previous cycle opened and did not reach, picked back up. */
let resumedCount = 0;
/** Obligations whose open/resume threw and were isolated. Never silent. */
const preOpenSkipped: { obligationId: string; why: string }[] = [];
const dueThisCycle: { obligation: (typeof sync.all)[number]; nextDueAt: string }[] = [];

const debtsIn = canary
  ? (await Promise.all(corpus.map((obligation) => repos.debts.read(obligation.id))))
      .filter((row) => row !== null)
      .map((row) => row.value)
  : await loadDebts(repos);
const debtIds = new Set(debtsIn.filter((d) => d.consecutiveFailures > 0).map((d) => d.obligationId));
const retryNow = new Set(retryable(debtsIn, nowMs).map((d) => d.obligationId));
const backedOff = new Set([...debtIds].filter((id) => !retryNow.has(id)));
console.log(
  `  freshness debt inherited from earlier processes: ${debtIds.size} open row(s)` +
    (debtIds.size === 0 ? "" : ` — ${[...debtIds].slice(0, 3).join(", ")}${debtIds.size > 3 ? " …" : ""}`),
);

for (const o of sync.all) {
  const row = scheduleObligation(o, nowMs);
  if (!isScheduled(row)) continue;
  /* Do not pay a round trip to write a value that is already there. */
  if (o.nextDueAt !== row.nextDueAt) {
    await recordNextDue(repos, { obligationId: o.id, nextDueAt: row.nextDueAt, now: NOW });
  }
  nextDueByObligation.set(o.id, row.nextDueAt);
  if (backedOff.has(o.id)) continue;
  const isDue = Date.parse(row.nextDueAt) <= nowMs || retryNow.has(o.id);
  if (!isDue) continue;
  dueThisCycle.push({ obligation: o, nextDueAt: row.nextDueAt });
}

/* ------------------------------------------------- the owner's intents --- */

/*
 * READ ONCE, BEFORE ANY ORDER IS DECIDED. The owner's DISPATCH (ADM-8)
 * reorders both lanes, so the intent log is read before the deterministic
 * sort and the reader-impact bands below. A log that cannot be read is a
 * named runtime condition and the cycle proceeds as if the owner said
 * nothing — an intent nobody can read is not an intent nobody sent, so the
 * failure is on the record rather than in a guess.
 */
let intentLog: ResearchIntent[] = [];
try {
  intentLog = [...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))];
} catch (error) {
  runtimeConditions.push(
    `research intents could not be read (${error instanceof Error ? error.message : String(error)}); the lane treats the owner as not paused`,
  );
}
const intents = readIntents(intentLog);
const intentByTime = (a: ResearchIntentRequest, b: ResearchIntentRequest): number =>
  a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0;
const honoredBefore = new Set(intentLog.filter((r) => r.kind === "HONORED").map((r) => r.honors));

/**
 * Append this cycle's HONORED record beside an intent. The runner never edits
 * an intent; it acknowledges one with its own record. Returns false, with the
 * failure named on the research state, when the append did not land.
 */
async function honorIntent(intent: ResearchIntentRequest, detail: string): Promise<boolean> {
  const id = `${intent.intentId}:honored`;
  try {
    await repos.researchIntents.append(
      RESEARCH_INTENT_LOG_KEY,
      id,
      {
        formatVersion: RESEARCH_FORMAT_VERSION,
        kind: "HONORED",
        intentId: id,
        honors: intent.intentId,
        action: intent.action,
        honoredAt: NOW,
        honoredBy: `freshness-shadow@${HOST}#${process.pid}`,
        detail,
      },
      NOW,
    );
    return true;
  } catch (error) {
    runtimeConditions.push(
      `intent ${intent.intentId} (${intent.action}) could not be marked honored: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
}

/* A pending RUN_CYCLE_NOW is honored by the cycle that runs. This is it. */
const honoredIntents: string[] = [];
for (const pending of intents.pendingRunNow) {
  if (await honorIntent(pending, "a cycle ran; whether it started early or on the interval is the runner's record")) {
    honoredIntents.push(pending.intentId);
  }
}

/*
 * **THE OWNER'S DISPATCH — "deploy the fleet".** (ADM-8, 9.4.26 admin
 * feedback, 2026-09-04.)
 *
 * The owner's words ("deep dive on Illinois", "Pima County campaign finance")
 * are parsed by the PURE `dispatch-target.ts` into state codes and terms and
 * matched against the whole registered universe — `allUnits`, before any
 * `--only` filter — and every matching unit goes FIRST in both lanes this
 * cycle: ahead of the oldest-first deterministic order, ahead of the Scout
 * lane's reader-impact bands, through the one `placeFirstRows` derivation the
 * dispatcher itself applies. Nothing else changes: not the ceilings, not the
 * budget, not per-host spacing, not a debt backoff, and not the universe — a
 * dispatch reorders; it never creates an obligation. A target that matches
 * nothing is honored with a sentence naming the missing registry, never with
 * a manufactured unit.
 */
interface OwnerDispatchRecord {
  readonly intentId: string;
  readonly target: string;
  readonly states: readonly string[];
  readonly matched: number;
  readonly registered: number;
}
const ownerDispatches: OwnerDispatchRecord[] = [];
const honoredDispatch: string[] = [];
const dispatchPriority = new Set<string>();
for (const pending of intents.pendingDispatch) {
  const target = parseDispatchTarget(pending.note ?? "");
  const matched = allUnits.filter((u) =>
    unitMatchesTarget(target, { id: u.obligation.id, subjectId: u.obligation.subjectId }),
  );
  const matchedIds = new Set(matched.map((u) => u.obligation.id));
  for (const id of matchedIds) dispatchPriority.add(id);
  const dueAmongMatched = dueThisCycle.filter((d) => matchedIds.has(d.obligation.id)).length;
  const detail = describeDispatchMatch(target, matched.length, allUnits.length, REGISTERED_STATES);
  ownerDispatches.push({
    intentId: pending.intentId,
    target: target.text,
    states: [...target.states],
    matched: matched.length,
    registered: allUnits.length,
  });
  if (!scheduledBlackout && await honorIntent(pending, detail)) honoredDispatch.push(pending.intentId);
  if (scheduledBlackout) {
    console.log("  owner dispatch: SCHEDULED BLACKOUT; intent remains pending for the next eligible cycle.");
  }
  console.log(
    `  owner dispatch: ${detail}` +
      (matched.length > 0 ? ` ${dueAmongMatched} of the ${matched.length} are due this cycle; the rest keep their next-due.` : ""),
  );
}

/* OLDEST FIRST for the deterministic lane, which is the dispatcher's own order — behind the owner's dispatch. */
dueThisCycle.sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));
const dueOrdered = placeFirstRows(dueThisCycle, dispatchPriority);
const dueModel = dueOrdered.filter((d) => decisionFor(d.obligation.id, d.obligation.routeId).kind === "BOUNDED_MODEL_WORKER");
const dueDeterministicRows = dueOrdered.filter((d) => !dueModel.includes(d));
const dueDeterministic = dueDeterministicRows.length;

/*
 * **READER IMPACT FIRST for the Scout lane.** (Work Item 5, 2026-09-02.
 * RULING 229.) Oldest-first answered what had waited longest; the Scout
 * ceiling is three a cycle, so WHICH three matters. Band 1 feeds a pilot
 * surface or an open red reader question, band 2 completes a source universe,
 * band 3 is the tail; oldest due first within a band. The inputs are read
 * here and NAMED on the record.
 */
function openRedReaderQuestions(): { readonly zips: readonly string[]; readonly count: number; readonly run: string | null } {
  const dir = join(ROOT, "data", "health", "reader-suite-runs");
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
    const latest = files.at(-1);
    if (latest === undefined) return { zips: [], count: 0, run: null };
    const run = JSON.parse(readFileSync(join(dir, latest), "utf8")) as {
      runId?: string;
      results?: { questionText?: string; verdict?: { kind?: string } }[];
    };
    const red = (run.results ?? []).filter((r) => r.verdict?.kind === "RED");
    const corpus = JSON.parse(readFileSync(join(ROOT, "data", "health", "reader-questions.json"), "utf8")) as {
      templateText?: string;
      applicability?: { zips?: string[] };
    }[];
    const zips = new Set<string>();
    for (const r of red) {
      const q = corpus.find((c) => c.templateText === r.questionText);
      for (const z of q?.applicability?.zips ?? []) zips.add(z);
    }
    return { zips: [...zips].sort(), count: red.length, run: run.runId ?? latest };
  } catch {
    return { zips: [], count: 0, run: null };
  }
}
const redQuestions = openRedReaderQuestions();
const orderingInputs: OrderingInputs = {
  openRedQuestionZips: redQuestions.zips,
  openRedQuestions: redQuestions.count,
  readerSuiteRun: redQuestions.run,
  pilotZips: PILOT_ZIPS,
};
const modelOrder = orderByReaderImpact(
  dueModel.map((d) => ({
    id: d.obligation.id,
    subjectId: d.obligation.subjectId,
    readerImpactAt: d.obligation.readerImpactAt,
    providerId: registry.providerOf(d.obligation.id),
    nextDueAt: d.nextDueAt,
    entry: d,
  })),
  orderingInputs,
);
const dispatchOrdering: DispatchOrdering | null = dueModel.length === 0 ? null : modelOrder.ordering;
/* The owner's dispatch goes ahead of the bands (ADM-8); within each group the band order stands. */
const scoutOrder = [
  ...modelOrder.ordered.filter((b) => dispatchPriority.has(b.row.id)),
  ...modelOrder.ordered.filter((b) => !dispatchPriority.has(b.row.id)),
];
const openingOrder = [...dueDeterministicRows, ...scoutOrder.map((b) => b.row.entry)];
if (dispatchOrdering !== null) {
  console.log(
    `  Scout lane order: band 1 ${dispatchOrdering.bands[1]} · band 2 ${dispatchOrdering.bands[2]} · band 3 ${dispatchOrdering.bands[3]} of ${dueModel.length} due model-class ` +
      `(open red reader questions ${redQuestions.count}${redQuestions.zips.length > 0 ? ` at ${redQuestions.zips.join(", ")}` : ""})` +
      (dispatchPriority.size > 0 ? ` · owner dispatch first: ${scoutOrder.filter((b) => dispatchPriority.has(b.row.id)).length} of them` : ""),
  );
  for (const b of scoutOrder.slice(0, SCOUT_MAX)) {
    console.log(`      ${dispatchPriority.has(b.row.id) ? "DISPATCH" : `band ${b.band}`}  ${b.row.id}  — ${b.why}`);
  }
}

for (const { obligation: o, nextDueAt } of openingOrder) {
  const row = { nextDueAt };
  /*
   * **DO NOT OPEN AN OCCURRENCE THIS CYCLE CANNOT DISPATCH.** Each lane opens
   * at most its own ceiling, in the dispatcher's own order — what is opened is
   * what is oldest in that lane.
   */
  const lane = decisionFor(o.id, o.routeId).kind;
  const opened = lane === "BOUNDED_MODEL_WORKER" ? openedModel : openedDeterministic;
  const laneCeiling = lane === "BOUNDED_MODEL_WORKER" ? SCOUT_MAX : MAX_DISPATCHES;
  const aggregateOpeningCeiling = canary ? 1 : FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle;
  if (scheduledBlackout || opened >= laneCeiling || openedDeterministic + openedModel >= aggregateOpeningCeiling) {
    deferredForCeiling += 1;
    continue;
  }
  try {
    const resumed = await resumeOpenOccurrence(repos, o);
    if (resumed !== null) {
      occurrenceByObligation.set(o.id, resumed);
      resumedCount += 1;
    } else {
      const occ = await openOccurrence(repos, { obligation: o, dueAt: row.nextDueAt, now: NOW });
      if (occ === null) continue;
      occurrenceByObligation.set(o.id, { id: occ.occurrence.id, routeTaskId: occ.routeTask.id });
    }
    if (lane === "BOUNDED_MODEL_WORKER") openedModel += 1;
    else openedDeterministic += 1;
  } catch (error) {
    preOpenSkipped.push({
      obligationId: o.id,
      why: error instanceof Error ? error.message : String(error),
    });
  }
}
console.log(
  `  occurrences opened this cycle: ${openedDeterministic + openedModel} (deterministic ${openedDeterministic}, ` +
    `Scout ${openedModel}; each with its OWN WorkItem and RouteTask)` +
    (resumedCount > 0
      ? ` — ${resumedCount} of them RESUMED from an earlier cycle that opened them and did not reach them`
      : ""),
);
if (deferredForCeiling > 0) {
  console.log(
    `  ${deferredForCeiling} due obligation(s) got NO occurrence this cycle: the stated ceilings are ` +
      `${MAX_DISPATCHES} deterministic and ${SCOUT_MAX} Scout, and opening a WorkItem the dispatcher will not reach ` +
      "leaves an occurrence nothing works. They keep their next-due and are opened by a later cycle — " +
      "the obligation is not discharged, only unstarted.",
  );
}
if (preOpenSkipped.length > 0) {
  console.log(
    `  ${preOpenSkipped.length} obligation(s) threw while opening/resuming and were ISOLATED so the ` +
      "rest of the phase could proceed; each keeps its next-due and is retried by a later cycle:",
  );
  for (const s of preOpenSkipped.slice(0, 5)) console.log(`      ${s.obligationId} — ${s.why}`);
  if (preOpenSkipped.length > 5) console.log(`      … and ${preOpenSkipped.length - 5} more`);
}

/* -------------------------------------------------- LEVEL 1 — RESEARCH --- */

/* The credential, BY NAME. Its value goes into the transport and nowhere else. */
const workerKey = (process.env[WORKER_CREDENTIAL_VAR] ?? "").trim();
const credentialConfigured = workerKey.length > 0;

/* The intent log was read, and RUN_CYCLE_NOW / DISPATCH honored, above the
   lane ordering — a DISPATCH has to reorder before anything is opened. */

const laneDisabledCode = scheduledBlackout
  ? "SCHEDULED_BLACKOUT"
  : dry
  ? "LANE_DISABLED"
  : noModel
    ? "LANE_DISABLED"
    : !credentialConfigured
      ? "LANE_DISABLED"
      : intents.paused
        ? "PAUSED"
        : null;
const laneDisabledReason = scheduledBlackout
  ? "SCHEDULED BLACKOUT: Saturday 18:00 through Sunday 06:00 America/Phoenix permits no model or network research"
  : dry
  ? "--dry: no retrieval of any kind runs, so no Scout runs"
  : noModel
    ? "--no-model: the Scout lane is held closed for this diagnostic cycle"
    : !credentialConfigured
      ? `${WORKER_CREDENTIAL_VAR} is not set in this process, so no model can be invoked`
      : intents.paused
        ? `paused by owner intent ${intents.pauseIntentId ?? "(id unrecorded)"}`
        : null;
const modelLaneEnabled = laneDisabledReason === null;

/*
 * THE LANE PAUSE / RESUME GETS ITS HONORED RECORD. (9.4.26 admin feedback.)
 * Before this, a PAUSE or RESUME of the research lane never received one and
 * rendered PENDING forever on /admin/research, beside RUN_CYCLE_NOW rows that
 * did. The cycle that applies the latest of them acknowledges it, once, and
 * the detail says what the lane actually did — a RESUME over a lane that is
 * closed for another reason (no credential, --dry) is acknowledged as applied
 * and still closed, never as "reopened".
 */
const honoredLaneIntents: string[] = [];
{
  const laneIntents = intentLog
    .filter((r): r is ResearchIntentRequest => r.kind === "INTENT" && (r.action === "PAUSE" || r.action === "RESUME"))
    .sort(intentByTime);
  const latest = laneIntents.at(-1);
  if (latest !== undefined && !honoredBefore.has(latest.intentId)) {
    const detail =
      latest.action === "PAUSE"
        ? "model lane closed for this cycle"
        : modelLaneEnabled
          ? "model lane reopened"
          : `model lane reopened by the owner, but it stays closed this cycle: ${laneDisabledReason}`;
    if (await honorIntent(latest, detail)) honoredLaneIntents.push(latest.intentId);
  }
}

let costLedger: CostEntry[] = [];
let ledgerUnreadable: string | null = null;
try {
  costLedger = [...(await repos.costs.readAll())];
} catch (error) {
  ledgerUnreadable = error instanceof Error ? error.message : String(error);
  runtimeConditions.push(`the cost ledger could not be read (${ledgerUnreadable}); the rolling ceiling cannot be enforced, so Scout work is deferred`);
}
const spendWindow = researchSpendInWindow(costLedger, NOW);
let spentThisCycle = 0;
let scoutsAdmittedThisCycle = 0;
let priorCircuits: readonly ProviderCircuit[] = [];
let priorLastSuccessfulActivity: string | null = null;
let priorResearchState: ResearchState | null = null;
try {
  const previous = await repos.researchState.read(RESEARCH_STATE_ID);
  priorResearchState = previous?.value ?? null;
  priorCircuits = previous?.value.fleetSafety?.providerCircuits ?? [];
  priorLastSuccessfulActivity = previous?.value.fleetSafety?.lastSuccessfulActivity ?? null;
} catch (error) {
  runtimeConditions.push(`prior Fleet safety state could not be read: ${error instanceof Error ? error.message : String(error)}`);
}
const fleetSafety = new FleetSafetyController({
  now: NOW,
  costs: costLedger,
  costLedgerReadable: ledgerUnreadable === null,
  paused: intents.runnerPause.paused,
  circuits: priorCircuits,
  lastSuccessfulActivity: priorLastSuccessfulActivity,
});
if (ledgerUnreadable !== null) {
  fleetSafety.defer("all model-backed Fleet work", "UNMEASURED_MODEL_SPEND", `the canonical cost ledger could not be read: ${ledgerUnreadable}`);
}

/* Prior context the Scout may inherit — read once, only when a Scout can run. */
const priorScoutResults = new Map<string, ScoutResult[]>();
const priorDispositionsByObligation = new Map<string, { disposition: string; permission: string; transport: string; note: string; at: string }[]>();
if (modelLaneEnabled && dueModel.length > 0) {
  try {
    const priorResults = canary
      ? (await Promise.all(dueModel.map((row) => repos.scoutResults.read(row.obligation.id)))).flat()
      : await repos.scoutResults.readAll();
    for (const r of priorResults) {
      const list = priorScoutResults.get(r.obligationId) ?? [];
      list.push(r);
      priorScoutResults.set(r.obligationId, list);
    }
  } catch (error) {
    runtimeConditions.push(`prior Scout results could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const routeTaskToObligation = new Map<string, string>();
    const priorDispositions: (Awaited<ReturnType<typeof repos.dispositions.readAll>>)[number][] = [];
    if (canary) {
      for (const row of dueModel) {
        const standing = sync.all.find((entry) => entry.id === row.obligation.id);
        if (!standing?.openOccurrenceId) continue;
        const occurrence = await repos.occurrences.read(standing.openOccurrenceId);
        if (!occurrence) continue;
        routeTaskToObligation.set(occurrence.value.routeTaskId, occurrence.value.obligationId);
        priorDispositions.push(...await repos.dispositions.read(occurrence.value.routeTaskId));
      }
    } else {
      for (const occ of await repos.occurrences.list()) routeTaskToObligation.set(occ.value.routeTaskId, occ.value.obligationId);
      priorDispositions.push(...await repos.dispositions.readAll());
    }
    for (const c of priorDispositions) {
      const obligationId = routeTaskToObligation.get(c.routeTaskId);
      if (obligationId === undefined) continue;
      const list = priorDispositionsByObligation.get(obligationId) ?? [];
      list.push({
        disposition: c.disposition.disposition,
        permission: c.disposition.permission,
        transport: c.disposition.transport,
        note: c.disposition.note,
        at: c.committedAt,
      });
      priorDispositionsByObligation.set(obligationId, list);
    }
  } catch (error) {
    runtimeConditions.push(`prior dispositions could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** The most recent prior rungs a resumed Attempt is briefed with. A floor on the brief's size, never on the record. */
const PRIOR_RUNGS_BRIEFED = 40;

function inheritedFor(row: ScheduledObligation): InheritedEvidence {
  const id = row.obligation.id;
  const all = [...(priorScoutResults.get(id) ?? [])].sort((a, b) => (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0));
  const prior = all.slice(-2);
  const dispositions = (priorDispositionsByObligation.get(id) ?? []).slice(-3);
  const debt = debtsIn.find((d) => d.obligationId === id);
  const lines: string[] = [];
  for (const r of prior) {
    lines.push(
      `PRIOR SCOUT ${r.recordedAt}: ${r.refusal ? `REFUSED (${r.refusal.map((i) => i.code).join(", ")})` : r.outcome} (${r.stoppedBy}); ` +
        `rungs: ${r.rungs.map((g) => `${g.rung} -> ${g.target} [${g.observed}]`).join("; ") || "none"}; ` +
        `next rungs it named: ${r.nextRungs.join("; ") || "none"}; ` +
        `candidates: ${r.candidates.map((c) => `${c.routeId} <${c.url}>`).join(", ") || "none"}`,
    );
  }
  for (const d of dispositions) {
    lines.push(`PRIOR DISPOSITION ${d.at}: ${d.disposition} (permission ${d.permission}, transport ${d.transport}) — ${d.note.slice(0, 300)}`);
  }
  if (debt) lines.push(`DEBT: ${debt.consecutiveFailures} consecutive failure(s), retry at ${debt.retryAt}`);
  /*
   * RULING 244: the recorded rung list is the resume cursor, and a durably
   * failed rung is not re-walked. RULING 243: an inherited artifact may be
   * cited only where the machine can say when and under what verdict it was
   * retrieved — rungs recorded before the verdict travelled on them yield
   * provenance for robots documents only (the tool vaults those under
   * ALLOWED); a page artifact with no recorded verdict yields none, so a
   * candidate resting on it alone is refused rather than guessed at.
   */
  const priorRungs: PriorRung[] = all
    .flatMap((r) => r.rungs.map((g) => ({ rung: g.rung, tool: g.tool, target: g.target, observed: g.observed, ok: g.ok ?? null, at: g.at, attemptId: r.attemptId })))
    .slice(-PRIOR_RUNGS_BRIEFED);
  const provenance: ArtifactProvenance[] = [];
  const seen = new Set<string>();
  for (const r of all) {
    for (const g of r.rungs) {
      const verdict = g.permission ?? (g.tool === "read_permission" ? "ALLOWED" : null);
      if (verdict === null) continue;
      for (const artifactId of g.artifactIds) {
        if (seen.has(artifactId)) continue;
        seen.add(artifactId);
        provenance.push({
          artifactId,
          canonicalUrl: g.target,
          retrievedAt: g.at,
          permission: verdict,
          methodRouteId: g.tool === "read_permission" ? "scout:read_permission" : g.tool === "browse" ? "scout:browse" : "scout:fetch_public",
          httpStatus: Number(/HTTP (\d{3})/.exec(g.observed)?.[1] ?? NaN) || null,
        });
      }
    }
  }
  return {
    artifactIds: [...new Set(prior.flatMap((r) => r.artifactIds))],
    summary: lines.join("\n"),
    provenance,
    priorRungs,
    nextRungs: all.at(-1)?.nextRungs ?? [],
  };
}

/* ------------------------------------------------- host supervision --- */

/**
 * **THE RELAUNCH PROOF TRAVELS WITH THE STATE.** (Work Item 3.2, RULING 246.)
 * The proof file is read from THIS checkout; the live trigger is asked of the
 * scheduled task through `scripts/pilot-task.ps1 -Action verify-triggers`
 * (win32 only; elsewhere the reading is NOT_MEASURABLE_ON_THIS_HOST). Neither
 * read can make the verdict ACTIVE by itself — `deriveLevel1` asks for a
 * RELAUNCHED proof within tolerance AND the trigger still present.
 */
function measureHostSupervision(): HostSupervision {
  const proofRel = join("data", "ops", "runner-relaunch-proof.json");
  const proofPath = join(ROOT, proofRel);
  let proof: RelaunchProof | null = null;
  if (existsSync(proofPath)) {
    try {
      const raw = JSON.parse(readFileSync(proofPath, "utf8")) as Record<string, unknown>;
      const n = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
      const s = (v: unknown): string | null => (typeof v === "string" ? v : null);
      proof = {
        measuredAt: s(raw.measuredAt) ?? "",
        killedPid: n(raw.killedPid),
        relaunchedPid: n(raw.relaunchedPid),
        secondsToRelaunch: n(raw.secondsToRelaunch),
        relaunchTriggerPresent: raw.relaunchTriggerPresent === true,
        taskStateAfter: s(raw.taskStateAfter),
        lastTaskResult: s(raw.lastTaskResult),
        verdict: raw.verdict === "RELAUNCHED" ? "RELAUNCHED" : "NOT_RELAUNCHED",
      };
    } catch (error) {
      runtimeConditions.push(`the relaunch proof at ${proofRel} could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (platform() !== "win32") {
    return {
      host: HOST,
      checkedAt: nowIso(),
      measurable: false,
      notMeasurableReason: `NOT_MEASURABLE_ON_THIS_HOST (${platform()}: the scheduled task and its relaunch trigger exist only on the Windows runner host)`,
      relaunchTrigger: { present: null, detail: "not asked: no scheduled task on this platform" },
      proof,
      proofPath: proofRel,
    };
  }
  let present: boolean | null = null;
  let detail: string;
  try {
    const run = spawnSync(
      "powershell",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(ROOT, "scripts", "pilot-task.ps1"), "-Action", "verify-triggers"],
      { encoding: "utf8", timeout: 60_000, windowsHide: true },
    );
    const text = `${run.stdout ?? ""}`;
    const start = text.indexOf("{");
    const parsed = start >= 0 ? (JSON.parse(text.slice(start)) as { relaunchTriggerPresent?: unknown; taskPresent?: unknown; state?: unknown }) : null;
    if (parsed === null) {
      detail = `verify-triggers printed no JSON (exit ${run.status ?? "null"}${run.error ? `, ${run.error.message}` : ""})`;
    } else {
      present = parsed.relaunchTriggerPresent === true;
      detail = `verify-triggers: taskPresent ${String(parsed.taskPresent)}, state ${String(parsed.state)}, relaunchTriggerPresent ${String(parsed.relaunchTriggerPresent)} (exit ${run.status ?? "null"})`;
    }
  } catch (error) {
    detail = `verify-triggers could not run: ${error instanceof Error ? error.message : String(error)}`;
  }
  return { host: HOST, checkedAt: nowIso(), measurable: true, notMeasurableReason: null, relaunchTrigger: { present, detail }, proof, proofPath: proofRel };
}
const hostSupervision = measureHostSupervision();
console.log(
  `  host supervision: ${hostSupervision.measurable ? `trigger ${hostSupervision.relaunchTrigger.present === null ? "UNKNOWN" : hostSupervision.relaunchTrigger.present ? "present" : "ABSENT"}` : hostSupervision.notMeasurableReason} · ` +
    `proof ${hostSupervision.proof === null ? `ABSENT at ${hostSupervision.proofPath}` : `${hostSupervision.proof.verdict} measured ${hostSupervision.proof.measuredAt} (${hostSupervision.proof.secondsToRelaunch ?? "?"}s)`}`,
);

/* ----------------------------------------------------- research state --- */

const running: RunningScout[] = [];
const scoutResultsThisCycle: ScoutResult[] = [];
const candidateReports: ProposalReport[] = [];
let laneCounts: { deterministicDispatched: number; modelDispatched: number; deferredBy: Record<string, number> } = {
  deterministicDispatched: 0,
  modelDispatched: 0,
  deferredBy: {},
};
/** Computed once at cycle end; null on the start-of-cycle state. */
let metrics: ResearchMetrics | null = null;
const researchWindowId = `research:${HOST}:${NOW}`;
let researchProgression = priorResearchState?.researchProgression ?? null;
let researchProgressionFailure: string | null = null;

/**
 * The research state this cycle writes, carrying the owner's dispatch it
 * honored (ADM-8). `ownerDispatch` is the latest DISPATCH this cycle honored,
 * or null; every one of them is on the run record. It rides as an extra field
 * on `ResearchState` so the page can pick it up without this script deciding
 * the page's contract.
 */
type CycleResearchState = ResearchState & { readonly ownerDispatch: OwnerDispatchRecord | null };

function researchState(cycleFinishedAt: string | null): CycleResearchState {
  const window = spendWindow.windowUsd === null ? null : spendWindow.windowUsd + spentThisCycle;
  return {
    formatVersion: RESEARCH_FORMAT_VERSION,
    beatAt: nowIso(),
    cycleStartedAt: NOW,
    cycleFinishedAt,
    testedSha: headSha(ROOT),
    host: HOST,
    modelLaneEnabled,
    modelLaneDisabledReason: laneDisabledReason,
    pausedByOwner: intents.paused,
    pauseIntentId: intents.pauseIntentId,
    workerCredential: {
      name: WORKER_CREDENTIAL_VAR,
      configured: credentialConfigured,
      provider: "anthropic",
      context: `standing runner child process (freshness-shadow) on ${HOST}, env via node --env-file`,
    },
    model: SCOUT_MODEL,
    bounds: { ...RESEARCH_BOUNDS, maxScoutDispatchesPerCycle: SCOUT_MAX },
    spend: {
      windowUsd: window,
      measuredAttempts: spendWindow.measured,
      unmeasuredAttempts: spendWindow.unmeasured,
      asOf: nowIso(),
    },
    queue: {
      registeredUnits: allUnits.length,
      modelClassUnits: modelClassUnits.length,
      modelClassDue: dueModel.length,
      modelClassDispatchedThisCycle: laneCounts.modelDispatched,
      modelClassDeferredForCeiling: laneCounts.deferredBy.CEILING ?? 0,
      modelClassDeferredForCycleMax: (laneCounts.deferredBy.CYCLE_MAX ?? 0) + Math.max(0, dueModel.length - openedModel),
      modelClassDeferredForLane: (laneCounts.deferredBy.LANE_DISABLED ?? 0) + (laneCounts.deferredBy.PAUSED ?? 0),
      deterministicDue: dueDeterministic,
      deterministicDispatchedThisCycle: laneCounts.deterministicDispatched,
    },
    running: [...running],
    runtimeConditions: [...runtimeConditions],
    methodCandidates: (() => {
      const counts = candidateStoreCounts(ROOT);
      return counts === null
        ? null
        : { proposed: counts.PROPOSED, validated: counts.VALIDATED, admitted: counts.ADMITTED, rejected: counts.REJECTED };
    })(),
    hostSupervision,
    dispatchOrdering,
    metrics,
    ownerDispatch: ownerDispatches.at(-1) ?? null,
    fleetSafety: fleetSafety.snapshot(cycleFinishedAt ?? nowIso()),
    researchProgression,
  };
}

async function writeResearchState(cycleFinishedAt: string | null): Promise<void> {
  for (let tries = 0; tries < 4; tries += 1) {
    try {
      const current = await repos.researchState.read(RESEARCH_STATE_ID);
      const next = researchState(cycleFinishedAt);
      if (current === null) await repos.researchState.put(RESEARCH_STATE_ID, next, nowIso());
      else await repos.researchState.compareAndSet(RESEARCH_STATE_ID, current.revision, next, nowIso());
      return;
    } catch (error) {
      if (tries === 3) {
        runtimeConditions.push(`the research state could not be written: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

await writeResearchState(null);

/* ----------------------------------------------------------- the executor --- */

const vault = cycleVault(join(ROOT, ...VAULT_DIR));
const spacer = hostSpacer();

const simulated: RunWork = async ({ executor, routeTaskId }) => ({
  ranAs: "DETERMINISTIC",
  kind: "SIMULATED",
  detail: `--dry: ${executor} decided route task ${routeTaskId.slice(0, 12)} — no retrieval ran`,
});

/** The deterministic lane: an HTTP GET or POST from a committed descriptor. Never a model. */
const executorFor = (obligation: { obligation: { id: string } }): DeclaredExecutor => {
  const route = registry.routeFor(obligation.obligation.id);
  return {
    lane: "DETERMINISTIC",
    workerFor: ({ holder }) => ({
      role: "ACQUIRER",
      provider: "we-the-people",
      version: dry ? "shadow-decision/1.0" : `route-executor/1.0 (${route?.routeId ?? "unrouted"})`,
      instance: holder,
    }),
    run: dry
      ? simulated
      : routeExecutor({
          routeFor: (id) => registry.routeFor(id),
          spaceOut: spacer,
          vault: vault.put,
          openOne: fleetSafety.guardedOpenOne("public-web", obligation.obligation.id),
        }),
  };
};

/**
 * THE SCOUT LANE. A real bounded model worker: role SCOUT, provider
 * anthropic, the model named, provider-reported usage and computed cost on
 * the Attempt, research through tools that vault first. Built only when the
 * lane is enabled; otherwise a refusing stand-in that `admitScout` never
 * reaches.
 */
const scoutFor = (scheduled: ScheduledObligation): DeclaredExecutor => modelLaneEnabled
  ? scoutExecutor({
      transport: fleetSafety.guardedModelTransport("anthropic", scheduled.obligation.id, anthropicTransport(workerKey)),
      toolkitFor: buildScoutToolkit,
      contextFor: (row) => ({
        route: registry.routeFor(row.obligation.id),
        providerId: registry.providerOf(row.obligation.id),
        reason: decisionFor(row.obligation.id, row.obligation.routeId).why,
        /* RULING 244: a DETERMINISTIC decision reaching the Scout is refused before any request. */
        decision: decisionFor(row.obligation.id, row.obligation.routeId).kind,
        inherited: inheritedFor(row),
        tools: {
          vault: vault.put,
          vaultBytes: vault.putBytes,
          spaceOut: spacer,
          openOne: fleetSafety.guardedOpenOne("public-web", scheduled.obligation.id),
          openBytes: fleetSafety.guardedOpenBytes("public-web", scheduled.obligation.id),
        },
      }),
      onStart: async ({ attemptId, obligationId, startedAt }) => {
        running.push({ attemptId, obligationId, startedAt });
        await writeResearchState(null);
      },
      onResult: async (result: ScoutResult, artifacts: readonly WorkArtifact[]) => {
        let amended = result;
        if (result.refusal === null && result.candidates.length > 0) {
          try {
            const report = proposeScoutCandidates({ root: ROOT, result, artifacts, stamp: today() });
            candidateReports.push(report);
            amended = {
              ...result,
              methodCandidateIds: report.proposed.map((p) => p.candidateId),
              unverified: [...result.unverified, ...report.notProposed.map((n) => `${n.routeId}: ${n.why}`)],
            };
          } catch (error) {
            amended = {
              ...result,
              unverified: [...result.unverified, `method candidate proposal failed: ${error instanceof Error ? error.message : String(error)}`],
            };
          }
        }
        await repos.scoutResults.append(amended.obligationId, amended.attemptId, amended, nowIso());
        scoutResultsThisCycle.push(amended);
        return amended;
      },
    })
  : {
      lane: "BOUNDED_MODEL_WORKER",
      run: async () => ({
        ranAs: "BOUNDED_MODEL_WORKER",
        kind: "ABORTED",
        detail: `the Scout lane is closed this cycle: ${laneDisabledReason ?? "(no reason recorded)"}`,
      }),
    };

/* --------------------------------------------------------------- the cycle --- */

// Keep a bounded share of the existing cycle for registered multi-worker work.
// Otherwise an always-full refresh queue could starve the fleet indefinitely.
const plannedWork = canary || scheduledBlackout ? [] : (await repos.workItems.list()).filter(item => item.value.autonomousPlan);
const fleetReserveMs = !dry && !canary && plannedWork.length ? Math.min(360_000, BUDGET_MIN * 30_000) : 0;
// Registered investigations also need Scout after a known source fails or leaves
// verification unresolved; initial source discovery is not the only model work.
const fleetScoutReserve = !dry && !canary && plannedWork.length ? Math.min(1, SCOUT_MAX) : 0;

const cycle = await runCycle({
  repos,
  obligations: sync.all,
  debts: debtsIn,
  routeTaskFor: (id) => occurrenceByObligation.get(id)?.routeTaskId ?? null,
  maturity,
  executor: executorFor,
  holder: `freshness-shadow@${process.pid}`,
  now: NOW,
  leaseTtlMs: 120_000,
  reader: {
    contract: "READER",
    state: "NOT_READY",
    reason:
      "not computed by this run; the reader contract is `pnpm reader:suite`'s to state, and a " +
      "scheduler that computed it would be grading its own homework",
  },
  truth: {
    contract: "TRUTH",
    state: "NOT_READY",
    reason: "not computed by this run; the truth contract is the control set's to state",
  },
  maxDispatches: MAX_DISPATCHES,
  skipReclaim: canary,
  admitDispatch: (row) => fleetSafety.admitDispatch(row.obligation.id),
  budget: { deadlineMs: DISPATCH_DEADLINE_MS - fleetReserveMs, now: () => Date.now() },
  /* ADM-8: the owner's dispatch goes first in the dispatcher's own due order too. */
  placeFirst: dispatchPriority,
  research: {
    decide: (row) => decisionFor(row.obligation.id, row.obligation.routeId),
    admitScout: () => {
      if (!modelLaneEnabled) return { admit: false, code: laneDisabledCode ?? "LANE_DISABLED", why: laneDisabledReason ?? "lane closed" };
      if (ledgerUnreadable !== null) return { admit: false, code: "CEILING", why: `the cost ledger could not be read, so the ceiling cannot be enforced (${ledgerUnreadable})` };
      const window = spendWindow.windowUsd === null ? null : spendWindow.windowUsd + spentThisCycle;
      const cap = ceilingPermits(window, RESEARCH_BOUNDS.dailyCeilingUsd);
      if (!cap.permits) return { admit: false, code: "CEILING", why: cap.why };
      if (scoutsAdmittedThisCycle >= SCOUT_MAX - fleetScoutReserve) return { admit: false, code: "CYCLE_MAX", why: `this cycle's Scout allowance is allocated (${fleetScoutReserve} reserved for registered autonomous discovery; total maximum ${SCOUT_MAX})` };
      scoutsAdmittedThisCycle += 1;
      return { admit: true };
    },
    modelExecutor: scoutFor,
    maxConcurrentScouts: RESEARCH_BOUNDS.maxConcurrentScouts,
    scoutLeaseTtlMs: RESEARCH_BOUNDS.perDispatch.maxWallMs + 120_000,
    scoutWallMs: RESEARCH_BOUNDS.perDispatch.maxWallMs,
    onDispatched: async (result: DispatchResult, lane) => {
      if (result.outcome === "WORKED") fleetSafety.recordSuccessfulActivity(nowIso());
      if (lane === "BOUNDED_MODEL_WORKER") {
        spentThisCycle += result.cost?.usd ?? 0;
        const at = running.findIndex((r) => r.attemptId === result.attemptId);
        if (at >= 0) running.splice(at, 1);
        laneCounts = { ...laneCounts, modelDispatched: laneCounts.modelDispatched + 1 };
        await writeResearchState(null);
      } else {
        laneCounts = { ...laneCounts, deterministicDispatched: laneCounts.deterministicDispatched + 1 };
      }
    },
  },
});
laneCounts = {
  deterministicDispatched: cycle.lanes?.deterministic.dispatched ?? laneCounts.deterministicDispatched,
  modelDispatched: cycle.lanes?.model.dispatched ?? laneCounts.modelDispatched,
  deferredBy: { ...(cycle.lanes?.model.deferredBy ?? {}) },
};
for (const row of cycle.deferred) {
  const code = /^([A-Z][A-Z0-9_]+)/.exec(row.why)?.[1] ?? "CYCLE_DEFERRED";
  fleetSafety.defer(row.obligationId, code, row.why);
}

const budgetDeferred = cycle.deferred.filter((d) => d.why.includes("dispatch budget was spent")).length;
console.log(
  `\n  dispatch budget: ${Math.max(0, BUDGET_MIN - FINALIZATION_RESERVE_MS / 60_000)} min; hard cycle wall ${BUDGET_MIN} min` +
    (budgetDeferred > 0
      ? ` — SPENT; ${budgetDeferred} due item(s) deferred to a later cycle rather than run past the ` +
        "runner's ceiling and be killed mid-write"
      : " — not reached"),
);

/* ------------------------------------------------- close, and persist debt --- */

for (const result of cycle.dispatched) {
  const occ = occurrenceByObligation.get(result.obligationId);
  if (!occ) continue;
  const discharged =
    result.outcome === "WORKED" &&
    result.dispositionCommitted &&
    (result.disposition === "INGESTED" || result.disposition === "WALKED_NO_YIELD");
  await closeOccurrence(repos, {
    occurrenceId: occ.id,
    disposition: discharged ? result.disposition : null,
    unresolvedReason: discharged ? null : result.detail,
    now: NOW,
  });
}

const persisted = await persistDebts(repos, cycle.debts, NOW, canary ? corpus.map((obligation) => obligation.id) : null);
console.log(
  `\n  debt persisted: ${persisted.written} row(s) written, ${persisted.cleared.length} cleared`,
);

// Registered autonomous plans use the same dispatcher, vault, host spacing and
// rolling model ceiling. Discovery shares this cycle's existing Scout allowance.
if (!dry && !canary && !scheduledBlackout && Date.now() + 150_000 < DISPATCH_DEADLINE_MS) {
  try {
    const fleet = await autonomousStandingRuntime({ root: ROOT, repos, now: nowIso,
      spaceOut: spacer,
      openBytes: fleetSafety.guardedOpenBytes("public-web", "registered autonomous Fleet acquisition"),
      ...(modelLaneEnabled ? { transport: fleetSafety.guardedModelTransport("anthropic", "registered autonomous Fleet audit", boundedAuditTransport(workerKey)) } : {}) });
    const autonomous = await runAutonomousCoordinator(fleet, { maximum: 3, concurrency: 2,
      deadlineMs: DISPATCH_DEADLINE_MS, maxScoutDispatches: Math.max(0, SCOUT_MAX - scoutsAdmittedThisCycle),
      admitDispatch: work => fleetSafety.admitDispatch(work) });
    for (const row of autonomous.deferred) fleetSafety.defer(row.workItemId, row.reason, row.detail);
    scoutsAdmittedThisCycle += autonomous.scoutsAdmitted;
    const remaining = Math.max(0, FLEET_SAFETY_BOUNDS.maxDispatchesPerCycle - fleetSafety.snapshot().cycle.dispatches);
    const legacy = Date.now() + 150_000 < DISPATCH_DEADLINE_MS
      ? await runHeldWorkerFleetCycle(ROOT, fleet, true, { maximumDispatches: remaining, admitDispatch: work => fleetSafety.admitDispatch(work) })
      : [];
    const fleetDispatches = [...autonomous.dispatches, ...legacy];
    if (fleetDispatches.some(row => row.outcome === "WORKED")) fleetSafety.recordSuccessfulActivity(nowIso());
    await projectFleetPipeline(repos);
    for (const row of fleetDispatches) console.log(`  worker fleet: ${row.worker?.role ?? "UNCLAIMED"} ${row.outcome} ${row.attemptId ?? "none"}: ${row.detail}`);
  } catch (error) {
    runtimeConditions.push(`worker fleet could not complete this bounded pass: ${error instanceof Error ? error.message : "WORKER_FLEET_FAILED"}`);
  }
}
/* ------------------------------------------------------- the promotion tail --- */

/*
 * RULING 224. Acquisition without promotion is inventory, not product. The tail
 * runs on EVERY cycle with no operator: acquire -> vault -> normalize ->
 * snapshot -> STAGED. Promotion itself is OFF and a session carries the last
 * mile, so nothing below writes outside data/control-plane/staging/.
 */
const staged: StagedEntry[] = [];
for (const result of cycle.dispatched) {
  const unit = units.find((u) => u.obligation.id === result.obligationId);
  if (unit === undefined) continue;
  if (unit.record.recordClass === "meetings") continue;

  let body: string | null = null;
  for (const artifactId of result.artifactIds) {
    const entry = vault.ledger.get(artifactId);
    if (entry === undefined) continue;
    body = await vault.readBack(entry.key);
    if (body !== null) break;
  }

  staged.push(
    stageOne({
      root: ROOT,
      obligationId: result.obligationId,
      providerId: unit.providerId,
      recordClass: unit.record.recordClass,
      subjectId: unit.record.subjectId,
      route: unit.route,
      disposition: result.disposition,
      artifactIds: result.artifactIds,
      body,
      nextDueAt: nextDueByObligation.get(result.obligationId) ?? null,
      detail: result.detail,
      stagedOn: today(),
    }),
  );
}
const manifest = writeStagingManifest(ROOT, staged, today());

/* ------------------------------------------------- research metrics --- */

/*
 * Computed ONCE, at cycle end, from re-reads of the durable logs so this
 * cycle's own Attempts are in the denominators. A failed re-read is a named
 * runtime condition and the metrics record is withheld, never zeroed.
 */
async function computeMetrics(): Promise<ResearchMetrics | null> {
  let results: readonly ScoutResult[];
  let costsNow: readonly CostEntry[];
  try {
    results = await repos.scoutResults.readAll();
    costsNow = await repos.costs.readAll();
  } catch (error) {
    runtimeConditions.push(`research metrics NOT computed: a durable log could not be re-read (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
  const at = nowIso();
  const windowCycles: { startedAt: string; deterministic: number; model: number }[] = [];
  try {
    const since = Date.parse(at) - RESEARCH_BOUNDS.windowHours * 3_600_000;
    for (const f of readdirSync(RUNS_DIR).filter((x) => x.endsWith(".json")).sort()) {
      const rec = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as { startedAt?: string; research?: { lanes?: { deterministic?: { dispatched?: number }; model?: { dispatched?: number } } | null } };
      const lanes = rec.research?.lanes;
      if (!lanes || typeof rec.startedAt !== "string" || Date.parse(rec.startedAt) < since) continue;
      windowCycles.push({ startedAt: rec.startedAt, deterministic: lanes.deterministic?.dispatched ?? 0, model: lanes.model?.dispatched ?? 0 });
    }
  } catch {
    /* no run records readable: the window is what this cycle saw */
  }
  const counts = candidateStoreCounts(ROOT);
  const candidateCounts = counts === null ? null : { proposed: counts.PROPOSED, validated: counts.VALIDATED, admitted: counts.ADMITTED, rejected: counts.REJECTED };
  const pipeline = await NO_PIPELINE_RECORDED();
  return {
    computedAt: at,
    capacity: scoutCapacity({ costs: costsNow, nowIso: at, windowHours: RESEARCH_BOUNDS.windowHours, ceilingUsd: RESEARCH_BOUNDS.dailyCeilingUsd }),
    ordering: dispatchOrdering,
    funnel: graduationFunnel({
      results,
      candidateCounts,
      pipeline,
      pipelineSource: "none recorded — the promotion pipeline (lib/control-plane/promotion) is another lane's; plug its reader in here",
      deterministicReplays: 0,
    }),
    share: modelShareTrend({ thisCycle: { deterministic: laneCounts.deterministicDispatched, model: laneCounts.modelDispatched }, windowCycles }),
    cacheByRole: cacheHitRateByRole(results),
    costPerOutcome: costPerUsefulOutcome({ results, candidateCounts, confirmed: null }),
    cacheDefects: cacheDefectCounts(results),
  };
}
if (canary) {
  runtimeConditions.push("live canary: whole-store metrics scans were intentionally skipped");
  metrics = null;
} else {
  metrics = await computeMetrics();
}

/* -------------------------------------------- research state, heartbeat --- */

const finishedAt = nowIso();
if (!dry && !canary) {
  try {
    researchProgression = await readResearchProgression(repos, {
      windowId: researchWindowId, through: finishedAt, gate: readActivationGate(ROOT),
      candidates: readCandidateStore(join(ROOT,"data","method","candidates.json")).candidates,
      knowledge: readMethodStore(join(ROOT,...METHOD_STORE)),
      conclusions: readConclusionStore(join(ROOT,"data","method","conclusions.json")),
      researchBoundary: {
        since: priorResearchState?.researchProgression?.through ?? priorResearchState?.cycleFinishedAt ?? NOW,
        previousCompletedWindowId: priorResearchState?.researchProgression?.windowId ?? (priorResearchState?.cycleFinishedAt ? `research:${priorResearchState.host}:${priorResearchState.cycleStartedAt}` : null),
      },
    });
  } catch (error) {
    researchProgressionFailure = error instanceof Error ? error.message : String(error);
    runtimeConditions.push(`RESEARCH_PROGRESSION_UNAVAILABLE: ${researchProgressionFailure}; no zero-progress claim was produced`);
  }
}
await writeResearchState(finishedAt);
const finalState = researchState(finishedAt);

const heartbeat: RunnerHeartbeat = {
  formatVersion: OWNER_SURFACE_FORMAT_VERSION,
  beatAt: finishedAt,
  lastCycleStartedAt: NOW,
  lastCycleFinishedAt: finishedAt,
  nextCycleDueAt: INTERVAL_MIN === null ? null : new Date(Date.now() + INTERVAL_MIN * 60_000).toISOString(),
  lastCycleOk: true,
  testedSha: headSha(ROOT),
  host: HOST,
  /* A working beat: the runner is not idling on a PAUSE_RUNNER (ADM-5). */
  pause: null,
};
try {
  const beat = await repos.runnerHeartbeat.read(RUNNER_ID);
  if (beat === null) await repos.runnerHeartbeat.put(RUNNER_ID, heartbeat, finishedAt);
  else await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, beat.revision, heartbeat, finishedAt);
} catch (error) {
  runtimeConditions.push(`the runner heartbeat could not be written: ${error instanceof Error ? error.message : String(error)}`);
}

/* ------------------------------------------------------------- the digest --- */

const scoutDispatches = cycle.dispatched.filter((d) => d.executor === "BOUNDED_MODEL_WORKER");
const outcomeCounts = new Map<string, number>();
for (const r of scoutResultsThisCycle) {
  const key = r.refusal ? "REFUSED" : r.outcome;
  outcomeCounts.set(key, (outcomeCounts.get(key) ?? 0) + 1);
}
const deferredByLine = Object.entries(laneCounts.deferredBy)
  .map(([k, v]) => `${k} ${v}`)
  .join(", ");
const safety = finalState.fleetSafety!;
const researchLines = [
  "FLEET SAFETY",
  `  state              ${safety.status}`,
  `  model spend        cycle ${safety.cycle.modelUsd === null ? "UNMEASURED" : `$${safety.cycle.modelUsd.toFixed(4)}`} / $${safety.bounds.cycleModelUsd.toFixed(2)} · ` +
    `operational night ${safety.operationalNight.modelUsd === null ? "UNMEASURED" : `$${safety.operationalNight.modelUsd.toFixed(4)}`} / $${safety.bounds.operationalNightModelUsd.toFixed(2)} · ` +
    `rolling 24h ${safety.rolling24Hours.modelUsd === null ? "UNMEASURED" : `$${safety.rolling24Hours.modelUsd.toFixed(4)}`} / $${safety.bounds.rolling24HourModelUsd.toFixed(2)}`,
  `  aggregate          requests ${safety.cycle.requests}/${safety.bounds.maxProviderRequestsPerCycle} · payload bytes ${safety.cycle.payloadBytes}/${safety.bounds.maxPayloadBytesPerCycle} · ` +
    `dispatches ${safety.cycle.dispatches}/${safety.bounds.maxDispatchesPerCycle} · wall ${safety.cycle.elapsedMs}/${safety.bounds.maxWallMsPerCycle}ms`,
  `  stopped/deferred   ${safety.stoppedBecause.length === 0 ? "none" : safety.stoppedBecause.join("; ")}`,
  `  circuits           ${safety.providerCircuits.length === 0 ? "none" : safety.providerCircuits.map(c => `${c.provider}: ${c.condition} (latched until ${c.eligibleAt})`).join("; ")}`,
  `  last success       ${safety.lastSuccessfulActivity ?? "none recorded"}`,
  "",
  "RESEARCH — LEVEL 1 (RULING 240)",
  `  lane               ${modelLaneEnabled ? "ENABLED" : `CLOSED — ${laneDisabledReason}`}`,
  `  credential         ${WORKER_CREDENTIAL_VAR} configured in this process: ${credentialConfigured ? "yes" : "NO"} (by name; the value reaches only the provider request)`,
  `  model              ${SCOUT_MODEL} · concurrency ${RESEARCH_BOUNDS.maxConcurrentScouts} · per cycle ${SCOUT_MAX} · per Attempt ${RESEARCH_BOUNDS.perDispatch.maxTurns} turns / ${RESEARCH_BOUNDS.perDispatch.maxToolCalls} tools / ${Math.round(RESEARCH_BOUNDS.perDispatch.maxWallMs / 60_000)} min`,
  `  scouts             ${laneCounts.modelDispatched} dispatched of ${dueModel.length} due model-class (${modelClassUnits.length} registered model-class of ${allUnits.length}) · ` +
    `deferred ${cycle.lanes?.model.deferred ?? 0}${deferredByLine ? ` (${deferredByLine})` : ""}` +
    (dueModel.length - openedModel > 0 ? ` · ${dueModel.length - openedModel} not opened (Scout ceiling ${SCOUT_MAX})` : ""),
  `  spend              rolling ${RESEARCH_BOUNDS.windowHours}h: ${spendWindow.windowUsd === null ? "UNMEASURED" : `$${(spendWindow.windowUsd + spentThisCycle).toFixed(4)}`} of $${RESEARCH_BOUNDS.dailyCeilingUsd} ceiling ` +
    `(measured ${spendWindow.measured}, unmeasured ${spendWindow.unmeasured} before this cycle) · this cycle $${spentThisCycle.toFixed(4)}`,
  `  results            ${scoutResultsThisCycle.length} typed result(s)${outcomeCounts.size > 0 ? ` — ${[...outcomeCounts].map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}` +
    ` · ${scoutDispatches.filter((d) => d.dispositionCommitted).length} disposition(s) committed`,
  `  candidates         ${candidateReports.reduce((n, r) => n + r.proposed.length, 0)} method candidate(s) proposed and validated (never admitted here)`,
  `  disagreements      ${decisionDisagreements.length} executor-decision disagreement(s) recorded in the run record, never reconciled`,
  `  intents            ${honoredIntents.length} RUN_CYCLE_NOW honored · ${honoredDispatch.length} of ${intents.pendingDispatch.length} pending DISPATCH honored · ` +
    `${honoredLaneIntents.length} lane PAUSE/RESUME acknowledged · paused: ${intents.paused ? "yes" : "no"}`,
  ...ownerDispatches.map(
    (d) => `  owner dispatch     ${d.intentId}: "${d.target}" -> ${d.matched} of ${d.registered} registered unit(s) placed first in both lanes`,
  ),
  `  runtime            ${runtimeConditions.length === 0 ? "no condition prevents eligible Scout work" : runtimeConditions.join("; ")}`,
  `  supervision        ${hostSupervision.measurable ? `relaunch trigger ${hostSupervision.relaunchTrigger.present === null ? "UNKNOWN" : hostSupervision.relaunchTrigger.present ? "present" : "ABSENT"}` : hostSupervision.notMeasurableReason} · ` +
    `proof ${hostSupervision.proof === null ? `ABSENT at ${hostSupervision.proofPath}` : `${hostSupervision.proof.verdict} ${hostSupervision.proof.measuredAt} (${hostSupervision.proof.secondsToRelaunch ?? "?"}s)`} (RULING 246)`,
  /* RULING 244: every Attempt this cycle, by step — the cache reads per turn are the proof the prefix held. */
  ...scoutResultsThisCycle.flatMap((r) => {
    const model = (r.steps ?? []).filter((s) => s.kind === "MODEL");
    const det = (r.steps ?? []).filter((s) => s.kind === "DETERMINISTIC");
    return [
      `  attempt ${r.attemptId}  ${r.refusal ? "REFUSED" : r.outcome} · effort ${r.effort ?? "n/a"} · ${r.usage.turns} turn(s) · usd ${r.usd === null ? "UNMEASURED" : r.usd.toFixed(4)}` +
        ` · cache reads/turn ${model.map((s) => s.tokens.cacheRead).join("/") || "none recorded"}` +
        (r.cacheDefect ? ` · CACHE DEFECT turn(s) ${r.cacheDefect.turns.join(", ")}` : "") +
        ` · deterministic ${det.map((s) => `${s.step} x${s.count}`).join(", ") || "none"}` +
        ` · guard refusals ${r.guardRefusals?.length ?? 0} · overruns ${r.representationOverruns?.length ?? 0} · resumed from ${r.resumedFromRungs ?? 0} rung(s)`,
    ];
  }),
  "  PROMOTION          OFF. A Scout finding is inventory and a candidate; nothing it produced changed what a reader is told.",
  "",
  ...(metrics === null ? ["RESEARCH METRICS   NOT COMPUTED this cycle (a named runtime condition says why)"] : researchDigestLines(metrics)),
];

const lines = [
  ...digestLines(cycle),
  "",
  ...researchLines,
  "",
  ...registryLines(registry),
  "",
  ...promotionLines(staged),
  `  staging manifest   ${manifest.total} entry(ies) held, ${manifest.written} written this cycle`,
  `  dispatch budget    ${Math.max(0, BUDGET_MIN - FINALIZATION_RESERVE_MS / 60_000)} min admission + ${FINALIZATION_RESERVE_MS / 60_000} min finalization reserve inside ${BUDGET_MIN} min hard wall — ${
    budgetDeferred > 0
      ? `SPENT; ${budgetDeferred} due item(s) deferred to a later cycle rather than run past the runner's ceiling`
      : "not reached"
  }`,
];
console.log();
for (const line of lines) console.log(line);

/* --------------------------------------------------------- the run record --- */

mkdirSync(RUNS_DIR, { recursive: true });
const path = nextRunRecordPath(RUNS_DIR, today());
writeFileSync(
  path,
  `${JSON.stringify(
    {
      startedAt: cycle.startedAt,
      finishedAt,
      researchProgression: researchProgression?.windowId === researchWindowId ? researchProgression : null,
      researchProgressionFailure,
      testedSha: headSha(ROOT),
      provider: repos.describe(),
      durable: repos.durable,
      executor: dry ? "SIMULATED" : "route-aware + scout",
      registry: {
        providers: registry.byProvider,
        registeredUnits: allUnits.length,
        workedUnits: units.length,
        nonMeetingUnits: nonMeeting.length,
        only: ONLY,
      },
      obligations: sync.all.length,
      occurrencesOpened: openedDeterministic + openedModel,
      preOpenSkipped,
      debtInherited: debtIds.size,
      debtPersisted: persisted.written,
      debtCleared: persisted.cleared,
      scheduled: cycle.schedule.scheduled.length,
      unscheduled: cycle.schedule.unscheduled.map((u) => ({
        id: u.obligation.id,
        reason: u.reason,
      })),
      cadenceSources: Object.fromEntries(
        [...new Set(cycle.schedule.scheduled.map((s) => s.cadenceSource))].map((k) => [
          k,
          cycle.schedule.scheduled.filter((s) => s.cadenceSource === k).length,
        ]),
      ),
      dueCount: cycle.dueCount,
      dispatched: cycle.dispatched.length,
      worked: cycle.worked,
      simulated: cycle.simulated,
      dispositions: cycle.dispatched
        .filter((d) => d.dispositionCommitted)
        .map((d) => ({ obligationId: d.obligationId, disposition: d.disposition, artifacts: d.artifactIds.length })),
      executors: cycle.dispatched.map((d) => ({
        obligationId: d.obligationId,
        chosen: d.executorChosen,
        ran: d.executor,
        mismatch: d.executorMismatch,
        disagreement: d.decisionDisagreement,
      })),
      /* Every dispatch's own account, so a FAILED reads as its cause and not as a count. */
      dispatchDetails: cycle.dispatched.map((d) => ({
        obligationId: d.obligationId,
        attemptId: d.attemptId,
        outcome: d.outcome,
        disposition: d.disposition,
        detail: d.detail,
      })),
      research: {
        state: finalState,
        fleetSafety: safety,
        lanes: cycle.lanes,
        scouts: scoutDispatches.map((d) => ({
          obligationId: d.obligationId,
          attemptId: d.attemptId,
          outcome: d.outcome,
          disposition: d.disposition,
          worker: d.worker,
          cost: d.cost,
          artifacts: d.artifactIds.length,
          detail: d.detail,
        })),
        results: scoutResultsThisCycle.map((r) => ({
          obligationId: r.obligationId,
          attemptId: r.attemptId,
          outcome: r.outcome,
          refused: r.refusal !== null,
          stoppedBy: r.stoppedBy,
          rungs: r.rungs.length,
          distinctEvidenceRungs: r.distinctEvidenceRungs,
          candidates: r.candidates.length,
          methodCandidateIds: r.methodCandidateIds,
          usd: r.usd,
          elapsedMs: r.elapsedMs,
          effort: r.effort ?? null,
          steps: r.steps ?? null,
          cacheDefect: r.cacheDefect ?? null,
          guardRefusals: r.guardRefusals ?? null,
          representationOverruns: r.representationOverruns ?? null,
          resumedFromRungs: r.resumedFromRungs ?? null,
        })),
        candidateReports,
        decisionDisagreements,
        honoredIntents,
        /* ADM-8: every DISPATCH this cycle acted on, what it matched, and which were honored. */
        ownerDispatches,
        honoredDispatch,
        honoredLaneIntents,
        hostSupervision,
        dispatchOrdering,
        orderedScoutQueue: scoutOrder.map((b) => ({
          obligationId: b.row.id,
          band: b.band,
          why: b.why,
          nextDueAt: b.row.nextDueAt,
          ownerDispatch: dispatchPriority.has(b.row.id),
        })),
        metrics,
      },
      vaulted: [...vault.ledger.values()],
      staged,
      stagingManifest: `${["data", "control-plane", "staging"].join("/")}/manifest.json`,
      deferred: cycle.deferred.length,
      deferredReasons: cycle.deferred,
      reclaim: cycle.reclaim,
      debts: cycle.debts.length,
      incidents: cycle.incidents,
      risk: cycle.risk,
      health: cycle.health,
      promotedToReaderTruth: cycle.promotedToReaderTruth,
      digest: lines,
      provenance: readRunProvenance(headSha(ROOT), ROOT),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
console.log(`\n  run record: ${path}`);
await releaseWindowLease(repos, CYCLE_LEASE_HOLDER, nowIso());
