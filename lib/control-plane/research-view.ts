/**
 * **THE RESEARCH VIEW — what the admin Research page reads, and the one thing it derives.**
 * (Level 1 activation, 2026-09-01. RULING 240, RULING 241.)
 *
 * Server-side reads over the control plane, each answering HELD / NOT_RECORDED /
 * STORE_UNREACHABLE exactly as `admin-data.ts` does, and ONE pure function that
 * turns those answers into everything the page renders.
 *
 * ```
 *   THE VERDICT IS DERIVED     `deriveLevel1` at read time, from the heartbeat,
 *                              the state, the intents and the live spend. A
 *                              stored flag on the state record is never read —
 *                              there is no code path here that looks for one
 *   EVERY NUMBER IS MEASURED   a `Measured` with its denominator and contract,
 *                              or a `Gap` that says whose gap it is
 *   A FAILED READ IS NAMED     an unreachable store can never make the lane
 *                              read ACTIVE; it reads INACTIVE with the store
 *                              named as the reason
 *   NO CREDENTIAL VALUE        the worker credential reaches the view as a
 *                              NAME and a configured flag, copied field by
 *                              field, never as the record it came from
 * ```
 */

import { unreachable, type ReadOutcome } from "./admin-data.ts";
import type { CostEntry } from "./cost.ts";
import type { FleetSafetySnapshot } from "./fleet-safety.ts";
import { runnerStanding, type RunnerStanding } from "./runner-standing.ts";
import {
  assertAggregateOnly,
  gap,
  held,
  livenessOf,
  measured,
  type CountClaim,
  type Held,
  type Measured,
  type RenderedNumber,
  type RunnerHeartbeat,
  type RunnerLiveness,
} from "./owner-surface.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import {
  INTENT_NOTE_MAX_CHARS,
  RESEARCH_BOUNDS,
  RESEARCH_FORMAT_VERSION,
  RESEARCH_INTENT_ACTIONS,
  RESEARCH_INTENT_LOG_KEY,
  RESEARCH_STATE_ID,
  deriveLevel1,
  readIntents,
  scoutSpendInWindow,
  type HostSupervision,
  type Level1Condition,
  type Level1Reading,
  type Level1Verdict,
  type ResearchBounds,
  type ResearchIntent,
  type ResearchIntentAction,
  type ResearchState,
  type RunningScout,
} from "./scheduler/research-policy.ts";
import type { ScoutOutcome, ScoutResult, ScoutStop } from "./scheduler/scout-result.ts";
import { researchDigestRows, type ResearchDigestRows } from "./research-digest.ts";
import type { DispatchOrdering, ResearchMetrics } from "./research-metrics.ts";

/** How many Scout results and intents the page lists. The totals are always stated beside them. */
export const SCOUT_RESULTS_SHOWN = 25;
export const INTENTS_SHOWN = 10;

/* ------------------------------------------------------------------ reads */

export async function readResearchState(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<ResearchState>> {
  try {
    const row = await repos.researchState.read(RESEARCH_STATE_ID);
    if (row === null) {
      return {
        kind: "NOT_RECORDED",
        detail: "The control plane is reachable and holds no research state yet; the Level 1 lane has never reported.",
      };
    }
    return { kind: "HELD", value: row.value };
  } catch (error) {
    return unreachable("the research state", error);
  }
}

/** The intent log in append order. An empty log is HELD: no intent has been recorded. */
export async function readResearchIntents(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<readonly ResearchIntent[]>> {
  try {
    return { kind: "HELD", value: await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY) };
  } catch (error) {
    return unreachable("the research intent log", error);
  }
}

export interface ScoutResultsRead {
  /** Every typed result the log holds. */
  readonly total: number;
  /** The newest `SCOUT_RESULTS_SHOWN`, newest first by `recordedAt`. */
  readonly latest: readonly ScoutResult[];
}

function newestFirst(results: readonly ScoutResult[]): ScoutResult[] {
  return [...results].sort((a, b) =>
    a.recordedAt < b.recordedAt ? 1 : a.recordedAt > b.recordedAt ? -1 : 0,
  );
}

export async function readScoutResults(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<ScoutResultsRead>> {
  try {
    const all = await repos.scoutResults.readAll();
    return {
      kind: "HELD",
      value: { total: all.length, latest: newestFirst(all).slice(0, SCOUT_RESULTS_SHOWN) },
    };
  } catch (error) {
    return unreachable("the Scout result log", error);
  }
}

export interface ScoutSpendRead {
  readonly windowUsd: number | null;
  readonly measured: number;
  readonly unmeasured: number;
  readonly windowHours: number;
  readonly asOf: string;
}

/** Scout spend in the rolling window, from the DURABLE cost ledger, as of `nowIso`. */
export async function readScoutSpend(
  repos: ControlPlaneRepositories,
  nowIso: string,
): Promise<ReadOutcome<ScoutSpendRead>> {
  try {
    const costs: readonly CostEntry[] = await repos.costs.readAll();
    const spend = scoutSpendInWindow(costs, nowIso, RESEARCH_BOUNDS.windowHours);
    return {
      kind: "HELD",
      value: { ...spend, windowHours: RESEARCH_BOUNDS.windowHours, asOf: nowIso },
    };
  } catch (error) {
    return unreachable("the cost ledger", error);
  }
}

export interface ScoutEvidenceRead {
  /** Distinct artifact ids across every result's `artifactIds`. */
  readonly distinctArtifacts: number;
  /** Every artifact id citation, duplicates included. The denominator of the distinct count. */
  readonly citations: number;
  readonly attempts: number;
  readonly attemptsWithEvidence: number;
}

/** Derived from the results themselves, so the page never scans the artifact log. */
export function scoutEvidenceOf(results: readonly ScoutResult[]): ScoutEvidenceRead {
  const distinct = new Set<string>();
  let citations = 0;
  let attemptsWithEvidence = 0;
  for (const r of results) {
    if (r.artifactIds.length > 0) attemptsWithEvidence += 1;
    for (const id of r.artifactIds) {
      citations += 1;
      distinct.add(id);
    }
  }
  return {
    distinctArtifacts: distinct.size,
    citations,
    attempts: results.length,
    attemptsWithEvidence,
  };
}

export async function readScoutEvidenceCount(
  repos: ControlPlaneRepositories,
): Promise<ReadOutcome<ScoutEvidenceRead>> {
  try {
    return { kind: "HELD", value: scoutEvidenceOf(await repos.scoutResults.readAll()) };
  } catch (error) {
    return unreachable("the Scout result log", error);
  }
}

/* ---------------------------------------------------------------- intents */

export type ResearchIntentRecord = Extract<ResearchIntent, { readonly kind: "INTENT" }>;

export function parseResearchIntentAction(raw: unknown): ResearchIntentAction | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return (RESEARCH_INTENT_ACTIONS as readonly string[]).includes(value)
    ? (value as ResearchIntentAction)
    : null;
}

/**
 * The intent the admin route appends. The session id is provenance, never a
 * reader identity. `note` is the owner's own words — a DISPATCH target or a
 * PAUSE_RUNNER reason — and is null for every other action. `budgetUsd` is a
 * DISPATCH's own budget (MW-021), kept only on a DISPATCH.
 */
export function buildResearchIntent(
  action: ResearchIntentAction,
  requestedAt: string,
  adminSessionRef: string,
  note: string | null = null,
  actor = "owner (admin session)",
  budgetUsd: number | null = null,
): ResearchIntentRecord {
  return {
    formatVersion: RESEARCH_FORMAT_VERSION,
    kind: "INTENT",
    intentId: `${action}:${requestedAt}`,
    action,
    requestedAt,
    actor,
    adminSessionRef,
    note,
    ...(action === "DISPATCH" && budgetUsd !== null ? { budgetUsd } : {}),
  };
}

/**
 * Validate the owner's note for an action (ADM-8 dispatch target, ADM-5 pause
 * reason). A DISPATCH without words is refused: "deploy the fleet" to nowhere
 * is not an instruction. Everything else may carry a note or not. Returns the
 * trimmed note, or a refusal sentence.
 */
export function validateIntentNote(
  action: ResearchIntentAction,
  raw: unknown,
): { readonly ok: true; readonly note: string | null } | { readonly ok: false; readonly detail: string } {
  const text = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (text.length > INTENT_NOTE_MAX_CHARS) {
    return { ok: false, detail: `the note is longer than ${INTENT_NOTE_MAX_CHARS} characters` };
  }
  if (action === "DISPATCH" && text.length === 0) {
    return { ok: false, detail: "a DISPATCH needs a target — say what the fleet should go do" };
  }
  if (action === "CANCEL_DISPATCH") {
    return /^DISPATCH:\d{4}-\d{2}-\d{2}T[0-9:.]+Z$/.test(text)
      ? { ok: true, note: text }
      : { ok: false, detail: "say which sent instruction to take back (its DISPATCH id)" };
  }
  if (action !== "DISPATCH" && action !== "PAUSE_RUNNER" && action !== "RESUME_RUNNER") {
    return { ok: true, note: null };
  }
  return { ok: true, note: text.length === 0 ? null : text };
}

export async function appendResearchIntent(
  repos: ControlPlaneRepositories,
  intent: ResearchIntentRecord,
  nowIso: string,
): Promise<
  { readonly ok: true; readonly appended: boolean } | { readonly ok: false; readonly detail: string }
> {
  try {
    assertAggregateOnly(intent, "appendResearchIntent");
    const outcome = await repos.researchIntents.append(
      RESEARCH_INTENT_LOG_KEY,
      intent.intentId,
      intent,
      nowIso,
    );
    return { ok: true, appended: outcome.appended };
  } catch (error) {
    return { ok: false, detail: (error as Error)?.message ?? "the append failed" };
  }
}

/* --------------------------------------------------------------- the view */

export interface ScoutRow {
  readonly subject: string;
  readonly obligationId: string;
  /**
   * The executor's own sentence for why a MODEL was spent on this unit. It
   * explains the dispatch, never the goal — the owner read it and said *"I
   * have no idea how to translate the reason at all."* It stays on the row as
   * disclosure detail; the face is built by `scoutStory` in
   * `lib/control-plane/plain-work.ts` from the typed fields beneath.
   */
  readonly reason: string;
  readonly model: string;
  readonly elapsedMs: number;
  readonly usd: number | null;
  readonly outcome: ScoutOutcome;
  readonly stoppedBy: ScoutStop;
  readonly attemptId: string;
  readonly workItemId: string;
  readonly artifactCount: number;
  readonly candidateCount: number;
  readonly recordedAt: string;
  /* ---- the typed facts the plain sentences are built from (ADM-48) ---- */
  /** What class of record the obligation is about. */
  readonly recordClass: string;
  /** The route the obligation names, or null when it names none. */
  readonly routeId: string | null;
  /** The executor's refusal codes; empty when it accepted the Scout's finish. */
  readonly refusalCodes: readonly string[];
  /** Distinct evidence-backed rungs the Scout walked. */
  readonly evidenceRungs: number;
  /** The rungs the Scout said it would try next — the proof there IS a next route. */
  readonly nextRungs: readonly string[];
}

export interface IntentRow {
  readonly intentId: string;
  readonly action: ResearchIntentAction;
  readonly requestedAt: string;
  readonly actor: string;
  readonly adminSessionRef: string;
  readonly status: "HONORED" | "PENDING";
  readonly honoredAt: string | null;
  readonly honoredBy: string | null;
  readonly detail: string | null;
}

export interface ResearchView {
  readonly nowIso: string;
  /** ACTIVE / DEGRADED / INACTIVE. `reading.verdict` unless a required input was unreadable. */
  readonly verdict: Level1Verdict;
  /** Every named reason the lane is not ACTIVE, store failures included. Empty when ACTIVE. */
  readonly reasons: readonly string[];
  /** The raw derivation, for a caller that wants each condition. */
  readonly reading: Level1Reading;
  /** Each input the store could not answer, by name. */
  readonly storeNotes: readonly string[];
  /**
   * What the runner is doing, and the facts the card needs to say what it did
   * and when it runs again (ADM-24 wording, applied here by ADM-42's item 9).
   * `standing` is `runner-standing.ts` — the ONE place a human sentence for
   * runner state is generated — so this page and Pilot health cannot disagree
   * about whether the runner is paused, late or in a blackout.
   */
  readonly runner: {
    readonly state: RunnerLiveness;
    readonly detail: string;
    readonly note: string | null;
    readonly standing: RunnerStanding;
    readonly host: string | null;
    readonly lastBeatAt: string | null;
    readonly lastCycleStartedAt: string | null;
    readonly lastCycleFinishedAt: string | null;
    /** When the runner itself believes the next cycle is due. Null when it was started without an interval. */
    readonly nextCycleDueAt: string | null;
    readonly testedSha: string | null;
  };
  /**
   * The last cycle's Fleet safety snapshot: what stopped work early, what was
   * pushed to a later cycle, and which providers are paused. A gap when the
   * cycle that wrote this state predates the field.
   */
  readonly safety: Held<FleetSafetySnapshot>;
  readonly cycle: Held<{
    readonly beatAt: string;
    readonly cycleStartedAt: string;
    readonly cycleFinishedAt: string | null;
    readonly testedSha: string | null;
    readonly host: string;
    readonly model: string;
    readonly modelLaneEnabled: boolean;
    readonly modelLaneDisabledReason: string | null;
    readonly runtimeConditions: readonly string[];
  }>;
  readonly workerCredential: Held<{
    readonly name: string;
    readonly configured: boolean;
    readonly provider: string;
    readonly context: string;
  }>;
  readonly bounds: ResearchBounds;
  readonly boundsSource: "the last research state" | "RESEARCH_BOUNDS (no state recorded)";
  readonly concurrency: Held<Measured>;
  readonly spend: {
    readonly windowHours: number;
    readonly ceilingUsd: number;
    readonly windowUsd: Held<Measured>;
    readonly measuredAttempts: Held<Measured>;
    readonly unmeasuredAttempts: Held<Measured>;
    /** The cap condition's own words when eligible work is cap-deferred; the lane can be ACTIVE and deferring. */
    readonly capDeferredNote: string | null;
  };
  readonly queue: Held<{
    readonly due: Held<Measured>;
    readonly queued: Held<Measured>;
    readonly dispatchedThisCycle: Held<Measured>;
    readonly deferredForCeiling: Held<Measured>;
    readonly deferredForCycleMax: Held<Measured>;
    readonly deferredForLane: Held<Measured>;
    readonly deterministicDispatched: Held<Measured>;
  }>;
  readonly running: Held<readonly RunningScout[]>;
  readonly results: Held<{ readonly shown: Measured; readonly rows: readonly ScoutRow[] }>;
  readonly evidence: Held<{
    readonly distinctArtifacts: Measured;
    readonly attemptsWithEvidence: Measured;
  }>;
  readonly methodCandidates: Held<{
    readonly validated: Held<Measured>;
    readonly admitted: Held<Measured>;
    readonly rejected: Held<Measured>;
  }>;
  readonly intents: Held<{ readonly shown: Measured; readonly rows: readonly IntentRow[] }>;
  /** The one pause form that applies: PAUSE when running, RESUME when paused. */
  readonly pauseAction: "PAUSE" | "RESUME";
  /**
   * The host supervision reading the last cycle carried (RULING 246), and the
   * condition it derived. A gap names whose gap it is; the condition is also
   * in `reading.conditions`, this is the panel's own copy.
   */
  readonly supervision: Held<HostSupervision & { readonly condition: Level1Condition | null }>;
  /** The reader-impact order the last cycle applied to the Scout lane (Work Item 5). */
  readonly ordering: Held<DispatchOrdering>;
  /** The lane's numbers as the last cycle computed them, plus the typed rows the page's panels render. */
  readonly metrics: Held<{ readonly record: ResearchMetrics; readonly rows: ResearchDigestRows }>;
}

export interface ResearchViewInput {
  readonly nowIso: string;
  readonly heartbeat: ReadOutcome<RunnerHeartbeat>;
  readonly state: ReadOutcome<ResearchState>;
  readonly intents: ReadOutcome<readonly ResearchIntent[]>;
  readonly results: ReadOutcome<ScoutResultsRead>;
  readonly spend: ReadOutcome<ScoutSpendRead>;
  readonly evidence: ReadOutcome<ScoutEvidenceRead>;
}

function valueOf<T>(outcome: ReadOutcome<T>): T | null {
  return outcome.kind === "HELD" ? outcome.value : null;
}

function noteOf<T>(outcome: ReadOutcome<T>): string | null {
  return outcome.kind === "HELD" ? null : outcome.detail;
}

/** A count the runner reported. A numerator the denominator cannot hold is withheld and named, never rendered. */
function count(
  label: string,
  value: number,
  denominator: number,
  contract: string,
  source: string,
): Held<Measured> {
  try {
    return held(measured(value, denominator, contract, source));
  } catch {
    return gap(
      "OURS",
      `${label}: the runner reported ${value} against a denominator of ${denominator}, which cannot ` +
        "both be true; the number is withheld rather than rendered",
    );
  }
}

/**
 * Spend may lawfully exceed its ceiling — the cap fires AT the cap, after the
 * Attempt that crossed it is recorded — so this is the one number not built by
 * `measured()`, which would refuse it. Finite and non-negative are still required.
 */
function spendMeasure(windowUsd: number, ceilingUsd: number, windowHours: number): Held<Measured> {
  if (!Number.isFinite(windowUsd) || windowUsd < 0 || !Number.isFinite(ceilingUsd)) {
    return gap("OURS", "the Scout spend in the window could not be read as a finite usd amount");
  }
  return held({
    value: windowUsd,
    denominator: ceilingUsd,
    contract:
      `measured Scout spend (usd) in the rolling ${windowHours}h window against the daily ceiling; ` +
      "at or above the ceiling, eligible Scout work is deferred with its next-due, never dropped",
    denominatorSource: "RESEARCH_BOUNDS.dailyCeilingUsd as recorded on the research state",
  });
}

function scoutRowOf(r: ScoutResult): ScoutRow {
  return {
    subject: r.subjectId,
    obligationId: r.obligationId,
    reason: r.reason,
    model: r.worker.modelReported ?? r.worker.model,
    elapsedMs: r.elapsedMs,
    usd: r.usd,
    outcome: r.outcome,
    stoppedBy: r.stoppedBy,
    attemptId: r.attemptId,
    workItemId: r.workItemId,
    artifactCount: r.artifactIds.length,
    candidateCount: r.candidates.length,
    recordedAt: r.recordedAt,
    recordClass: r.recordClass,
    routeId: r.routeId,
    refusalCodes: (r.refusal ?? []).map((issue) => issue.code),
    evidenceRungs: r.distinctEvidenceRungs,
    nextRungs: r.nextRungs,
  };
}

function intentRowsOf(log: readonly ResearchIntent[]): IntentRow[] {
  const honored = new Map<string, Extract<ResearchIntent, { readonly kind: "HONORED" }>>();
  for (const r of log) if (r.kind === "HONORED") honored.set(r.honors, r);
  return log
    .filter((r): r is ResearchIntentRecord => r.kind === "INTENT")
    .map((i): IntentRow => {
      const h = honored.get(i.intentId) ?? null;
      return {
        intentId: i.intentId,
        action: i.action,
        requestedAt: i.requestedAt,
        actor: i.actor,
        adminSessionRef: i.adminSessionRef,
        status: h ? "HONORED" : "PENDING",
        honoredAt: h?.honoredAt ?? null,
        honoredBy: h?.honoredBy ?? null,
        detail: h?.detail ?? null,
      };
    })
    .sort((a, b) => (a.requestedAt < b.requestedAt ? 1 : a.requestedAt > b.requestedAt ? -1 : 0));
}

/**
 * Build everything the page renders. PURE: every input is a record read at
 * call time and `nowIso` is the only clock.
 */
export function buildResearchView(input: ResearchViewInput): ResearchView {
  const heartbeat = valueOf(input.heartbeat);
  const state = valueOf(input.state);
  const intentLog = valueOf(input.intents);
  const results = valueOf(input.results);
  const spend = valueOf(input.spend);
  const evidence = valueOf(input.evidence);

  const reading = deriveLevel1({
    nowIso: input.nowIso,
    heartbeat,
    state,
    intents: intentLog ?? [],
    spendWindowUsd: spend?.windowUsd ?? null,
    spendUnmeasuredAttempts: spend?.unmeasured ?? 0,
  });

  const storeNotes: string[] = [];
  function nameFailure<T>(label: string, outcome: ReadOutcome<T>): void {
    if (outcome.kind === "STORE_UNREACHABLE") storeNotes.push(`${label}: ${outcome.detail}`);
  }
  nameFailure("runner heartbeat", input.heartbeat);
  nameFailure("research state", input.state);
  nameFailure("research intents", input.intents);
  nameFailure("Scout spend", input.spend);
  nameFailure("Scout results", input.results);
  nameFailure("Scout evidence", input.evidence);

  // A lane whose pause log, state or heartbeat could not be READ is not known
  // to be active. Deriving ACTIVE over an unreadable input would assert an
  // absence out of a failed read.
  const requiredUnreadable = [input.heartbeat, input.state, input.intents].some(
    (o) => o.kind === "STORE_UNREACHABLE",
  );
  const verdict: Level1Verdict = requiredUnreadable ? "INACTIVE" : reading.verdict;
  const reasons = [
    ...(requiredUnreadable
      ? ["the control plane could not answer a required input, so Level 1 is not known to be active"]
      : []),
    ...reading.reasons,
    ...storeNotes.map((n) => `control plane: ${n}`),
  ];

  const liveness = livenessOf(heartbeat, input.nowIso);
  const bounds = state?.bounds ?? RESEARCH_BOUNDS;
  const boundsSource = state ? "the last research state" : "RESEARCH_BOUNDS (no state recorded)";
  function stateGap<T>(): Held<T> {
    return input.state.kind === "STORE_UNREACHABLE"
      ? gap<T>("OURS", input.state.detail)
      : gap<T>("OURS", "no research state has been written; the Level 1 lane has never reported");
  }

  const cycle: ResearchView["cycle"] = state
    ? held({
        beatAt: state.beatAt,
        cycleStartedAt: state.cycleStartedAt,
        cycleFinishedAt: state.cycleFinishedAt,
        testedSha: state.testedSha,
        host: state.host,
        model: state.model,
        modelLaneEnabled: state.modelLaneEnabled,
        modelLaneDisabledReason: state.modelLaneDisabledReason,
        runtimeConditions: state.runtimeConditions,
      })
    : stateGap();

  // Field by field, on purpose: only the name and the configured flag travel.
  const workerCredential: ResearchView["workerCredential"] = state
    ? held({
        name: state.workerCredential.name,
        configured: state.workerCredential.configured === true,
        provider: state.workerCredential.provider,
        context: state.workerCredential.context,
      })
    : stateGap();

  const concurrency: Held<Measured> = state
    ? count(
        "Scouts running",
        state.running.length,
        bounds.workerCapacity,
        "Scouts the runner has started and not yet closed, against the concurrency bound",
        `${boundsSource}: workerCapacity`,
      )
    : stateGap();

  const spendSource = "Scout entries in the durable cost ledger within the rolling window";
  const attemptsInWindow = (spend?.measured ?? 0) + (spend?.unmeasured ?? 0);
  const capCondition = reading.conditions.find((c) => c.name.startsWith("cost/fanout")) ?? null;
  const spendView: ResearchView["spend"] = {
    windowHours: spend?.windowHours ?? bounds.windowHours,
    ceilingUsd: bounds.dailyCeilingUsd,
    capDeferredNote: reading.capDeferred && capCondition ? capCondition.reason : null,
    windowUsd:
      spend === null
        ? gap("OURS", input.spend.kind === "HELD" ? "no spend read" : input.spend.detail)
        : spend.windowUsd === null
          ? gap(
              "OURS",
              "Scout spend in the window is UNMEASURED: every Scout Attempt in the window reported no usd, " +
                "so the ceiling cannot be enforced and work is deferred rather than run against a cap nobody can read",
            )
          : spendMeasure(spend.windowUsd, bounds.dailyCeilingUsd, spend.windowHours),
    measuredAttempts:
      spend === null
        ? gap("OURS", input.spend.kind === "HELD" ? "no spend read" : input.spend.detail)
        : count(
            "measured Scout Attempts",
            spend.measured,
            attemptsInWindow,
            "Scout Attempts in the window whose usd was reported and counts toward the ceiling",
            spendSource,
          ),
    unmeasuredAttempts:
      spend === null
        ? gap("OURS", input.spend.kind === "HELD" ? "no spend read" : input.spend.detail)
        : count(
            "unmeasured Scout Attempts",
            spend.unmeasured,
            attemptsInWindow,
            "Scout Attempts in the window that reported no usd; never coerced to zero",
            spendSource,
          ),
  };

  const queueSource = "the last research state's queue counts";
  const queue: ResearchView["queue"] = state
    ? held({
        due: count(
          "model-class units due",
          state.queue.modelClassDue,
          state.queue.modelClassUnits,
          "BOUNDED_MODEL_WORKER units past their next-due, of every model-class unit registered",
          queueSource,
        ),
        queued: count(
          "model-class units registered",
          state.queue.modelClassUnits,
          state.queue.registeredUnits,
          "units registered to the model lane, of every unit the scheduler registers",
          queueSource,
        ),
        dispatchedThisCycle: count(
          "Scouts dispatched this cycle",
          state.queue.modelClassDispatchedThisCycle,
          state.queue.modelClassDue,
          "Scout dispatches in the current cycle, of the model-class units due — no per-cycle cap; Admin supplies the spend limit",
          queueSource,
        ),
        deferredForCeiling: count(
          "deferred for the ceiling",
          state.queue.modelClassDeferredForCeiling,
          state.queue.modelClassDue,
          "due model-class units held back by the rolling spend ceiling; owed, with their next-due",
          queueSource,
        ),
        deferredForCycleMax: count(
          "deferred for the cycle maximum",
          state.queue.modelClassDeferredForCycleMax,
          state.queue.modelClassDue,
          "due model-class units held back by the per-cycle dispatch bound; owed, with their next-due",
          queueSource,
        ),
        deferredForLane: count(
          "deferred for the lane",
          state.queue.modelClassDeferredForLane,
          state.queue.modelClassDue,
          "due model-class units held back because the model lane is off; owed, with their next-due",
          queueSource,
        ),
        deterministicDispatched: count(
          "deterministic units dispatched",
          state.queue.deterministicDispatchedThisCycle,
          state.queue.deterministicDue,
          "deterministic units dispatched this cycle, of those due",
          queueSource,
        ),
      })
    : stateGap();

  const running: ResearchView["running"] = state ? held(state.running) : stateGap();

  const resultsView: ResearchView["results"] = results
    ? held({
        shown: measured(
          results.latest.length,
          results.total,
          `the newest Scout results listed, of every typed Scout result the control plane holds (cap ${SCOUT_RESULTS_SHOWN})`,
          "the scoutResults log, counted at read time",
        ),
        rows: results.latest.map(scoutRowOf),
      })
    : gap("OURS", input.results.kind === "HELD" ? "no result read" : input.results.detail);

  const evidenceView: ResearchView["evidence"] =
    evidence === null
      ? gap("OURS", input.evidence.kind === "HELD" ? "no evidence read" : input.evidence.detail)
      : evidence.attempts === 0
        ? gap("OURS", "no Scout result is recorded, so there is no Scout evidence to count yet")
        : evidence.citations === 0
          ? gap(
              "OURS",
              "Scout results are recorded and none vaulted an artifact, so there is no Scout evidence to count yet",
            )
          : held({
              distinctArtifacts: measured(
                evidence.distinctArtifacts,
                evidence.citations,
                "distinct artifact ids vaulted by Scout Attempts, of every artifact citation their results carry; derived from the results, never from a scan of the artifact log",
                "artifactIds on every recorded Scout result",
              ),
              attemptsWithEvidence: measured(
                evidence.attemptsWithEvidence,
                evidence.attempts,
                "Scout Attempts that vaulted at least one artifact, of every recorded Scout Attempt",
                "the scoutResults log, counted at read time",
              ),
            });

  /*
   * The counts are BY LIFECYCLE STATE (`candidateCounts`): `proposed` is what
   * is still PROPOSED, not the total offered. Measured live 2026-09-02: seven
   * candidates stood VALIDATED with zero still PROPOSED, and a denominator of
   * `proposed` rendered them as "no method candidate proposed yet". The total
   * every candidate was offered against is the sum of the four states.
   */
  const mc = state?.methodCandidates ?? null;
  const mcTotal = mc === null ? 0 : mc.proposed + mc.validated + mc.admitted + mc.rejected;
  const methodCandidates: ResearchView["methodCandidates"] = !state
    ? stateGap()
    : mc === null
      ? gap("OURS", "the last cycle did not report method-candidate counts")
      : mcTotal === 0
        ? gap("OURS", "the last cycle reports no method candidate offered yet")
        : held({
            validated: count(
              "method candidates validated",
              mc.validated,
              mcTotal,
              "method candidates that passed validation (awaiting a session's admission), of every candidate a Scout has offered",
              "the last research state's methodCandidates, summed over its four lifecycle states",
            ),
            admitted: count(
              "method candidates admitted",
              mc.admitted,
              mcTotal,
              "method candidates admitted to the method store by a session, of every candidate a Scout has offered",
              "the last research state's methodCandidates, summed over its four lifecycle states",
            ),
            rejected: count(
              "method candidates rejected",
              mc.rejected,
              mcTotal,
              "method candidates the validators refused, of every candidate a Scout has offered",
              "the last research state's methodCandidates, summed over its four lifecycle states",
            ),
          });

  const intentRows = intentLog ? intentRowsOf(intentLog) : null;
  const intents: ResearchView["intents"] = intentRows
    ? held({
        shown: measured(
          Math.min(intentRows.length, INTENTS_SHOWN),
          intentRows.length,
          `the newest owner intents listed, of every INTENT record in the log (cap ${INTENTS_SHOWN})`,
          "INTENT records in the researchIntents log, counted at read time",
        ),
        rows: intentRows.slice(0, INTENTS_SHOWN),
      })
    : gap("OURS", input.intents.kind === "HELD" ? "no intent read" : input.intents.detail);

  const paused = readIntents(intentLog ?? []).paused || state?.pausedByOwner === true;

  const supervisionCondition = reading.conditions.find((c) => c.name.startsWith("host supervision")) ?? null;
  const supervision: ResearchView["supervision"] = !state
    ? stateGap()
    : state.hostSupervision === undefined || state.hostSupervision === null
      ? gap("OURS", "the last cycle carried no host supervision reading; a parent relaunch has not been proven to this page (RULING 246)")
      : held({ ...state.hostSupervision, condition: supervisionCondition });
  const ordering: ResearchView["ordering"] = !state
    ? stateGap()
    : state.dispatchOrdering === undefined || state.dispatchOrdering === null
      ? gap("OURS", "the last cycle recorded no dispatch ordering: no model-class work was due, or the cycle predates the reader-impact order")
      : held(state.dispatchOrdering);
  const metrics: ResearchView["metrics"] = !state
    ? stateGap()
    : state.metrics === undefined || state.metrics === null
      ? gap("OURS", "the last cycle recorded no research metrics; the numbers exist only once a cycle computes them")
      : held({ record: state.metrics, rows: researchDigestRows(state.metrics) });

  const safety: ResearchView["safety"] = !state
    ? stateGap()
    : state.fleetSafety === undefined || state.fleetSafety === null
      ? gap(
          "OURS",
          "the last cycle recorded no Fleet safety snapshot, so this page cannot say what stopped work early; the cycle that wrote this state predates the field",
        )
      : held(state.fleetSafety);

  return {
    nowIso: input.nowIso,
    verdict,
    reasons,
    reading,
    storeNotes,
    runner: {
      state: liveness.state,
      detail: liveness.detail,
      note: noteOf(input.heartbeat),
      standing: runnerStanding(heartbeat, intentLog ?? [], input.nowIso, state?.fleetSafety ?? null),
      host: heartbeat?.host ?? state?.host ?? null,
      lastBeatAt: heartbeat?.beatAt ?? null,
      lastCycleStartedAt: heartbeat?.lastCycleStartedAt ?? state?.cycleStartedAt ?? null,
      lastCycleFinishedAt: heartbeat?.lastCycleFinishedAt ?? state?.cycleFinishedAt ?? null,
      nextCycleDueAt: heartbeat?.nextCycleDueAt ?? null,
      testedSha: heartbeat?.testedSha ?? state?.testedSha ?? null,
    },
    safety,
    cycle,
    workerCredential,
    bounds,
    boundsSource,
    concurrency,
    spend: spendView,
    queue,
    running,
    results: resultsView,
    evidence: evidenceView,
    methodCandidates,
    intents,
    pauseAction: paused ? "RESUME" : "PAUSE",
    supervision,
    ordering,
    metrics,
  };
}

/* ------------------------------------------------------------- the audit */

/** Every number the page is about to emit, for `auditRenderedNumbers`. */
export function renderedNumbersOf(view: ResearchView): RenderedNumber[] {
  // A panel that is not held contributes no number; the sentence is never rendered.
  const none: Held<Measured> = gap("OURS", "this panel holds no number to audit");
  const q = view.queue.held ? view.queue.value : null;
  const mc = view.methodCandidates.held ? view.methodCandidates.value : null;
  const candidates: readonly (readonly [string, Held<Measured>])[] = [
    ["Scouts running", view.concurrency],
    ["Scout spend in window", view.spend.windowUsd],
    ["measured Scout Attempts", view.spend.measuredAttempts],
    ["unmeasured Scout Attempts", view.spend.unmeasuredAttempts],
    ["model-class units due", q?.due ?? none],
    ["model-class units registered", q?.queued ?? none],
    ["Scouts dispatched this cycle", q?.dispatchedThisCycle ?? none],
    ["deferred for the ceiling", q?.deferredForCeiling ?? none],
    ["deferred for the cycle maximum", q?.deferredForCycleMax ?? none],
    ["deferred for the lane", q?.deferredForLane ?? none],
    ["deterministic units dispatched", q?.deterministicDispatched ?? none],
    ["Scout results shown", view.results.held ? held(view.results.value.shown) : none],
    [
      "distinct Scout artifacts",
      view.evidence.held ? held(view.evidence.value.distinctArtifacts) : none,
    ],
    [
      "Scout Attempts with evidence",
      view.evidence.held ? held(view.evidence.value.attemptsWithEvidence) : none,
    ],
    ["method candidates validated", mc?.validated ?? none],
    ["method candidates admitted", mc?.admitted ?? none],
    ["method candidates rejected", mc?.rejected ?? none],
    ["intents shown", view.intents.held ? held(view.intents.value.shown) : none],
  ];
  // A gap is not a number; only what will actually be printed as one is audited.
  return candidates.flatMap(([label, m]) =>
    m.held
      ? [{ label, value: m.value.value, denominator: m.value.denominator, contract: m.value.contract }]
      : [],
  );
}

/** Every stated N against the rows that exist to render it, for `checkStatedEqualsRendered`. */
export function countClaimsOf(view: ResearchView): CountClaim[] {
  const claims: CountClaim[] = [];
  if (view.results.held) {
    claims.push({
      label: "Scout results shown",
      stated: view.results.value.shown.value,
      rendered: view.results.value.rows.length,
    });
  }
  if (view.intents.held) {
    claims.push({
      label: "intents shown",
      stated: view.intents.value.shown.value,
      rendered: view.intents.value.rows.length,
    });
  }
  if (view.running.held && view.concurrency.held) {
    claims.push({
      label: "Scouts running",
      stated: view.concurrency.value.value,
      rendered: view.running.value.length,
    });
  }
  return claims;
}
