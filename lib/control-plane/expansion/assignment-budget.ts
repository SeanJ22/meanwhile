/**
 * A budget on one assignment (owner Send), honoured by the runner. An
 * assignment is a selected geography (keyed by its scope key) or a DISPATCH
 * (`dispatch:<intent id>`); membership is read from the obligations' own
 * `assignments`, never re-joined by place.
 *
 * ```
 *   budget     a geography's rolling 24-hour budget, or the budget a DISPATCH
 *              was sent with; none otherwise (only the Fleet ceiling bounds it)
 *   spent      every model-backed charge in the rolling window on a member
 *              obligation, at or after it joined. A charge naming no obligation
 *              counts against every assignment with work on its subject
 *   held       worst cases reserved for Scouts admitted and not yet settled
 *   left       budget − spent − held
 * ```
 *
 * A charge counts toward every Send its obligation belongs to. A Scout is
 * admitted while any budgeted Send it belongs to has room for one more worst
 * case (running under the most recent such Send) and its worst case is held
 * against all of them. Sends without a budget add no limit.
 *
 * Fail closed: an unreadable ledger, an unmeasured charge, or unreadable owner
 * instructions for DISPATCH work hold the Scout, by name.
 *
 */

import { setImmediate as cooperate } from "node:timers/promises";
import type { AssignmentCompletion } from "../assignment-completion.ts";
import type { FreshnessDetailReference } from "../owner-surface.ts";
import { isFundedHunt } from "../scheduler/hunt-continuation.ts";
import { aggregatePricedSpend, type PricedCharge } from "../fleet-safety.ts";
import { filterIterable, spendScratch } from "../spend-scratch.ts";
import type { ObligationAssignment } from "../scheduler/obligation.ts";
import type { ResearchIntent } from "../scheduler/research-policy.ts";
import { READING_LIST_CAP, isVersionedCycleReading } from "./reading.ts";
import type { ExpansionScopeDecision } from "./scopes.ts";
import type { BudgetLine } from "./spend-holds.ts";
import { instructionReceiptKey } from "../scheduler/obligation.ts";
import { plannerMap, plannerSet, type PlannerSpool } from "../scheduler/planner-spool.ts";
import { DiskRows } from "../scheduler/disk-rows.ts";

export const ASSIGNMENT_BUDGET_CODE = "ASSIGNMENT_BUDGET";
export const ASSIGNMENT_BUDGET_FORMAT_VERSION = 1;
/** Every assignment budget is a rolling window of this many hours — the geography budget's own. */
export const ASSIGNMENT_BUDGET_WINDOW_HOURS = 24;

const usd = (n: number): string => `$${n.toFixed(2)}`;
/** A DISPATCH is named by its words in a refusal; long words are clipped there, never in the intent. */
const LABEL_MAX = 80;

/* ------------------------------------------------------------ budgets */

/** One Send's budget in force. */
export interface AssignmentBudgetSpec {
  readonly budgetStartedAt?: string;
  readonly key: string;
  readonly kind: "SCOPE" | "DISPATCH";
  readonly label: string;
  readonly ref: string;
  readonly budgetUsd: number;
  /** When the owner sent it: the most recent Send with room is the one work runs under. */
  readonly sentAt: string;
}

/** The DISPATCH key a Send carries on the rows it reached (`dispatch-work.ts`). */
export const dispatchAssignmentKey = (intentId: string): string => `dispatch:${intentId}`;

/** A DISPATCH whose budget field is present but not a finite number ≥ 0. Its work is held, never run unbudgeted. */
export interface MalformedAssignmentBudget {
  readonly key: string;
  readonly label: string;
  /** The value as read, for the refusal. */
  readonly raw: string;
}

/** Every DISPATCH whose budget field is present and unreadable. */
let assignmentSpecSequence = 0;
export function malformedAssignmentBudgetsOf(intents: Iterable<ResearchIntent>, planner: PlannerSpool): DiskRows<MalformedAssignmentBudget>;
export function malformedAssignmentBudgetsOf(intents: Iterable<ResearchIntent>): MalformedAssignmentBudget[];
export function malformedAssignmentBudgetsOf(intents: Iterable<ResearchIntent>, planner?: PlannerSpool): DiskRows<MalformedAssignmentBudget> | MalformedAssignmentBudget[] {
  let sequence = 0;
  const disk = planner?.table<{ sequence: number; value: MalformedAssignmentBudget }>(`assignment-malformed:${assignmentSpecSequence++}`, row => String(row.sequence));
  const out: MalformedAssignmentBudget[] = [];
  for (const i of intents) {
    if (i.kind !== "INTENT" || i.action !== "DISPATCH" || !("budgetUsd" in i) || i.budgetUsd === undefined) continue;
    const b: unknown = i.budgetUsd;
    if (typeof b === "number" && Number.isFinite(b) && b >= 0) continue;
    const words = (i.note ?? "").replace(/\s+/g, " ").trim();
    const value = { key: dispatchAssignmentKey(i.intentId), label: words === "" ? i.intentId : words.slice(0, LABEL_MAX), raw: JSON.stringify(b) ?? String(b) };
    if (disk) disk.add({ sequence: sequence++, value }); else out.push(value);
  }
  return disk ? disk.rows.map(row => row.value) : out;
}

/** One budget line a hold is checked against: `send:<assignment key>` (see `spend-holds.ts`). */
export const sendBudgetKey = (assignmentKey: string): string => `send:${assignmentKey}`;

/**
 * The budgets in force: every selected scope's, and every DISPATCH the owner
 * sent with one (honored or not — an honored Send's work still belongs to it).
 */
interface AssignmentBudgetsInput {
  readonly scopes: Iterable<ExpansionScopeDecision>;
  readonly intents: Iterable<ResearchIntent>;
}
export function assignmentBudgetsOf(input: AssignmentBudgetsInput, planner: PlannerSpool): DiskRows<AssignmentBudgetSpec>;
export function assignmentBudgetsOf(input: AssignmentBudgetsInput): AssignmentBudgetSpec[];
export function assignmentBudgetsOf(input: AssignmentBudgetsInput, planner?: PlannerSpool): AssignmentBudgetSpec[] | DiskRows<AssignmentBudgetSpec> {
  let sequence = 0;
  const disk = planner?.table<{ sequence: number; value: AssignmentBudgetSpec }>(`assignment-specs:${assignmentSpecSequence++}`, row => String(row.sequence));
  const out: AssignmentBudgetSpec[] = [];
  const add = (value: AssignmentBudgetSpec) => { if (disk) disk.add({ sequence: sequence++, value }); else out.push(value); };
  for (const d of input.scopes) add({
    key: d.key, kind: "SCOPE", label: d.geography.label, ref: d.receiptId,
    budgetUsd: d.budgetUsd, sentAt: d.decidedAt,
    ...(d.budgetStartedAt ? { budgetStartedAt: d.budgetStartedAt } : {}),
  });
  for (const i of input.intents) {
    if (i.kind !== "INTENT" || i.action !== "DISPATCH") continue;
    if (typeof i.budgetUsd !== "number" || !Number.isFinite(i.budgetUsd) || i.budgetUsd < 0) continue;
    const words = (i.note ?? "").replace(/\s+/g, " ").trim();
    const label = words === "" ? i.intentId : words.length > LABEL_MAX ? `${words.slice(0, LABEL_MAX - 1).trimEnd()}…` : words;
    add({ key: dispatchAssignmentKey(i.intentId), kind: "DISPATCH", label, ref: i.intentId, budgetUsd: i.budgetUsd, sentAt: i.requestedAt });
  }
  return disk ? disk.rows.map(row => row.value) : out;
}

/* ------------------------------------------------------------ membership */
let nextMembership = 0;
function memberSample(keys: Iterable<string>): string[] {
  const sample: string[] = [];
  for (const key of keys) { sample.push(key); sample.sort(); if (sample.length > READING_LIST_CAP) sample.pop(); }
  return sample;
}

async function memberSampleCooperatively(keys: Iterable<string>): Promise<string[]> {
  const sample: string[] = []; let batch = 0;
  for (const key of keys) {
    sample.push(key); sample.sort(); if (sample.length > READING_LIST_CAP) sample.pop();
    if (++batch % 64 === 0) await cooperate();
  }
  return sample;
}

export interface AssignmentMember {
  readonly obligationId: string;
  readonly subjectId: string;
  /** When the obligation joined the assignment: the earliest entry recorded for it. */
  readonly joinedAt: string;
}

export interface AssignmentMembers {
  readonly created: ReadonlyMap<string, AssignmentMember>;
  readonly reordered: ReadonlyMap<string, AssignmentMember>;
}
type MutableAssignmentMembers = { created: Map<string, AssignmentMember>; reordered: Map<string, AssignmentMember> };

export interface AssignmentMembership {
  readonly byKey: ReadonlyMap<string, AssignmentMembers>;
  readonly byInstruction: ReadonlyMap<string, AssignmentMembers>;
  /** The assignments each obligation belongs to. */
  readonly keysOf: ReadonlyMap<string, readonly string[]>;
  readonly refsOf: ReadonlyMap<string, readonly { readonly key:string; readonly ref:string }[]>;
}

/** Only a requested Send constructs member views; the country's Send identities remain on disk. */
function memberSlots(planner: PlannerSpool, name: string,
  slotOf: (key: string) => { created: Map<string, AssignmentMember>; reordered: Map<string, AssignmentMember> }) {
  const index = plannerMap<string>(planner, name);
  const view = {
    [Symbol.toStringTag]: "Map",
    get size() { return index.size; }, has: (key: string) => index.has(key),
    get: (key: string) => { const identity = index.get(key); return identity === undefined ? undefined : slotOf(identity); },
    set(key: string, _value: AssignmentMembers) { index.set(key, `${name}:${key}`); return view; },
    delete: (key: string) => index.delete(key), clear: () => index.clear(),
    keys() { return Iterator.from((function* () { for (const [key] of index) yield key; })()); },
    values() { return Iterator.from((function* () { for (const [, identity] of index) yield slotOf(identity); })()); },
    entries() { return Iterator.from((function* (): IterableIterator<[string, AssignmentMembers]> { for (const [key, identity] of index) yield [key, slotOf(identity)]; })()); },
    [Symbol.iterator]() { return view.entries(); },
    forEach(visit: (value: AssignmentMembers, key: string, map: ReadonlyMap<string, AssignmentMembers>) => void, receiver?: unknown) {
      for (const [key, identity] of index) visit.call(receiver, slotOf(identity), key, view as ReadonlyMap<string, AssignmentMembers>);
    },
  };
  return view;
}

/**
 * Who belongs to which Send, from the obligations' own records (and anything
 * this cycle recorded after they were read). A row a Send both reordered and
 * later created counts once, as created.
 */
export function assignmentMembership(
  rows: Iterable<{ readonly id: string; readonly subjectId: string; readonly assignments?: readonly ObligationAssignment[] }>,
  recorded: Iterable<{ readonly obligationId: string; readonly subjectId: string; readonly entry: ObligationAssignment }> = [],
  planner?: PlannerSpool,
): AssignmentMembership {
  const prefix = `assignment-members-${nextMembership++}`;
  const entries = planner ? plannerMap<{ subjectId: string; list: ObligationAssignment[] }>(planner, `${prefix}-entries`) : new Map<string, { subjectId: string; list: ObligationAssignment[] }>();
  const add = (obligationId: string, subjectId: string, entry: ObligationAssignment): void => {
    const held = entries.get(obligationId) ?? { subjectId, list: [] };
    held.list.push(entry);
    entries.set(obligationId, held);
  };
  for (const row of rows) for (const entry of row.assignments ?? []) add(row.id, row.subjectId, entry);
  for (const r of recorded) add(r.obligationId, r.subjectId, r.entry);

  const keysOf = planner ? plannerMap<string[]>(planner, `${prefix}-keys`) : new Map<string, string[]>();
  const refsOf = planner ? plannerMap<{key:string;ref:string}[]>(planner, `${prefix}-refs`) : new Map<string, {key:string;ref:string}[]>();
  const slotOf = (identity: string) => ({ created: planner ? plannerMap<AssignmentMember>(planner, `${prefix}-${identity}-created`) : new Map<string, AssignmentMember>(),
    reordered: planner ? plannerMap<AssignmentMember>(planner, `${prefix}-${identity}-reordered`) : new Map<string, AssignmentMember>() });
  const byKey = planner ? memberSlots(planner, `${prefix}-key`, slotOf) : new Map<string, MutableAssignmentMembers>();
  const byInstruction = planner ? memberSlots(planner, `${prefix}-instruction`, slotOf) : new Map<string, MutableAssignmentMembers>();
  for (const [obligationId, { subjectId, list }] of entries) {
    const keys = [...new Set(list.map((e) => e.assignmentKey))];
    keysOf.set(obligationId, keys);
    const refs=[...new Map(list.map(mark=>[instructionReceiptKey(mark.assignmentKey,mark.ref),{key:mark.assignmentKey,ref:mark.ref}])).values()];
    refsOf.set(obligationId,refs);
    for (const {key,ref} of refs) {
      const mine=list.filter(mark=>mark.assignmentKey===key && mark.ref===ref);
      const member:AssignmentMember={obligationId,subjectId,joinedAt:mine.map(mark=>mark.at).sort()[0]??""};
      const identity=instructionReceiptKey(key,ref);
      const slot=byInstruction.get(identity)??slotOf(planner ? `${prefix}-instruction:${identity}` : `instruction-${identity}`);
      if (mine.some(mark=>mark.relation==="CREATED")) slot.created.set(obligationId,member);
      else slot.reordered.set(obligationId,member);
      byInstruction.set(identity,slot);
    }
    for (const key of keys) {
      const mine = list.filter((e) => e.assignmentKey === key);
      const joinedAt = mine.map((e) => e.at).sort()[0] ?? "";
      const member: AssignmentMember = { obligationId, subjectId, joinedAt };
      const slot = byKey.get(key) ?? slotOf(planner ? `${prefix}-key:${key}` : `key-${key}`);
      if (mine.some((e) => e.relation === "CREATED")) slot.created.set(obligationId, member);
      else slot.reordered.set(obligationId, member);
      byKey.set(key, slot);
    }
  }
  return { byKey, byInstruction, keysOf, refsOf };
}

/* ------------------------------------------------------------ spend */

export interface AssignmentSpend {
  /** Measured model-backed dollars; null when any member charge reported no dollar figure. */
  readonly usd: number | null;
  readonly measured: number;
  readonly unmeasured: number;
  /** Of the rows counted, how many named no obligation and were counted by their subject. */
  readonly bySubject: number;
}

/** One assignment's model-backed spend in a window, by the rule in the header. */
export function assignmentSpend(charges: Iterable<PricedCharge>, members: AssignmentMembers, since: string, until: string): AssignmentSpend {
  const scratch = spendScratch(), {db, owner} = scratch;
  const addObligation = db.prepare("INSERT INTO members VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET at=excluded.at");
  const addSubject = db.prepare("INSERT INTO members VALUES(?,?,?) ON CONFLICT(owner,id) DO UPDATE SET at=MIN(members.at,excluded.at)");
  const joinedAt = db.prepare("SELECT at FROM members WHERE owner=? AND id=?");
  try {
  for (const m of (function* () {yield* members.created.values(); yield* members.reordered.values();})()) {
    const t = Date.parse(m.joinedAt);
    addObligation.run(owner, `o:${m.obligationId}`, t);
    addSubject.run(owner, `s:${m.subjectId}`, t);
  }
  const byObligation = filterIterable(charges, entry => {
    const at = Date.parse(entry.at);
    const joined = entry.obligationId === null ? undefined : joinedAt.get(owner, `o:${entry.obligationId}`);
    return joined !== undefined && at >= Number(joined.at);
  });
  const bySubject = filterIterable(charges, entry => {
    if (entry.obligationId !== null || entry.jurisdiction === null) return false;
    const joined = joinedAt.get(owner, `s:${entry.jurisdiction}`);
    return joined !== undefined && Date.parse(entry.at) >= Number(joined.at);
  });
  /* The Fleet's own model-backed and window rule, for both halves. */
  const named = aggregatePricedSpend(byObligation, since, until);
  const unnamed = aggregatePricedSpend(bySubject, since, until);
  return {
    usd: named.usd === null || unnamed.usd === null ? null : named.usd + unnamed.usd,
    measured: named.measured + unnamed.measured,
    unmeasured: named.unmeasured + unnamed.unmeasured,
    bySubject: unnamed.measured + unnamed.unmeasured,
  };
  } finally { scratch.release(); }
}

/* ------------------------------------------------------------ the gate */

export type AssignmentAdmission =
  | { readonly admit: true; readonly runsUnder: string | null; readonly keys: readonly string[] }
  | AssignmentRefusal;
export type AssignmentRefusal = { readonly admit: false; readonly code: typeof ASSIGNMENT_BUDGET_CODE; readonly why: string };

export interface AssignmentBudgetState {
  readonly budgetUsd: number;
  /** Rolling-window spend at cycle start plus what this cycle settled; null when unmeasured. */
  readonly spentUsd: number | null;
  readonly heldUsd: number;
  /** budget − spent − held; null when spent is unmeasured. May be below zero: a shared charge counts in full. */
  readonly leftUsd: number | null;
  readonly admitted: number;
  readonly refused: number;
}

/**
 * The per-assignment admission gate for paid Scouts, in the Fleet
 * controller's holdback pattern: history + this cycle + held + one worst case
 * must fit the budget. `check` decides without reserving; `admit` decides and
 * reserves; `settle` releases the hold and books what the Scout measured.
 */
let assignmentGateSequence = 0;
export class AssignmentBudgetGate {
  private readonly specs: ReadonlyMap<string, AssignmentBudgetSpec>;
  private readonly keysOf: ReadonlyMap<string, readonly string[]>;
  private readonly refsOf: ReadonlyMap<string, readonly {readonly key:string;readonly ref:string}[]>;
  private readonly historical: ReadonlyMap<string, AssignmentSpend>;
  private readonly worstCaseUsd: number;
  private readonly costsReadable: boolean;
  private readonly intentsReadable: boolean;
  private readonly cycleUsd: Map<string, number>;
  private readonly cycleUnmeasured: Set<string>;
  private readonly reserved: Map<string, number>;
  private readonly reservations: Map<string, readonly string[]>;
  private readonly admittedBy: Map<string, number>;
  private readonly refusedBy: Map<string, number>;
  private readonly malformed: ReadonlyMap<string, MalformedAssignmentBudget>;
  private readonly reachedThisCycle: ReadonlyMap<string, readonly string[]>;
  private readonly historyReadAt: string;

  constructor(input: {
    readonly specs: Iterable<AssignmentBudgetSpec>;
    readonly membership: AssignmentMembership;
    /** Rolling-window spend per budgeted assignment at cycle start. Absent for a key: nothing measured, so it cannot be checked. */
    readonly historical: ReadonlyMap<string, AssignmentSpend>;
    readonly worstCaseUsd: number;
    readonly costsReadable: boolean;
    /** False when the owner's instruction log could not be read: no DISPATCH budget can then be known. */
    readonly intentsReadable: boolean;
    /** DISPATCHes whose budget field is unreadable: the work they reach is held. */
    readonly malformed?: Iterable<MalformedAssignmentBudget>;
    /** The Sends this cycle's reading reached each obligation under. A budgeted Send missing from the row's record is held. */
    readonly reachedThisCycle?: ReadonlyMap<string, readonly string[]>;
    /** When `historical` was read (the cycle's instant). */
    readonly historyReadAt?: string;
    readonly planner?: PlannerSpool;
  }) {
    const prefix = `assignment-gate:${assignmentGateSequence++}`;
    const map = <V>(name: string, rows: Iterable<readonly [string, V]> = []): Map<string, V> =>
      input.planner ? plannerMap(input.planner, `${prefix}:${name}`, rows) : new Map(rows);
    this.specs = map("specs", (function* () { for (const spec of input.specs) yield [spec.key, spec] as const; })());
    this.keysOf = input.planner ? map("keys", input.membership.keysOf) : input.membership.keysOf;
    this.refsOf = input.planner ? map("refs", input.membership.refsOf) : input.membership.refsOf;
    this.historical = input.planner ? map("historical", input.historical) : input.historical;
    this.cycleUsd = map("cycle-usd");
    this.cycleUnmeasured = input.planner ? plannerSet(input.planner, `${prefix}:unmeasured`) : new Set();
    this.reserved = map("reserved");
    this.reservations = map("reservations");
    this.admittedBy = map("admitted");
    this.refusedBy = map("refused");
    this.worstCaseUsd = input.worstCaseUsd;
    this.costsReadable = input.costsReadable;
    this.intentsReadable = input.intentsReadable;
    this.malformed = map("malformed", (function* () { for (const bad of input.malformed ?? []) yield [bad.key, bad] as const; })());
    this.reachedThisCycle = input.planner ? map("reached", input.reachedThisCycle ?? []) : input.reachedThisCycle ?? new Map();
    this.historyReadAt = input.historyReadAt ?? new Date(0).toISOString();
  }

  /**
   * The fail-closed conditions that hold an obligation's paid work whatever
   * the dollars say, or null: a Send the cycle reached it under whose record on
   * the row is missing, a Send whose budget is unreadable, a DISPATCH whose
   * budget cannot be known because the owner's instructions were unreadable.
   */
  private failClosed(obligationId: string, keys: readonly string[]): AssignmentRefusal | null {
    const reached = this.reachedThisCycle.get(obligationId) ?? [];
    for (const key of keys) {
      const spec=this.specs.get(key);
      if (spec && !this.refsOf.get(obligationId)?.some(mark=>mark.key===key&&mark.ref===spec.ref))
        return this.refused([key], `assignment ${this.name(spec)} has a new instruction receipt, but this work only records an earlier one; paid work waits for the new durable membership mark`);
    }
    for (const key of reached) {
      const spec = this.specs.get(key);
      if (keys.includes(key) && (!spec || this.refsOf.get(obligationId)?.some(mark=>mark.key===key&&mark.ref===spec.ref))) continue;
      if (spec !== undefined || this.malformed.has(key) || !this.intentsReadable) {
        const named = spec !== undefined ? `${this.name(spec)}'s ${usd(spec.budgetUsd)} budget` : `the budget of assignment ${key}`;
        return this.refused([key], `this cycle's reading reached this work under assignment ${key}, but the record that it belongs to that Send was not written, so ${named} cannot be applied; the work waits until the record is written`);
      }
    }
    for (const key of [...keys, ...reached]) {
      const bad = this.malformed.get(key);
      if (bad !== undefined) {
        return this.refused([key], `assignment "${bad.label}" (${key}) carries a budget that is not a readable amount (${bad.raw}), so it cannot be checked; paid work it reached is held`);
      }
    }
    const unreadDispatch = this.intentsReadable ? undefined : keys.find((k) => k.startsWith("dispatch:"));
    if (unreadDispatch !== undefined) {
      return this.refused([unreadDispatch], `the owner's instructions could not be read, so the budget of assignment ${unreadDispatch} cannot be known; paid work it reached is held`);
    }
    return null;
  }

  /**
   * The budget lines a paid job on this obligation is held against
   * (`spend-holds.ts`): every budgeted Send it belongs to, most recent first, or
   * the refusal when the budget cannot be checked. No lines: no Send budget applies.
   */
  linesFor(obligationId: string): { readonly lines: readonly BudgetLine[] } | { readonly refusal: AssignmentRefusal } {
    const keys = this.keysOf.get(obligationId) ?? [];
    const closed = this.failClosed(obligationId, keys);
    if (closed !== null) return { refusal: closed };
    const budgeted = this.effectiveBudgetsFor(obligationId);
    if (budgeted.length === 0) return { lines: [] };
    if (!this.costsReadable) {
      const b = budgeted[0];
      return { refusal: this.refused(budgeted.map((s) => s.key), `the cost ledger could not be read, so assignment ${this.name(b)}'s ${usd(b.budgetUsd)} budget cannot be checked; paid work it reached is held`) };
    }
    const lines: BudgetLine[] = [];
    for (const b of budgeted) {
      const hist = this.historical.get(b.key);
      if (hist === undefined || hist.usd === null || this.cycleUnmeasured.has(b.key)) {
        return {
          refusal: this.refused(
            budgeted.map((s) => s.key),
            `assignment ${this.name(b)}'s ${usd(b.budgetUsd)} budget cannot be checked: a charge on its work in the rolling ${ASSIGNMENT_BUDGET_WINDOW_HOURS} hours reported no dollar figure`,
          ),
        };
      }
      lines.push({ key: sendBudgetKey(b.budgetStartedAt ? `${b.key}@${b.budgetStartedAt}` : b.key), label: `assignment ${this.name(b)}`, budgetUsd: b.budgetUsd, historicalUsd: hist.usd, historyReadAt: this.historyReadAt, lifetime: Boolean(b.budgetStartedAt) });
    }
    return { lines };
  }

  /** What this gate was armed with: the Sends and their spend at the read. */
  armedReading(): { readonly specs: DiskRows<AssignmentBudgetSpec>; readonly historical: ReadonlyMap<string, AssignmentSpend> | null; readonly reached: ReadonlyMap<string, readonly string[]> } {
    return { specs: new DiskRows(() => this.specs.values(), () => this.specs.size), historical: this.costsReadable ? this.historical : null, reached: this.reachedThisCycle };
  }

  /** The exact charge snapshot used to arm this Send; publication never scans it again. */
  historicalSpend(key: string): AssignmentSpend | null { return this.costsReadable ? this.historical.get(key) ?? null : null; }

  /** The budgeted Sends an obligation belongs to, most recent first. */
  budgetedFor(obligationId: string): AssignmentBudgetSpec[] {
    return (this.keysOf.get(obligationId) ?? [])
      .map((k) => this.specs.get(k))
      .filter((s): s is AssignmentBudgetSpec => s !== undefined &&
        this.refsOf.get(obligationId)?.some(mark=>mark.key===s.key&&mark.ref===s.ref)===true)
      .sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }

  /** Funded Sends supersede older rolling limits; each keeps its own allowance. */
  private effectiveBudgetsFor(obligationId: string): AssignmentBudgetSpec[] {
    const all = this.budgetedFor(obligationId);
    const funded = all.filter(isFundedHunt);
    return funded.length ? funded : all;
  }

  state(key: string): AssignmentBudgetState | null {
    const spec = this.specs.get(key);
    if (spec === undefined) return null;
    const hist = this.costsReadable ? (this.historical.get(key) ?? null) : null;
    const spentUsd = hist === null || hist.usd === null || this.cycleUnmeasured.has(key) ? null : hist.usd + (this.cycleUsd.get(key) ?? 0);
    const heldUsd = this.reserved.get(key) ?? 0;
    return {
      budgetUsd: spec.budgetUsd,
      spentUsd,
      heldUsd,
      leftUsd: spentUsd === null ? null : spec.budgetUsd - spentUsd - heldUsd,
      admitted: this.admittedBy.get(key) ?? 0,
      refused: this.refusedBy.get(key) ?? 0,
    };
  }

  check(obligationId: string): AssignmentAdmission {
    const keys = this.keysOf.get(obligationId) ?? [];
    /* Fail closed before anything else: a missing record, an unreadable budget, an unread instruction log. */
    const closed = this.failClosed(obligationId, keys);
    if (closed !== null) return closed;
    if (keys.length === 0) return { admit: true, runsUnder: null, keys };
    const budgeted = this.effectiveBudgetsFor(obligationId);
    if (budgeted.length === 0) return { admit: true, runsUnder: null, keys };
    if (!this.costsReadable) {
      const b = budgeted[0];
      return this.refused(budgeted.map((s) => s.key), `the cost ledger could not be read, so assignment ${this.name(b)}'s ${usd(b.budgetUsd)} budget cannot be checked; paid work it reached is held`);
    }
    const blockedHunt = budgeted.find(b => b.budgetStartedAt && (() => {
      const s = this.state(b.key);
      return s === null || s.spentUsd === null || s.spentUsd + s.heldUsd + this.worstCaseUsd > b.budgetUsd;
    })());
    for (const b of blockedHunt ? [] : budgeted) {
      const s = this.state(b.key);
      if (s !== null && s.spentUsd !== null && s.spentUsd + s.heldUsd + this.worstCaseUsd <= b.budgetUsd) return { admit: true, runsUnder: b.key, keys };
    }
    const b = blockedHunt ?? budgeted[0];
    const s = this.state(b.key);
    const period = b.budgetStartedAt ? "for this hunt" : `in the rolling ${ASSIGNMENT_BUDGET_WINDOW_HOURS} hours`;
    const others = blockedHunt ? "; every hunt cap remains binding when work is shared with other Sends" : budgeted.length > 1 ? `; the ${budgeted.length - 1} other Send(s) this work belongs to have no room either` : "";
    if (s === null || s.spentUsd === null) {
      return this.refused(
        budgeted.map((x) => x.key),
        `assignment ${this.name(b)}'s ${usd(b.budgetUsd)} budget cannot be checked: a charge on its work ${period} reported no dollar figure, ${usd(s?.heldUsd ?? 0)} held${others}`,
      );
    }
    return this.refused(
      budgeted.map((x) => x.key),
      `assignment ${this.name(b)}'s ${usd(b.budgetUsd)} budget is spent: ${usd(s.spentUsd)} spent, ${usd(s.heldUsd)} held ${period}, ` +
        `and one more Scout's worst case (${usd(this.worstCaseUsd)}) does not fit${others}`,
    );
  }

  /** Check and, when admitted, hold one worst case against every budgeted Send the obligation belongs to. */
  admit(obligationId: string): AssignmentAdmission {
    const verdict = this.check(obligationId);
    if (!verdict.admit || verdict.runsUnder === null) return verdict;
    const held = this.effectiveBudgetsFor(obligationId).map((s) => s.key);
    for (const key of held) this.reserved.set(key, (this.reserved.get(key) ?? 0) + this.worstCaseUsd);
    this.admittedBy.set(verdict.runsUnder, (this.admittedBy.get(verdict.runsUnder) ?? 0) + 1);
    this.reservations.set(obligationId, held);
    return verdict;
  }

  /** Release an admitted Scout's hold and book what it measured to every Send it held against (null = unmeasured). */
  settle(obligationId: string, spentUsd: number | null): void {
    const keys = this.reservations.get(obligationId);
    if (keys === undefined) return;
    this.reservations.delete(obligationId);
    for (const key of keys) {
      this.reserved.set(key, Math.max(0, (this.reserved.get(key) ?? 0) - this.worstCaseUsd));
      if (spentUsd === null || !Number.isFinite(spentUsd)) this.cycleUnmeasured.add(key);
      else this.cycleUsd.set(key, (this.cycleUsd.get(key) ?? 0) + spentUsd);
    }
  }

  private name(spec: AssignmentBudgetSpec): string {
    return `"${spec.label}" (${spec.key})`;
  }

  /** Counted against every budgeted Send that had no room — each held work it reached. */
  private refused(keys: readonly string[], why: string): AssignmentRefusal {
    for (const key of keys) this.refusedBy.set(key, (this.refusedBy.get(key) ?? 0) + 1);
    return { admit: false, code: ASSIGNMENT_BUDGET_CODE, why };
  }
}

/**
 * Arm the gate at cycle start: each budget's rolling-window spend from the
 * canonical ledger. `costs` null means the ledger could not be read.
 */
function chargesForInstruction(charges:Iterable<PricedCharge>, spec:AssignmentBudgetSpec):Iterable<PricedCharge> {
  // A charge with a different exact receipt does not belong here. Older rows
  // without receipts are counted by membership and time.
  return filterIterable(charges,cost=>cost.assignmentRefs===undefined ||
    cost.assignmentRefs.some(mark=>mark.key===spec.key&&mark.ref===spec.ref));
}

export function armAssignmentBudget(input: {
  readonly now: string;
  readonly specs: Iterable<AssignmentBudgetSpec>;
  readonly membership: AssignmentMembership;
  readonly charges: Iterable<PricedCharge> | null;
  readonly worstCaseUsd: number;
  readonly intentsReadable: boolean;
  readonly malformed?: Iterable<MalformedAssignmentBudget>;
  readonly reachedThisCycle?: ReadonlyMap<string, readonly string[]>;
  readonly planner?: PlannerSpool;
}): AssignmentBudgetGate {
  const since = new Date(Date.parse(input.now) - ASSIGNMENT_BUDGET_WINDOW_HOURS * 3_600_000).toISOString();
  const prefix = `assignment-history:${assignmentGateSequence++}`;
  let sequence = 0;
  const snapshot = input.planner?.table<{ sequence: number; value: AssignmentBudgetSpec }>(`${prefix}:specs`, row => String(row.sequence));
  const native: AssignmentBudgetSpec[] = [];
  for (const value of input.specs) { if (snapshot) snapshot.add({ sequence: sequence++, value }); else native.push(value); }
  const specs = snapshot ? snapshot.rows.map(row => row.value) : native;
  const historical = input.planner ? plannerMap<AssignmentSpend>(input.planner, prefix) : new Map<string, AssignmentSpend>();
  if (input.charges !== null) {
    const empty: AssignmentMembers = { created: new Map(), reordered: new Map() };
    for (const spec of specs) historical.set(spec.key, assignmentSpend(chargesForInstruction(input.charges,spec), input.membership.byInstruction.get(instructionReceiptKey(spec.key,spec.ref)) ?? empty, spec.budgetStartedAt ?? since, input.now));
  }
  return new AssignmentBudgetGate({
    specs,
    membership: input.membership,
    historical,
    worstCaseUsd: input.worstCaseUsd,
    costsReadable: input.charges !== null,
    intentsReadable: input.intentsReadable,
    malformed: input.malformed ?? [],
    reachedThisCycle: input.reachedThisCycle ?? new Map(),
    historyReadAt: input.now,
    planner: input.planner,
  });
}

/* ------------------------------------------------------------ the reading */

export interface AssignmentBudgetReading {
  readonly lifetime?: boolean;
  readonly budgetUsd: number;
  readonly windowHours: number;
  readonly since: string;
  readonly until: string;
  readonly spentUsd: number | null;
  readonly heldUsd: number;
  readonly leftUsd: number | null;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
  /** Charges that named no obligation and were counted by their subject. */
  readonly bySubjectRows: number;
  readonly admitted: number;
  readonly refused: number;
}

/** One Send, as the runner read it from the obligations it reached, and its budget as the gate stands. */
export interface AssignmentReading {
  readonly key: string;
  readonly kind: "SCOPE" | "DISPATCH";
  readonly label: string | null;
  readonly ref: string | null;
  readonly members: {
    readonly created: number;
    readonly reordered: number;
    /** Up to READING_LIST_CAP obligation ids of each, sorted. */
    readonly createdSample: readonly string[];
    readonly reorderedSample: readonly string[];
  };
  /** Null when no budget is in force for it; `budgetWhyNot` says why. */
  readonly budget: AssignmentBudgetReading | null;
  readonly budgetWhyNot: string | null;
  /** Visited is not finished; evaluated from each member's own record. Absent on older readings. */
  readonly completion?: AssignmentCompletion | null;
}

export interface AssignmentCycleReading {
  readonly formatVersion: 1;
  readonly at: string;
  readonly costsReadable: boolean;
  readonly intentsReadable: boolean;
  /** The rule for work several Sends reached, in the words the page prints. */
  readonly rule: string;
  readonly assignments: readonly AssignmentReading[];
  /** When present, the array contains examples; every exact Send is in this existing owner-history report. */
  readonly details?: FreshnessDetailReference;
}
export interface StreamedAssignmentCycleReading extends Omit<AssignmentCycleReading, "assignments" | "details"> {
  readonly assignments: AsyncIterable<AssignmentReading> & { readonly length: number };
}

export const SHARED_WORK_RULE =
  "A charge counts toward every Send its work belongs to, so each shows the whole of what its work cost. " +
  "Every applicable total-hunt Anthropic token budget must have room, including concurrent reservations. " +
  "Among rolling-window Sends, shared work may run under the most recent one with room. Other service costs are tracked separately.";

/** The reading the runner writes onto the research state, and the instruction view reads. */
export interface AssignmentCycleReadingInput {
  readonly at: string;
  readonly now: string;
  readonly gate: AssignmentBudgetGate;
  readonly specs: Iterable<AssignmentBudgetSpec>;
  readonly membership: AssignmentMembership;
  readonly charges: Iterable<PricedCharge> | null;
  readonly intentsReadable: boolean;
  /** Labels for Sends with members and no budget in force (from this cycle's targets). */
  readonly labels?: ReadonlyMap<string, string>;
  /** The completion of one assignment, or null when it cannot be evaluated this cycle. */
  readonly completionFor?: (key: string) => AssignmentCompletion | null;
}
let assignmentReadingSequence = 0;
type StreamedAssignmentCycleReadingInput = Omit<AssignmentCycleReadingInput, "completionFor"> & {
  readonly planner: PlannerSpool;
  readonly completionFor?: (key: string) => AssignmentCompletion | null | Promise<AssignmentCompletion | null>;
};
export function assignmentCycleReading(input: StreamedAssignmentCycleReadingInput): StreamedAssignmentCycleReading;
export function assignmentCycleReading(input: AssignmentCycleReadingInput): AssignmentCycleReading;
export function assignmentCycleReading(input: AssignmentCycleReadingInput | StreamedAssignmentCycleReadingInput): AssignmentCycleReading | StreamedAssignmentCycleReading {
  const since = new Date(Date.parse(input.now) - ASSIGNMENT_BUDGET_WINDOW_HOURS * 3_600_000).toISOString();
  const prefix = `assignment-reading:${assignmentReadingSequence++}`;
  const planner = "planner" in input ? input.planner : undefined;
  const specRows = (function* () { for (const spec of input.specs) yield [spec.key, spec] as const; })();
  const specs = planner ? plannerMap(planner, `${prefix}:specs`, specRows) : new Map(specRows);
  const allKeys = (function* () { yield* specs.keys(); yield* input.membership.byKey.keys(); })();
  const keys = planner ? plannerSet(planner, `${prefix}:keys`, allKeys) : [...new Set(allKeys)].sort();
  const empty: AssignmentMembers = { created: new Map(), reordered: new Map() };
  const disk = planner?.table<AssignmentReading>(`${prefix}:rows`, row => row.key);
  const members = (key: string, spec: AssignmentBudgetSpec | null) => spec
    ? input.membership.byInstruction.get(instructionReceiptKey(key, spec.ref)) ?? empty : input.membership.byKey.get(key) ?? empty;
  function rowFor(key: string, spec: AssignmentBudgetSpec | null, m: AssignmentMembers,
    spend: AssignmentSpend | null, samples: { created: string[]; reordered: string[] }, completion: AssignmentCompletion | null): AssignmentReading {
    const state = input.gate.state(key);
    const kind = key.startsWith("dispatch:") ? "DISPATCH" : "SCOPE";
    const reading: AssignmentReading = {
      key,
      kind,
      label: spec?.label ?? input.labels?.get(key) ?? null,
      ref: spec?.ref ?? null,
      members: {
        created: m.created.size,
        reordered: m.reordered.size,
        createdSample: samples.created,
        reorderedSample: samples.reordered,
      },
      budget:
        spec === null || state === null
          ? null
          : {
              budgetUsd: spec.budgetUsd,
              windowHours: ASSIGNMENT_BUDGET_WINDOW_HOURS,
              since: spec.budgetStartedAt ?? since,
              lifetime: Boolean(spec.budgetStartedAt),
              until: input.now,
              spentUsd: state.spentUsd,
              heldUsd: state.heldUsd,
              leftUsd: state.leftUsd,
              measuredRows: spend?.measured ?? 0,
              unmeasuredRows: spend?.unmeasured ?? 0,
              bySubjectRows: spend?.bySubject ?? 0,
              admitted: state.admitted,
              refused: state.refused,
            },
      budgetWhyNot:
        spec !== null
          ? null
          : kind === "DISPATCH"
            ? input.intentsReadable
              ? "sent without a budget of its own, so only the Fleet ceiling bounds paid work on it"
              : "the owner's instructions could not be read, so whether it carries a budget is not known; paid work it reached is held"
            : "this geography is no longer selected, so no budget of its stands",
      completion,
    };
    return reading;
  }
  const header: Omit<AssignmentCycleReading, "assignments" | "details"> = { formatVersion: ASSIGNMENT_BUDGET_FORMAT_VERSION, at: input.at, costsReadable: input.charges !== null, intentsReadable: input.intentsReadable, rule: SHARED_WORK_RULE };
  if (disk) {
    const assignments = {
      get length() { return (keys as Set<string>).size; },
      async *[Symbol.asyncIterator](): AsyncIterableIterator<AssignmentReading> {
        // An outstanding lease's native repository callback gets its event-loop turn
        // before publication starts, and after each bounded member batch below.
        await cooperate();
        for (const key of keys) {
          const cached = disk.read(key);
          if (cached) { yield cached; continue; }
          const spec = specs.get(key) ?? null, m = members(key, spec);
          const samples = { created: await memberSampleCooperatively(m.created.keys()), reordered: await memberSampleCooperatively(m.reordered.keys()) };
          const reading = rowFor(key, spec, m, spec ? input.gate.historicalSpend(key) : null, samples,
            await input.completionFor?.(key) ?? null);
          disk.add(reading);
          yield reading;
          await cooperate();
        }
      },
    };
    return { ...header, assignments };
  }
  const assignments: AssignmentReading[] = [];
  for (const key of keys) {
    const spec = specs.get(key) ?? null, m = members(key, spec);
    const completion = input.completionFor?.(key) ?? null;
    if (completion instanceof Promise) throw new Error("ASYNC_ASSIGNMENT_READING_REQUIRES_PLANNER");
    assignments.push(rowFor(key, spec, m,
      spec && input.charges !== null ? assignmentSpend(chargesForInstruction(input.charges, spec), m, spec.budgetStartedAt ?? since, input.now) : null,
      { created: memberSample(m.created.keys()), reordered: memberSample(m.reordered.keys()) }, completion));
  }
  return { ...header, assignments };
}

/** A value on the research state that is not a reading reads as none, never as "no assignments". */
export function isAssignmentCycleReading(value: unknown): value is AssignmentCycleReading {
  return isVersionedCycleReading(value, ASSIGNMENT_BUDGET_FORMAT_VERSION, "assignments");
}
