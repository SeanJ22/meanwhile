import { createLedger, type BudgetLedger, type SpendHold } from "../budget.ts";
import type { ModelRequest, ModelResponse, ModelTransport } from "../scheduler/scout-executor.ts";

export const SPEND_HOLD_CODE_SEND = "ASSIGNMENT_BUDGET";
export const SPEND_HOLD_CODE_AREA = "SCOPE_BUDGET";
/** The Send and area budgets are rolling 24-hour windows; a hold counts for as long. */
export const SPEND_HOLD_WINDOW_MS = 24 * 3_600_000;

/** How long an unsettled hold can belong to a still-running job: longer than any research round runs. */
export const SPEND_HOLD_STALE_MS = 2 * 3_600_000;
/** How long a settled hold is kept after its cost was recorded: longer than any round's history read is old. */
export const SETTLED_HOLD_RETENTION_MS = 6 * 3_600_000;

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

/** What an admission asks for. */
export interface SpendHoldAdmission {
  readonly holdId: string;
  readonly jobId: string;
  readonly obligationId: string;
  readonly lines: BudgetLines;
  readonly usd: number;
  readonly what: string;
}

export interface SpendHoldStore {
  admit(input: SpendHoldAdmission, now: string): Promise<HoldDecision>;
  /** Book a job's measured spend on its first unsettled hold, zero on the rest (`settleHolds`). Null leaves them standing. */
  settle(input: { readonly jobId: string; readonly usd: number | null; readonly costRecordedAt: string }, now: string): Promise<void>;
  release(holdId: string, now: string): Promise<void>;
  left(lines: readonly BudgetLine[], now: string): Promise<readonly number[]>;
  liveAll(now: string): Promise<Record<string, SpendHold>>;
  /** Delete holds that no longer count, a bounded number at a time; returns how many went. */
  sweep(now: string): Promise<number>;
}

/** How many no-longer-live holds one sweep deletes; the next settle or round end takes the rest. */
export const SPEND_HOLD_SWEEP_LIMIT = 1_000;

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
    left: async (lines, now) => lines.map(line => leftUsd(liveSpendHolds(ledger.spendHolds, now), line, now)),
    liveAll: async (now) => copy(liveSpendHolds(ledger.spendHolds, now)),
    rows: () => copy({ ...(ledger.spendHolds ?? {}) }),
    sweep: async (now) => {
      const before = Object.keys(ledger.spendHolds ?? {}).length;
      ledger = { ...ledger, spendHolds: liveSpendHolds(ledger.spendHolds, now) };
      return before - Object.keys(ledger.spendHolds ?? {}).length;
    },
  };
}

export function readLiveSpendHolds(repos: { readonly spendHolds: SpendHoldStore }, now: string): Promise<Record<string, SpendHold>> {
  return repos.spendHolds.liveAll(now);
}

export class DurableSpendHolds {
  private readonly store: SpendHoldStore;
  private readonly now: () => string;

  constructor(deps: { readonly store: SpendHoldStore; readonly now: () => string }) {
    this.store = deps.store;
    this.now = deps.now;
  }

  async hold(input: SpendHoldAdmission): Promise<HoldDecision> {
    if (!hasBudgetLines(input.lines)) return { admit: true, hold: null };
    try {
      return await this.store.admit(input, this.now());
    } catch (error) {
      const code = input.lines.sends.length > 0 ? SPEND_HOLD_CODE_SEND : SPEND_HOLD_CODE_AREA;
      return { admit: false, code, why: `the spend holds could not be read or written (${error instanceof Error ? error.message : String(error)}), so ${input.what} cannot be held against its budget; it waits` };
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
      const remaining = await this.store.left(lines, now);
      return lines.map((line, index) => ({ line, leftUsd: remaining[index] }));
    } catch {
      return null;
    }
  }
}

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

export async function releaseOpenJobs(holds: DurableSpendHolds, jobs: Iterable<JobSpend>, now: string): Promise<readonly string[]> {
  const failed: string[] = [];
  for (const job of jobs) {
    const error = await holds.settle(job.jobId, Math.max(0, job.committedUsd), now);
    if (error !== null) failed.push(`${job.jobId}: ${error}`);
  }
  return failed;
}

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

/** The jurisdiction one piece of autonomous work researches: its subject, and its state when the subject's id does not say it. */
export interface AutonomousJurisdiction {
  readonly subjectId: string;
  readonly state: string | null;
}

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
