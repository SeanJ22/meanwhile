/**
 * **MW-021 — A BUDGET ON ONE ASSIGNMENT, AND THE RUNNER HONOURS IT.**
 * (2026-09-25; MW-001 is what makes it possible.)
 *
 * An assignment is one owner Send: a selected geography (`expansion.scope.set`,
 * keyed by its scope key) or a DISPATCH (`fleet.deployHere`, keyed
 * `dispatch:<intent id>`). What belongs to it is read from the obligations
 * themselves — every row whose `assignments` names it, CREATED or REORDERED
 * (`dispatch-work.ts`) — never re-joined by place.
 *
 * ```
 *   budget     a geography's rolling 24-hour budget (the same dollars the
 *              owner set on it), or the budget a DISPATCH was sent with. A
 *              DISPATCH sent without one has none: only the Fleet ceiling
 *              bounds it. A geography no longer selected has none either
 *   spent      every model-backed charge in the rolling 24 hours on a member
 *              obligation, written at or after the obligation joined the
 *              assignment. A charge that names no obligation (written before
 *              charges named one) is counted against every assignment with work
 *              on its subject — an over-count that can only hold work back
 *   held       worst cases reserved for Scouts admitted this cycle and not
 *              yet settled: the Fleet controller's holdback, per assignment
 *   left       budget − spent − held
 * ```
 *
 * ## The rule when one obligation serves several Sends
 *
 * A charge counts toward EVERY Send its obligation belongs to, so each shows
 * the whole of what its work cost and no charge is split or guessed between
 * them. A Scout for that obligation is admitted while ANY budgeted Send it
 * belongs to has room for one more worst case — it runs under the most recent
 * such Send, named in the reading — and it is refused only when none does. Its
 * worst case is held against every one of them until it settles. Sends with no
 * budget of their own add no limit and are never charged.
 *
 * ## Fail closed
 *
 * The ledger unreadable, a charge on the work that reported no dollar figure,
 * or — for work a DISPATCH reached — the owner's instructions unreadable: the
 * budget cannot be checked, so the Scout is held, by name. The reason is always
 * the assignment's own, never the Fleet ceiling's or a provider's cap.
 *
 * No second ledger: history is the canonical cost ledger; in-cycle state is
 * the reservation the Fleet controller already uses (`fleet-safety.ts`), per
 * assignment. PURE: no store, no clock, no environment.
 */

import type { AssignmentCompletion } from "../assignment-completion.ts";
import { isFundedHunt } from "../scheduler/hunt-continuation.ts";
import type { CostEntry } from "../cost.ts";
import { aggregateModelSpend } from "../fleet-safety.ts";
import type { ObligationAssignment } from "../scheduler/obligation.ts";
import type { ResearchIntent } from "../scheduler/research-policy.ts";
import { READING_LIST_CAP, isVersionedCycleReading } from "./reading.ts";
import type { ExpansionScopeDecision } from "./scopes.ts";
import type { BudgetLine } from "./spend-holds.ts";
import { instructionReceiptKey } from "../scheduler/obligation.ts";

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

/**
 * A DISPATCH that carries a budget field that is not a readable amount (not a
 * finite number at or above zero). Fail closed (2026-09-25): its work is held
 * by name, never run as if it had no budget.
 */
export interface MalformedAssignmentBudget {
  readonly key: string;
  readonly label: string;
  /** The value as read, for the refusal. */
  readonly raw: string;
}

/** Every DISPATCH whose budget field is present and unreadable. */
export function malformedAssignmentBudgetsOf(intents: readonly ResearchIntent[]): MalformedAssignmentBudget[] {
  const out: MalformedAssignmentBudget[] = [];
  for (const i of intents) {
    if (i.kind !== "INTENT" || i.action !== "DISPATCH" || !("budgetUsd" in i) || i.budgetUsd === undefined) continue;
    const b: unknown = i.budgetUsd;
    if (typeof b === "number" && Number.isFinite(b) && b >= 0) continue;
    const words = (i.note ?? "").replace(/\s+/g, " ").trim();
    out.push({ key: dispatchAssignmentKey(i.intentId), label: words === "" ? i.intentId : words.slice(0, LABEL_MAX), raw: JSON.stringify(b) ?? String(b) });
  }
  return out;
}

/** One budget line a hold is checked against: `send:<assignment key>` (see `spend-holds.ts`). */
export const sendBudgetKey = (assignmentKey: string): string => `send:${assignmentKey}`;

/**
 * The budgets in force: every selected scope's, and every DISPATCH the owner
 * sent with one (honored or not — an honored Send's work still belongs to it).
 */
export function assignmentBudgetsOf(input: {
  readonly scopes: readonly ExpansionScopeDecision[];
  readonly intents: readonly ResearchIntent[];
}): AssignmentBudgetSpec[] {
  const out: AssignmentBudgetSpec[] = input.scopes.map((d) => ({
    key: d.key,
    kind: "SCOPE",
    label: d.geography.label,
    ref: d.receiptId,
    budgetUsd: d.budgetUsd,
    sentAt: d.decidedAt,
    ...(d.budgetStartedAt ? { budgetStartedAt: d.budgetStartedAt } : {}),
  }));
  for (const i of input.intents) {
    if (i.kind !== "INTENT" || i.action !== "DISPATCH") continue;
    if (typeof i.budgetUsd !== "number" || !Number.isFinite(i.budgetUsd) || i.budgetUsd < 0) continue;
    const words = (i.note ?? "").replace(/\s+/g, " ").trim();
    const label = words === "" ? i.intentId : words.length > LABEL_MAX ? `${words.slice(0, LABEL_MAX - 1).trimEnd()}…` : words;
    out.push({ key: dispatchAssignmentKey(i.intentId), kind: "DISPATCH", label, ref: i.intentId, budgetUsd: i.budgetUsd, sentAt: i.requestedAt });
  }
  return out;
}

/* ------------------------------------------------------------ membership */

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

export interface AssignmentMembership {
  readonly byKey: ReadonlyMap<string, AssignmentMembers>;
  readonly byInstruction: ReadonlyMap<string, AssignmentMembers>;
  /** The assignments each obligation belongs to. */
  readonly keysOf: ReadonlyMap<string, readonly string[]>;
  readonly refsOf: ReadonlyMap<string, readonly { readonly key:string; readonly ref:string }[]>;
}

/**
 * Who belongs to which Send, from the obligations' own records (and anything
 * this cycle recorded after they were read). A row a Send both reordered and
 * later created counts once, as created.
 */
export function assignmentMembership(
  rows: Iterable<{ readonly id: string; readonly subjectId: string; readonly assignments?: readonly ObligationAssignment[] }>,
  recorded: readonly { readonly obligationId: string; readonly subjectId: string; readonly entry: ObligationAssignment }[] = [],
): AssignmentMembership {
  const entries = new Map<string, { subjectId: string; list: ObligationAssignment[] }>();
  const add = (obligationId: string, subjectId: string, entry: ObligationAssignment): void => {
    const held = entries.get(obligationId) ?? { subjectId, list: [] };
    held.list.push(entry);
    entries.set(obligationId, held);
  };
  for (const row of rows) for (const entry of row.assignments ?? []) add(row.id, row.subjectId, entry);
  for (const r of recorded) add(r.obligationId, r.subjectId, r.entry);

  const byKey = new Map<string, { created: Map<string, AssignmentMember>; reordered: Map<string, AssignmentMember> }>();
  const byInstruction = new Map<string, { created: Map<string, AssignmentMember>; reordered: Map<string, AssignmentMember> }>();
  const keysOf = new Map<string, string[]>();
  const refsOf = new Map<string, {key:string;ref:string}[]>();
  for (const [obligationId, { subjectId, list }] of entries) {
    const keys = [...new Set(list.map((e) => e.assignmentKey))];
    keysOf.set(obligationId, keys);
    const refs=[...new Map(list.map(mark=>[instructionReceiptKey(mark.assignmentKey,mark.ref),{key:mark.assignmentKey,ref:mark.ref}])).values()];
    refsOf.set(obligationId,refs);
    for (const {key,ref} of refs) {
      const mine=list.filter(mark=>mark.assignmentKey===key && mark.ref===ref);
      const member:AssignmentMember={obligationId,subjectId,joinedAt:mine.map(mark=>mark.at).sort()[0]??""};
      const identity=instructionReceiptKey(key,ref);
      const slot=byInstruction.get(identity)??{created:new Map(),reordered:new Map()};
      if (mine.some(mark=>mark.relation==="CREATED")) slot.created.set(obligationId,member);
      else slot.reordered.set(obligationId,member);
      byInstruction.set(identity,slot);
    }
    for (const key of keys) {
      const mine = list.filter((e) => e.assignmentKey === key);
      const joinedAt = mine.map((e) => e.at).sort()[0] ?? "";
      const member: AssignmentMember = { obligationId, subjectId, joinedAt };
      const slot = byKey.get(key) ?? { created: new Map(), reordered: new Map() };
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
export function assignmentSpend(costs: readonly CostEntry[], members: AssignmentMembers, since: string, until: string): AssignmentSpend {
  const joinedAt = new Map<string, number>();
  const subjectJoinedAt = new Map<string, number>();
  for (const m of [...members.created.values(), ...members.reordered.values()]) {
    const t = Date.parse(m.joinedAt);
    joinedAt.set(m.obligationId, t);
    subjectJoinedAt.set(m.subjectId, Math.min(subjectJoinedAt.get(m.subjectId) ?? Number.POSITIVE_INFINITY, t));
  }
  const byObligation: CostEntry[] = [];
  const bySubject: CostEntry[] = [];
  for (const entry of costs) {
    const at = Date.parse(entry.recordedAt);
    if (typeof entry.obligationId === "string") {
      const joined = joinedAt.get(entry.obligationId);
      if (joined !== undefined && at >= joined) byObligation.push(entry);
      continue;
    }
    const joined = entry.jurisdiction === null ? undefined : subjectJoinedAt.get(entry.jurisdiction);
    if (joined !== undefined && at >= joined) bySubject.push(entry);
  }
  /* The Fleet's own model-backed and window rule, for both halves. */
  const named = aggregateModelSpend(byObligation, since, until);
  const unnamed = aggregateModelSpend(bySubject, since, until);
  return {
    usd: named.usd === null || unnamed.usd === null ? null : named.usd + unnamed.usd,
    measured: named.measured + unnamed.measured,
    unmeasured: named.unmeasured + unnamed.unmeasured,
    bySubject: unnamed.measured + unnamed.unmeasured,
  };
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
export class AssignmentBudgetGate {
  private readonly specs: ReadonlyMap<string, AssignmentBudgetSpec>;
  private readonly keysOf: ReadonlyMap<string, readonly string[]>;
  private readonly refsOf: ReadonlyMap<string, readonly {readonly key:string;readonly ref:string}[]>;
  private readonly historical: ReadonlyMap<string, AssignmentSpend>;
  private readonly worstCaseUsd: number;
  private readonly costsReadable: boolean;
  private readonly intentsReadable: boolean;
  private readonly cycleUsd = new Map<string, number>();
  private readonly cycleUnmeasured = new Set<string>();
  private readonly reserved = new Map<string, number>();
  private readonly reservations = new Map<string, readonly string[]>();
  private readonly admittedBy = new Map<string, number>();
  private readonly refusedBy = new Map<string, number>();
  private readonly malformed: ReadonlyMap<string, MalformedAssignmentBudget>;
  private readonly reachedThisCycle: ReadonlyMap<string, readonly string[]>;
  private readonly historyReadAt: string;

  constructor(input: {
    readonly specs: readonly AssignmentBudgetSpec[];
    readonly membership: AssignmentMembership;
    /** Rolling-window spend per budgeted assignment at cycle start. Absent for a key: nothing measured, so it cannot be checked. */
    readonly historical: ReadonlyMap<string, AssignmentSpend>;
    readonly worstCaseUsd: number;
    readonly costsReadable: boolean;
    /** False when the owner's instruction log could not be read: no DISPATCH budget can then be known. */
    readonly intentsReadable: boolean;
    /** DISPATCHes whose budget field is unreadable: the work they reach is held. */
    readonly malformed?: readonly MalformedAssignmentBudget[];
    /**
     * The Sends this cycle's own reading reached each obligation under (a
     * pending DISPATCH's match), whether or not the row's record says so yet.
     * A budgeted Send missing from the row's record is held, never run
     * unbudgeted (2026-09-25).
     */
    readonly reachedThisCycle?: ReadonlyMap<string, readonly string[]>;
    /** When `historical` was read (the cycle's instant). */
    readonly historyReadAt?: string;
  }) {
    this.specs = new Map(input.specs.map((s) => [s.key, s]));
    this.keysOf = input.membership.keysOf;
    this.refsOf = input.membership.refsOf;
    this.historical = input.historical;
    this.worstCaseUsd = input.worstCaseUsd;
    this.costsReadable = input.costsReadable;
    this.intentsReadable = input.intentsReadable;
    this.malformed = new Map((input.malformed ?? []).map((m) => [m.key, m]));
    this.reachedThisCycle = input.reachedThisCycle ?? new Map();
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
   * The budget lines a paid job on this obligation is held against, for the
   * durable holds (`spend-holds.ts`): every budgeted Send it belongs to, most
   * recent first (one with room suffices, the shared-work rule) — or the
   * refusal when the budget cannot be checked at all. No lines: no Send budget
   * applies.
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

  /** What this gate was armed with, for the standing hunter lane's reading (CH-24): the Sends and their spend at the read. */
  armedReading(): { readonly specs: readonly AssignmentBudgetSpec[]; readonly historical: ReadonlyMap<string, AssignmentSpend> | null; readonly reached: ReadonlyMap<string, readonly string[]> } {
    return { specs: [...this.specs.values()], historical: this.costsReadable ? this.historical : null, reached: this.reachedThisCycle };
  }

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
function costsForInstruction(costs:readonly CostEntry[], spec:AssignmentBudgetSpec):readonly CostEntry[] {
  // An exact different receipt is known not to belong here. Older ledger rows
  // without receipt attribution remain conservatively counted by membership
  // and time, so a migration cannot mint new allowance from unknown history.
  return costs.filter(cost=>cost.assignmentRefs===undefined ||
    cost.assignmentRefs.some(mark=>mark.key===spec.key&&mark.ref===spec.ref));
}

export function armAssignmentBudget(input: {
  readonly now: string;
  readonly specs: readonly AssignmentBudgetSpec[];
  readonly membership: AssignmentMembership;
  readonly costs: readonly CostEntry[] | null;
  readonly worstCaseUsd: number;
  readonly intentsReadable: boolean;
  readonly malformed?: readonly MalformedAssignmentBudget[];
  readonly reachedThisCycle?: ReadonlyMap<string, readonly string[]>;
}): AssignmentBudgetGate {
  const since = new Date(Date.parse(input.now) - ASSIGNMENT_BUDGET_WINDOW_HOURS * 3_600_000).toISOString();
  const historical = new Map<string, AssignmentSpend>();
  if (input.costs !== null) {
    const empty: AssignmentMembers = { created: new Map(), reordered: new Map() };
    for (const spec of input.specs) historical.set(spec.key, assignmentSpend(costsForInstruction(input.costs,spec), input.membership.byInstruction.get(instructionReceiptKey(spec.key,spec.ref)) ?? empty, spec.budgetStartedAt ?? since, input.now));
  }
  return new AssignmentBudgetGate({
    specs: input.specs,
    membership: input.membership,
    historical,
    worstCaseUsd: input.worstCaseUsd,
    costsReadable: input.costs !== null,
    intentsReadable: input.intentsReadable,
    malformed: input.malformed ?? [],
    reachedThisCycle: input.reachedThisCycle ?? new Map(),
    historyReadAt: input.now,
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
  /** MW-015: visited is not finished; evaluated from each member's own record. Absent on readings written before 2026-09-25. */
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
}

export const SHARED_WORK_RULE =
  "A charge counts toward every Send its work belongs to, so each shows the whole of what its work cost. " +
  "Every applicable total-hunt Anthropic token budget must have room, including concurrent reservations. " +
  "Among rolling-window Sends, shared work may run under the most recent one with room. Other service costs are tracked separately.";

/** The reading the runner writes onto the research state, and the instruction view reads. */
export function assignmentCycleReading(input: {
  readonly at: string;
  readonly now: string;
  readonly gate: AssignmentBudgetGate;
  readonly specs: readonly AssignmentBudgetSpec[];
  readonly membership: AssignmentMembership;
  readonly costs: readonly CostEntry[] | null;
  readonly intentsReadable: boolean;
  /** Labels for Sends with members and no budget in force (from this cycle's targets). */
  readonly labels?: ReadonlyMap<string, string>;
  /** MW-015: the completion of one assignment, or null when it cannot be evaluated this cycle. */
  readonly completionFor?: (key: string) => AssignmentCompletion | null;
}): AssignmentCycleReading {
  const since = new Date(Date.parse(input.now) - ASSIGNMENT_BUDGET_WINDOW_HOURS * 3_600_000).toISOString();
  const specs = new Map(input.specs.map((s) => [s.key, s]));
  const keys = [...new Set([...input.specs.map((s) => s.key), ...input.membership.byKey.keys()])].sort();
  const empty: AssignmentMembers = { created: new Map(), reordered: new Map() };
  const assignments = keys.map((key): AssignmentReading => {
    const spec = specs.get(key) ?? null;
    const m = spec ? input.membership.byInstruction.get(instructionReceiptKey(key,spec.ref)) ?? empty : input.membership.byKey.get(key) ?? empty;
    const state = input.gate.state(key);
    const spend = spec !== null && input.costs !== null ? assignmentSpend(costsForInstruction(input.costs,spec), m, spec.budgetStartedAt ?? since, input.now) : null;
    const kind = key.startsWith("dispatch:") ? "DISPATCH" : "SCOPE";
    return {
      key,
      kind,
      label: spec?.label ?? input.labels?.get(key) ?? null,
      ref: spec?.ref ?? null,
      members: {
        created: m.created.size,
        reordered: m.reordered.size,
        createdSample: [...m.created.keys()].sort().slice(0, READING_LIST_CAP),
        reorderedSample: [...m.reordered.keys()].sort().slice(0, READING_LIST_CAP),
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
      completion: input.completionFor?.(key) ?? null,
    };
  });
  return { formatVersion: ASSIGNMENT_BUDGET_FORMAT_VERSION, at: input.at, costsReadable: input.costs !== null, intentsReadable: input.intentsReadable, rule: SHARED_WORK_RULE, assignments };
}

/** A value on the research state that is not a reading reads as none, never as "no assignments". */
export function isAssignmentCycleReading(value: unknown): value is AssignmentCycleReading {
  return isVersionedCycleReading(value, ASSIGNMENT_BUDGET_FORMAT_VERSION, "assignments");
}
