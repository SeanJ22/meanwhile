/**
 * **FRESHNESS DEBT — DURABLE, VISIBLE, AND SELF-RETRYING.**
 * (Session B, W3.3, 2026-08-30. RULING 212, RULING 218.)
 *
 * ## The three things a failed refresh must not become
 *
 * ```
 *   NOT a notification    a 403 is the network, not a person's problem
 *   NOT an absence        "we could not fetch it" is never "there is none"
 *   NOT a silent drop     an obligation that fails and vanishes was never owed
 * ```
 *
 * A refresh that fails becomes DEBT: a durable row saying this obligation is
 * overdue, by how long, why, and when it will be tried again. It retries
 * itself. Nobody is told. It is visible in the digest as a number with a
 * denominator, which is the only form in which "we are behind" is actionable.
 *
 * RULING 218 is explicit that a late or failed dispatch is an engineering and
 * freshness defect — an operational incident and a WorkItem — and **never a
 * Needs-Owner escalation by itself**. So nothing in this module can produce an
 * owner escalation, and the one thing it produces for a human is an aggregate.
 *
 * ## Aggregation by ROOT CAUSE, not by row
 *
 * RULING 218 asks for incident aggregation by root cause. When a host goes
 * down, every obligation behind it fails at once; three hundred incident rows
 * describing one outage is three hundred ways to not see the outage. Debt rows
 * carry a `cause` and `aggregateIncidents` groups on it, so the digest says
 * *one host unreachable, 312 obligations behind it* rather than listing 312.
 *
 * ## Backoff, and why it is capped rather than exponential forever
 *
 * Doubling with a ceiling. Uncapped exponential backoff on a standing
 * obligation converges to never checking again, which is indistinguishable
 * from having dropped it — the exact outcome the debt row exists to prevent.
 * The ceiling is what keeps a long outage a delay rather than an abandonment.
 */

/**
 * Why a refresh did not land. Every one of these is a TRANSIENT class and
 * every one of them retries.
 *
 * A permanent condition is not debt. A route that is disallowed, or a record
 * that does not exist, is a DISPOSITION on the obligation and belongs in the
 * acquisition path — this module is only for the readings that failed to
 * happen and should happen again.
 */
export const DEBT_CAUSES = [
  /** 403, 401, a WAF, a challenge page. The host refused this client. */
  "REFUSED_BY_HOST",
  /** 429 or an explicit quota. We asked too often. */
  "RATE_LIMITED",
  /** 5xx. Their side broke. */
  "UPSTREAM_ERROR",
  /** DNS, TLS, connection reset, timeout. Nothing was reached. */
  "TRANSPORT_FAILED",
  /** The worker holding it died, and the lease expired unclaimed. */
  "WORKER_LOST",
  /** The route ran and produced nothing readable — a failed extraction. */
  "EXTRACTION_FAILED",
  /** Scheduled, never dispatched, and the due time has passed. */
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

/** First retry after 15 minutes. Short enough that a blip is invisible. */
export const FIRST_BACKOFF_MINUTES = 15;
/** Six hours. Past this, doubling is abandonment wearing a schedule. */
export const MAX_BACKOFF_MINUTES = 360;

export interface FreshnessDebt {
  readonly obligationId: string;
  readonly cause: DebtCause;
  /** What actually happened, quotable. Never a verdict on anybody. */
  readonly detail: string;
  /** The host or vendor the failure was against, for root-cause grouping. */
  readonly target: string;
  /** When this obligation was DUE, not when it failed. Debt is measured from owed. */
  readonly dueAt: string;
  readonly firstFailedAt: string;
  readonly lastFailedAt: string;
  readonly consecutiveFailures: number;
  readonly retryAt: string;
}

/**
 * Open or extend the debt for one obligation.
 *
 * `existing` null opens it; otherwise the failure count grows and the backoff
 * doubles from it. `firstFailedAt` never moves — the age of the debt is the
 * number the digest reports, and resetting it on each failure would make a
 * three-day outage read as fifteen minutes old forever.
 */
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

/** Debt whose backoff has elapsed. These retry themselves, unattended. */
export function retryable(
  debts: readonly FreshnessDebt[],
  nowMs: number,
): readonly FreshnessDebt[] {
  return debts.filter((d) => d.cause !== "AWAITING_ADAPTER" && Date.parse(d.retryAt) <= nowMs);
}

/**
 * One incident per ROOT CAUSE, with everything behind it counted.
 *
 * The grouping key is (cause, target) because that pair is what an operator can
 * act on: *Legistar is refusing this client* is one thing to fix and *312
 * obligations are behind it* is its size. A per-obligation incident list is the
 * same information arranged so nobody can see it.
 */
export interface Incident {
  readonly cause: DebtCause;
  readonly target: string;
  readonly obligationsAffected: number;
  /** The oldest debt in the group, in hours. The age of the incident. */
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
  /* Largest first: the biggest incident is the one worth reading. */
  return out.sort((a, b) => b.obligationsAffected - a.obligationsAffected);
}

/**
 * The staleness-risk reading the FRESHNESS contract reports.
 *
 * A ratio with both terms, never a bare number. "14 obligations overdue" is
 * unreadable without knowing whether the total is 20 or 20,000, and the whole
 * discipline of this repository's counting is that a numerator without its
 * denominator is not a measurement.
 */
export interface StalenessRisk {
  readonly obligationsScheduled: number;
  readonly obligationsUnscheduled: number;
  readonly obligationsOverdue: number;
  readonly debtRows: number;
  readonly incidents: number;
  /** The worst outstanding debt, in hours. Null when there is none. */
  readonly oldestDebtHours: number | null;
  /**
   * SHADOW until the scheduler's results are INDEPENDENTLY_REPRODUCED. RULING
   * 212 and RULING 218 both say FRESHNESS reports NOT_READY until Session B
   * proves the runtime scheduler, and a measured reading taken by the session
   * that built the scheduler is not that proof — it is the session's own
   * observation, which is exactly what RULING 216 separates.
   */
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
