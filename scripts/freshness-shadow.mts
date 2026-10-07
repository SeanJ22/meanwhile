import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { runLeaseWorkerProcesses, workerDispatchFailure, workerProcessSlots } from "../lib/control-plane/workers/process-pool.ts";
import { RESEARCH_PARENT_PEAK_MIB, reportingWorkerSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { routeProcessExecutor } from "../lib/control-plane/workers/route-process.ts";
import { scoutProcessExecutor } from "../lib/control-plane/workers/scout-process.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { legacyHeldWorkOwed, planHeldWorkerFleet } from "../lib/control-plane/workers/standing.ts";
import { costEntryWithModel } from "../lib/control-plane/cost.ts";
import { persistVerifiedPublicationAnchors, selectStandingLineages, standingLineageCoversDue, standingLineageKeyFor } from "../lib/control-plane/workers/standing-lineage.ts";
import { browseWithPlaywright } from "./scout-browse.mts";
import { autonomousCycleAllowed, runAutonomousCoordinator } from "../lib/control-plane/workers/coordinator.ts";
import { MODELS } from "../lib/models.ts";
import { paidWorkGuards } from "../lib/control-plane/workers/paid-work-guards.ts";
import { hunterLaneArmingPath, laneArmingOf, writeLaneArming } from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { hunterQueuePath, writeHunterQueue } from "../lib/control-plane/workers/hunter-lane.ts";
import { paidWorkerSlots, researchPaidWorkerCapacity } from "../lib/control-plane/scheduler/research-policy.ts";
import { serializeHostSpacing } from "../lib/control-plane/workers/host-spacing.ts";
import { projectFleetPipeline } from "../lib/control-plane/workers/pipeline.ts";
import { isRetiredRoutineMeetingAcquisition } from "../lib/control-plane/workers/autonomous-plan.ts";
import { plannedForHunters } from "../lib/control-plane/workers/route-plan.ts";
import { oneHunterPath } from "../lib/control-plane/workers/scout-scheduling.ts";
import { planRepairBrief } from "../lib/control-plane/workers/plan-repair.ts";
import { observeCyclePhases, type CyclePhase } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { cycleStateWriter } from "../lib/control-plane/scheduler/cycle-state-writer.ts";
import { selectedCycleRepositories } from "../lib/control-plane/scheduler/cycle-selection.ts";
import { websiteSizeFromHoldings } from "../lib/control-plane/scheduler/host-supervision.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { ADMIN_MIRROR_BUDGET_MS, runAdminEvidenceMirror } from "../lib/control-plane/evidence/admin-bridge-runner.ts";
import { retainRecentRoutineMeetingEvidence } from "../lib/control-plane/workers/routine-meeting-intake.ts";
/**
 * `pnpm freshness:shadow` — ONE UNATTENDED CYCLE OF THE FRESHNESS SCHEDULER.
 *
 * It observes, ACQUIRES for real, records, normalizes, STAGES — and **promotes
 * nothing to canonical reader truth**. `runCycle` has no parameter that could,
 * and the promotion tail writes only under ignored `.runtime/control-plane/staging/` diagnostics.
 *
 * ## Two lanes, one cycle
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
 * (no credential in this process, `--dry`, `--no-model`, no delivery path),
 * `PAUSED` (the owner's lane PAUSE or runner PAUSE_RUNNER, or an owner control
 * that could not be read), `CEILING`, `CYCLE_MAX`
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
 * HONORED by this cycle; so is a pending DISPATCH (the owner's target is
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
 *   --owner-intents-unreadable
 *                         the runner could not read the owner's intents before
 *                         starting this cycle: the paid lane stays closed, free
 *                         work runs (pilot-runner.mts passes it)
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
import { incrementalReadsEnabled, INCREMENTAL_READS_ENV, withIncrementalReads } from "../lib/control-plane/repository/incremental-reads.ts";
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
import { ABSENCE_EXPIRY_DAYS, absenceExpiry, absenceUnlockFrom, isArguedAbsence } from "../lib/control-plane/scheduler/absence.ts";
import { buildRegistry, registryLines } from "../lib/control-plane/scheduler/registry.ts";
import { campaignFinanceProvider } from "../lib/control-plane/scheduler/providers/campaign-finance.ts";
import { LOCAL_JURISDICTION_NAMESPACE, localJurisdictionsProvider } from "../lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import {
  candidateEnrichmentHoldings,
  candidateEnrichmentProvider,
  preloadCandidateEnrichmentAuthorities,
} from "../lib/control-plane/scheduler/providers/candidate-enrichment.ts";
import {
  campaignSiteCycleLine,
  campaignSiteSubjectsFromHoldings,
  heldMarginaliaFromManifest,
  runCampaignSiteCycle,
  withinWallTime,
  type CampaignSiteCycleReport,
} from "../lib/control-plane/promotion/campaign-site-cycle.ts";
import { runCandidatePublicationCycle,
  type CandidatePublicationCycleReport } from "../lib/control-plane/promotion/campaign-publication-cycle.ts";
import { includeVaultCapture, indexVault, readHeldBytes, type HeldVaultArtifact, type VaultIndex } from "../lib/control-plane/evidence/read-only-vault.ts";
import { VAULT_READ_TIMEOUT_MS } from "../lib/control-plane/evidence/netlify-store.ts";
import {
  MEETINGS_DISCOVERY_NAMESPACE,
  meetingsDiscoveryObligationId,
  dispatchedAddressSource,
  materializedDiscoveryNeeds,
  meetingsDiscoveryProvider,
  paidDiscoveryHold,
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
import { missionBlanksFrom, relatedMissionBlanks, type MissionBlank } from "../lib/control-plane/workers/mission-brief.ts";
import { liveFamiliesByGovernment } from "../lib/control-plane/expansion/live-families.ts";
import { workerVaultResolver } from "../lib/control-plane/workers/vault.ts";
import { evidenceProjection } from "../lib/control-plane/workers/evidence-projection.ts";
import { researchVaultResolver } from "../lib/control-plane/workers/vault-object.ts";
import { factChainLines } from "../lib/control-plane/promotion/fact-chain.ts";
import { createPermanentMeetingFreshness } from "../lib/control-plane/promotion/meeting-freshness.ts";
import { preloadAzOperationalReferenceBundle, preloadOperationalReferenceBundle, requiredJurisdictionRegistry } from "../lib/civic-data/operational-references.ts";
import { methodMaturityFromManual } from "../lib/control-plane/scheduler/maturity.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { heldCalendarRouteBodies, missionMeetingsDiscoveryNeeds } from "../lib/hunt/mission-meetings-discovery.ts";
import {
  discoveryNeedsToWalk,
  runMeetingsDiscovery,
  walkableByFreeWalk,
  type MeetingsDiscoveryPass,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import { knownRecipes, RECIPE_KIND } from "../lib/hunt/meetings-recipes.ts";
import { runSpreadPass, sentMoneyPlaces, spreadLine } from "../lib/method/spread-pass.ts";
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import { guardedLeadGet, LEADS_PASS_BUDGET_MS, runLeadsPass } from "../lib/control-plane/leads/plain-test.ts";
import { ROUTE_HINTS } from "../lib/hunt/meetings-route-hints.ts";
import { directoryMeetingHints } from "../lib/civic-data/worker-body-directory.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { durableSearchBudget, makeDiscoverySearch } from "../lib/control-plane/discovery/search-runtime.ts";
import { huntSearchScope } from "../lib/control-plane/discovery/hunt-search-scope.ts";
import { fingerprint } from "../lib/control-plane/ids.ts";
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
  recordArguedAbsence,
  retireObligationsByPrefix,
  syncObligations,
  type AbandonedOccurrence,
  type SettledOccurrence,
  FRESHNESS_PROJECT,
} from "../lib/control-plane/scheduler/durable.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { cycleVault, VAULT_DIR } from "../lib/control-plane/scheduler/vault.ts";
import {
  promotionLines,
  readStagingManifest,
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
import { SCOUT_PREWARM_ROUTE_ID, anthropicTransport, scoutJobWorstCaseUsd, scoutPrewarmPlan } from "../lib/control-plane/scheduler/scout-executor.ts";
import { DETECTIVE_SHUT_THRESHOLD, failureResponderExecutor, plainRereadSlot, readSubjectScoutHistory, solvedScoutResult, sourceFailureRecovery, subjectScoutHistory, wakeInstalledAdapterDebts } from '../lib/control-plane/workers/detective.ts';
import { buildScoutToolkit, scoutToolSpecsFor } from "../lib/control-plane/scheduler/scout-tools.ts";
import { makeScoutSearch } from "../lib/control-plane/scheduler/scout-search.ts";
import type { ArtifactProvenance, InheritedEvidence, PriorRung } from "../lib/control-plane/scheduler/scout-contract.ts";
import { consecutiveTransportFailures, MIN_DISTINCT_RUNGS, type ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
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
import { candidateStoreCounts, proposeScoutCandidates, readMethodCandidateStore, type ProposalReport } from "../lib/control-plane/scheduler/scout-candidates.ts";
import { emptyFieldManual, readFieldManual, type FieldManualRead, type FieldManualStore } from "../lib/control-plane/field-manual.ts";
import {
  compoundingPair,
  fieldManualBriefLines,
  knownRouteIds,
  scoutDiscoveryEntries,
  scoutFieldManualProjection,
  scoutFieldManualQuery,
  recordScoutMethods,
  scoutStateHint,
  usedFieldManualEntryIds,
  writeFieldManualDiscoveries,
} from "../lib/control-plane/scheduler/field-manual-scout.ts";
import { recordFoundSources } from "../lib/doors/page-doors.ts";
import { readResearchProgression } from "../lib/control-plane/research-progression.ts";
import { readMethodKnowledge } from "../lib/method/manual-bridge.ts";
import { candidateCounts as countMethodCandidates } from "../lib/method/candidate.ts";
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
  compareReaderImpact,
  type DispatchOrdering,
  type OrderingInputs,
  type ResearchMetrics,
} from "../lib/control-plane/research-metrics.ts";
import { researchDigestLines } from "../lib/control-plane/research-digest.ts";
import { modelRequestBoundFor, type CostEntry } from "../lib/control-plane/cost.ts";
import type { SpendHold } from "../lib/control-plane/budget.ts";
import type { AttemptCost } from "../lib/control-plane/attempt.ts";
import { meteredCostFields, priceMeteredUsage, readMeteredUsage } from "../lib/control-plane/model-cost.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import type { PrewarmOutcome } from "../lib/control-plane/scheduler/shadow-loop.ts";
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
  scoutEscalationReservation,
  modelRequestWorstCaseUsd,
  modelResponseUsd,
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
import { DETECTIVE_SHUT_THRESHOLD_SETTING, readSetting, runnerSettingsEcho } from "../lib/control-plane/settings.ts";
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
  JobSpend,
  SendBudgetRefusal,
  budgetGuardedTransport,
  hasBudgetLines,
  readLiveSpendHolds,
  releaseOpenJobs,
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

const hostWorkerSlots = workerProcessSlots(() => Number.MAX_SAFE_INTEGER,
  { parentPeakBytes: RESEARCH_PARENT_PEAK_MIB * 1024 * 1024, admissionsOpen: () => !releaseDrainRequested });

const ROOT = process.cwd();
const CONTROL_PLANE_ROOT = join(ROOT, ".runtime", "control-plane", "freshness-shadow");
const RUNS_DIR = join(ROOT, ".runtime", "freshness-shadow-runs");
const NOW = new Date().toISOString();
const HOST = hostname();
const nowIso = (): string => new Date().toISOString();

/*
 * **THE CYCLE'S IDENTITY, ITS ONE RECORD PATH, AND WHAT IT IS WAITING ON.**
 *
 *
 * The SHA and the run provenance are read once, here: they are of the code
 * this process loaded and the tree it started from, and every later read
 * spawned git again, unbounded, inside finalization. The run record's path is
 * reserved at start, so the stall diagnostic, the crash handler and the cycle's
 * own record all write the one record. `pending` is the main thread's account
 * of the last phase, the labelled await and the store calls in flight, which
 * the stall diagnostic reads from its own thread (cycle-stall.ts).
 */
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
/*
 * Waits after the dispatch cutoff (the discovery-lane join, the promotion tail's reads) end once the child has printed
 * nothing for this long, three minutes inside the runner's no-progress limit and before its stall probe; what was still
 * running is named as deferred and its work stays owed (post-cutoff-bound.ts).
 */
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

/*
 * **A CRASHED CYCLE WRITES A LEGIBLE RECORD; IT DOES NOT VANISH.**
 *
 *
 * Every await in this script is unguarded by construction — it is a script, not
 * a function. A last-resort handler writes a run record marking the cycle
 * FAILED with the error, prints the `run record:` line the runner greps for,
 * and exits non-zero. A rejected top-level await surfaces here as
 * `uncaughtException` on this runtime; both events are handled and the handler
 * fires at most once.
 *
 * Bounded since 2026-09-23 (recordFailedCycle): the FAILED outcome's append
 * has its own budget, cut to what is left before the wall, and the record names
 * what the cycle was waiting on when it failed.
 */
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
/*
 * Initial response allowance; the existing request guard holds full input/output
 * cost before every request and extends this hold when needed.
 */
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
  /* One in-memory copy of the tables every wave re-reads (planner, standing
     runtime, round start, promotion tail, campaign chain); each later read
     fetches only rows changed since (schema v22). The lease-worker children
     open their own repositories and are not wrapped. WTP_INCREMENTAL_READS=0
     is the way back to whole reads. */
  if (incrementalReadsEnabled()) {
    repos = withIncrementalReads(repos, { log: (line) => console.warn(`freshness:shadow · ${line}`) });
  } else {
    console.log(`freshness:shadow · ${INCREMENTAL_READS_ENV}=0: control-plane tables are read whole on every wave`);
  }
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

/*
 * The candidate store is read once, here. A store that cannot be read costs this
 * round its candidate proposals and nothing else: research, meeting refresh and
 * publication go on, and Admin shows one line.
 */
let candidateStoreUnreadable: string | null = null;
if (wantsPostgres) {
  try {
    await retryStartupRead(() => readMethodCandidateStore(repos), () => null, startupReadRetry);
  } catch (error) {
    candidateStoreUnreadable = error instanceof Error ? error.message : String(error);
  }
}

/*
 * The standing obligation registry consumes the same proof-validated runtime
 * authority as Admin. A missing/unreachable pointer is a named failed cycle;
 * the retired tracked jurisdiction projections are never a silent fallback.
 */
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
await preloadCandidateEnrichmentAuthorities();

/*
 * One CAS lease on the fixed aggregate id `nightly-window` serializes cycle
 * writers: a cycle that finds it held is REFUSED by name (exit 3). The lease is
 * released at the run record; a crashed cycle holds nothing past the TTL.
 */
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

/*
 * The research providers. `local-jurisdictions` gives every named filing
 * officer and election custodian a clock, and `candidate-enrichment` makes
 * campaign sites, positions, bios, photos and contact standing obligations
 * against each state's canonical candidate acquisition denominator.
 */
/*
 * Meeting acquisition belongs to the SOURCE_WIRING-derived meeting-partition
 * contracts; the worker pipeline may project evidence into a fail-closed
 * receipt but never opens the same official feeds on a parallel schedule.
 */
/*
 * THE TRACKED STATES AND THE OWNER'S MATERIALIZED WORK, read before the
 * registry is built.
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
  campaignFinanceProvider(),
  localJurisdictionsProvider({ trackedStates, materialized: () => materialized, meetingPartitions }),
  candidateEnrichmentProvider({ trackedStates }),
  meetingsDiscoveryProvider({ materialized: () => materialized }),
  /*
   * The gaps Ask states about each body, decided by Ask's own rule over what we hold; read once, here, bounded.
   * Beside it, the counts of gaps readers were told, which
   * make those gaps reader impact now and create the work for a body readers were told we hold no meeting of.
   */
  (await import("../lib/control-plane/scheduler/providers/ask-gaps.ts")).askGapsProvider(
    await pending.step("ask-gaps:held-reading", async () =>
      (await import("../lib/control-plane/scheduler/ask-gap-holdings.ts")).askGapsInputFromHeld({ now: NOW, observations: repos.askGapObservations })),
  ),
];
/* With WTP_ONE_HUNTER_PATH on, every paid route no provider planned carries a route plan, so its Scout is hunter work. */
const registryContext = { root: ROOT, nowIso: NOW, planEveryPaidRoute: oneHunterPath() };
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
{
  /* The tracked governments' paid rows and how many reach a reader door; a row with no door waits on its body join. */
  const local = sync.all.filter(o => o.active && o.id.startsWith(LOCAL_JURISDICTION_NAMESPACE) && registry.routeFor(o.id)?.executorClass === "BOUNDED_MODEL_WORKER");
  const planned = local.filter(o => o.autonomousPlan);
  console.log(`  local research rows: ${local.length} paid; ${planned.length} carry a work plan; ${planned.filter(o => o.autonomousPlan?.publication).length} with a reader door`);
  /* How much paid work in each provider is planned hunter work; with the switch on every paid row should be. */
  const paidByProvider = new Map<string, { paid: number; planned: number }>();
  for (const o of sync.all) {
    if (!o.active || registry.routeFor(o.id)?.executorClass !== "BOUNDED_MODEL_WORKER") continue;
    const tally = paidByProvider.get(registry.providerOf(o.id) ?? "unregistered") ?? { paid: 0, planned: 0 };
    tally.paid += 1;
    if (plannedForHunters(o.autonomousPlan)) tally.planned += 1;
    paidByProvider.set(registry.providerOf(o.id) ?? "unregistered", tally);
  }
  console.log(`  paid rows planned as hunter work (one hunter path ${oneHunterPath() ? "on" : "off"}): ${[...paidByProvider].sort(([a], [b]) => a.localeCompare(b))
    .map(([provider, tally]) => `${provider} ${tally.planned} of ${tally.paid}`).join("; ") || "none"}`);
}
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
if (candidateStoreUnreadable !== null) runtimeConditions.push(
  `method candidates could not be read (${candidateStoreUnreadable}); no candidate proposals this round, everything else continues`);
let canonicalCandidateCounts = await candidateStoreCounts(repos);
if (canonicalCandidateCounts === null) {
  runtimeConditions.push("METHOD_CANDIDATE_STORE_NOT_SEEDED: canonical candidate lifecycle is unavailable; no tracked-file fallback was used");
}

/*
 * **WHAT THE REGISTRY NO LONGER EMITS IS RETIRED, AND A RETIRED ROW HOLDS
 * NOTHING OPEN.**
 *
 * Three planners over the rows `syncObligations` read outside the corpus, and
 * one apply (`settleRetirements`):
 *
 * - **A jurisdiction meetings row** (`freshness:jurisdiction:<id>#meetings-N`)
 *   is retired only when its government's exact body holds a calendar route on
 *   the owed rows, and its reason names that body (`planHeldRouteRetirement`).
 *   The superseded planner never sees one.
 * - **A row the registry stopped emitting** is retired only when its provider
 *   read cleanly and the drop stays inside the bound
 *   (`planSupersededRetirement`). Otherwise it is held back by name.
 * - **An already-retired row that still points at an open occurrence** has that
 *   occurrence closed (`planRetiredResidue`).
 *
 * Each open occurrence closes unresolved, never with a disposition, and a
 * retired row's debt is tombstoned as retired by `persistDebts`. The judgement
 * is always made against the FULL registry, never a filtered one. Only a full
 * standing cycle writes; a --dry, --canary, --only/--ids cycle
 * prints the plan and writes nothing. A failure is named in the digest and the
 * run record, and the cycle continues: the rows stay as they were and are
 * planned again next cycle.
 */
const retirementWrites = !dry && !canary;
const retirementOutside = sync.outside !== null && ONLY === null && IDS === null ? sync.outside : null;
const residueItems = retirementOutside === null ? [] : planRetiredResidue(retirementOutside);
const corpusUnits = allUnits.map((u) => ({ providerId: u.providerId, obligationId: u.obligation.id }));
/*
 * The meetings discovery the owner's dispatch materialized. Each
 * government's need is derived from its promoted registry, as the provider
 * derives it. The free walk goes first on these even where the committed ledger
 * does not hold them. The paid lane reads what the walk found (`freeWalks`,
 * read before dispatch); a need that cannot be derived reads UNREAD, which
 * holds.
 */
const dispatchedDiscoveryIds = sync.all.map((o) => o.id).filter((id) => id.startsWith(MEETINGS_DISCOVERY_NAMESPACE));
const dispatchedDiscovery = materializedDiscoveryNeeds(dispatchedDiscoveryIds);
/* A dispatched or mission need's address comes from the promoted jurisdiction reference, or its state's registration; it carries that version (NH330). */
const withAddressSource = (e: { readonly need: MeetingsDiscoveryNeed; readonly reg: Parameters<typeof dispatchedAddressSource>[0] }): MeetingsDiscoveryNeed =>
  ({ ...e.need, addressSource: dispatchedAddressSource(e.reg,
    (e.reg.stateCode.toLowerCase() === "az" ? azOperationalReference ?? legacyOperationalReference : legacyOperationalReference)?.metadata.versionId ?? null) });
const dispatchedNeeds = new Map(dispatchedDiscovery.entries.map((e) => [e.need.jurisdictionId, withAddressSource(e)]));
/*
 * The calendar blanks of every Send's mission map, read with the place order each wave
 * (`refreshPlaceOrder`): each government in a mission place whose body holds no calendar route. The free walk
 * takes them after the dispatched needs, in any state, with no dispatch.
 */
let missionDiscoveryNeeds = new Map<string, MeetingsDiscoveryNeed>();
let missionDiscoveryHeld = 0;
const freeWalkSubjects: readonly FreeWalkSubject[] = [
  ...new Set(dispatchedDiscoveryIds.flatMap((id) => parseMeetingsDiscoveryId(id)?.jurisdictionId ?? [])),
].map((jurisdictionId) => {
  const need = dispatchedNeeds.get(jurisdictionId);
  return { jurisdictionId, walkable: need === undefined ? null : walkableByFreeWalk(need) };
});
let freeWalks: FreeDiscoveryWalks = UNREAD_FREE_DISCOVERY_WALKS;
/*
 * The evidence an old jurisdiction meetings row retires on. Only the governments with an active row outside
 * the corpus are read: each one's exact body, and that body's division's owed rows for a held calendar route.
 */
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
/*
 * The share of the cycle's wall the writes may spend. #368's first pass wrote
 * 43 rows in 34 s; the 484 moved rows would take about three minutes in one
 * cycle. The rest is deferred untouched and planned again, so the move takes
 * a few cycles and the dispatch lanes keep their time. Residue and superseded
 * rows go first, so the large move never starves them.
 */
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
const nextDueByObligation = new Map<string, string>();
let openedDeterministic = 0;
let openedModel = 0;
/** Occurrences a previous cycle opened and did not reach, picked back up. */
/** Obligations whose open/resume threw and were isolated. Never silent. */
const preOpenSkipped: { obligationId: string; why: string }[] = [];
const dueThisCycle: { obligation: (typeof sync.all)[number]; nextDueAt: string; cadenceHours: number }[] = [];

/* A retired obligation owes no freshness: its debt stays out of the cycle, and `persistDebts` tombstones it as retired. */
const debtsIn = await wakeInstalledAdapterDebts(repos,(canary
  ? (await Promise.all(corpus.map((obligation) => repos.debts.read(obligation.id))))
      .filter((row) => row !== null)
      .map((row) => row.value)
  : await loadDebts(repos)
).filter((debt) => !retiredDebtReasons.has(debt.obligationId)),NOW);
/* The plain-code lane's queue key reads this debt (`waitingSince`); so does its reading while the cycle runs. */
const debtAtCycleStart = new Map(debtsIn.map((d) => [d.obligationId, d] as const));
/*
 * BR-05: Admin's shut-door threshold, read from the config as this round starts (no process-wide snapshot).
 * An unreadable or invalid value is the code default 3. What was applied goes into the heartbeat's `settings`.
 */
let settingsConfig: AdminConfig | null = null;
try {
  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  settingsConfig = row !== null && isAdminConfig(row.value) ? row.value : null;
} catch (error) {
  runtimeConditions.push(`Admin settings could not be read; code defaults apply this round: ${error instanceof Error ? error.message : String(error)}`);
}
const shutThreshold = readSetting(settingsConfig, DETECTIVE_SHUT_THRESHOLD_SETTING, DETECTIVE_SHUT_THRESHOLD);
/* A shut door goes to a detective; a passing outage keeps its plain retry. While the paid lane is closed the shut door's plain re-read still runs. */
const plainDecisionBeforeDetective = new Map<string, ExecutorDecision>();
for (const [id, decision] of decisions) {
  const debt = debtAtCycleStart.get(id);
  const recovered = sourceFailureRecovery(decision, debt, shutThreshold);
  if (recovered !== decision) plainDecisionBeforeDetective.set(id, decision);
  decisions.set(id, plainRereadSlot(debt, nowMs, shutThreshold) ? decision : recovered);
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
    repos.occurrences.list(), repos.workItems.list(), repos.artifacts.readAll(), repos.attempts.list(), repos.workerResults.readAll(),
  ]);
  return selectStandingLineages({ occurrences: occurrences.map(row => row.value), workItems: workItems.map(row => row.value),
    artifacts, attempts: attempts.map(row => row.value), workerResults });
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
  nextDueByObligation.set(o.id, row.nextDueAt);
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

/* ------------------------------------------------- the owner's intents --- */

/*
 * READ ONCE, BEFORE ANY ORDER IS DECIDED. The owner's DISPATCH
 * reorders both lanes, so the intent log is read before the deterministic
 * sort and the reader-impact bands below. A log that cannot be read is a
 * named runtime condition — an intent nobody can read is not an intent nobody
 * sent, so the failure is on the record rather than in a guess.
 *
 * **UNREADABLE FAILS CLOSED FOR PAID WORK ONLY.** Before this an
 * unreadable log read as "not paused" and the paid lane could open over a
 * pause nobody could see. Now `intentLogUnreadable` holds the model lane
 * closed as if paused (model-lane.ts), and FleetSafety refuses every model
 * request on the same reason. Each other reader of `intents` was weighed:
 * RUN_CYCLE_NOW / DISPATCH / lane PAUSE-RESUME honoring have nothing to honor
 * from an empty log; routine meeting intake and the dispatch-work writes are
 * plain-code work behind `runnerPause`, and they continue — "free work
 * continues" is the owner's rule for an unreadable control, and anything model-
 * class they create waits behind the closed lane. `pausedByOwner` is not set:
 * the record says the log was unreadable, never that the owner paused.
 */
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

/*
 * **THE OWNER'S DISPATCH — "deploy the fleet".**
 *
 * The owner's words (for example "deep dive on Illinois")
 * are parsed by the PURE `dispatch-target.ts` into state codes and terms and
 * matched against the whole registered universe — `allUnits`, before any
 * `--only` filter — and every matching unit goes FIRST in both lanes this
 * cycle: ahead of the oldest-first deterministic order, ahead of the Scout
 * lane's reader-impact bands, through the one `placeFirstRows` derivation the
 * dispatcher itself applies. Nothing else changes in the ORDER: not the
 * ceilings, not the budget, not per-host spacing, not a debt backoff. What the
 * target is MISSING is created further down, by the dispatch-work step, from the
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

/*
 * **THE OWNER'S EXPANSION SCOPES — STANDING PRIORITY.** (Expansion controls,
 * 2026-09-23; `lib/control-plane/expansion/membership.ts`.)
 *
 * Read once, here, before any order is decided. After the owner's DISPATCH,
 * due work whose government lies in a selected scope (its territory overlaps
 * the scope's ZCTAs) goes first: in the Scout lane by scope priority, 1 first;
 * in the plain-code lane every selected scope together, because the
 * dispatcher's `placeFirst` is a set — and a cycle with a pending DISPATCH
 * orders that lane by the DISPATCH alone. The ORDER
 * never adds, skips or makes due a row, and never opens the paid lane; what a
 * scope is missing is created by the dispatch-work step below, bounded and counted.
 */
/*
 * The promoted registries, read through the one accessor the standing providers
 * use: the territory index, the scope placement and the work a Send
 * creates all see exactly the registries the providers can keep in the corpus.
 * A registry the reader refuses is named, never used.
 */
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
/* Every Send's open blanks, read with the place order; each Scout's brief lists the ones related to its government. */
let missionBlanks: readonly MissionBlank[] = [];
const missionBlanksFor = (subjectId: string): readonly MissionBlank[] => relatedMissionBlanks(subjectId, missionBlanks);
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
    missionBlanks = missionBlanksFrom(places.flatMap(place => place.items), parts);
    /* Every government in a mission place whose body holds no calendar route is owed discovery. */
    const mission = missionMeetingsDiscoveryNeeds({
      jurisdictionIds: scopes.flatMap(scope => [...scope.members]),
      registryFor: requiredJurisdictionRegistry,
      bodyIdFor: (id) => meetingPartitions.bodyIdFor?.(id) ?? null,
      heldRoutes: heldCalendarRouteBodies(places.flatMap(place => place.items)),
    });
    missionDiscoveryNeeds = new Map(mission.entries.map(e => [e.need.jurisdictionId, withAddressSource(e)] as const));
    missionDiscoveryHeld = mission.heldRoute.length;
    for (const failure of mission.failures) if (!runtimeConditions.includes(failure)) runtimeConditions.push(failure);
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

/*
 * **READER IMPACT FIRST for the Scout lane.** The Scout ceiling is small, so
 * which rows go first matters: band 1, band 2, band 3, and the longest wait
 * first within a band, where a row that failed waits from the end of its
 * backoff. Reader impact is the obligation's canonical `readerImpactAt`.
 */
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
const compareScoutRows = (left: ScheduledObligation, right: ScheduledObligation): number => {
  const leftRank = placementRank(left.obligation.id) ?? Number.POSITIVE_INFINITY;
  const rightRank = placementRank(right.obligation.id) ?? Number.POSITIVE_INFINITY;
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;
  const orderable = (row: ScheduledObligation) =>
    orderableDueRow(row, registry.providerOf(row.obligation.id), debtAtCycleStart.get(row.obligation.id));
  return compareReaderImpact(orderable(left), orderable(right), orderingInputs);
};
/*
 * The method version the round's plain-code passes stamp on what they record, read once: the field manual is one
 * multi-megabyte row (6.6 MB on Oct 6), and the intake, campaign-site and linked-publication passes each read it whole
 * for this one number. A failed read is not kept, so the next caller reads again.
 */
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

/*
 * **OPEN IN STEP WITH DISPATCH.** Nothing is pre-opened. Each lane
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
  // The dispatcher hands a FreshnessObligation; opening needs the fuller
  // StandingObligation (occurrence count, open-occurrence id), looked up by id.
  const obligation = standingById.get(id);
  if (obligation === undefined) return false;
  try {
    const resumed = await resumeOpenOccurrence(repos, obligation);
    if (resumed?.kind === "SETTLED") {
      /* The model lane admits a row before opening it; a recovery runs no Scout, so it hands its admission back. */
      if (decisionFor(id, obligation.routeId).kind === "BOUNDED_MODEL_WORKER" && scoutFor(row).lane !== "DETERMINISTIC") {
        openedModel += 1;
        scoutsAdmittedThisCycle = Math.max(0, scoutsAdmittedThisCycle - 1);
        if (!lifetimeHuntWork(id)) scoutsAdmittedOutsideLifetime = Math.max(0, scoutsAdmittedOutsideLifetime - 1);
      } else openedDeterministic += 1;
      return { settled: resumed.settled };
    }
    if (resumed !== null) {
      occurrenceByObligation.set(id, { id: resumed.id, routeTaskId: resumed.routeTaskId });
    } else {
      const occ = await openOccurrence(repos, { obligation, dueAt: row.nextDueAt, now: NOW });
      if (occ === null) return false;
      occurrenceByObligation.set(id, { id: occ.occurrence.id, routeTaskId: occ.routeTask.id });
    }
    if (decisionFor(id, obligation.routeId).kind === "BOUNDED_MODEL_WORKER" && scoutFor(row).lane !== "DETERMINISTIC") openedModel += 1;
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

/*
 * THE ROLLING CEILING IN FORCE — the owner's console override, read at cycle
 * start from the control plane (`AdminConfig.fleetSpendCeiling`), or the built-in
 * fallback when the row was read and no override stands. Read HERE, not at
 * module import, so a change made in the console governs this very cycle
 * with no deploy and no restart. One number drives BOTH scout-admission gates —
 * the FleetSafety rolling ceiling (`rollingCeilingReached`, which admitScout
 * reads) and the research daily ceiling (`ceilingPermits`) — the auditor's
 * admission, and the per-request reservation through the controller's bounds,
 * so a lane paused at the old ceiling resumes on this cycle and there is no
 * second ceiling that silently binds when the dial is raised.
 *
 * A row that cannot be read or is malformed HOLDS paid work: the
 * owner's dial may be set below the built-in fallback, so falling back could
 * raise the ceiling in force. `configHold` closes the model lane below and turns
 * paid search off; the cycle's free work is untouched. Read before the lane is
 * decided, which is why this sits above `modelLaneClosure`.
 *
 * The owner's switch for PAID discovery search (`AdminConfig.discoverySearch`)
 * is read from the same row at the same moment, so a change in the console
 * governs this cycle. Absent, malformed or unreadable reads OFF.
 */
let discoverySearchOn = false;
/* The receipt of the decision applied, echoed into the heartbeat as the runner's acknowledgement; null means the default. */
let discoverySearchReceiptId: string | null = null;
let discoverySearchDecision: string = "OFF: the owner has not allowed paid discovery search in Admin";
let configRead: AdminConfigRead;
try {
  configRead = { row: await repos.adminConfig.read(ADMIN_CONFIG_ID) };
} catch (error) {
  configRead = { unreadable: error instanceof Error ? error.message : String(error) };
}
const { config, holdPaidWork: configHold } = adminConfigForPaidWork(configRead);
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

/*
 * Every owner spending control this cycle could not read, as a sentence. The
 * runner passes `--owner-intents-unreadable` when its own read before starting
 * this cycle failed (pilot-runner.mts `ownerSays`): it could not tell whether
 * the runner itself is paused, so this cycle's paid lane stays closed even when
 * the read above succeeds.
 */
let costLedger: CostEntry[] = [];
let historicalSpendHolds: readonly SpendHold[] = [];
let ledgerUnreadable: string | null = null;
try {
  // readSince already pages under the repository's PAGE request bound.
  // Only transient failures are retried, under the existing backoff and circuit.
  costLedger = [...await retryStartupRead(
    () => repos.costs.readSince(new Date(Date.parse(NOW) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString()),
    () => null, startupReadRetry)];
  if (researchSpendInWindow(costLedger, NOW).windowUsd === null) {
    /* The holds that count now, one row each (schema v24; the ledger row behind WTP_SPEND_HOLDS_TABLE=0). */
    historicalSpendHolds = Object.values(await retryStartupRead(() => readLiveSpendHolds(repos, NOW), () => null, startupReadRetry));
  }
} catch (error) {
  ledgerUnreadable = error instanceof Error ? error.message : String(error);
  runtimeConditions.push(`the cost ledger could not be read (${ledgerUnreadable}); paid model work waits while held and plain-code work continue`);
}
const spendWindow = researchSpendInWindow(costLedger, NOW, RESEARCH_BOUNDS.windowHours, historicalSpendHolds);
const paidSpendHold = ledgerUnreadable !== null
  ? `the cost ledger could not be read (${ledgerUnreadable})`
  : spendWindow.windowUsd === null
    ? `model spend includes ${spendWindow.unmeasured} unmeasured row(s) without complete usage or an existing worst-case reservation; known model spend is $${spendWindow.knownUsd.toFixed(6)}`
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

/* One ordered answer for why the model lane is closed (model-lane.ts). It also
   closes the lane while no delivery path is open: with promotion off, paid
   Scout and auditor output could only accumulate unread (owner, 2026-09-22).
   Either owner pause closes it — the research-lane PAUSE and the runner-level
   PAUSE_RUNNER Admin's runner card issues — and so does any control above that
   could not be read (2026-09-25). */
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
/*
 * With the lane closed only for the hunter lane, each due paid row that carries a work plan has its occurrence
 * opened here (plain-code work, no spend). Its work item then joins this round's coordinator wave and the one hunter
 * queue, and the hunter lane admits its Scout. A row with no plan waits for the lane, as before.
 */
if (queuesForHunterLane && !canary) {
  let queued = 0;
  for (const row of dueModel) {
    if (!plannedForHunters(row.obligation.autonomousPlan)) continue;
    const scheduled = scheduleObligation(row.obligation, nowMs);
    if (isScheduled(scheduled) && await openOccurrenceInStep({ ...scheduled, nextDueAt: row.nextDueAt }) === true) queued += 1;
  }
  console.log(`  planned paid rows queued for the hunter lane: ${queued} of ${dueModel.filter(row => plannedForHunters(row.obligation.autonomousPlan)).length} due`);
}
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
let spentThisCycle = 0;
let scoutsAdmittedThisCycle = 0;
let scoutsAdmittedOutsideLifetime = 0;
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
/* The ceiling in force and the paid-search switch were read above the lane closure. */

const websiteSize = websiteSizeFromHoldings(trackedStateCodes, ROOT);
const fleetSafety = new FleetSafetyController({
  websiteSize,
  now: NOW,
  costs: costLedger,
  spendHolds: historicalSpendHolds,
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
/**
 * The owner's spend dial is re-read on each admission batch, the way
 * `refreshPlaceOrder` already re-reads the place order, so raising the ceiling
 * in Admin lets more paid workers in before this round ends. A read that fails
 * or is malformed keeps the ceiling already in force: a disappeared ceiling is
 * never a higher one.
 */
const SETTINGS_REFRESH_MIN_MS = 5_000;
let settingsReadAt = 0;
let settingsRead: Promise<void> | null = null;
function refreshOwnerSettings(): Promise<void> {
  if (settingsRead) return settingsRead;
  if (Date.now() - settingsReadAt < SETTINGS_REFRESH_MIN_MS) return Promise.resolve();
  settingsReadAt = Date.now();
  settingsRead = (async () => {
    const reread = adminConfigForPaidWork({ row: await repos.adminConfig.read(ADMIN_CONFIG_ID) });
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

/*
 * PAID SEARCH: ONE SWITCH, ONE BUDGET, BOTH CALLERS. The Scout
 * `search` tool and the discovery walk's search rung send the same paid Brave
 * and Exa requests. Before this the Scout tool was built from the env keys
 * alone — outside the owner's switch, the per-cycle and per-day caps and
 * FleetSafety admission. Now neither exists unless the switch is on (an
 * unreadable or malformed row reads OFF, above), and both draw on this one
 * budget: the cycle's cap here, the day's cap in the durable shared ledger
 * under the `discovery-search` vendor, and FleetSafety on its own provider key.
 * The Scout tool is reached only inside the paid model lane besides.
 */
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
/* Pointers only: the model still opens each hit with fetch_public/browse, which read and record robots.txt, wall on an access control, and vault. */
const scoutSearch = searchBudget === null ? null : makeScoutSearch({
  braveKey: process.env.BRAVE_SEARCH_API_KEY,
  exaKey: process.env.EXA_API_KEY,
  budget: searchBudget,
});
const scoutSearchLifetime = searchBudget === null || !hasLifetimeHunt ? null : makeScoutSearch({
  braveKey: process.env.BRAVE_SEARCH_API_KEY,
  exaKey: process.env.EXA_API_KEY,
  budget: searchBudget.lifetimeHunt,
});
console.log(
  scoutSearch === null
    ? `  scout search: OFF (${discoverySearchOn ? "no Brave or Exa key in this process" : configHold !== null ? "held: the owner's config row could not be trusted" : "the owner's paid-search switch is off"})`
    : `  scout search: ON under the owner's switch (${[process.env.BRAVE_SEARCH_API_KEY ? "brave" : null, process.env.EXA_API_KEY ? "exa" : null].filter(Boolean).join("+")}; ` +
        `${SEARCH_PER_CYCLE}/cycle, ${SEARCH_PER_DAY}/day shared with discovery) — pointers only, robots.txt recorded downstream`,
);

/*
 * THE EXPANSION-SCOPE BUDGETS, armed from the same ledger the Fleet ceiling
 * reads. Restrict-only: `admitScout` consults the gate AFTER every Fleet gate,
 * so a scope can hold a Scout back and can never admit one the Fleet refused.
 * An unreadable ledger arms every budgeted scope to hold its paid work.
 */
const expansionBudget = expansionPlan === null
  ? null
  : armExpansionBudget(expansionPlan, { now: NOW, costs: ledgerUnreadable === null ? costLedger : null, worstCaseUsd: SCOUT_JOB_WORST_CASE_USD ?? Number.POSITIVE_INFINITY });
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
 * **WHERE THE OWNER SENT THE FLEET, THE MISSING WORK IS CREATED.**
 * (2026-09-23; `lib/control-plane/expansion/dispatch-work.ts` carries the
 * design note.)
 *
 * The targets: this cycle's DISPATCH intents, the DISPATCH targets an earlier
 * cycle left with work still owed, and every selected expansion scope. For each
 * government in them, every requirement the promoted registry defines that no
 * clock carries is written as a standing obligation, marked OWNER_DISPATCH.
 * There is no write budget and no per-target cap in the code. The new rows join the
 * corpus next cycle through their providers. Nothing here calls a model,
 * appends an intent, or reads a ceiling it could raise: created model-class
 * work waits behind the same lane, the same Fleet ceiling and the same scope
 * budgets as every other row. Only a full standing cycle writes.
 */
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
    /* A government whose family rows an earlier Send already made live gets no paid discovery Scout for it.
     * The held capture is read once per cycle; if it cannot be read the Scouts are planned as before. */
    let liveFamilies: ReadonlyMap<string, ReadonlySet<string>> | undefined;
    try {
      const wanted = new Set(dispatchScopes.flatMap(scope => scope.kind === "RESOLVED" ? [...scope.members] : []));
      const governments = [...registries.values()].flatMap(reg => reg.jurisdictions.filter(j => wanted.has(j.id) && j.ocdId));
      if (governments.length > 0) {
        const capture = await readHeldPlaceCapture([...new Set(governments.map(j => j.ocdId!))], { now: nowIso(), bypassCache: true });
        liveFamilies = liveFamiliesByGovernment({ governments, capture, now: nowIso() });
      }
    } catch (error) {
      console.warn(`  held capture unread; discovery Scouts planned as before: ${error instanceof Error ? error.message : String(error)}`);
    }
    const plan = planDispatchWork({
      targets: dispatchTargets,
      world: {
        liveFamilies,
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
/*
 * **THE FIRST HUNT STARTS IN THE SAME ROUND AS THE ORDER.** The rows the
 * step above just wrote join the corpus through their providers, which ran
 * before it; so the providers are run again over the rows now on file, the new
 * rows are synced, scheduled on this round's clock, and the due ones added to
 * this round's work before the lanes start. Nothing here opens an occurrence or
 * spends: the lanes still admit each row behind every gate, in the same order
 * rules. A failure is named and the rows join next round, as they did before.
 * `WTP_FIRST_HUNT_NEXT_ROUND=1` in the runner's environment file keeps the old
 * path until the same-round start is checked live.
 */
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

/*
 * **EACH SEND'S OWN BUDGET.** (`lib/control-plane/expansion/
 * assignment-budget.ts` carries the design note.) Who belongs to a Send is read
 * from the obligations' own records (plus what the step above recorded after
 * they were read); what it spent, from the same canonical ledger the Fleet
 * ceiling reads. Restrict-only, consulted in `admitScout` after every Fleet gate.
 */
const assignmentMembers = assignmentMembership([...sync.all, ...(sync.outside ?? [])], dispatchRecorded);
/*
 * Fail closed: the Sends this cycle reached each row under — the
 * records the dispatch-work plan meant to write, or, when no plan could be
 * made, every pending DISPATCH's own match. A budgeted Send whose record did
 * not reach the row holds its paid work instead of letting it run unbudgeted.
 */
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
  costs: ledgerUnreadable === null ? costLedger : null,
  worstCaseUsd: SCOUT_JOB_WORST_CASE_USD ?? Number.POSITIVE_INFINITY,
  /* An unread log cannot say which DISPATCH carries a budget, so its work is held (assignment-budget.ts). */
  intentsReadable: intentLogUnreadable === null,
  /* Fail closed: a DISPATCH whose budget is unreadable holds its work; so does work this cycle reached under a Send whose record on the row was not written. */
  malformed: malformedAssignmentBudgetsOf(intentLog),
  reachedThisCycle: sendsReachedThisCycle,
});
const assignmentLabels = new Map(dispatchTargets.map((t) => [t.key, t.label] as const));

/*
 * **THE SEND AND AREA BUDGETS ARE HARD CAPS.**
 * (`lib/control-plane/expansion/spend-holds.ts` carries the design note.) The
 * gates above decide whether a budget can be checked at all; the dollars are
 * HELD on the one shared budget ledger, under its compare-and-set, before any
 * paid call: a Scout job's worst case at admission, an escalation's and a
 * pre-warm's before they run, and every request past what its job holds. A
 * settled job books what it measured; an unmeasured job or a crash leaves the
 * whole hold counting for the rolling 24 hours.
 */
const spendHolds = new DurableSpendHolds({ budget: repos.budget, table: repos.spendHolds, now: nowIso });
/** The admitted Scout job on each obligation this cycle, with what it holds. */
const jobSpend = new Map<string, JobSpend>();
/* A round's end settles what it never settled, then deletes the holds that no longer count (bounded; never accumulated). */
releaseRoundHolds = async () => {
  const open = [...jobSpend.values()]; jobSpend.clear();
  const failed = await releaseOpenJobs(spendHolds, open, nowIso());
  await spendHolds.sweep();
  return failed;
};
/** Each held job's subject, so a pre-warm charged to it names the same jurisdiction. */
const jobSubject = new Map<string, string>();
let scoutJobSeq = 0;
/* The paid-work guards are built in one module, so a standing lease-worker lane builds the same ones (paid-work-guards.ts). */
const guards = paidWorkGuards({ repos, now: nowIso, armedAt: NOW, fleetSafety, providerQueue, spendHolds, assignmentBudget, expansionBudget,
  messages: workerMessages, batch: workerBatch, modelLaneEnabled, ceilingUsd: () => effectiveCeilingUsd,
  ...(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE ? { requestsPerMinute: Number(process.env.WTP_ANTHROPIC_REQUESTS_PER_MINUTE) } : {}),
  onCondition: sentence => { runtimeConditions.push(sentence); } });
const { budgetLinesFor, guardedMessagesFor, autonomousTransportFor, paidWorkerCapacity } = guards;
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
const paidScoutSlots = paidWorkerSlots(workerSlots, paidWorkerCapacity);
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
        costs: ledgerUnreadable === null ? costLedger : null,
        intentsReadable: intentLogUnreadable === null,
        labels: assignmentLabels,
        completionFor: assignmentCompletion,
      });

/* Prior context the Scout may inherit — read once, only when a Scout can run. */
const priorScoutResults = new Map<string, ScoutResult[]>();
const priorDispositionsByObligation = new Map<string, { disposition: string; permission: string; transport: string; note: string; at: string }[]>();
/* Each due place's own field-manual rows, read once before its Scout is briefed. */
const manualReads = new Map<string, FieldManualRead>();
const inheritedManualStores = new Map<string, FieldManualStore>();
/* The divisions each Scout's obligation covers, where its method results are recorded. */
const scoutDivisions = new Map<string, readonly string[]>();
const inheritedFieldManualCounts = new Map<string, number>();
/** The exact projected doors handed to each obligation's scout at dispatch — captured input for the delivery audit, keyed by obligation id. */
const inheritedFieldManualDoors = new Map<string, { readonly entryIds: readonly string[]; readonly lines: readonly string[] }>();
if (modelLaneEnabled && dueModel.length > 0) {
  try {
    const priorResults = await readSubjectScoutHistory(repos,dueModel.map(row=>row.obligation));
    for (const r of priorResults) {
      const list = priorScoutResults.get(r.obligationId) ?? [];
      list.push(r);
      priorScoutResults.set(r.obligationId, list);
    }
  } catch (error) {
    runtimeConditions.push(`prior Scout results could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const places = [...new Map(dueModel.map((row) => [row.obligation.subjectId, row.obligation] as const)).values()];
  const reads = await Promise.all(places.map(async (obligation) => [obligation.subjectId,
    await readFieldManual(repos, scoutFieldManualQuery({ subjectId: obligation.subjectId, obligationId: obligation.id, divisions: obligation.scopeDivisions ?? [] }))] as const));
  for (const [subjectId, read] of reads) manualReads.set(subjectId, read);
  const unread = reads.find(([, read]) => read.error !== undefined);
  if (unread) runtimeConditions.push(`the field manual could not be read: ${unread[1].error}`);
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
  const all = subjectScoutHistory([...priorScoutResults.values()].flat(),row.obligation.subjectId,row.obligation.recordClass);
  const prior = all.slice(-2);
  const dispositions = (priorDispositionsByObligation.get(id) ?? []).slice(-3);
  const debt = debtsIn.find((d) => d.obligationId === id);
  const lines: string[] = [];
  for (const r of prior) {
    // A retained legacy result can carry a non-array nextRungs value. Keep
    // the evidence and resume from recorded rungs instead of aborting a Scout.
    const nextRungs = Array.isArray(r.nextRungs)
      ? r.nextRungs.filter((value): value is string => typeof value === "string")
      : [];
    lines.push(
      `PRIOR SCOUT ${r.recordedAt}: ${r.refusal ? `REFUSED (${r.refusal.map((i) => i.code).join(", ")})` : r.outcome} (${r.stoppedBy}); ` +
        `rungs: ${r.rungs.map((g) => `${g.rung} -> ${g.target} [${g.observed}]`).join("; ") || "none"}; ` +
        `next rungs it named: ${nextRungs.join("; ") || "none"}${Array.isArray(r.nextRungs) ? "" : " (stored list unreadable; re-evaluate from retained rungs)"}; ` +
        `candidates: ${r.candidates.map((c) => `${c.routeId} <${c.url}>`).join(", ") || "none"}`,
    );
  }
  for (const d of dispositions) {
    /* The robots.txt verdict is a record, never a reason to stop; the transport says whether a wall stood. */
    lines.push(`PRIOR DISPOSITION ${d.at}: ${d.disposition} (robots.txt ${d.permission}, recorded, never a refusal; transport ${d.transport}) — ${d.note.slice(0, 300)}`);
  }
  if (debt) lines.push(`DEBT: ${debt.consecutiveFailures} consecutive failure(s), retry at ${debt.retryAt}; ${debt.target} ${debt.cause} at ${debt.lastFailedAt}: ${debt.detail}`);
  /* A dispatched discovery row starts from what the free walk saw: its outcome and the leads it could not confirm. */
  const discovery = parseMeetingsDiscoveryId(id);
  const freeWalk = discovery === null ? null : (freeWalks.evidenceFor?.(discovery.jurisdictionId) ?? null);
  if (freeWalk !== null) lines.push(freeWalk);
  /*
   * The recorded rung list is the resume cursor, and a durably
   * failed rung is not re-walked. An inherited artifact may be
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
   * Open by inheriting the field manual. Project it to this
   * obligation's jurisdiction and record class and put the known doors at the
   * TOP of the brief, so the Scout walks what already worked before novelty and
   * does not rebuild a door already listed. The count is the inherited half of
   * the reported pair, stashed for onResult.
   */
  const manual = manualReads.get(row.obligation.subjectId) ?? { store: emptyFieldManual() };
  const projection = scoutFieldManualProjection(manual, {
    subjectId: row.obligation.subjectId,
    obligationId: row.obligation.id,
    divisions: row.obligation.scopeDivisions ?? [],
    recordClass: row.obligation.recordClass,
  });
  scoutDivisions.set(id, row.obligation.scopeDivisions ?? []);
  inheritedFieldManualCounts.set(id, projection.entryIds.length);
  inheritedManualStores.set(id, manual.store);
  const manualLines = fieldManualBriefLines(projection);
  // Capture the EXACT projected doors handed to this scout, at dispatch, for the delivery audit.
  inheritedFieldManualDoors.set(id, { entryIds: projection.entryIds, lines: manualLines });
  return {
    artifactIds: [...new Set(prior.flatMap((r) => r.artifactIds))],
    summary: [...manualLines, ...lines].join("\n"),
    provenance,
    priorRungs,
    transportFailures: consecutiveTransportFailures(all),
    nextRungs: Array.isArray(all.at(-1)?.nextRungs)
      ? all.at(-1)!.nextRungs.filter((value): value is string => typeof value === "string")
      : [],
  };
}

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
const scoutResultsThisCycle: ScoutResult[] = [];
const candidateReports: ProposalReport[] = [];
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

/**
 * The research state this cycle writes, carrying the owner's dispatch it
 * honored. `ownerDispatch` is the latest DISPATCH this cycle honored,
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
    assignments: assignmentsReading(),
  };
}

/*
 * Up to four read-and-compare-and-set tries, inside one budget, and every
 * failed try said on stderr. The row is 1.1 MB, so each try moves
 * about 3.3 MB; the four tries used to fail silently, and at 30 s a request
 * they could hold a finalization for four minutes without a word.
 */
const writeResearchState = cycleStateWriter(async (cycleFinishedAt) => {
  await (async () => {
    for (let tries = 0; tries < 4; tries += 1) {
      try {
        const current = await repos.researchState.read(RESEARCH_STATE_ID);
        const next = researchState(cycleFinishedAt);
        if (current === null) await repos.researchState.put(RESEARCH_STATE_ID, next, nowIso());
        else await repos.researchState.compareAndSet(RESEARCH_STATE_ID, current.revision, next, nowIso());
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
const readScoutEvidence = workerVaultResolver(repos, new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)), "freshness");
const readScoutCapture = researchVaultResolver(repos, new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)), "freshness");

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

/**
 * THE PRE-WARM. Once per cycle, before the first admitted Scout
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
    /* Warm the model the loop STARTS on, and only when its prefix can cache — else skip, by name, with no paid call. */
    /* The Attempts' own tool list: with `search` exactly when `scoutFor` hands the toolkit `scoutSearch`, so the entry warmed is the one read. */
    const plan = scoutPrewarmPlan({ toolkitSpecs: scoutToolSpecsFor(scoutSearch !== null), bound: RESEARCH_BOUNDS.perDispatch, minRungs: MIN_DISTINCT_RUNGS });
    if (plan.kind === "SKIP") return { status: "SKIPPED", at, model: plan.model, code: plan.code, detail: plan.detail, durationMs: Date.now() - started };
    const { model, request } = plan;
    /*
     * The pre-warm is made for the Scouts this cycle
     * admitted, so when one of them runs under a Send or area budget, the
     * pre-warm's own worst case is held on those budgets first — refused, it
     * is skipped by name with no paid call — and its cost is charged there.
     */
    const forJob = [...jobSpend.values()][0] ?? null;
    let prewarmHold: JobSpend | null = null;
    if (forJob !== null) {
      const worst = modelRequestWorstCaseUsd(request);
      if (worst === null) return { status: "SKIPPED", at, model, code: "ASSIGNMENT_BUDGET", detail: `no paid call: ${model} has no stated rate, so the pre-warm cannot be held against the budget of the work it serves`, durationMs: Date.now() - started };
      prewarmHold = new JobSpend(spendHolds, `prewarm:${NOW}`, forJob.obligationId, forJob.lines);
      const held = await prewarmHold.admit(worst, "the cycle's pre-warm");
      if (!held.admit) return { status: "SKIPPED", at, model, code: held.code, detail: `no paid call: ${held.why}`, durationMs: Date.now() - started };
    }
    const transport = guardedMessagesFor(prewarmHold?.obligationId ?? "scout-prewarm");
    /* A failed pre-warm leaves its hold standing: what it was billed is unknown. */
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
      {
        attemptId: `scout-prewarm:${NOW}`, workItemId: "scout-prewarm", routeTaskId: null, routeId: SCOUT_PREWARM_ROUTE_ID, source: "api.anthropic.com",
        /* Charged to the budgeted work it was held for, so the Send's and area's history carries it; otherwise as before. */
        jurisdiction: prewarmHold === null ? null : (jobSubject.get(prewarmHold.obligationId) ?? null),
        ...(prewarmHold === null ? {} : { obligationId: prewarmHold.obligationId, spendHoldJobId: prewarmHold.jobId }),
        project: "freshness", role: "SCOUT", model: response.model, requestedModel: model, servedModel: response.model,
        modelRequestBound: modelRequestBoundFor(model, Buffer.byteLength(JSON.stringify(request)), request.max_tokens) ?? undefined,
        cost, recordedAt: at,
      },
      at,
    );
    if (prewarmHold !== null) {
      const failed = await spendHolds.settle(prewarmHold.jobId, priced.usd, nowIso());
      if (failed !== null) runtimeConditions.push(`the pre-warm's budget hold could not be settled (${failed}); it counts in full for its window`);
    }
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
const heldScoutFor = (scheduled: ScheduledObligation) => solvedScoutResult([...priorScoutResults.values()].flat(),
  scheduled.obligation.subjectId,scheduled.obligation.recordClass,scheduled.obligation.routeId);
const scoutFor = (scheduled: ScheduledObligation): DeclaredExecutor => modelLaneEnabled || heldScoutFor(scheduled)!==null
  ? failureResponderExecutor({
      solved:heldScoutFor(scheduled),
      sourceFailure:debtAtCycleStart.get(scheduled.obligation.id),
      sourceRoute:registry.routeFor(scheduled.obligation.id),
      shutThreshold,
      toolkitFor: buildScoutToolkit,
      executorFactory: deps => scoutProcessExecutor({ root: ROOT, postgres: wantsPostgres,
        fileStoreRoot: CONTROL_PLANE_ROOT, slots: paidScoutSlots,
        search: (lifetimeHuntWork(scheduled.obligation.id) ? scoutSearchLifetime : scoutSearch) ?? undefined,
        onStarted: pid => console.log(`  Scout lease worker process: pid ${pid}; ${scheduled.obligation.id}`), deps }),
      /* Every request is checked against what the job holds on its Send and area budgets before the Fleet guard reserves it. */
      transport: budgetGuardedTransport({
        transport: guardedMessagesFor(scheduled.obligation.id),
        job: () => jobSpend.get(scheduled.obligation.id) ?? null,
        worstCaseOf: modelRequestWorstCaseUsd,
        priceOf: modelResponseUsd,
      }),
      refusedBeforeSending: (error) => error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal,
      /* A Sonnet attempt that shows a recorded reason escalates only after its worst case is held against the rolling ceiling —
         and (MW-021) against the Send and area budgets the job runs under, before its first frontier request. */
      reserveEscalation: async (request) => {
        const fleet = scoutEscalationReservation(fleetSafety)(request);
        if (!fleet.admit) return fleet;
        const job = jobSpend.get(request.obligationId);
        if (job === undefined) return fleet;
        const more = await job.extend(request.worstCaseUsd, `the escalation to ${request.to.model}`);
        if (more.admit) return fleet;
        fleet.release();
        return { admit: false, code: "CEILING", why: `${more.code}: ${more.why}` };
      },
      contextFor: (row) => ({
        route: registry.routeFor(row.obligation.id),
        providerId: registry.providerOf(row.obligation.id),
        reason: [decisionFor(row.obligation.id, row.obligation.routeId).why,
          ...(row.obligation.autonomousPlan ? [planRepairBrief(row.obligation.autonomousPlan)] : [])].join("\n"),
        /* A DETERMINISTIC decision reaching the Scout is refused before any request. */
        decision: decisionFor(row.obligation.id, row.obligation.routeId).kind,
        inherited: inheritedFor(row),
        ownerQuestions: [...(row.obligation.assignments ?? []).flatMap(a => a.questions ?? []), ...dispatchRecorded.filter(d => d.obligationId === row.obligation.id).flatMap(d => d.entry.questions ?? [])],
        tools: {
          vault: vault.put,
          vaultBytes: vault.putBytes,
          readHeldArtifact: async id => {
            const [evidence, { artifact }] = await Promise.all([readScoutEvidence(id), readScoutCapture(id)]);
            return { ...evidenceProjection(evidence), provenance: {
              artifactId: id, canonicalUrl: artifact.canonicalUrl, retrievalUrl: artifact.retrievalUrl,
              contentType: artifact.contentType, retrievedAt: artifact.retrievedAt, permission: artifact.permission,
              methodRouteId: artifact.methodRouteId, httpStatus: artifact.httpStatus,
            } };
          },
          spaceOut: spacer,
          openOne: fleetSafety.guardedOpenOne("public-web", scheduled.obligation.id),
          openBytes: fleetSafety.guardedOpenBytes("public-web", scheduled.obligation.id),
          browse: browseWithPlaywright,
        },
      }),
      onStart: async ({ attemptId, obligationId, startedAt }) => {
        running.push({ attemptId, obligationId, startedAt, assignmentKeys: assignmentMembers.keysOf.get(obligationId) ?? [] });
        await writeResearchState(null);
      },
      onResult: async (result: ScoutResult, artifacts: readonly WorkArtifact[]) => {
        let amended = result;
        if (candidateStoreUnreadable === null && ((result.refusal === null && result.candidates.length > 0) || result.sourceDeadEnds?.length)) {
          try {
            const report = await proposeScoutCandidates({ repos, result, artifacts, stamp: today() });
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
         * Reported pair + live write-back. The inherited count is what
         * the brief projected; a candidate whose routeId the manual already held
         * is a rebuilt-existing defect. Grounded discoveries are written straight
         * back into the field manual so the NEXT Scout of any role inherits them
         * this cycle — no human method:learn step in between.
         */
        const handedManual = inheritedManualStores.get(result.obligationId) ?? emptyFieldManual();
        const pair = compoundingPair(inheritedFieldManualCounts.get(result.obligationId) ?? 0, result, knownRouteIds(handedManual));
        const doors = inheritedFieldManualDoors.get(result.obligationId);
        amended = {
          ...amended,
          inheritedFieldManual: pair.inheritedCount,
          rebuiltExistingRoutes: pair.rebuiltExisting,
          /* Beside what was handed, which handed doors the walk went through, matched against the manual it was handed from. */
          ...(doors
            ? { inheritedFieldManualEntryIds: doors.entryIds, inheritedFieldManualLines: doors.lines, usedFieldManualEntryIds: usedFieldManualEntryIds(result, doors.entryIds, handedManual) }
            : {}),
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
        const fixed = await recordScoutMethods(repos, amended, handedManual, scoutDivisions.get(amended.obligationId) ?? []);
        if (fixed) amended = { ...amended, unverified: [...amended.unverified, fixed] };
        const heldJobId = jobSpend.get(amended.obligationId)?.jobId;
        if (heldJobId !== undefined) amended = { ...amended, spendHoldJobId: heldJobId };
        await repos.scoutResults.append(amended.obligationId, amended.attemptId, amended, nowIso());
        await recordFoundSources(repos.doors, [amended], nowIso());
        scoutResultsThisCycle.push(amended);
        priorScoutResults.set(amended.obligationId,[...(priorScoutResults.get(amended.obligationId)??[]),amended]);
        const outcome = amended.refusal !== null ? "REFUSED"
          : amended.outcome === "EVIDENCE_FOUND" ? "CAPTURED" : "NOTHING_FOUND";
        console.log(`  Scout done: ${amended.obligationId}; ${outcome}; code ${amended.refusal?.map(issue => issue.code).join(",") || amended.outcome}; usd ${amended.usd === null ? "unmeasured" : amended.usd.toFixed(6)}`);
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

// Registered investigations also need Scout after a known source fails or leaves
// verification unresolved; initial source discovery is not the only model work.
finishPhase("worker-context");

/*
 * **SETTLED OCCURRENCES ARE RECOVERED BEFORE THE LANES, NOT WHEN A LANE REACHES
 * THEM.** A recovery walks nothing and spends nothing, so it
 * waits on no ceiling, budget or Scout admission. The scan starts from the
 * settled RouteTask ids the listing above already read, and reads the
 * occurrences once, about 5 s over the 4,751 production rows. A failed scan is
 * named, and the lanes still recover any settled row they reach, so a failure
 * costs latency and never correctness.
 */
let settledOccurrences: readonly SettledOccurrence[] = [];
/*
 * The same pass finds ABANDONED occurrences: open, unreferenced,
 * with the obligation moved past them and a RouteTask never claimed. Only a full
 * standing cycle closes them; the rest print them. Each close writes only the
 * occurrence, unresolved, and is named in the digest and the run record.
 */
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

/*
 * What the free walk last recorded for each dispatched government, in one
 * batched read. It is taken only when the paid lane can admit anyone: while the
 * lane is closed, admission never reaches the hold, and nothing is read.
 */
if (modelLaneEnabled && freeWalkSubjects.length > 0) {
  freeWalks = await pending.step("free-walks:read", () => readFreeDiscoveryWalks(repos, freeWalkSubjects));
}

// Retained results publish alongside acquisition rather than holding ready leases.
// Join this pass before the later projection of new worker output.
async function projectRetainedFacts(phase: string): Promise<void> {
  const readEvidence = workerVaultResolver(repos, new DurableEvidenceStore(join(ROOT, ...VAULT_DIR)), "freshness", { snapshot: true });
  try {
    const selected = filteredCycle ? await selectedCycleRepositories(repos, sync.all.map(row => row.id)) : repos;
    const report = await pending.step(phase, () => projectFleetPipeline(selected, {
        readArtifactText: async id => (await readEvidence(id)).text,
        now: nowIso(), root: ROOT,
        freshness: createPermanentMeetingFreshness({ connection: process.env.WTP_PRODUCTION_DATABASE_URL_READONLY,
          onUnavailable: detail => runtimeConditions.push(detail) }),
      }));
    if (report !== null) for (const line of factChainLines(report)) console.log(line);
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
  admitDispatch: (row) => fleetSafety.admitDispatch(row.obligation.id),
  /* The owner's dispatch goes first in the dispatcher's own due order too. */
  placeFirst: dispatchPriority,
  /* With no DISPATCH pending (the set above is empty), the selected expansion scopes' due work goes first instead. */
  ...(scopePlaceFirst !== null ? { placeFirst: scopePlaceFirst } : {}),
  research: {
    decide: (row) => decisionFor(row.obligation.id, row.obligation.routeId),
    plainBesideDetective: (row) => plainDecisionBeforeDetective.get(row.obligation.id) ?? null,
    /* The same canonical band comparator used for the visible/opening queue reaches the actual Scout pool. */
    compareModelRows: compareScoutRows,
    admitScout: (row) => {
      if (scoutFor(row).lane === "DETERMINISTIC") return { admit: true };
      if (!modelLaneEnabled) return { admit: false, code: laneDisabledCode ?? "LANE_DISABLED", why: laneDisabledReason ?? "lane closed" };
      if (paidWorkerCapacity() === 0) return { admit: false, code: "CEILING", why: "paid model capacity is closed; held and plain-code work continue" };
      /* A materialized meetings-discovery row goes to a paid Scout only after the free walk read the site and found nothing. */
      const freeWalkFirst = paidDiscoveryHold(row.obligation.id, freeWalks);
      if (freeWalkFirst !== null) return { admit: false, code: freeWalkFirst.code, why: freeWalkFirst.why };
      if (ledgerUnreadable !== null) return { admit: false, code: "CEILING", why: `the cost ledger could not be read, so the ceiling cannot be enforced (${ledgerUnreadable})` };
      const window = spendWindow.windowUsd === null ? null : spendWindow.windowUsd + spentThisCycle;
      // The scout daily ceiling is the value IN FORCE (the owner's override, or
      // the fallback), not the RESEARCH_BOUNDS default — so raising the dial above
      // the old default does not leave this gate silently binding at 100 while the
      // console shows a higher number.
      if (!lifetimeHuntWork(row.obligation.id)) {
        const cap = ceilingPermits(window, effectiveCeilingUsd);
        if (!cap.permits) return { admit: false, code: "CEILING", why: cap.why };
      }
      /* The binding ceiling is FleetSafety's rolling-24h one: read here, it pauses
         the whole lane when reached instead of admitting scouts the per-request
         guard then refuses. Same `effectiveCeilingUsd`, through the controller's bounds. */
      const rolling = fleetSafety.rollingCeilingReached(SCOUT_WORST_CASE_USD, row.obligation.id);
      if (rolling.reached) {
        return {
          admit: false,
          code: "CEILING",
          why: `rolling 24h model spend ${rolling.spentUsd === null ? "unmeasured" : `$${rolling.spentUsd.toFixed(2)}`} of $${rolling.capUsd.toFixed(2)} reached — the scout lane is paused this cycle rather than busy-loop the ceiling`,
        };
      }
      if (!lifetimeHuntWork(row.obligation.id) && Number.isFinite(SCOUT_MAX) && scoutsAdmittedOutsideLifetime >= SCOUT_MAX) return { admit: false, code: "CYCLE_MAX", why: `the diagnostic --scout-max cap of ${SCOUT_MAX} for this cycle is reached` };
      /* Each Send's own budget, checked (nothing held yet) before the
         geography's, so a Send's work is refused under the Send's own name. */
      const sent = assignmentBudget.check(row.obligation.id);
      if (!sent.admit) return { admit: false, code: sent.code, why: sent.why };
      /* The owner's expansion-scope budgets: last, so a scope reservation is
         only ever taken for a Scout every Fleet gate above already admitted. */
      if (expansionBudget !== null) {
        const scoped = expansionBudget.gate.admit(row.obligation.id, row.obligation.subjectId);
        if (!scoped.admit) return { admit: false, code: scoped.code, why: scoped.why };
      }
      /* The in-memory gates are checked synchronously, so this re-check agrees with the one above; it takes the Send's in-cycle hold. */
      assignmentBudget.admit(row.obligation.id);
      scoutsAdmittedThisCycle += 1;
      if (!lifetimeHuntWork(row.obligation.id)) scoutsAdmittedOutsideLifetime += 1;
      /*
       * THE HARD CAP. The job's worst case is held on the shared
       * budget ledger, atomically against every other Scout and every
       * overlapping cycle, before it starts; refused, the in-cycle holds above
       * are returned and the Scout waits, by name.
       */
      const undo = (): void => {
        scoutsAdmittedThisCycle -= 1;
        if (!lifetimeHuntWork(row.obligation.id)) scoutsAdmittedOutsideLifetime -= 1;
        expansionBudget?.gate.settle(row.obligation.id, 0);
        assignmentBudget.settle(row.obligation.id, 0);
      };
      const lines = budgetLinesFor(row.obligation.id, row.obligation.subjectId);
      if ("code" in lines) {
        undo();
        return { admit: false, code: lines.code, why: lines.why };
      }
      if (!hasBudgetLines(lines.lines)) return { admit: true };
      if (SCOUT_JOB_WORST_CASE_USD === null) {
        undo();
        return { admit: false, code: "ASSIGNMENT_BUDGET", why: "the Scout's start model has no stated rate, so its worst case cannot be held against the budget; the work waits" };
      }
      scoutJobSeq += 1;
      const job = new JobSpend(spendHolds, `scout:${NOW}:${scoutJobSeq}:${row.obligation.id}`, row.obligation.id, lines.lines);
      return job.admit(SCOUT_JOB_WORST_CASE_USD, `one Scout job's worst case on ${row.obligation.id}`).then((held) => {
        if (!held.admit) {
          undo();
          return { admit: false as const, code: held.code, why: held.why };
        }
        jobSpend.set(row.obligation.id, job);
        jobSubject.set(row.obligation.id, row.obligation.subjectId);
        return { admit: true as const };
      });
    },
    /* A Scout admitted and then not run returns everything its admission held. */
    onAdmittedNotDispatched: async (row) => {
      expansionBudget?.gate.settle(row.obligation.id, 0);
      assignmentBudget.settle(row.obligation.id, 0);
      const job = jobSpend.get(row.obligation.id);
      if (job === undefined) return;
      jobSpend.delete(row.obligation.id);
      const failed = await spendHolds.settle(job.jobId, 0, nowIso());
      if (failed !== null) runtimeConditions.push(`a budget hold for ${row.obligation.id} could not be released (${failed}); it counts in full for its window`);
    },
    modelExecutor: scoutFor,
    workerCapacity: workerCapacity,
    scoutLeaseTtlMs: 300_000,
    /* The pre-warm of the static prefix, once per cycle before the first admitted Scout. Never in a dry cycle. */
    ...(modelLaneEnabled && !dry ? { prewarm: prewarmScoutPrefix } : {}),
    onDispatched: async (result: DispatchResult, lane) => {
      placeOrderDirty = true;
      roundProgress.note("dispatch");
      startedThisCycle.add(result.obligationId);
      if (result.outcome === "WORKED") fleetSafety.recordSuccessfulActivity(nowIso());
      if (lane === "BOUNDED_MODEL_WORKER") {
        spentThisCycle += result.cost?.usd ?? 0;
        /* A Scout that reported no dollar figure leaves its scope's spend unmeasured, which holds that scope's paid work. */
        expansionBudget?.gate.settle(result.obligationId, result.cost?.usd ?? null);
        /* The same for every Send it held against. */
        assignmentBudget.settle(result.obligationId, result.cost?.usd ?? null);
        /* The durable holds: book what it measured and release the rest; unmeasured, the whole hold keeps counting. */
        const job = jobSpend.get(result.obligationId);
        if (job !== undefined) {
          jobSpend.delete(result.obligationId);
          const failed = await spendHolds.settle(job.jobId, result.cost?.usd ?? null, nowIso());
          if (failed !== null) runtimeConditions.push(`the budget hold for ${result.obligationId} could not be settled (${failed}); it counts in full for its window`);
        }
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
    paidTriesLeft: guards.paidWorkerCapacity(), fetch: pacedProbeFetch(), sizeFor: websiteSize })).catch((error: unknown) => {
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
    spaceOut: spacer, browse: browseWithPlaywright,
    openBytes: fleetSafety.guardedOpenBytes("public-web", "registered autonomous Fleet acquisition"),
    openBytesFor: subject => fleetSafety.guardedOpenBytes("public-web", subject),
    ...(fleetTransport !== null && paidWorkerCapacity() > 0 ? { transport: fleetTransport,
      transportFor: autonomousTransportFor(fleetTransport), reserveScoutEscalation: scoutEscalationReservation(fleetSafety) } : {}),
    auditCeilingUsd: effectiveCeilingUsd,
    lifetimeHuntSubject: subject => lifetimeHuntSubjects.has(subject), missionBlanksFor });
  /* The coordinator's known doors use Admin's shut threshold from this round, as the round's own doors do. */
  return { ...runtime, shutThreshold };
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
      searchEnabled: scoutSearch !== null, get ceilingUsd() { return effectiveCeilingUsd; }, fundedSubjects: [...lifetimeHuntSubjects] },
    capacity: () => Math.min(taskIds.length, plainTaskIds.size + paidWorkerCapacity(taskIds.length)),
    transportFor: guards.workerTransportFor,
    ...(scoutSearch ? { searchFor: subject => lifetimeHuntSubjects.has(subject) ? scoutSearchLifetime ?? scoutSearch : scoutSearch } : {}),
    reserveEscalation: scoutEscalationReservation(fleetSafety),
    missionBlanksFor,
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
let meetingsDiscovery = null as MeetingsDiscoveryPass | null;
let meetingsDiscoveryState = "not run: the meetings discovery pass has not started";
let campaignSites = null as CampaignSiteCycleReport | null;
let campaignSitesState = "not run: the campaign-site pass has not started";
let candidatePublications = null as CandidatePublicationCycleReport | null;
let candidatePublicationsState = "not run: no original-scope candidacy admission";
const MEETINGS_DISCOVERY_ENABLED = process.env.WTP_MEETINGS_DISCOVERY !== "off";
let meetingsDiscoveryByOutcome: Record<string, number> = {};
let roundVaultIndex: VaultIndex | undefined;
let roundVaultRead: Promise<VaultIndex> | undefined;
let discoveryLaneRun: Promise<readonly IndependentRuntimeOutcome[]> | null = null;
let discoveryLaneIds: readonly string[] = [];
const discoveryLanesFinished = new Set<string>();
/* One full listing per round; later captures join it through includeVaultCapture. The step is timed once in the round's phases. */
const readRoundVault = (signal?: AbortSignal) => roundVaultRead ??= (async () => {
  const startedMs = Date.now();
  const index = await indexVault(join(ROOT, ...VAULT_DIR), undefined, { signal });
  roundVaultIndex = index;
  const phase = cycleObservation.note("vault-index", Date.now() - startedMs);
  console.log(`  phase ${phase.name}: ${phase.durationMs}ms`);
  return index;
})();
try {

/*
 * **THE UNPAID MEETINGS-DISCOVERY EXECUTOR.**
 *
 * Walks the dispatched and mission-map meetings-discovery needs: robots first on every host,
 * no model, a find confirmed by content and recorded as a candidate
 * (`lib/control-plane/discovery/meetings-discovery-executor.ts`). OFF unless
 * WTP_MEETINGS_DISCOVERY is "on": it is a new production writer and new
 * outbound traffic, so it is inert until the owner's go.
 *
 * It spends at most MEETINGS_DISCOVERY_BUDGET_MS, walks at most
 * MEETINGS_DISCOVERY_MAX_WALKS needs, and runs only in a full standing cycle.
 * The phase budget includes its setup and bounds the walk in
 * progress too: each request's timeout is cut to the time left, so a slow site
 * cannot keep sending requests beyond that allowance, and a walk the time
 * runs out on before it confirmed anything is deferred, never recorded. It opens on its own FleetSafety
 * provider key, `discovery-web`, so a latch it trips never stops the routine
 * lanes, and shares the cycle's host spacing and vault.
 */
/* On unless the kill switch says off. */
const MEETINGS_DISCOVERY_MAX_WALKS = 12;
const MEETINGS_DISCOVERY_BUDGET_MS = 60_000;
/* The meetings lane's own no-progress limit: this many walks in a row that fail or run out of time and the lane stops; the rest stay due. */
const DISCOVERY_NO_PROGRESS_LIMIT = 5;
/*
 * The search rung's caps (Brave and Exa combined, pointers only) are
 * SEARCH_PER_CYCLE / SEARCH_PER_DAY, set with the one paid-search budget at
 * cycle start and shared with the Scout `search` tool. The defaults are the
 * conservative dial agreed with the data-plane owner; an env value may lower or
 * raise them within 0..1000.
 */
const runMeetingsDiscoveryPass = async (discoveryDeadlineMs: number, maxWalks: number): Promise<void> => {
  /* The owner's dispatch first, then every Send's mission map's calendar blanks, as read this wave. */
  const discoveryToWalk = discoveryNeedsToWalk([...missionDiscoveryNeeds.values()], [...dispatchedNeeds.values()], need => {
    const id = meetingsDiscoveryObligationId(need);
    return (ONLY === null || id.startsWith(ONLY)) && (IDS === null || IDS.has(id));
  });
  if (!MEETINGS_DISCOVERY_ENABLED) {
    meetingsDiscoveryState = "OFF: WTP_MEETINGS_DISCOVERY=off, the kill switch";
  } else if (dry || canary) {
    meetingsDiscoveryState = "not run: a dry or canary cycle walks nothing";
  } else if (discoveryToWalk.length === 0) {
    meetingsDiscoveryState = `not run: no government is owed meetings discovery (${missionMapUnread ?? "no mission place has a calendar blank and no dispatch is open"})`;
  } else {
    /* The caller sets the deadline: 60 s on the serial path, the time left in the round on its own lane. */
    const openDiscovery = fleetSafety.guardedOpenBytes("discovery-web", "meetings-discovery", fetch, { followRedirects: false });
    /* Named to the stall diagnostic while it runs: its waits on government sites are not store calls, so nothing else would name them. */
    const leaveDiscovery = pending.enter("meetings-discovery");
    try {
      /* The saved methods live in the field manual; the runner consults them on every walk. */
      const manual = await readFieldManual(repos, { kinds: [RECIPE_KIND], everywhere: true });
      if (manual.error) throw new Error(manual.error);
      /*
       * Search: pointers only, and PAID, so it exists only while the owner's switch in Admin allows it
       * (`AdminConfig.discoverySearch`, read at cycle start). Otherwise no search step is built at all: no request,
       * no refusal, no budget-ledger write. When it is on, the env caps bind it per cycle and per day, on FleetSafety's
       * own key, and every request sent is charged. `searchBudget` is the one budget the Scout tool also draws on.
       */
      const discoverySearch = searchBudget === null ? null : makeDiscoverySearch({
        braveKey: process.env.BRAVE_SEARCH_API_KEY,
        exaKey: process.env.EXA_API_KEY,
        budget: searchBudget,
      });
      const directoryItems = (await repos.workItems.list()).map(row => row.value).filter(item => item.publicationOutcome?.bodyIds?.length);
      const directoryRegistry = directoryItems.length ? await readRegistryRuntimeProjection({ bypassCache: true }) : null;
      if (directoryRegistry && directoryRegistry.kind !== "PROMOTED") throw new Error("Published body directory cannot be read for meeting discovery; its source work remains owed.");
      const meetingHints = directoryRegistry?.kind === "PROMOTED" ? directoryMeetingHints(directoryItems, directoryRegistry.value, ROUTE_HINTS) : ROUTE_HINTS;
      let costSeq = 0;
      const readOfficialText = async (held: HeldVaultArtifact) => {
        const signal = AbortSignal.timeout(Math.max(1, Math.min(VAULT_READ_TIMEOUT_MS, discoveryDeadlineMs - Date.now())));
        try { return new TextDecoder().decode(await readHeldBytes(held, signal)); }
        catch (error) {
          if (Date.now() < discoveryDeadlineMs) runtimeConditions.push(`Official-source linking evidence unreadable: ${held.id}`);
          throw error;
        }
      };
      let officialPagesRead: Promise<{canonicalUrl:string;readText:()=>Promise<string>}[]> | undefined;
      const readOfficialPages = () => officialPagesRead ??= (async () => {
        const index = await readRoundVault(AbortSignal.timeout(Math.max(1, discoveryDeadlineMs - Date.now())));
        const pages: {canonicalUrl:string;readText:()=>Promise<string>}[] = [];
        for (const held of index.byId.values()) {
          if (!held.canonicalUrl || held.tier === "RESTRICTED_RAW" || held.retentionPolicy === "DIAGNOSTIC" ||
            held.httpStatus === null || held.httpStatus < 200 || held.httpStatus >= 300 || !/html/i.test(held.contentType)) continue;
          pages.push({ canonicalUrl: held.canonicalUrl, readText: () => readOfficialText(held) });
        }
        return pages;
      })();
      meetingsDiscovery = await runMeetingsDiscovery(repos, {
        needs: discoveryToWalk,
        cycleIndex: Math.floor(Date.parse(NOW) / 3_600_000),
        maxWalks, rotationStep: MEETINGS_DISCOVERY_MAX_WALKS, noProgressLimit: DISCOVERY_NO_PROGRESS_LIMIT,
        /* An owner-dispatched meetings-discovery obligation goes first; one with an open occurrence is another executor's. */
        firstIds: new Set(sync.all.filter((o) => o.id.startsWith("freshness:meetings-discovery:")).map((o) => o.subjectId)),
        onWalk: () => roundProgress.note("meetings walks"),
        skipIds: new Set(
          sync.all.filter((o) => o.id.startsWith("freshness:meetings-discovery:") && o.openOccurrenceId !== null).map((o) => o.subjectId),
        ),
        runtime: {
          websiteSize,
          open: async ({ url, headers, timeoutMs }) => {
            const got = await openDiscovery({ url, headers, timeoutMs });
            return {
              status: got.status,
              body: new TextDecoder().decode(got.bytes),
              bytes: got.bytes.byteLength,
              contentType: got.contentType,
              location: got.location ?? null,
              transportError: got.transportError,
            };
          },
          spaceOut: spacer,
          vault: async (artifact, bytes) => {
            const stored=await vault.put(artifact,bytes);
            if(stored.stored && roundVaultIndex) includeVaultCapture(roundVaultIndex,artifact,stored.where,join(ROOT,...VAULT_DIR));
            return stored;
          },
          readOfficialPages,
          readOfficialPageTextFor: async artifact => {
            const held = (await readRoundVault()).byHash.get(artifact.contentHash.slice("sha256-".length));
            if (!held) throw new Error(`Official-source linking capture is not held: ${artifact.id}`);
            return readOfficialText(held);
          },
          now: nowIso,
          budget: {
            spent: () => Date.now() >= discoveryDeadlineMs,
            remainingMs: () => Math.max(0, discoveryDeadlineMs - Date.now()),
          },
          recipes: knownRecipes(manual.store.entries),
          /* Committed route hints: the current official site where the recorded address is stale, and routes found on a government's own publications. */
          routeHints: meetingHints,
          ...(discoverySearch === null ? {} : { search: discoverySearch }),
          searchScopeFor: (subjectId) => huntSearchScope({ selected: config?.expansionScopes ?? [], plan: expansionPlan, subjectId }),
          recordCost: async (entry) => {
            costSeq += 1;
            await repos.costs.append(entry.workItemId, `ce-ds-${fingerprint([entry.attemptId, entry.source, entry.recordedAt, costSeq])}`,
              costEntryWithModel(entry, null), nowIso());
          },
        },
      });
      meetingsDiscoveryState = "ran";
    } catch (error) {
      meetingsDiscoveryState = `could not run: ${error instanceof Error ? error.message : String(error)}`;
      runtimeConditions.push(`meetings discovery ${meetingsDiscoveryState}`);
    } finally {
      leaveDiscovery();
    }
  }
  meetingsDiscoveryByOutcome = (meetingsDiscovery?.walked ?? []).reduce<Record<string, number>>(
    (m, a) => ((m[a.outcome] = (m[a.outcome] ?? 0) + 1), m),
    {},
  );
  console.log(
    `  meetings discovery: ${meetingsDiscoveryState}` +
      (meetingsDiscovery === null
        ? ""
        : ` · ${meetingsDiscovery.walked.length} walked ${JSON.stringify(meetingsDiscoveryByOutcome)} · ` +
          `${meetingsDiscovery.notDue.length} not yet due · ${meetingsDiscovery.deferred.length} deferred (budget)` +
          (meetingsDiscovery.cutShort.length > 0 ? `, ${meetingsDiscovery.cutShort.length} of them cut short before any find` : "") +
          (meetingsDiscovery.walkFailures.length > 0 ? ` · ${meetingsDiscovery.walkFailures.length} walk(s) failed on our side: ${meetingsDiscovery.walkFailures.map((f) => f.jurisdictionId).join(", ")}` : "")),
  );
};

/*
 * **THE CAMPAIGN-SITE PASS: HELD RESEARCH REACHES THE PUBLICATION DOOR, FREE.**
 * (2026-09-25; the design note and the bounds are in
 * lib/control-plane/promotion/campaign-site-cycle.ts.)
 *
 * The held Scout findings and Marginalia answers go through the complete
 * campaign-site chain: observed profile links lead to robots-first primary
 * reads through this cycle's guarded seam and host spacer. Identity matching
 * uses independently captured sources already held; no extra audit request or
 * clock wait. It calls no model and no paid search, so it runs while the paid
 * lane is closed. Its offers are pipeline records (Admin's delivery trail);
 * its approvals publish through the derived routine contract
 * `candidate-campaign-sites-derived`, with no owner step.
 */
/*
 * The lane's own bound. No lead read starts after the dispatch cutoff and a read in flight answers within one
 * request timeout, so past the cutoff plus this settle time the lane is waiting on something that has not answered. It
 * then ends as a deferral naming the step it was waiting on, and its leads and sites stay owed. The settle time ends well
 * inside the round's post-cutoff quiet limit, so the round's join never waits on this lane.
 */
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
        const holdings = candidateEnrichmentHoldings();
        if (holdings === null) throw new Error("the canonical ballot and profile pointers were not preloaded this cycle");
        const { subjects, linked } = campaignSiteSubjectsFromHoldings(holdings, nowIso());
        const vaultIndex = await step("the saved-page index", () => readRoundVault());
        /* An unreadable manifest holds only the Marginalia answers back a cycle; the held Scout findings still go through. */
        let stagingManifest: ReturnType<typeof readStagingManifest> = null;
        try {
          stagingManifest = readStagingManifest(ROOT);
        } catch (error) {
          runtimeConditions.push(`campaign sites: the staging manifest could not be read (${error instanceof Error ? error.message : String(error)}); held Marginalia answers wait for the next cycle`);
        }
        const held = await step("the held Marginalia answers", () => heldMarginaliaFromManifest(ROOT, stagingManifest, vaultIndex, nowIso()));
        const methodVersion = await step("the method version", roundMethodVersion);
        const openCampaignSite = fleetSafety.guardedOpenBytes("discovery-web", "campaign-site-chain", fetch, { followRedirects: false });
        const report = await step("the campaign-site chain", () => runCampaignSiteCycle({
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
          heldVault: vaultIndex,
          methodVersion,
          deadlineMs: dispatchDeadlineMs,
        }));
        return {
          report,
          state:
            `ran over ${subjects.size} canonical candidacies (${linked.size} already carrying a campaign link, read last) and ${held.responses.length} held Marginalia answer(s) of ${held.entries} staged` +
            (held.unreadable > 0 ? ` (${held.unreadable} answer(s) the vault could not produce)` : ""),
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
  console.log(campaignSites === null ? `  campaign sites     ${campaignSitesState}` : `${campaignSiteCycleLine(campaignSites)} · ${campaignSitesState}`);
};

/* Linked publication pages are a separate bounded deterministic pass. Its
 * candidates are exact members of the selected hunt receipts; a
 * broadly tracked candidate universe does not itself authorize a new walk. */
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

/*
 * Each pass is its own lane. The serial path (WTP_DISCOVERY_SERIAL=1) runs them in turn before the worker
 * wave, as before: 12 walks, 60 s. Otherwise they start at once beside the worker wave, each contained to its own
 * outcome, and the round joins them before it finalizes; a slow site holds up only its own lane, and the walk is
 * bounded by the time left in the round.
 */
const DISCOVERY_SERIAL = process.env.WTP_DISCOVERY_SERIAL === "1";
if (DISCOVERY_SERIAL) {
  await runMeetingsDiscoveryPass(Date.now() + MEETINGS_DISCOVERY_BUDGET_MS, MEETINGS_DISCOVERY_MAX_WALKS);
  finishPhase("meetings-discovery");
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
    timed("meetings-discovery", () => runMeetingsDiscoveryPass(dispatchDeadlineMs, Number.MAX_SAFE_INTEGER)),
    timed("campaign-sites", runCampaignSitesPass),
    timed("candidate-publications", runCandidatePublicationsPass),
  ]);
  discoveryLaneIds = ["meetings-discovery", "campaign-sites", "candidate-publications"];
}


/*
 * A scout that argued a record absent this cycle (a proper walk
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
      await pending.step("absences:record", () =>
        recordArguedAbsence(repos, { obligationId: r.obligationId, absentUntil: until, now: NOW, unlockWhen: absenceUnlockFrom(r, until) }));
      absencesRecorded += 1;
    } catch (error) {
      console.error(
        `  argued absence not recorded for ${r.obligationId} (${error instanceof Error ? error.message : String(error)}); it re-walks next cycle`,
      );
    }
  }
  if (absencesRecorded > 0) {
    console.log(`  argued absences recorded: ${absencesRecorded} (each rechecks in ${ABSENCE_EXPIRY_DAYS} days)`);
  }
}

// Registered autonomous plans use the same dispatcher, vault, host spacing and
// rolling model ceiling. Discovery shares this cycle's existing Scout allowance.
// Leave a minute after the last worker for staging and the Admin state/heartbeat.
// A prior cycle's late worker ended at the dispatch deadline, then its final
// research state and heartbeat could not start before the hard wall.
// Selection can read several complete repositories before it admits a worker.
// Its own store budget must end before finalization starts, while a worker
// admitted earlier still has time to finish and settle. This is a technical
// slice boundary, not a count or spend cap: undispatched work remains owed.
} finally {
  /*
   * The early worker wave's processes end at the cutoff, but its settling reads do not, and this wait was the one
   * unlabelled await between the lanes' start and their join: a stall answer named only the lane still running beside
   * it. It is labelled and ends like every other post-cutoff wait: a named deferral, its unsettled tasks still owed.
   */
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
  scoutsAdmittedThisCycle += earlyAutonomous.scoutsAdmitted;
  scoutsAdmittedOutsideLifetime += earlyAutonomous.scoutsLimitedAdmitted;
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
      scoutsAdmittedThisCycle += autonomous.scoutsAdmitted;
      scoutsAdmittedOutsideLifetime += autonomous.scoutsLimitedAdmitted;
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

/* ------------------------------------------------------- the promotion tail --- */

/*
 * The tail runs on EVERY cycle with no operator: acquire -> vault -> normalize ->
 * snapshot -> STAGED. Staged records publish through the
 * typed reader doors; this block itself writes only `.runtime/control-plane/staging/` diagnostics.
 */
const leavePromotionTail = pending.enter("promotion-tail");
const staged: StagedEntry[] = [];
for (const result of cycle.dispatched) {
  const unit = units.find((u) => u.obligation.id === result.obligationId);
  if (unit === undefined) continue;
  let body: string | null = null;
  let detail = result.detail;
  for (const artifactId of result.artifactIds) {
    const entry = vault.ledger.get(artifactId);
    if (entry === undefined) continue;
    const read = await boundedAfterCutoff(vault.readBack(entry.key));
    if (!read.done) {
      const line = `promotion tail: ${result.obligationId}'s vaulted bytes did not read back within ${Math.round(read.quietMs / 60_000)} min of the round's last output; it is staged as still owed`;
      runtimeConditions.push(line);
      console.log(`  ${line}`);
      detail = `${detail}; its vaulted bytes did not read back this round, so it is staged as still owed`;
      break;
    }
    body = read.value;
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
      detail,
      stagedOn: today(),
    }),
  );
}
/*
 * A RECOVERED DISPOSITION STILL MOVES THROUGH THE TAIL. The cycle
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
    const readHeldBody = async (): Promise<string | null> => {
      const held = disposition.artifactIds.length === 0 ? [] : await repos.artifacts.read(recovered.workItemId);
      for (const artifactId of disposition.artifactIds) {
        const record = held.find((a) => a.artifactId === artifactId);
        if (record === undefined) continue;
        const bytes = await vault.readHeld(record);
        if (bytes !== null) return bytes;
      }
      return null;
    };
    const read = await boundedAfterCutoff(readHeldBody());
    if (read.done) body = read.value;
    else {
      const line = `recovered ${recovered.obligationId}: its held bytes did not read back within ${Math.round(read.quietMs / 60_000)} min of the round's last output; it is staged as still owed`;
      runtimeConditions.push(line);
      console.log(`  ${line}`);
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
leavePromotionTail();

/* ------------------------------------------------- research metrics --- */

/*
 * Computed ONCE, at cycle end, from re-reads of the durable logs so this
 * cycle's own Attempts are in the denominators. A failed re-read is a named
 * runtime condition and the metrics record is withheld, never zeroed.
 */
// These independent final reads share the existing repository transport limit.
// Join failures too: neither finalization view retries an unchanged failed read.
const finalizationReads = canary ? null : Promise.allSettled([
  repos.scoutResults.readAll(),
  repos.costs.readSince(new Date(Date.parse(nowIso()) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString()),
  repos.ownerDigests.readRecentWhere(DIGEST_LOG_KEY, ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE",
    Number.MAX_SAFE_INTEGER, { runtimeOutcome: ["kind", "startedAt", "research"] },
    new Date(Date.parse(nowIso()) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString()),
  readMethodCandidateStore(repos),
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
  const costsNow = costsRead.value;
  const at = nowIso();
  finalSpendWindow = researchSpendInWindow(costsNow, at, RESEARCH_BOUNDS.windowHours, historicalSpendHolds);
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
  /*
   * The cache rows, from the COST LEDGER — the same rows the
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
/*
 * The metrics and the research progression are the cycle's largest reads
 * and both are withheld by name when a read fails. From the late-work deadline they yield
 * (`lateWorkBudgetMs`, set with the clock): their store calls are refused by
 * name so the records below keep their whole budgets. A cycle on its usual ten
 * minutes never meets this deadline.
 */
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

/*
 * **FINALIZATION: EVERY STEP COMPLETES OR FAILS BY NAME INSIDE ITS OWN BUDGET.**
 * Each step is
 * labelled for the stall diagnostic and bounded: its store calls are cut at its
 * budget, and the steps before the canonical outcome leave it and the local
 * record their time before the wall. A step that fails is named — on stderr, in
 * the runtime conditions — and the cycle goes on to its records; only a failed
 * canonical append ends the cycle, through the crash handler, with a FAILED
 * outcome and a local crash record.
 */
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

/*
 * The three code identities, read once per cycle. A live
 * cycle refreshes origin/main with a bounded fetch; a dry or canary cycle reads
 * the refs as last seen so no test reaches the network. A read that throws
 * leaves the field null — the beat still says the cycle ran; it never says the
 * code identity is consistent. The whole read is bounded: a git
 * call it no longer has time for is not made, and reads as CANNOT_TELL.
 */
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
      /* The intake observer runs immediately after this child. Preserve its
         latest durable receipt while refreshing cycle/liveness fields; a cycle
         crash before the observer runs must not erase the last known reading. */
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
  `  scouts             ${laneCounts.modelDispatched} dispatched of ${dueModel.length} due model-class (${modelClassUnits.length} registered model-class of ${allUnits.length}) · ` +
    `deferred ${cycle.lanes?.model.deferred ?? 0}${deferredByLine ? ` (${deferredByLine})` : ""}` +
    (dueModel.length - openedModel > 0 ? ` · ${dueModel.length - openedModel} not opened` : ""),
  `  spend              rolling ${RESEARCH_BOUNDS.windowHours}h: ${spendWindow.windowUsd === null ? "UNMEASURED" : `$${(spendWindow.windowUsd + spentThisCycle).toFixed(4)}`} of $${effectiveCeilingUsd} ceiling (${rollingCeiling.source.toLowerCase()}) ` +
    `(measured ${spendWindow.measured}, unmeasured ${spendWindow.unmeasured} before this cycle) · this cycle $${spentThisCycle.toFixed(4)}`,
  `  results            ${scoutResultsThisCycle.length} typed result(s)${outcomeCounts.size > 0 ? ` — ${[...outcomeCounts].map(([k, v]) => `${k} ${v}`).join(", ")}` : ""}` +
    ` · ${scoutDispatches.filter((d) => d.dispositionCommitted).length} disposition(s) committed`,
  `  candidates         ${candidateReports.reduce((n, r) => n + r.proposed.length, 0)} method candidate(s) proposed and validated (never admitted here)`,
  `  disagreements      ${decisionDisagreements.length} executor-decision disagreement(s) recorded in the run record, never reconciled`,
  `  intents            ${honoredIntents.length} RUN_CYCLE_NOW honored · ${honoredDispatch.length} of ${intents.pendingDispatch.length} pending DISPATCH honored · ` +
    `${honoredLaneIntents.length} lane PAUSE/RESUME acknowledged · paused: ${intentLogUnreadable !== null ? "UNKNOWN (log unreadable; paid lane held closed)" : intents.paused ? "yes" : "no"}`,
  ...ownerDispatches.map(
    (d) => `  owner dispatch     ${d.intentId}: "${d.target}" -> ${d.matched} of ${d.registered} registered unit(s) placed first in both lanes`,
  ),
  `  runtime            ${runtimeConditions.length === 0 ? "no condition prevents eligible Scout work" : runtimeConditions.join("; ")}`,
  `  supervision        ${hostSupervision.measurable ? `relaunch trigger ${hostSupervision.relaunchTrigger.present === null ? "UNKNOWN" : hostSupervision.relaunchTrigger.present ? "present" : "ABSENT"}` : hostSupervision.notMeasurableReason} · ` +
    `proof ${hostSupervision.proof === null ? `ABSENT at ${hostSupervision.proofPath}` : `${hostSupervision.proof.verdict} ${hostSupervision.proof.measuredAt} (${hostSupervision.proof.secondsToRelaunch ?? "?"}s)`}`,
  /* Every Attempt this cycle, by step — the cache reads per turn are the proof the prefix held. */
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
  `  discovery          meetings: ${meetingsDiscoveryState}` +
    (meetingsDiscovery === null
      ? ` · ${missionDiscoveryNeeds.size} mission government(s) owed discovery, ${missionDiscoveryHeld} with a held calendar route, ${dispatchedNeeds.size} dispatched`
      : ` · ${meetingsDiscovery.walked.length} walked (${meetingsDiscoveryByOutcome.FOUND ?? 0} found, ${meetingsDiscoveryByOutcome.LEAD ?? 0} lead, ` +
        `${meetingsDiscoveryByOutcome.NOTHING_DETECTED ?? 0} nothing detected, ${meetingsDiscoveryByOutcome.BLOCKED ?? 0} blocked, ` +
        `${meetingsDiscoveryByOutcome.COULD_NOT_READ ?? 0} could not read) · ${meetingsDiscovery.notDue.length} not yet due · ` +
        `${meetingsDiscovery.deferred.length} deferred (budget)` +
        (meetingsDiscovery.cutShort.length > 0 ? `, ${meetingsDiscovery.cutShort.length} of them cut short before any find` : "") +
        ` · ${meetingsDiscovery.recipeApplications} saved-method application(s)` +
        (meetingsDiscovery.appendFailures.length > 0 ? ` · ${meetingsDiscovery.appendFailures.length} walk(s) not recorded` : "") +
        (meetingsDiscovery.walkFailures.length > 0 ? ` · ${meetingsDiscovery.walkFailures.length} walk(s) failed on our side` : "")),
  campaignSites === null ? `  campaign sites     ${campaignSitesState}` : `${campaignSiteCycleLine(campaignSites)} · ${campaignSitesState}`,
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
      /*
       * What the paid lane read of the free walk for the dispatched discovery rows: whether it was
       * read (only while the lane can admit), each government's reading, and any registry that could not be read.
       */
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
      /* The unpaid meetings-discovery phase: whether it ran, and every walk it made. */
      meetingsDiscovery: {
        enabled: MEETINGS_DISCOVERY_ENABLED,
        state: meetingsDiscoveryState,
        /* The governments in mission places owed discovery, and those whose body holds a calendar route. */
        mission: { owed: [...missionDiscoveryNeeds.keys()], heldCalendarRoute: missionDiscoveryHeld },
        walked: (meetingsDiscovery?.walked ?? []).map((a) => ({
          jurisdictionId: a.jurisdictionId,
          attemptId: a.attemptId,
          outcome: a.outcome,
          found: a.found.map((f) => ({ vendor: f.vendor, url: f.url, count: f.count })),
          leads: a.leads.length,
          requestCount: a.requestCount,
          recheckAfter: a.recheckAfter,
        })),
        notDue: meetingsDiscovery?.notDue ?? [],
        deferred: meetingsDiscovery?.deferred ?? [],
        cutShort: meetingsDiscovery?.cutShort ?? [],
        recipesApplied: meetingsDiscovery?.recipeApplications ?? 0,
        recipesUpdated: meetingsDiscovery?.recipesUpdated ?? [],
        search: {
          /* The owner's switch in Admin: paid search runs only while it is ON, and then only inside the caps below. */
          ownerSwitch: discoverySearchDecision,
          perCycleCap: SEARCH_PER_CYCLE,
          perDayCap: SEARCH_PER_DAY,
          /* Every request sent, including those of walks the time cut short: all of them were charged. */
          requests: [
            ...(meetingsDiscovery?.walked ?? []).flatMap((a) => a.search.flatMap((q) => q.requests)),
            ...(meetingsDiscovery?.cutShort ?? []).flatMap((c) => c.search.flatMap((q) => q.requests)),
          ],
        },
        appendFailures: meetingsDiscovery?.appendFailures ?? [],
        /* Walks that failed on something of ours, named; the pass went on without them and each need stays due. */
        walkFailures: meetingsDiscovery?.walkFailures ?? [],
        fieldManual: meetingsDiscovery?.fieldManual ?? null,
      },
      /* The free campaign-site pass: whether it ran, each lead it read, and every verdict by code. */
      campaignSites: {
        state: campaignSitesState,
        report: campaignSites === null
          ? null
          : {
              readsUsed: campaignSites.chain.readsUsed,
              rereadsUsed: campaignSites.chain.rereadsUsed,
              judgedFromVault: campaignSites.chain.judgedFromVault,
              verdicts: campaignSites.verdicts,
              byCode: campaignSites.byCode,
              byStage: campaignSites.chain.byStage,
              offers: { accepted: campaignSites.chain.offers.filter((o) => o.accepted).length, refused: campaignSites.chain.offers.filter((o) => !o.accepted).length },
              approved: campaignSites.chain.approved.map((a) => ({ itemId: a.itemId, candidacyId: a.campaignSite.candidacyId, url: a.campaignSite.url })),
              unjoined: campaignSites.chain.unjoined.length,
              elapsedMs: campaignSites.elapsedMs,
              read: campaignSites.chain.leads.filter((l) => l.via === "READ").map((l) => ({ subjectId: l.subjectId, url: l.lead.url, outcome: l.outcome, codes: l.refusals.map((r) => r.code) })),
            },
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
      staged,
      stagingManifest: `${[".runtime", "control-plane", "staging"].join("/")}/manifest.json`,
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

/*
 * Canonical append happens first. A local file is disposable diagnostics only.
 * The append is bounded and retried while its budget lasts: the append-only
 * identity makes an uncertain retry a no-op success, never a second record. A
 * failure here is the cycle's crash — a FAILED outcome and a local crash record.
 */
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
