/**
 * **LEVEL 1 — RESEARCH: THE BOUNDS, THE DURABLE STATE, AND THE DERIVED VERDICT.**
 * (Level 1 activation, 2026-09-01. RULING 240, RULING 241.)
 *
 * Three things live here because a page and a runner must agree on them:
 *
 * ```
 *   BOUNDS     how many Scouts at once, how much per Attempt, how much per
 *              rolling day — stated once, recorded on every cycle's research
 *              state, never implied. There is no per-cycle dispatch cap: the
 *              cycle wall and the rolling daily ceiling are the only limits
 *              (RULING 241, the per-cycle guardrails retired once caching made
 *              an Attempt a twelfth of its pre-caching cost)
 *   STATE      the record the runner WRITES each cycle and the page READS.
 *              Every field is a measurement or a named condition; nothing on
 *              it is a verdict
 *   VERDICT    ACTIVE / DEGRADED / INACTIVE, DERIVED from the state, the
 *              heartbeat and the owner's intents at read time. A stored
 *              `active: true` is ignored by construction — a flag that stops
 *              being true without anything rewriting it is how a dead machine
 *              reports itself healthy
 * ```
 *
 * ## The cap controls how much work RUNS; it never changes whether a fact is true
 *
 * `lib/control-plane/cost.ts`'s invariant is inherited entire. When the rolling
 * ceiling is reached, remaining Scout work stays DURABLY OWED with its next-due
 * — deferred by name, never dropped, never reported as complete.
 */

import type { RunnerHeartbeat } from "../owner-surface.ts";
import { HEARTBEAT_LATE_MINUTES } from "../owner-surface.ts";
import type { CostEntry } from "../cost.ts";
import { MODEL_FOR_CLASS, SCOUT_STEPS } from "./model-routing.ts";
import { MODELS } from "../../models.ts";
import type { DispatchOrdering, ResearchMetrics } from "../research-metrics.ts";
import { aggregateModelSpend, type FleetSafetySnapshot } from "../fleet-safety.ts";
import type { SpendHold } from "../budget.ts";
import type { WorkerProcessSlots } from "../workers/worker-slots.ts";

/* ------------------------------------------------------------------ bounds */

/** The workers' dedicated credential. NAME only; no value is ever read into a record. */
export const WORKER_CREDENTIAL_VAR = "WTP_WORKERS_ANTHROPIC_API_KEY";

/** The ledger route id a pre-warm request's cost entry carries (2026-09-06), so the rolling ceiling sees the spend and capacity never counts it as an Attempt. */
export const SCOUT_PREWARM_ROUTE_ID = "scout:prewarm";

export interface ScoutBound {
  /** Public requests per host per Attempt. Politeness that does not multiply. */
  readonly maxRequestsPerHost: number;
  /** `max_tokens` on each model response. */
  readonly maxOutputTokensPerTurn: number;
}

export interface ResearchBounds {
  readonly workerCapacity: number;
  readonly perDispatch: ScoutBound;
  /**
   * The rolling daily model-spend ceiling — the ONE spend limit standing
   * between the fleet and running flat out (RULING 241). The per-cycle
   * dispatch, spend and request caps were retired once prompt caching made an
   * Attempt about a twelfth of its pre-caching cost; the cycle wall and this
   * daily ceiling are what remain.
   */
  readonly dailyCeilingUsd: number;
  readonly windowHours: number;
}

export const RESEARCH_BOUNDS: ResearchBounds = {
  workerCapacity: 0,
  perDispatch: {
    maxRequestsPerHost: 10,
    maxOutputTokensPerTurn: 8_192,
  },
  dailyCeilingUsd: 0,
  windowHours: 24,
};

/* ------------------------------------------------------------------ records */

export const RESEARCH_STATE_ID = "level-1";
export const RESEARCH_INTENT_LOG_KEY = "level-1";
export const RESEARCH_FORMAT_VERSION = 1;

/** A Scout the runner has started and not yet closed, as the runner recorded it. */
export interface RunningScout {
  readonly attemptId: string;
  readonly obligationId: string;
  readonly startedAt: string;
  /** Exact Send marks on the obligation when this Scout started. Older rows omit this. */
  readonly assignmentKeys?: readonly string[];
}

/**
 * **THE HOST'S SUPERVISION, AS THE CYCLE MEASURED IT.** (Work Item 3.2,
 * 2026-09-02. RULING 246.)
 *
 * The admin page reads only the control plane, and a Netlify function cannot
 * read this host's files — so the relaunch proof `scripts/pilot-task.ps1
 * -Action prove-relaunch` writes to ignored host-local
 * `.runtime/ops/runner-relaunch-proof.json` and never to tracked Git state.
 * The proof must TRAVEL: the cycle script reads it from the installed runtime and the
 * live trigger presence from the scheduled task, and records both here.
 * A historical Scout success never makes the system ACTIVE; a proven parent
 * relaunch is what `deriveLevel1` asks for.
 */
export interface RelaunchProof {
  readonly measuredAt: string;
  readonly killedPid: number | null;
  readonly relaunchedPid: number | null;
  readonly secondsToRelaunch: number | null;
  readonly relaunchTriggerPresent: boolean;
  readonly taskStateAfter: string | null;
  readonly lastTaskResult: string | null;
  readonly verdict: "RELAUNCHED" | "NOT_RELAUNCHED";
}

export interface HostSupervision {
  /** The host the reading was taken on. */
  readonly host: string;
  readonly checkedAt: string;
  /** Whether this host can be asked at all (the scheduled task exists only on win32). */
  readonly measurable: boolean;
  readonly notMeasurableReason: string | null;
  /** The live trigger reading. `present` is null when the task could not be asked. */
  readonly relaunchTrigger: { readonly present: boolean | null; readonly detail: string };
  /** The proof file's record, or null when the checkout holds none. */
  readonly proof: RelaunchProof | null;
  readonly proofPath: string;
}

/**
 * How old a RELAUNCHED proof may be and still count. Thirty days: the trigger
 * is a property of the registered task, which changes only when someone
 * re-registers it, and a monthly re-proof is cheap (one kill, one relaunch,
 * under five minutes). Older than that, the proof is a fact about a task
 * that may since have been replaced, and the lane reads DEGRADED until the
 * proof is re-run.
 */
export const SUPERVISION_PROOF_MAX_AGE_DAYS = 30;

/**
 * The record the runner writes at the START and END of every cycle, and on
 * every Scout start/finish. Read by the admin Research view.
 */
export interface ResearchState {
  readonly formatVersion: number;
  readonly beatAt: string;
  readonly cycleStartedAt: string;
  readonly cycleFinishedAt: string | null;
  readonly testedSha: string | null;
  readonly host: string;
  readonly modelLaneEnabled: boolean;
  /** Named when the lane is off: paused, unconfigured, disabled by flag. */
  readonly modelLaneDisabledReason: string | null;
  readonly pausedByOwner: boolean;
  readonly pauseIntentId: string | null;
  readonly workerCredential: {
    readonly name: string;
    /** Confirmed available to THIS process, by name. Never the value. */
    readonly configured: boolean;
    readonly provider: string;
    readonly context: string;
  };
  readonly model: string;
  readonly bounds: ResearchBounds;
  readonly spend: {
    /** Scout spend in the rolling window as of `asOf`. Null when unmeasured. */
    readonly windowUsd: number | null;
    readonly measuredAttempts: number;
    readonly unmeasuredAttempts: number;
    readonly asOf: string;
  };
  readonly queue: {
    readonly registeredUnits: number;
    readonly modelClassUnits: number;
    readonly modelClassDue: number;
    readonly modelClassDispatchedThisCycle: number;
    readonly modelClassDeferredForCeiling: number;
    readonly modelClassDeferredForCycleMax: number;
    readonly modelClassDeferredForBudget?: number;
    readonly modelClassNotOpenedThisCycle?: number;
    readonly autonomousDispatchedThisCycle?: number;
    readonly modelClassDeferredForLane: number;
    readonly deterministicDue: number;
    readonly deterministicDispatchedThisCycle: number;
    /**
     * MW-014 / MW-071: each lane's due, started, running and waiting rows, every
     * reason a due row was not started (summing to the rows skipped), and the
     * oldest waiting row's next-due. Absent on states written before it; read
     * as "not recorded", never as nothing skipped.
     */
    readonly lanes?: import("./lane-reading.ts").QueueLanes | null;
  };
  readonly running: readonly RunningScout[];
  /** Named runtime conditions preventing eligible Scout work from dispatching. Empty when none. */
  readonly runtimeConditions: readonly string[];
  readonly cyclePhases?: readonly import("./cycle-phases.ts").CyclePhase[];
  readonly methodCandidates: {
    readonly proposed: number;
    readonly validated: number;
    readonly admitted: number;
    readonly rejected: number;
  } | null;
  /** The host's supervision reading (RULING 246). Absent on states written before 2026-09-02: read as unproven. */
  readonly hostSupervision?: HostSupervision | null;
  /** The reader-impact dispatch order this cycle applied to the Scout lane, and its inputs. */
  readonly dispatchOrdering?: DispatchOrdering | null;
  /** Capacity, queue bands, funnel, share, cache hit rate, cost per outcome — computed at cycle end. */
  readonly metrics?: ResearchMetrics | null;
  /** ADM-8: what the cycle did with the owner's DISPATCH, when one was pending. */
  readonly ownerDispatch?: OwnerDispatchRecord | null;
  /** Aggregate safety across every paid/network Fleet role, not only Scouts. */
  readonly fleetSafety?: FleetSafetySnapshot | null;
  /** Last completed research-window projection, retained while a later cycle is running. */
  readonly researchProgression?: import("../research-progression.ts").ResearchWindowProgression | null;
  /**
   * The owner's selected expansion scopes as this cycle resolved and applied
   * them (membership, order, spend, coverage, budget holds). Absent on states
   * written before the expansion controls existed, and null when no scope is
   * selected: both read as "nothing measured", never as an empty scope.
   */
  readonly expansion?: import("../expansion/reading.ts").ExpansionCycleReading | null;
  /**
   * MW-028: what this cycle created for the owner's DISPATCH targets and
   * selected scopes — created, reordered and blocked, each with its
   * denominator, and the deferred remainder. A DISPATCH target with work still
   * owed is carried from here into the next cycle. Absent on states written
   * before MW-028, and null when nothing was sent: both read as "nothing
   * measured", never as zero.
   */
  readonly dispatchWork?: import("../expansion/dispatch-work.ts").DispatchWorkReading | null;
  /**
   * MW-001/MW-021: every owner Send as the obligations themselves record it —
   * what it created and reordered — and its budget as the runner holds it:
   * spent, held and left in the rolling window. Absent on states written
   * before Sends were kept on the row, and null when no Send stands: both read
   * as "nothing measured", never as zero.
   */
  readonly assignments?: import("../expansion/assignment-budget.ts").AssignmentCycleReading | null;
}

/**
 * The owner's intent vocabulary. (Extended for the 9.4.26 admin feedback,
 * ADM-5 and ADM-8.)
 *
 *   PAUSE / RESUME         the research (model) lane only; the runner keeps cycling
 *   RUN_CYCLE_NOW          end the inter-cycle sleep early
 *   DISPATCH               "deploy the fleet": the owner's words in `note`, e.g.
 *                          "deep dive on Illinois"; the cycle puts every registered
 *                          unit that matches the target first and records what
 *                          matched. Where the words name a state, the cycle also
 *                          creates what the registry defines there that no clock
 *                          carries (MW-028, `expansion/dispatch-work.ts`), bounded
 *                          and counted; a requirement no registry defines is never
 *                          invented
 *   PAUSE_RUNNER           the owner's own record that the WHOLE runner is stopped on
 *                          purpose (`note` = the reason). Written by the dashboard or
 *                          by `pnpm pilot:stop`, so a red SILENT can be told from a
 *                          deliberate pause without leaving the page
 *   RESUME_RUNNER          the pause is over
 *   CANCEL_DISPATCH        take back one DISPATCH: `note` is that DISPATCH's intent id. The
 *                          runner stops carrying the target and records that it did
 */
/**
 * What the newest cycle did with the owner's DISPATCH (ADM-8): the intent it
 * honored, the target as parsed, and how many registered units matched of
 * how many were registered. Absent on a state written before the field
 * existed; null when no dispatch was pending.
 */
export interface OwnerDispatchRecord {
  readonly intentId: string;
  readonly target: string;
  readonly states: readonly string[];
  readonly matched: number;
  readonly registered: number;
  /**
   * MW-028: what this DISPATCH created, reordered and could not reach. Absent
   * on records written before MW-028; null when the cycle planned nothing for
   * it. The full receipt is `dispatchWork.targets` under `work.key`.
   */
  readonly work?: import("../expansion/dispatch-work.ts").OwnerDispatchWork | null;
}

export const RESEARCH_INTENT_ACTIONS = [
  "PAUSE",
  "RESUME",
  "RUN_CYCLE_NOW",
  "DISPATCH",
  "PAUSE_RUNNER",
  "RESUME_RUNNER",
  "CANCEL_DISPATCH",
] as const;
export type ResearchIntentAction = (typeof RESEARCH_INTENT_ACTIONS)[number];

/** The longest owner note an intent carries (a dispatch target or a pause reason). */
export const INTENT_NOTE_MAX_CHARS = 280;

/**
 * An owner intent the control plane honors. Appended by the admin API under
 * the admin security boundary; honored by the runner, which appends its own
 * HONORED record beside it rather than editing anything.
 */
export type ResearchIntent =
  | {
      readonly formatVersion: number;
      readonly kind: "INTENT";
      readonly intentId: string;
      readonly action: ResearchIntentAction;
      readonly requestedAt: string;
      /** Provenance: who, through what. The admin session id — never a reader identity. */
      readonly actor: string;
      readonly adminSessionRef: string;
      /** The owner's words: a DISPATCH target or a PAUSE_RUNNER reason. Null otherwise. */
      readonly note: string | null;
      /**
       * MW-021: a DISPATCH's own rolling 24-hour budget for paid work on what it
       * reaches, in USD. Absent when the owner sent it without one (only the
       * Fleet ceiling bounds it) and on every other action.
       */
      readonly budgetUsd?: number;
    }
  | {
      readonly formatVersion: number;
      readonly kind: "HONORED";
      readonly intentId: string;
      /** The INTENT this honors. */
      readonly honors: string;
      readonly action: ResearchIntentAction;
      readonly honoredAt: string;
      readonly honoredBy: string;
      readonly detail: string;
    };

export type ResearchIntentRequest = Extract<ResearchIntent, { kind: "INTENT" }>;
export type ResearchIntentHonored = Extract<ResearchIntent, { kind: "HONORED" }>;

/**
 * The owner's standing statement about the whole runner (ADM-5). `paused` is
 * true while the latest PAUSE_RUNNER has no later RESUME_RUNNER. `honored` is
 * the runner's own acknowledgement of that intent, when it has written one —
 * a pause the runner never acknowledged is still the owner's pause, and the
 * page says both facts.
 */
export interface RunnerPauseReading {
  readonly paused: boolean;
  readonly intent: ResearchIntentRequest | null;
  readonly honored: ResearchIntentHonored | null;
}

/**
 * The latest PAUSE/RESUME decides the research lane; the latest
 * PAUSE_RUNNER/RESUME_RUNNER decides the runner; RUN_CYCLE_NOW and DISPATCH are
 * pending until a HONORED record names them.
 */
export function readIntents(log: readonly ResearchIntent[]): {
  readonly paused: boolean;
  readonly pauseIntentId: string | null;
  readonly pendingRunNow: readonly ResearchIntentRequest[];
  /** DISPATCH intents no cycle has honored yet and the owner has not cancelled, oldest first. */
  readonly pendingDispatch: readonly ResearchIntentRequest[];
  /** The DISPATCH intent ids the owner has taken back. */
  readonly cancelledDispatch: ReadonlySet<string>;
  /** CANCEL_DISPATCH intents no cycle has honored yet. */
  readonly pendingCancel: readonly ResearchIntentRequest[];
  readonly runnerPause: RunnerPauseReading;
} {
  const intents = log.filter((r): r is ResearchIntentRequest => r.kind === "INTENT");
  const honoredRecords = log.filter((r): r is ResearchIntentHonored => r.kind === "HONORED");
  const honored = new Set(honoredRecords.map((r) => r.honors));
  const byTime = (a: ResearchIntentRequest, b: ResearchIntentRequest) =>
    a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0;
  const cancels = intents.filter((i) => i.action === "CANCEL_DISPATCH" && typeof i.note === "string" && i.note !== "");
  const cancelled = new Set(cancels.map((i) => i.note as string));
  const pauses = intents.filter((i) => i.action === "PAUSE" || i.action === "RESUME").sort(byTime);
  const last = pauses.at(-1) ?? null;
  const runnerPauses = intents
    .filter((i) => i.action === "PAUSE_RUNNER" || i.action === "RESUME_RUNNER")
    .sort(byTime);
  const lastRunner = runnerPauses.at(-1) ?? null;
  const runnerPaused = lastRunner?.action === "PAUSE_RUNNER";
  return {
    paused: last?.action === "PAUSE",
    pauseIntentId: last?.action === "PAUSE" ? last.intentId : null,
    pendingRunNow: intents.filter((i) => i.action === "RUN_CYCLE_NOW" && !honored.has(i.intentId)),
    pendingDispatch: intents.filter((i) => i.action === "DISPATCH" && !honored.has(i.intentId) && !cancelled.has(i.intentId)).sort(byTime),
    cancelledDispatch: cancelled,
    pendingCancel: cancels.filter((i) => !honored.has(i.intentId)).sort(byTime),
    runnerPause: {
      paused: runnerPaused,
      intent: runnerPaused ? lastRunner : null,
      honored: runnerPaused ? (honoredRecords.find((h) => h.honors === lastRunner!.intentId) ?? null) : null,
    },
  };
}

/* --------------------------------------------------------------- the spend */

/**
 * Scout spend in the rolling window, from the DURABLE cost ledger.
 *
 * The same pricing and conservative bounds govern Fleet admission and Scout
 * accounting. An unknown bill without an exact standing hold stays unbounded.
 */
export function scoutSpendInWindow(
  costs: readonly CostEntry[],
  nowIso: string,
  windowHours: number = RESEARCH_BOUNDS.windowHours,
  spendHolds: readonly SpendHold[] = [],
) {
  const spend = aggregateModelSpend(costs.filter(c => c.role === "SCOUT"),
    new Date(Date.parse(nowIso) - windowHours * 3_600_000).toISOString(), nowIso, spendHolds);
  return { windowUsd: spend.usd, knownUsd: spend.knownUsd, measured: spend.measured, unmeasured: spend.unmeasured };
}

/** Both model lanes consume the existing rolling research ceiling; deterministic USD null is not model spend. */
export function researchSpendInWindow(costs: readonly CostEntry[], nowIso: string, windowHours = RESEARCH_BOUNDS.windowHours, spendHolds: readonly SpendHold[] = []) {
  const spend = aggregateModelSpend(costs,
    new Date(Date.parse(nowIso) - windowHours * 3_600_000).toISOString(), nowIso, spendHolds);
  return { windowUsd: spend.usd, knownUsd: spend.knownUsd, measured: spend.measured, unmeasured: spend.unmeasured };
}

/** Is more Scout work admissible under the rolling ceiling? Fires AT the cap. */
export function ceilingPermits(
  windowUsd: number | null,
  ceilingUsd: number,
): { readonly permits: boolean; readonly why: string } {
  if (windowUsd === null) {
    return {
      permits: false,
      why:
        "Scout spend in the rolling window is UNMEASURED (an Attempt reported no usd), so the " +
        `ceiling of $${ceilingUsd} cannot be enforced; work is deferred rather than run against a cap nobody can read`,
    };
  }
  if (windowUsd >= ceilingUsd) {
    return {
      permits: false,
      why: `the rolling daily research ceiling is reached: $${windowUsd.toFixed(4)} of $${ceilingUsd} in the window`,
    };
  }
  return { permits: true, why: `$${windowUsd.toFixed(4)} of $${ceilingUsd} spent in the rolling window` };
}

/* ------------------------------------------------------------ the verdict */

export type Level1Verdict = "ACTIVE" | "DEGRADED" | "INACTIVE";

export interface Level1Condition {
  readonly name: string;
  readonly ok: boolean;
  readonly reason: string;
  /** A failing REQUIRED condition makes the verdict INACTIVE; a failing soft one, DEGRADED. */
  readonly required: boolean;
}

export interface Level1Reading {
  readonly verdict: Level1Verdict;
  readonly conditions: readonly Level1Condition[];
  readonly reasons: readonly string[];
  readonly capDeferred: boolean;
}

/** How stale a research state may be before the lane is not known to be current. */
export const RESEARCH_STATE_LATE_MINUTES = HEARTBEAT_LATE_MINUTES;

/**
 * DERIVE the Level 1 operational state. Pure; every input is a record read at
 * call time. Nothing here reads a stored verdict — a `state` carrying any
 * `active`/`verdict`-shaped field is ignored, and the test proves it.
 */
export function deriveLevel1(input: {
  readonly nowIso: string;
  readonly heartbeat: RunnerHeartbeat | null;
  readonly state: ResearchState | null;
  readonly intents: readonly ResearchIntent[];
  readonly spendWindowUsd: number | null;
  readonly spendUnmeasuredAttempts: number;
}): Level1Reading {
  const now = Date.parse(input.nowIso);
  const minutesSince = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 60_000)) : null;
  };
  const conditions: Level1Condition[] = [];

  const beat = minutesSince(input.heartbeat?.beatAt);
  conditions.push({
    name: "standing runner heartbeat within tolerance",
    ok: beat !== null && beat < HEARTBEAT_LATE_MINUTES,
    required: true,
    reason:
      beat === null
        ? "no runner heartbeat is recorded; the runner is not known to be alive"
        : beat < HEARTBEAT_LATE_MINUTES
          ? `last heartbeat ${beat} minute(s) ago (tolerance ${HEARTBEAT_LATE_MINUTES})`
          : `last heartbeat ${beat} minute(s) ago, past the ${HEARTBEAT_LATE_MINUTES}-minute tolerance`,
  });

  const stateAge = minutesSince(input.state?.beatAt);
  conditions.push({
    name: "research state written by a current cycle",
    ok: stateAge !== null && stateAge < RESEARCH_STATE_LATE_MINUTES,
    required: true,
    reason:
      stateAge === null
        ? "no research state has been written; the Level 1 lane has never reported"
        : stateAge < RESEARCH_STATE_LATE_MINUTES
          ? `research state written ${stateAge} minute(s) ago`
          : `research state is ${stateAge} minute(s) old, past the ${RESEARCH_STATE_LATE_MINUTES}-minute tolerance`,
  });

  const intents = readIntents(input.intents);
  const paused = intents.paused || input.state?.pausedByOwner === true;
  conditions.push({
    name: "research not owner-paused",
    ok: !paused,
    required: true,
    reason: paused
      ? `paused by owner intent ${intents.pauseIntentId ?? input.state?.pauseIntentId ?? "(id unrecorded)"}`
      : "no pause intent stands",
  });

  const lane = input.state?.modelLaneEnabled === true;
  conditions.push({
    name: "model lane enabled",
    ok: lane,
    required: true,
    reason: lane
      ? "the standing runner reports the model lane enabled"
      : `the model lane is not enabled: ${input.state?.modelLaneDisabledReason ?? "no research state reports it"}`,
  });

  const cred = input.state?.workerCredential.configured === true;
  conditions.push({
    name: "dedicated worker credential available to the standing context",
    ok: cred,
    required: true,
    reason: cred
      ? `${input.state?.workerCredential.name} confirmed configured in the standing runner's process (by name)`
      : `${input.state?.workerCredential.name ?? WORKER_CREDENTIAL_VAR} is not confirmed in the standing runner's process`,
  });

  const ceiling = input.state?.bounds.dailyCeilingUsd ?? RESEARCH_BOUNDS.dailyCeilingUsd;
  const cap = ceilingPermits(input.spendWindowUsd, ceiling);
  const capDeferred = !cap.permits && input.spendWindowUsd !== null;
  conditions.push({
    name: "cost/fanout state permitting work or legitimately cap-deferred",
    ok: cap.permits || capDeferred,
    required: false,
    reason: cap.permits
      ? cap.why
      : capDeferred
        ? `${cap.why} — eligible Scout work is deferred with its next-due, never dropped`
        : cap.why,
  });
  if (input.spendUnmeasuredAttempts > 0) {
    conditions.push({
      name: "every Scout Attempt in the window measured its cost",
      ok: false,
      required: false,
      reason: `${input.spendUnmeasuredAttempts} Scout Attempt(s) in the window reported no usd; the ceiling is enforced against the measured sum only`,
    });
  }

  const runtime = input.state?.runtimeConditions ?? [];
  conditions.push({
    name: "no known runtime condition preventing eligible Scout work from dispatching",
    ok: runtime.length === 0,
    required: false,
    reason: runtime.length === 0 ? "none reported by the last cycle" : runtime.join("; "),
  });

  /*
   * HOST SUPERVISION PROVEN (Work Item 3.2, RULING 246). A soft condition: the
   * lane can run without it, but it is not ACTIVE — a runner nothing relaunches
   * is one kill away from a dead lane that still reads healthy for
   * HEARTBEAT_LATE_MINUTES. Proven means: the proof travelled with the state,
   * its verdict is RELAUNCHED, it is within SUPERVISION_PROOF_MAX_AGE_DAYS, and
   * the live task still carries the relaunch trigger.
   */
  const supervision = input.state?.hostSupervision ?? null;
  const proof = supervision?.proof ?? null;
  const proofAgeDays = proof === null ? null : (now - Date.parse(proof.measuredAt)) / 86_400_000;
  const proofFresh = proofAgeDays !== null && Number.isFinite(proofAgeDays) && proofAgeDays >= 0 && proofAgeDays <= SUPERVISION_PROOF_MAX_AGE_DAYS;
  const triggerLive = supervision?.relaunchTrigger.present === true;
  const supervisionOk = supervision !== null && supervision.measurable && proof !== null && proof.verdict === "RELAUNCHED" && proofFresh && triggerLive;
  conditions.push({
    name: "host supervision proven (parent relaunch measured, RULING 246)",
    ok: supervisionOk,
    required: false,
    reason:
      supervision === null
        ? "no host supervision reading travelled with the research state; a parent relaunch has not been proven to this page"
        : !supervision.measurable
          ? `host ${supervision.host} cannot be asked for its scheduled task: ${supervision.notMeasurableReason ?? "NOT_MEASURABLE_ON_THIS_HOST"}`
          : proof === null
            ? `no relaunch proof at ${supervision.proofPath} on ${supervision.host}; run scripts/pilot-task.ps1 -Action prove-relaunch`
            : proof.verdict !== "RELAUNCHED"
              ? `the relaunch proof measured ${proof.measuredAt} read NOT_RELAUNCHED (killed pid ${proof.killedPid ?? "?"}, nothing came back)`
              : !proofFresh
                ? `the RELAUNCHED proof measured ${proof.measuredAt} is ${proofAgeDays === null ? "undated" : `${Math.floor(proofAgeDays)} day(s)`} old, past the ${SUPERVISION_PROOF_MAX_AGE_DAYS}-day tolerance; re-run prove-relaunch`
                : supervision.relaunchTrigger.present === null
                  ? `the RELAUNCHED proof stands (${proof.measuredAt}, ${proof.secondsToRelaunch ?? "?"}s) but live supervision could not be verified: ${supervision.relaunchTrigger.detail}`
                : !triggerLive
                  ? `the RELAUNCHED proof stands (${proof.measuredAt}, ${proof.secondsToRelaunch ?? "?"}s) but the live task no longer carries the relaunch trigger: ${supervision.relaunchTrigger.detail}`
                  : `parent relaunch proven ${proof.measuredAt}: pid ${proof.killedPid ?? "?"} killed, pid ${proof.relaunchedPid ?? "?"} back in ${proof.secondsToRelaunch ?? "?"}s; relaunch trigger present on ${supervision.host} at ${supervision.checkedAt}`,
  });

  const failingRequired = conditions.filter((c) => c.required && !c.ok);
  const failingSoft = conditions.filter((c) => !c.required && !c.ok);
  const verdict: Level1Verdict =
    failingRequired.length > 0 ? "INACTIVE" : failingSoft.length > 0 ? "DEGRADED" : "ACTIVE";
  return {
    verdict,
    conditions,
    reasons: [...failingRequired, ...failingSoft].map((c) => `${c.name}: ${c.reason}`),
    capDeferred,
  };
}

/**
 * The model the Scout lane STARTS on, for records that must name it: the
 * research loop's base class in the step registry (currently Haiku 4.5).
 * A loop that escalates names the higher
 * model on its own result (`ScoutResult.modelClass`, `modelAttempts`).
 */
export const SCOUT_MODEL = MODEL_FOR_CLASS[SCOUT_STEPS["scout-research-loop"].modelClass];

/** Available processes, derived from funded requests and the provider's capacity.
 * A funded geography can have many ready jobs. Only a pool's ready work limits
 * its worker count; the shared slots leave it unset because pools own demand.
 */
export function researchWorkerCapacity(input: {
  readonly readyWork?: number; readonly availableUsd: number;
  readonly requestUsd: number; readonly requestsPerMinute?: number;
  readonly inputTokensPerMinute?: number; readonly outputTokensPerMinute?: number;
  readonly inputTokensPerRequest?: number; readonly outputTokensPerRequest?: number;
}): number {
  if (![input.availableUsd, input.requestUsd, ...[input.readyWork, input.requestsPerMinute,
    input.inputTokensPerMinute, input.outputTokensPerMinute, input.inputTokensPerRequest,
    input.outputTokensPerRequest].filter(value => value !== undefined)].every(value => Number.isFinite(value) && value! >= 0)) return 0;
  if (input.readyWork === 0 || input.availableUsd <= 0 || input.requestUsd <= 0) return 0;
  const budgetCapacity = Math.floor(input.availableUsd / input.requestUsd);
  const readyWork = Math.floor(input.readyWork ?? budgetCapacity);
  const provider = input.requestsPerMinute === undefined ? budgetCapacity : Math.floor(input.requestsPerMinute);
  const inputCapacity = input.inputTokensPerMinute === undefined ? budgetCapacity
    : Math.floor(input.inputTokensPerMinute / Math.max(1, input.inputTokensPerRequest ?? 1));
  const outputCapacity = input.outputTokensPerMinute === undefined ? budgetCapacity
    : Math.floor(input.outputTokensPerMinute / Math.max(1, input.outputTokensPerRequest ?? 1));
  return Math.max(0, Math.min(readyWork, budgetCapacity, provider, inputCapacity, outputCapacity));
}

/** Paid slots never acquire a one-worker floor when spend is unbounded or the
 * owner's model lane is closed. The process pool still admits plain work. */
export function researchPaidWorkerCapacity(input: Omit<Parameters<typeof researchWorkerCapacity>[0], "availableUsd"> & {
  readonly modelEnabled: boolean; readonly spentUsd: number | null; readonly ceilingUsd: number;
}): number {
  if (!input.modelEnabled || input.spentUsd === null || !Number.isFinite(input.spentUsd) || input.spentUsd < 0) return 0;
  return researchWorkerCapacity({ ...input, availableUsd: Math.max(0, input.ceilingUsd - input.spentUsd) });
}

/** What one Scout request is counted at: its output-token limit at the Haiku price. The runner and Admin both use this figure. */
export function scoutRequestUsd(): number {
  return MODELS.haiku.outputUsdPerMillion * RESEARCH_BOUNDS.perDispatch.maxOutputTokensPerTurn / 1_000_000;
}

/**
 * BR-21: how many paid hunters the daily limit buys right now. The same math the runner admits with
 * (`researchPaidWorkerCapacity`), fed from what Admin can read: the limit, what the last 24 hours spent
 * and the provider's request rate when one is configured. Null when either money figure is unread.
 */
export function huntersTheDialBuys(input: {
  readonly dailyLimitUsd: number | null;
  readonly spentLast24hUsd: number | null;
  readonly requestsPerMinute?: number;
}): number | null {
  if (input.dailyLimitUsd === null || input.spentLast24hUsd === null) return null;
  return researchPaidWorkerCapacity({
    modelEnabled: true, spentUsd: input.spentLast24hUsd, ceilingUsd: input.dailyLimitUsd, requestUsd: scoutRequestUsd(),
    ...(input.requestsPerMinute === undefined ? {} : { requestsPerMinute: input.requestsPerMinute }),
  });
}

/** A paid job rechecks its admission after waiting for the shared host's
 * memory. Closing paid work leaves the memory slot available for plain work. */
export function paidWorkerSlots(slots: WorkerProcessSlots, capacity: () => number): WorkerProcessSlots {
  return { acquire: async (entry, ...deadline) => {
    if (capacity() <= 0) throw new Error("MODEL_LANE_CLOSED: no paid Scout capacity");
    const release = await slots.acquire(entry, ...deadline);
    if (capacity() <= 0) {
      release();
      throw new Error("MODEL_LANE_CLOSED: no paid Scout capacity");
    }
    return release;
  } };
}
