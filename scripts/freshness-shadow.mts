import { huntPacketsProvider } from "../lib/control-plane/scheduler/providers/hunt-packets.ts";
import { ensureReaderSettingsPublished, publishAskPlaybooks } from "../lib/civic-data/reader-settings-publication.ts";
import "../lib/ask/model.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { runLeaseWorkerProcesses, workerDispatchFailure, workerProcessSlots } from "../lib/control-plane/workers/process-pool.ts";
import { RESEARCH_PARENT_PEAK_MIB, reportingWorkerSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { routeProcessExecutor } from "../lib/control-plane/workers/route-process.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { legacyHeldWorkOwed, planHeldWorkerFleet } from "../lib/control-plane/workers/standing.ts";
import { LINEAGE_ARTIFACT_FIELDS, LINEAGE_ATTEMPT_FIELDS, persistVerifiedPublicationAnchors, selectStandingLineages, standingLineageCoversDue, standingLineageKeyFor, type LineageArtifact, type LineageAttempt } from "../lib/control-plane/workers/standing-lineage.ts";
import { sourceReliabilityKey } from "../lib/control-plane/scheduler/scout-reliability.ts";
import { HOST_CONCURRENCY_DEFAULT, HOST_CONCURRENCY_SETTING, providerConcurrency } from "../lib/control-plane/scheduler/provider-limits.ts";
import { browseWithPlaywright } from "./scout-browse.mts";
import { autonomousCycleAllowed, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { MODELS } from "../lib/models.ts";
import { paidWorkGuards } from "../lib/control-plane/workers/paid-work-guards.ts";
import { hunterLaneArmingPath, laneArmingOf, writeLaneArming } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { hunterQueuePath, writeHunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";
import { researchPaidWorkerCapacity } from "../lib/control-plane/scheduler/research-policy.ts";
import { serializeHostSpacing } from "../lib/control-plane/workers/host-spacing.ts";
import { projectFleetPipeline } from "../lib/control-plane/workers/pipeline.ts";
import { isRetiredRoutineMeetingAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";
import { plannedForHunters } from "../lib/control-plane/workers/route-plan.ts";
import { observeCyclePhases, type CyclePhase } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { cycleStateWriter } from "../lib/control-plane/scheduler/cycle-state-writer.ts";
import { soleWriter } from "../lib/control-plane/repository/shared.ts";
import { selectedCycleRepositories } from "../lib/control-plane/scheduler/cycle-selection.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { ADMIN_MIRROR_BUDGET_MS, runAdminEvidenceMirror } from "../lib/control-plane/evidence/admin-bridge-runner.ts";
import { retainRecentRoutineMeetingEvidence } from "../lib/control-plane/workers/routine-meeting-intake.ts";

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import {
  controlPlaneUrlFromEnv,
  createPgRepositories,
  CONTROL_PLANE_URL_VAR,
  CONTROL_PLANE_QUERY_CONCURRENCY,
} from "../lib/control-plane/repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";
import {
  closeCycleOccurrences,
  digestLines,
  huntRoundComparator,
  placeFirstRows,
  runCycle,
  runPool,
} from "../lib/control-plane/scheduler/shadow-loop.ts";
import {
  describeDispatchMatch,
  parseDispatchTarget,
  unitMatchesTarget,
} from "../lib/control-plane/scheduler/dispatch-target.ts";
import { WindowLockHeld, acquireWindowLease, releaseWindowLease } from "../lib/control-plane/promotion/window.ts";
import { scheduleObligation, isScheduled, type ScheduledObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { retryable } from "../lib/control-plane/scheduler/debt.ts";
import { buildRegistry, registryLines } from "../lib/control-plane/scheduler/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import {
  readCandidateEnrichmentAuthorities,
  loadCandidateEnrichmentProvider,
} from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import {
  campaignSiteSubjectsFromHoldings,
  heldMarginaliaAnswers,
  runCampaignSiteCycle,
  withinWallTime,
  type CampaignSiteCycleReport,
} from "../lib/control-plane/promotion/campaign-site-cycle.ts";
import { runCandidatePublicationCycle,
  type CandidatePublicationCycleReport } from "../lib/control-plane/promotion/campaign-publication-cycle.ts";
import { indexVault, type VaultIndex } from "../lib/control-plane/evidence/read-only-vault.ts";
import {
  MEETINGS_DISCOVERY_NAMESPACE,
  dispatchedAddressSource,
  materializedDiscoveryNeeds,
  meetingsDiscoveryProvider,
  parseMeetingsDiscoveryId,
} from "../lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { preloadRegistrationJurisdictions, stateOfJurisdictionId } from "../lib/registration/jurisdictions.ts";
import type { JurisdictionRegistry } from "../lib/hunt/jurisdiction-universe.ts";
import {
  UNREAD_FREE_DISCOVERY_WALKS,
  promotedRegistries,
  trackedStatesFromOperationalReference,
  type FreeDiscoveryWalks,
  type MaterializedReading,
} from "../lib/control-plane/scheduler/provider-inputs.ts";
import { createMeetingPartitionOwnership } from "../lib/control-plane/scheduler/meeting-ownership.ts";
import { readFreeDiscoveryWalks, type FreeWalkSubject } from "../lib/control-plane/discovery/free-walks.ts";
import { OWNER_DISPATCH } from "../lib/control-plane/scheduler/obligation.ts";
import { foldNewWorkIntoRound, sameRoundFirstHuntEnabled } from "../lib/control-plane/scheduler/same-round-work.ts";
import {
  applyDispatchWork,
  applyManualSourceGaps,
  carriedDispatchTargets,
  dispatchWorkReading,
  dispatchWorkSentence,
  dispatchWorkTarget,
  ownerDispatchWorkOf,
  scopeWorkTarget,
  planDispatchWork,
  orderPlaceWork,
  type DispatchWorkApplied,
  type DispatchWorkReading,
  type DispatchWorkTarget,
  type DurableRowFacts,
  type OwnerDispatchWork,
} from "../lib/control-plane/expansion/dispatch-work.ts";
import { readHeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { missionPartCounts, missionPartsOf } from "../lib/control-plane/expansion/mission-parts.ts";
import { HUNT_PACKET_NAMESPACE } from "../lib/hunt/packet.ts";
import { divisionsOfPlace } from "../lib/hunt/packet-read.ts";
import { readPlaceWords } from "../lib/hunt/place-words.ts";
import { duePackets } from "../lib/hunt/runtime.ts";
import { makeHuntSearch } from "../lib/hunt/search.ts";
import { EXA_AGENT_LANE_SETTING } from "../lib/hunt/settings.ts";
import { preloadAzOperationalReferenceBundle, preloadOperationalReferenceBundle } from "../lib/civic-data/operational-references.ts";
import { methodMaturityFromManual } from "../lib/control-plane/scheduler/maturity.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { heldCalendarRouteBodies } from "../lib/hunt/mission-meetings-discovery.ts";
import {
  walkableByFreeWalk,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { runSpreadPass, sentMoneyPlaces, spreadLine } from "../lib/method/spread-pass.ts";
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import { guardedLeadGet, LEADS_PASS_BUDGET_MS, runLeadsPass } from "../lib/control-plane/leads/plain-test.ts";
import { refreshDoorsForPass } from "../lib/doors/install.ts";
import { durableSearchBudget } from "../lib/control-plane/discovery/search-runtime.ts";
import {
  closeAbandonedOccurrences,
  jurisdictionMeetingsSubject,
  planHeldRouteRetirement,
  scanOccurrences,
  planRetiredResidue,
  planSupersededRetirement,
  settleRetirements,
  settledRouteTaskIds,
  loadDebts,
  openOccurrence,
  resumeOpenOccurrence,
  persistDebts,
  retireObligationsByPrefix,
  syncObligations,
  type AbandonedOccurrence,
  type SettledOccurrence,
  FRESHNESS_PROJECT,
} from "../lib/control-plane/scheduler/durable.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import {
  decideExecutor,
  type DeclaredExecutor,
  type DispatchResult,
  type ExecutorDecision,
  type RunWork,
} from "../lib/control-plane/scheduler/dispatch.ts";
import { anthropicTransport, scoutJobWorstCaseUsd } from "../lib/control-plane/scheduler/scout-executor.ts";
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
import { readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { readMethodKnowledge } from "../lib/method/manual-bridge.ts";
import { candidateCounts as countMethodCandidates, emptyCandidateStore } from "../lib/method/candidate.ts";
import { readConclusionStore } from "../lib/method/conclusions.ts";
import {
  NO_PIPELINE_RECORDED,
  cacheDefectCounts,
  cacheHitRateByRole,
  costPerUsefulOutcome,
  graduationFunnel,
  modelShareTrend,
  orderByReaderImpact,
  orderableDueRow,
  scoutCapacity,
  type DispatchOrdering,
  type OrderingInputs,
  type ResearchMetrics,
} from "../lib/control-plane/research-metrics.ts";
import { researchDigestLines } from "../lib/control-plane/research-digest.ts";
import { readSpendWindow } from "../lib/control-plane/spend-window.ts";
import { coordinatorLane, lanesAtCycleEnd, lanesInFlight, type QueueLanes } from "../lib/control-plane/scheduler/lane-reading.ts";
import type { CacheHitRate } from "../lib/control-plane/research-metrics.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "../lib/control-plane/owner-surface.ts";
import type { FreshnessCycleOutcome } from "../lib/control-plane/owner-surface.ts";
import {
  appendFreshnessCycleDigest,
} from "../lib/control-plane/freshness-cycle-outcome.ts";
import { DIGEST_LOG_KEY } from "../lib/control-plane/admin-data.ts";
import {
  FLEET_SAFETY_BOUNDS,
  FleetSafetyController,
  FleetPreSendRefusal,
  resolveRollingCeiling,
  type PricedCharge,
  type ProviderCircuit,
} from "../lib/control-plane/fleet-safety.ts";
import {
  ADMIN_CONFIG_ID,
  adminConfigForPaidWork,
  discoverySearchEnabled,
  fleetSpendCeilingOverrideUsd,
  isAdminConfig,
  type AdminConfig,
  type AdminConfigRead,
} from "../lib/control-plane/gateway/admin-config.ts";
import { readSetting, runnerSettingsEcho } from "../lib/control-plane/settings.ts";
import { installNeonCircuitBreaker, readNeonCircuit } from "../lib/control-plane/neon-circuit.ts";
import { retryStartupRead } from "../lib/control-plane/startup-read-retry.ts";
import { modelLaneClosure, pendingResearchLaneAcknowledgment } from "../lib/control-plane/scheduler/model-lane.ts";
import {
  armExpansionBudget,
  countByScope,
  orderByPlacement,
  withCycleCounts,
} from "../lib/control-plane/expansion/membership.ts";
import type { ExpansionCycleReading } from "../lib/control-plane/expansion/reading.ts";
import { loadExpansionPlan, readCensusUnitTerritories, readTerritoryIndex } from "../lib/control-plane/expansion/runner-load.ts";
import {
  armAssignmentBudget,
  assignmentBudgetsOf,
  assignmentCycleReading,
  assignmentMembership,
  malformedAssignmentBudgetsOf,
  type AssignmentBudgetGate,
  type AssignmentCycleReading,
} from "../lib/control-plane/expansion/assignment-budget.ts";
import {
  DurableSpendHolds,
  SendBudgetRefusal,
  SPEND_HOLD_STALE_MS,
} from "../lib/control-plane/expansion/spend-holds.ts";
import { evaluateAssignmentFromRecords, evaluateMissionDone, memberRecordsForSend, missionMapCount, type MissionMapCount } from "../lib/control-plane/assignment-completion.ts";
import { installNeonRequestDeadline } from "../lib/ops/neon-request-deadline.ts";
import { runIndependentRuntimePass, type IndependentRuntimeOutcome } from "../lib/ops/independent-runtime-pass.ts";
import { withControlPlaneConnectRetry } from "../lib/control-plane/repository/connect-retry.ts";
import {
  isControlPlaneRequestTimeout,
  observeControlPlaneTimeouts,
} from "../lib/control-plane/repository/request-bounds.ts";
import {
  PendingOperations,
  describePending,
  trackStoreCalls,
  type CycleStallDiagnostic,
} from "../lib/control-plane/scheduler/cycle-stall.ts";
import { answerStallProbes, roundProgressReporter } from "../lib/control-plane/scheduler/round-progress.ts";
import { RUNTIME_NO_PROGRESS_MS } from "./pilot-runtime-child.mts";
import { POST_CUTOFF_QUIET_LEAD_MS, untilQuietLimit, watchOutputClock } from "../lib/control-plane/scheduler/post-cutoff-bound.ts";
import { recordFailedCycle } from "../lib/control-plane/scheduler/cycle-finalization.ts";
import { CYCLE_DRAIN_GRACE_MS, chosenExitCode, exitAfterDrainGrace } from "../lib/control-plane/scheduler/cycle-exit.ts";
import { readRunProvenance } from "../lib/ops/run-provenance.ts";
import { headSha } from "../lib/ops/git-facts.ts";
import { readCodeIdentity } from "../lib/control-plane/code-identity.ts";
import { nextRunRecordPath } from "../lib/health/run-records.ts";
import { floorLine, floored } from "../lib/ops/denominator-floor.ts";
import { today } from "./doc-dates.mjs";
import { assertRuntimeAuthority } from "../lib/civic-data/runtime-authority.ts";
import { countVitalSign } from "../lib/db/transfer-by-caller.ts";
import { VITAL_COUNTERS } from "../lib/control-plane/vital-signs.ts";
import { readFromHeldCopies } from "../lib/control-plane/repository/incremental-reads.ts";

readFromHeldCopies();

const hostWorkerSlots = workerProcessSlots(() => Number.MAX_SAFE_INTEGER,
  { parentPeakBytes: RESEARCH_PARENT_PEAK_MIB * 1024 * 1024, admissionsOpen: () => !releaseDrainRequested });

const ROOT = process.cwd();
const CONTROL_PLANE_ROOT = join(ROOT, ".runtime", "control-plane", "freshness-shadow");
const RUNS_DIR = join(ROOT, ".runtime", "freshness-shadow-runs");
const NOW = new Date().toISOString();
const HOST = hostname();
const nowIso = (): string => new Date().toISOString();

const RUNNING_CODE_SHA = headSha(ROOT);
/* The provenance is of the tree this run STARTED from (run-provenance.ts): read here, not by git calls in finalization. */
const RUN_PROVENANCE = readRunProvenance(RUNNING_CODE_SHA, ROOT);
const CYCLE_ID = `freshness-cycle:${HOST}:${NOW}`;
const RUN_RECORD_PATH = nextRunRecordPath(RUNS_DIR, today());
const pending = new PendingOperations();
/* The runner asks what the round waits on shortly before its no-progress limit; the answer names the phase (round-progress.ts). */
answerStallProbes({ describe: () => describePending(pending.snapshot()) });
/* Finished tasks of the long phases (dispatch, worker wave, meetings walks) are progress the runner can see. */
const roundProgress = roundProgressReporter();

const outputClock = watchOutputClock();
const POST_CUTOFF_QUIET_MS = RUNTIME_NO_PROGRESS_MS - POST_CUTOFF_QUIET_LEAD_MS;
const boundedAfterCutoff = <T,>(work: Promise<T>) => untilQuietLimit(work, { clock: outputClock, quietMs: POST_CUTOFF_QUIET_MS });
const stallDiagnostic: CycleStallDiagnostic | null = null;
/** True once the cycle wrote its own record; a later failure must not overwrite it. */
let finalRecordWritten = false;

/** The cycle's local record at the reserved path, carrying the stall block forward if the diagnostic fired. */
function writeCycleRecord(record: Readonly<Record<string, unknown>>): string {
  const stallBlock = finalRecordWritten ? null : (stallDiagnostic?.claimRecord() ?? null);
  const path = finalRecordWritten ? nextRunRecordPath(RUNS_DIR, today()) : RUN_RECORD_PATH;
  mkdirSync(RUNS_DIR, { recursive: true });
  writeFileSync(path, `${JSON.stringify(stallBlock === null ? record : { ...record, stallDiagnostic: stallBlock }, null, 2)}\n`, "utf8");
  finalRecordWritten = true;
  return path;
}

let crashRecorded = false;
let crashRepos: ControlPlaneRepositories | null = null;
/** Set once the round's paid jobs exist: settles every job the round never settled, so a failed round leaves no hold behind. */
let releaseRoundHolds: (() => Promise<readonly string[]>) | null = null;
const SPEND_HOLD_STALE_HOURS = SPEND_HOLD_STALE_MS / 3_600_000;
/** How long a failing round waits on that release before it records its outcome anyway. */
const CRASH_HOLD_RELEASE_MS = 5_000;
async function recordCrash(error: unknown): Promise<void> {
  if (crashRecorded) return;
  crashRecorded = true;
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error);
  const headline = message.split("\n")[0];
  /* What the cycle was waiting on when it failed, taken before the crash's own label is entered. */
  const pendingAtCrash = pending.snapshot();
  /* A hold the failed round never settled must not outlive it. Bounded: the outcome is recorded either way. */
  if (releaseRoundHolds !== null) {
    const release = releaseRoundHolds;
    await Promise.race([release().then((failed) => { if (failed.length) console.error(`  budget holds not released: ${failed.join("; ")}`); }, () => undefined),
      new Promise<void>((done) => setTimeout(done, CRASH_HOLD_RELEASE_MS).unref())]);
  }
  const result = await pending.step("crash:record", () => recordFailedCycle({
    repos: crashRepos,
    error,
    cycleId: CYCLE_ID,
    startedAt: NOW,
    finishedAt: new Date().toISOString(),
    testedSha: RUNNING_CODE_SHA,
    host: HOST,
    pending: pendingAtCrash,
    writeLocalRecord: writeCycleRecord,
    log: (line) => console.error(line),
  }));
  if (result.recordPath !== null) {
    console.error(`\n  freshness:shadow CRASHED — ${headline}`);
    console.log(`  local diagnostic: ${result.recordPath}`);
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
/* The runner could not read the owner's intents before starting this cycle; the paid lane stays closed. */
const ownerIntentsUnreadableByRunner = argv.includes("--owner-intents-unreadable");
const canary = argv.includes("--canary");
const boundedNumber = (raw: string | undefined, fallback: number, maximum: number): number => {
  const parsed = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
};

const ceilingArg = argv.find((a) => a.startsWith("--max="));
const MAX_DISPATCHES = canary
  ? 1
  : boundedNumber(ceilingArg?.slice("--max=".length), Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY);
const SCOUT_JOB_WORST_CASE_USD = scoutJobWorstCaseUsd(RESEARCH_BOUNDS.perDispatch);
const intervalArg = argv.find((a) => a.startsWith("--interval="));
const INTERVAL_MIN = intervalArg ? Number(intervalArg.slice("--interval=".length)) : null;
const onlyArg = argv.find((a) => a.startsWith("--only="));
const ONLY = onlyArg ? onlyArg.slice("--only=".length) : null;
/* Exact obligation ids, comma-separated. A DIAGNOSTIC filter like --only, for a proof run. */
const idsArg = argv.find((a) => a.startsWith("--ids="));
const IDS = idsArg ? new Set(idsArg.slice("--ids=".length).split(",").map((s) => s.trim()).filter(Boolean)) : null;
const filteredCycle = canary || IDS !== null || ONLY !== null;
if (canary && (IDS === null || IDS.size !== 1)) {
  console.error("freshness:shadow · --canary requires exactly one registered obligation via --ids=<id>.");
  process.exit(1);
}
observeControlPlaneTimeouts((timeout) => console.error(`freshness:shadow · ${timeout.message}`));

/* ------------------------------------------------------------- provider --- */

let repos: ControlPlaneRepositories;
if (wantsPostgres) {
  installNeonCircuitBreaker(ROOT, nowIso);
  // Bound EACH Neon connect/query attempt. Without this, the
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
  repos = await pending.step("control-plane:open", () => createPgRepositories(url, NOW));
} else {
  mkdirSync(CONTROL_PLANE_ROOT, { recursive: true });
  repos = await createFileRepositories(CONTROL_PLANE_ROOT);
}
const cycleObservation = observeCyclePhases(repos);
/* Every repository call is tracked while in flight, for the stall diagnostic. */
repos = trackStoreCalls(cycleObservation.repos, pending);
crashRepos = repos;
const finishPhase = (name: string) => {
  const phase = cycleObservation.finish(name);
  pending.phaseFinished(name);
  console.log(`  phase ${phase.name}: ${phase.durationMs}ms; ${phase.repositoryCalls} repository calls`);
};

const startupReadRetry = {
  circuitLatched: () => readNeonCircuit(ROOT, nowIso()) !== null,
  onRetry: ({ attempt, delayMs, error }: { readonly attempt: number; readonly delayMs: number; readonly error: unknown }) =>
    console.error(
      `freshness:shadow · startup read retry ${attempt} in ${delayMs}ms: ${error instanceof Error ? error.message : String(error)}`,
    ),
};

const [legacyOperationalReference, azOperationalReference] = await Promise.all([retryStartupRead(
  () => preloadOperationalReferenceBundle({ bypassCache: true }), () => null, startupReadRetry,
).catch(error => {
  console.log(`  legacy multi-state operational reference unavailable: ${error instanceof Error ? error.message : String(error)}`);
  return null;
}), retryStartupRead(
  () => preloadAzOperationalReferenceBundle({ bypassCache: true }), () => null, startupReadRetry,
).catch(error => {
  console.log(`  scoped AZ operational reference unavailable: ${error instanceof Error ? error.message : String(error)}`);
  return null;
})]);
if (!legacyOperationalReference && !azOperationalReference) throw new Error(
  "OPERATIONAL_REFERENCE_READ_NOT_INITIALIZED: neither the scoped AZ pointer nor the legacy reviewed pointer could be read",
);

/* The meeting doors this cycle's meeting work, facts and Ask gaps are read against, straight from the registry. */
{
  const doors = await refreshDoorsForPass(repos.doors);
  console.log(`  meeting doors: ${doors.rows} read from the registry${doors.reason ? ` — ${doors.reason}` : ""}`);
}

const CYCLE_LEASE_HOLDER = `cycle@${HOST}#${process.pid}`;
const CYCLE_LEASE_TTL_MS = 25 * 60_000;
try {
  await pending.step("startup:cycle-lease", () => acquireWindowLease(repos, CYCLE_LEASE_HOLDER, nowIso(), CYCLE_LEASE_TTL_MS, startupReadRetry));
} catch (error) {
  if (error instanceof WindowLockHeld) {
    console.error(`freshness:shadow · REFUSED under the nightly window: ${error.message}`);
    process.exit(3);
  }
  throw error;
}

/* ----------------------------------------------------------- the registry --- */

const trackedStates = trackedStatesFromOperationalReference();
const meetingPartitions = createMeetingPartitionOwnership({ root: ROOT });
let materialized: MaterializedReading;
try {
  const rows = await repos.obligations.listWhere(["materializedBy"], OWNER_DISPATCH);
  materialized = { ids: new Set(rows.map((row) => row.id)) };
} catch (error) {
  materialized = { unreadable: error instanceof Error ? error.message : String(error) };
}
/* A state with created work and no reviewed registry is read from its registration first, so its providers keep that work. */
if ("ids" in materialized) {
  await preloadRegistrationJurisdictions({ root: ROOT, states: [...materialized.ids].flatMap((id) => stateOfJurisdictionId(id) ?? []), options: { bypassCache: true } });
}
const ownershipStates = trackedStates.read();
await meetingPartitions.readStates([
  ...("states" in ownershipStates ? ownershipStates.states : []),
  ...("ids" in materialized ? [...materialized.ids].flatMap(id => stateOfJurisdictionId(id) ?? []) : []),
]);
/* The providers and context are kept so the registry can be built again in the same round when the owner's dispatch has just written new work. */
const registryProviders = [
  huntPacketsProvider({ materialized: () => materialized }),
  campaignFinanceProvider(),
  localJurisdictionsProvider({ trackedStates, materialized: () => materialized, meetingPartitions }),
  await loadCandidateEnrichmentProvider(trackedStates, { root: ROOT, nowIso: NOW }),
  meetingsDiscoveryProvider({ materialized: () => materialized }),

  (await import("../lib/control-plane/scheduler/providers/ask-gaps.ts")).askGapsProvider(
    await pending.step("ask-gaps:held-reading", async () =>
      (await import("../lib/control-plane/scheduler/ask-gap-holdings.ts")).askGapsInputFromHeld({ now: NOW, observations: repos.askGapObservations })),
  ),
];
/* Every unplanned paid route carries the shared coordinator plan. */
const registryContext = { root: ROOT, nowIso: NOW };
let registry = buildRegistry(registryProviders, registryContext);
const trackedReading = trackedStates.read();
const trackedStateCodes: readonly string[] = "states" in trackedReading ? trackedReading.states : [];

let allUnits = registry.units;
let units = allUnits.filter(
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
const meetingsRetirement = filteredCycle ? { retired: [], alreadyRetired: [] } : await retireObligationsByPrefix(
  repos,
  [LEGACY_MEETINGS_OBLIGATION_PREFIX],
  NOW,
  LEGACY_MEETINGS_RETIREMENT_REASON,
);
console.log(
  `  legacy tracked-snapshot meetings clocks: ${meetingsRetirement.retired.length} retired this cycle; ` +
    `${meetingsRetirement.alreadyRetired.length} already inactive with no next-due`,
);
const factClockRetirement = filteredCycle ? { retired: [], alreadyRetired: [] } : await retireObligationsByPrefix(
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
const fecModelRetirement = filteredCycle ? { retired: [], alreadyRetired: [] } : await retireObligationsByPrefix(
  repos,
  [LEGACY_FEC_MODEL_OBLIGATION_PREFIX],
  NOW,
  "PDC authority transferred federal acquisition to the FEC_FUNDING / federal-supported production civic-data contract",
);
console.log(
  `  legacy parallel federal campaign-finance clocks: ${fecModelRetirement.retired.length} retired this cycle; ` +
    `${fecModelRetirement.alreadyRetired.length} already inactive with no next-due`,
);

let sync = await syncObligations(repos, corpus, NOW, { exactReads: filteredCycle });
finishPhase("references-and-registration");
console.log(`  hunt packets: ${sync.all.filter(o => o.active && o.id.startsWith(HUNT_PACKET_NAMESPACE)).length} government(s) an order sent agents to`);
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

const maturity = await methodMaturityFromManual(repos);
const decisions = new Map<string, ExecutorDecision>();
const decisionFor = (obligationId: string, routeId: string | null): ExecutorDecision => {
  const held = decisions.get(obligationId);
  if (held !== undefined) return held;
  const d = decideExecutor({ routeId, descriptor: registry.routeFor(obligationId), maturity });
  decisions.set(obligationId, d);
  return d;
};
for (const u of units) decisionFor(u.obligation.id, u.obligation.routeId);
const decisionDisagreements = units
  .map((u) => ({ obligationId: u.obligation.id, disagreement: decisions.get(u.obligation.id)?.disagreement ?? null }))
  .filter((d) => d.disagreement !== null);

/* ------------------------------------------------------- the occurrences --- */

const nowMs = Date.parse(NOW);
/** Named runtime conditions, accumulated from here on; the research state carries them. */
const runtimeConditions: string[] = [];

const retirementWrites = !dry && !canary;
const retirementOutside = sync.outside !== null && ONLY === null && IDS === null ? sync.outside : null;
const residueItems = retirementOutside === null ? [] : planRetiredResidue(retirementOutside);
const corpusUnits = allUnits.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id }));

const dispatchedDiscoveryIds = sync.all.filter(row => row.materializedBy === OWNER_DISPATCH).map((o) => o.id).filter((id) => id.startsWith(MEETINGS_DISCOVERY_NAMESPACE));
const dispatchedDiscovery = materializedDiscoveryNeeds(dispatchedDiscoveryIds);
/* A dispatched or mission need's address comes from the promoted jurisdiction reference, or its state's registration; it carries that version (NH330). */
const withAddressSource = (e: { readonly need: MeetingsDiscoveryNeed; readonly reg: Parameters<typeof dispatchedAddressSource>[0] }): MeetingsDiscoveryNeed =>
  ({ ...e.need, addressSource: dispatchedAddressSource(e.reg,
    (e.reg.stateCode.toLowerCase() === "az" ? azOperationalReference ?? legacyOperationalReference : legacyOperationalReference)?.metadata.versionId ?? null) });
const dispatchedNeeds = new Map(dispatchedDiscovery.entries.map((e) => [e.need.jurisdictionId, withAddressSource(e)]));

const freeWalkSubjects: readonly FreeWalkSubject[] = [
  ...new Set(dispatchedDiscoveryIds.flatMap((id) => parseMeetingsDiscoveryId(id)?.jurisdictionId ?? [])),
].map((jurisdictionId) => {
  const need = dispatchedNeeds.get(jurisdictionId);
  return { jurisdictionId, walkable: need === undefined ? null : walkableByFreeWalk(need) };
});
let freeWalks: FreeDiscoveryWalks = UNREAD_FREE_DISCOVERY_WALKS;

const corpusIds = new Set(corpusUnits.map((u) => u.obligationId));
const heldRouteCandidates = retirementOutside === null ? [] : [...new Set(retirementOutside
  .filter((row) => row.active && !corpusIds.has(row.id))
  .flatMap((row) => jurisdictionMeetingsSubject(row.id) ?? []))];
const heldRouteRead = retirementOutside === null ? null : await (async () => {
  try {
    if (heldRouteCandidates.length === 0) return { bodyIdFor: () => null, held: new Set<string>() };
    await meetingPartitions.readStates(heldRouteCandidates.map((id) => id.split(":")[0] ?? ""));
    const bodyIdFor = (id: string): string | null => meetingPartitions.bodyIdFor?.(id) ?? null;
    const divisions = [...new Set(heldRouteCandidates.flatMap((id) => bodyIdFor(id)?.split("#")[0] ?? []))];
    if (divisions.length === 0) return { bodyIdFor, held: new Set<string>() };
    const capture = await readHeldPlaceCapture(divisions, { now: NOW, bypassCache: true });
    const rows = buildPlaceOwedList({ divisions: divisions.map((id) => ({ id, label: id })), subjects: capture.subjects, held: capture.held, now: NOW });
    const held = heldCalendarRouteBodies(rows);
    console.log(`  retirement evidence: ${heldRouteCandidates.length} government(s) with an old meetings row, ${held.size} body(ies) with a held calendar route`);
    return { bodyIdFor, held };
  } catch (error) {
    return { unreadable: error instanceof Error ? error.message : String(error) };
  }
})();
const movedPlan =
  retirementOutside === null || heldRouteRead === null
    ? null
    : planHeldRouteRetirement({
        outside: retirementOutside,
        corpus: corpusUnits,
        providers: registry.byProvider,
        routes: heldRouteRead,
      });
const supersededPlan =
  retirementOutside === null || movedPlan === null
    ? null
    : planSupersededRetirement({
        outside: retirementOutside.filter((row) => !movedPlan.owned.has(row.id)),
        corpus: corpusUnits,
        providers: registry.byProvider,
      });
const retirementHeldBack = [...(movedPlan?.heldBack ?? []), ...(supersededPlan?.heldBack ?? [])];
const retirementHolds = retirementHeldBack.reduce<Record<string, number>>(
  (m, h) => ((m[h.code] = (m[h.code] ?? 0) + 1), m),
  {},
);

let retirementApplied: Awaited<ReturnType<typeof settleRetirements>> | null = null;
let retirementError: string | null = null;
/** Retired obligations, id → reason: their debt stays out of the cycle and is tombstoned as retired. */
const retiredDebtReasons = new Map<string, string>();
if (movedPlan !== null && supersededPlan !== null && retirementOutside !== null) {
  const items = [...residueItems, ...supersededPlan.retire, ...movedPlan.retire];
  console.log(
    `  retirement: ${movedPlan.retire.length} with a held calendar route, ${supersededPlan.retire.length} superseded, ` +
      `${residueItems.length} retired row(s) still holding an occurrence` +
      (retirementHeldBack.length > 0 ? `; held back ${JSON.stringify(retirementHolds)}` : "") +
      (retirementWrites ? "" : " (plan only: this cycle writes nothing)"),
  );
  if (retirementWrites) {
    if (items.length > 0) {
      try {
        retirementApplied = await settleRetirements(repos, {
          items,
          now: NOW,
          budget: { spent: () => false },
        });
        console.log(
          `  retirement: ${retirementApplied.retired.length} obligation(s) retired, ` +
            `${retirementApplied.occurrencesClosed.length} open occurrence(s) closed unresolved` +
            (retirementApplied.failed.length > 0 ? `, ${retirementApplied.failed.length} did not complete and are planned again` : "") +
            (retirementApplied.deferred.length > 0
              ? `, ${retirementApplied.deferred.length} deferred untouched to the next cycle (remaining retirement work)`
              : ""),
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
/* The move takes several cycles under the budget, so every cycle says how many moved and how many remain. */
const movedIds = new Set((movedPlan?.retire ?? []).map((item) => item.obligationId));
const movedThisCycle = (retirementApplied?.retired ?? []).filter((id) => movedIds.has(id)).length;
const movedRemaining = movedIds.size - movedThisCycle;
if (movedIds.size > 0) {
  console.log(`  retirement: ${movedThisCycle} row(s) with a held calendar route retired this cycle, ${movedRemaining} remain`);
}
finishPhase("retirement");
const occurrenceByObligation = new Map<string, { id: string; routeTaskId: string }>();
let openedDeterministic = 0;
let openedModel = 0;
/** Occurrences a previous cycle opened and did not reach, picked back up. */
/** Obligations whose open/resume threw and were isolated. Never silent. */
const preOpenSkipped: { obligationId: string; why: string }[] = [];
const dueThisCycle: { obligation: (typeof sync.all)[number]; nextDueAt: string; cadenceHours: number }[] = [];

/* A retired obligation owes no freshness: its debt stays out of the cycle, and `persistDebts` tombstones it as retired. */
const debtsIn = (canary
  ? (await Promise.all(corpus.map((obligation) => repos.debts.read(obligation.id))))
      .filter((row) => row !== null)
      .map((row) => row.value)
  : await loadDebts(repos)
).filter((debt) => !retiredDebtReasons.has(debt.obligationId));
/* The plain-code lane's queue key reads this debt (`waitingSince`); so does its reading while the cycle runs. */
const debtAtCycleStart = new Map(debtsIn.map((d) => [d.obligationId, d] as const));

let settingsConfig: AdminConfig | null = null;
try {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  settingsConfig = row !== null && isAdminConfig(row.value) ? row.value : null;
} catch (error) {
  runtimeConditions.push(`Admin settings could not be read; code defaults apply this round: ${error instanceof Error ? error.message : String(error)}`);
}
const modelClassUnits = units.filter((u) => decisions.get(u.obligation.id)?.kind === "BOUNDED_MODEL_WORKER");
const debtIds = new Set(debtsIn.filter((d) => d.consecutiveFailures > 0).map((d) => d.obligationId));
const retryNow = new Set(retryable(debtsIn, nowMs).map((d) => d.obligationId));
const backedOff = new Set([...debtIds].filter((id) => !retryNow.has(id)));
console.log(
  `  freshness debt inherited from earlier processes: ${debtIds.size} open row(s)` +
    (debtIds.size === 0 ? "" : ` — ${[...debtIds].slice(0, 3).join(", ")}${debtIds.size > 3 ? " …" : ""}`),
);

// A completed, reader-verified publication is the source's next freshness
// observation even when it was made by a linked repair child. Persist that
// clock before deciding which standing source periods are due this cycle.
const standingLineages = sync.all.some(o => o.autonomousPlan) ? await (async () => {
  const [occurrences, workItems, artifacts, attempts, workerResults] = await Promise.all([
    repos.occurrences.list(), repos.workItems.list(), repos.artifacts.readAllNarrowed(LINEAGE_ARTIFACT_FIELDS),
    repos.attempts.listNarrowed(LINEAGE_ATTEMPT_FIELDS), repos.workerResults.readAll(),
  ]);
  return selectStandingLineages({ occurrences: occurrences.map(row => row.value), workItems: workItems.map(row => row.value),
    artifacts: artifacts as LineageArtifact[], attempts: attempts.map(row => row.value as LineageAttempt), workerResults });
})() : [];
const publicationAnchors = await persistVerifiedPublicationAnchors(repos, { obligations: sync.all, lineages: standingLineages, now: NOW });
if (publicationAnchors.anchored.length) {
  sync = { ...sync, all: sync.all.map(o => publicationAnchors.updated.get(o.id) ?? o) };
  console.log(`  verified standing publications advanced ${publicationAnchors.anchored.length} source clock(s)`);
}

const nextDueWrites: string[] = [];
for (const o of sync.all) {
  const row = scheduleObligation(o, nowMs);
  if (!isScheduled(row)) continue;
  /* Do not pay a round trip to write a value that is already there. */
  if (o.nextDueAt !== row.nextDueAt) {
    nextDueWrites.push(o.id);
  }
  if (backedOff.has(o.id)) continue;
  const isDue = Date.parse(row.nextDueAt) <= nowMs || retryNow.has(o.id);
  if (!isDue) continue;
  dueThisCycle.push({ obligation: o, nextDueAt: row.nextDueAt, cadenceHours: row.cadenceHours });
}

// A discovery-only standing disposition does not settle downstream parsing,
// verification or publication. Continue the same recorded source period instead
// of opening another paid root every cycle while its actual work remains owed.
const continuedStandingLineages: { obligationId: string; rootWorkItemId: string }[] = [];
if (dueThisCycle.some(row => plannedForHunters(row.obligation.autonomousPlan) && row.obligation.openOccurrenceId === null)) {
  for (let i = dueThisCycle.length - 1; i >= 0; i--) {
    const row = dueThisCycle[i]!;
    const o = row.obligation;
    if (!plannedForHunters(o.autonomousPlan) || o.openOccurrenceId !== null) continue;
    const key = standingLineageKeyFor({ obligationId: o.id, dueAt: row.nextDueAt, project: FRESHNESS_PROJECT,
      subject: o.subjectId, plan: o.autonomousPlan, instructionReceipts: (o.assignments ?? []).map(mark => mark.ref) });
    if (!key) continue;
    const held = standingLineageCoversDue({lineages:standingLineages,key,now:NOW,cadenceHours:row.cadenceHours});
    if (!held) continue;
    continuedStandingLineages.push({obligationId:o.id,rootWorkItemId:held.rootWorkItemId});
    dueThisCycle.splice(i, 1);
  }
}
if (continuedStandingLineages.length) console.log(`  standing source periods continued: ${continuedStandingLineages.length}; no duplicate Scout root opened; canonical roots ${continuedStandingLineages.slice(0, 3).map(row=>row.rootWorkItemId).join(", ")}${continuedStandingLineages.length>3?" …":""}`);

/* A packet is sent only while it has an open blank and something changed since its last job. */
{
  const packetRows = dueThisCycle.filter(row => row.obligation.id.startsWith(HUNT_PACKET_NAMESPACE));
  if (packetRows.length > 0) {
    try {
      const due = await duePackets(repos, packetRows.map(row => ({ governmentId: row.obligation.subjectId, assignments: row.obligation.assignments })), NOW);
      const waiting = packetRows.filter(row => due.get(row.obligation.subjectId)?.due !== true);
      for (const row of waiting) dueThisCycle.splice(dueThisCycle.indexOf(row), 1);
      console.log(`  hunt packets: ${packetRows.length - waiting.length} of ${packetRows.length} due to be sent` +
        (waiting.length ? `; waiting: ${waiting.slice(0, 3).map(row => `${row.obligation.subjectId} (${due.get(row.obligation.subjectId)?.why ?? "unread"})`).join("; ")}${waiting.length > 3 ? " …" : ""}` : ""));
    } catch (error) {
      runtimeConditions.push(`hunt packets could not be read (${error instanceof Error ? error.message : String(error)}); none is sent this round`);
      for (const row of packetRows) dueThisCycle.splice(dueThisCycle.indexOf(row), 1);
    }
  }
}

/* ------------------------------------------------- the owner's intents --- */

let intentLog: ResearchIntent[] = [];
let intentLogUnreadable: string | null = null;
try {
  intentLog = [...(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY))];
} catch (error) {
  intentLogUnreadable = error instanceof Error ? error.message : String(error);
  runtimeConditions.push(
    `research intents could not be read (${intentLogUnreadable}); the paid model lane stays closed this cycle as if paused, ` +
      "and plain-code work, routine intake and free discovery walks continue",
  );
}
const intents = readIntents(intentLog);

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

/* A CANCEL_DISPATCH is honored by the cycle that stops carrying the Send it names (the filter is in carriedDispatchTargets). */
for (const pending of intents.pendingCancel) {
  await honorIntent(pending, `${pending.note} is no longer carried: the cycle creates nothing more for it. Work it already created stays.`);
}

/* A pending RUN_CYCLE_NOW is honored by the cycle that runs. This is it. */
const honoredIntents: string[] = [];
for (const pending of intents.pendingRunNow) {
  if (await honorIntent(pending, "a cycle ran; whether it started early or on the interval is the runner's record")) {
    honoredIntents.push(pending.intentId);
  }
}

interface OwnerDispatchRecord {
  readonly intentId: string;
  readonly target: string;
  readonly states: readonly string[];
  readonly matched: number;
  readonly registered: number;
  /** Filled after the creation step, so the record carries what the DISPATCH created. */
  readonly work?: OwnerDispatchWork | null;
}
const ownerDispatches: OwnerDispatchRecord[] = [];
const honoredDispatch: string[] = [];
const dispatchPriority = new Set<string>();
/** Obligation id -> the DISPATCH keys this cycle matched it under (the fallback when the dispatch-work plan could not be made). */
const dispatchMatchReached = new Map<string, string[]>();
/** The DISPATCH intents this cycle reads, with the matching sentence each HONORED record opens with. */
const dispatchDetails: { readonly intent: ResearchIntentRequest; readonly detail: string }[] = [];
for (const pending of intents.pendingDispatch) {
  const target = parseDispatchTarget(pending.note ?? "");
  const matched = allUnits.filter((u) =>
    unitMatchesTarget(target, { id: u.obligation.id, subjectId: u.obligation.subjectId }),
  );
  const matchedIds = new Set(matched.map((u) => u.obligation.id));
  for (const id of matchedIds) dispatchPriority.add(id);
  /* The Send this cycle reached each matched row under, whether or not its record gets written (the budget gate holds the gap). */
  for (const id of matchedIds) dispatchMatchReached.set(id, [...(dispatchMatchReached.get(id) ?? []), `dispatch:${pending.intentId}`]);
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
  console.log(
    `  owner dispatch: ${detail}` +
      (matched.length > 0 ? ` ${dueAmongMatched} of the ${matched.length} are due this cycle; the rest keep their next-due.` : ""),
  );
}

const promoted = promotedRegistries();
/** The registries as read now: the ones above, and every state's registration read since. */
const registriesNow = (fallback: ReadonlyMap<string, JurisdictionRegistry>): ReadonlyMap<string, JurisdictionRegistry> => {
  const now = promotedRegistries();
  return "registries" in now ? now.registries : fallback;
};
if ("refused" in promoted) {
  for (const [state, why] of promoted.refused) {
    runtimeConditions.push(`the promoted ${state.toUpperCase()} jurisdiction registry is not read by this runtime (${why}); nothing it defines is placed or created`);
  }
}
const scopeDivisionsByObligation = new Map(allUnits.map(u => [u.obligation.id, u.record.scopeDivisions]));
const expansionLoad = await loadExpansionPlan({
  repos,
  root: ROOT,
  now: NOW,
  obligations: sync.all.map((o) => ({ id: o.id, subjectId: o.subjectId, scopeDivisions: scopeDivisionsByObligation.get(o.id) })),
  /* Each scope state with no reviewed registry is read from its registration before the territory. */
  beforeTerritory: async (states) => {
    const registration = await preloadRegistrationJurisdictions({ root: ROOT, states, options: { bypassCache: true } });
    await meetingPartitions.readStates(states);
    return [...registration.refused].map(
      ([state, why]) => `the ${state.toUpperCase()} registration could not be read as a jurisdiction registry (${why}); nothing in it is placed or created`,
    );
  },
  ...("registries" in promoted ? { loadTerritory: (states: readonly string[], zips: ReadonlySet<string>, places: Parameters<typeof readTerritoryIndex>[4]) => readTerritoryIndex(ROOT, [...registriesNow(promoted.registries).values()], [...states], zips, places) } : {}),
});
runtimeConditions.push(...expansionLoad.conditions);
const expansionPlan = expansionLoad.plan;
const subjectByObligation = new Map(sync.all.map((o) => [o.id, o.subjectId]));
const lifetimeHuntSubjects = new Set((expansionPlan?.scopes ?? [])
  .filter(scope => scope.kind === "RESOLVED" && scope.decision.budgetStartedAt !== null && scope.decision.budgetUsd > 0)
  .flatMap(scope => [...scope.members]));
const lifetimeHuntWorkIds = new Set(sync.all.filter(o => lifetimeHuntSubjects.has(o.subjectId)).map(o => o.id));
const lifetimeHuntWork = (work: string): boolean => lifetimeHuntSubjects.has(work) || lifetimeHuntWorkIds.has(work);
const hasLifetimeHunt = lifetimeHuntSubjects.size > 0;
let placeOrder: readonly string[] = [];
/* Each Send's open blanks by mission part, read with the place order every wave. */
let squadReading: { open: ReadonlyMap<string, ReadonlyMap<string, number>>; parts: ReturnType<typeof missionPartsOf> } | null = null;
/* Each Send's mission map count, read with the place order; `before` is filled from the prior reading when Done is decided. */
let missionMaps = new Map<string, Omit<MissionMapCount, "before">>();
let missionMapUnread: string | null = "the owed list has not been read this round";
let placeOrderDirty = true;
let placeOrderRead: Promise<void> | null = null;
async function refreshPlaceOrder(): Promise<void> {
  if (placeOrderRead) return placeOrderRead;
  if (!placeOrderDirty) return;
  placeOrderDirty = false;
  placeOrderRead = (async () => {
    const scopes = (expansionPlan?.scopes ?? []).filter(scope => scope.kind === "RESOLVED");
    if (!scopes.length) return;
    const divisionsByReceipt = new Map(scopes.map(scope => [scope.decision.receiptId,
      [...new Set([...scope.members].map(subject => subject.split("#")[0]).filter(id => id.startsWith("ocd-division/")))]]));
    const divisionIds = [...new Set([...divisionsByReceipt.values()].flat())];
    const [row, capture] = await Promise.all([repos.adminConfig.read(ADMIN_CONFIG_ID),
      readHeldPlaceCapture(divisionIds, { now: nowIso(), bypassCache: true })]);
    const shortType: Readonly<Record<string, string>> = { zcta: "zcta", county: "county", congressional_district: "cd",
      cbsa: "cbsa", state_leg_upper: "sldu", state_leg_lower: "sldl", state: "state" };
    const places = scopes.map(scope => ({
      key: `${scope.decision.geography.stateAbbr.toLowerCase()}.${shortType[scope.decision.geography.type] ?? scope.decision.geography.type}.${scope.decision.geography.geoid.toLowerCase()}`,
      receiptId: scope.decision.receiptId,
      items: buildPlaceOwedList({ divisions: (divisionsByReceipt.get(scope.decision.receiptId) ?? []).map(id => ({ id, label: id })),
        subjects: capture.subjects, held: capture.held, now: nowIso() }),
    }));
    placeOrder = orderPlaceWork(row?.value, places);
    const parts = missionPartsOf(row !== null && isAdminConfig(row.value) ? row.value : null);
    squadReading = { parts, open: new Map(places.map(place => [place.receiptId,
      new Map(missionPartCounts(place.items, parts).map(count => [count.part, count.open] as const))] as const)) };
    missionMaps = new Map(places.map(place => [place.receiptId, missionMapCount(place.items, null)] as const));
    missionMapUnread = null;
  })().catch(error => {
    const detail = `place priority refresh failed; keeping last order: ${error instanceof Error ? error.message : String(error)}`;
    if (missionMaps.size === 0) missionMapUnread = detail;
    runtimeConditions.push(detail);
    console.warn(`  ${detail}`);
  }).finally(() => { placeOrderRead = null; });
  return placeOrderRead;
}
await refreshPlaceOrder();
const placeRankFor = (() => {
  let rankedOrder: readonly string[] | null = null;
  const bySubject = new Map<string, number>();
  return (subject: string): number | null => {
    if (rankedOrder !== placeOrder) {
      bySubject.clear();
      const receipts = new Map<string, number>();
      placeOrder.forEach((receipt, rank) => { if (!receipts.has(receipt)) receipts.set(receipt, rank); });
      for (const scope of expansionPlan?.scopes ?? []) {
        if (scope.kind !== "RESOLVED") continue;
        const rank = receipts.get(scope.decision.receiptId);
        if (rank === undefined) continue;
        for (const member of scope.members) bySubject.set(member, Math.min(bySubject.get(member) ?? Infinity, rank));
      }
      rankedOrder = placeOrder;
    }
    return bySubject.get(subject) ?? null;
  };
})();
const providerQueue = new ModelProviderQueue({
  ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}) });
/** Current place order first; an unplaced owner dispatch follows the selected places. */
const placementRank = (obligationId: string): number | null => {
  const subject = subjectByObligation.get(obligationId);
  const at = subject === undefined ? null : placeRankFor(subject);
  return at ?? (dispatchPriority.has(obligationId) ? placeOrder.length : null);
};
/** The dispatcher's first rows when NO DISPATCH is pending: every selected scope's work. Null otherwise, so a DISPATCH keeps both lanes. */
const scopePlaceFirst: Set<string> | null =
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

/* Oldest next-due first, behind the owner's dispatch. This order only classifies and counts the rows. The dispatcher orders the plain-code lane by `plainCodeQueueOrder`. */
dueThisCycle.sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));
const dueOrdered = expansionPlan === null
  ? placeFirstRows(dueThisCycle, dispatchPriority)
  : orderByPlacement(dueThisCycle, (d) => placementRank(d.obligation.id));
const dueModel = dueOrdered.filter((d) => decisionFor(d.obligation.id, d.obligation.routeId).kind === "BOUNDED_MODEL_WORKER");
const dueDeterministicRows = dueOrdered.filter((d) => !dueModel.includes(d));
let dueDeterministic = dueDeterministicRows.length;

const orderingInputs: OrderingInputs = {};
/* Both the recorded queue and the live pool read each row through `orderableDueRow`, with the debt it carried in: longest wait first within a band. */
const modelOrder = orderByReaderImpact(
  dueModel.map((d) => ({
    ...orderableDueRow(d, registry.providerOf(d.obligation.id), debtAtCycleStart.get(d.obligation.id)),
    entry: d,
  })),
  orderingInputs,
);
const dispatchOrdering: DispatchOrdering | null = dueModel.length === 0 ? null : modelOrder.ordering;
/* The owner's dispatch goes ahead of the bands; within each group the band order stands. With expansion scopes selected, the same
   DISPATCH-first order continues scope by scope (priority 1 first) before the rest. */
const scoutOrder = expansionPlan === null
  ? [
      ...modelOrder.ordered.filter((b) => dispatchPriority.has(b.row.id)),
      ...modelOrder.ordered.filter((b) => !dispatchPriority.has(b.row.id)),
    ]
  : orderByPlacement(modelOrder.ordered, (b) => placementRank(b.row.id));

let roundMethodVersionRead: Promise<number> | null = null;
const roundMethodVersion = (): Promise<number> => {
  roundMethodVersionRead ??= readMethodKnowledge(repos).then((knowledge) => knowledge.version,
    (error: unknown) => { roundMethodVersionRead = null; throw error; });
  return roundMethodVersionRead;
};
/* Plain-code intake: an unreadable intent log does not stop it (the paid lane is what fails closed, above). */
if (!dry && !canary && !intents.runnerPause.paused) {
  try {
    const retained = await retainRecentRoutineMeetingEvidence({ repos,
      store: new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)),
      methodVersion: await roundMethodVersion(), now: nowIso });
    console.log(`  permanent meeting captures retained for independent workers: ${retained.length}`);
  } catch (error) {
    runtimeConditions.push(`permanent meeting evidence could not enter independent workers: ${error instanceof Error ? error.message : "ROUTINE_MEETING_INTAKE_FAILED"}`);
  }
}
const recoveryRepos = filteredCycle ? await selectedCycleRepositories(repos, sync.all.map(row => row.id)) : repos;
const allPlannedWork = canary ? [] : (await recoveryRepos.workItems.list()).filter(item =>
  plannedForHunters(item.value.autonomousPlan) && !isRetiredRoutineMeetingAcquisition(item.value.autonomousPlan.contract)
);
for (const item of allPlannedWork) if (lifetimeHuntSubjects.has(item.value.subject)) lifetimeHuntWorkIds.add(item.id);
const [settledTaskIds, neverClaimedTaskIds] = await (async () => {
  const listing = canary ? [] : await recoveryRepos.routeTasks.list();
  for (const row of listing) if (row.value.workerTask && lifetimeHuntSubjects.has(row.value.workerTask.contract.subjectId)) {
    lifetimeHuntWorkIds.add(row.id);
    lifetimeHuntWorkIds.add(row.value.workItemId);
  }
  const eligible = listing;
  return [
    /* The same read names the settled RouteTasks the pre-dispatch recovery starts from. Only ids outlive it. */
    settledRouteTaskIds(eligible),
    /* And the freshness RouteTasks never claimed, which an abandoned occurrence must sit on. */
    new Set(eligible.filter(row => row.value.state === "PENDING" && !row.value.workerTask).map(row => row.id)),
  ] as const;
})();
finishPhase("schedule-and-intents");
if (dispatchOrdering !== null) {
  console.log(
    `  Scout lane order: band 1 ${dispatchOrdering.bands[1]} · band 2 ${dispatchOrdering.bands[2]} · band 3 ${dispatchOrdering.bands[3]} of ${dueModel.length} due model-class ` +
      `(canonical obligation reader impact)` +
      (dispatchPriority.size > 0 ? ` · owner dispatch first: ${scoutOrder.filter((b) => dispatchPriority.has(b.row.id)).length} of them` : ""),
  );
  for (const b of scoutOrder.slice(0, 12)) {
    const rank = placementRank(b.row.id);
    console.log(`      ${rank === 0 ? "DISPATCH" : rank !== null ? `SCOPE ${rank}` : `band ${b.band}`}  ${b.row.id}  — ${b.why}`);
  }
}

const standingById = new Map(sync.all.map((o) => [o.id, o]));
const openOccurrenceInStep = async (
  row: ScheduledObligation,
): Promise<boolean | { readonly settled: SettledOccurrence }> => {
  const id = row.obligation.id;
  if (occurrenceByObligation.has(id)) return true;
  // The dispatcher hands a FreshnessObligation; opening needs the fuller
  // StandingObligation (occurrence count, open-occurrence id), looked up by id.
  const obligation = standingById.get(id);
  if (obligation === undefined) return false;
  try {
    const resumed = await resumeOpenOccurrence(repos, obligation);
    if (resumed?.kind === "SETTLED") {
      if (decisionFor(id, obligation.routeId).kind === "BOUNDED_MODEL_WORKER") openedModel += 1;
      else openedDeterministic += 1;
      return { settled: resumed.settled };
    }
    if (resumed !== null) {
      occurrenceByObligation.set(id, { id: resumed.id, routeTaskId: resumed.routeTaskId });
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
const workerMessages = anthropicTransport(workerKey, fetch, undefined, {
  onRateLimits: (limits, request) => { providerQueue.observe(request.model, limits); } });
const workerBatch = backgroundBatchTransport({ apiKey: workerKey });
const credentialConfigured = workerKey.length > 0;

let discoverySearchOn = false;
/* The receipt of the decision applied, echoed into the heartbeat as the runner's acknowledgement; null means the default. */
let discoverySearchReceiptId: string | null = null;
let discoverySearchDecision: string = "OFF: the owner has not allowed paid discovery search in Admin";
let configRead: AdminConfigRead;
let configRevision = 0;
try {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  configRead = { row };
  configRevision = row?.revision ?? 0;
} catch (error) {
  configRead = { unreadable: error instanceof Error ? error.message : String(error) };
}
const { config, holdPaidWork: configHold } = adminConfigForPaidWork(configRead);
if (!dry && ONLY === null && IDS === null) try {
  const published = await Promise.all([
    ensureReaderSettingsPublished(config, configRevision),
    publishAskPlaybooks(repos),
  ]);
  if (published[0] === "behind" || !published[1]) runtimeConditions.push("Ask settings or instructions are waiting for publication.");
} catch { runtimeConditions.push("Ask settings or instructions could not be published; the next round will try again."); }

let ceilingOverrideUsd = fleetSpendCeilingOverrideUsd(config);
discoverySearchOn = discoverySearchEnabled(config);
if (config?.discoverySearch !== undefined && config.discoverySearch !== null) {
  discoverySearchReceiptId = config.discoverySearch.receiptId;
  discoverySearchDecision =
    `${discoverySearchOn ? "ON" : "OFF"}: decided in Admin at ${config.discoverySearch.decidedAt} (receipt ${config.discoverySearch.receiptId})`;
}
if (configHold !== null) {
  discoverySearchDecision = `OFF: ${configHold}`;
  runtimeConditions.push(
    `${configHold}; paid work is held this cycle (no Scout, pre-warm, auditor or paid search) rather than fall back to the built-in ` +
      `$${FLEET_SAFETY_BOUNDS.rolling24HourModelUsd.toFixed(2)}, which could be above the owner's dial`,
  );
}
let rollingCeiling = resolveRollingCeiling(ceilingOverrideUsd);
let effectiveCeilingUsd = rollingCeiling.rollingCeilingUsd;

/* The intent log was read, and RUN_CYCLE_NOW / DISPATCH honored, above the
   lane ordering — a DISPATCH has to reorder before anything is opened. */

let spendCharges: readonly PricedCharge[] = [];
let ledgerUnreadable: string | null = null;
try {
  // Only transient failures are retried, under the existing backoff and circuit.
  spendCharges = await retryStartupRead(() => readSpendWindow(repos, NOW), () => null, startupReadRetry);
} catch (error) {
  ledgerUnreadable = error instanceof Error ? error.message : String(error);
  runtimeConditions.push(`the cost ledger could not be read (${ledgerUnreadable}); paid model work waits while held and plain-code work continue`);
}
const spendWindow = researchSpendInWindow(spendCharges, NOW, RESEARCH_BOUNDS.windowHours);
const paidSpendHold = ledgerUnreadable !== null
  ? `the cost ledger could not be read (${ledgerUnreadable})`
  : !ceilingPermits(spendWindow.windowUsd, effectiveCeilingUsd).permits
    ? `the owner's $${effectiveCeilingUsd.toFixed(2)} model ceiling is reached`
    : null;
if (paidSpendHold !== null && ledgerUnreadable === null) {
  runtimeConditions.push(`${paidSpendHold}; paid model work waits while held and plain-code work continue`);
}
if (paidSpendHold !== null) console.log(`  Workers: ${paidSpendHold}; paid model work waits while held and plain-code work continue`);
const unreadableControls: string[] = [
  ...(intentLogUnreadable === null ? [] : [`the owner's research intents could not be read (${intentLogUnreadable})`]),
  ...(ownerIntentsUnreadableByRunner
    ? ["the runner could not read the owner's intents before it started this cycle, so it cannot know the runner is not paused"]
    : []),
  ...(configHold === null ? [] : [configHold]),
];

/* With the switch on, the standing hunter lane is the one process that admits paid work; this round plans and queues. */
const CONTINUOUS_HUNTERS = process.env.WTP_CONTINUOUS_HUNTERS === "1";
const laneClosure = modelLaneClosure({
  dry,
  noModel,
  credentialConfigured,
  credentialVar: WORKER_CREDENTIAL_VAR,
  paused: intents.paused,
  pauseIntentId: intents.pauseIntentId ?? null,
  runnerPaused: intents.runnerPause.paused,
  runnerPauseIntentId: intents.runnerPause.intent?.intentId ?? null,
  spendHold: paidSpendHold,
  paidWorkInHunterLane: CONTINUOUS_HUNTERS,
  unreadableControls,
});
/* The lane is closed only because paid work runs in the standing hunter lane (no pause, hold or unread control). */
const queuesForHunterLane = laneClosure?.hunterLane === true;

/* Planned paid rows are opened for the hunters: the standing hunter lane, or this round's worker wave. */
if ((queuesForHunterLane || laneClosure === null) && !canary) {
  let queued = 0;
  for (const row of dueModel) {
    if (!plannedForHunters(row.obligation.autonomousPlan)) continue;
    const scheduled = scheduleObligation(row.obligation, nowMs);
    if (isScheduled(scheduled) && await openOccurrenceInStep({ ...scheduled, nextDueAt: row.nextDueAt }) === true) queued += 1;
  }
  console.log(`  planned paid rows opened for the hunters: ${queued} of ${dueModel.filter(row => plannedForHunters(row.obligation.autonomousPlan)).length} due`);
}
const laneDisabledReason = laneClosure?.reason ?? null;
const modelLaneEnabled = laneClosure === null;

const honoredLaneIntents: string[] = [];
{
  const pendingAcknowledgment = pendingResearchLaneAcknowledgment(intentLog, laneClosure);
  if (pendingAcknowledgment !== null) {
    if (await honorIntent(pendingAcknowledgment.intent, pendingAcknowledgment.detail)) {
      honoredLaneIntents.push(pendingAcknowledgment.intent.intentId);
    }
  }
}

const workerCapacity = researchPaidWorkerCapacity({ readyWork: dueThisCycle.length,
  modelEnabled: modelLaneEnabled,
  spentUsd: ledgerUnreadable === null ? spendWindow.windowUsd : null, ceilingUsd: effectiveCeilingUsd,
  requestUsd: MODELS.haiku.outputUsdPerMillion * RESEARCH_BOUNDS.perDispatch.maxOutputTokensPerTurn / 1_000_000,
  ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}) });
let finalSpendWindow: ReturnType<typeof researchSpendInWindow> | null = null;
let finalSpendAsOf: string | null = null;
let priorCircuits: readonly ProviderCircuit[] = [];
let priorLastSuccessfulActivity: string | null = null;
let priorResearchState: ResearchState | null = null;
/* This round is the research state's only writer: the revision it read or last wrote is the one it writes on. */
let researchStateRevision: number | null | undefined;
try {
  const previous = await repos.researchState.read(RESEARCH_STATE_ID);
  researchStateRevision = previous?.revision ?? null;
  priorResearchState = previous?.value ?? null;
  priorCircuits = previous?.value.fleetSafety?.providerCircuits ?? [];
  priorLastSuccessfulActivity = previous?.value.fleetSafety?.lastSuccessfulActivity ?? null;
} catch (error) {
  runtimeConditions.push(`prior Fleet safety state could not be read: ${error instanceof Error ? error.message : String(error)}`);
}
/* The ceiling in force and the paid-search switch were read above the lane closure. */

const websiteSize = websiteSizeFromHoldings(trackedStateCodes, ROOT);
const sizeForDiscovery = websiteSize;
let hostConcurrency = readSetting(config, HOST_CONCURRENCY_SETTING, HOST_CONCURRENCY_DEFAULT);
const fleetSafety = new FleetSafetyController({
  websiteSize: sizeForDiscovery,
  hostConcurrency: () => hostConcurrency,
  now: NOW,
  charges: spendCharges,
  costLedgerReadable: ledgerUnreadable === null,
  paused: intents.runnerPause.paused,
  /* The second lock: while the lane is closed for any reason, no model request is reserved at all. */
  modelHold: laneDisabledReason,
  circuits: priorCircuits,
  websitePacing: repos.websitePacing,
  lastSuccessfulActivity: priorLastSuccessfulActivity,
  rollingCeilingUsd: effectiveCeilingUsd,
  lifetimeHuntWork,
});

const SETTINGS_REFRESH_MIN_MS = 5_000;
let settingsReadAt = 0;
let settingsRead: Promise<void> | null = null;
function refreshOwnerSettings(): Promise<void> {
  if (settingsRead) return settingsRead;
  if (Date.now() - settingsReadAt < SETTINGS_REFRESH_MIN_MS) return Promise.resolve();
  settingsReadAt = Date.now();
  settingsRead = (async () => {
    const reread = adminConfigForPaidWork({ row: await repos.adminConfig.read(ADMIN_CONFIG_ID) });
    hostConcurrency = readSetting(reread.config, HOST_CONCURRENCY_SETTING, HOST_CONCURRENCY_DEFAULT);
    if (reread.holdPaidWork !== null) return;
    const next = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(reread.config));
    if (next.rollingCeilingUsd === effectiveCeilingUsd) return;
    console.log(`  Workers: the owner's spend dial changed mid-round: $${effectiveCeilingUsd} -> $${next.rollingCeilingUsd} a day; new admissions use it`);
    ceilingOverrideUsd = fleetSpendCeilingOverrideUsd(reread.config);
    rollingCeiling = next;
    effectiveCeilingUsd = next.rollingCeilingUsd;
    fleetSafety.setRollingCeilingUsd(ceilingOverrideUsd);
    guards.capacityNoticeReset();
  })().catch(error => {
    console.warn(`  owner settings refresh failed; keeping the ceiling in force: ${error instanceof Error ? error.message : String(error)}`);
  }).finally(() => { settingsRead = null; });
  return settingsRead;
}

if (ledgerUnreadable !== null) {
  fleetSafety.defer("all model-backed Fleet work", "UNMEASURED_MODEL_SPEND", `the canonical cost ledger could not be read: ${ledgerUnreadable}`);
}

const SEARCH_PER_CYCLE = Number.MAX_SAFE_INTEGER;
const SEARCH_PER_DAY = Number.MAX_SAFE_INTEGER;
const searchBudget = !discoverySearchOn ? null : durableSearchBudget({
  repos,
  perCycle: SEARCH_PER_CYCLE,
  perDay: SEARCH_PER_DAY,
  admit: () => {
    try {
      fleetSafety.admitProviderRequest("discovery-search", "paid-search");
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  admitLifetimeHunt: () => {
    try {
      // This budget is handed only to work already bound to the exact original
      // Send. FleetSafety still applies genuine provider/host restrictions.
      fleetSafety.admitProviderRequest("discovery-search", lifetimeHuntSubjects.values().next().value!);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
  now: nowIso,
});
/* One provider per query: Brave first, Exa when Brave misses; the hunter opens and saves the page it cites. */
const scoutSearch = searchBudget === null ? null : makeHuntSearch({
  braveKey: process.env.BRAVE_SEARCH_API_KEY,
  exaKey: process.env.EXA_API_KEY,
  budget: searchBudget,
});
const scoutSearchLifetime = searchBudget === null || !hasLifetimeHunt ? null : makeHuntSearch({
  braveKey: process.env.BRAVE_SEARCH_API_KEY,
  exaKey: process.env.EXA_API_KEY,
  budget: searchBudget.lifetimeHunt,
});
console.log(
  scoutSearch === null
    ? `  scout search: OFF (${discoverySearchOn ? "no Brave or Exa key in this process" : configHold !== null ? "held: the owner's config row could not be trusted" : "the owner's paid-search switch is off"})`
    : `  scout search: ON under the owner's switch (${[process.env.BRAVE_SEARCH_API_KEY ? "brave" : null, process.env.EXA_API_KEY ? "exa" : null].filter(Boolean).join("+")}; ` +
        `${SEARCH_PER_CYCLE}/cycle, ${SEARCH_PER_DAY}/day shared with discovery); Brave first, Exa only when Brave misses`,
);

const expansionBudget = expansionPlan === null
  ? null
  : armExpansionBudget(expansionPlan, { now: NOW, charges: ledgerUnreadable === null ? spendCharges : null, worstCaseUsd: SCOUT_JOB_WORST_CASE_USD ?? Number.POSITIVE_INFINITY });
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

/* Obligation rows only, no spend: an unreadable intent log does not stop them; what they create waits behind the closed lane. */
const dispatchWorkWrites = !dry && !canary && ONLY === null && IDS === null && !intents.runnerPause.paused;
const dispatchWorkPlanOnlyWhy = dispatchWorkWrites
  ? null
  : dry
    ? "--dry writes nothing"
    : canary
      ? "a canary cycle writes only its one obligation"
      : ONLY !== null || IDS !== null
        ? "a filtered diagnostic cycle writes nothing it did not look at"
        : "the owner has paused the runner";
const dispatchTargets: DispatchWorkTarget[] = [];
const dispatchScopes = expansionPlan?.scopes ?? [];
{
  const seen = new Set<string>();
  const add = (t: DispatchWorkTarget): void => {
    if (seen.has(t.key)) return;
    seen.add(t.key);
    dispatchTargets.push(t);
  };
  for (const { intent } of dispatchDetails) add(dispatchWorkTarget({ intentId: intent.intentId, note: intent.note ?? "", requestedAt: intent.requestedAt }));
  for (const t of carriedDispatchTargets(priorResearchState?.dispatchWork ?? null, intents.cancelledDispatch)) add(t);
  for (const scope of dispatchScopes) add(scopeWorkTarget(scope));
}
let dispatchWork: DispatchWorkReading | null = null;
/* The Sends this cycle recorded on rows after they were read, for the assignment budgets below. */
let dispatchRecorded: NonNullable<DispatchWorkApplied["recorded"]> = [];
/** Every Send record the dispatch-work plan meant to write this cycle (null: no plan was made). */
let plannedSendMarks: { readonly obligationId: string; readonly key: string }[] | null = null;
/** The obligations this cycle's Sends just created or revived, with the Send each belongs to, so they can start in this round. */
let dispatchWrittenThisCycle: ReadonlyMap<string, string> = new Map();
if (dispatchTargets.length > 0) {
  try {
    if ("unreadable" in promoted) throw new Error(`the promoted jurisdiction registries could not be read (${promoted.unreadable})`);
    /* A DISPATCH's states with no reviewed registry are read from their registration, as a scope's were. */
    await preloadRegistrationJurisdictions({ root: ROOT, states: dispatchTargets.flatMap((t) => (t.kind === "DISPATCH" ? t.target.states : [])), options: { bypassCache: true } });
    await meetingPartitions.readStates(dispatchTargets.flatMap(t => t.kind === "DISPATCH" ? t.target.states : []));
    const current = promotedRegistries();
    const registries = "registries" in current ? current.registries : promoted.registries;
    const refusedRegistries = "refused" in current ? current.refused : promoted.refused;
    let censusUnitsByState: Map<string, number> | null = null;
    if (dispatchTargets.some((t) => t.kind === "DISPATCH" && t.target.states.some((s) => !registries.has(s)))) {
      try {
        censusUnitsByState = new Map<string, number>();
        const states = [...new Set(dispatchTargets.flatMap(target => target.kind === "DISPATCH" ? target.target.states : []))];
        for (const unit of readCensusUnitTerritories(ROOT, states)) {
          const state = unit.state.toUpperCase();
          censusUnitsByState.set(state, (censusUnitsByState.get(state) ?? 0) + 1);
        }
      } catch {
        censusUnitsByState = null;
      }
    }
    const durable = new Map<string, DurableRowFacts>();
    for (const row of [...sync.all, ...(sync.outside ?? [])]) durable.set(row.id, { active: row.active, materializedBy: row.materializedBy, assignments: row.assignments });
    /* Every division each sent place touches gets one hunt packet; a send whose place cannot be read gets its placed governments' packets. */
    const packetDivisions = new Map<string, readonly string[]>();
    for (const target of dispatchTargets) {
      try {
        if (target.kind === "SCOPE" && target.scope.kind === "RESOLVED") packetDivisions.set(target.key, await divisionsOfPlace([...target.scope.zctas], target.scope.states));
        if (target.kind === "DISPATCH") {
          const place = await readPlaceWords(target.target.text);
          if (place.state === "PLACE") packetDivisions.set(target.key, place.divisionIds);
          if (place.state === "CHOICES") runtimeConditions.push(`“${target.target.text}” names ${place.choices.length} places (${place.choices.slice(0, 3).map(c => c.label).join("; ")}${place.choices.length > 3 ? " …" : ""}); choose one in Admin to hunt it`);
        }
      } catch (error) { console.warn(`  ${target.label}: the divisions it touches could not be read (${error instanceof Error ? error.message : String(error)})`); }
    }
    const plan = planDispatchWork({
      targets: dispatchTargets,
      world: {
        packetDivisions,
        registries,
        territory: expansionLoad.territory ?? null,
        territoryDetail: expansionLoad.territoryDetail ?? null,
        corpus: allUnits.map((u) => ({ id: u.obligation.id, subjectId: u.obligation.subjectId })),
        durable,
        meetingPartitions,
        censusUnitsByState,
        refusedRegistries,
      },
    });
    plannedSendMarks = plan.marks.map((m) => ({ obligationId: m.obligationId, key: m.target.key }));
    const applied = dispatchWorkWrites
      ? await applyDispatchWork(repos, plan, { now: NOW })
      : null;
    dispatchRecorded = applied?.recorded ?? [];
    if (applied !== null) {
      const targetOf = new Map(plan.writes.map(w => [w.instance.obligation.id, w.target.key] as const));
      dispatchWrittenThisCycle = new Map(applied.written.flatMap(id => { const key = targetOf.get(id); return key === undefined ? [] : [[id, key] as const]; }));
    }
    dispatchWork = dispatchWorkReading(plan, applied, {
      at: NOW,
      modelLaneClosed: laneDisabledReason,
      ceilingUsd: effectiveCeilingUsd,
      ceilingSource: rollingCeiling.source,
      writes: dispatchWorkWrites ? "APPLIED" : "PLAN_ONLY",
      planOnlyWhy: dispatchWorkPlanOnlyWhy,
    });
    console.log(
      `  dispatch work: ${dispatchWork.targets.length} target(s); ${dispatchWork.written} obligation(s) created this cycle, ` +
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

if (dispatchWrittenThisCycle.size > 0 && sameRoundFirstHuntEnabled(process.env)) {
  try {
    const written = [...dispatchWrittenThisCycle.keys()];
    const onFile = await repos.obligations.listWhere(["materializedBy"], OWNER_DISPATCH);
    materialized = { ids: new Set(onFile.map((row) => row.id)) };
    const rebuilt = buildRegistry(registryProviders, registryContext);
    const known = new Set(allUnits.map((u) => u.obligation.id));
    const wanted = new Set(written);
    const freshUnits = rebuilt.units.filter((u) => wanted.has(u.obligation.id) && !known.has(u.obligation.id));
    if (freshUnits.length > 0) {
      const synced = await syncObligations(repos, freshUnits.map((u) => u.obligation), NOW, { exactReads: true });
      const freshIds = new Set(synced.all.map((o) => o.id));
      registry = rebuilt;
      allUnits = [...allUnits, ...freshUnits];
      units = [...units, ...freshUnits];
      sync = { ...sync, all: [...sync.all, ...synced.all], outside: sync.outside === null ? null : sync.outside.filter((o) => !freshIds.has(o.id)) };
      for (const o of synced.all) {
        decisionFor(o.id, o.routeId);
        standingById.set(o.id, o);
        subjectByObligation.set(o.id, o.subjectId);
        if (lifetimeHuntSubjects.has(o.subjectId)) lifetimeHuntWorkIds.add(o.id);
        if (dispatchWrittenThisCycle.get(o.id)?.startsWith("dispatch:")) dispatchPriority.add(o.id);
        if (scopePlaceFirst !== null) scopePlaceFirst.add(o.id);
      }
      const folded = foldNewWorkIntoRound({ rows: synced.all, nowMs });
      for (const id of folded.nextDueWrites) nextDueWrites.push(id);
      for (const d of folded.due) {
        dueThisCycle.push(d);
        (decisionFor(d.obligation.id, d.obligation.routeId).kind === "BOUNDED_MODEL_WORKER" ? dueModel : dueDeterministicRows).push(d);
      }
      dueDeterministic = dueDeterministicRows.length;
      console.log(
        `  first hunt in the same round: ${synced.all.length} new row(s) from this round's Sends joined the corpus; ` +
          `${folded.due.length} due now (${folded.due.filter((d) => dueModel.includes(d)).length} model-class), ${folded.notYetDue.length} wait for their clock` +
          (folded.unscheduled.length > 0 ? `, ${folded.unscheduled.length} owe nothing on a clock` : ""),
      );
    }
  } catch (error) {
    runtimeConditions.push(
      `rows this round's Sends created could not start in the same round (${error instanceof Error ? error.message : String(error)}); they join next round`,
    );
  }
}
if (dispatchWorkWrites && expansionPlan !== null) {
  try {
    const gaps = await applyManualSourceGaps(repos, dispatchScopes, {
      now: NOW,
    });
    console.log(`  source capability gaps: ${gaps.created} created, ${gaps.carried} carried, ${gaps.deferred} deferred`);
  } catch (error) {
    runtimeConditions.push(`source capability gaps remain owed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
/* The owner's dispatch records carry the step's counts; the full receipt is `dispatchWork`. */
for (let i = 0; i < ownerDispatches.length; i += 1) {
  ownerDispatches[i] = { ...ownerDispatches[i], work: ownerDispatchWorkOf(dispatchWork, ownerDispatches[i].intentId) };
}
/* Each DISPATCH is honored after the step, so its HONORED record says what was matched AND what was created. */
for (const { intent, detail } of dispatchDetails) {
  const work = dispatchWork?.targets.find((t) => t.key === `dispatch:${intent.intentId}`) ?? null;
  if (await honorIntent(intent, work === null ? detail : `${detail} ${dispatchWorkSentence(work)}`)) honoredDispatch.push(intent.intentId);
}

const assignmentMembers = assignmentMembership([...sync.all, ...(sync.outside ?? [])], dispatchRecorded);

const sendsReachedThisCycle = new Map<string, readonly string[]>();
if (plannedSendMarks !== null) {
  for (const m of plannedSendMarks) sendsReachedThisCycle.set(m.obligationId, [...(sendsReachedThisCycle.get(m.obligationId) ?? []), m.key]);
} else {
  for (const [id, keys] of dispatchMatchReached) sendsReachedThisCycle.set(id, keys);
}
const assignmentSpecs = assignmentBudgetsOf({ scopes: (expansionPlan?.scopes ?? []).map((s) => s.decision), intents: intentLog });
const assignmentBudget: AssignmentBudgetGate = armAssignmentBudget({
  now: NOW,
  specs: assignmentSpecs,
  membership: assignmentMembers,
  charges: ledgerUnreadable === null ? spendCharges : null,
  worstCaseUsd: SCOUT_JOB_WORST_CASE_USD ?? Number.POSITIVE_INFINITY,
  /* An unread log cannot say which DISPATCH carries a budget, so its work is held (assignment-budget.ts). */
  intentsReadable: intentLogUnreadable === null,
  /* Fail closed: a DISPATCH whose budget is unreadable holds its work; so does work this cycle reached under a Send whose record on the row was not written. */
  malformed: malformedAssignmentBudgetsOf(intentLog),
  reachedThisCycle: sendsReachedThisCycle,
});
const assignmentLabels = new Map(dispatchTargets.map((t) => [t.key, t.label] as const));

const spendHolds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: nowIso });
/* A round's end deletes the holds that no longer count (bounded; never accumulated). */
releaseRoundHolds = async () => {
  await spendHolds.sweep();
  return [];
};
/* The paid-work guards are built in one module, so a standing lease-worker lane builds the same ones (paid-work-guards.ts). */
const guards = paidWorkGuards({ repos, now: nowIso, armedAt: NOW, fleetSafety, providerQueue, spendHolds, assignmentBudget, expansionBudget,
  messages: workerMessages, batch: workerBatch, modelLaneEnabled, ceilingUsd: () => effectiveCeilingUsd,
  ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}),
  onCondition: sentence => { runtimeConditions.push(sentence); } });
const { autonomousTransportFor, paidWorkerCapacity } = guards;
/* The round's Send and area reading, for the standing hunter lane, which cannot read the whole corpus itself. Host-local; never a reader-facing write. */
const writeHunterLaneReading = (): void => {
  if (dry || canary) return;
  try {
    const sends = assignmentBudget.armedReading();
    writeLaneArming(hunterLaneArmingPath(ROOT), laneArmingOf({ readAt: NOW, specs: sends.specs, historical: sends.historical,
      knownKeys: assignmentMembers.byKey.keys(), reached: sends.reached,
      areas: expansionBudget === null ? null : expansionBudget.gate.armedReading(),
      lifetimeHuntSubjects: lifetimeHuntSubjects, placeOrder, circuits: fleetSafety.snapshot(nowIso()).providerCircuits,
      worstCaseUsd: SCOUT_JOB_WORST_CASE_USD ?? Number.POSITIVE_INFINITY }));
  } catch (error) {
    runtimeConditions.push(`the hunter lane's budget reading could not be written (${error instanceof Error ? error.message : String(error)}); the lane holds paid work until a round writes it`);
  }
};
writeHunterLaneReading();
const spacer = serializeHostSpacing(hostSpacer());
let releaseDrainRequested = false;
process.on("message", message => {
  if (message !== null && typeof message === "object" && "kind" in message && message.kind === "RUNTIME_RELEASE_DRAIN") {
    releaseDrainRequested = true;
    console.log("  runtime release requested: current wave finishes normally; no new autonomous wave will start");
  }
});
// Paid admission happens before handing out a Scout. Held evidence and ordinary
// code can still use the existing memory slots while the paid lane is closed.
const dispatchDeadlineMs = Date.now() + 15 * 60_000;
/* A memory wait can outlast the runner's no-progress limit; it says each minute that it is still waiting, so it ends as a deferral, not a crash. */
const reportedHostSlots = reportingWorkerSlots(hostWorkerSlots);
const workerSlots = { acquire: (entry?: string, deadlineMs = dispatchDeadlineMs) =>
  reportedHostSlots.acquire(entry, Math.min(deadlineMs, dispatchDeadlineMs)) };
// Hand out durable leases before unrelated histories or parent execution.
const autonomousCycleOpen = autonomousCycleAllowed({ dry, canary, only: ONLY, ids: IDS,
  runnerPaused: intents.runnerPause.paused });
/* Repository calls per lease task this round; their mean is the round's "lease-task-reads" phase (no duration of its own). */
const leaseTaskCalls: number[] = [];
const leaseTaskReadsPhase = (): CyclePhase[] => leaseTaskCalls.length === 0 ? [] : [{ name: "lease-task-reads", durationMs: 0,
  repositoryCalls: Math.round(leaseTaskCalls.reduce((sum, n) => sum + n, 0) / leaseTaskCalls.length) }];
const earlyOriginal = autonomousCycleOpen ? runAutonomousProcesses().catch(error => {
  runtimeConditions.push(`autonomous worker processes failed: ${error instanceof Error ? error.message : String(error)}; work remains owed`);
  return null;
}) : null;
let earlyAutonomous: Awaited<typeof earlyOriginal> = null;
// Persist derived scheduling projections alongside workers, using current facts and CAS.
const nextDuePersistence = runPool(nextDueWrites, Math.max(1, workerCapacity), async id => {
  try {
    const held = await repos.obligations.mustRead(id);
    const derived = scheduleObligation(held.value, Date.now());
    if (isScheduled(derived) && held.value.nextDueAt !== derived.nextDueAt) {
      await repos.obligations.compareAndSet(id, held.revision, { ...held.value, nextDueAt: derived.nextDueAt, updatedAt: nowIso() }, nowIso());
    }
  } catch (error) {
    runtimeConditions.push(`derived due time remains owed for ${id}: ${error instanceof Error ? error.message : String(error)}`);
  }
});

/* Visited is not finished. Each Send is evaluated from its members' own records as this cycle
   read them (obligations at sync, debts at load): settled, or named as refused or not yet settled. */
const debtByObligation = new Map(debtsIn.map((d) => [d.obligationId, d] as const));
const assignmentObligations = [...sync.all, ...(sync.outside ?? [])];
/* A Send over resolved places is Done by its mission map: no unfilled row and every door it opened has a next read. */
const resolvedReceipts = new Set((expansionPlan?.scopes ?? []).filter(scope => scope.kind === "RESOLVED").map(scope => scope.decision.receiptId));
const priorMapBefore = (key: string, ref: string): number | null => {
  const rows = (priorResearchState?.assignments as { assignments?: readonly { key?: unknown; ref?: unknown; completion?: { map?: { before?: unknown } } | null }[] } | null | undefined)?.assignments ?? [];
  const before = rows.find(row => row.key === key && row.ref === ref)?.completion?.map?.before;
  return typeof before === "number" && Number.isSafeInteger(before) && before >= 0 ? before : null;
};
const assignmentCompletion = (key: string) => {
  const ref = assignmentSpecs.find(spec=>spec.key===key)?.ref;
  const obligations = memberRecordsForSend(key, assignmentMembers, assignmentObligations, ref);
  const debtFor = (id: string) => debtByObligation.get(id) ?? null;
  if (ref !== undefined && resolvedReceipts.has(ref)) {
    const counted = missionMaps.get(ref);
    return evaluateMissionDone({ assignmentKey: key, obligations, debtFor,
      map: counted ? { ...counted, before: priorMapBefore(key, ref) ?? counted.unfilled }
        : { unreadable: missionMapUnread ?? "this Send's places were not in the owed-list read" } });
  }
  return evaluateAssignmentFromRecords({ assignmentKey: key, obligations, debtFor, now: NOW });
};
const assignmentsReading = (): AssignmentCycleReading | null =>
  assignmentSpecs.length === 0 && assignmentMembers.byKey.size === 0
    ? null
    : assignmentCycleReading({
        at: nowIso(),
        now: NOW,
        gate: assignmentBudget,
        specs: assignmentSpecs,
        membership: assignmentMembers,
        charges: ledgerUnreadable === null ? spendCharges : null,
        intentsReadable: intentLogUnreadable === null,
        labels: assignmentLabels,
        completionFor: assignmentCompletion,
      });

/* ------------------------------------------------- host supervision --- */

/** The relaunch proof is host-local ignored evidence under this runtime checkout; no relaunch trigger is asked. */
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
  return {
    host: HOST,
    checkedAt: nowIso(),
    measurable: false,
    notMeasurableReason: "NOT_MEASURABLE_ON_THIS_HOST (no scheduled relaunch trigger to ask)",
    relaunchTrigger: { present: null, detail: "not asked: no scheduled task" },
    proof,
    proofPath: proofRel,
  };
}
const hostSupervision = measureHostSupervision();
console.log(
  `  host supervision: ${hostSupervision.measurable ? `trigger ${hostSupervision.relaunchTrigger.present === null ? "UNKNOWN" : hostSupervision.relaunchTrigger.present ? "present" : "ABSENT"}` : hostSupervision.notMeasurableReason} · ` +
    `proof ${hostSupervision.proof === null ? `ABSENT at ${hostSupervision.proofPath}` : `${hostSupervision.proof.verdict} measured ${hostSupervision.proof.measuredAt} (${hostSupervision.proof.secondsToRelaunch ?? "?"}s)`}`,
);

/* ----------------------------------------------------- research state --- */

const running: RunningScout[] = [];
let laneCounts: { deterministicDispatched: number; modelDispatched: number; deferredBy: Record<string, number> } = {
  deterministicDispatched: 0,
  modelDispatched: 0,
  deferredBy: {},
};
/** Obligations started this cycle in either lane, for the in-flight lane reading's oldest waiting row. */
const startedThisCycle = new Set<string>();
/** The lanes' final accounting, set once the cycle's lanes (and then the coordinator) have run; in-flight until then. */
let finalQueueLanes: QueueLanes | null = null;
/** Computed once at cycle end; null on the start-of-cycle state. */
let metrics: ResearchMetrics | null = null;
const researchWindowId = `research:${HOST}:${NOW}`;
let researchProgression = priorResearchState?.researchProgression ?? null;
let researchProgressionFailure: string | null = null;
let autonomousDispatchedThisCycle = 0;

type CycleResearchState = ResearchState & { readonly ownerDispatch: OwnerDispatchRecord | null };

function researchState(cycleFinishedAt: string | null): CycleResearchState {
  const measuredSpend = finalSpendWindow ?? spendWindow;
  const window = finalSpendWindow !== null ? finalSpendWindow.windowUsd : spendWindow.windowUsd;
  return {
    formatVersion: RESEARCH_FORMAT_VERSION,
    beatAt: nowIso(),
    cycleStartedAt: NOW,
    cycleFinishedAt,
    testedSha: RUNNING_CODE_SHA,
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
    bounds: { ...RESEARCH_BOUNDS, workerCapacity, dailyCeilingUsd: effectiveCeilingUsd },
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
      lanes:
        finalQueueLanes ??
        lanesInFlight({
          at: nowIso(),
          deterministicRows: dueDeterministicRows,
          modelRows: dueModel,
          deterministicDispatched: laneCounts.deterministicDispatched,
          modelDispatched: laneCounts.modelDispatched,
          startedIds: startedThisCycle,
          runningIds: new Set(running.map((r) => r.obligationId)),
          debtFor: (id) => debtAtCycleStart.get(id),
        }),
    },
    running: [...running],
    runtimeConditions: [...runtimeConditions],
    cyclePhases: [...cycleObservation.phases, ...leaseTaskReadsPhase()],
    methodCandidates: null,
    hostSupervision,
    dispatchOrdering,
    metrics,
    ownerDispatch: ownerDispatches.at(-1) ?? null,
    fleetSafety: fleetSafety.snapshot(cycleFinishedAt ?? nowIso()),
    researchProgression,
    expansion: expansionReading,
    dispatchWork,
    assignments: assignmentsReading(),
  };
}

const putResearchState = soleWriter(repos.researchState, RESEARCH_STATE_ID, researchStateRevision);
const writeResearchState = cycleStateWriter(async (cycleFinishedAt) => {
  await (async () => {
    for (let tries = 0; tries < 4; tries += 1) {
      try {
        await putResearchState(researchState(cycleFinishedAt), nowIso());
        return;
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const budgetSpent = isControlPlaneRequestTimeout(error) && !error.retryable;
        console.error(`freshness:shadow · research state write, try ${tries + 1} of 4, failed: ${detail}`);
        if (tries === 3 || budgetSpent) {
          runtimeConditions.push(`the research state could not be written: ${detail}`);
          return;
        }
      }
    }
  })();
});

await writeResearchState(null);

/* ----------------------------------------------------------- the executor --- */

const vault = cycleVault(join(ROOT, ...VAULT_DIR));

const simulated: RunWork = async ({ executor, routeTaskId }) => ({
  ranAs: "DETERMINISTIC",
  kind: "SIMULATED",
  detail: `--dry: ${executor} decided route task ${routeTaskId.slice(0, 12)} — no retrieval ran`,
});

/** The deterministic lane: an HTTP GET or POST from a committed descriptor. Never a model. */
const executorFor = (obligation: { obligation: { id: string } }): DeclaredExecutor => {
  const route = registry.routeFor(obligation.obligation.id);
  if (!dry) return routeProcessExecutor({ root: ROOT, postgres: wantsPostgres, fileStoreRoot: CONTROL_PLANE_ROOT,
    route, slots: workerSlots, spaceOut: spacer, vault: vault.put,
    openOne: fleetSafety.guardedOpenOne("public-web", obligation.obligation.id),
    onStarted: pid => console.log(`  route lease worker process: pid ${pid}; ${obligation.obligation.id}`) });
  return {
    lane: "DETERMINISTIC",
    workerFor: ({ holder }) => ({
      role: "ACQUIRER",
      provider: "we-the-people",
      version: dry ? "shadow-decision/1.0" : `route-executor/1.0 (${route?.routeId ?? "unrouted"})`,
      instance: holder,
    }),
    run: simulated,
  };
};

/* --------------------------------------------------------------- the cycle --- */

finishPhase("worker-context");

let settledOccurrences: readonly SettledOccurrence[] = [];

let abandonedOccurrences: readonly AbandonedOccurrence[] = [];
let abandonedClosed: Awaited<ReturnType<typeof closeAbandonedOccurrences>> | null = null;
if (!canary) {
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

if (modelLaneEnabled && freeWalkSubjects.length > 0) {
  freeWalks = await pending.step("free-walks:read", () => readFreeDiscoveryWalks(repos, freeWalkSubjects));
}

// Retained results publish alongside acquisition rather than holding ready leases.
// Join this pass before the later projection of new worker output.
async function projectRetainedFacts(phase: string): Promise<void> {
  try {
    const selected = filteredCycle ? await selectedCycleRepositories(repos, sync.all.map(row => row.id)) : repos;
    await pending.step(phase, () => projectFleetPipeline(selected));
  } catch (error) {
    const reason = isControlPlaneRequestTimeout(error)
      ? error.message
      : error instanceof Error && /^[A-Z][A-Z0-9_]{2,100}$/.test(error.message)
        ? error.message : "RETAINED_FACT_PROJECTION_FAILED";
    runtimeConditions.push(phase + ": " + reason + "; retained records remain owed, existing reader data is preserved");
  }
}
const retainedProjection = !dry && !canary
  ? projectRetainedFacts("retained-results:fact-projection") : Promise.resolve();

/** Where a row's deterministic request goes, so an open breaker on that provider holds it. */
const routeUrl = (obligationId: string): string | null => {
  const open = registry.routeFor(obligationId)?.open;
  return open && (open.kind === "HTTP_GET" || open.kind === "HTTP_POST") ? open.url : null;
};
const cycle = await runCycle({
  repos,
  recoveryRepos,
  obligations: sync.all,
  debts: debtsIn,
  routeTaskFor: (id) => occurrenceByObligation.get(id)?.routeTaskId ?? null,
  maturity,
  executor: executorFor,
  workerCapacity: Math.max(1, dueDeterministicRows.length),
  placeComparator: async () => {
    await Promise.all([refreshPlaceOrder(), refreshOwnerSettings()]);
    return (a, b) => (placementRank(a.obligation.id) ?? Infinity) - (placementRank(b.obligation.id) ?? Infinity);
  },
  huntFor: row => {
    const rank = placementRank(row.obligation.id);
    return rank === null ? null : placeOrder[rank] ?? "dispatch";
  },
  holder: `freshness-shadow@${process.pid}`,
  now: NOW,
  clock: nowIso,
  leaseTtlMs: 120_000,
  maxDispatches: MAX_DISPATCHES,
  openOccurrence: openOccurrenceInStep,
  settledOccurrences,
  onRecoveryComplete: () => finishPhase("lease-and-completion-recovery"),
  skipReclaim: canary,
  admitDispatch: (row) => fleetSafety.admitDispatch(row.obligation.id, routeUrl(row.obligation.id)),
  providerLimitOf: (row) => {
    const url = routeUrl(row.obligation.id);
    if (url === null) return null;
    const key = sourceReliabilityKey(url);
    return { key, limit: providerConcurrency(fleetSafety.providerState(url), hostConcurrency) };
  },
  /* The owner's dispatch goes first in the dispatcher's own due order too. */
  placeFirst: dispatchPriority,
  /* With no DISPATCH pending (the set above is empty), the selected expansion scopes' due work goes first instead. */
  ...(scopePlaceFirst !== null ? { placeFirst: scopePlaceFirst } : {}),
  research: {
    decide: (row) => decisionFor(row.obligation.id, row.obligation.routeId),
    onDispatched: async (result: DispatchResult) => {
      placeOrderDirty = true;
      roundProgress.note("dispatch");
      startedThisCycle.add(result.obligationId);
      if (result.outcome === "WORKED") fleetSafety.recordSuccessfulActivity(nowIso());
      laneCounts = { ...laneCounts, deterministicDispatched: laneCounts.deterministicDispatched + 1 };
    },
  },
});
await retainedProjection;
finishPhase("dispatch");
if (expansionReading !== null && expansionBudget !== null) {
  /* The scopes' dispatch outcome: what each budget admitted and held this cycle. */
  const dispatchedIds = new Set(cycle.dispatched.map(row => row.obligationId));
  expansionReading = withCycleCounts(expansionReading, {
    dueByScope: new Map(expansionReading.scopes.map((s) => [s.key, s.work?.dueThisCycle ?? 0])),
    dispatchedByScope: new Map(expansionReading.scopes.map((s) => {
      const members = assignmentMembers.byKey.get(s.key);
      const ids = members === undefined ? [] : [...members.created.keys(), ...members.reordered.keys()];
      return [s.key, ids.filter(id => dispatchedIds.has(id)).length] as const;
    })),
    scoutPlacedFirstByScope: new Map(expansionReading.scopes.map((s) => [s.key, s.work?.scoutRowsPlacedFirst ?? 0])),
    gate: expansionBudget.gate,
  });
}
laneCounts = {
  deterministicDispatched: cycle.lanes?.deterministic.dispatched ?? laneCounts.deterministicDispatched,
  modelDispatched: cycle.lanes?.model.dispatched ?? laneCounts.modelDispatched,
  deferredBy: { ...(cycle.lanes?.model.deferredBy ?? {}) },
};
/* Every lane's reasons, summing to what it skipped; the coordinator's pass is folded in when it runs. */
if (cycle.lanes !== null) finalQueueLanes = lanesAtCycleEnd(cycle.lanes, null, nowIso());
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

/* ------------------------------------------------- test the owner's research leads --- */

if (!dry && !canary) {
  const leads = await pending.step("leads:test", () => runLeadsPass({ repos,
    get: guardedLeadGet(fleetSafety),
    now: () => Date.now(), sleep: ms => new Promise(done => setTimeout(done, ms)),
    sendPlaceIds: sentMoneyPlaces({ areas: expansionBudget?.gate.armedReading().scopes ?? null, sends: assignmentMembers }),
    deadlineMs: Date.now() + LEADS_PASS_BUDGET_MS })).catch((error: unknown) => {
    runtimeConditions.push(`the owner's research leads were not tested this round: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (leads && leads.orders > 0) {
    console.log(`  research leads: ${leads.tested} tested across ${leads.orders} order(s): ${leads.works} work, ${leads.paid} sent to paid work, ${leads.failed} failed, ${leads.waiting} waiting; ${leads.lessons} lesson(s) saved` +
      (leads.lessonError ? `; lessons not saved (${leads.lessonError})` : ""));
  }
}

/* ------------------------------------------------- spread what started working --- */

if (!dry && !canary) {
  const spread = await pending.step("methods:spread", () => runSpreadPass({ repos, now: nowIso(),
    sendPlaceIds: sentMoneyPlaces({ areas: expansionBudget?.gate.armedReading().scopes ?? null, sends: assignmentMembers }),
    paidTriesLeft: guards.paidWorkerCapacity(), fetch: pacedProbeFetch({ pacing: repos.websitePacing, sizeFor: websiteSize }), sizeFor: websiteSize })).catch((error: unknown) => {
    runtimeConditions.push(`working methods were not tried elsewhere: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (spread && spread.methods > 0) console.log(`  spread: ${spreadLine(spread)}`);
  if (spread?.writeError) runtimeConditions.push(`the spread's results were not all recorded: ${spread.writeError}`);
}

/* ------------------------------------------------- close, and persist debt --- */

// Scheduling projections and closure both CAS the standing obligation.
await nextDuePersistence;
/* Dispatched and recovered occurrences close by one rule; a recovered one by the disposition it already carries. */
await pending.step("occurrences:close", () => closeCycleOccurrences(repos, {
  cycle,
  occurrenceFor: (obligationId) => occurrenceByObligation.get(obligationId)?.id ?? null,
  now: NOW,
  concurrency: CONTROL_PLANE_QUERY_CONCURRENCY,
}));

const persisted = await pending.step("debts:persist", () => persistDebts(
  repos,
  cycle.debts,
  NOW,
  canary ? corpus.map((obligation) => obligation.id) : null,
  retiredDebtReasons,
  CONTROL_PLANE_QUERY_CONCURRENCY,
));
finishPhase("occurrence-and-debt-commit");
console.log(
  `\n  debt persisted: ${persisted.written} row(s) written, ${persisted.cleared.length} cleared` +
    (persisted.clearedAsRetired.length > 0 ? `, ${persisted.clearedAsRetired.length} tombstoned as retired` : ""),
);

// Worker processes pull the existing ledger. Their results are joined before
// finalization, alongside the independent discovery/publication passes.
async function makeAutonomousFleet() {
  const fleetTransport = modelLaneEnabled ? workerMessages : null;
  const runtime = await autonomousStandingRuntime({ root: ROOT, repos, now: nowIso, environment: process.env,
    ...(scoutSearch ? { search: scoutSearch } : {}),
    ...(scoutSearchLifetime ? { searchFor: subject => lifetimeHuntSubjects.has(subject) ? scoutSearchLifetime : scoutSearch ?? undefined } : {}),
    ...(searchBudget ? { searchBudget } : {}),
    spaceOut: spacer, browse: browseWithPlaywright,
    openBytes: fleetSafety.guardedOpenBytes("public-web", "registered autonomous Fleet acquisition"),
    openBytesFor: subject => fleetSafety.guardedOpenBytes("public-web", subject),
    ...(fleetTransport !== null && paidWorkerCapacity() > 0 ? { transport: fleetTransport,
      transportFor: autonomousTransportFor(fleetTransport),
      refusedBeforeSending: (error: unknown) => error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal } : {}),
    auditCeilingUsd: effectiveCeilingUsd,
    lifetimeHuntSubject: subject => lifetimeHuntSubjects.has(subject) });
  return { ...runtime, exaAgentLane: readSetting(config, EXA_AGENT_LANE_SETTING, false) };
}
async function runAutonomousWave() {
  placeOrderDirty = true;
  await refreshPlaceOrder();
  const fleet = await makeAutonomousFleet();
  /* The legacy held-evidence plan runs only when schema-1 held work is owed: a registered event
     capture whose Parser, Validator, Auditor chain has a step left. Both reads come from the round's incremental copy. */
  const held = await legacyHeldWorkOwed(ROOT, fleet) ? await planHeldWorkerFleet(ROOT, fleet, true) : [];
  const workItemsById = new Map<string, WorkItem>();
  const planned = await runAutonomousCoordinator(fleet, { planOnly: true, acceptsWorkItem: item => plannedForHunters(item.autonomousPlan),
    onSelectionSnapshot: items => { for (const item of items) workItemsById.set(item.id, item); },
    prioritizedInstructions: placeOrder.map((receiptId, priority) => ({ receiptId, priority })),
    ...(squadReading ? { squads: squadReading } : {}) });
  /* Under the hunter lane the lane decides paid admission, so every planned Scout is queued. */
  const plannedTasks = planned.decisions.filter(row => row.task && (row.action === "WORKER" ||
    (row.action === "SCOUT" && (CONTINUOUS_HUNTERS || paidWorkerCapacity() > 0)))).map(row => row.task!);
  const taskIds = [...new Set([...held.map(task => task.id),
    ...plannedTasks.map(task => task.id)])];
  const taskWorkIds = new Map([...held, ...plannedTasks].map(task => [task.id, task.workItemId]));
  const metadata = new Map(taskIds.map(id => [id, workItemsById.get(taskWorkIds.get(id)!)]));
  workItemsById.clear();
  const plainTaskIds = new Set([...held.filter(task => !["SCOUT", "DETECTIVE"].includes(task.workerTask?.role ?? "")).map(task => task.id),
    ...planned.decisions.filter(row => row.task && row.action === "WORKER" &&
      !["SCOUT", "DETECTIVE"].includes(row.task.workerTask?.role ?? "")).map(row => row.task!.id)]);
  if (planned.squadWeights.length > 0) {
    console.log(`  squads: ${planned.squadWeights.filter(row => row.send !== "standing").map(row =>
      `${row.send} ${row.part} open ${row.open ?? "unread"} detective ${row.detectiveTurns} debts ${row.openDebts} weight ${row.weight.toFixed(2)}`).join("; ")}`);
  }
  /* The coordinator's (Send, part) order breaks ties among a Send's pending tasks. */
  const plannedOrder = new Map(planned.decisions.filter(row => row.task).map((row, index) => [row.task!.id, index] as const));
  const failedTaskIds = new Set<string>();
  const queueFailures: DispatchResult[] = [];
  const failedQueueRead = (id: string, error: unknown) => {
    if (failedTaskIds.has(id)) return;
    failedTaskIds.add(id);
    const result = workerDispatchFailure(id, error);
    queueFailures.push(result);
    runtimeConditions.push(`${id}: ${result.detail}`);
  };
  // Every child pulls from the same full wave. Capture hunt rounds once;
  // completed/leased tasks disappearing must not reset a hunt to round zero.
  const readTaskQueue = () => {
    const rank = (id: string): number => {
      const item = metadata.get(id);
      if (!item) return Infinity;
      const own = item.autonomousPlan?.ownerInstructions?.map(receipt => placeOrder.indexOf(receipt)).filter(at => at >= 0) ?? [];
      return Math.min(placeRankFor(item.subject) ?? Infinity, ...own);
    };
    const compareRound = huntRoundComparator(taskIds, id => {
      const at = rank(id);
      return placeOrder[at] ?? metadata.get(id)?.autonomousPlan?.ownerInstructions?.[0] ?? null;
    });
    return { rank, compareRound };
  };
  let taskQueue: ReturnType<typeof readTaskQueue> | null = null;
  if (CONTINUOUS_HUNTERS) {
    /* The round's order, written for the standing hunter lane; no lease worker starts here. */
    const queue = taskQueue ??= readTaskQueue();
    const ordered = taskIds.filter(id => !failedTaskIds.has(id)).sort((a, b) => queue.compareRound(a, b) || queue.rank(a) - queue.rank(b) ||
      (plannedOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (plannedOrder.get(b) ?? Number.MAX_SAFE_INTEGER));
    if (!dry && !canary) {
      try {
        writeHunterQueue(hunterQueuePath(hunterLaneArmingPath(ROOT)), { writtenAt: nowIso(), taskIds: ordered, plainTaskIds: ordered.filter(id => plainTaskIds.has(id)) });
        console.log(`  hunter lane queue: ${ordered.length} task(s) written for the standing hunter lane (${ordered.filter(id => plainTaskIds.has(id)).length} plain-code)`);
      } catch (error) {
        runtimeConditions.push(`the hunter lane's queue could not be written (${error instanceof Error ? error.message : String(error)}); the planned tasks remain owed`);
      }
    }
    return { ...planned, dispatches: [...queueFailures], scoutsAdmitted: 0, scoutsLimitedAdmitted: 0 };
  }
  const workerDispatches = await runLeaseWorkerProcesses({ entry: "lib/control-plane/workers/lease-worker.ts",
    deadlineMs: dispatchDeadlineMs,
    /* A hung worker is ended, and says so, before the runner's no-progress limit could end the whole round. */
    childTimeoutMs: RUNTIME_NO_PROGRESS_MS - 60_000,
    slots: workerSlots,
    config: { root: ROOT, postgres: wantsPostgres, taskIds, modelEnabled: paidWorkerCapacity() > 0,
      searchEnabled: scoutSearch !== null, get ceilingUsd() { return effectiveCeilingUsd; }, hostConcurrency, fundedSubjects: [...lifetimeHuntSubjects] },
    capacity: () => Math.min(taskIds.length, plainTaskIds.size + paidWorkerCapacity(taskIds.length)),
    transportFor: guards.workerTransportFor,
    ...(scoutSearch ? { searchFor: subject => lifetimeHuntSubjects.has(subject) ? scoutSearchLifetime ?? scoutSearch : scoutSearch } : {}),
    ...(searchBudget ? { searchBudget } : {}),
    orderPending: async ids => {
      await Promise.all([refreshPlaceOrder(), refreshOwnerSettings()]);
      const queue = taskQueue ??= readTaskQueue();
      const paidOpen = paidWorkerCapacity() > 0;
      // Only ordering is a wave snapshot. A changed task role must still read
      // the current paid admission; the child re-reads its task before claiming.
      const tasks = paidOpen ? [] : await Promise.all(ids.map(async id => {
        if (failedTaskIds.has(id)) return null;
        try { return await repos.routeTasks.read(id); }
        catch (error) { failedQueueRead(id, error); return null; }
      }));
      return ids.filter((id, index) => !failedTaskIds.has(id) &&
        (paidOpen || !["SCOUT", "DETECTIVE"].includes(tasks[index]?.value.workerTask?.role ?? "")))
        .sort((a, b) => queue.compareRound(a, b) || queue.rank(a) - queue.rank(b) ||
          (plannedOrder.get(a) ?? Number.MAX_SAFE_INTEGER) - (plannedOrder.get(b) ?? Number.MAX_SAFE_INTEGER));
    },
    onDispatched: result => {
      placeOrderDirty = true;
      roundProgress.note("worker wave");
      if (typeof result.repositoryCalls === "number") leaseTaskCalls.push(result.repositoryCalls);
      if (result.worker?.role !== "SCOUT") return;
      const outcome = result.disposition === "INGESTED" ? "CAPTURED"
        : result.disposition === "WALKED_NO_YIELD" || result.disposition === "DISCOVERED" ? "NOTHING_FOUND" : "REFUSED";
      console.log(`  Scout done: ${result.obligationId}; ${outcome}; code ${result.disposition ?? result.outcome ?? "NOT_RUN"}; usd ${result.cost?.usd === null || result.cost?.usd === undefined ? "unmeasured" : result.cost.usd.toFixed(6)}`);
    },
    onStarted: pid => console.log(`  lease worker process: pid ${pid}; pulls existing RouteTasks`),
    onExited: (pid, why) => console.log(`  lease worker process ended: pid ${pid}; ${why}`) });
  const dispatches = [...queueFailures, ...workerDispatches];
  const scouts = dispatches.filter(row => row.attemptId && row.worker?.role === "SCOUT").length;
  return { ...planned, dispatches, scoutsAdmitted: scouts, scoutsLimitedAdmitted: scouts };
}
async function runAutonomousProcesses() {
  let report = await runAutonomousWave();
  while (!releaseDrainRequested && Date.now() < dispatchDeadlineMs && report.dispatches.some(row => row.outcome === "WORKED")) {
    const next = await runAutonomousWave();
    report = { ...next, dispatches: [...report.dispatches, ...next.dispatches],
      scoutsAdmitted: report.scoutsAdmitted + next.scoutsAdmitted,
      scoutsLimitedAdmitted: report.scoutsLimitedAdmitted + next.scoutsLimitedAdmitted };
    if (!next.dispatches.some(row => row.outcome === "WORKED")) break;
  }
  return report;
}
type CampaignSitesSummary = {
  readsUsed: number; rereadsUsed: number; judgedFromVault: number; elapsedMs: number;
  verdicts: CampaignSiteCycleReport["verdicts"]; byCode: Record<string, number>;
  byStage: Record<string, number>; offers: { accepted: number; refused: number }; approved: number; unjoined: number;
};
let campaignSites: CampaignSitesSummary | null = null;
const campaignSitesLine = (report: CampaignSitesSummary) => `  campaign sites     ${report.readsUsed} read(s), ${report.judgedFromVault} judged from vaulted reads, ${report.approved} approved for the derived door`;
let campaignSitesState = "not run: the campaign-site pass has not started";
let candidatePublications = null as CandidatePublicationCycleReport | null;
let candidatePublicationsState = "not run: no original-scope candidacy admission";
let roundVaultRead: Promise<VaultIndex> | undefined;
let discoveryLaneRun: Promise<readonly IndependentRuntimeOutcome[]> | null = null;
let discoveryLaneIds: readonly string[] = [];
const discoveryLanesFinished = new Set<string>();
/* One full listing per round; later captures join it through includeVaultCapture. The step is timed once in the round's phases. */
const readRoundVault = (signal?: AbortSignal) => roundVaultRead ??= (async () => {
  const startedMs = Date.now();
  const index = await indexVault(join(ROOT, ...VAULT_DIR), undefined, { signal });
  const phase = cycleObservation.note("vault-index", Date.now() - startedMs);
  console.log(`  phase ${phase.name}: ${phase.durationMs}ms`);
  return index;
})();
try {

const CAMPAIGN_SITES_SETTLE_MS = 3 * 60_000;
const runCampaignSitesPass = async (): Promise<void> => {
  if (dry || canary || ONLY !== null || IDS !== null) {
    campaignSitesState = "not run: a dry, canary, filtered cycle reads nothing";
  } else if (intents.runnerPause.paused) {
    campaignSitesState = "not run: the owner has paused the runner";
  } else {
    const leaveCampaignSites = pending.enter("campaign-sites");
    /* Loading is included in elapsed-time reporting. */
    const campaignStartedMs = Date.now();
    /* Each wait inside the lane is labelled, so a stall answer and a deferral name the step. */
    let waitingOn = "the canonical candidacies";
    const step = <T,>(label: string, run: () => Promise<T> | T): Promise<T> => {
      waitingOn = label;
      return pending.step(`campaign-sites:${label}`, run);
    };
    try {
      const bounded = await withinWallTime((async () => {
        const methodVersion = await step("the method version", roundMethodVersion);
        const openCampaignSite = fleetSafety.guardedOpenBytes("discovery-web", "campaign-site-chain", fetch, { followRedirects: false });
        const report: CampaignSitesSummary = { readsUsed: 0, rereadsUsed: 0, judgedFromVault: 0, elapsedMs: 0,
          verdicts: { read: 0, vault: 0, verified: 0, refused: 0, deferred: 0 }, byCode: {}, byStage: {},
          offers: { accepted: 0, refused: 0 }, approved: 0, unjoined: 0 };
        let responses = 0, answers = 0, unreadable = 0, statesRun = 0;
        let subjectCount = 0;
        let linkedCount = 0;
        for (const state of trackedStateCodes) {
          const holdings = await step(`${state} candidate authorities`, () => readCandidateEnrichmentAuthorities(state));
          const { subjects, linked, failures } = campaignSiteSubjectsFromHoldings(holdings, nowIso());
          if (failures.length) runtimeConditions.push(...failures);
          subjectCount += subjects.size;
          linkedCount += linked.size;
          if (!subjects.size) continue;
          const held = await step(`${state} held Marginalia answers`, () => heldMarginaliaAnswers(repos, join(ROOT, ...VAULT_DIR), nowIso(), subjects));
          responses += held.responses.length; answers += held.answers; unreadable += held.unreadable;
          const stateReport = await step(`${state} campaign-site chain`, () => runCampaignSiteCycle({
          startedAtMs: campaignStartedMs,
          repos,
          subjects,
          /* Their leads are read last: a site approved for a candidacy that already carries a campaign link is held, never published. */
          linkedCandidacies: linked,
          marginalia: held.responses,
          now: nowIso(),
          clock: () => Date.now(),
          sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
          open: async ({ url, headers, timeoutMs }) => {
            const got = await openCampaignSite({ url, headers, timeoutMs });
            return { status: got.status, body: got.bytes, contentType: got.contentType, location: got.location ?? null, transportError: got.transportError };
          },
          spaceOut: spacer,
          vaultRoot: join(ROOT, ...VAULT_DIR),
          methodVersion,
          deadlineMs: dispatchDeadlineMs,
          }));
          statesRun++;
          report.readsUsed += stateReport.chain.readsUsed;
          report.rereadsUsed += stateReport.chain.rereadsUsed;
          report.judgedFromVault += stateReport.chain.judgedFromVault;
          report.approved += stateReport.chain.approved.length;
          report.unjoined += stateReport.chain.unjoined.length;
          for (const offer of stateReport.chain.offers) report.offers[offer.accepted ? "accepted" : "refused"]++;
          report.verdicts = Object.fromEntries(Object.entries(report.verdicts).map(([key, value]) =>
            [key, value + stateReport.verdicts[key as keyof typeof stateReport.verdicts]])) as CampaignSiteCycleReport["verdicts"];
          for (const [key, value] of Object.entries(stateReport.byCode)) report.byCode[key] = (report.byCode[key] ?? 0) + value;
          for (const [key, value] of Object.entries(stateReport.chain.byStage)) report.byStage[key] = (report.byStage[key] ?? 0) + value;
        }
        if (!statesRun) throw new Error("No state has a usable candidate authority for campaign-site work.");
        report.elapsedMs = Date.now() - campaignStartedMs;
        return {
          report,
          state:
            `ran over ${subjectCount} canonical candidacies (${linkedCount} already carrying a campaign link, read last) and ${responses} newest held Marginalia answer(s) of ${answers} vaulted` +
            (unreadable > 0 ? ` (${unreadable} answer(s) the vault could not produce)` : ""),
        };
      })(), dispatchDeadlineMs + CAMPAIGN_SITES_SETTLE_MS - Date.now());
      if (bounded.done) {
        campaignSites = bounded.value.report;
        campaignSitesState = bounded.value.state;
      } else {
        campaignSitesState = `deferred: still waiting on ${waitingOn} ${Math.round((Date.now() - dispatchDeadlineMs) / 60_000)} min after the round's dispatch cutoff; its unread leads and unverified sites remain owed`;
        runtimeConditions.push(`campaign-site pass ${campaignSitesState}`);
      }
    } catch (error) {
      campaignSitesState = `could not run: ${error instanceof Error ? error.message : String(error)}`;
      runtimeConditions.push(`campaign-site pass ${campaignSitesState}`);
    } finally {
      leaveCampaignSites();
    }
  }
  console.log(campaignSites === null ? `  campaign sites     ${campaignSitesState}` : `${campaignSitesLine(campaignSites)} · ${campaignSitesState}`);
};

const runCandidatePublicationsPass = async (): Promise<void> => {
  if (dry || canary || ONLY !== null || IDS !== null || intents.runnerPause.paused) {
    candidatePublicationsState = "not run: dry, canary, filtered or paused cycle";
  } else if (!hasLifetimeHunt) {
    candidatePublicationsState = "not run: exact selected hunt receipt is unavailable";
  } else {
    const leavePublications = pending.enter("candidate-publications");
    try {
      const vaultRead = await readRoundVault();
      // Once an ACQUIRER begins committing a captured page or a typed blocked
      // disposition, let that repository operation settle. Racing a writer with
      // a wall timer would leave an apparently stopped pass writing in the back.
      const pass = await runCandidatePublicationCycle({
        repos, eligibleCandidacyIds: lifetimeHuntSubjects,
        heldVault: vaultRead, vaultRoot: join(ROOT, ...VAULT_DIR),
        methodVersion: await roundMethodVersion(),
        clock: () => Date.now(), sleep: ms => new Promise(done => setTimeout(done, ms)), spaceOut: spacer,
        deadlineMs: dispatchDeadlineMs,
        openFor: candidacyId => {
          const opened = fleetSafety.guardedOpenBytes("public-web", candidacyId, fetch, { followRedirects: false });
          return async ({ url, headers, timeoutMs }) => {
            const got = await opened({ url, headers, timeoutMs });
            return { status: got.status, body: got.bytes, contentType: got.contentType,
              location: got.location ?? null, transportError: got.transportError };
          };
        },
      });
      candidatePublications = pass;
      candidatePublicationsState = `ran: ${pass.acquired} acquired, ${pass.deferred} deferred, ${pass.failed} failed of ${pass.due} due linked pages` +
        (pass.stoppedLoading ? ` (the dispatch cutoff stopped it while reading ${pass.stoppedLoading}; the linked pages stay owed)` : "");
    } catch (error) {
      candidatePublicationsState = `failed: ${error instanceof Error ? error.message : String(error)}`;
      runtimeConditions.push(`candidate publication acquisition ${candidatePublicationsState}`);
    } finally { leavePublications(); }
  }
  console.log(`  candidate documents ${candidatePublicationsState}`);
};

const DISCOVERY_SERIAL = process.env.WTP_DISCOVERY_SERIAL === "1";
if (DISCOVERY_SERIAL) {
  await runCampaignSitesPass();
  finishPhase("campaign-sites");
  await runCandidatePublicationsPass();
  finishPhase("candidate-publications");
} else {
  const lanesStartedMs = Date.now();
  const timed = (id: string, run: () => Promise<void>) => ({ id, run: async () => {
    try { await run(); } finally { discoveryLanesFinished.add(id); console.log(`  lane ${id}: ${Date.now() - lanesStartedMs}ms`); }
  } });
  discoveryLaneRun = runIndependentRuntimePass([
    timed("campaign-sites", runCampaignSitesPass),
    timed("candidate-publications", runCandidatePublicationsPass),
  ]);
  discoveryLaneIds = ["campaign-sites", "candidate-publications"];
}

// Registered autonomous plans use the same dispatcher, vault, host spacing and
// rolling model ceiling. Discovery shares this cycle's existing Scout allowance.
// Leave a minute after the last worker for the Admin state/heartbeat.
// A prior cycle's late worker ended at the dispatch deadline, then its final
// research state and heartbeat could not start before the hard wall.
// Selection can read several complete repositories before it admits a worker.
// Its own store budget must end before finalization starts, while a worker
// admitted earlier still has time to finish and settle. This is a technical
// slice boundary, not a count or spend cap: undispatched work remains owed.
} finally {

  if (earlyOriginal !== null) {
    const leaveEarlyWave = pending.enter("autonomous-workers:early-wave");
    const early = await boundedAfterCutoff(earlyOriginal);
    leaveEarlyWave();
    if (early.done) earlyAutonomous = early.value;
    else {
      const line = `early worker wave deferred: still settling ${Math.round(early.quietMs / 60_000)} min after the round's last output; its unsettled tasks remain owed`;
      runtimeConditions.push(line);
      console.log(`  ${line}`);
    }
  }
}
let autonomousWorked = false;
if (earlyAutonomous !== null) {
  for (const row of earlyAutonomous.deferred) fleetSafety.defer(row.workItemId, row.reason, row.detail);
  if (finalQueueLanes !== null) finalQueueLanes = { ...finalQueueLanes, autonomous: coordinatorLane(earlyAutonomous) };
  autonomousDispatchedThisCycle += earlyAutonomous.dispatches.filter(row => row.attemptId !== null).length;
  autonomousWorked = earlyAutonomous.dispatches.some(row => row.outcome === "WORKED");
  if (autonomousWorked) fleetSafety.recordSuccessfulActivity(nowIso());
  for (const row of earlyAutonomous.dispatches) console.log(`  original hunt early worker: ${row.worker?.role ?? "UNCLAIMED"} ${row.outcome} ${row.attemptId ?? "none"}: ${row.detail}`);
}
if (autonomousCycleOpen) {
  const leaveAutonomous = pending.enter("autonomous-workers");
  try {
    const wave = await boundedAfterCutoff(runAutonomousProcesses());
    if (!wave.done) {
      const line = `worker wave deferred: still settling ${Math.round(wave.quietMs / 60_000)} min after the round's last output; its unsettled tasks remain owed`;
      runtimeConditions.push(line);
      console.log(`  ${line}`);
    } else {
      const autonomous = wave.value;
      for (const row of autonomous.deferred) fleetSafety.defer(row.workItemId, row.reason, row.detail);
      if (finalQueueLanes !== null) finalQueueLanes = { ...finalQueueLanes, autonomous: coordinatorLane(autonomous) };
      autonomousDispatchedThisCycle += autonomous.dispatches.filter(row => row.attemptId !== null).length;
      if (autonomous.dispatches.some(row => row.outcome === "WORKED")) { autonomousWorked = true; fleetSafety.recordSuccessfulActivity(nowIso()); }
      for (const row of autonomous.dispatches) console.log(`  worker fleet: ${row.worker?.role ?? "UNCLAIMED"} ${row.outcome} ${row.attemptId ?? "none"}: ${row.detail}`);
    }
  } catch (error) {
    runtimeConditions.push(`worker processes failed: ${error instanceof Error ? error.message : String(error)}; work remains owed`);
  } finally { leaveAutonomous(); }
}
if (discoveryLaneRun !== null) {
  const leaveLaneJoin = pending.enter("discovery-lanes:join");
  const joined = await boundedAfterCutoff(discoveryLaneRun);
  leaveLaneJoin();
  if (joined.done) {
    for (const outcome of joined.value) {
      if (outcome.state === "FAILED") runtimeConditions.push(`${outcome.id} lane failed: ${outcome.error}`);
    }
  } else {
    /* The lanes stop starting reads at the cutoff; one still running here is waiting on a read that has not answered. */
    for (const id of discoveryLaneIds.filter(lane => !discoveryLanesFinished.has(lane))) {
      const line = `${id} lane deferred: still running ${Math.round(joined.quietMs / 60_000)} min after the round's last output, past the dispatch cutoff; its work remains owed`;
      runtimeConditions.push(line);
      console.log(`  ${line}`);
      if (id === "campaign-sites") campaignSitesState = `deferred: ${line}`;
      if (id === "candidate-publications") candidatePublicationsState = `deferred: ${line}`;
    }
  }
  finishPhase("discovery-lanes");
}

/* ------------------------------------------------- research metrics --- */

// These independent final reads share the existing repository transport limit.
// Join failures too: neither finalization view retries an unchanged failed read.
const finalizationReads = canary ? null : Promise.allSettled([
  repos.scoutResults.readAll(),
  readSpendWindow(repos, nowIso()),
  repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY, ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE",
    Number.MAX_SAFE_INTEGER, { runtimeOutcome: ["kind", "startedAt", "research"] },
    new Date(Date.parse(nowIso()) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString()),
  repos.methodCandidates.read("live").then(row => row?.value ?? emptyCandidateStore()),
  dry ? Promise.resolve(null) : readMethodKnowledge(repos),
] as const);
async function computeMetrics(): Promise<ResearchMetrics | null> {
  const [resultsRead, costsRead, historyRead, candidatesRead] = (await finalizationReads)!;
  if (resultsRead.status === "rejected" || costsRead.status === "rejected") {
    const error = resultsRead.status === "rejected" ? resultsRead.reason : costsRead.status === "rejected" ? costsRead.reason : null;
    runtimeConditions.push(`research metrics NOT computed: a durable log could not be re-read (${error instanceof Error ? error.message : String(error)})`);
    return null;
  }
  const results = resultsRead.value;
  const costsNow = costsRead.value.map(charge => charge.metered);
  const at = nowIso();
  finalSpendWindow = researchSpendInWindow(costsRead.value, at, RESEARCH_BOUNDS.windowHours);
  finalSpendAsOf = at;
  const windowCycles: { startedAt: string; deterministic: number; model: number }[] = [];
  try {
    const since = Date.parse(at) - RESEARCH_BOUNDS.windowHours * 3_600_000;
    if (historyRead.status === "rejected") throw historyRead.reason;
    const priorDigests = historyRead.value;
    for (const row of [...priorDigests].reverse()) {
      const rec = (row as { runtimeOutcome?: Pick<FreshnessCycleOutcome, "kind" | "startedAt" | "research"> }).runtimeOutcome;
      if (rec?.kind !== "FRESHNESS_CYCLE") continue;
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
  let counts: ReturnType<typeof countMethodCandidates> | null = null;
  if (candidatesRead.status === "fulfilled") {
    try { counts = countMethodCandidates(candidatesRead.value); } catch { /* Unreadable authority remains unknown. */ }
  }
  const candidateCounts = counts === null ? null : { proposed: counts.PROPOSED, validated: counts.VALIDATED, admitted: counts.ADMITTED, rejected: counts.REJECTED };
  const pipeline = await NO_PIPELINE_RECORDED();
  /* The cache rows, from the spend window the ceiling reads, over its trailing window and over this cycle for the COST section. */
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
    costPerOutcome: costPerUsefulOutcome({ results, candidateCounts }),
    cacheDefects: cacheDefectCounts(results),
  };
}
/** This cycle's cache rows, for the run record's COST section (null until computed, or when the ledger could not be re-read). */
let cacheThisCycle: CacheHitRate[] | null = null;

if (canary) {
  runtimeConditions.push("live canary: whole-store metrics scans were intentionally skipped");
  metrics = null;
} else {
  metrics = await pending.step("metrics", () => computeMetrics());
}

/* -------------------------------------------- research state, heartbeat --- */

const finishedAt = nowIso();
if (!dry && !canary) {
  const leaveProgression = pending.enter("research-progression");
  try {
    const [scoutsRead, , , candidatesRead, knowledgeRead] = (await finalizationReads)!;
    if (candidatesRead.status === "rejected") throw candidatesRead.reason;
    if (knowledgeRead.status === "rejected") throw knowledgeRead.reason;
    if (knowledgeRead.value === null) throw new Error("the final method knowledge snapshot is unavailable");
    if (scoutsRead.status === "rejected") throw scoutsRead.reason;
    researchProgression = await readResearchProgression(repos, {
      windowId: researchWindowId, through: finishedAt,
      candidates: candidatesRead.value.candidates,
      knowledge: knowledgeRead.value,
      scouts: scoutsRead.value,
      conclusions: readConclusionStore(join(ROOT,"data","method","conclusions.json")),
      researchBoundary: {
        since: priorResearchState?.researchProgression?.through ?? priorResearchState?.cycleFinishedAt ?? NOW,
        previousCompletedWindowId: priorResearchState?.researchProgression?.windowId ?? (priorResearchState?.cycleFinishedAt ? `research:${priorResearchState.host}:${priorResearchState.cycleStartedAt}` : null),
      },
    });
  } catch (error) {
    researchProgressionFailure = error instanceof Error ? error.message : String(error);
    runtimeConditions.push(`RESEARCH_PROGRESSION_UNAVAILABLE: ${researchProgressionFailure}; no zero-progress claim was produced`);
  } finally {
    leaveProgression();
  }
}
finishPhase("metrics-and-finalization");

const finalStep = <T,>(label: string, fn: () => Promise<T>): Promise<T> => pending.step(label, fn);
const failedStep = (step: string, error: unknown): string => {
  const detail = error instanceof Error ? error.message : String(error);
  console.error(`freshness:shadow · finalization step ${step} failed: ${detail}`);
  return detail;
};

try {
  await finalStep("research-state:final", () =>
    writeResearchState(finishedAt));
} catch (error) {
  runtimeConditions.push(`the final research state was not written: ${failedStep("research-state:final", error)}`);
}
const finalState = researchState(finishedAt);

const codeIdentity = pending.sync("code-identity", () => {
  try {
    return readCodeIdentity({
      cwd: ROOT,
      runnerTestedSha: RUNNING_CODE_SHA,
      now: finishedAt,
      fetch: !dry && !canary,
    });
  } catch (error) {
    runtimeConditions.push(`the code identity could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
});

const heartbeat: RunnerHeartbeat = {
  formatVersion: OWNER_SURFACE_FORMAT_VERSION,
  beatAt: finishedAt,
  lastCycleStartedAt: NOW,
  lastCycleFinishedAt: finishedAt,
  nextCycleDueAt: INTERVAL_MIN === null ? null : new Date(Date.now() + INTERVAL_MIN * 60_000).toISOString(),
  lastCycleOk: true,
  testedSha: RUNNING_CODE_SHA,
  host: HOST,
  /* A working beat: the runner is not idling on a PAUSE_RUNNER. */
  pause: null,
  codeIdentity,
  /* What this cycle applied for paid discovery search, so the console can show the runner acknowledged it. */
  discoverySearch: {
    receiptId: discoverySearchReceiptId,
    enabled: discoverySearchOn,
    perCycle: SEARCH_PER_CYCLE,
    perDay: SEARCH_PER_DAY,
    appliedAt: NOW,
    detail: discoverySearchDecision,
  },
  /* BR-05: the runner-side settings this round applied, so Admin can say a saved value is in force. */
  settings: runnerSettingsEcho(settingsConfig, NOW),
};
try {
  await finalStep("heartbeat", async () => {
    const beat = await pending.step("heartbeat:read", () => repos.runnerHeartbeat.read(RUNNER_ID));
    const nextHeartbeat: RunnerHeartbeat = {
      ...heartbeat,

      intakeRuntime: beat?.value.intakeRuntime ?? null,
      /* The parent recorded this release adoption at a separate boundary.
         Carry the original observation unchanged; a cycle is not a recheck. */
    };
    await pending.step("heartbeat:write", async () => {
      if (beat === null) await repos.runnerHeartbeat.put(RUNNER_ID, nextHeartbeat, finishedAt);
      else await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, beat.revision, nextHeartbeat, finishedAt);
    });
  });
} catch (error) {
  runtimeConditions.push(`the runner heartbeat could not be written: ${failedStep("heartbeat", error)}`);
}

/* ------------------------------------------------------------- the digest --- */

const deferredByLine = Object.entries(laneCounts.deferredBy)
  .map(([k, v]) => `${k} ${v}`)
  .join(", ");
const safety = finalState.fleetSafety!;
const researchLines = [
  "FLEET SAFETY",
  `  state              ${safety.status}`,
  `  model spend        cycle ${safety.cycle.modelUsd === null ? "UNMEASURED" : `$${safety.cycle.modelUsd.toFixed(4)}`} · ` +
    `rolling 24h ${safety.rolling24Hours.modelUsd === null ? "UNMEASURED" : `$${safety.rolling24Hours.modelUsd.toFixed(4)}`} / $${safety.bounds.rolling24HourModelUsd.toFixed(2)} (the one spend ceiling)` +
    ((safety.rolling24Hours.worstCaseCharges ?? 0) > 0 ? ` · ${safety.rolling24Hours.worstCaseCharges} unpriced charge(s) counted at worst case` : ""),
  `  aggregate          dispatches ${safety.cycle.dispatches} · requests ${safety.cycle.requests} · payload bytes ${safety.cycle.payloadBytes} · ` +
    `per-download cap ${safety.bounds.maxDownloadBytes} · elapsed ${safety.cycle.elapsedMs}ms`,
  `  stopped/deferred   ${safety.stoppedBecause.length === 0 ? "none" : safety.stoppedBecause.join("; ")}`,
  `  circuits           ${safety.providerCircuits.length === 0 ? "none" : safety.providerCircuits.map(c => `${c.provider}: ${c.condition} (latched until ${c.eligibleAt})`).join("; ")}`,
  `  last success       ${safety.lastSuccessfulActivity ?? "none recorded"}`,
  "",
  "RESEARCH — LEVEL 1",
  `  lane               ${modelLaneEnabled ? "ENABLED" : `CLOSED — ${laneDisabledReason}`}`,
  `  credential         ${WORKER_CREDENTIAL_VAR} configured in this process: ${credentialConfigured ? "yes" : "NO"} (by name; the value reaches only the provider request)`,
  `  model              ${SCOUT_MODEL} · ${workerCapacity} workers · Admin spend dial $${effectiveCeilingUsd}/day; each hunt retains its own budget`,
  `  hunts              ${openedModel} packet(s) opened for the hunters of ${dueModel.length} due model-class · ` +
    `${autonomousDispatchedThisCycle} worker task(s) run${deferredByLine ? ` · deferred ${deferredByLine}` : ""}`,
  `  spend              rolling ${RESEARCH_BOUNDS.windowHours}h: ${spendWindow.windowUsd === null ? "UNMEASURED" : `$${spendWindow.windowUsd.toFixed(4)}`} of $${effectiveCeilingUsd} ceiling (${rollingCeiling.source.toLowerCase()}) ` +
    `(measured ${spendWindow.measured}, unmeasured ${spendWindow.unmeasured} before this cycle)`,
  `  disagreements      ${decisionDisagreements.length} executor-decision disagreement(s) recorded in the run record, never reconciled`,
  `  intents            ${honoredIntents.length} RUN_CYCLE_NOW honored · ${honoredDispatch.length} of ${intents.pendingDispatch.length} pending DISPATCH honored · ` +
    `${honoredLaneIntents.length} lane PAUSE/RESUME acknowledged · paused: ${intentLogUnreadable !== null ? "UNKNOWN (log unreadable; paid lane held closed)" : intents.paused ? "yes" : "no"}`,
  ...ownerDispatches.map(
    (d) => `  owner dispatch     ${d.intentId}: "${d.target}" -> ${d.matched} of ${d.registered} registered unit(s) placed first in both lanes`,
  ),
  `  runtime            ${runtimeConditions.length === 0 ? "no condition prevents eligible Scout work" : runtimeConditions.join("; ")}`,
  `  supervision        ${hostSupervision.measurable ? `relaunch trigger ${hostSupervision.relaunchTrigger.present === null ? "UNKNOWN" : hostSupervision.relaunchTrigger.present ? "present" : "ABSENT"}` : hostSupervision.notMeasurableReason} · ` +
    `proof ${hostSupervision.proof === null ? `ABSENT at ${hostSupervision.proofPath}` : `${hostSupervision.proof.verdict} ${hostSupervision.proof.measuredAt} (${hostSupervision.proof.secondsToRelaunch ?? "?"}s)`}`,
  "",
  ...(metrics === null ? ["RESEARCH METRICS   NOT COMPUTED this cycle (a named runtime condition says why)"] : researchDigestLines(metrics)),
];

const lines = [
  ...digestLines(cycle),
  ...(movedPlan === null || supersededPlan === null
    ? []
    : [
        `  retired            ${retirementApplied?.retired.length ?? 0} of ${movedPlan.retire.length + supersededPlan.retire.length} planned obligation(s) · ` +
          `${movedThisCycle} with a held calendar route this cycle, ${movedRemaining} remain · ` +
          `${supersededPlan.retire.length} planned that the registry no longer emits · ` +
          `${retirementApplied?.occurrencesClosed.length ?? 0} open occurrence(s) closed unresolved · ` +
          `${persisted.clearedAsRetired.length} debt(s) tombstoned as retired` +
          (retirementHeldBack.length > 0 ? ` · held back ${JSON.stringify(retirementHolds)}` : "") +
          ((retirementApplied?.failed.length ?? 0) > 0 ? ` · ${retirementApplied?.failed.length} did not complete, planned again` : "") +
          ((retirementApplied?.deferred.length ?? 0) > 0 ? ` · ${retirementApplied?.deferred.length} deferred to the next cycle (budget)` : "") +
          (retirementError !== null ? ` · COULD NOT RUN: ${retirementError}` : ""),
      ]),
  campaignSites === null ? `  campaign sites     ${campaignSitesState}` : `${campaignSitesLine(campaignSites)} · ${campaignSitesState}`,
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
];
console.log();
for (const line of lines) console.log(line);

/* ------------------------------------------------------ canonical outcome --- */

/* Every Scout job this round admitted and never settled releases its hold (a job that sent books what it committed). */
{
  const notReleased = await releaseRoundHolds!();
  if (notReleased.length) runtimeConditions.push(`budget holds this round could not release (${notReleased.join("; ")}); each leaves the ledger after ${SPEND_HOLD_STALE_HOURS} hours`);
}

const runRecord = {
      startedAt: cycle.startedAt,
      finishedAt,
      researchProgression: researchProgression?.windowId === researchWindowId ? researchProgression : null,
      researchProgressionFailure,
      testedSha: RUNNING_CODE_SHA,
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
      /* Open occurrences their obligation moved past without closing. */
      abandonedOccurrences: { found: abandonedOccurrences, applied: abandonedClosed },

      freeWalks: {
        dispatched: freeWalkSubjects.length,
        read: freeWalks !== UNREAD_FREE_DISCOVERY_WALKS,
        source:
          freeWalks !== UNREAD_FREE_DISCOVERY_WALKS
            ? freeWalks.source
            : freeWalkSubjects.length === 0
              ? "not read: the owner's dispatch has materialized no meetings discovery"
              : "not read: the paid lane is closed, so no admission reaches the hold",
        byReading:
          freeWalks === UNREAD_FREE_DISCOVERY_WALKS
            ? {}
            : freeWalkSubjects.reduce<Record<string, number>>((m, s) => {
                const reading = freeWalks.latestFor(s.jurisdictionId);
                m[reading] = (m[reading] ?? 0) + 1;
                return m;
              }, {}),
        registryFailures: dispatchedDiscovery.failures,
      },
      /* The free campaign-site pass: whether it ran, each lead it read, and every verdict by code. */
      campaignSites: {
        state: campaignSitesState,
        report: campaignSites,
      },
      candidatePublications: { state: candidatePublicationsState, report: candidatePublications },
      /* Rows outside the corpus: what was planned, held back by code, and actually written. */
      retirement:
        movedPlan === null || supersededPlan === null || heldRouteRead === null
          ? null
          : {
              heldCalendarRoute: movedPlan.retire.map((item) => item.obligationId),
              movedThisCycle,
              movedRemaining,
              heldRouteEvidence:
                "unreadable" in heldRouteRead
                  ? { unreadable: heldRouteRead.unreadable }
                  : { governmentsRead: heldRouteCandidates.length, bodiesWithHeldRoute: heldRouteRead.held.size },
              superseded: supersededPlan.retire.map((item) => item.obligationId),
              residue: residueItems.map((item) => item.obligationId),
              heldBackByCode: retirementHolds,
              heldBackExamples: retirementHeldBack.slice(0, 25),
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
        /* This cycle's cache rows from the cost ledger, read by the digest's COST section. */
        cacheThisCycle,
        decisionDisagreements,
        honoredIntents,
        /* Every DISPATCH this cycle acted on, what it matched, and which were honored. */
        ownerDispatches,
        honoredDispatch,
        /* What this cycle created for every target the owner sent the fleet to. */
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
      deferred: cycle.deferred.length,
      deferredReasons: cycle.deferred,
      reclaim: cycle.reclaim,
      debts: cycle.debts.length,
      incidents: cycle.incidents,
      risk: cycle.risk,
      promotedToReaderTruth: cycle.promotedToReaderTruth,
      digest: lines,
      provenance: RUN_PROVENANCE,
      codeIdentity,
} as const;

const cycleId = CYCLE_ID;
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
  health: null,
  promotedToReaderTruth: runRecord.promotedToReaderTruth,
  failure: null,
};

await finalStep("digest:append", () =>
  withControlPlaneConnectRetry(() => appendFreshnessCycleDigest(repos, { outcome: canonicalOutcome, lines }), {
    maxAttempts: 3,
    onRetry: ({ attempt, delayMs, error }) =>
      console.error(
        `freshness:shadow · canonical outcome append, attempt ${attempt} of 3, failed ` +
          `(${error instanceof Error ? error.message : String(error)}); retrying in ${delayMs}ms`,
      ),
  }));
console.log(`\n  canonical outcome: ${cycleId}`);
/* Vital signs: a round that named a post-cutoff deferral counts as deferred, else finished (the watchdog's kills are counted by the parent). */
countVitalSign(runtimeConditions.some(line => /\bdeferred: /.test(line)) ? VITAL_COUNTERS.roundsDeferred : VITAL_COUNTERS.roundsFinished);

const path = pending.sync("local-record:write", () => writeCycleRecord(runRecord));
console.log(`  local diagnostic: ${path}`);
/* The lease's TTL and the runner's exited-holder release cover a miss; it is named, never a crash after a recorded outcome. */
try {
  await finalStep("window-lease:release", () =>
    releaseWindowLease(repos, CYCLE_LEASE_HOLDER, nowIso()));
} catch (error) {
  failedStep("window-lease:release", error);
}
await (stallDiagnostic as CycleStallDiagnostic | null)?.stop();
// Optional private Admin copy of verified originals. This follows the canonical
// cycle outcome: an unavailable mirror can never rewrite acquisition/publication
// truth, and the next ordinary cycle resumes the rotating reconciliation cursor.
if (!dry && !canary && process.env.WTP_ADMIN_EVIDENCE_MIRROR_ENABLED === "1") {
  try {
    const mirror = await runAdminEvidenceMirror({ repos, vaultRoot: join(ROOT, ...VAULT_DIR),
        cursorPath: join(ROOT, "data", "control-plane", "admin-evidence-mirror.cursor.json"),
        deadlineMs: Date.now() + ADMIN_MIRROR_BUDGET_MS });
    console.log(`  private Admin evidence mirror: ${mirror.state}; examined ${mirror.examined}, copied ${mirror.copied}, verified existing ${mirror.alreadyVerified}, refused ${mirror.refused}`);
    if (mirror.failures.length) console.error(`  private Admin evidence copy remains owed: ${mirror.failures.slice(0, 8).join("; ")}`);
  } catch (error) {
    // A timeout leaves remote-copy status UNKNOWN, never success. A later cycle
    // reads the immutable key first and verifies it before retrying the CAS copy.
    console.error(`  private Admin evidence mirror unavailable or unverified; original vault unchanged: ${error instanceof Error ? error.message : "unknown failure"}`);
  }
}
/* Nothing is left to await. A drained loop exits now; anything still holding it open is named, then the cycle exits with its own code instead of waiting for the wall (cycle-exit.ts). */
exitAfterDrainGrace({
  graceMs: CYCLE_DRAIN_GRACE_MS,
  finishedAt: nowIso(),
  exitCode: () => chosenExitCode(process.exitCode),
  activeResources: () => process.getActiveResourcesInfo(),
  log: (line) => console.error(line),
  exit: (code) => process.exit(code),
});
