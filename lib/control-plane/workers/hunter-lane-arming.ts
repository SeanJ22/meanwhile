import { closeSync, fstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CostEntry } from "../cost.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { FleetSafetyController, FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd, pricedModelCharge, resolveRollingCeiling, operationalNightAt, type FleetSpend, type PricedSpendTotals, type ProviderCircuit } from "../fleet-safety.ts";
import { readModelSpendTotals } from "../spend-window.ts";
import { ADMIN_CONFIG_ID, adminConfigForPaidWork, discoverySearchEnabled, fleetSpendCeilingOverrideUsd, type AdminConfigRead } from "../gateway/admin-config.ts";
import {
  ASSIGNMENT_BUDGET_CODE,
  AssignmentBudgetGate,
  assignmentBudgetsOf,
  assignmentMembership,
  malformedAssignmentBudgetsOf,
  type AssignmentBudgetSpec,
  type AssignmentRefusal,
  type AssignmentSpend,
} from "../expansion/assignment-budget.ts";
import { ScopeBudgetGate, type BudgetScope } from "../expansion/membership.ts";
import { DurableSpendHolds, SendBudgetRefusal, SETTLED_HOLD_RETENTION_MS } from "../expansion/spend-holds.ts";
import { modelLaneClosure, type ModelProviderQueue } from "../scheduler/model-lane.ts";
import { RESEARCH_BOUNDS, RESEARCH_INTENT_LOG_KEY, ceilingPermits, readIntents } from "../scheduler/research-policy.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import type { backgroundBatchTransport } from "../model-batch.ts";
import type { ResearchIntent } from "../scheduler/research-policy.ts";
import { paidWorkGuards } from "./paid-work-guards.ts";

import { armingIndex, HUNTER_LANE_ARMING_FORMAT, type ArmingIndexHeader, type HunterLaneArmingIndex } from "./hunter-lane-arming-index.ts";
export { HUNTER_LANE_ARMING_FORMAT };
/** How old the round's budget reading may be: well inside SETTLED_HOLD_RETENTION_MS, since a line counts settled holds newer than its reading. */
export const HUNTER_LANE_ARMING_MAX_AGE_MS = 3_600_000;
/** The lane re-reads the owner's controls and the round's reading this often. */
export const HUNTER_LANE_REFRESH_MS = 5 * 60_000;

if (HUNTER_LANE_ARMING_MAX_AGE_MS >= SETTLED_HOLD_RETENTION_MS) throw new Error("the lane's reading must be younger than the settled-hold retention");

/** Where the round writes its reading and the lane reads it: one host-local file, shared across staged release checkouts. */
export function hunterLaneArmingPath(root: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env.WTP_HUNTER_LANE_ARMING?.trim();
  return named ? named : join(root, ".runtime", "hunter-lane", "arming.json");
}

interface ArmingScope extends Omit<BudgetScope, "members"> {
  readonly members: Iterable<string>;
}

/** What the round read that the lane cannot read cheaply. Written once per round. */
export interface HunterLaneArming {
  readonly format: typeof HUNTER_LANE_ARMING_FORMAT;
  /** The round's instant: when the Send and area history was read. */
  readonly readAt: string;
  readonly sends: {
    /** Every budgeted Send the round armed, SCOPE and DISPATCH. */
    readonly specs: readonly AssignmentBudgetSpec[];
    /** Each Send's spend at `readAt`; null when a charge on it reported no dollar figure. Absent: the ledger was unreadable. */
    readonly historical: Iterable<readonly [string, AssignmentSpend]> | null;
    /** Every Send key the round saw on any obligation, budgeted or not; a mark outside it is newer than the reading. */
    readonly knownKeys: Iterable<string>;
    /** Sends the round reached an obligation under whose mark it had not seen written (the fail-closed rule). */
    readonly reached: Iterable<readonly [string, readonly string[]]>;
  };
  /** The area budgets, or null when no expansion scope is selected. */
  readonly areas: { readonly scopes: readonly ArmingScope[]; readonly malformedScopes: number } | null;
  /** Subjects covered by a funded hunt's lifetime allowance. */
  readonly lifetimeHuntSubjects: Iterable<string>;
  /** The provider circuits the round ended with; the lane starts from them. */
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}

/** The round's reading, from the gates it armed. */
export function laneArmingOf(input: {
  readonly readAt: string;
  readonly specs: readonly AssignmentBudgetSpec[];
  readonly historical: Iterable<readonly [string, AssignmentSpend]> | null;
  readonly knownKeys: Iterable<string>;
  readonly reached: Iterable<readonly [string, readonly string[]]>;
  readonly areas: { readonly scopes: readonly ArmingScope[]; readonly malformedScopes: number } | null;
  readonly lifetimeHuntSubjects: Iterable<string>;
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}): HunterLaneArming {
  return {
    format: HUNTER_LANE_ARMING_FORMAT,
    readAt: input.readAt,
    sends: {
      specs: input.specs,
      historical: input.historical,
      knownKeys: input.knownKeys,
      reached: input.reached,
    },
    areas: input.areas,
    lifetimeHuntSubjects: input.lifetimeHuntSubjects,
    circuits: input.circuits,
    worstCaseUsd: input.worstCaseUsd,
  };
}

export type LaneArmingRead = { readonly arming: HunterLaneArmingIndex } | { readonly held: string };

export function readLaneArming(path: string, now: string): LaneArmingRead {
  let parsed: unknown;
  try {
    const descriptor = openSync(path, "r");
    try {
      if (fstatSync(descriptor).size > 64 * 1024) throw new Error("Arming header exceeds its bounded size.");
      parsed = JSON.parse(readFileSync(descriptor, "utf8"));
    } finally { closeSync(descriptor); }
  }
  catch (error) {
    return { held: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "no research round has written its budget reading yet"
      : "the round's budget reading is not in the expected form" };
  }
  const a = parsed as Partial<ArmingIndexHeader> | null;
  if (!a || a.format !== HUNTER_LANE_ARMING_FORMAT || typeof a.readAt !== "string" || !Number.isFinite(Date.parse(a.readAt)) ||
    typeof a.indexFile !== "string" || typeof a.costsReadable !== "boolean" || !Array.isArray(a.circuits) ||
    typeof a.worstCaseUsd !== "number" || !Number.isFinite(a.worstCaseUsd) ||
    !(a.areas === null || a.areas && Number.isSafeInteger(a.areas.malformedScopes) && typeof a.areas.hasSelectedHunts === "boolean")) {
    return { held: "the round's budget reading is not in the expected form" };
  }
  const ageMs = Date.parse(now) - Date.parse(a.readAt);
  if (ageMs > HUNTER_LANE_ARMING_MAX_AGE_MS) return { held: `the round's budget reading is ${Math.round(ageMs / 60_000)} minutes old (more than ${HUNTER_LANE_ARMING_MAX_AGE_MS / 60_000}), so no research round has read the Send and area budgets since` };
  try { return { arming: armingIndex(path, a as ArmingIndexHeader) }; }
  catch (error) { return { held: `the round's budget index could not be read (${message(error)})` }; }
}

interface OwnRequest { readonly taskId: string; readonly at: string; usd: number; pending: boolean; completed: boolean; measured: boolean; bucket: number | null; active: boolean }
interface UnacknowledgedSpend { usd: number; knownUsd: number; measured: number; unmeasured: number; worstCaseCharges: number }

export class LaneOwnSpend {
  private readonly requests = new Set<OwnRequest>();
  private readonly unacknowledged = new Map<number, UnacknowledgedSpend>();
  private readonly windowMs: number;
  constructor(windowMs = 24 * 3_600_000) { this.windowMs = windowMs; }

  begin(taskId: string, at: string, worstCaseUsd: number): OwnRequest {
    const entry: OwnRequest = { taskId, at, usd: worstCaseUsd, pending: true, completed: false, measured: false, bucket: null, active: true };
    this.requests.add(entry);
    return entry;
  }
  settle(entry: OwnRequest, measuredUsd: number | null): void {
    entry.pending = false;
    entry.measured = measuredUsd !== null;
    if (measuredUsd !== null) entry.usd = measuredUsd;
    if (entry.completed) this.compact(entry);
  }
  private compact(entry: OwnRequest): void {
    if (!entry.active || entry.bucket !== null) return;
    // Round upward so compacted unknown charges can expire at most one second late, never early.
    const second = Math.ceil(Date.parse(entry.at) / 1_000) * 1_000;
    const total = this.unacknowledged.get(second) ?? { usd: 0, knownUsd: 0, measured: 0, unmeasured: 0, worstCaseCharges: 0 };
    total.usd += entry.usd;
    total.knownUsd += entry.measured ? entry.usd : 0;
    total.measured += Number(entry.measured);
    total.unmeasured += Number(!entry.measured);
    total.worstCaseCharges += Number(!entry.measured);
    this.unacknowledged.set(second, total);
    entry.bucket = second;
    this.requests.delete(entry);
  }
  unsent(entry: OwnRequest): void {
    if (!entry.active) return;
    entry.active = false;
    this.requests.delete(entry);
    if (entry.bucket === null) return;
    const total = this.unacknowledged.get(entry.bucket);
    if (!total) return;
    total.usd -= entry.usd;
    total.knownUsd -= entry.measured ? entry.usd : 0;
    total.measured -= Number(entry.measured);
    total.unmeasured -= Number(!entry.measured);
    total.worstCaseCharges -= Number(!entry.measured);
    if (total.measured + total.unmeasured === 0) this.unacknowledged.delete(entry.bucket);
  }
  recorded(entry: OwnRequest): void { this.unsent(entry); }
  recordedCost(entry: CostEntry): void {
    if (entry.routeTaskId === null) return;
    const charge = pricedModelCharge(entry, entry.attemptId);
    if (charge === null) return;
    const requests = [...this.requests].filter(row => row.taskId === entry.routeTaskId && !row.pending && row.at <= entry.recordedAt);
    const count = entry.cost.modelRequestCount ?? entry.cost.requestCount;
    if (requests.length !== count || Math.abs(requests.reduce((total, row) => total + row.usd, 0) - charge.usd) > 1e-9) return;
    for (const request of requests) this.recorded(request);
  }
  finished(taskId: string): void {
    for (const entry of this.requests) if (entry.taskId === taskId) {
      entry.completed = true;
      if (!entry.pending) this.compact(entry);
    }
  }
  totals(since: string, until: string): PricedSpendTotals {
    const low = Date.parse(since), high = Date.parse(until);
    const total: UnacknowledgedSpend = { usd: 0, knownUsd: 0, measured: 0, unmeasured: 0, worstCaseCharges: 0 };
    for (const [at, bucket] of this.unacknowledged) {
      if (at < high - this.windowMs) { this.unacknowledged.delete(at); continue; }
      if (at < low || at - 999 > high) continue;
      for (const field of ["usd", "knownUsd", "measured", "unmeasured", "worstCaseCharges"] as const) total[field] += bucket[field];
    }
    for (const row of this.requests) if (Date.parse(row.at) >= low && Date.parse(row.at) <= high) {
      total.usd += row.usd; total.knownUsd += row.measured ? row.usd : 0;
      total.measured += Number(row.measured); total.unmeasured += Number(!row.measured); total.worstCaseCharges += Number(!row.measured);
    }
    return total;
  }
  usd(): number { return [...this.requests].reduce((n, r) => n + r.usd, 0) + [...this.unacknowledged.values()].reduce((n, r) => n + r.usd, 0); }
}

export interface HunterLaneDeps {
  readonly repos: ControlPlaneRepositories;
  readonly now: () => string;
  readonly armingPath: string;
  readonly messages: ModelTransport;
  readonly batch: ReturnType<typeof backgroundBatchTransport>;
  readonly credentialConfigured: boolean;
  readonly credentialVar: string;
  readonly providerQueue: ModelProviderQueue;
  readonly ownSpend: LaneOwnSpend;
  /** The circuits the previous controller ended with; the lane's own latches outlive a refresh. */
  readonly circuits: readonly ProviderCircuit[] | null;
  readonly requestsPerMinute?: number;
  readonly onCondition: (sentence: string) => void;
}

export interface ArmedHunterLane {
  /** Null while paid work may run; otherwise the sentence that holds it. Free work is never this lane's. */
  readonly closed: { readonly code: string; readonly reason: string } | null;
  readonly armedAt: string;
  readonly fleetSafety: FleetSafetyController | null;
  readonly guards: ReturnType<typeof paidWorkGuards> | null;
  readonly arming: HunterLaneArmingIndex | null;
  readonly spendHolds: DurableSpendHolds;
  readonly ceilingUsd: number;
  /** The owner's paid-search switch, read from the same row (off when the row cannot be trusted). */
  readonly discoverySearchOn: boolean;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

export async function armHunterLane(deps: HunterLaneDeps): Promise<ArmedHunterLane> {
  const now = deps.now();
  const spendHolds = new DurableSpendHolds({ store: deps.repos.spendHolds, now: deps.now });
  const unreadable: string[] = [];
  let intentLog: ResearchIntent[] = [];
  let intentsReadable = true;
  const intentFields = { kind: true, intentId: true, action: true, requestedAt: true, note: true, budgetUsd: true } as const;
  try {
    const controls = await Promise.all([["PAUSE", "RESUME"], ["PAUSE_RUNNER", "RESUME_RUNNER"]].map(actions =>
      deps.repos.researchIntents.readRecentWhere(RESEARCH_INTENT_LOG_KEY, ["action"], actions, 1, intentFields, undefined, { kind: "INTENT" }, "requestedAt")));
    intentLog = controls.flat() as ResearchIntent[];
  } catch (error) { intentsReadable = false; unreadable.push(`the owner's research intents could not be read (${message(error)})`); }
  const intents = readIntents(intentLog);
  let configRead: AdminConfigRead;
  try { configRead = { row: await deps.repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { apiFallback: true, fleetSpendCeiling: true, discoverySearch: true }) }; }
  catch (error) { configRead = { unreadable: message(error) }; }
  const { config, holdPaidWork: configHold } = adminConfigForPaidWork(configRead);
  if (configHold !== null) unreadable.push(configHold);
  const ceilingOverride = fleetSpendCeilingOverrideUsd(config);
  const ceilingUsd = resolveRollingCeiling(ceilingOverride).rollingCeilingUsd;
  const discoverySearchOn = configHold === null && discoverySearchEnabled(config);

  let counted: FleetSpend | null = null;
  let ledgerUnreadable: string | null = null;
  try {
    const total = async (since: string): Promise<PricedSpendTotals> => {
      const held = await readModelSpendTotals(deps.repos, { since, until: now }), own = deps.ownSpend.totals(since, now);
      return { usd: held.usd + own.usd, knownUsd: held.knownUsd + own.knownUsd, measured: held.measured + own.measured,
        unmeasured: held.unmeasured + own.unmeasured, worstCaseCharges: held.worstCaseCharges + own.worstCaseCharges };
    };
    const [rolling, night] = await Promise.all([total(new Date(Date.parse(now) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString()), total(operationalNightAt(now).start)]);
    counted = { rolling, night };
  } catch (error) {
    ledgerUnreadable = message(error);
    deps.onCondition(`the cost ledger could not be read (${ledgerUnreadable}); paid model work waits`);
  }
  const spendHold = counted === null ? `the cost ledger could not be read (${ledgerUnreadable})`
    : !ceilingPermits(counted.rolling.usd, ceilingUsd).permits ? `the owner's $${ceilingUsd.toFixed(2)} model ceiling is reached` : null;

  const read = readLaneArming(deps.armingPath, now);
  const armingHold = "held" in read ? read.held : null;
  const closure = modelLaneClosure({
    dry: false, noModel: false, credentialConfigured: deps.credentialConfigured, credentialVar: deps.credentialVar,
    paused: intents.paused, pauseIntentId: intents.pauseIntentId ?? null,
    runnerPaused: intents.runnerPause.paused, runnerPauseIntentId: intents.runnerPause.intent?.intentId ?? null,
    spendHold: spendHold ?? armingHold, unreadableControls: unreadable,
  });
  const arming = "arming" in read ? read.arming : null;
  const fleetSafety = counted === null ? null : new FleetSafetyController({
    now, spend: counted,
    costLedgerReadable: true, paused: intents.runnerPause.paused, modelHold: closure?.reason ?? null,
    circuits: deps.circuits ?? arming?.circuits ?? [], rollingCeilingUsd: ceilingOverride,
    lifetimeHuntWork: work => arming?.lifetimeSubject(work) ?? false,
  });
  if (closure !== null || fleetSafety === null || arming === null) {
    return { closed: closure ?? { code: "LANE_DISABLED", reason: armingHold ?? `the cost ledger could not be read (${ledgerUnreadable})` },
      armedAt: now, fleetSafety, guards: null, arming, spendHolds, ceilingUsd, discoverySearchOn };
  }

  const held = (why: string): { refusal: AssignmentRefusal } => ({ refusal: { admit: false, code: ASSIGNMENT_BUDGET_CODE, why } });
  const prepareObligation = async (obligationId: string): Promise<ReturnType<AssignmentBudgetGate["linesFor"]>> => {
    try {
      const row = await deps.repos.obligations.read(obligationId), marks = row?.value.assignments ?? [];
      const reached = arming.reached(obligationId), keys = [...new Set([...marks.map(mark => mark.assignmentKey), ...reached])];
      const specs: AssignmentBudgetSpec[] = [], historical = new Map<string, AssignmentSpend>(), live: ResearchIntent[] = [];
      for (const key of keys) {
        const saved = arming.assignment(key);
        if (!saved.known && marks.some(mark => mark.assignmentKey === key)) return held(`this work belongs to Send ${key}, which is newer than the round's budget reading; paid work waits for the next round to read its budget`);
        if (saved.spec) specs.push(saved.spec);
        historical.set(key, { usd: saved.usd } as AssignmentSpend);
        if (key.startsWith("dispatch:")) {
          const intent = await deps.repos.researchIntents.readRecentWhere(RESEARCH_INTENT_LOG_KEY, ["intentId"], key.slice(9), 1, intentFields, undefined, { kind: "INTENT" });
          live.push(...intent as ResearchIntent[]);
        }
      }
      if (assignmentBudgetsOf({ scopes: [], intents: live }).some(spec => !specs.some(saved => saved.key === spec.key))) return held("This work's Send budget is newer than the round's reading; paid work waits for its budget.");
      const membership = assignmentMembership(row === null ? [] : [{ id: obligationId, subjectId: row.value.subjectId, assignments: marks }]);
      return new AssignmentBudgetGate({ specs, membership, historical, worstCaseUsd: arming.worstCaseUsd,
        costsReadable: arming.costsReadable, intentsReadable, malformed: malformedAssignmentBudgetsOf(live),
        reachedThisCycle: new Map([[obligationId, reached]]), historyReadAt: arming.readAt }).linesFor(obligationId);
    } catch (error) { return held(`the obligation's Send record could not be read (${message(error)}); paid work waits`); }
  };
  const assignmentBudget = { linesFor: () => held("the obligation's Send record was not read before its request; paid work waits") };
  const expansionBudget = arming.areas === null ? null : { gate: { linesFor: (subjectId: string, state?: string | null): ReturnType<ScopeBudgetGate["linesFor"]> => {
    try { return new ScopeBudgetGate({ scopes: arming.scopesFor(subjectId, state), worstCaseUsd: arming.worstCaseUsd,
      malformedScopes: arming.areas!.malformedScopes, hasSelectedHunts: arming.areas!.hasSelectedHunts, historyReadAt: arming.readAt }).linesFor(subjectId, state); }
    catch (error) { return { refusal: { admit: false, code: "SCOPE_BUDGET", why: `The area's budget could not be read (${message(error)}); paid work waits.` } }; }
  } } };
  const guards = paidWorkGuards({ repos: deps.repos, now: deps.now, armedAt: now, fleetSafety, providerQueue: deps.providerQueue,
    spendHolds, assignmentBudget, expansionBudget, beforeObligation: prepareObligation,
    messages: deps.messages, batch: deps.batch, modelLaneEnabled: true, ceilingUsd: () => ceilingUsd,
    ...(deps.requestsPerMinute === undefined ? {} : { requestsPerMinute: deps.requestsPerMinute }),
    onCondition: deps.onCondition });
  return { closed: null, armedAt: now, fleetSafety, guards, arming, spendHolds, ceilingUsd, discoverySearchOn };
}

export function laneWorkerTransport(lane: () => ArmedHunterLane, ownSpend: LaneOwnSpend, now: () => string) {
  return (jurisdiction: Parameters<ReturnType<typeof paidWorkGuards>["workerTransportFor"]>[0], taskId: string): ModelTransport => async request => {
    const armed = lane();
    if (armed.guards === null) throw new SendBudgetRefusal(armed.closed?.code ?? "LANE_DISABLED", armed.closed?.reason ?? "the hunter lane is not armed");
    const worst = modelRequestWorstCaseUsd(request);
    const entry = ownSpend.begin(taskId, now(), worst ?? 0);
    try {
      const response = await armed.guards.workerTransportFor(jurisdiction, taskId)(request);
      ownSpend.settle(entry, modelResponseUsd(response));
      return response;
    } catch (error) {
      if (error instanceof FleetPreSendRefusal || error instanceof SendBudgetRefusal) ownSpend.unsent(entry);
      else ownSpend.settle(entry, null);
      throw error;
    }
  };
}
