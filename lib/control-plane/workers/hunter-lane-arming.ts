/**
 * **THE STANDING HUNTER LANE'S GUARDS (CH-24 part 2, Proposal A).**
 *
 * With WTP_CONTINUOUS_HUNTERS=1 the research round plans and queues work and
 * admits no paid work; one standing lane in the parent runner leases the
 * queued tasks and is the one process that admits paid model requests. It
 * holds every request to the same guards the round built (paid-work-guards.ts):
 *
 * - **Owner controls, read live on every refresh:** the intent log (research
 *   PAUSE, PAUSE_RUNNER, every DISPATCH budget), the Admin config row (the
 *   spend dial), the canonical cost ledger and the durable spend holds. Any of
 *   them unreadable closes paid work by name, exactly as the round does
 *   (`modelLaneClosure`); free work is not this lane's.
 * - **The round's budget reading, from a host-local file:** which Sends and
 *   areas exist, their spend at the round's read, and who belongs to each area.
 *   Reading those needs the whole corpus (every obligation, the territory), so
 *   the round writes them once per round (`laneArmingOf`) and the lane reads
 *   them. A reading older than `HUNTER_LANE_ARMING_MAX_AGE_MS`, or missing, or
 *   unreadable holds paid work by name. The Send and area lines carry the
 *   reading's time, so the durable holds add everything settled after it
 *   (`committedUsd`); the age bound keeps that inside the ledger's retention.
 * - **Each task's own marks:** the lane reads the obligation that opened the
 *   task and builds its Send lines from that record. A mark naming a Send the
 *   reading does not know (a Send newer than the reading) holds the work by
 *   name until the next round's reading, never runs it unbudgeted.
 * - **The Fleet ceiling across refreshes:** each refresh builds a new Fleet
 *   controller from the ledger. The lane's own requests are counted from its
 *   own book (`LaneOwnSpend`), not the ledger, until the book drops them a day
 *   later: an in-flight request at its worst case, a measured one at what it
 *   cost. So a request a worker has sent but not yet written to the ledger is
 *   never lost between two controllers, and nothing is counted twice.
 *
 * Nothing here changes a limit. The ceiling, the Send and area budgets and the
 * per-request worst cases are the round's own.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { CostEntry } from "../cost.ts";
import type { SpendHold } from "../budget.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { FleetSafetyController, FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd, resolveRollingCeiling, type ProviderCircuit } from "../fleet-safety.ts";
import { ADMIN_CONFIG_ID, adminConfigForPaidWork, fleetSpendCeilingOverrideUsd, type AdminConfigRead } from "../gateway/admin-config.ts";
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
import { DurableSpendHolds, SendBudgetRefusal, liveSpendHolds, SETTLED_HOLD_RETENTION_MS, type BudgetLine } from "../expansion/spend-holds.ts";
import { modelLaneClosure, type ModelProviderQueue } from "../scheduler/model-lane.ts";
import { RESEARCH_BOUNDS, RESEARCH_INTENT_LOG_KEY, ceilingPermits, readIntents, researchSpendInWindow } from "../scheduler/research-policy.ts";
import type { readActivationGate } from "../promotion/activation-gate.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import type { backgroundBatchTransport } from "../model-batch.ts";
import type { ResearchIntent } from "../scheduler/research-policy.ts";
import { paidWorkGuards } from "./paid-work-guards.ts";

export const HUNTER_LANE_ARMING_FORMAT = 1;
/**
 * How old the round's budget reading may be. A settled hold stays on the
 * ledger for SETTLED_HOLD_RETENTION_MS after its cost was recorded, and a line
 * counts settled holds newer than its reading, so a reading must stay well
 * inside that retention. One hour: rounds run every few minutes, so a reading
 * this old means rounds have stopped, and paid work should wait for them.
 */
export const HUNTER_LANE_ARMING_MAX_AGE_MS = 3_600_000;
/** The lane re-reads the owner's controls and the round's reading this often (River, 2026-10-06). */
export const HUNTER_LANE_REFRESH_MS = 5 * 60_000;

if (HUNTER_LANE_ARMING_MAX_AGE_MS >= SETTLED_HOLD_RETENTION_MS) throw new Error("the lane's reading must be younger than the settled-hold retention");

/** Where the round writes its reading and the lane reads it: one host-local file, shared across staged release checkouts. */
export function hunterLaneArmingPath(root: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env.WTP_HUNTER_LANE_ARMING?.trim();
  return named ? named : join(root, ".runtime", "hunter-lane", "arming.json");
}

interface SerializedScope extends Omit<BudgetScope, "members"> {
  readonly members: readonly string[];
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
    readonly historical: readonly { readonly key: string; readonly usd: number | null }[] | null;
    /** Every Send key the round saw on any obligation, budgeted or not; a mark outside it is newer than the reading. */
    readonly knownKeys: readonly string[];
    /** Sends the round reached an obligation under whose mark it had not seen written (the fail-closed rule). */
    readonly reached: readonly (readonly [string, readonly string[]])[];
  };
  /** The area budgets, or null when no expansion scope is selected. */
  readonly areas: { readonly scopes: readonly SerializedScope[]; readonly malformedScopes: number } | null;
  /** Subjects covered by a funded hunt's lifetime allowance. */
  readonly lifetimeHuntSubjects: readonly string[];
  /** The owner's place order, for the queue. */
  readonly placeOrder: readonly string[];
  /** The provider circuits the round ended with; the lane starts from them. */
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}

/** The round's reading, from the gates it armed. */
export function laneArmingOf(input: {
  readonly readAt: string;
  readonly specs: readonly AssignmentBudgetSpec[];
  readonly historical: ReadonlyMap<string, AssignmentSpend> | null;
  readonly knownKeys: Iterable<string>;
  readonly reached: ReadonlyMap<string, readonly string[]>;
  readonly areas: { readonly scopes: readonly BudgetScope[]; readonly malformedScopes: number } | null;
  readonly lifetimeHuntSubjects: Iterable<string>;
  readonly placeOrder: readonly string[];
  readonly circuits: readonly ProviderCircuit[];
  readonly worstCaseUsd: number;
}): HunterLaneArming {
  return {
    format: HUNTER_LANE_ARMING_FORMAT,
    readAt: input.readAt,
    sends: {
      specs: input.specs,
      historical: input.historical === null ? null : [...input.historical].map(([key, spend]) => ({ key, usd: spend.usd })),
      knownKeys: [...new Set(input.knownKeys)].sort(),
      reached: [...input.reached].filter(([, keys]) => keys.length > 0),
    },
    areas: input.areas === null ? null : {
      malformedScopes: input.areas.malformedScopes,
      scopes: input.areas.scopes.map(scope => ({ ...scope, members: [...scope.members] })),
    },
    lifetimeHuntSubjects: [...new Set(input.lifetimeHuntSubjects)],
    placeOrder: input.placeOrder,
    circuits: input.circuits,
    worstCaseUsd: input.worstCaseUsd,
  };
}

/** Written whole or not at all: a reader never sees half a reading. */
export function writeLaneArming(path: string, arming: HunterLaneArming): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(arming));
  renameSync(temporary, path);
}

export type LaneArmingRead = { readonly arming: HunterLaneArming } | { readonly held: string };

/** The round's reading, or why paid work waits without it. */
export function readLaneArming(path: string, now: string): LaneArmingRead {
  let parsed: unknown;
  try { parsed = JSON.parse(readFileSync(path, "utf8")); }
  catch (error) {
    const missing = (error as NodeJS.ErrnoException)?.code === "ENOENT";
    return { held: missing ? "no research round has written its budget reading yet" : `the round's budget reading could not be read (${error instanceof Error ? error.message : String(error)})` };
  }
  const a = parsed as Partial<HunterLaneArming> | null;
  if (a === null || typeof a !== "object" || a.format !== HUNTER_LANE_ARMING_FORMAT || typeof a.readAt !== "string" || !Number.isFinite(Date.parse(a.readAt)) ||
    a.sends === undefined || !Array.isArray(a.sends.specs) || !Array.isArray(a.sends.knownKeys) || !Array.isArray(a.sends.reached) ||
    !(a.sends.historical === null || Array.isArray(a.sends.historical)) || !Array.isArray(a.lifetimeHuntSubjects) || !Array.isArray(a.placeOrder) ||
    !Array.isArray(a.circuits) || typeof a.worstCaseUsd !== "number" || !(a.areas === null || (typeof a.areas === "object" && Array.isArray(a.areas?.scopes)))) {
    return { held: "the round's budget reading is not in the expected form" };
  }
  const ageMs = Date.parse(now) - Date.parse(a.readAt);
  if (ageMs > HUNTER_LANE_ARMING_MAX_AGE_MS) {
    return { held: `the round's budget reading is ${Math.round(ageMs / 60_000)} minutes old (more than ${HUNTER_LANE_ARMING_MAX_AGE_MS / 60_000}), so no research round has read the Send and area budgets since` };
  }
  return { arming: a as HunterLaneArming };
}

/* ------------------------------------------------------------ own spend */

interface OwnRequest { readonly taskId: string; readonly at: string; usd: number; pending: boolean }

/**
 * The lane's own model requests, which every Fleet controller it builds
 * counts in place of the ledger's rows for the same tasks. A request is
 * entered before it is sent (at its worst case) and settled at what it
 * measured; an unmeasured or failed send keeps its worst case. A request
 * refused before sending leaves the book. Entries older than the rolling day
 * leave it, and so do the ledger rows they stood for (the window ends).
 */
export class LaneOwnSpend {
  private readonly requests: OwnRequest[] = [];
  private readonly windowMs: number;
  constructor(windowMs = 24 * 3_600_000) { this.windowMs = windowMs; }

  begin(taskId: string, at: string, worstCaseUsd: number): OwnRequest {
    const entry: OwnRequest = { taskId, at, usd: worstCaseUsd, pending: true };
    this.requests.push(entry);
    return entry;
  }
  settle(entry: OwnRequest, measuredUsd: number | null): void {
    entry.pending = false;
    if (measuredUsd !== null) entry.usd = measuredUsd;
  }
  unsent(entry: OwnRequest): void {
    const at = this.requests.indexOf(entry);
    if (at >= 0) this.requests.splice(at, 1);
  }
  /** Drops what has left the window, and returns the tasks the book stands for. */
  tasks(now: string): ReadonlySet<string> {
    const since = Date.parse(now) - this.windowMs;
    for (let i = this.requests.length - 1; i >= 0; i -= 1) if (Date.parse(this.requests[i].at) < since && !this.requests[i].pending) this.requests.splice(i, 1);
    return new Set(this.requests.map(r => r.taskId));
  }
  /** The book as ledger rows, so a new controller counts them the way it counts the ledger. */
  asCostEntries(): CostEntry[] {
    return this.requests.map((r, i) => ({
      attemptId: `hunter-lane:${r.taskId}:${i}`, workItemId: "hunter-lane", routeTaskId: r.taskId, routeId: null,
      source: "api.anthropic.com", jurisdiction: null, project: "hunter-lane", role: "SCOUT", recordedAt: r.at,
      cost: { inputTokens: null, outputTokens: null, usd: r.usd, durationMs: null, bytesFetched: null, requestCount: 1,
        cacheReadInputTokens: null, cacheCreationInputTokens: null, cacheCreation5mInputTokens: null, cacheCreation1hInputTokens: null },
    }) as CostEntry);
  }
  /** Every request the book still counts, in dollars. */
  usd(): number { return this.requests.reduce((n, r) => n + r.usd, 0); }
}

/* ------------------------------------------------------------ arming */

export interface HunterLaneDeps {
  readonly repos: ControlPlaneRepositories;
  readonly now: () => string;
  readonly armingPath: string;
  readonly messages: ModelTransport;
  readonly batch: ReturnType<typeof backgroundBatchTransport>;
  readonly credentialConfigured: boolean;
  readonly credentialVar: string;
  readonly activation: () => ReturnType<typeof readActivationGate>;
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
  readonly arming: HunterLaneArming | null;
  readonly spendHolds: DurableSpendHolds;
  readonly ceilingUsd: number;
}

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * One refresh: read the owner's controls and the round's reading, and build
 * the guards every paid request of the next refresh period passes. Never
 * throws: an unreadable input closes paid work and says which.
 */
export async function armHunterLane(deps: HunterLaneDeps): Promise<ArmedHunterLane> {
  const now = deps.now();
  const spendHolds = new DurableSpendHolds({ budget: deps.repos.budget, now: deps.now });
  const unreadable: string[] = [];
  let intentLog: ResearchIntent[] = [];
  let intentsReadable = true;
  try { intentLog = [...await deps.repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)]; }
  catch (error) { intentsReadable = false; unreadable.push(`the owner's research intents could not be read (${message(error)})`); }
  const intents = readIntents(intentLog);
  let configRead: AdminConfigRead;
  try { configRead = { row: await deps.repos.adminConfig.read(ADMIN_CONFIG_ID) }; }
  catch (error) { configRead = { unreadable: message(error) }; }
  const { config, holdPaidWork: configHold } = adminConfigForPaidWork(configRead);
  if (configHold !== null) unreadable.push(configHold);
  const ceilingOverride = fleetSpendCeilingOverrideUsd(config);
  const ceilingUsd = resolveRollingCeiling(ceilingOverride).rollingCeilingUsd;

  /* As the round does: the ledger first; the durable holds stand in for an unpriced charge only when the window cannot be priced without them. */
  const ownTasks = deps.ownSpend.tasks(now);
  let counted: CostEntry[] | null = null;
  let holdsCounted: SpendHold[] = [];
  let window: ReturnType<typeof researchSpendInWindow> | null = null;
  let ledgerUnreadable: string | null = null;
  try {
    const costs = await deps.repos.costs.readSince(new Date(Date.parse(now) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString());
    /* The lane's own requests count from its book, never twice. */
    counted = [...costs.filter(row => row.routeTaskId === null || !ownTasks.has(row.routeTaskId)), ...deps.ownSpend.asCostEntries()];
    window = researchSpendInWindow(counted, now, RESEARCH_BOUNDS.windowHours);
    if (window.windowUsd === null) {
      holdsCounted = Object.values(liveSpendHolds((await deps.repos.budget.read()).value.spendHolds, now));
      window = researchSpendInWindow(counted, now, RESEARCH_BOUNDS.windowHours, holdsCounted);
    }
  } catch (error) {
    counted = null;
    ledgerUnreadable = message(error);
    deps.onCondition(`the cost ledger could not be read (${ledgerUnreadable}); paid model work waits`);
  }
  const spendHold = counted === null || window === null ? `the cost ledger could not be read (${ledgerUnreadable})`
    : window.windowUsd === null ? `model spend includes ${window.unmeasured} unmeasured row(s); known model spend is $${window.knownUsd.toFixed(6)}`
      : !ceilingPermits(window.windowUsd, ceilingUsd).permits ? `the owner's $${ceilingUsd.toFixed(2)} model ceiling is reached` : null;

  const read = readLaneArming(deps.armingPath, now);
  const armingHold = "held" in read ? read.held : null;
  const closure = modelLaneClosure({
    dry: false, noModel: false, credentialConfigured: deps.credentialConfigured, credentialVar: deps.credentialVar,
    activation: deps.activation(), paused: intents.paused, pauseIntentId: intents.pauseIntentId ?? null,
    runnerPaused: intents.runnerPause.paused, runnerPauseIntentId: intents.runnerPause.intent?.intentId ?? null,
    spendHold: spendHold ?? armingHold, unreadableControls: unreadable,
  });
  const arming = "arming" in read ? read.arming : null;
  const lifetime = new Set(arming?.lifetimeHuntSubjects ?? []);
  const fleetSafety = counted === null ? null : new FleetSafetyController({
    now, costs: counted, spendHolds: holdsCounted,
    costLedgerReadable: true, paused: intents.runnerPause.paused, modelHold: closure?.reason ?? null,
    circuits: deps.circuits ?? arming?.circuits ?? [], rollingCeilingUsd: ceilingOverride,
    lifetimeHuntWork: work => lifetime.has(work),
  });
  if (closure !== null || fleetSafety === null || arming === null) {
    return { closed: closure ?? { code: "LANE_DISABLED", reason: armingHold ?? `the cost ledger could not be read (${ledgerUnreadable})` },
      armedAt: now, fleetSafety, guards: null, arming, spendHolds, ceilingUsd };
  }

  /* The Send lines: the round's Sends and history; the DISPATCH budgets the owner sent since are read from the live log. */
  const liveSpecs = assignmentBudgetsOf({ scopes: [], intents: intentLog });
  const armedKeys = new Set(arming.sends.specs.map(spec => spec.key));
  const newerSends = liveSpecs.filter(spec => !armedKeys.has(spec.key)).map(spec => spec.key);
  const known = new Set([...arming.sends.knownKeys, ...armedKeys]);
  const historical = new Map((arming.sends.historical ?? []).map(row => [row.key, { usd: row.usd } as AssignmentSpend] as const));
  const reached = new Map(arming.sends.reached);
  const malformed = malformedAssignmentBudgetsOf(intentLog);
  const gates = new Map<string, AssignmentBudgetGate | { refusal: AssignmentRefusal }>();
  const held = (why: string): { refusal: AssignmentRefusal } => ({ refusal: { admit: false, code: ASSIGNMENT_BUDGET_CODE, why } });
  const prepareObligation = async (obligationId: string): Promise<void> => {
    if (gates.has(obligationId)) return;
    let row;
    try { row = await deps.repos.obligations.read(obligationId); }
    catch (error) { gates.set(obligationId, held(`the obligation's Send record could not be read (${message(error)}); paid work waits`)); return; }
    const marks = row?.value.assignments ?? [];
    const unknown = marks.map(mark => mark.assignmentKey).find(key => !known.has(key));
    if (unknown !== undefined || marks.some(mark => newerSends.includes(mark.assignmentKey))) {
      gates.set(obligationId, held(`this work belongs to Send ${unknown ?? marks.find(mark => newerSends.includes(mark.assignmentKey))!.assignmentKey}, which is newer than the round's budget reading; paid work waits for the next round to read its budget`));
      return;
    }
    const membership = assignmentMembership(row === null ? [] : [{ id: obligationId, subjectId: row.value.subjectId, assignments: marks }]);
    gates.set(obligationId, new AssignmentBudgetGate({ specs: arming.sends.specs, membership, historical,
      worstCaseUsd: arming.worstCaseUsd, costsReadable: arming.sends.historical !== null, intentsReadable,
      malformed, reachedThisCycle: reached, historyReadAt: arming.readAt }));
  };
  const assignmentBudget = {
    linesFor(obligationId: string): { readonly lines: readonly BudgetLine[] } | { readonly refusal: AssignmentRefusal } {
      const gate = gates.get(obligationId);
      if (gate === undefined) return held("the obligation's Send record was not read before its request; paid work waits");
      return "refusal" in gate ? { refusal: gate.refusal } : gate.linesFor(obligationId);
    },
  };
  const expansionBudget = arming.areas === null ? null : { gate: new ScopeBudgetGate({
    scopes: arming.areas.scopes.map(scope => ({ ...scope, members: new Set(scope.members) })),
    worstCaseUsd: arming.worstCaseUsd, malformedScopes: arming.areas.malformedScopes, historyReadAt: arming.readAt }) };
  const guards = paidWorkGuards({ repos: deps.repos, now: deps.now, armedAt: now, fleetSafety, providerQueue: deps.providerQueue,
    spendHolds, assignmentBudget, expansionBudget, beforeObligation: prepareObligation,
    messages: deps.messages, batch: deps.batch, modelLaneEnabled: true, ceilingUsd: () => ceilingUsd,
    ...(deps.requestsPerMinute === undefined ? {} : { requestsPerMinute: deps.requestsPerMinute }),
    onCondition: deps.onCondition });
  return { closed: null, armedAt: now, fleetSafety, guards, arming, spendHolds, ceilingUsd };
}

/**
 * A worker's paid request through the lane: entered in the lane's own book
 * before it is sent, then passed to the guards armed for this refresh. A
 * refusal before sending leaves the book; a sent request keeps its worst case
 * until it measures.
 */
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
