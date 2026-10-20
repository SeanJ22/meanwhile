import { readRuntimeAdminConfig } from "../runtime-admin-config.ts";
/**
 * The standing hunter lane's guards. One standing lane admits paid model requests and holds each to the round's
 * own guards: the owner's controls read live every refresh (any unreadable one closes paid work by name), the
 * round's budget reading from a host-local file (missing, stale or unreadable holds paid work), each task's own
 * Send marks (an unknown Send waits for the next reading), and the Fleet ceiling, with the lane's own requests
 * counted from its own book so none is lost or counted twice between controllers. Nothing here changes a limit.
 */
import { ZERO_COST } from "../attempt.ts";
import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { temporaryPath } from "../../civic-data/temporary-path.ts";
import { dirname, join } from "node:path";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { FleetSafetyController, FleetPreSendRefusal, modelRequestWorstCaseUsd, modelResponseUsd, resolveRollingCeiling, type PricedCharge, type ProviderCircuit } from "../fleet-safety.ts";
import { readSpendWindow } from "../spend-window.ts";
import { adminConfigForPaidWork, discoverySearchEnabled, fleetSpendCeilingOverrideUsd, type AdminConfigRead } from "../gateway/admin-config.ts";
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
import { ScopeBudgetGate, type BudgetScope, type IndexedMembership } from "../expansion/membership.ts";
import { DurableSpendHolds, SendBudgetRefusal, SETTLED_HOLD_RETENTION_MS, type BudgetLine } from "../expansion/spend-holds.ts";
import { modelLaneClosure, type ModelProviderQueue } from "../scheduler/model-lane.ts";
import { RESEARCH_BOUNDS, RESEARCH_INTENT_LOG_KEY, ceilingPermits, readIntents, researchSpendInWindow } from "../scheduler/research-policy.ts";
import type { ModelTransport } from "../scheduler/scout-executor.ts";
import type { backgroundBatchTransport } from "../model-batch.ts";
import type { ResearchIntent } from "../scheduler/research-policy.ts";
import { paidWorkGuards } from "./paid-work-guards.ts";

export const HUNTER_LANE_ARMING_FORMAT = 2;
const openArmingSnapshots = new Set<() => void>();
process.once("exit", () => { for (const close of openArmingSnapshots) close(); });
/** How old the round's budget reading may be: well inside SETTLED_HOLD_RETENTION_MS, since a line counts settled holds newer than its reading. */
export const HUNTER_LANE_ARMING_MAX_AGE_MS = 3_600_000;
/** The lane re-reads the owner's controls and the round's reading this often. */
export const HUNTER_LANE_REFRESH_MS = 5 * 60_000;

if (HUNTER_LANE_ARMING_MAX_AGE_MS >= SETTLED_HOLD_RETENTION_MS) throw new Error("the lane's reading must be younger than the settled-hold retention");

/** Where the round writes its reading and the lane reads it: one host-local file, shared across staged release checkouts. */
export function hunterLaneArmingPath(root: string, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const named = env.WTP_HUNTER_LANE_ARMING?.trim();
  return named ? named : join(root, ".runtime", "hunter-lane", "arming.sqlite");
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
    readonly knownKeys: Iterable<string>;
    /** Sends the round reached an obligation under whose mark it had not seen written (the fail-closed rule). */
    readonly reached: ReadonlyMap<string, readonly string[]>;
  };
  /** The area budgets, or null when no expansion scope is selected. */
  readonly areas: { readonly scopes: readonly BudgetScope[]; readonly malformedScopes: number } | null;
  /** Subjects covered by a funded hunt's lifetime allowance. */
  readonly lifetimeHuntSubjects: Iterable<string>;
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
      knownKeys: input.knownKeys,
      reached: input.reached,
    },
    areas: input.areas,
    lifetimeHuntSubjects: input.lifetimeHuntSubjects,
    placeOrder: input.placeOrder,
    circuits: input.circuits,
    worstCaseUsd: input.worstCaseUsd,
  };
}

export interface HunterLaneArmingSnapshot extends Omit<HunterLaneArming, "sends" | "lifetimeHuntSubjects"> {
  readonly sends: Omit<HunterLaneArming["sends"], "knownKeys"> & { readonly knownKeys: IndexedMembership };
  readonly lifetimeHuntSubjects: IndexedMembership;
  /** A request can finish against its original reading after the lane re-arms. */
  readonly retain: () => () => void;
  readonly close: () => void;
}

/** Written whole or not at all; memberships stream to disk without a country-sized serialization. */
export function writeLaneArming(path: string, arming: HunterLaneArming): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  rmSync(temporary, { force: true });
  const db = new DatabaseSync(temporary);
  try {
    db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA cache_size=-1024; PRAGMA mmap_size=0; CREATE TABLE metadata(body TEXT NOT NULL); CREATE TABLE known(value TEXT PRIMARY KEY); CREATE TABLE reached(obligation TEXT PRIMARY KEY,keys TEXT NOT NULL); CREATE TABLE members(scope TEXT,subject TEXT,PRIMARY KEY(scope,subject)); CREATE TABLE lifetime(value TEXT PRIMARY KEY); BEGIN");
    const header = { ...arming, lifetimeHuntSubjects: undefined,
      sends: { specs: arming.sends.specs, historical: arming.sends.historical },
      areas: arming.areas === null ? null : { ...arming.areas, scopes: arming.areas.scopes.map(({ members: _members, ...scope }) => scope) } };
    db.prepare("INSERT INTO metadata VALUES (?)").run(JSON.stringify(header));
    const known = db.prepare("INSERT OR IGNORE INTO known VALUES (?)");
    for (const key of arming.sends.knownKeys) known.run(key);
    const reached = db.prepare("INSERT OR REPLACE INTO reached VALUES (?,?)");
    for (const [obligation, keys] of arming.sends.reached) if (keys.length) reached.run(obligation, JSON.stringify(keys));
    const members = db.prepare("INSERT OR IGNORE INTO members VALUES (?,?)");
    for (const scope of arming.areas?.scopes ?? []) for (const subject of scope.members) members.run(scope.key, subject);
    const lifetime = db.prepare("INSERT OR IGNORE INTO lifetime VALUES (?)");
    for (const subject of arming.lifetimeHuntSubjects) lifetime.run(subject);
    db.exec("COMMIT");
  } catch (error) { db.close(); rmSync(temporary, { force: true }); throw error; }
  db.close(); renameSync(temporary, path);
}

function diskStringSet(db: DatabaseSync, select: string, exact: string, parameters: readonly string[] = []): IndexedMembership {
  const rows = db.prepare(select), one = db.prepare(exact), count = db.prepare(`SELECT count(*) AS n FROM (${select})`);
  const values = function* () { for (const row of rows.iterate(...parameters)) yield String(row.value); };
  return { get size() { return Number(count.get(...parameters)!.n); }, has: (value: string) => one.get(...parameters, value) !== undefined,
    [Symbol.iterator]: values };
}

function diskReached(db: DatabaseSync): ReadonlyMap<string, readonly string[]> {
  const rows = db.prepare("SELECT obligation,keys FROM reached ORDER BY obligation"), one = db.prepare("SELECT keys FROM reached WHERE obligation=?");
  const entries = function* (): IterableIterator<[string, readonly string[]]> { for (const row of rows.iterate()) yield [String(row.obligation), JSON.parse(String(row.keys)) as string[]]; };
  const map = { get size() { return Number(db.prepare("SELECT count(*) AS n FROM reached").get()!.n); },
    has: (key: string) => one.get(key) !== undefined,
    get: (key: string) => { const row = one.get(key); return row === undefined ? undefined : JSON.parse(String(row.keys)) as string[]; },
    entries, *keys() { for (const [key] of entries()) yield key; }, *values() { for (const [, value] of entries()) yield value; }, [Symbol.iterator]: entries,
    forEach(callback: (value: readonly string[], key: string, map: ReadonlyMap<string, readonly string[]>) => void, thisArg?: unknown) { for (const [key, value] of entries()) callback.call(thisArg, value, key, map as unknown as ReadonlyMap<string, readonly string[]>); } };
  return map as unknown as ReadonlyMap<string, readonly string[]>;
}

export type LaneArmingRead = { readonly arming: HunterLaneArmingSnapshot } | { readonly held: string };

/** Only policy metadata is read into memory; membership is looked up by exact subject/obligation. */
export function readLaneArming(path: string, now: string): LaneArmingRead {
  let db: DatabaseSync | undefined, directory: string | undefined;
  const failed = (): void => { try { db?.close(); } finally { if (directory) rmSync(temporaryPath(directory), { recursive: true, force: true }); } };
  try {
    directory = mkdtempSync(temporaryPath(join(tmpdir(), "meanwhile-hunter-arming-")));
    const snapshot = temporaryPath(join(directory, "arming.sqlite"));
    copyFileSync(path, temporaryPath(snapshot));
    db = new DatabaseSync(snapshot, { readOnly: true });
    db.exec("PRAGMA cache_size=-1024; PRAGMA mmap_size=0");
    const a = JSON.parse(String(db.prepare("SELECT body FROM metadata").get()?.body)) as Partial<HunterLaneArming> | null;
    if (a === null || typeof a !== "object" || a.format !== HUNTER_LANE_ARMING_FORMAT || typeof a.readAt !== "string" || !Number.isFinite(Date.parse(a.readAt)) ||
      !a.sends || !Array.isArray(a.sends.specs) || !(a.sends.historical === null || Array.isArray(a.sends.historical)) || !Array.isArray(a.placeOrder) ||
      !Array.isArray(a.circuits) || typeof a.worstCaseUsd !== "number" || !(a.areas === null || (typeof a.areas === "object" && Array.isArray(a.areas?.scopes)))) {
      failed(); return { held: "the round's budget reading is not in the expected form" };
    }
    const ageMs = Date.parse(now) - Date.parse(a.readAt);
    if (ageMs > HUNTER_LANE_ARMING_MAX_AGE_MS) {
      failed(); return { held: `the round's budget reading is ${Math.round(ageMs / 60_000)} minutes old (more than ${HUNTER_LANE_ARMING_MAX_AGE_MS / 60_000}), so no research round has read the Send and area budgets since` };
    }
    const held = db, ownedDirectory = directory;
    let references = 1, retired = false, closed = false;
    const dispose = (): void => { if (closed) return; closed = true; openArmingSnapshots.delete(dispose); try { held.close(); } finally { rmSync(temporaryPath(ownedDirectory), { recursive: true, force: true }); } };
    const release = (): void => { if (--references === 0) dispose(); };
    const arming: HunterLaneArmingSnapshot = { ...a as HunterLaneArming,
      sends: { ...a.sends, knownKeys: diskStringSet(held, "SELECT value FROM known ORDER BY value", "SELECT 1 FROM known WHERE value=?"), reached: diskReached(held) },
      areas: a.areas === null ? null : { ...a.areas!, scopes: a.areas!.scopes.map(scope => ({ ...scope,
        members: diskStringSet(held, "SELECT subject AS value FROM members WHERE scope=? ORDER BY subject", "SELECT 1 FROM members WHERE scope=? AND subject=?", [scope.key]) })) },
      lifetimeHuntSubjects: diskStringSet(held, "SELECT value FROM lifetime ORDER BY value", "SELECT 1 FROM lifetime WHERE value=?"),
      retain: () => { if (closed) throw new Error("HUNTER_ARMING_READING_CLOSED"); references++; let released = false; return () => { if (!released) { released = true; release(); } }; },
      close: () => { if (!retired) { retired = true; release(); } } };
    openArmingSnapshots.add(dispose);
    return { arming };
  } catch (error) {
    failed();
    return { held: (error as NodeJS.ErrnoException)?.code === "ENOENT" ? "no research round has written its budget reading yet" : "the round's budget reading is not in the expected form" };
  }
}


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
  /**
   * Drops what has left the window, and returns each task the book stands
   * for with when this lane first sent for it. Only ledger rows from then on
   * are this lane's: a row recorded earlier is an earlier lane's or round's
   * work on the same task, and keeps counting.
   */
  tasks(now: string): ReadonlyMap<string, number> {
    const since = Date.parse(now) - this.windowMs;
    for (let i = this.requests.length - 1; i >= 0; i -= 1) if (Date.parse(this.requests[i].at) < since && !this.requests[i].pending) this.requests.splice(i, 1);
    const first = new Map<string, number>();
    for (const r of this.requests) first.set(r.taskId, Math.min(first.get(r.taskId) ?? Infinity, Date.parse(r.at)));
    return first;
  }
  /** The book as spend-window charges, so a new controller counts them the way it counts the ledger. */
  *asCharges(): IterableIterator<PricedCharge> {
    for (let i = 0; i < this.requests.length; i++) {
      const r = this.requests[i];
      yield { id: `hunter-lane:${r.taskId}:${i}`, at: r.at, jobId: `hunter-lane:${r.taskId}:${i}`,
      routeTaskId: r.taskId, obligationId: null, jurisdiction: null, usd: r.usd, knownUsd: r.usd, measured: true, bounded: false,
      metered: { attemptId: `hunter-lane:${r.taskId}:${i}`, role: "SCOUT", routeId: null, recordedAt: r.at, cost: { ...ZERO_COST, usd: r.usd, requestCount: 1 } } };
    }
  }
  /** Every request the book still counts, in dollars. */
  usd(): number { return this.requests.reduce((n, r) => n + r.usd, 0); }
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
  readonly arming: HunterLaneArmingSnapshot | null;
  readonly spendHolds: DurableSpendHolds;
  readonly ceilingUsd: number;
  /** The owner's paid-search switch, read from the same row (off when the row cannot be trusted). */
  readonly discoverySearchOn: boolean;
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
  try { configRead = { row: await readRuntimeAdminConfig(deps.repos, ["fleetSpendCeiling", "discoverySearch"]) }; }
  catch (error) { configRead = { unreadable: message(error) }; }
  const { config, holdPaidWork: configHold } = adminConfigForPaidWork(configRead);
  if (configHold !== null) unreadable.push(configHold);
  const ceilingOverride = fleetSpendCeilingOverrideUsd(config);
  const ceilingUsd = resolveRollingCeiling(ceilingOverride).rollingCeilingUsd;
  const discoverySearchOn = configHold === null && discoverySearchEnabled(config);

  /* As the round does: the spend window the ledger's writes keep. */
  const ownTasks = deps.ownSpend.tasks(now);
  let spendSnapshot: Awaited<ReturnType<typeof readSpendWindow>> | null = null;
  let counted: Iterable<PricedCharge> | null = null;
  let windowUsd: number | null = null;
  let ledgerUnreadable: string | null = null;
  try {
    const charges = spendSnapshot = await readSpendWindow(deps.repos, now);
    /* The lane's own requests count from its book, never twice. */
    counted = { *[Symbol.iterator]() {
      for (const row of charges) if (row.routeTaskId === null || !(Date.parse(row.at) >= (ownTasks.get(row.routeTaskId) ?? Infinity))) yield row;
      yield* deps.ownSpend.asCharges();
    } };
    windowUsd = researchSpendInWindow(counted, now, RESEARCH_BOUNDS.windowHours).windowUsd;
  } catch (error) {
    spendSnapshot?.close(); spendSnapshot = null;
    counted = null;
    ledgerUnreadable = message(error);
    deps.onCondition(`the cost ledger could not be read (${ledgerUnreadable}); paid model work waits`);
  }
  const spendHold = counted === null ? `the cost ledger could not be read (${ledgerUnreadable})`
    : !ceilingPermits(windowUsd, ceilingUsd).permits
      ? `the owner's $${ceilingUsd.toFixed(2)} model ceiling is reached` : null;

  const read = readLaneArming(deps.armingPath, now);
  const armingHold = "held" in read ? read.held : null;
  const closure = modelLaneClosure({
    dry: false, noModel: false, credentialConfigured: deps.credentialConfigured, credentialVar: deps.credentialVar,
    paused: intents.paused, pauseIntentId: intents.pauseIntentId ?? null,
    runnerPaused: intents.runnerPause.paused, runnerPauseIntentId: intents.runnerPause.intent?.intentId ?? null,
    spendHold: spendHold ?? armingHold, unreadableControls: unreadable,
  });
  const arming = "arming" in read ? read.arming : null;

  let fleetSafety: FleetSafetyController | null;
  try {
    fleetSafety = counted === null ? null : new FleetSafetyController({
      now, charges: counted,
      costLedgerReadable: true, paused: intents.runnerPause.paused, modelHold: closure?.reason ?? null,
      circuits: deps.circuits ?? arming?.circuits ?? [], rollingCeilingUsd: ceilingOverride,
      lifetimeHuntWork: work => arming?.lifetimeHuntSubjects.has(work) ?? false,
    });
  } finally { spendSnapshot?.close(); }
  if (closure !== null || fleetSafety === null || arming === null) {
    return { closed: closure ?? { code: "LANE_DISABLED", reason: armingHold ?? `the cost ledger could not be read (${ledgerUnreadable})` },
      armedAt: now, fleetSafety, guards: null, arming, spendHolds, ceilingUsd, discoverySearchOn };
  }

  /* The Send lines: the round's Sends and history; the DISPATCH budgets the owner sent since are read from the live log. */
  const liveSpecs = assignmentBudgetsOf({ scopes: [], intents: intentLog });
  const armedKeys = new Set(arming.sends.specs.map(spec => spec.key));
  const newerSends = liveSpecs.filter(spec => !armedKeys.has(spec.key)).map(spec => spec.key);

  const historical = new Map((arming.sends.historical ?? []).map(row => [row.key, { usd: row.usd } as AssignmentSpend] as const));

  const malformed = malformedAssignmentBudgetsOf(intentLog);
  type PreparedGate = AssignmentBudgetGate | { refusal: AssignmentRefusal };
  const gates = new Map<string, PreparedGate[]>();
  const prepared = (id: string, gate: PreparedGate): void => { const waiting = gates.get(id) ?? []; waiting.push(gate); gates.set(id, waiting); };
  const held = (why: string): { refusal: AssignmentRefusal } => ({ refusal: { admit: false, code: ASSIGNMENT_BUDGET_CODE, why } });
  const prepareObligation = async (obligationId: string): Promise<void> => {
    let row;
    try { row = await deps.repos.obligations.readNarrowed(obligationId, { subjectId: true, assignments: true }) as { readonly value: { readonly subjectId: string; readonly assignments?: import("../scheduler/obligation.ts").ObligationAssignment[] } } | null; }
    catch (error) { prepared(obligationId, held(`the obligation's Send record could not be read (${message(error)}); paid work waits`)); return; }
    const marks = row?.value.assignments ?? [];
    const unknown = marks.map(mark => mark.assignmentKey).find(key => !arming.sends.knownKeys.has(key) && !armedKeys.has(key));
    if (unknown !== undefined || marks.some(mark => newerSends.includes(mark.assignmentKey))) {
      prepared(obligationId, held(`this work belongs to Send ${unknown ?? marks.find(mark => newerSends.includes(mark.assignmentKey))!.assignmentKey}, which is newer than the round's budget reading; paid work waits for the next round to read its budget`));
      return;
    }
    const membership = assignmentMembership(row === null ? [] : [{ id: obligationId, subjectId: row.value.subjectId, assignments: marks }]);
    const reached = arming.sends.reached.get(obligationId) ?? [];
    const needed = new Set([...marks.map(mark => mark.assignmentKey), ...reached]);
    prepared(obligationId, new AssignmentBudgetGate({ specs: arming.sends.specs.filter(spec => needed.has(spec.key)), membership, historical,
      worstCaseUsd: arming.worstCaseUsd, costsReadable: arming.sends.historical !== null, intentsReadable,
      malformed: malformed.filter(spec => needed.has(spec.key)), reachedThisCycle: new Map([[obligationId, reached]]), historyReadAt: arming.readAt }));
  };
  const assignmentBudget = {
    linesFor(obligationId: string): { readonly lines: readonly BudgetLine[] } | { readonly refusal: AssignmentRefusal } {
      const waiting = gates.get(obligationId);
      const gate = waiting?.shift();
      if (!waiting?.length) gates.delete(obligationId);
      if (gate === undefined) return held("the obligation's Send record was not read before its request; paid work waits");
      return "refusal" in gate ? { refusal: gate.refusal } : gate.linesFor(obligationId);
    },
  };
  const expansionBudget = arming.areas === null ? null : { gate: new ScopeBudgetGate({
    scopes: arming.areas.scopes,
    worstCaseUsd: arming.worstCaseUsd, malformedScopes: arming.areas.malformedScopes, historyReadAt: arming.readAt }) };
  const guards = paidWorkGuards({ repos: deps.repos, now: deps.now, armedAt: now, fleetSafety, providerQueue: deps.providerQueue,
    spendHolds, assignmentBudget, expansionBudget, beforeObligation: prepareObligation,
    messages: deps.messages, batch: deps.batch, modelLaneEnabled: true, ceilingUsd: () => ceilingUsd,
    ...(deps.requestsPerMinute === undefined ? {} : { requestsPerMinute: deps.requestsPerMinute }),
    onCondition: deps.onCondition });
  return { closed: null, armedAt: now, fleetSafety, guards, arming, spendHolds, ceilingUsd, discoverySearchOn };
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
    const releaseReading = armed.arming?.retain();
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
    } finally { releaseReading?.(); }
  };
}
