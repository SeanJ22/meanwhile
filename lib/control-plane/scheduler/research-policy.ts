/**
 * **LEVEL 1 — RESEARCH: THE BOUNDS, THE DURABLE STATE, AND THE DERIVED VERDICT.**
 * (Level 1 activation, 2026-09-01. RULING 240, RULING 241.)
 *
 * Three things live here because a page and a runner must agree on them:
 *
 * ```
 *   BOUNDS     how many Scouts at once, how many per cycle, how much per
 *              Attempt, how much per rolling day — stated once, recorded on
 *              every cycle's research state, never implied
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
import { MODEL_WORKER_MODEL } from "../model-cost.ts";
import type { DispatchOrdering, ResearchMetrics } from "../research-metrics.ts";

/* ------------------------------------------------------------------ bounds */

/** The workers' dedicated credential. NAME only; no value is ever read into a record. */
export const WORKER_CREDENTIAL_VAR = "WTP_WORKERS_ANTHROPIC_API_KEY";

export interface ScoutBound {
  /** Model turns (requests) per Attempt. */
  readonly maxTurns: number;
  /** Research tool calls per Attempt. */
  readonly maxToolCalls: number;
  /** Wall clock per Attempt. */
  readonly maxWallMs: number;
  /** Provider-reported input+output tokens per Attempt. */
  readonly maxTokens: number;
  /** Public requests per host per Attempt. Politeness that does not multiply. */
  readonly maxRequestsPerHost: number;
  /** `max_tokens` on each model response. */
  readonly maxOutputTokensPerTurn: number;
}

export interface ResearchBounds {
  readonly maxConcurrentScouts: number;
  readonly maxScoutDispatchesPerCycle: number;
  readonly perDispatch: ScoutBound;
  /** The rolling daily model-spend ceiling. TEMPORARY, an owner safety ceiling (RULING 241). */
  readonly dailyCeilingUsd: number;
  readonly windowHours: number;
}

export const RESEARCH_BOUNDS: ResearchBounds = {
  maxConcurrentScouts: 2,
  maxScoutDispatchesPerCycle: 3,
  perDispatch: {
    maxTurns: 18,
    maxToolCalls: 16,
    maxWallMs: 5 * 60_000,
    maxTokens: 400_000,
    maxRequestsPerHost: 10,
    maxOutputTokensPerTurn: 8_192,
  },
  dailyCeilingUsd: 25,
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
}

/**
 * **THE HOST'S SUPERVISION, AS THE CYCLE MEASURED IT.** (Work Item 3.2,
 * 2026-09-02. RULING 246.)
 *
 * The admin page reads only the control plane, and a Netlify function cannot
 * read this host's files — so the relaunch proof `scripts/pilot-task.ps1
 * -Action prove-relaunch` writes to `data/ops/runner-relaunch-proof.json`
 * must TRAVEL: the cycle script reads the proof from its checkout and the
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
    readonly modelClassDeferredForLane: number;
    readonly deterministicDue: number;
    readonly deterministicDispatchedThisCycle: number;
  };
  readonly running: readonly RunningScout[];
  /** Named runtime conditions preventing eligible Scout work from dispatching. Empty when none. */
  readonly runtimeConditions: readonly string[];
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
}

export const RESEARCH_INTENT_ACTIONS = ["PAUSE", "RESUME", "RUN_CYCLE_NOW"] as const;
export type ResearchIntentAction = (typeof RESEARCH_INTENT_ACTIONS)[number];

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
      readonly note: string | null;
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

/** The latest PAUSE/RESUME decides; RUN_CYCLE_NOW is pending until a HONORED record names it. */
export function readIntents(log: readonly ResearchIntent[]): {
  readonly paused: boolean;
  readonly pauseIntentId: string | null;
  readonly pendingRunNow: readonly Extract<ResearchIntent, { kind: "INTENT" }>[];
} {
  const intents = log.filter((r): r is Extract<ResearchIntent, { kind: "INTENT" }> => r.kind === "INTENT");
  const honored = new Set(
    log.filter((r): r is Extract<ResearchIntent, { kind: "HONORED" }> => r.kind === "HONORED").map((r) => r.honors),
  );
  const pauses = intents
    .filter((i) => i.action === "PAUSE" || i.action === "RESUME")
    .sort((a, b) => (a.requestedAt < b.requestedAt ? -1 : a.requestedAt > b.requestedAt ? 1 : 0));
  const last = pauses.at(-1) ?? null;
  return {
    paused: last?.action === "PAUSE",
    pauseIntentId: last?.action === "PAUSE" ? last.intentId : null,
    pendingRunNow: intents.filter((i) => i.action === "RUN_CYCLE_NOW" && !honored.has(i.intentId)),
  };
}

/* --------------------------------------------------------------- the spend */

/**
 * Scout spend in the rolling window, from the DURABLE cost ledger.
 *
 * `total` is the sum of MEASURED usd only; an Attempt whose usd is null is
 * counted as UNMEASURED and reported beside the total, never coerced to zero
 * (cost.ts). The cap is enforced against the measured sum, and an unmeasured
 * Attempt is a named runtime condition rather than a free one.
 */
export function scoutSpendInWindow(
  costs: readonly CostEntry[],
  nowIso: string,
  windowHours: number = RESEARCH_BOUNDS.windowHours,
): { readonly windowUsd: number | null; readonly measured: number; readonly unmeasured: number } {
  const since = Date.parse(nowIso) - windowHours * 3_600_000;
  let total = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const c of costs) {
    if (c.role !== "SCOUT") continue;
    if (Date.parse(c.recordedAt) < since) continue;
    if (c.cost.usd === null || c.cost.usd === undefined || Number.isNaN(c.cost.usd)) {
      unmeasured += 1;
      continue;
    }
    total += c.cost.usd;
    measured += 1;
  }
  return { windowUsd: measured === 0 ? (unmeasured === 0 ? 0 : null) : total, measured, unmeasured };
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

/** The model the Scout lane runs, for records that must name it. */
export const SCOUT_MODEL = MODEL_WORKER_MODEL;
