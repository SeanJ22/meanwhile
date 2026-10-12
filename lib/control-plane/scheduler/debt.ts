/** Freshness debt: a failed refresh becomes a durable, self-retrying row (never a notification, an absence or a silent drop), grouped into incidents by root cause. Backoff doubles up to a cap. */

/** Why a refresh did not land. Every cause is transient and retries; a permanent condition is a disposition, not debt. */
export const DEBT_CAUSES = [
  "REFUSED_BY_HOST",
  "RATE_LIMITED",
  "UPSTREAM_ERROR",
  "TRANSPORT_FAILED",
  "WORKER_LOST",
  "EXTRACTION_FAILED",
  "NEVER_DISPATCHED",
  /** The route closed REQUIRES_NEW_ADAPTER: nothing refused us; the reader for this record is not built yet. */
  "AWAITING_ADAPTER",
  /** The route closed DISCOVERED: the record is carried by a routine read on its own clock, which has not yet filled it. */
  "AWAITING_ROUTINE_READ",
] as const;

/**
 * The cause a committed non-reading disposition stands for. Only a wall is a
 * host refusal; a missing adapter or a record a routine read will carry is not,
 * and naming it so would send the owner after a block that does not exist.
 */
export function debtCauseForDisposition(disposition: string): DebtCause {
  return DEBT_CAUSE_BY_DISPOSITION[disposition] ?? "REFUSED_BY_HOST";
}
const DEBT_CAUSE_BY_DISPOSITION: Readonly<Record<string, DebtCause>> = {
  REQUIRES_NEW_ADAPTER: "AWAITING_ADAPTER",
  DISCOVERED: "AWAITING_ROUTINE_READ",
};
export type DebtCause = (typeof DEBT_CAUSES)[number];

/** First retry after 15 minutes. */
export const FIRST_BACKOFF_MINUTES = 15;
/** Six hours: the backoff cap. */
export const MAX_BACKOFF_MINUTES = 360;

export interface FreshnessDebt {
  readonly obligationId: string;
  readonly cause: DebtCause;
  readonly detail: string;
  readonly target: string;
  /** When this obligation was DUE, not when it failed. Debt is measured from owed. */
  readonly dueAt: string;
  readonly firstFailedAt: string;
  readonly lastFailedAt: string;
  readonly consecutiveFailures: number;
  readonly retryAt: string;
}

/** Open or extend the debt for one obligation. `firstFailedAt` never moves; the backoff doubles. */
export function recordFailure(
  existing: FreshnessDebt | null,
  input: {
    readonly obligationId: string;
    readonly cause: DebtCause;
    readonly detail: string;
    readonly target: string;
    readonly dueAt: string;
    readonly now: string;
  },
): FreshnessDebt {
  const failures = (existing?.consecutiveFailures ?? 0) + 1;
  const minutes = Math.min(
    MAX_BACKOFF_MINUTES,
    FIRST_BACKOFF_MINUTES * 2 ** (failures - 1),
  );
  return {
    obligationId: input.obligationId,
    cause: input.cause,
    detail: input.detail,
    target: input.target,
    dueAt: input.dueAt,
    firstFailedAt: existing?.firstFailedAt ?? input.now,
    lastFailedAt: input.now,
    consecutiveFailures: failures,
    retryAt: new Date(Date.parse(input.now) + minutes * 60_000).toISOString(),
  };
}

/** Hours this debt has been outstanding, measured from when it was DUE. */
export function debtHours(debt: FreshnessDebt, nowMs: number): number {
  return Math.max(0, (nowMs - Date.parse(debt.dueAt)) / 3_600_000);
}

export function retryable(
  debts: readonly FreshnessDebt[],
  nowMs: number,
): readonly FreshnessDebt[] {
  return debts.filter((d) => d.cause !== "AWAITING_ADAPTER" && Date.parse(d.retryAt) <= nowMs);
}

/** One incident per (cause, target), with everything behind it counted. */
export interface Incident {
  readonly cause: DebtCause;
  readonly target: string;
  readonly obligationsAffected: number;
  readonly oldestHours: number;
  /** One example detail, quoted. Never all of them. */
  readonly exampleDetail: string;
  readonly nextRetryAt: string;
}

export function aggregateIncidents(
  debts: readonly FreshnessDebt[],
  nowMs: number,
): readonly Incident[] {
  const groups = new Map<string, FreshnessDebt[]>();
  for (const d of debts) {
    const key = `${d.cause}\u0000${d.target}`;
    const rows = groups.get(key) ?? [];
    rows.push(d);
    groups.set(key, rows);
  }
  const out: Incident[] = [];
  for (const rows of groups.values()) {
    const oldest = rows.reduce((a, b) => (debtHours(a, nowMs) >= debtHours(b, nowMs) ? a : b));
    const soonest = rows.reduce((a, b) => (a.retryAt <= b.retryAt ? a : b));
    out.push({
      cause: rows[0].cause,
      target: rows[0].target,
      obligationsAffected: rows.length,
      oldestHours: debtHours(oldest, nowMs),
      exampleDetail: oldest.detail,
      nextRetryAt: soonest.retryAt,
    });
  }
  return out.sort((a, b) => b.obligationsAffected - a.obligationsAffected);
}

export interface StalenessRisk {
  readonly obligationsScheduled: number;
  readonly obligationsUnscheduled: number;
  readonly obligationsOverdue: number;
  readonly debtRows: number;
  readonly incidents: number;
  /** The worst outstanding debt, in hours. Null when there is none. */
  readonly oldestDebtHours: number | null;
  readonly activation: "SHADOW_NOT_ACTIVATED";
}

export function stalenessRisk(input: {
  readonly scheduled: number;
  readonly unscheduled: number;
  readonly overdue: number;
  readonly debts: readonly FreshnessDebt[];
  readonly nowMs: number;
}): StalenessRisk {
  const incidents = aggregateIncidents(input.debts, input.nowMs);
  return {
    obligationsScheduled: input.scheduled,
    obligationsUnscheduled: input.unscheduled,
    obligationsOverdue: input.overdue,
    debtRows: input.debts.length,
    incidents: incidents.length,
    oldestDebtHours:
      input.debts.length === 0
        ? null
        : Math.max(...input.debts.map((d) => debtHours(d, input.nowMs))),
    activation: "SHADOW_NOT_ACTIVATED",
  };
}
