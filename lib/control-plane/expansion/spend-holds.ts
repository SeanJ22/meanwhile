/**
 * **MW-021 — A SEND'S BUDGET AND AN AREA'S BUDGET ARE HARD CAPS.**
 * (2026-09-25. Sean, 10:00 PM MST: "Fix and verify hard Send budgets,
 * including concurrent work, retries and escalations.")
 *
 * The per-assignment and per-scope gates (`assignment-budget.ts`,
 * `membership.ts`) decide, per cycle and in memory, whether a Send or an area
 * can be checked at all and what it had spent at cycle start. That is not a
 * cap on its own: a flat $0.60 was held for a Scout that can cost $4 and more,
 * follow-up model calls were held only against the Fleet ceiling, and two
 * cycles (or a crash) could each spend against the same remaining dollars.
 *
 * This module is the cap. Every dollar paid work may spend on a budgeted Send
 * or area is HELD first, in one shared store of holds (since schema v24 the
 * `cp_spend_holds` table, one row per hold, admitted by one database call that
 * locks the lines it touches; before it, and behind `WTP_SPEND_HOLDS_TABLE=0`,
 * the shared budget ledger row under its compare-and-set), so concurrent
 * Scouts in one cycle and Scouts in overlapping cycles decide against the same
 * remaining budget, and no two can both pass a check only one can afford.
 *
 * ```
 *   committed(line) = the line's rolling-window spend at cycle start (the
 *                     canonical cost ledger, read at `historyReadAt`)
 *                   + every hold on it in the window that is not settled
 *                     (the whole worst case: a running job, or a crash)
 *                   + every settled hold whose cost was recorded after that
 *                     read (its measured spend: not yet in the history)
 *   left(line)      = budget − committed(line)
 * ```
 *
 * - A job (one Scout dispatch) holds its worst case before it starts
 *   (`scoutJobWorstCaseUsd`). Every model request it makes is checked against
 *   what the job holds (`budgetGuardedTransport`); a request past it — an
 *   escalation, a grace turn — must first win a further hold, or it is refused
 *   before it is sent. A pre-warm holds its own worst case the same way.
 * - Sends: a hold is admitted while ANY budgeted Send the work belongs to has
 *   room (the shared-work rule), and is held against every one of them. Areas:
 *   EVERY binding area must have room.
 * - Settling a job books what it measured and releases the rest. An unmeasured
 *   job or a failed settle leaves the whole hold standing; a round that ends,
 *   or fails where it can still act, releases every job it never settled
 *   (`releaseOpenJobs`). A hold is live only while its job can still run: an
 *   unsettled hold older than `SPEND_HOLD_STALE_MS` belongs to a round that has
 *   ended (a killed round cannot release its own), and whatever its job sent
 *   is in the canonical cost ledger by then, so it stops counting and is
 *   deleted. A settled hold is deleted once its cost is in the history every
 *   reader starts from (`SETTLED_HOLD_RETENTION_MS`). Holds are never
 *   accumulated (the ledger row held 19,719 of them, 38 MB, on 2026-10-06).
 * - The ledger unreadable or a write refused: the hold is refused, by name.
 *   Nothing is ever run unbudgeted.
 */

import { createLedger, type BudgetLedger, type SpendHold } from "../budget.ts";
import { ConcurrentModification, RepositoryLockHeld, UnknownAggregate, type BudgetRepository } from "../repository/types.ts";
import type { ModelRequest, ModelResponse, ModelTransport } from "../scheduler/scout-executor.ts";

export const SPEND_HOLD_CODE_SEND = "ASSIGNMENT_BUDGET";
export const SPEND_HOLD_CODE_AREA = "SCOPE_BUDGET";
/** The Send and area budgets are rolling 24-hour windows; a hold counts for as long. */
export const SPEND_HOLD_WINDOW_MS = 24 * 3_600_000;

/**
 * How long an unsettled hold can belong to a job that is still running. A job
 * never outlives the research round that took it, and no round runs this long
 * (the runner ends a silent one after 10 minutes; the dispatch slice is 15).
 */
export const SPEND_HOLD_STALE_MS = 2 * 3_600_000;
/** How long a settled hold is kept after its cost was recorded: longer than any round's history read is old. */
export const SETTLED_HOLD_RETENTION_MS = 6 * 3_600_000;

/** Contention on the one ledger (another Scout or cycle mid-decision) is retried this many times, waiting a little longer each time, then refused. */
export const SPEND_HOLD_CONTENTION_TRIES = 20;
export const SPEND_HOLD_CONTENTION_WAIT_MS = 10;
const defaultSleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** One area's line key. */
export const areaBudgetKey = (scopeKey: string): string => `area:${scopeKey}`;

/** One budget a hold is checked against, as the cycle read it at its start. */
export interface BudgetLine {
  /** `send:<assignment key>` or `area:<scope key>`. */
  readonly key: string;
  readonly label: string;
  readonly budgetUsd: number;
  /** Rolling-window spend from the canonical cost ledger, read at `historyReadAt`. */
  readonly historicalUsd: number;
  readonly historyReadAt: string;
  readonly lifetime?: boolean;
}

/** The lines one piece of work is held against: one Send with room suffices; every area must have room. */
export interface BudgetLines {
  readonly sends: readonly BudgetLine[];
  readonly areas: readonly BudgetLine[];
}

export const NO_BUDGET_LINES: BudgetLines = { sends: [], areas: [] };

export const hasBudgetLines = (lines: BudgetLines): boolean => lines.sends.length + lines.areas.length > 0;

export type HoldDecision =
  | { readonly admit: true; readonly hold: SpendHold | null }
  | { readonly admit: false; readonly code: string; readonly why: string };

const usd = (n: number): string => `$${n.toFixed(2)}`;

function inWindow(hold: SpendHold, nowMs: number): boolean {
  return Date.parse(hold.heldAt) >= nowMs - SPEND_HOLD_WINDOW_MS;
}

/** What one line has committed: history, every live hold, and settled spend the history has not seen. */
export function committedUsd(holds: Readonly<Record<string, SpendHold>>, line: BudgetLine, now: string): number {
  const nowMs = Date.parse(now);
  const readMs = Date.parse(line.historyReadAt);
  let total = line.historicalUsd;
  for (const h of Object.values(holds)) {
    if (!h.keys.includes(line.key) || (!line.lifetime && !inWindow(h, nowMs))) continue;
    if (h.settled === null) total += h.usd;
    else if (Date.parse(h.settled.costRecordedAt) > readMs) total += h.settled.usd;
  }
  return total;
}

export function leftUsd(holds: Readonly<Record<string, SpendHold>>, line: BudgetLine, now: string): number {
  // Normalize binary subtraction at nanodollar precision; otherwise an exact-fit
  // reservation can fail by a floating-point ulp. No spend-sized epsilon is added.
  return Math.round((line.budgetUsd - committedUsd(holds, line, now)) * 1e9) / 1e9;
}

/** A hold that still counts: its job can still run, or its settled cost is newer than any history a reader started from. */
function live(h: SpendHold, nowMs: number): boolean {
  if (!h.lifetimeKeys?.length && !inWindow(h, nowMs)) return false;
  if (h.settled === null) return Date.parse(h.heldAt) >= nowMs - SPEND_HOLD_STALE_MS;
  return Date.parse(h.settled.costRecordedAt) >= nowMs - SETTLED_HOLD_RETENTION_MS;
}

/** The holds that count now. Every reader of the ledger (admission, Admin's Set aside, the Fleet's window) reads through this. */
export function liveSpendHolds(holds: Readonly<Record<string, SpendHold>> | undefined, now: string): Record<string, SpendHold> {
  const nowMs = Date.parse(now);
  const out: Record<string, SpendHold> = {};
  for (const [id, h] of Object.entries(holds ?? {})) if (live(h, nowMs)) out[id] = h;
  return out;
}

function pruned(ledger: BudgetLedger, now: string): Record<string, SpendHold> {
  return liveSpendHolds(ledger.spendHolds, now);
}

/** The refusal for a worst case that is not a measured amount. */
export function invalidAmountRefusal(input: { readonly usd: number; readonly what: string }): HoldDecision {
  return { admit: false, code: SPEND_HOLD_CODE_SEND, why: `${input.what}'s worst case (${String(input.usd)}) is not a measured amount, so no budget can be checked` };
}

/** The refusal when no Send the work belongs to has room; `left` is what the first one has left. */
export function sendRefusal(input: { readonly lines: BudgetLines; readonly usd: number; readonly what: string }, left: number): HoldDecision {
  const l = input.lines.sends[0];
  const others = input.lines.sends.length > 1 ? `; the ${input.lines.sends.length - 1} other Send(s) this work belongs to have no room either` : "";
  return {
    admit: false,
    code: SPEND_HOLD_CODE_SEND,
    why: `${l.label}'s ${usd(l.budgetUsd)} budget has ${usd(Math.max(0, left))} left ${l.lifetime ? "for this hunt (Anthropic tokens)" : "in the rolling 24 hours"} (spent and held, across every cycle), and ${input.what}'s worst case (${usd(input.usd)}) does not fit${others}`,
  };
}

/** The refusal when an area (or a lifetime Send) has less left than the worst case. */
export function areaRefusal(input: { readonly usd: number; readonly what: string }, l: BudgetLine, left: number): HoldDecision {
  return {
    admit: false,
    code: SPEND_HOLD_CODE_AREA,
    why: `${l.label} has ${usd(Math.max(0, left))} of its ${usd(l.budgetUsd)} ${l.lifetime ? "Anthropic budget for this hunt" : "rolling 24-hour budget"} left (spent and held, across every cycle), and ${input.what}'s worst case (${usd(input.usd)}) would exceed it`,
  };
}

/** The lines whose EVERY one must have room, in the order they are checked: every area, then every lifetime Send. */
export function everyLineMustFit(lines: BudgetLines): readonly BudgetLine[] {
  // A second Send must never authorize exceeding an existing lifetime hunt cap.
  return [...lines.areas, ...lines.sends.filter(l => l.lifetime)];
}

/** The hold an admission writes. */
export function newSpendHold(input: { readonly holdId: string; readonly jobId: string; readonly obligationId: string; readonly lines: BudgetLines; readonly usd: number; readonly what: string; readonly now: string }): SpendHold {
  return {
    holdId: input.holdId,
    jobId: input.jobId,
    obligationId: input.obligationId,
    keys: [...input.lines.sends, ...input.lines.areas].map((l) => l.key),
    lifetimeKeys: [...input.lines.sends, ...input.lines.areas].filter(l => l.lifetime).map(l => l.key),
    usd: input.usd,
    heldAt: input.now,
    what: input.what,
    settled: null,
  };
}

/**
 * The decision, PURE: whether `usd` more fits every line it must, and the
 * ledger with the hold added when it does. Idempotent by `holdId`. The
 * database's `cp_admit_spend_hold` (schema v24) takes the same decision in the
 * same order and its refusals are worded by the same functions above.
 */
export function decideHold(
  ledger: BudgetLedger,
  input: { readonly holdId: string; readonly jobId: string; readonly obligationId: string; readonly lines: BudgetLines; readonly usd: number; readonly what: string; readonly now: string },
): { readonly ledger: BudgetLedger; readonly result: HoldDecision } {
  const holds = pruned(ledger, input.now);
  const existing = holds[input.holdId];
  if (existing !== undefined) return { ledger, result: { admit: true, hold: existing } };
  if (!hasBudgetLines(input.lines)) return { ledger, result: { admit: true, hold: null } };
  if (!Number.isFinite(input.usd) || input.usd < 0) return { ledger, result: invalidAmountRefusal(input) };
  if (input.lines.sends.length > 0 && !input.lines.sends.some((l) => leftUsd(holds, l, input.now) >= input.usd)) {
    return { ledger, result: sendRefusal(input, leftUsd(holds, input.lines.sends[0], input.now)) };
  }
  for (const l of everyLineMustFit(input.lines)) {
    const left = leftUsd(holds, l, input.now);
    if (left < input.usd) return { ledger, result: areaRefusal(input, l, left) };
  }
  const hold = newSpendHold(input);
  return { ledger: { ...ledger, spendHolds: { ...holds, [hold.holdId]: hold } }, result: { admit: true, hold } };
}

/**
 * Settle one job, PURE: book what it measured on its first hold, zero on the
 * rest, so the lines carry exactly its measured spend until the history does.
 * Unmeasured (`null`): every hold stays standing for its window.
 */
export function settleHolds(ledger: BudgetLedger, input: { readonly jobId: string; readonly usd: number | null; readonly costRecordedAt: string; readonly now: string }): BudgetLedger {
  const holds = pruned(ledger, input.now);
  if (input.usd === null || !Number.isFinite(input.usd)) return { ...ledger, spendHolds: holds };
  const mine = Object.values(holds)
    .filter((h) => h.jobId === input.jobId && h.settled === null)
    .sort((a, b) => (a.heldAt < b.heldAt ? -1 : a.heldAt > b.heldAt ? 1 : a.holdId < b.holdId ? -1 : 1));
  mine.forEach((h, i) => {
    holds[h.holdId] = { ...h, settled: { usd: i === 0 ? Math.max(0, input.usd as number) : 0, costRecordedAt: input.costRecordedAt } };
  });
  return { ...ledger, spendHolds: holds };
}

/** Drop a hold that was taken and never used (its work was refused elsewhere before any spend). PURE. */
export function releaseHold(ledger: BudgetLedger, holdId: string, now: string): BudgetLedger {
  const holds = pruned(ledger, now);
  delete holds[holdId];
  return { ...ledger, spendHolds: holds };
}

/* ------------------------------------------------------------ where the holds live */

/**
 * **ONE ROW PER HOLD.** (Schema v24, 2026-10-06. Sean: "Split the giant
 * single-row records into real tables, one row per item: the spend ledger
 * (holds) ... Settled holds are cleared or moved out, never accumulated.")
 *
 * The holds lived inside the one shared budget ledger row, so every admission
 * read and compare-and-set the whole row (38 MB at its worst, the largest
 * control-plane transfer). They now live in `cp_spend_holds`, one row each,
 * and an admission is one database call (`cp_admit_spend_hold`) that locks
 * only the lines it touches, reads only their live holds, and deletes the
 * holds on them that no longer count. The rule above is unchanged.
 *
 * `WTP_SPEND_HOLDS_TABLE=0` is the way back: the holds are read and written on
 * the ledger row as before (and the bootstrap leaves the row's holds where
 * they are). Anything else, or unset, is the table.
 */
export const SPEND_HOLDS_TABLE_VAR = "WTP_SPEND_HOLDS_TABLE";

export function spendHoldsTableEnabled(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env[SPEND_HOLDS_TABLE_VAR]?.trim() !== "0";
}

/** What an admission asks for. */
export interface SpendHoldAdmission {
  readonly holdId: string;
  readonly jobId: string;
  readonly obligationId: string;
  readonly lines: BudgetLines;
  readonly usd: number;
  readonly what: string;
}

/**
 * The holds, wherever they are kept. Every method is atomic on its own; an
 * admission decides and writes in one exclusive step for the lines it names.
 * `liveFor` / `liveAll` return only holds that still count (`liveSpendHolds`).
 */
export interface SpendHoldStore {
  admit(input: SpendHoldAdmission, now: string): Promise<HoldDecision>;
  /** Book a job's measured spend on its first unsettled hold, zero on the rest (`settleHolds`). Null leaves them standing. */
  settle(input: { readonly jobId: string; readonly usd: number | null; readonly costRecordedAt: string }, now: string): Promise<void>;
  release(holdId: string, now: string): Promise<void>;
  liveFor(keys: readonly string[], now: string): Promise<Record<string, SpendHold>>;
  liveAll(now: string): Promise<Record<string, SpendHold>>;
  /** Delete holds that no longer count, a bounded number at a time; returns how many went. */
  sweep(now: string): Promise<number>;
}

/** How many no-longer-live holds one sweep deletes; the next settle or round end takes the rest. */
export const SPEND_HOLD_SWEEP_LIMIT = 1_000;

const onKeys = (holds: Record<string, SpendHold>, keys: readonly string[]): Record<string, SpendHold> => {
  const want = new Set(keys);
  return Object.fromEntries(Object.entries(holds).filter(([, h]) => h.keys.some((k) => want.has(k))));
};

/**
 * The holds in this process (the memory store), by the same pure rules: the
 * decision is `decideHold`, a settle is `settleHolds`, a release
 * `releaseHold`, and each one drops every hold that no longer counts, so the
 * map never accumulates. JavaScript runs each call to completion between
 * awaits, so each one is atomic.
 */
export interface InProcessSpendHoldStore extends SpendHoldStore {
  /** Every row the store still holds, live or not yet dropped: what a test asserts was deleted. */
  rows(): Record<string, SpendHold>;
}

export function inProcessSpendHoldStore(): InProcessSpendHoldStore {
  let ledger: BudgetLedger = { ...createLedger({ hosts: [] }), spendHolds: {} };
  const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
  return {
    admit: async (input, now) => {
      const decided = decideHold(ledger, { ...input, now });
      ledger = decided.ledger;
      return copy(decided.result);
    },
    settle: async (input, now) => { ledger = settleHolds(ledger, { ...input, now }); },
    release: async (holdId, now) => { ledger = releaseHold(ledger, holdId, now); },
    liveFor: async (keys, now) => copy(onKeys(liveSpendHolds(ledger.spendHolds, now), keys)),
    liveAll: async (now) => copy(liveSpendHolds(ledger.spendHolds, now)),
    rows: () => copy({ ...(ledger.spendHolds ?? {}) }),
    sweep: async (now) => {
      const before = Object.keys(ledger.spendHolds ?? {}).length;
      ledger = { ...ledger, spendHolds: liveSpendHolds(ledger.spendHolds, now) };
      return before - Object.keys(ledger.spendHolds ?? {}).length;
    },
  };
}

/**
 * The way back (`WTP_SPEND_HOLDS_TABLE=0`), and the file store's holds: the
 * holds on the shared budget ledger row. Every decision is one
 * `BudgetRepository.mutate`: an exclusive section and a compare-and-set, so a
 * concurrent writer (another Scout, another cycle) cannot slip between the
 * read and the write. Another writer holding the section, or winning the
 * compare-and-set first, is contention, not failure: the decision is taken
 * again on what that writer left, a bounded number of times
 * (`SPEND_HOLD_CONTENTION_TRIES`), and then refused.
 */
export function ledgerSpendHoldStore(budget: Pick<BudgetRepository, "mutate" | "install" | "read">, sleep: (ms: number) => Promise<void> = defaultSleep): SpendHoldStore {
  const mutate = async <R>(fn: (ledger: BudgetLedger) => { readonly ledger: BudgetLedger; readonly result: R }, now: string): Promise<R> => {
    let installed = false;
    for (let attempt = 1; ; attempt += 1) {
      try {
        return (await budget.mutate(fn, now)).result;
      } catch (error) {
        /* A ledger never installed is installed empty, once. */
        if (!installed && error instanceof UnknownAggregate) {
          installed = true;
          await budget.install(createLedger({ hosts: [] }), now).catch(() => undefined);
          continue;
        }
        const contention = error instanceof RepositoryLockHeld || error instanceof ConcurrentModification;
        if (!contention || attempt >= SPEND_HOLD_CONTENTION_TRIES) throw error;
        await sleep(SPEND_HOLD_CONTENTION_WAIT_MS * attempt);
      }
    }
  };
  const live = async (now: string): Promise<Record<string, SpendHold>> => {
    try {
      return liveSpendHolds((await budget.read()).value.spendHolds, now);
    } catch (error) {
      /* Never installed: no hold has ever been taken. */
      if (error instanceof UnknownAggregate) return {};
      throw error;
    }
  };
  return {
    admit: (input, now) => mutate((ledger) => decideHold(ledger, { ...input, now }), now),
    settle: async (input, now) => { await mutate((ledger) => ({ ledger: settleHolds(ledger, { ...input, now }), result: null }), now); },
    release: async (holdId, now) => { await mutate((ledger) => ({ ledger: releaseHold(ledger, holdId, now), result: null }), now); },
    liveFor: async (keys, now) => onKeys(await live(now), keys),
    liveAll: live,
    /* Every write on the ledger already drops what no longer counts. */
    sweep: async () => 0,
  };
}

/** The store a caller's repositories give: the table unless the switch says the ledger row, or the store has no table. */
export function spendHoldStoreOf(
  repos: { readonly budget: Pick<BudgetRepository, "mutate" | "install" | "read">; readonly spendHolds?: SpendHoldStore },
  options: { readonly sleep?: (ms: number) => Promise<void>; readonly env?: Readonly<Record<string, string | undefined>> } = {},
): SpendHoldStore {
  return spendHoldsTableEnabled(options.env) && repos.spendHolds !== undefined ? repos.spendHolds : ledgerSpendHoldStore(repos.budget, options.sleep);
}

/** Every hold that counts now, for readers (Admin's Set aside, the round's Fleet window). Throws when it cannot be read. */
export function readLiveSpendHolds(
  repos: { readonly budget: Pick<BudgetRepository, "mutate" | "install" | "read">; readonly spendHolds?: SpendHoldStore },
  now: string,
  env?: Readonly<Record<string, string | undefined>>,
): Promise<Record<string, SpendHold>> {
  return spendHoldStoreOf(repos, { env }).liveAll(now);
}

/* ------------------------------------------------------------ the durable holds */

/**
 * The holds paid work takes, on the store `spendHoldStoreOf` picks (the
 * `cp_spend_holds` table; the shared ledger row behind the switch). A store
 * failure refuses the hold, by name.
 */
export class DurableSpendHolds {
  private readonly store: SpendHoldStore;
  private readonly now: () => string;

  constructor(deps: {
    readonly budget: Pick<BudgetRepository, "mutate" | "install" | "read">;
    /** The repositories' `spendHolds` table; absent, the holds live on the ledger row. */
    readonly table?: SpendHoldStore;
    readonly now: () => string;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly env?: Readonly<Record<string, string | undefined>>;
  }) {
    this.store = spendHoldStoreOf({ budget: deps.budget, ...(deps.table ? { spendHolds: deps.table } : {}) }, { sleep: deps.sleep, env: deps.env });
    this.now = deps.now;
  }

  async hold(input: SpendHoldAdmission): Promise<HoldDecision> {
    if (!hasBudgetLines(input.lines)) return { admit: true, hold: null };
    try {
      return await this.store.admit(input, this.now());
    } catch (error) {
      const code = input.lines.sends.length > 0 ? SPEND_HOLD_CODE_SEND : SPEND_HOLD_CODE_AREA;
      return { admit: false, code, why: `the shared budget ledger could not be read or written (${error instanceof Error ? error.message : String(error)}), so ${input.what} cannot be held against its budget; it waits` };
    }
  }

  /** Book a job's measured spend and release the rest. A failure leaves the whole hold standing (it counts until its window ends) and is returned for the caller to name. */
  async settle(jobId: string, spentUsd: number | null, costRecordedAt: string): Promise<string | null> {
    try {
      await this.store.settle({ jobId, usd: spentUsd, costRecordedAt }, this.now());
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async release(holdId: string): Promise<void> {
    await this.store.release(holdId, this.now()).catch(() => undefined);
  }

  /** Delete holds that no longer count (a round's end). Never fails the caller; returns how many went, or null. */
  async sweep(): Promise<number | null> {
    return this.store.sweep(this.now()).catch(() => null);
  }

  /** Read-only: what each line has left now, across every cycle; null when the holds cannot be read. */
  async left(lines: readonly BudgetLine[]): Promise<{ readonly line: BudgetLine; readonly leftUsd: number }[] | null> {
    try {
      const now = this.now();
      const holds = await this.store.liveFor(lines.map((l) => l.key), now);
      return lines.map((line) => ({ line, leftUsd: leftUsd(holds, line, now) }));
    } catch {
      return null;
    }
  }
}

/* ------------------------------------------------------------ one job */

export class SendBudgetRefusal extends Error {
  readonly code: string;
  readonly why: string;

  constructor(code: string, why: string) {
    super(`${code}: ${why}`);
    this.name = "SendBudgetRefusal";
    this.code = code;
    this.why = why;
  }
}

/**
 * One paid job's holds: the worst case it was admitted on, and every further
 * hold it had to win (an escalation, a request past its hold). `committedUsd`
 * is what its requests have spent or have in flight — a failed request keeps
 * its worst case committed, since what it was billed is unknown.
 */
export class JobSpend {
  heldUsd = 0;
  committedUsd = 0;
  private extensions = 0;

  private readonly holds: DurableSpendHolds;
  readonly jobId: string;
  readonly obligationId: string;
  readonly lines: BudgetLines;

  constructor(holds: DurableSpendHolds, jobId: string, obligationId: string, lines: BudgetLines) {
    this.holds = holds;
    this.jobId = jobId;
    this.obligationId = obligationId;
    this.lines = lines;
  }

  /** Hold `usd` more against the job's lines before spending it. */
  async extend(usd: number, what: string): Promise<HoldDecision> {
    this.extensions += 1;
    const decision = await this.holds.hold({ holdId: `${this.jobId}#${this.extensions}`, jobId: this.jobId, obligationId: this.obligationId, lines: this.lines, usd, what });
    if (decision.admit) this.heldUsd += usd;
    return decision;
  }

  /** The job's first hold: its worst case, before it starts. */
  async admit(worstCaseUsd: number, what: string): Promise<HoldDecision> {
    const decision = await this.holds.hold({ holdId: `${this.jobId}#0`, jobId: this.jobId, obligationId: this.obligationId, lines: this.lines, usd: worstCaseUsd, what });
    if (decision.admit) this.heldUsd += worstCaseUsd;
    return decision;
  }
}

/**
 * A round ending (or failing where it can still act) settles every job it
 * never settled: what the job's requests committed (measured, or their worst
 * case when unpriced), so a job that never sent releases its whole hold.
 * Returns the jobs whose settle failed, by id.
 */
export async function releaseOpenJobs(holds: DurableSpendHolds, jobs: Iterable<JobSpend>, now: string): Promise<readonly string[]> {
  const failed: string[] = [];
  for (const job of jobs) {
    const error = await holds.settle(job.jobId, Math.max(0, job.committedUsd), now);
    if (error !== null) failed.push(`${job.jobId}: ${error}`);
  }
  return failed;
}

/**
 * Every model request a job makes, checked against what the job holds on its
 * Send and area budgets before it is sent (MW-021, 2026-09-25). A request
 * whose worst case would pass the hold must first win a further hold for the
 * difference; refused, it throws `SendBudgetRefusal` and nothing is sent.
 * `job()` null: no Send or area budget applies to this work, and the request
 * passes unchanged.
 */
export function budgetGuardedTransport(input: {
  readonly transport: ModelTransport;
  readonly job: () => JobSpend | null;
  readonly worstCaseOf: (request: ModelRequest) => number | null;
  readonly priceOf: (response: ModelResponse) => number | null;
}): ModelTransport {
  return async (request) => {
    const job = input.job();
    if (job === null) return input.transport(request);
    const worst = input.worstCaseOf(request);
    if (worst === null) throw new SendBudgetRefusal(SPEND_HOLD_CODE_SEND, `model ${request.model} has no stated rate, so the request's worst case cannot be held against the budget`);
    const need = job.committedUsd + worst - job.heldUsd;
    if (need > 0) {
      const more = await job.extend(need, "a model request past the job's hold");
      if (!more.admit) throw new SendBudgetRefusal(more.code, more.why);
    }
    job.committedUsd += worst;
    const response = await input.transport(request);
    const priced = input.priceOf(response);
    /* Priced: the worst case gives way to the measured cost. Unpriced: the worst case stays committed. */
    if (priced !== null) job.committedUsd += priced - worst;
    return response;
  };
}

/* ------------------------------------------------------------ autonomous work */

/** The jurisdiction one piece of autonomous work researches: its subject, and its state when the subject's id does not say it. */
export interface AutonomousJurisdiction {
  readonly subjectId: string;
  readonly state: string | null;
}

/**
 * **AUTONOMOUS WORK: THE AREA IT RESEARCHES, NEVER ANOTHER SEND.** (MW-021,
 * 2026-09-25; an engineering choice, the coordinator's correction.) The
 * autonomous Fleet's Scouts and its auditor belong to no Send, so no Send's
 * budget binds them and an unrelated Send running out never stops them. Each
 * request must fit the Fleet ceiling (the wrapped transport's own guard) and
 * the area budget(s) covering the jurisdiction the job researches — matched
 * by the one rule the Scouts' areas use (`ScopeBudgetGate.bindingScopes`).
 *
 * Each request holds its own worst case on those areas before it is sent,
 * atomically on the shared ledger, and settles to its measured cost; a
 * request that failed after it may have been sent keeps its whole hold (what
 * it was billed is unknown). Fail closed: an area budget that cannot be read,
 * or a ledger that cannot, refuses the request before it is sent. No area
 * covers the jurisdiction: the request passes to the Fleet guard unchanged.
 */
export function areaGuardedTransport(input: {
  readonly transport: ModelTransport;
  readonly holds: DurableSpendHolds;
  readonly jurisdiction: AutonomousJurisdiction;
  /** The area lines covering it, or why they cannot be read. */
  readonly areasFor: (jurisdiction: AutonomousJurisdiction) => { readonly areas: readonly BudgetLine[] } | { readonly code: string; readonly why: string };
  readonly worstCaseOf: (request: ModelRequest) => number | null;
  readonly priceOf: (response: ModelResponse) => number | null;
  /** A fresh hold id per request. */
  readonly nextHoldId: () => string;
  readonly now: () => string;
  /** True for an error thrown before the request left (a Fleet refusal): its hold is released. */
  readonly refusedBeforeSending?: (error: unknown) => boolean;
}): ModelTransport {
  return async (request) => {
    const found = input.areasFor(input.jurisdiction);
    if ("code" in found) throw new SendBudgetRefusal(found.code, found.why);
    if (found.areas.length === 0) return input.transport(request);
    const worst = input.worstCaseOf(request);
    if (worst === null) throw new SendBudgetRefusal(SPEND_HOLD_CODE_AREA, `model ${request.model} has no stated rate, so the request's worst case cannot be held against the area budget`);
    const holdId = input.nextHoldId();
    const what = `an autonomous request on ${input.jurisdiction.subjectId}`;
    const held = await input.holds.hold({ holdId, jobId: holdId, obligationId: input.jurisdiction.subjectId, lines: { sends: [], areas: found.areas }, usd: worst, what });
    if (!held.admit) throw new SendBudgetRefusal(held.code, held.why);
    let response: ModelResponse;
    try {
      response = await input.transport(request);
    } catch (error) {
      if (input.refusedBeforeSending?.(error) === true) await input.holds.release(holdId);
      throw error;
    }
    const priced = input.priceOf(response);
    /* Unpriced: the whole hold keeps counting. A failed settle leaves it standing too, which only holds work back. */
    if (priced !== null) await input.holds.settle(holdId, priced, input.now());
    return response;
  };
}
