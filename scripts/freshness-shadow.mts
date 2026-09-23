import { boundedAuditTransport } from "../lib/control-plane/workers/model-audit.ts";
import { runHeldWorkerFleetCycle } from "../lib/control-plane/workers/standing.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { projectFleetPipeline } from "../lib/control-plane/workers/pipeline.ts";
import { isRetiredRoutineMeetingAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";
import { observeCyclePhases } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { readRelaunchTriggerVerification } from "../lib/control-plane/scheduler/host-supervision.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { retainRecentRoutineMeetingEvidence } from "../lib/control-plane/workers/routine-meeting-intake.ts";
/**
 * `pnpm freshness:shadow` — ONE UNATTENDED CYCLE OF THE FRESHNESS SCHEDULER.
 * (Session B, W3.5, 2026-08-30. Rewritten Session B resume, W3.B/C/E/F,
 * 2026-08-31. Rewritten again Session C, PART D, 2026-08-31. Level 1 —
 * Research wired in, 2026-09-01, RULING 240 / RULING 241.)
 *
 * It observes, ACQUIRES for real, records, normalizes, STAGES — and **promotes
 * nothing to canonical reader truth**. `runCycle` has no parameter that could,
 * and the promotion tail writes only under ignored `.runtime/control-plane/staging/` diagnostics.
 *
 * ## Two lanes, one cycle (Level 1)
 *
 * The input is the OBLIGATION-PROVIDER REGISTRY
 * (`lib/control-plane/scheduler/registry.ts`) — four research providers, one scheduled
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
 * appended to `scout_results`; route candidates are PROPOSED and VALIDATED in
 * the adopted `cp_method_candidates/live` aggregate and never admitted here.
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
 *                         SIMULATED, and by construction discharges nothing it
 *                         dispatches (an occurrence an earlier cycle already
 *                         disposed is still recovered with that disposition)
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, platform } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  closeCycleOccurrences,
  digestLines,
  placeFirstRows,
  runCycle,
} from "../lib/control-plane/scheduler/shadow-loop.ts";
import {
  describeDispatchMatch,
  parseDispatchTarget,
  unitMatchesTarget,
} from "../lib/control-plane/scheduler/dispatch-target.ts";
import { WindowLockHeld, acquireWindowLease, releaseWindowLease } from "../lib/control-plane/promotion/window.ts";
import { scheduleObligation, isScheduled, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { retryable } from "../lib/control-plane/scheduler/debt.ts";
import { ABSENCE_EXPIRY_DAYS, absenceExpiry, isArguedAbsence } from "../lib/control-plane/scheduler/absence.ts";
import { buildRegistry, registryLines } from "../lib/control-plane/scheduler/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { trackerIntakeProvider } from "../lib/control-plane/scheduler/providers/tracker-intake.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import {
  candidateEnrichmentProvider,
  preloadCandidateEnrichmentAuthorities,
} from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import { meetingsDiscoveryProvider, paidDiscoveryHold } from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import {
  UNREAD_FREE_DISCOVERY_WALKS,
  UNREAD_MEETING_PARTITIONS,
  promotedRegistries,
  trackedStatesFromOperationalReference,
  type MaterializedReading,
} from "../lib/control-plane/scheduler/provider-inputs.ts";
import { OWNER_DISPATCH } from "../lib/control-plane/scheduler/obligation.ts";
import {
  applyDispatchWork,
  carriedDispatchTargets,
  dispatchWorkReading,
  dispatchWorkSentence,
  dispatchWorkTarget,
  ownerDispatchWorkOf,
  scopeWorkTarget,
  planDispatchWork,
  type DispatchWorkReading,
  type DispatchWorkTarget,
  type DurableRowFacts,
  type OwnerDispatchWork,
} from "../lib/control-plane/expansion/dispatch-work.ts";
import { factChainLines } from "../lib/control-plane/promotion/fact-chain.ts";
import {
  factFreshnessFromPermanentMeetings,
  RESEARCH_CYCLE_MEETINGS_RECEIPT,
  type PermanentMeetingsReceipt,
} from "../lib/control-plane/promotion/fact-freshness.ts";
import { preloadOperationalReferenceBundle } from "../lib/civic-data/operational-references.ts";
import { methodMaturityFrom } from "../lib/control-plane/scheduler/maturity.ts";
import {
  closeAbandonedOccurrences,
  scanOccurrences,
  planRetiredResidue,
  planSupersededRetirement,
  settleRetirements,
  settledRouteTaskIds,
  loadDebts,
  openOccurrence,
  resumeOpenOccurrence,
  persistDebts,
  recordNextDue,
  recordArguedAbsence,
  retireObligationsByPrefix,
  syncObligations,
  type AbandonedOccurrence,
  type SettledOccurrence,
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
import { SCOUT_LOOP_STEP, SCOUT_PREWARM_ROUTE_ID, anthropicTransport, scoutExecutor, scoutPrewarmRequest } from "../lib/control-plane/scheduler/scout-executor.ts";
import { SCOUT_TOOL_SPECS, buildScoutToolkit } from "../lib/control-plane/scheduler/scout-tools.ts";
import { makeScoutSearch } from "../lib/control-plane/scheduler/scout-search.ts";
import type { ArtifactProvenance, InheritedEvidence, PriorRung } from "../lib/control-plane/scheduler/scout-contract.ts";
import { MIN_DISTINCT_RUNGS, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
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
import { candidateStoreCounts, proposeScoutCandidates, readMethodCandidateStore, METHOD_STORE, type ProposalReport } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { emptyFieldManual, type FieldManualStore } from "../lib/control-plane/field-manual.ts";
import {
  compoundingPair,
  fieldManualBriefLines,
  knownRouteIds,
  scoutDiscoveryEntries,
  scoutFieldManualProjection,
  scoutStateHint,
  writeFieldManualDiscoveries,
} from "../lib/control-plane/scheduler/field-manual-scout.ts";
import { readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { readActivationGate } from "../lib/control-plane/promotion/activation-gate.ts";
import { readMethodStore } from "../lib/method/candidate.ts";
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
  compareReaderImpact,
  type DispatchOrdering,
  type OrderingInputs,
  type ResearchMetrics,
} from "../lib/control-plane/research-metrics.ts";
import { researchDigestLines } from "../lib/control-plane/research-digest.ts";
import { PILOT_ZIPS } from "../lib/health/owner-corpus-compile.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import type { AttemptCost } from "../lib/control-plane/attempt.ts";
import { meteredCostFields, priceMeteredUsage, readMeteredUsage } from "../lib/control-plane/model-cost.ts";
import { assertStepMayInvokeModel } from "../lib/control-plane/scheduler/model-routing.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import type { PrewarmOutcome } from "../lib/control-plane/scheduler/shadow-loop.ts";
import type { CacheHitRate } from "../lib/control-plane/research-metrics.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
import type { FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";
import {
  appendFreshnessCycleDigest,
  freshnessCycleOutcomes,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { DIGEST_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import {
  FLEET_SAFETY_BOUNDS,
  FleetSafetyController,
  resolveRollingCeiling,
  scheduledBlackoutAt,
  type ProviderCircuit,
} from "../lib/control-plane/fleet-safety.ts";
import { ADMIN_CONFIG_ID, fleetSpendCeilingOverrideUsd, isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { installNeonCircuitBreaker, readNeonCircuit } from "../lib/control-plane/neon-circuit.ts";
import { retryStartupRead } from "../lib/control-plane/startup-read-retry.ts";
import { modelLaneClosure } from "../lib/control-plane/scheduler/model-lane.ts";
import {
  armExpansionBudget,
  countByScope,
  orderByPlacement,
  withCycleCounts,
} from "../lib/control-plane/expansion/membership.ts";
import type { ExpansionCycleReading } from "../lib/control-plane/expansion/reading.ts";
import { loadExpansionPlan, readCensusUnitTerritories, readTerritoryIndex } from "../lib/control-plane/expansion/runner-load.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { readCodeIdentity } from "../lib/control-plane/code-identity.ts";
import { readMethodCandidateAuthorityStatus } from "../lib/control-plane/method-candidate-authority.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";

const ROOT = process.cwd();
const CONTROL_PLANE_ROOT = join(ROOT, ".runtime", "control-plane", "freshness-shadow");
const RUNS_DIR = join(ROOT, ".runtime", "freshness-shadow-runs");
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
let crashRepos: ControlPlaneRepositories | null = null;
async function recordCrash(error: unknown): Promise<void> {
  if (crashRecorded) return;
  crashRecorded = true;
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const headline = message.split("\n")[0];
  const finishedAt = new Date().toISOString();
  const cycleId = `freshness-cycle:${HOST}:${NOW}`;
  if (crashRepos !== null) {
    try {
      await appendFreshnessCycleDigest(crashRepos, {
        outcome: {
          kind: "FRESHNESS_CYCLE",
          state: "FAILED",
          cycleId,
          startedAt: NOW,
          finishedAt,
          testedSha: headSha(ROOT),
          host: HOST,
          provider: crashRepos.describe(),
          durable: crashRepos.durable,
          executor: null,
          registry: null,
          obligations: null,
          occurrencesOpened: null,
          debtInherited: null,
          debtPersisted: null,
          debtCleared: null,
          scheduled: null,
          unscheduled: [],
          dueCount: null,
          dispatched: null,
          worked: [],
          dispositions: [],
          dispatchDetails: [],
          research: null,
          deferred: null,
          debts: null,
          incidents: [],
          risk: null,
          health: null,
          promotedToReaderTruth: false,
          failure: { code: "CYCLE_CRASHED", detail: message },
        },
        lines: [
          "PILOT HEALTH",
          "  the cycle CRASHED before completing — a failed cycle, never an idle one",
          `      ${headline}`,
          "  ROLLUP    NOT GREEN — the cycle did not finish",
        ],
      });
      console.error(`\n  canonical outcome: ${cycleId}`);
    } catch (recordError) {
      console.error(
        `\n  freshness:shadow CRASHED and the canonical outcome append failed (${recordError instanceof Error ? recordError.message : String(recordError)}).`,
      );
    }
  }
  try {
    mkdirSync(RUNS_DIR, { recursive: true });
    const path = nextRunRecordPath(RUNS_DIR, today());
    writeFileSync(
      path,
      `${JSON.stringify(
        {
          startedAt: NOW,
          finishedAt,
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
    console.log(`  local diagnostic: ${path}`);
  } catch (writeError) {
    console.error(
      `\n  freshness:shadow CRASHED and could not write a run record (${
        writeError instanceof Error ? writeError.message : String(writeError)
      }): ${headline}`,
    );
  }
  process.exit(1);
}
process.on("uncaughtException", (error) => { void recordCrash(error); });
process.on("unhandledRejection", (error) => { void recordCrash(error); });

const argv = process.argv.slice(2);
const wantsPostgres = argv.includes("--provider=postgres");
if (wantsPostgres) {
  assertRuntimeAuthority({ capabilities: ["RESEARCH_CYCLE"] });
}
const dry = argv.includes("--dry");
const noModel = argv.includes("--no-model");
const canary = argv.includes("--canary");
const boundedNumber = (raw: string | undefined, fallback: number, maximum: number): number => {
  const parsed = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
};
/*
 * `--max=` and `--scout-max=` are DIAGNOSTIC overrides for proof runs (one or a
 * few units at a time). There is NO per-cycle dispatch or Scout ceiling by
 * default: the cycle wall and the rolling daily spend ceiling are the only
 * limits, and each lane opens work in step with what it can dispatch before the
 * wall. A canary is pinned to one of each.
 */
const ceilingArg = argv.find((a) => a.startsWith("--max="));
const MAX_DISPATCHES = canary
  ? 1
  : boundedNumber(ceilingArg?.slice("--max=".length), Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
const scoutMaxArg = argv.find((a) => a.startsWith("--scout-max="));
const SCOUT_MAX = boundedNumber(
  scoutMaxArg?.slice("--scout-max=".length),
  canary ? 1 : Number.POSITIVE_INFINITY,
  canary ? 1 : Number.POSITIVE_INFINITY,
);
/* A dispatch's worst-case model reserve, used only to PAUSE the scout lane before
   the rolling ceiling rather than admit scouts the per-request guard then refuses
   in a busy-loop. Sized a little above the observed ~$0.45/attempt so the lane
   pauses once it could not afford even one scout. */
const SCOUT_WORST_CASE_USD = 0.6;
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
  // Bound EACH Neon connect/query attempt (2026-09-22). Without this, the
  // bootstrap connect-retry (052b26e8) re-established a faulting TLS handshake
  // with no per-attempt deadline, driving Node 24 into a native OpenSSL
  // (X509) stack overflow at cycle start — the ~2-day cycle crash-loop that
  // read as "0 providers / 0 units". connect-retry.ts's header names this as
  // the required composition; routine-civic-data-runner already installs it,
  // and freshness-shadow was the lone Neon caller missing it. A bounded
  // attempt aborts a hung/faulting connect into a retryable transient, and a
  // persistent failure then fails FAST (clean exit) instead of crashing.
  installNeonRequestDeadline();
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
const cycleObservation = observeCyclePhases(repos);
repos = cycleObservation.repos;
crashRepos = repos;
const finishPhase = (name: string) => {
  const phase = cycleObservation.finish(name);
  console.log(`  phase ${phase.name}: ${phase.durationMs}ms; ${phase.repositoryCalls} repository calls`);
};

/*
 * Both startup authority reads are idempotent, and one failed read must not
 * cost the hour: on 2026-09-22 at 21:34:53Z a single STORE_READ_FAILED on the
 * operational reference crashed the cycle 17 s in, and the store answered
 * again minutes later. A failed read is re-read within the connect-retry
 * bounds, never while the Neon circuit is latched; a persistent failure still
 * reaches the named failure below unchanged.
 */
const startupReadRetry = {
  circuitLatched: () => readNeonCircuit(ROOT, nowIso()) !== null,
  onRetry: ({ attempt, delayMs, error }: { readonly attempt: number; readonly delayMs: number; readonly error: unknown }) =>
    console.error(
      `freshness:shadow · startup read retry ${attempt} in ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`,
    ),
};

if (wantsPostgres) {
  const methodAuthority = await retryStartupRead(
    () => readMethodCandidateAuthorityStatus(repos),
    (status) => (status.state === "STORE_UNREACHABLE" ? status.detail : null),
    startupReadRetry,
  );
  if (methodAuthority.state !== "ADOPTED") {
    throw new Error(
      `METHOD_CANDIDATE_AUTHORITY_NOT_ADOPTED: ${methodAuthority.code} — ${methodAuthority.detail} ` +
        "No Scout candidate write or tracked-file fallback was attempted.",
    );
  }
}

/*
 * The standing obligation registry consumes the same proof-validated runtime
 * authority as Admin. A missing/unreachable pointer is a named failed cycle;
 * the retired tracked jurisdiction projections are never a silent fallback.
 */
await retryStartupRead(
  () => preloadOperationalReferenceBundle({ bypassCache: true }),
  () => null,
  startupReadRetry,
);
await preloadCandidateEnrichmentAuthorities();

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
 * FOUR RESEARCH PROVIDERS. (Session C3, lane C, 2026-09-01. RULING 229.)
 * `local-jurisdictions`
 * gives every named filing officer and election custodian a clock, and
 * `candidate-enrichment` makes campaign sites, positions, bios, photos and
 * contact standing obligations against each state's CANONICAL CANDIDATE
 * ACQUISITION DENOMINATOR — labelled by `lib/candidates/population-label.ts`,
 * never assumed statewide (R-C9).
 */
/*
 * PDC permanently removed the former tracked-snapshot meetings provider and
 * the fact-shaped `meeting-times` / `agendas` acquisition providers. The
 * SOURCE_WIRING-derived meeting-partition contracts own that acquisition, clock,
 * promotion and LKG in the production civic-data store. The worker pipeline
 * may still project immutable evidence into a fail-closed receipt; it may not
 * open the same official feeds on a parallel schedule.
 */
/*
 * THE TRACKED STATES AND THE OWNER'S MATERIALIZED WORK, read before the
 * registry is built (MW-028, 2026-09-23).
 *
 * Which states' registry work stands is DATA: the coverage set. Until the
 * redesign's promoted coverage-set accessor is on main, the interim source is
 * the promoted operational-reference bundle this cycle just preloaded — a state
 * is tracked when its registry is promoted. When the accessor lands, await it
 * here and hand `trackedStatesFrom(set.states, set.source)` to both providers.
 *
 * The obligations the owner's dispatch materialized are read back by their
 * mark (one bounded query, only those rows), so the two providers that own them
 * keep them in the corpus: scheduled, and never mistaken for rows the registry
 * stopped emitting. A read that fails is named on both providers, which holds
 * their retirement for the cycle rather than retiring the owner's work.
 */
const trackedStates = trackedStatesFromOperationalReference();
let materialized: MaterializedReading;
try {
  const rows = await repos.obligations.listWhere(["materializedBy"], OWNER_DISPATCH);
  materialized = { ids: new Set(rows.map((row) => row.id)) };
} catch (error) {
  materialized = { unreadable: error instanceof Error ? error.message : String(error) };
}
const registry = buildRegistry(
  [
    campaignFinanceProvider(),
    trackerIntakeProvider(),
    localJurisdictionsProvider({ trackedStates, materialized: () => materialized, meetingPartitions: UNREAD_MEETING_PARTITIONS }),
    candidateEnrichmentProvider({ trackedStates }),
    meetingsDiscoveryProvider({ materialized: () => materialized }),
  ],
  { root: ROOT, nowIso: NOW },
);
const trackedReading = trackedStates.read();
const trackedStateCodes: readonly string[] = "states" in trackedReading ? trackedReading.states : [];

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

/* ------------------------------------- retire the superseded meetings clock --- */

const LEGACY_MEETINGS_OBLIGATION_PREFIX = "freshness:meetings:";
const LEGACY_MEETINGS_RETIREMENT_REASON =
  "PDC authority transferred to the matching source/body production meeting-partition contract";
const meetingsRetirement = await retireObligationsByPrefix(
  repos,
  [LEGACY_MEETINGS_OBLIGATION_PREFIX],
  NOW,
  LEGACY_MEETINGS_RETIREMENT_REASON,
);
console.log(
  `  legacy tracked-snapshot meetings clocks: ${meetingsRetirement.retired.length} retired this cycle; ` +
    `${meetingsRetirement.alreadyRetired.length} already inactive with no next-due`,
);
const factClockRetirement = await retireObligationsByPrefix(
  repos,
  ["freshness:meeting-times:", "freshness:agendas:"],
  NOW,
  "PDC authority transferred meeting and agenda acquisition to source/body production meeting-partition contracts",
);
console.log(
  `  legacy parallel meeting-fact clocks: ${factClockRetirement.retired.length} retired this cycle; ` +
    `${factClockRetirement.alreadyRetired.length} already inactive with no next-due`,
);
const LEGACY_FEC_MODEL_OBLIGATION_PREFIX =
  "freshness:campaign-finance:ballot-az-pima:us-house-6#";
const fecModelRetirement = await retireObligationsByPrefix(
  repos,
  [LEGACY_FEC_MODEL_OBLIGATION_PREFIX],
  NOW,
  "PDC authority transferred federal acquisition to the FEC_FUNDING / federal-supported production civic-data contract",
);
console.log(
  `  legacy parallel federal campaign-finance clocks: ${fecModelRetirement.retired.length} retired this cycle; ` +
    `${fecModelRetirement.alreadyRetired.length} already inactive with no next-due`,
);

const sync = await syncObligations(repos, corpus, NOW, { exactReads: canary });
finishPhase("references-and-registration");
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
let canonicalCandidateCounts = await candidateStoreCounts(repos);
if (canonicalCandidateCounts === null) {
  runtimeConditions.push("METHOD_CANDIDATE_STORE_NOT_SEEDED: canonical candidate lifecycle is unavailable; no tracked-file fallback was used");
}

/*
 * **WHAT THE REGISTRY NO LONGER EMITS IS RETIRED, AND A RETIRED ROW HOLDS
 * NOTHING OPEN.** (2026-09-23.)
 *
 * Two planners over the rows `syncObligations` read outside the corpus, and
 * one apply (`settleRetirements`):
 *
 * - **A row the registry stopped emitting** is retired only when its provider
 *   read cleanly and the drop stays inside the bound
 *   (`planSupersededRetirement`). Otherwise it is held back by name.
 * - **An already-retired row that still points at an open occurrence** has that
 *   occurrence closed (`planRetiredResidue`).
 *
 * Each open occurrence closes unresolved, never with a disposition, and a
 * retired row's debt is tombstoned as retired by `persistDebts`. The judgement
 * is always made against the FULL registry, never a filtered one. Only a full
 * standing cycle writes; a --dry, --canary, --only/--ids or blackout cycle
 * prints the plan and writes nothing. A failure is named in the digest and the
 * run record, and the cycle continues: the rows stay as they were and are
 * planned again next cycle.
 */
const retirementWrites = !dry && !canary && !scheduledBlackout;
const retirementOutside = sync.outside !== null && ONLY === null && IDS === null ? sync.outside : null;
const residueItems = retirementOutside === null ? [] : planRetiredResidue(retirementOutside);
const supersededPlan =
  retirementOutside === null
    ? null
    : planSupersededRetirement({
        outside: retirementOutside,
        corpus: allUnits.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id })),
        providers: registry.byProvider,
      });
const supersededHolds = (supersededPlan?.heldBack ?? []).reduce<Record<string, number>>(
  (m, h) => ((m[h.code] = (m[h.code] ?? 0) + 1), m),
  {},
);
let retirementApplied: Awaited<ReturnType<typeof settleRetirements>> | null = null;
let retirementError: string | null = null;
/** Retired obligations, id → reason: their debt stays out of the cycle and is tombstoned as retired. */
const retiredDebtReasons = new Map<string, string>();
if (supersededPlan !== null && retirementOutside !== null) {
  const items = [...residueItems, ...supersededPlan.retire];
  console.log(
    `  retirement: ${supersededPlan.retire.length} superseded, ${residueItems.length} retired row(s) still holding an occurrence` +
      (supersededPlan.heldBack.length > 0 ? `; held back ${JSON.stringify(supersededHolds)}` : "") +
      (retirementWrites ? "" : " (plan only: this cycle writes nothing)"),
  );
  if (retirementWrites) {
    if (items.length > 0) {
      try {
        retirementApplied = await settleRetirements(repos, { items, now: NOW });
        console.log(
          `  retirement: ${retirementApplied.retired.length} obligation(s) retired, ` +
            `${retirementApplied.occurrencesClosed.length} open occurrence(s) closed unresolved` +
            (retirementApplied.failed.length > 0 ? `, ${retirementApplied.failed.length} did not complete and are planned again` : ""),
        );
      } catch (error) {
        retirementError = error instanceof Error ? error.message : String(error);
        console.error(`  retirement could not run (${retirementError}); the rows are planned again next cycle`);
      }
    }
    for (const row of retirementOutside) {
      if (!row.active) retiredDebtReasons.set(row.id, row.retirementReason ?? "RETIRED: this obligation was retired");
    }
    const reasonOf = new Map(items.map((item) => [item.obligationId, item.reason]));
    for (const id of retirementApplied?.retired ?? []) retiredDebtReasons.set(id, reasonOf.get(id) ?? "RETIRED");
  }
}
finishPhase("retirement");
const occurrenceByObligation = new Map<string, { id: string; routeTaskId: string }>();
const nextDueByObligation = new Map<string, string>();
let openedDeterministic = 0;
let openedModel = 0;
/** Occurrences a previous cycle opened and did not reach, picked back up. */
let resumedCount = 0;
/** Obligations whose open/resume threw and were isolated. Never silent. */
const preOpenSkipped: { obligationId: string; why: string }[] = [];
const dueThisCycle: { obligation: (typeof sync.all)[number]; nextDueAt: string }[] = [];

/* A retired obligation owes no freshness: its debt stays out of the cycle, and `persistDebts` tombstones it as retired (2026-09-23). */
const debtsIn = (canary
  ? (await Promise.all(corpus.map((obligation) => repos.debts.read(obligation.id))))
      .filter((row) => row !== null)
      .map((row) => row.value)
  : await loadDebts(repos)
).filter((debt) => !retiredDebtReasons.has(debt.obligationId));
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
 * dispatcher itself applies. Nothing else changes in the ORDER: not the
 * ceilings, not the budget, not per-host spacing, not a debt backoff. What the
 * target is MISSING is created further down, by the MW-028 step, from the
 * registry's own requirement definitions (`dispatch-work.ts`), and the HONORED
 * record is appended after that step so it carries both counts. A target that
 * matches nothing registered is honored with a sentence naming the missing
 * registry, never with a manufactured unit.
 */
interface OwnerDispatchRecord {
  readonly intentId: string;
  readonly target: string;
  readonly states: readonly string[];
  readonly matched: number;
  readonly registered: number;
  /** MW-028: filled after the creation step, so the record carries what the DISPATCH created. */
  readonly work?: OwnerDispatchWork | null;
}
const ownerDispatches: OwnerDispatchRecord[] = [];
const honoredDispatch: string[] = [];
const dispatchPriority = new Set<string>();
/** The DISPATCH intents this cycle reads, with the matching sentence each HONORED record opens with. */
const dispatchDetails: { readonly intent: ResearchIntentRequest; readonly detail: string }[] = [];
for (const pending of intents.pendingDispatch) {
  const target = parseDispatchTarget(pending.note ?? "");
  const matched = allUnits.filter((u) =>
    unitMatchesTarget(target, { id: u.obligation.id, subjectId: u.obligation.subjectId }),
  );
  const matchedIds = new Set(matched.map((u) => u.obligation.id));
  for (const id of matchedIds) dispatchPriority.add(id);
  const dueAmongMatched = dueThisCycle.filter((d) => matchedIds.has(d.obligation.id)).length;
  const detail = describeDispatchMatch(target, matched.length, allUnits.length, trackedStateCodes);
  ownerDispatches.push({
    intentId: pending.intentId,
    target: target.text,
    states: [...target.states],
    matched: matched.length,
    registered: allUnits.length,
  });
  dispatchDetails.push({ intent: pending, detail });
  if (scheduledBlackout) {
    console.log("  owner dispatch: SCHEDULED BLACKOUT; intent remains pending for the next eligible cycle.");
  }
  console.log(
    `  owner dispatch: ${detail}` +
      (matched.length > 0 ? ` ${dueAmongMatched} of the ${matched.length} are due this cycle; the rest keep their next-due.` : ""),
  );
}

/*
 * **THE OWNER'S EXPANSION SCOPES — STANDING PRIORITY.** (Expansion controls,
 * 2026-09-23; `lib/control-plane/expansion/membership.ts`.)
 *
 * Read once, here, before any order is decided. After the owner's DISPATCH,
 * due work whose government lies in a selected scope (its territory overlaps
 * the scope's ZCTAs) goes first: in the Scout lane by scope priority, 1 first;
 * in the plain-code lane every selected scope together, because the
 * dispatcher's `placeFirst` is a set — and a cycle with a pending DISPATCH
 * orders that lane by the DISPATCH alone, so ADM-8 still holds. The ORDER
 * never adds, skips or makes due a row, and never opens the paid lane; what a
 * scope is missing is created by the MW-028 step below, bounded and counted.
 */
/*
 * The promoted registries, read through the one accessor the standing providers
 * use (MW-028): the territory index, the scope placement and the work a Send
 * creates all see exactly the registries the providers can keep in the corpus.
 * A registry the reader refuses is named, never used.
 */
const promoted = promotedRegistries();
if ("refused" in promoted) {
  for (const [state, why] of promoted.refused) {
    runtimeConditions.push(`the promoted ${state.toUpperCase()} jurisdiction registry is not read by this runtime (${why}); nothing it defines is placed or created`);
  }
}
const expansionLoad = await loadExpansionPlan({
  repos,
  root: ROOT,
  now: NOW,
  obligations: sync.all.map((o) => ({ id: o.id, subjectId: o.subjectId })),
  ...("registries" in promoted ? { loadTerritory: () => readTerritoryIndex(ROOT, [...promoted.registries.values()]) } : {}),
});
runtimeConditions.push(...expansionLoad.conditions);
const expansionPlan = expansionLoad.plan;
const subjectByObligation = new Map(sync.all.map((o) => [o.id, o.subjectId]));
/** 0 = the owner's DISPATCH; 1 + n = the n-th selected scope in run order; null = neither. */
const placementRank = (obligationId: string): number | null => {
  if (dispatchPriority.has(obligationId)) return 0;
  const subject = subjectByObligation.get(obligationId);
  const at = subject === undefined || expansionPlan === null ? null : expansionPlan.placementOf(subject);
  return at === null ? null : 1 + at;
};
/** The dispatcher's first rows when NO DISPATCH is pending: every selected scope's work. Null otherwise, so a DISPATCH keeps both lanes. */
const scopePlaceFirst: ReadonlySet<string> | null =
  dispatchPriority.size > 0 || expansionPlan === null
    ? null
    : new Set(sync.all.filter((o) => expansionPlan.placedSubjects.has(o.subjectId)).map((o) => o.id));
if (expansionPlan !== null) {
  console.log(`  expansion scopes: ${expansionPlan.scopes.length} selected (${expansionPlan.reading.lookup.source} Census geography)`);
  for (const scope of expansionPlan.scopes) {
    console.log(
      `      priority ${scope.decision.priority}  ${scope.decision.geography.label}  budget $${scope.decision.budgetUsd.toFixed(2)}  ` +
        (scope.kind === "RESOLVED" ? `${scope.zctas.size} ZCTA(s), ${scope.members.size} registered government(s) with work` : `NOT RESOLVED — ${scope.why}`),
    );
  }
}

/* OLDEST FIRST for the deterministic lane, which is the dispatcher's own order — behind the owner's dispatch. */
dueThisCycle.sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));
const dueOrdered = expansionPlan === null
  ? placeFirstRows(dueThisCycle, dispatchPriority)
  : orderByPlacement(dueThisCycle, (d) => placementRank(d.obligation.id));
const dueModel = dueOrdered.filter((d) => decisionFor(d.obligation.id, d.obligation.routeId).kind === "BOUNDED_MODEL_WORKER");
const dueDeterministicRows = dueOrdered.filter((d) => !dueModel.includes(d));
const dueDeterministic = dueDeterministicRows.length;

/*
 * **READER IMPACT FIRST for the Scout lane.** (Work Item 5, 2026-09-02.
 * RULING 229.) Oldest-first answered what had waited longest; the Scout
 * ceiling is three a cycle, so WHICH three matters. Band 1 feeds a pilot
 * surface, band 2 completes a source universe, band 3 is the tail; oldest due
 * first within a band. Runtime reader impact is the obligation's canonical
 * `readerImpactAt`; the installed release's pilot ZIP list is configuration.
 *
 * The retired implementation also selected the newest tracked
 * `reader-suite-runs/*` output and joined it to `reader-questions.json`. That
 * made a local software test (or a Git mutation of its output/corpus) change
 * the standing data-plane order. It is deleted rather than replaced with a
 * second ledger: canonical obligations already carry explicit reader impact,
 * and software-suite outcomes remain software CI evidence.
 */
const orderingInputs: OrderingInputs = {
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
/* The owner's dispatch goes ahead of the bands (ADM-8); within each group the band order stands. With expansion scopes selected, the same
   DISPATCH-first order continues scope by scope (priority 1 first) before the rest. */
const scoutOrder = expansionPlan === null
  ? [
      ...modelOrder.ordered.filter((b) => dispatchPriority.has(b.row.id)),
      ...modelOrder.ordered.filter((b) => !dispatchPriority.has(b.row.id)),
    ]
  : orderByPlacement(modelOrder.ordered, (b) => placementRank(b.row.id));
const compareScoutRows = (left: ScheduledObligation, right: ScheduledObligation): number => {
  const leftRank = placementRank(left.obligation.id) ?? Number.POSITIVE_INFINITY;
  const rightRank = placementRank(right.obligation.id) ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  const orderable = (row: ScheduledObligation) => ({
    id: row.obligation.id,
    subjectId: row.obligation.subjectId,
    readerImpactAt: row.obligation.readerImpactAt,
    providerId: registry.providerOf(row.obligation.id),
    nextDueAt: row.nextDueAt,
  });
  return compareReaderImpact(orderable(left), orderable(right), orderingInputs);
};
if (!dry && !canary && !scheduledBlackout && !intents.runnerPause.paused) {
  try {
    const retained = await retainRecentRoutineMeetingEvidence({ repos,
      store: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)),
      methodVersion: readMethodStore(join(ROOT, ...METHOD_STORE)).version, now: nowIso });
    console.log(`  permanent meeting captures retained for independent workers: ${retained.length}`);
  } catch (error) {
    runtimeConditions.push(`permanent meeting evidence could not enter independent workers: ${error instanceof Error ? error.message : "ROUTINE_MEETING_INTAKE_FAILED"}`);
  }
}
const plannedWork = canary || scheduledBlackout ? [] : (await repos.workItems.list()).filter(item =>
  item.value.autonomousPlan && !isRetiredRoutineMeetingAcquisition(item.value.autonomousPlan.contract)
);
// A held Parser/Validator chain has no autonomous acquisition plan. Its next
// stage is enqueued by advanceHeldWorkerFleet, so completed producer tasks also
// reserve downstream time until that pass can inspect their retained evidence.
const [heldWorkIds, settledTaskIds, neverClaimedTaskIds] = await (async () => {
  const listing = canary || scheduledBlackout ? [] : await repos.routeTasks.list();
  return [
    new Set(listing
      .filter(row => row.value.workerTask?.contract.schemaVersion === 1 &&
        (row.value.state === "PENDING" || row.value.state === "RECLAIMABLE" ||
          (row.value.state === "RESULT_RECORDED" && row.value.workerTask.role !== "ADVERSARIAL_AUDITOR")))
      .map(row => row.value.workItemId)),
    /* The same read names the settled RouteTasks the pre-dispatch recovery starts from (2026-09-23). Only ids outlive it. */
    settledRouteTaskIds(listing),
    /* And the freshness RouteTasks never claimed, which an abandoned occurrence must sit on (2026-09-23). */
    new Set(listing.filter(row => row.value.state === "PENDING" && !row.value.workerTask).map(row => row.id)),
  ] as const;
})();
const downstreamWorkCount = plannedWork.length + heldWorkIds.size;
finishPhase("schedule-and-intents");
if (dispatchOrdering !== null) {
  console.log(
    `  Scout lane order: band 1 ${dispatchOrdering.bands[1]} · band 2 ${dispatchOrdering.bands[2]} · band 3 ${dispatchOrdering.bands[3]} of ${dueModel.length} due model-class ` +
      `(canonical obligation reader impact plus release-pinned pilot jurisdictions)` +
      (dispatchPriority.size > 0 ? ` · owner dispatch first: ${scoutOrder.filter((b) => dispatchPriority.has(b.row.id)).length} of them` : ""),
  );
  for (const b of scoutOrder.slice(0, 12)) {
    const rank = placementRank(b.row.id);
    console.log(`      ${rank === 0 ? "DISPATCH" : rank !== null ? `SCOPE ${rank}` : `band ${b.band}`}  ${b.row.id}  — ${b.why}`);
  }
}

/*
 * **OPEN IN STEP WITH DISPATCH (2026-09-18).** Nothing is pre-opened. Each lane
 * calls this the moment it is about to dispatch a row — after the wall and
 * admission gates have passed — so the runner opens exactly what it can
 * dispatch before the wall, never the whole backlog, and there is no per-cycle
 * open ceiling to size. A resume picks up an occurrence an earlier cycle opened
 * and did not reach; a fresh open otherwise. A throw is isolated by name and the
 * row keeps its next-due. Returns whether the occurrence is now open — or, when
 * the open occurrence's route was already disposed by a cycle that ended before
 * closing it, `{ settled }`, and the cycle recovers it without dispatching.
 */
const standingById = new Map(sync.all.map((o) => [o.id, o]));
const openOccurrenceInStep = async (
  row: ScheduledObligation,
): Promise<boolean | { readonly settled: SettledOccurrence }> => {
  const id = row.obligation.id;
  if (occurrenceByObligation.has(id)) return true;
  if (scheduledBlackout) return false;
  // The dispatcher hands a FreshnessObligation; opening needs the fuller
  // StandingObligation (occurrence count, open-occurrence id), looked up by id.
  const obligation = standingById.get(id);
  if (obligation === undefined) return false;
  try {
    const resumed = await resumeOpenOccurrence(repos, obligation);
    if (resumed?.kind === "SETTLED") {
      /* The model lane admits a row before opening it; a recovery runs no Scout, so it hands its admission back. */
      if (decisionFor(id, obligation.routeId).kind === "BOUNDED_MODEL_WORKER") {
        openedModel += 1;
        scoutsAdmittedThisCycle = Math.max(0, scoutsAdmittedThisCycle - 1);
      } else openedDeterministic += 1;
      return { settled: resumed.settled };
    }
    if (resumed !== null) {
      occurrenceByObligation.set(id, { id: resumed.id, routeTaskId: resumed.routeTaskId });
      resumedCount += 1;
    } else {
      const occ = await openOccurrence(repos, { obligation, dueAt: row.nextDueAt, now: NOW });
      if (occ === null) return false;
      occurrenceByObligation.set(id, { id: occ.occurrence.id, routeTaskId: occ.routeTask.id });
    }
    if (decisionFor(id, obligation.routeId).kind === "BOUNDED_MODEL_WORKER") openedModel += 1;
    else openedDeterministic += 1;
    return true;
  } catch (error) {
    preOpenSkipped.push({ obligationId: id, why: error instanceof Error ? error.message : String(error) });
    return false;
  }
};
finishPhase("open-occurrences");

/* -------------------------------------------------- LEVEL 1 — RESEARCH --- */

/* The credential, BY NAME. Its value goes into the transport and nowhere else. */
const workerKey = (process.env[WORKER_CREDENTIAL_VAR] ?? "").trim();
const credentialConfigured = workerKey.length > 0;

/* Compliant search-index discovery (RULING 248: find every avenue). Null when
   neither BRAVE_SEARCH_API_KEY nor EXA_API_KEY is set — the `search` tool is
   then left out of the toolkit entirely and the lane behaves exactly as before.
   Pointers only: the model still opens each hit with fetch_public/browse, which
   enforce robots and vault. */
const scoutSearch = makeScoutSearch({
  braveKey: process.env.BRAVE_SEARCH_API_KEY,
  exaKey: process.env.EXA_API_KEY,
});
if (scoutSearch !== null) {
  console.log(
    `  scout search: ENABLED (${[process.env.BRAVE_SEARCH_API_KEY ? "brave" : null, process.env.EXA_API_KEY ? "exa" : null].filter(Boolean).join("+")}) — pointers only, robots enforced downstream`,
  );
}

/* The intent log was read, and RUN_CYCLE_NOW / DISPATCH honored, above the
   lane ordering — a DISPATCH has to reorder before anything is opened. */

/* One ordered answer for why the model lane is closed (model-lane.ts). It also
   closes the lane while no delivery path is open: with promotion off, paid
   Scout and auditor output could only accumulate unread (owner, 2026-09-22). */
const laneClosure = modelLaneClosure({
  scheduledBlackout,
  dry,
  noModel,
  credentialConfigured,
  credentialVar: WORKER_CREDENTIAL_VAR,
  activation: readActivationGate(ROOT),
  paused: intents.paused,
  pauseIntentId: intents.pauseIntentId ?? null,
});
const laneDisabledCode = laneClosure?.code ?? null;
const laneDisabledReason = laneClosure?.reason ?? null;
const modelLaneEnabled = laneClosure === null;

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
let finalSpendWindow: ReturnType<typeof researchSpendInWindow> | null = null;
let finalSpendAsOf: string | null = null;
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
/*
 * THE ROLLING CEILING IN FORCE — the owner's console override, read at cycle
 * start from the control plane (`AdminConfig.fleetSpendCeiling`), or the built-in
 * fallback when no override stands or the row cannot be read. Read HERE, not at
 * module import, so a change Sean makes in the console governs this very cycle
 * with no deploy and no restart. One number drives BOTH scout-admission gates —
 * the FleetSafety rolling ceiling (`rollingCeilingReached`, which admitScout
 * reads) and the research daily ceiling (`ceilingPermits`) — and the per-request
 * reservation through the controller's bounds, so a lane paused at the old
 * ceiling resumes on this cycle and there is no second ceiling that silently
 * binds when the dial is raised.
 */
let ceilingOverrideUsd: number | null = null;
try {
  const cfg = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  ceilingOverrideUsd = cfg !== null && isAdminConfig(cfg.value) ? fleetSpendCeilingOverrideUsd(cfg.value) : null;
} catch (error) {
  runtimeConditions.push(
    `the Fleet spend-ceiling override could not be read (${error instanceof Error ? error.message : String(error)}); the built-in fallback $${FLEET_SAFETY_BOUNDS.rolling24HourModelUsd.toFixed(2)} governs this cycle`,
  );
}
const rollingCeiling = resolveRollingCeiling(ceilingOverrideUsd);
const effectiveCeilingUsd = rollingCeiling.rollingCeilingUsd;

const fleetSafety = new FleetSafetyController({
  now: NOW,
  costs: costLedger,
  costLedgerReadable: ledgerUnreadable === null,
  paused: intents.runnerPause.paused,
  circuits: priorCircuits,
  lastSuccessfulActivity: priorLastSuccessfulActivity,
  rollingCeilingUsd: effectiveCeilingUsd,
});
if (ledgerUnreadable !== null) {
  fleetSafety.defer("all model-backed Fleet work", "UNMEASURED_MODEL_SPEND", `the canonical cost ledger could not be read: ${ledgerUnreadable}`);
}

/*
 * THE EXPANSION-SCOPE BUDGETS, armed from the same ledger the Fleet ceiling
 * reads. Restrict-only: `admitScout` consults the gate AFTER every Fleet gate,
 * so a scope can hold a Scout back and can never admit one the Fleet refused.
 * An unreadable ledger arms every budgeted scope to hold its paid work.
 */
const expansionBudget = expansionPlan === null
  ? null
  : armExpansionBudget(expansionPlan, { now: NOW, costs: ledgerUnreadable === null ? costLedger : null, worstCaseUsd: SCOUT_WORST_CASE_USD });
let expansionReading: ExpansionCycleReading | null = expansionBudget === null || expansionPlan === null
  ? null
  : withCycleCounts(expansionBudget.reading, {
      dueByScope: countByScope(expansionPlan, dueThisCycle.map((d) => d.obligation.subjectId)),
      scoutPlacedFirstByScope: countByScope(
        expansionPlan,
        scoutOrder.filter((b) => (placementRank(b.row.id) ?? 0) > 0).map((b) => subjectByObligation.get(b.row.id) ?? ""),
      ),
      gate: null,
    });

/*
 * **MW-028 — WHERE THE OWNER SENT THE FLEET, THE MISSING WORK IS CREATED.**
 * (2026-09-23; `lib/control-plane/expansion/dispatch-work.ts` carries the
 * design note.)
 *
 * The targets: this cycle's DISPATCH intents, the DISPATCH targets an earlier
 * cycle left with work still owed, and every selected expansion scope. For each
 * government in them, every requirement the promoted registry defines that no
 * clock carries is written as a standing obligation, marked OWNER_DISPATCH, at
 * most DISPATCH_WORK_WRITE_BUDGET rows this cycle and DISPATCH_WORK_TARGET_CAP
 * for one target; the rest is deferred and counted. The new rows join the
 * corpus next cycle through their providers. Nothing here calls a model,
 * appends an intent, or reads a ceiling it could raise: created model-class
 * work waits behind the same lane, the same Fleet ceiling and the same scope
 * budgets as every other row. Only a full standing cycle writes.
 */
const dispatchWorkWrites = !dry && !canary && ONLY === null && IDS === null && !scheduledBlackout && !intents.runnerPause.paused;
const dispatchWorkPlanOnlyWhy = dispatchWorkWrites
  ? null
  : dry
    ? "--dry writes nothing"
    : canary
      ? "a canary cycle writes only its one obligation"
      : ONLY !== null || IDS !== null
        ? "a filtered diagnostic cycle writes nothing it did not look at"
        : scheduledBlackout
          ? "the scheduled blackout"
          : "the owner has paused the runner";
const dispatchTargets: DispatchWorkTarget[] = [];
{
  const seen = new Set<string>();
  const add = (t: DispatchWorkTarget): void => {
    if (seen.has(t.key)) return;
    seen.add(t.key);
    dispatchTargets.push(t);
  };
  for (const { intent } of dispatchDetails) add(dispatchWorkTarget({ intentId: intent.intentId, note: intent.note ?? "", requestedAt: intent.requestedAt }));
  for (const t of carriedDispatchTargets(priorResearchState?.dispatchWork ?? null)) add(t);
  for (const scope of expansionPlan?.scopes ?? []) add(scopeWorkTarget(scope));
}
let dispatchWork: DispatchWorkReading | null = null;
if (dispatchTargets.length > 0) {
  try {
    if ("unreadable" in promoted) throw new Error(`the promoted jurisdiction registries could not be read (${promoted.unreadable})`);
    const registries = promoted.registries;
    let censusUnitsByState: Map<string, number> | null = null;
    if (dispatchTargets.some((t) => t.kind === "DISPATCH" && t.target.states.some((s) => !registries.has(s)))) {
      try {
        censusUnitsByState = new Map<string, number>();
        for (const unit of readCensusUnitTerritories(ROOT)) {
          const state = unit.state.toUpperCase();
          censusUnitsByState.set(state, (censusUnitsByState.get(state) ?? 0) + 1);
        }
      } catch {
        censusUnitsByState = null;
      }
    }
    const durable = new Map<string, DurableRowFacts>();
    for (const row of [...sync.all, ...(sync.outside ?? [])]) durable.set(row.id, { active: row.active, materializedBy: row.materializedBy });
    const plan = planDispatchWork({
      targets: dispatchTargets,
      world: {
        registries,
        territory: expansionLoad.territory ?? null,
        territoryDetail: expansionLoad.territoryDetail ?? null,
        corpus: allUnits.map((u) => ({ id: u.obligation.id, subjectId: u.obligation.subjectId })),
        durable,
        meetingPartitions: UNREAD_MEETING_PARTITIONS,
        censusUnitsByState,
        refusedRegistries: promoted.refused,
      },
    });
    const applied = dispatchWorkWrites
      ? await applyDispatchWork(repos, plan, { now: NOW, deadlineReached: () => Date.now() + 150_000 >= DISPATCH_DEADLINE_MS })
      : null;
    dispatchWork = dispatchWorkReading(plan, applied, {
      at: NOW,
      modelLaneClosed: laneDisabledReason,
      ceilingUsd: effectiveCeilingUsd,
      ceilingSource: rollingCeiling.source,
      writes: dispatchWorkWrites ? "APPLIED" : "PLAN_ONLY",
      planOnlyWhy: dispatchWorkPlanOnlyWhy,
    });
    console.log(
      `  dispatch work: ${dispatchWork.targets.length} target(s); ${dispatchWork.written} obligation(s) created this cycle of a ${dispatchWork.writeBudget}-row budget, ` +
        `${dispatchWork.deferred} deferred` + (dispatchWork.writes === "PLAN_ONLY" ? ` (plan only: ${dispatchWorkPlanOnlyWhy})` : ""),
    );
    for (const t of dispatchWork.targets) console.log(`      ${dispatchWorkSentence(t)}`);
    if (dispatchWork.failed.length > 0) {
      runtimeConditions.push(
        `${dispatchWork.failed.length} obligation(s) the owner's dispatch owed could not be written (first: ${dispatchWork.failed[0]?.obligationId}: ${dispatchWork.failed[0]?.why}); they are written again next cycle`,
      );
    }
  } catch (error) {
    runtimeConditions.push(
      `the work the owner sent the fleet to could not be planned (${error instanceof Error ? error.message : String(error)}); nothing was created, and the targets are planned again next cycle`,
    );
  }
}
/* The owner's dispatch records carry the step's counts; the full receipt is `dispatchWork`. */
for (let i = 0; i < ownerDispatches.length; i += 1) {
  ownerDispatches[i] = { ...ownerDispatches[i], work: ownerDispatchWorkOf(dispatchWork, ownerDispatches[i].intentId) };
}
/* Each DISPATCH is honored after the step, so its HONORED record says what was matched AND what was created. */
for (const { intent, detail } of dispatchDetails) {
  if (scheduledBlackout) continue;
  const work = dispatchWork?.targets.find((t) => t.key === `dispatch:${intent.intentId}`) ?? null;
  if (await honorIntent(intent, work === null ? detail : `${detail} ${dispatchWorkSentence(work)}`)) honoredDispatch.push(intent.intentId);
}

/* Prior context the Scout may inherit — read once, only when a Scout can run. */
const priorScoutResults = new Map<string, ScoutResult[]>();
const priorDispositionsByObligation = new Map<string, { disposition: string; permission: string; transport: string; note: string; at: string }[]>();
/* THE FIELD MANUAL a Scout inherits this cycle, read ONCE and projected per obligation. */
let fieldManual: FieldManualStore = emptyFieldManual();
let fieldManualKnown: ReadonlySet<string> = new Set<string>();
const inheritedFieldManualCounts = new Map<string, number>();
/** The exact projected doors handed to each obligation's scout at dispatch — captured input for the delivery audit, keyed by obligation id. */
const inheritedFieldManualDoors = new Map<string, { readonly entryIds: readonly string[]; readonly lines: readonly string[] }>();
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
    const fm = await repos.fieldManual.read("live");
    if (fm) {
      fieldManual = fm.value;
      fieldManualKnown = knownRouteIds(fm.value);
    }
  } catch (error) {
    runtimeConditions.push(`the field manual could not be read: ${error instanceof Error ? error.message : String(error)}`);
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
  /*
   * RULING 63: open by inheriting the field manual. Project it to this
   * obligation's jurisdiction and record class and put the known doors at the
   * TOP of the brief, so the Scout walks what already worked before novelty and
   * does not rebuild a door already listed. The count is the inherited half of
   * the reported pair, stashed for onResult.
   */
  const projection = scoutFieldManualProjection(fieldManual, {
    subjectId: row.obligation.subjectId,
    obligationId: row.obligation.id,
    recordClass: row.obligation.recordClass,
  });
  inheritedFieldManualCounts.set(id, projection.entryIds.length);
  const manualLines = fieldManualBriefLines(projection);
  // Capture the EXACT projected doors handed to this scout, at dispatch, for the delivery audit.
  inheritedFieldManualDoors.set(id, { entryIds: projection.entryIds, lines: manualLines });
  return {
    artifactIds: [...new Set(prior.flatMap((r) => r.artifactIds))],
    summary: [...manualLines, ...lines].join("\n"),
    provenance,
    priorRungs,
    nextRungs: all.at(-1)?.nextRungs ?? [],
  };
}

/* ------------------------------------------------- host supervision --- */

/**
 * **THE RELAUNCH PROOF TRAVELS WITH THE STATE.** (Work Item 3.2, RULING 246.)
 * The proof is host-local ignored evidence under THIS runtime checkout; the live trigger is asked of the
 * scheduled task through `scripts/pilot-task.ps1 -Action verify-triggers`
 * (win32 only; elsewhere the reading is NOT_MEASURABLE_ON_THIS_HOST). Neither
 * read can make the verdict ACTIVE by itself — `deriveLevel1` asks for a
 * RELAUNCHED proof within tolerance AND the trigger still present.
 */
function measureHostSupervision(): HostSupervision {
  const proofRel = join(".runtime", "ops", "runner-relaunch-proof.json");
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
    const reading = readRelaunchTriggerVerification({ stdout: run.stdout ?? "", status: run.status, failedToRun: Boolean(run.error) });
    present = reading.present;
    detail = reading.detail;
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
let autonomousDispatchedThisCycle = 0;

/**
 * The research state this cycle writes, carrying the owner's dispatch it
 * honored (ADM-8). `ownerDispatch` is the latest DISPATCH this cycle honored,
 * or null; every one of them is on the run record. It rides as an extra field
 * on `ResearchState` so the page can pick it up without this script deciding
 * the page's contract.
 */
type CycleResearchState = ResearchState & { readonly ownerDispatch: OwnerDispatchRecord | null };

function researchState(cycleFinishedAt: string | null): CycleResearchState {
  const measuredSpend = finalSpendWindow ?? spendWindow;
  const window = finalSpendWindow !== null ? finalSpendWindow.windowUsd
    : spendWindow.windowUsd === null ? null : spendWindow.windowUsd + spentThisCycle;
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
    // The daily ceiling the page and `deriveLevel1` read is the value IN FORCE
    // (the owner's override, or the fallback) — the same number the admission
    // gates below use — never the compile-time RESEARCH_BOUNDS default, so the
    // console can never show a ceiling that is not the one being enforced.
    bounds: { ...RESEARCH_BOUNDS, dailyCeilingUsd: effectiveCeilingUsd },
    spend: {
      windowUsd: window,
      measuredAttempts: measuredSpend.measured,
      unmeasuredAttempts: measuredSpend.unmeasured,
      asOf: finalSpendAsOf ?? NOW,
    },
    queue: {
      registeredUnits: allUnits.length,
      modelClassUnits: modelClassUnits.length,
      modelClassDue: dueModel.length,
      modelClassDispatchedThisCycle: laneCounts.modelDispatched,
      modelClassDeferredForCeiling: laneCounts.deferredBy.CEILING ?? 0,
      modelClassDeferredForCycleMax: laneCounts.deferredBy.CYCLE_MAX ?? 0,
      modelClassDeferredForBudget: laneCounts.deferredBy.BUDGET ?? 0,
      modelClassNotOpenedThisCycle: Math.max(0, dueModel.length - openedModel),
      autonomousDispatchedThisCycle,
      modelClassDeferredForLane: (laneCounts.deferredBy.LANE_DISABLED ?? 0) + (laneCounts.deferredBy.PAUSED ?? 0),
      deterministicDue: dueDeterministic,
      deterministicDispatchedThisCycle: laneCounts.deterministicDispatched,
    },
    running: [...running],
    runtimeConditions: [...runtimeConditions],
    cyclePhases: [...cycleObservation.phases],
    methodCandidates: (() => {
      const counts = canonicalCandidateCounts;
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
    expansion: expansionReading,
    dispatchWork,
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
 * THE PRE-WARM (2026-09-06). Once per cycle, before the first admitted Scout
 * is dispatched: one `max_tokens: 0` request carrying the exact tools and
 * system the Attempts send, through the same guarded transport, so the static
 * prefix is written once and every Attempt this cycle — including the two
 * that start together — reads it. Its cost is a SCOUT ledger row under
 * `SCOUT_PREWARM_ROUTE_ID`, so the rolling ceiling sees it and capacity does
 * not count it as an Attempt. A failure is recorded on the lane counts and
 * the Attempts still run.
 */
const prewarmScoutPrefix = async (): Promise<PrewarmOutcome> => {
  const at = nowIso();
  const started = Date.now();
  try {
    const route = assertStepMayInvokeModel(SCOUT_LOOP_STEP);
    const model = route.model === SCOUT_MODEL ? SCOUT_MODEL : route.model;
    const request = scoutPrewarmRequest({ model, effort: route.effort, toolkitSpecs: SCOUT_TOOL_SPECS, bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
    const transport = fleetSafety.guardedModelTransport("anthropic", "scout-prewarm", anthropicTransport(workerKey));
    const response = await transport(request);
    const metered = readMeteredUsage(response.usage ?? {});
    const priced = priceMeteredUsage(model, metered, "5m");
    const durationMs = Date.now() - started;
    const cost: AttemptCost = {
      inputTokens: metered.uncachedInputTokens === null ? null : metered.uncachedInputTokens + (metered.cacheReadInputTokens ?? 0) + (metered.cacheCreationInputTokens ?? 0),
      outputTokens: metered.outputTokens,
      usd: priced.usd,
      durationMs,
      bytesFetched: null,
      requestCount: 1,
      ...meteredCostFields(metered),
    };
    await recordCost(
      repos,
      { attemptId: `scout-prewarm:${NOW}`, workItemId: "scout-prewarm", routeTaskId: null, routeId: SCOUT_PREWARM_ROUTE_ID, source: "api.anthropic.com", jurisdiction: null, project: "freshness", role: "SCOUT", cost, recordedAt: at },
      at,
    ).catch(() => undefined);
    if (priced.usd !== null) spentThisCycle += priced.usd;
    return { status: "WARMED", at, cacheCreationInputTokens: metered.cacheCreationInputTokens, cacheReadInputTokens: metered.cacheReadInputTokens, uncachedInputTokens: metered.uncachedInputTokens, usd: priced.usd, durationMs };
  } catch (error) {
    return { status: "FAILED", at, detail: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
  }
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
      toolkitFor: (toolCtx) => buildScoutToolkit(scoutSearch !== null ? { ...toolCtx, search: scoutSearch } : toolCtx),
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
            const report = await proposeScoutCandidates({ repos, root: ROOT, result, artifacts, stamp: today() });
            candidateReports.push(report);
            canonicalCandidateCounts = report.counts;
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
        /*
         * RULING 63 reported pair + live write-back. The inherited count is what
         * the brief projected; a candidate whose routeId the manual already held
         * is a rebuilt-existing defect. Grounded discoveries are written straight
         * back into the field manual so the NEXT Scout of any role inherits them
         * this cycle — no human method:learn step in between.
         */
        const pair = compoundingPair(inheritedFieldManualCounts.get(result.obligationId) ?? 0, result, fieldManualKnown);
        const doors = inheritedFieldManualDoors.get(result.obligationId);
        amended = {
          ...amended,
          inheritedFieldManual: pair.inheritedCount,
          rebuiltExistingRoutes: pair.rebuiltExisting,
          ...(doors ? { inheritedFieldManualEntryIds: doors.entryIds, inheritedFieldManualLines: doors.lines } : {}),
        };
        if (result.refusal === null && result.candidates.length > 0) {
          const written = await writeFieldManualDiscoveries(
            repos,
            scoutDiscoveryEntries(result, scoutStateHint(result.subjectId, result.obligationId)),
            nowIso(),
          );
          if (written.error) {
            amended = { ...amended, unverified: [...amended.unverified, `field manual write-back failed: ${written.error}`] };
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
const fleetReserveMs = !dry && !canary && downstreamWorkCount ? Math.min(360_000, BUDGET_MIN * 30_000) : 0;
// Registered investigations also need Scout after a known source fails or leaves
// verification unresolved; initial source discovery is not the only model work.
finishPhase("worker-context");

/*
 * **SETTLED OCCURRENCES ARE RECOVERED BEFORE THE LANES, NOT WHEN A LANE REACHES
 * THEM.** (2026-09-23.) A recovery walks nothing and spends nothing, so it
 * waits on no ceiling, budget or Scout admission. The scan starts from the
 * settled RouteTask ids the listing above already read, and reads the
 * occurrences once, about 5 s over the 4,751 production rows. A failed scan is
 * named, and the lanes still recover any settled row they reach, so a failure
 * costs latency and never correctness.
 */
let settledOccurrences: readonly SettledOccurrence[] = [];
/*
 * The same pass finds ABANDONED occurrences (2026-09-23): open, unreferenced,
 * with the obligation moved past them and a RouteTask never claimed. Only a full
 * standing cycle closes them; the rest print them. Each close writes only the
 * occurrence, unresolved, and is named in the digest and the run record.
 */
let abandonedOccurrences: readonly AbandonedOccurrence[] = [];
let abandonedClosed: Awaited<ReturnType<typeof closeAbandonedOccurrences>> | null = null;
if (!canary && !scheduledBlackout) {
  try {
    const scan = await scanOccurrences(repos, {
      obligations: sync.all,
      settledRouteTaskIds: settledTaskIds,
      neverClaimedRouteTaskIds: neverClaimedTaskIds,
    });
    settledOccurrences = scan.settled;
    abandonedOccurrences = scan.abandoned;
  } catch (error) {
    runtimeConditions.push(
      `settled occurrences could not be found before dispatch (${error instanceof Error ? error.message : String(error)}); a lane recovers any it reaches`,
    );
  }
  if (abandonedOccurrences.length > 0) {
    if (dry || ONLY !== null || IDS !== null) {
      console.log(`  abandoned occurrences: ${abandonedOccurrences.length} found (plan only: this cycle writes nothing)`);
    } else {
      abandonedClosed = await closeAbandonedOccurrences(repos, { abandoned: abandonedOccurrences, now: NOW });
      console.log(
        `  abandoned occurrences: ${abandonedOccurrences.length} found, ${abandonedClosed.closed.length} closed unresolved` +
          (abandonedClosed.skipped.length > 0 ? `, ${abandonedClosed.skipped.length} skipped` : "") +
          (abandonedClosed.failed.length > 0 ? `, ${abandonedClosed.failed.length} failed and are found again next cycle` : ""),
      );
    }
  }
}
finishPhase("settled-occurrence-scan");

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
  openOccurrence: openOccurrenceInStep,
  settledOccurrences,
  onRecoveryComplete: () => finishPhase("lease-and-completion-recovery"),
  skipReclaim: canary,
  admitDispatch: (row) => fleetSafety.admitDispatch(row.obligation.id),
  budget: { deadlineMs: DISPATCH_DEADLINE_MS - fleetReserveMs, now: () => Date.now() },
  /* ADM-8: the owner's dispatch goes first in the dispatcher's own due order too. */
  placeFirst: dispatchPriority,
  /* With no DISPATCH pending (the set above is empty), the selected expansion scopes' due work goes first instead. */
  ...(scopePlaceFirst !== null ? { placeFirst: scopePlaceFirst } : {}),
  research: {
    decide: (row) => decisionFor(row.obligation.id, row.obligation.routeId),
    /* The same canonical band comparator used for the visible/opening queue reaches the actual Scout pool. */
    compareModelRows: compareScoutRows,
    admitScout: (row) => {
      if (!modelLaneEnabled) return { admit: false, code: laneDisabledCode ?? "LANE_DISABLED", why: laneDisabledReason ?? "lane closed" };
      /* MW-028: a materialized meetings-discovery row goes to a paid Scout only after the free walk read the site and found nothing. */
      const freeWalkFirst = paidDiscoveryHold(row.obligation.id, UNREAD_FREE_DISCOVERY_WALKS);
      if (freeWalkFirst !== null) return { admit: false, code: freeWalkFirst.code, why: freeWalkFirst.why };
      if (ledgerUnreadable !== null) return { admit: false, code: "CEILING", why: `the cost ledger could not be read, so the ceiling cannot be enforced (${ledgerUnreadable})` };
      const window = spendWindow.windowUsd === null ? null : spendWindow.windowUsd + spentThisCycle;
      // The scout daily ceiling is the value IN FORCE (the owner's override, or
      // the fallback), not the RESEARCH_BOUNDS default — so raising the dial above
      // the old default does not leave this gate silently binding at 100 while the
      // console shows a higher number.
      const cap = ceilingPermits(window, effectiveCeilingUsd);
      if (!cap.permits) return { admit: false, code: "CEILING", why: cap.why };
      /* The BINDING ceiling is FleetSafety's rolling-24h one, which admitScout did
         not read — so scouts were admitted here and then refused one-by-one by the
         per-request guard, a $0 busy-loop that re-dispatched every cycle. Reading it
         here pauses the whole lane when it is reached (RULING: paused over it). It
         reads the SAME `effectiveCeilingUsd` through the controller's bounds. */
      const rolling = fleetSafety.rollingCeilingReached(SCOUT_WORST_CASE_USD);
      if (rolling.reached) {
        return {
          admit: false,
          code: "CEILING",
          why: `rolling 24h model spend ${rolling.spentUsd === null ? "unmeasured" : `$${rolling.spentUsd.toFixed(2)}`} of $${rolling.capUsd.toFixed(2)} reached — the scout lane is paused this cycle rather than busy-loop the ceiling`,
        };
      }
      if (Number.isFinite(SCOUT_MAX) && scoutsAdmittedThisCycle >= SCOUT_MAX) return { admit: false, code: "CYCLE_MAX", why: `the diagnostic --scout-max cap of ${SCOUT_MAX} for this cycle is reached` };
      /* The owner's expansion-scope budgets: last, so a scope reservation is
         only ever taken for a Scout every Fleet gate above already admitted. */
      if (expansionBudget !== null) {
        const scoped = expansionBudget.gate.admit(row.obligation.id, row.obligation.subjectId);
        if (!scoped.admit) return { admit: false, code: scoped.code, why: scoped.why };
      }
      scoutsAdmittedThisCycle += 1;
      return { admit: true };
    },
    modelExecutor: scoutFor,
    maxConcurrentScouts: RESEARCH_BOUNDS.maxConcurrentScouts,
    scoutLeaseTtlMs: RESEARCH_BOUNDS.perDispatch.maxWallMs + 120_000,
    scoutWallMs: RESEARCH_BOUNDS.perDispatch.maxWallMs,
    /*
     * The Scout lane admits against the HARD dispatch wall, not the reserve-reduced
     * deadline the deterministic lane runs under (2026-09-18). `fleetReserveMs` caps
     * the always-full refresh queue so it cannot starve the fleet; passing it as the
     * Scout deadline too was starving the Scouts instead — two clean cycles deferred
     * every Scout for BUDGET while the cycle finished at half the hard wall.
     */
    scoutDeadlineMs: DISPATCH_DEADLINE_MS,
    /* The pre-warm of the static prefix, once per cycle before the first admitted Scout (2026-09-06). Never in a dry cycle. */
    ...(modelLaneEnabled && !dry ? { prewarm: prewarmScoutPrefix } : {}),
    onDispatched: async (result: DispatchResult, lane) => {
      if (result.outcome === "WORKED") fleetSafety.recordSuccessfulActivity(nowIso());
      if (lane === "BOUNDED_MODEL_WORKER") {
        spentThisCycle += result.cost?.usd ?? 0;
        /* A Scout that reported no dollar figure leaves its scope's spend unmeasured, which holds that scope's paid work. */
        expansionBudget?.gate.settle(result.obligationId, result.cost?.usd ?? null);
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
finishPhase("dispatch");
if (expansionReading !== null && expansionBudget !== null) {
  /* The scopes' dispatch outcome: what each budget admitted and held this cycle. */
  expansionReading = withCycleCounts(expansionReading, {
    dueByScope: new Map(expansionReading.scopes.map((s) => [s.key, s.work?.dueThisCycle ?? 0])),
    scoutPlacedFirstByScope: new Map(expansionReading.scopes.map((s) => [s.key, s.work?.scoutRowsPlacedFirst ?? 0])),
    gate: expansionBudget.gate,
  });
}
laneCounts = {
  deterministicDispatched: cycle.lanes?.deterministic.dispatched ?? laneCounts.deterministicDispatched,
  modelDispatched: cycle.lanes?.model.dispatched ?? laneCounts.modelDispatched,
  deferredBy: { ...(cycle.lanes?.model.deferredBy ?? {}) },
};
for (const row of cycle.deferred) {
  const code = /^([A-Z][A-Z0-9_]+)/.exec(row.why)?.[1] ?? "CYCLE_DEFERRED";
  fleetSafety.defer(row.obligationId, code, row.why);
}
/* A settled occurrence found before dispatch on an obligation with no schedule stays open, and is named rather than dropped. */
{
  const recoveredIds = new Set(cycle.recovered.map((r) => r.obligationId));
  const leftOpen = settledOccurrences.filter((s) => !recoveredIds.has(s.obligationId));
  console.log(
    `  settled occurrences: ${settledOccurrences.length} found before dispatch, ${settledOccurrences.length - leftOpen.length} recovered` +
      (leftOpen.length > 0 ? `; ${leftOpen.length} left open on an unscheduled obligation: ${leftOpen.map((s) => s.obligationId).join(", ")}` : ""),
  );
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

/* Dispatched and recovered occurrences close by one rule; a recovered one by the disposition it already carries. */
await closeCycleOccurrences(repos, {
  cycle,
  occurrenceFor: (obligationId) => occurrenceByObligation.get(obligationId)?.id ?? null,
  now: NOW,
});

const persisted = await persistDebts(
  repos,
  cycle.debts,
  NOW,
  canary ? corpus.map((obligation) => obligation.id) : null,
  retiredDebtReasons,
);
finishPhase("occurrence-and-debt-commit");
console.log(
  `\n  debt persisted: ${persisted.written} row(s) written, ${persisted.cleared.length} cleared` +
    (persisted.clearedAsRetired.length > 0 ? `, ${persisted.clearedAsRetired.length} tombstoned as retired` : ""),
);

/*
 * RULING 52/53: a scout that argued a record absent this cycle (a proper walk
 * concluding NO_PROGRESS — a ladder walked to the floor with nothing there, not
 * a BLOCKED wall, which reschedules on its own cadence) records an EXPIRING
 * absence, so the obligation is not re-walked until it lapses (~30 days) instead
 * of every cycle. This is NOT a debt — it is a proven negative that rechecks on
 * a clock; a later cycle's productive disposition clears it. Best effort: an
 * absence that cannot be written leaves the obligation to re-walk next cycle,
 * never dropped.
 */
if (!dry && !canary) {
  const until = absenceExpiry(NOW);
  let absencesRecorded = 0;
  for (const r of scoutResultsThisCycle) {
    if (!isArguedAbsence(r, MIN_DISTINCT_RUNGS)) continue;
    try {
      await recordArguedAbsence(repos, { obligationId: r.obligationId, absentUntil: until, now: NOW });
      absencesRecorded += 1;
    } catch (error) {
      console.error(
        `  argued absence not recorded for ${r.obligationId} (${error instanceof Error ? error.message : String(error)}); it re-walks next cycle`,
      );
    }
  }
  if (absencesRecorded > 0) {
    console.log(`  argued absences recorded: ${absencesRecorded} (each rechecks in ${ABSENCE_EXPIRY_DAYS} days; RULING 52/53)`);
  }
}

// Registered autonomous plans use the same dispatcher, vault, host spacing and
// rolling model ceiling. Discovery shares this cycle's existing Scout allowance.
if (!dry && !canary && !scheduledBlackout && Date.now() + 150_000 < DISPATCH_DEADLINE_MS) {
  try {
    const meetingsReceipt: PermanentMeetingsReceipt = RESEARCH_CYCLE_MEETINGS_RECEIPT;
    if (meetingsReceipt.kind === "UNAVAILABLE") {
      runtimeConditions.push(
        `permanent meetings receipt unavailable to immutable fact projection: ${meetingsReceipt.detail}; ` +
        "fact approval remains held and no legacy acquisition clock is reopened",
      );
    }
    const fleet = await autonomousStandingRuntime({ root: ROOT, repos, now: nowIso,
      spaceOut: spacer,
      openBytes: fleetSafety.guardedOpenBytes("public-web", "registered autonomous Fleet acquisition"),
      ...(modelLaneEnabled ? { transport: fleetSafety.guardedModelTransport("anthropic", "registered autonomous Fleet audit", boundedAuditTransport(workerKey)) } : {}) });
    // Retained civic bytes get one guaranteed stage before open-ended discovery.
    // Both queues consume the same aggregate counter; unused shares are lent
    // back within the existing ten-dispatch and wall limits.
    const downstreamStartedAt = fleetSafety.snapshot().cycle.dispatches;
    const heldFirst = await runHeldWorkerFleetCycle(ROOT, fleet, true, {
      maximumDispatches: 1, admitDispatch: work => fleetSafety.admitDispatch(work),
    });
    const heldUsed = fleetSafety.snapshot().cycle.dispatches - downstreamStartedAt;
    const autonomous = await runAutonomousCoordinator(fleet, { maximum: Math.max(0, 3 - heldUsed), concurrency: 2,
      deadlineMs: DISPATCH_DEADLINE_MS, maxScoutDispatches: Math.max(0, SCOUT_MAX - scoutsAdmittedThisCycle),
      admitDispatch: work => fleetSafety.admitDispatch(work) });
    for (const row of autonomous.deferred) fleetSafety.defer(row.workItemId, row.reason, row.detail);
    scoutsAdmittedThisCycle += autonomous.scoutsAdmitted;
    const legacy = [...heldFirst];
    // No per-cycle dispatch cap: the held-worker loop runs until the wall
    // (checked in the loop condition) or until no held work remains.
    const remaining = Number.POSITIVE_INFINITY;
    for (let slot = 0; slot < remaining && Date.now() + 150_000 < DISPATCH_DEADLINE_MS; slot += 1) {
      const next = await runHeldWorkerFleetCycle(ROOT, fleet, true, {
        maximumDispatches: 1, admitDispatch: work => fleetSafety.admitDispatch(work),
      });
      legacy.push(...next);
      if (next.length === 0) break;
    }
    const fleetDispatches = [...legacy, ...autonomous.dispatches];
    autonomousDispatchedThisCycle = fleetDispatches.filter(row => row.attemptId !== null).length;
    if (fleetDispatches.some(row => row.outcome === "WORKED")) fleetSafety.recordSuccessfulActivity(nowIso());
    /* PRDY-3: meeting-fact chains are bridged and measured against the immutable vault bytes; every other result keeps the generic offer. */
    const factReport = await projectFleetPipeline(repos, {
      readArtifactText: async (id) => (await fleet.readEvidence(id)).text,
      now: nowIso(),
      root: ROOT,
      freshness: async (input) => factFreshnessFromPermanentMeetings(meetingsReceipt, input),
    });
    if (factReport !== null) for (const line of factChainLines(factReport)) console.log(line);
    for (const row of fleetDispatches) console.log(`  worker fleet: ${row.worker?.role ?? "UNCLAIMED"} ${row.outcome} ${row.attemptId ?? "none"}: ${row.detail}`);
  } catch (error) {
    runtimeConditions.push(`worker fleet could not complete this bounded pass: ${error instanceof Error ? error.message : "WORKER_FLEET_FAILED"}`);
  }
}
finishPhase("autonomous-workers-and-projection");
/* ------------------------------------------------------- the promotion tail --- */

/*
 * RULING 224. Acquisition without promotion is inventory, not product. The tail
 * runs on EVERY cycle with no operator: acquire -> vault -> normalize ->
 * snapshot -> STAGED. Promotion itself is OFF and a session carries the last
 * mile, so nothing below writes outside ignored `.runtime/control-plane/staging/` diagnostics.
 */
const staged: StagedEntry[] = [];
for (const result of cycle.dispatched) {
  const unit = units.find((u) => u.obligation.id === result.obligationId);
  if (unit === undefined) continue;
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
/*
 * A RECOVERED DISPOSITION STILL MOVES THROUGH THE TAIL. (2026-09-22.) The cycle
 * that committed it ended before staging it, and closing the occurrence is not
 * the end of the record's work: its bytes are read back by held identity, since
 * this cycle's ledger never saw them, and staged exactly as a dispatch's would be.
 */
for (const recovered of cycle.recovered) {
  const unit = units.find((u) => u.obligation.id === recovered.obligationId);
  if (unit === undefined) continue;
  const { disposition } = recovered;
  let body: string | null = null;
  try {
    const held = disposition.artifactIds.length === 0 ? [] : await repos.artifacts.read(recovered.workItemId);
    for (const artifactId of disposition.artifactIds) {
      const record = held.find((a) => a.artifactId === artifactId);
      if (record === undefined) continue;
      body = await vault.readHeld(record);
      if (body !== null) break;
    }
  } catch (error) {
    runtimeConditions.push(
      `recovered ${recovered.obligationId}: its held bytes could not be read back ` +
        `(${error instanceof Error ? error.message : String(error)}); it is staged as still owed`,
    );
  }
  staged.push(
    stageOne({
      root: ROOT,
      obligationId: recovered.obligationId,
      providerId: unit.providerId,
      recordClass: unit.record.recordClass,
      subjectId: unit.record.subjectId,
      route: unit.route,
      disposition: disposition.disposition,
      artifactIds: disposition.artifactIds,
      body,
      nextDueAt: nextDueByObligation.get(recovered.obligationId) ?? null,
      detail:
        `committed ${disposition.at} by Attempt ${disposition.attemptId} in a cycle that ended before ` +
        "closing or staging it, and recovered without walking the route again" +
        (disposition.disposition === "INGESTED" && body === null
          ? "; its vaulted bytes were not found in this runner's vault, so the record is staged as still owed"
          : "") +
        `. ${disposition.note}`,
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
  finalSpendWindow = researchSpendInWindow(costsNow, at);
  finalSpendAsOf = at;
  const windowCycles: { startedAt: string; deterministic: number; model: number }[] = [];
  try {
    const since = Date.parse(at) - RESEARCH_BOUNDS.windowHours * 3_600_000;
    const priorDigests = await repos.ownerDigests.readWhere(DIGEST_LOG_KEY, ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE");
    for (const rec of freshnessCycleOutcomes(priorDigests)) {
      const lanes = rec.research?.lanes;
      if (!lanes || Date.parse(rec.startedAt) < since) continue;
      windowCycles.push({
        startedAt: rec.startedAt,
        deterministic: lanes.deterministic?.dispatched ?? 0,
        model: lanes.model?.dispatched ?? 0,
      });
    }
  } catch (error) {
    runtimeConditions.push(
      `research share history was unavailable from the canonical owner log (${error instanceof Error ? error.message : String(error)}); the window contains this cycle only`,
    );
  }
  const counts = await candidateStoreCounts(repos);
  const candidateCounts = counts === null ? null : { proposed: counts.PROPOSED, validated: counts.VALIDATED, admitted: counts.ADMITTED, rejected: counts.REJECTED };
  const pipeline = await NO_PIPELINE_RECORDED();
  /*
   * The cache rows (2026-09-06), from the COST LEDGER — the same rows the
   * rolling ceiling reads — over the ceiling's own trailing window, and
   * separately over this cycle's rows for the COST section of the digest.
   */
  const windowSince = new Date(Date.parse(at) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString();
  cacheThisCycle = cacheHitRateByRole({ costs: costsNow, results, sinceIso: NOW, untilIso: at });
  return {
    computedAt: at,
    capacity: scoutCapacity({ costs: costsNow, nowIso: at, windowHours: RESEARCH_BOUNDS.windowHours, ceilingUsd: effectiveCeilingUsd }),
    ordering: dispatchOrdering,
    funnel: graduationFunnel({
      results,
      candidateCounts,
      pipeline,
      pipelineSource: "none recorded — the promotion pipeline (lib/control-plane/promotion) is another lane's; plug its reader in here",
      deterministicReplays: 0,
    }),
    share: modelShareTrend({ thisCycle: { deterministic: laneCounts.deterministicDispatched, model: laneCounts.modelDispatched }, windowCycles }),
    cacheByRole: cacheHitRateByRole({ costs: costsNow, results, sinceIso: windowSince, untilIso: at }),
    cacheWindow: { sinceIso: windowSince, untilIso: at },
    costPerOutcome: costPerUsefulOutcome({ results, candidateCounts, confirmed: null }),
    cacheDefects: cacheDefectCounts(results),
  };
}
/** This cycle's cache rows, for the run record's COST section (null until computed, or when the ledger could not be re-read). */
let cacheThisCycle: CacheHitRate[] | null = null;
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
      candidates: (await readMethodCandidateStore(repos)).candidates,
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
finishPhase("metrics-and-finalization");
await writeResearchState(finishedAt);
const finalState = researchState(finishedAt);

/*
 * PRDY-1 (2026-09-06): the three code identities, read once per cycle. A live
 * cycle refreshes origin/main with a bounded fetch; a dry or canary cycle reads
 * the refs as last seen so no test reaches the network. A read that throws
 * leaves the field null — the beat still says the cycle ran; it never says the
 * code identity is consistent.
 */
const codeIdentity = (() => {
  try {
    return readCodeIdentity({ cwd: ROOT, runnerTestedSha: headSha(ROOT), now: finishedAt, fetch: !dry && !canary });
  } catch (error) {
    runtimeConditions.push(`the code identity could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
})();

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
  codeIdentity,
};
try {
  const beat = await repos.runnerHeartbeat.read(RUNNER_ID);
  const nextHeartbeat: RunnerHeartbeat = {
    ...heartbeat,
    /* The intake observer runs immediately after this child. Preserve its
       latest durable receipt while refreshing cycle/liveness fields; a cycle
       crash before the observer runs must not erase the last known reading. */
    intakeRuntime: beat?.value.intakeRuntime ?? null,
  };
  if (beat === null) await repos.runnerHeartbeat.put(RUNNER_ID, nextHeartbeat, finishedAt);
  else await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, beat.revision, nextHeartbeat, finishedAt);
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
  `  model spend        cycle ${safety.cycle.modelUsd === null ? "UNMEASURED" : `$${safety.cycle.modelUsd.toFixed(4)}`} · ` +
    `rolling 24h ${safety.rolling24Hours.modelUsd === null ? "UNMEASURED" : `$${safety.rolling24Hours.modelUsd.toFixed(4)}`} / $${safety.bounds.rolling24HourModelUsd.toFixed(2)} (the one spend ceiling)`,
  `  aggregate          dispatches ${safety.cycle.dispatches} · requests ${safety.cycle.requests} · payload bytes ${safety.cycle.payloadBytes} · ` +
    `per-download cap ${safety.bounds.maxDownloadBytes} · wall ${safety.cycle.elapsedMs}/${safety.bounds.maxWallMsPerCycle}ms`,
  `  stopped/deferred   ${safety.stoppedBecause.length === 0 ? "none" : safety.stoppedBecause.join("; ")}`,
  `  circuits           ${safety.providerCircuits.length === 0 ? "none" : safety.providerCircuits.map(c => `${c.provider}: ${c.condition} (latched until ${c.eligibleAt})`).join("; ")}`,
  `  last success       ${safety.lastSuccessfulActivity ?? "none recorded"}`,
  "",
  "RESEARCH — LEVEL 1 (RULING 240)",
  `  lane               ${modelLaneEnabled ? "ENABLED" : `CLOSED — ${laneDisabledReason}`}`,
  `  credential         ${WORKER_CREDENTIAL_VAR} configured in this process: ${credentialConfigured ? "yes" : "NO"} (by name; the value reaches only the provider request)`,
  `  model              ${SCOUT_MODEL} · concurrency ${RESEARCH_BOUNDS.maxConcurrentScouts} · no per-cycle cap ($${effectiveCeilingUsd}/day ${rollingCeiling.source.toLowerCase()} + wall) · per Attempt ${RESEARCH_BOUNDS.perDispatch.maxTurns} turns / ${RESEARCH_BOUNDS.perDispatch.maxToolCalls} tools / ${Math.round(RESEARCH_BOUNDS.perDispatch.maxWallMs / 60_000)} min`,
  `  scouts             ${laneCounts.modelDispatched} dispatched of ${dueModel.length} due model-class (${modelClassUnits.length} registered model-class of ${allUnits.length}) · ` +
    `deferred ${cycle.lanes?.model.deferred ?? 0}${deferredByLine ? ` (${deferredByLine})` : ""}` +
    (dueModel.length - openedModel > 0 ? ` · ${dueModel.length - openedModel} not reached before the wall` : ""),
  `  spend              rolling ${RESEARCH_BOUNDS.windowHours}h: ${spendWindow.windowUsd === null ? "UNMEASURED" : `$${(spendWindow.windowUsd + spentThisCycle).toFixed(4)}`} of $${effectiveCeilingUsd} ceiling (${rollingCeiling.source.toLowerCase()}) ` +
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
  ...(supersededPlan === null
    ? []
    : [
        `  retired            ${retirementApplied?.retired.length ?? 0} of ${supersededPlan.retire.length} planned obligation(s) the registry no longer emits · ` +
          `${retirementApplied?.occurrencesClosed.length ?? 0} open occurrence(s) closed unresolved · ` +
          `${persisted.clearedAsRetired.length} debt(s) tombstoned as retired` +
          (supersededPlan.heldBack.length > 0 ? ` · held back ${JSON.stringify(supersededHolds)}` : "") +
          ((retirementApplied?.failed.length ?? 0) > 0 ? ` · ${retirementApplied?.failed.length} did not complete, planned again` : "") +
          (retirementError !== null ? ` · COULD NOT RUN: ${retirementError}` : ""),
      ]),
  ...(abandonedOccurrences.length === 0
    ? []
    : [
        `  abandoned          ${abandonedOccurrences.length} open occurrence(s) their obligation moved past, on RouteTasks never claimed · ` +
          (abandonedClosed === null
            ? "plan only: this cycle wrote nothing"
            : `${abandonedClosed.closed.length} closed unresolved, ${abandonedClosed.skipped.length} skipped, ${abandonedClosed.failed.length} failed`),
      ]),
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

/* ------------------------------------------------------ canonical outcome --- */

const runRecord = {
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
      /* Settled occurrences an interrupted cycle left open, closed with their committed disposition. */
      recovered: cycle.recovered.map((r) => ({
        obligationId: r.obligationId,
        occurrenceId: r.occurrenceId,
        routeTaskId: r.routeTaskId,
        disposition: r.disposition.disposition,
        committedAt: r.disposition.at,
        attemptId: r.disposition.attemptId,
        artifactIds: r.disposition.artifactIds,
        discharged: r.discharged,
      })),
      /* Rows the registry no longer emits: what was planned, held back by code, and actually written (2026-09-23). */
      /* Open occurrences their obligation moved past without closing (2026-09-23). */
      abandonedOccurrences: { found: abandonedOccurrences, applied: abandonedClosed },
      retirement:
        supersededPlan === null
          ? null
          : {
              superseded: supersededPlan.retire.map((item) => item.obligationId),
              residue: residueItems.map((item) => item.obligationId),
              heldBackByCode: supersededHolds,
              heldBackExamples: supersededPlan.heldBack.slice(0, 25),
              applied: retirementApplied,
              error: retirementError,
              debtsTombstonedAsRetired: persisted.clearedAsRetired,
            },
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
        /* This cycle's cache rows from the cost ledger (2026-09-06), read by the digest's COST section. */
        cacheThisCycle,
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
        /* MW-028: what this cycle created for every target the owner sent the fleet to. */
        dispatchWork,
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
      stagingManifest: `${[".runtime", "control-plane", "staging"].join("/")}/manifest.json`,
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
      codeIdentity,
} as const;

const cycleId = `freshness-cycle:${HOST}:${NOW}`;
const canonicalOutcome: FreshnessCycleOutcome = {
  kind: "FRESHNESS_CYCLE",
  state: "SUCCEEDED",
  cycleId,
  startedAt: runRecord.startedAt,
  finishedAt: runRecord.finishedAt,
  testedSha: runRecord.testedSha,
  host: HOST,
  provider: runRecord.provider,
  durable: runRecord.durable,
  executor: runRecord.executor,
  registry: runRecord.registry,
  obligations: runRecord.obligations,
  occurrencesOpened: runRecord.occurrencesOpened,
  debtInherited: runRecord.debtInherited,
  debtPersisted: runRecord.debtPersisted,
  debtCleared: runRecord.debtCleared,
  scheduled: runRecord.scheduled,
  unscheduled: runRecord.unscheduled,
  dueCount: runRecord.dueCount,
  dispatched: runRecord.dispatched,
  worked: runRecord.worked,
  dispositions: runRecord.dispositions.map((row) => ({
    obligationId: row.obligationId,
    disposition: row.disposition,
    artifacts: row.artifacts,
  })),
  dispatchDetails: runRecord.dispatchDetails.map((row) => ({
    obligationId: row.obligationId,
    attemptId: row.attemptId,
    outcome: row.outcome,
    disposition: row.disposition,
    detail: row.detail,
  })),
  research: { lanes: runRecord.research.lanes },
  deferred: runRecord.deferred,
  debts: runRecord.debts,
  incidents: runRecord.incidents.map((incident) => ({
    cause: incident.cause,
    target: incident.target,
    obligationsAffected: incident.obligationsAffected,
    nextRetryAt: incident.nextRetryAt,
  })),
  risk: runRecord.risk as unknown as Readonly<Record<string, unknown>>,
  health: runRecord.health as unknown as Readonly<Record<string, unknown>>,
  promotedToReaderTruth: runRecord.promotedToReaderTruth,
  failure: null,
};

/* Canonical append happens first. A local file is disposable diagnostics only. */
await appendFreshnessCycleDigest(repos, { outcome: canonicalOutcome, lines });
console.log(`\n  canonical outcome: ${cycleId}`);

mkdirSync(RUNS_DIR, { recursive: true });
const path = nextRunRecordPath(RUNS_DIR, today());
writeFileSync(path, `${JSON.stringify(runRecord, null, 2)}\n`, "utf8");
console.log(`  local diagnostic: ${path}`);
await releaseWindowLease(repos, CYCLE_LEASE_HOLDER, nowIso());
