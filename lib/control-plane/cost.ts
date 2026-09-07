/**
 * THE COST LEDGER — what a run spent, rolled up along the dimensions a
 * SCHEDULER needs.
 *
 * ============================================================================
 * THE INVARIANT OF THIS MODULE, and the reason it is a module rather than a few
 * fields on `Attempt`:
 *
 *     COST INFORMS SCHEDULING. COST NEVER INFORMS TRUTH.
 *
 * Nothing in this file may answer, or help answer, whether a fact is right,
 * whether a record should stand, or whether a correction is worth making. There
 * is no cheap wrong answer and no expensive right one; a claim about a
 * government is right or it is not, and what it cost to establish that has no
 * standing in the question. Cost decides what runs NEXT, how much of it runs at
 * once, and when a run stops — and nothing else.
 *
 * That prohibition is enforced mechanically, not by good intentions: a sweep in
 * `tests/control-plane-policy.test.ts` reads this file's own source and fails if
 * any EXPORTED function is named in the shape of a truth judgement. The sweep
 * ships with a positive control, because a detector nobody has seen fire is a
 * detector nobody has tested.
 * ============================================================================
 *
 * THE OTHER LOAD-BEARING RULE: an unmeasured field is NOT zero.
 *
 * `AttemptCost` fields are nullable because a provider may not report tokens, a
 * transport may not report bytes, and an aborted attempt may report neither.
 * Coercing those nulls to 0 produces a total that LOOKS complete and is not, and
 * a scheduler that believes a run was free will happily schedule a thousand more
 * of them. Every total here therefore travels with `measured` and `unmeasured`
 * counts, and a total over nothing measured is `null` rather than `0`.
 *
 * TIME IS A PARAMETER. Nothing here reads a clock.
 */

import type { Attempt, AttemptCost, WorkerRole } from "./attempt.ts";

/** The invariant, as a string a report can print verbatim. */
export const COST_SCHEDULING_INVARIANT =
  "Cost informs SCHEDULING (what runs next, how much runs at once, when a run stops). " +
  "Cost never informs TRUTH: what a fact cost has no bearing on whether it is right.";

/** ------------------------------------------------------------------ entries */

export const COST_METRICS = [
  "inputTokens",
  "outputTokens",
  "usd",
  "durationMs",
  "bytesFetched",
  "requestCount",
  /* The prompt-cache metering (2026-09-06). Absent on rows recorded before, which `sumMetric` counts as unmeasured. */
  "cacheReadInputTokens",
  "cacheCreationInputTokens",
  "cacheCreation5mInputTokens",
  "cacheCreation1hInputTokens",
  "uncachedInputTokens",
] as const;
export type CostMetric = (typeof COST_METRICS)[number];

/**
 * **THE PARSER FOR THE CACHE FIELDS, AND THE THREE THINGS A ROW CAN SAY.**
 * (2026-09-06.)
 *
 * The ledger is JSON in an append-only log, so a row written before the cache
 * fields existed simply lacks the keys. That row is `PREDATES_FIELDS`: nothing
 * about its cache behaviour was measured, and a digest prints NOT MEASURED for
 * it by name. A row that carries the keys with `null` values is `UNREPORTED`:
 * the request ran and the provider reported no usage (a refusal before any
 * completion). Only a `MEASURED` row contributes token counts to a rate.
 */
export type CacheMetering =
  | { readonly status: "PREDATES_FIELDS" }
  | { readonly status: "UNREPORTED" }
  | {
      readonly status: "MEASURED";
      readonly cacheReadInputTokens: number;
      readonly cacheCreationInputTokens: number;
      /** Null when the response carried the aggregate but no split. */
      readonly cacheCreation5mInputTokens: number | null;
      readonly cacheCreation1hInputTokens: number | null;
      readonly uncachedInputTokens: number;
      readonly batch: boolean;
    };

export function cacheMeteringOf(cost: AttemptCost): CacheMetering {
  const c = cost as Partial<AttemptCost>;
  if (
    c.cacheReadInputTokens === undefined ||
    c.cacheCreationInputTokens === undefined ||
    c.uncachedInputTokens === undefined
  ) {
    return { status: "PREDATES_FIELDS" };
  }
  if (c.cacheReadInputTokens === null || c.cacheCreationInputTokens === null || c.uncachedInputTokens === null) {
    return { status: "UNREPORTED" };
  }
  return {
    status: "MEASURED",
    cacheReadInputTokens: c.cacheReadInputTokens,
    cacheCreationInputTokens: c.cacheCreationInputTokens,
    cacheCreation5mInputTokens: c.cacheCreation5mInputTokens ?? null,
    cacheCreation1hInputTokens: c.cacheCreation1hInputTokens ?? null,
    uncachedInputTokens: c.uncachedInputTokens,
    batch: c.batch === true,
  };
}

export interface CostEntry {
  readonly attemptId: string;
  readonly workItemId: string;
  readonly routeTaskId: string | null;
  /** The route walked, e.g. "INSITE_CALENDAR_GRID". Null for non-route work. */
  readonly routeId: string | null;
  /** The publisher/adapter the spend was against. Null when not attributable. */
  readonly source: string | null;
  /** OCD id or equivalent. Null when the work spans jurisdictions. */
  readonly jurisdiction: string | null;
  readonly project: string;
  readonly role: WorkerRole;
  readonly cost: AttemptCost;
  /** Caller-supplied ISO stamp. This module never reads a clock. */
  readonly recordedAt: string;
}

/**
 * Lift an Attempt into a ledger entry.
 *
 * The Attempt's own `cost` is copied UNCHANGED, nulls included. This function
 * has no defaulting behaviour on purpose — the one place a null could quietly
 * become a zero is the place that reads the measurement, so it does not.
 */
export function costEntryFromAttempt(
  attempt: Attempt,
  context: {
    routeId?: string | null;
    source?: string | null;
    jurisdiction?: string | null;
    project: string;
    recordedAt: string;
  },
): CostEntry {
  return {
    attemptId: attempt.id,
    workItemId: attempt.workItemId,
    routeTaskId: attempt.routeTaskId,
    routeId: context.routeId ?? null,
    source: context.source ?? null,
    jurisdiction: context.jurisdiction ?? null,
    project: context.project,
    role: attempt.worker.role,
    cost: attempt.cost,
    recordedAt: context.recordedAt,
  };
}

/** ------------------------------------------------------------------ rollup */

export const ROLLUP_DIMENSIONS = [
  "workItem",
  "route",
  "source",
  "jurisdiction",
  "project",
  "role",
] as const;
export type RollupDimension = (typeof ROLLUP_DIMENSIONS)[number];

/** The bucket a null dimension key lands in. Named, never silently dropped. */
export const UNATTRIBUTED = "(unattributed)";

/**
 * A total that knows what it does not know.
 *
 * `total` is the sum of the MEASURED values only, and is `null` when nothing was
 * measured — because the sum of no measurements is not zero, it is nothing.
 */
export interface MeasuredTotal {
  readonly total: number | null;
  readonly measured: number;
  readonly unmeasured: number;
  /** True only when every contributing entry reported this metric. */
  readonly complete: boolean;
}

export interface RollupBucket {
  readonly dimension: RollupDimension;
  readonly key: string;
  readonly entryCount: number;
  readonly totals: Readonly<Record<CostMetric, MeasuredTotal>>;
}

function keyOf(entry: CostEntry, dimension: RollupDimension): string {
  switch (dimension) {
    case "workItem":
      return entry.workItemId;
    case "route":
      return entry.routeId ?? UNATTRIBUTED;
    case "source":
      return entry.source ?? UNATTRIBUTED;
    case "jurisdiction":
      return entry.jurisdiction ?? UNATTRIBUTED;
    case "project":
      return entry.project;
    case "role":
      return entry.role;
  }
}

/** Sum one metric across entries, keeping the measured/unmeasured split. */
export function sumMetric(
  entries: readonly CostEntry[],
  metric: CostMetric,
): MeasuredTotal {
  let total = 0;
  let measured = 0;
  let unmeasured = 0;
  for (const entry of entries) {
    const value = entry.cost[metric];
    if (value === null || value === undefined || Number.isNaN(value)) {
      unmeasured += 1;
      continue;
    }
    total += value;
    measured += 1;
  }
  return {
    total: measured === 0 ? null : total,
    measured,
    unmeasured,
    complete: unmeasured === 0 && measured > 0,
  };
}

/**
 * Roll entries up along one dimension.
 *
 * Buckets come back sorted by key so a report is stable across runs, which
 * matters because these reports get diffed.
 */
export function rollup(
  entries: readonly CostEntry[],
  dimension: RollupDimension,
): RollupBucket[] {
  const grouped = new Map<string, CostEntry[]>();
  for (const entry of entries) {
    const key = keyOf(entry, dimension);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(entry);
    else grouped.set(key, [entry]);
  }

  return [...grouped.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, bucketEntries]) => {
      const totals = {} as Record<CostMetric, MeasuredTotal>;
      for (const metric of COST_METRICS) totals[metric] = sumMetric(bucketEntries, metric);
      return { dimension, key, entryCount: bucketEntries.length, totals };
    });
}

/** ------------------------------------------------------------------- caps */

export interface BudgetCheck {
  readonly within: boolean;
  /**
   * False when the check could not actually be made — no cap set, or the spend
   * is unmeasured. An unenforceable check is REPORTED, never quietly passed off
   * as a pass, because "we did not exceed the cap" and "we cannot tell whether
   * we exceeded the cap" are different sentences.
   */
  readonly enforceable: boolean;
  readonly spent: number | null;
  readonly cap: number | null;
  readonly reason: string;
}

/**
 * Is `spent` still under `cap`?
 *
 * The cap FIRES AT the cap: spending exactly the cap is spent, not spare. An
 * off-by-one here is a cap that is never quite reached.
 */
export function withinBudget(
  spent: number | null,
  cap: number | null,
  label = "spend",
): BudgetCheck {
  if (cap === null) {
    return {
      within: true,
      enforceable: false,
      spent,
      cap,
      reason: `No cap is set for ${label}; nothing was enforced.`,
    };
  }
  if (spent === null) {
    return {
      within: true,
      enforceable: false,
      spent,
      cap,
      reason:
        `${label} is UNMEASURED, so the cap of ${cap} could not be enforced. ` +
        "This is reported rather than treated as zero spend.",
    };
  }
  if (spent >= cap) {
    return {
      within: false,
      enforceable: true,
      spent,
      cap,
      reason: `${label} reached its cap: ${spent} of ${cap}.`,
    };
  }
  return {
    within: true,
    enforceable: true,
    spent,
    cap,
    reason: `${label} is within budget: ${spent} of ${cap}.`,
  };
}

export class CostCapExceeded extends Error {
  readonly label: string;
  readonly spent: number | null;
  readonly cap: number | null;

  constructor(check: BudgetCheck, label: string) {
    super(
      `HARD CAP: ${check.reason} Further work under this cap is refused. ` +
        "A hard cap stops SCHEDULING; it says nothing about the work already done.",
    );
    this.name = "CostCapExceeded";
    this.label = label;
    this.spent = check.spent;
    this.cap = check.cap;
  }
}

/** Throw at a hard cap. An unenforceable check never throws — it cannot. */
export function assertWithinHardCap(
  spent: number | null,
  cap: number | null,
  label = "spend",
): void {
  const check = withinBudget(spent, cap, label);
  if (!check.within && check.enforceable) throw new CostCapExceeded(check, label);
}

/** ------------------------------------------------------------- scheduling */

export interface ScheduleDecision {
  /** Whether to START more work now. Purely an ordering/throttling answer. */
  readonly schedule: boolean;
  readonly reason: string;
  /** Every cap that refused, named. */
  readonly refusedBy: readonly string[];
  /** Every cap that could not be enforced, named. Surfaced, never hidden. */
  readonly unenforceable: readonly string[];
}

/**
 * The ONLY question this module answers about work: should more of it START now?
 *
 * Note what is absent and will stay absent: there is no function here that takes
 * a cost and returns anything about whether a record is right, whether a
 * disposition should stand, or whether a correction is worth its price. A
 * cheaply obtained wrong answer is still wrong, and an expensive correction is
 * still owed. See COST_SCHEDULING_INVARIANT.
 */
export function shouldScheduleMoreWork(input: {
  spent: Partial<Record<CostMetric, number | null>>;
  caps: Partial<Record<CostMetric, number | null>>;
}): ScheduleDecision {
  const refusedBy: string[] = [];
  const unenforceable: string[] = [];

  for (const metric of COST_METRICS) {
    const cap = input.caps[metric] ?? null;
    if (cap === null) continue;
    const spent = input.spent[metric] ?? null;
    const check = withinBudget(spent, cap, metric);
    if (!check.enforceable) unenforceable.push(metric);
    else if (!check.within) refusedBy.push(`${metric} (${check.spent} of ${check.cap})`);
  }

  if (refusedBy.length > 0) {
    return {
      schedule: false,
      reason: `Scheduling paused at: ${refusedBy.join("; ")}.`,
      refusedBy,
      unenforceable,
    };
  }
  return {
    schedule: true,
    reason:
      unenforceable.length > 0
        ? `Scheduling permitted; ${unenforceable.join(", ")} could not be enforced (unmeasured).`
        : "Scheduling permitted; every set cap is under its limit.",
    refusedBy,
    unenforceable,
  };
}

/** ------------------------------------------------------- calendar windows */

/**
 * **THE UTC CALENDAR MONTH, AS A LEDGER WINDOW.** (§9A.23 of the Admin C
 * brief, 2026-09-06.)
 *
 * The owner's Claude API funds reset on the first day of each month **UTC**,
 * and no other window in this codebase is that window. The three enforced
 * spend windows are a per-cycle counter, a Phoenix 18:00→06:00 operational
 * night and a *sliding* 24 hours (`fleet-safety.ts`); the console's spend bars
 * are bucketed by EASTERN calendar day; the politeness ledger rolls its
 * request counts over at UTC midnight. None of them is a calendar month, and
 * three of them are in the wrong zone, so this had to be its own window rather
 * than a reuse of any of them.
 *
 * PURE, with the clock as a parameter — the whole reason this is testable at a
 * month boundary and across the UTC/Eastern day edge, where "today" in New York
 * and "today" in UTC name different months for five hours of every month's
 * first day.
 *
 * `until` is INCLUSIVE and is the moment the reading was taken for the current
 * month, or the last millisecond of the month for a past one. Adjacent months
 * therefore neither overlap nor leave a gap, and a row stamped exactly at `now`
 * is counted rather than lost to an exclusive bound.
 */
export interface LedgerWindow {
  /** 00:00:00.000Z on the 1st. Inclusive. */
  readonly since: string;
  /** Inclusive: `nowIso` for the open month, the month's last millisecond for a closed one. */
  readonly until: string;
  /** 00:00:00.000Z on the 1st of the FOLLOWING month — when the funds reset. */
  readonly resetsAt: string;
  /** "September 2026". */
  readonly label: string;
  /** False while the month is still running: a total from it is a running total, not a final one. */
  readonly complete: boolean;
}

const UTC_MONTH_LABEL = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

/**
 * The UTC calendar month containing `nowIso`, or one `monthsBack` before it
 * (1 = the previous month). Throws on an unreadable stamp rather than
 * returning a window over the epoch, which would render as a confident total
 * for a month nobody asked about.
 */
export function utcMonthWindow(nowIso: string, monthsBack = 0): LedgerWindow {
  const now = Date.parse(nowIso);
  if (!Number.isFinite(now)) {
    throw new Error(`utcMonthWindow() cannot read the stamp "${nowIso}". A spend window over an unreadable clock is a total nobody can check.`);
  }
  if (!Number.isInteger(monthsBack) || monthsBack < 0) {
    throw new Error(`utcMonthWindow() counts months BACK from the current one and got ${monthsBack}. There is no spend to report from a month that has not happened.`);
  }
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack + 1, 1);
  const open = monthsBack === 0;
  return {
    since: new Date(start).toISOString(),
    until: open ? new Date(now).toISOString() : new Date(next - 1).toISOString(),
    resetsAt: new Date(next).toISOString(),
    label: UTC_MONTH_LABEL.format(new Date(start)),
    complete: !open,
  };
}

/**
 * The ledger rows recorded inside a window, both bounds inclusive.
 *
 * A row whose `recordedAt` cannot be parsed is DROPPED and never silently
 * counted at the epoch — an unreadable stamp is an unattributable row, and
 * placing it in January 1970 would quietly deflate every month that has one.
 */
export function entriesInWindow(entries: readonly CostEntry[], window: Pick<LedgerWindow, "since" | "until">): readonly CostEntry[] {
  const since = Date.parse(window.since);
  const until = Date.parse(window.until);
  return entries.filter((e) => {
    const at = Date.parse(e.recordedAt);
    return Number.isFinite(at) && at >= since && at <= until;
  });
}

/** ----------------------------------------------------------------- report */

export function describeRollup(buckets: readonly RollupBucket[]): string {
  if (buckets.length === 0) return "COST ROLLUP — no entries.";
  const lines = buckets.map((bucket) => {
    const metrics = COST_METRICS.map((metric) => {
      const t = bucket.totals[metric];
      const value = t.total === null ? "unmeasured" : String(t.total);
      return `${metric}=${value} (measured ${t.measured}, unmeasured ${t.unmeasured})`;
    });
    return `  ${bucket.key} [${bucket.entryCount} entr${bucket.entryCount === 1 ? "y" : "ies"}]\n      ${metrics.join("\n      ")}`;
  });
  return [`COST ROLLUP by ${buckets[0].dimension} — ${buckets.length} bucket(s)`, ...lines].join(
    "\n",
  );
}
