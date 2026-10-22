/**
 * A freshness obligation and its derived next-due. No active obligation may have an unknown next-due:
 * `scheduleAll` returns the unscheduled rows with a named reason. The interval is the shorter of the
 * reader-deadline and observed-change-rate intervals; `cadenceSource` records which decided it.
 */

/** What decided this obligation's interval. Recorded per row, never assumed. */
export const CADENCE_SOURCES = [
  /** A reader-visible deadline is nearer than any observed change rate. */
  "READER_IMPACT",
  /** The publisher's measured movement is the binding constraint. */
  "OBSERVED_CHANGE_RATE",
  /** Both were available and agreed closely enough that either would do. */
  "READER_IMPACT_AND_CHANGE_RATE",
  /** Neither signal exists yet: daily, and labelled as the default. */
  "DEFAULT_NO_SIGNAL",
  /** The obligation names its own interval — a statutory or published cycle. */
  "DECLARED_CYCLE",
  /** A scout argued this record absent; the next reading is owed when the absence expires. */
  "ARGUED_ABSENT",
] as const;
export type CadenceSource = (typeof CADENCE_SOURCES)[number];

/** The default cadence, and the only place the number appears. */
export const DEFAULT_CADENCE_HOURS = 24;

/** Nothing is scheduled closer than this. A tighter loop is a hot loop. */
export const MIN_CADENCE_HOURS = 0.25;

/** Nor further out than this without a declared cycle saying so. */
export const MAX_DERIVED_CADENCE_HOURS = 24 * 30;

/** One thing this project owes a fresh reading of. A standing obligation, deliberately not a WorkItem. */
export interface FreshnessObligation {
  /** An owner's reported official change, held as work instructions until independently checked. */
  readonly officialsLead?: { readonly kind: "officials-change"; readonly placeKey: string; readonly receiptId: string };
  /** Owner-dispatched instructions, not evidence. Copied to each occurrence and retained across scheduler restarts. */
  readonly autonomousPlan?: import("../workers/autonomous-plan.ts").AutonomousWorkPlan;
  /** Durable scheduling hint: retain the first owed time until this obligation is actually worked. */
  readonly nextDueAt?: string | null;
  readonly id: string;
  readonly recordClass: string;
  /** The canonical subject: a body id, a division, a committee. */
  readonly subjectId: string;
  /** Applicability declared by the source provider, including shared state or
   * federal records. Stored with the obligation so Admin can preview the same
   * work without reconstructing a candidate's geography from its name. */
  readonly scopeDivisions?: readonly string[];
  /** The route this obligation is worked through, when one is known. */
  readonly routeId: string | null;
  readonly active: boolean;
  /**
   * When staleness in this record starts costing a reader something — a
   * meeting start, a filing deadline, an election. ISO, or null.
   */
  readonly readerImpactAt: string | null;
  /** Retained upcoming and concluded sittings, for the rolling meeting clock. */
  readonly meetingStartsAt?: readonly string[];
  /**
   * Mean hours between OBSERVED changes at the publisher. Null until we have
   * enough readings to mean anything; a rate derived from one observation is
   * one observation wearing a rate's name.
   */
  readonly observedChangeRateHours: number | null;
  /** A cycle the publisher itself declares, in hours. Outranks both signals. */
  readonly declaredCycleHours?: number | null;
  /** The last time this obligation was actually worked to a disposition. */
  readonly lastWorkedAt: string | null;
  /** A recorded, expiring absence; the obligation is not re-walked until this time. Runtime-owned. */
  readonly absentUntil?: string | null;
  /** What would reopen a recorded absence before it expires. Cleared with `absentUntil`. */
  readonly absenceUnlock?: import("./absence.ts").AbsenceUnlock | null;
  /** The last time a new capability cleared this obligation's absence early, and what it was. */
  readonly absenceReopened?: { readonly at: string; readonly because: string } | null;
  /** Set when the owner's dispatch materialized this obligation; a registration pass never resets it. */
  readonly materializedBy?: typeof OWNER_DISPATCH;
  /** Every owner Send that reached this obligation (CREATED or REORDERED), appended and never overwritten. Runtime-owned. */
  readonly assignments?: readonly ObligationAssignment[];
  /** Set with `materializedBy`: which registry defined the government this row is about. A registration pass never resets it. */
  readonly materializedFrom?: "REVIEWED_REGISTRY" | "REGISTRATION";
}

/** One owner Send, as recorded on an obligation it reached. */
export interface ObligationAssignment {
  /** The Send: the scope decision key (`county:2020/04019`) or `dispatch:<intent id>`. */
  readonly assignmentKey: string;
  /** The gateway receipt (a scope) or the DISPATCH intent id that carried the Send when it reached this row. */
  readonly ref: string;
  readonly relation: "CREATED" | "REORDERED";
  readonly at: string;
  /** The questions the owner asked of the Send; absent when it asked none. */
  readonly questions?: readonly import("../work-question.ts").WorkQuestion[];
}

/**
 * Append a Send to an obligation's list, never overwriting: a Send already
 * recorded with the same receipt and relation is left as it is. Returns the same list when
 * nothing is added, so a caller can skip the write.
 */
export function withAssignment(
  current: readonly ObligationAssignment[] | undefined,
  entry: ObligationAssignment,
): readonly ObligationAssignment[] {
  const held = current ?? [];
  if (held.some((a) => a.assignmentKey === entry.assignmentKey && a.ref === entry.ref && a.relation === entry.relation)) return held;
  return [...held, entry];
}

/** The instruction in force for each key at a charge or result boundary.
 * Older marks stay on the obligation for history, but cannot claim a later
 * hunt's work merely because the geography key is unchanged. */
export function currentAssignmentRefs(assignments: readonly ObligationAssignment[] | undefined): readonly { readonly key: string; readonly ref: string }[] {
  const latest = new Map<string, ObligationAssignment>();
  for (const mark of assignments ?? []) {
    const prior = latest.get(mark.assignmentKey);
    if (!prior || mark.at > prior.at || (mark.at === prior.at && mark.ref > prior.ref)) latest.set(mark.assignmentKey, mark);
  }
  return [...latest.values()].map(mark => ({ key: mark.assignmentKey, ref: mark.ref })).sort((a,b)=>a.key.localeCompare(b.key));
}

/** Collision-free index key for one immutable instruction, including edits
 * that keep its receipt and a separate hunt at the same geography. */
export const instructionReceiptKey = (key: string, ref: string): string => JSON.stringify([key, ref]);

export const OWNER_DISPATCH = "OWNER_DISPATCH" as const;

export interface ScheduledObligation {
  readonly obligation: FreshnessObligation;
  readonly nextDueAt: string;
  readonly cadenceHours: number;
  readonly cadenceSource: CadenceSource;
  /** One sentence a report can quote. Never a verdict, always a derivation. */
  readonly basis: string;
}

/** An obligation that could NOT be scheduled, with the reason NAMED. */
export interface UnscheduledObligation {
  readonly obligation: FreshnessObligation;
  readonly reason: string;
}

function clamp(hours: number): number {
  return Math.min(MAX_DERIVED_CADENCE_HOURS, Math.max(MIN_CADENCE_HOURS, hours));
}

/** Derive one obligation's cadence and next-due. Null only for unusable inputs, which the caller names as unscheduled. */
export function meetingSourceCadenceHours(nowMs: number, startsAt: readonly (string | null)[] = []): number {
  return startsAt.some(at => at !== null && Math.abs(Date.parse(at) - nowMs) <= 7 * 86_400_000) ? 1 : 12;
}

export function scheduleObligation(
  obligation: FreshnessObligation,
  nowMs: number,
): ScheduledObligation | UnscheduledObligation {
  if (!obligation.active) {
    return { obligation, reason: "the obligation is not active, so nothing is owed on a clock" };
  }

  const declared = obligation.declaredCycleHours ?? null;
  if (declared !== null && (!Number.isFinite(declared) || declared <= 0)) {
    return {
      obligation,
      reason: `declaredCycleHours is ${declared}, which is not an interval — refusing to invent one`,
    };
  }

  const rate = obligation.observedChangeRateHours;
  if (rate !== null && (!Number.isFinite(rate) || rate <= 0)) {
    return {
      obligation,
      reason: `observedChangeRateHours is ${rate}, which is not an interval — refusing to invent one`,
    };
  }

  let impactHours: number | null = null;
  if (obligation.readerImpactAt !== null) {
    const at = Date.parse(obligation.readerImpactAt);
    if (!Number.isFinite(at)) {
      return {
        obligation,
        reason:
          `readerImpactAt ${JSON.stringify(obligation.readerImpactAt)} does not parse as a time, ` +
          "so the deadline it names cannot be honoured and must not be guessed",
      };
    }
    /* Half the remaining time, so the check lands before the deadline reaches a reader. */
    const remaining = (at - nowMs) / 3_600_000;
    impactHours = remaining > 0 ? remaining / 2 : MIN_CADENCE_HOURS;
  }

  let hours: number;
  let source: CadenceSource;
  let basis: string;

  if (declared !== null) {
    hours = declared;
    source = "DECLARED_CYCLE";
    basis = `the publisher declares a ${declared}h cycle, which outranks a rate we inferred`;
  } else if (impactHours !== null && rate !== null) {
    hours = Math.min(impactHours, rate);
    /* Within a factor of two is agreement for this purpose: either would put
       the next check in the same part of the same day. */
    const agree = Math.max(impactHours, rate) / Math.min(impactHours, rate) <= 2;
    source = agree
      ? "READER_IMPACT_AND_CHANGE_RATE"
      : impactHours <= rate
        ? "READER_IMPACT"
        : "OBSERVED_CHANGE_RATE";
    basis =
      `reader impact puts a check ${impactHours.toFixed(2)}h out and the observed change rate ` +
      `puts one ${rate.toFixed(2)}h out; the SHORTER binds, because a check that is late for ` +
      "either reason is late";
  } else if (impactHours !== null) {
    hours = impactHours;
    source = "READER_IMPACT";
    basis =
      `staleness reaches a reader at ${obligation.readerImpactAt}; the check is placed at half ` +
      "the remaining time so it lands before the deadline rather than on it";
  } else if (rate !== null) {
    hours = rate;
    source = "OBSERVED_CHANGE_RATE";
    basis = `the publisher has been observed to move about every ${rate.toFixed(2)}h`;
  } else {
    hours = DEFAULT_CADENCE_HOURS;
    source = "DEFAULT_NO_SIGNAL";
    basis =
      "no reader deadline and no observed change rate exist for this obligation yet, so it takes " +
      "the surviving default of daily — which is a DEFAULT and not a derivation, and " +
      "this row says so rather than reading like a measured cadence";
  }

  const isMeeting = /meeting|calendar|agenda|minutes/i.test(obligation.recordClass);
  const meetingCadence = meetingSourceCadenceHours(nowMs, [obligation.readerImpactAt, ...(obligation.meetingStartsAt ?? [])]);
  if (isMeeting) {
    hours = Math.min(hours, meetingCadence);
    basis = `Meeting sources are checked ${meetingCadence === 1 ? "hourly within seven days before or after a sitting" : "twice daily"} (§4). ${basis}`;
  }
  const cadenceHours = clamp(hours);

  /* A recorded, unexpired absence holds the clock until it expires. */
  const absentUntilMs = obligation.absentUntil ? Date.parse(obligation.absentUntil) : NaN;
  if (Number.isFinite(absentUntilMs) && absentUntilMs > nowMs) {
    return {
      obligation,
      nextDueAt: new Date(isMeeting ? Math.min(absentUntilMs,
        (obligation.lastWorkedAt ? Date.parse(obligation.lastWorkedAt) : nowMs) + cadenceHours * 3_600_000) : absentUntilMs).toISOString(),
      cadenceHours,
      cadenceSource: "ARGUED_ABSENT",
      basis:
        `a scout argued this record absent; the absence stands until ${obligation.absentUntil} ` +
        "(one measurement on one date; absences expire), so the next reading " +
        "is owed then rather than on the ordinary cadence, and the proven negative is not re-walked meanwhile",
    };
  }

  /* From the last work, not from now, so a row examined often is still due. */
  const anchor = obligation.lastWorkedAt ? Date.parse(obligation.lastWorkedAt) : NaN;

  /* A record nobody has ever worked is owed now; a row that keeps failing is held back by debt backoff instead. */
  if (!Number.isFinite(anchor)) {
    const firstDue = obligation.nextDueAt ? Date.parse(obligation.nextDueAt) : NaN;
    return {
      obligation,
      // Moving NOW on every look rewrites every unworked durable row each
      // cycle and erases its queue age. A previously owed timestamp stays owed.
      // An invalid or future legacy hint must never delay the first reading.
      nextDueAt: new Date(Number.isFinite(firstDue) && firstDue <= nowMs ? firstDue : nowMs).toISOString(),
      cadenceHours,
      cadenceSource: source,
      basis:
        `${basis}. This obligation has NEVER been worked, so its first reading is owed NOW rather ` +
        `than one ${cadenceHours.toFixed(2)}h interval from registration — the cadence says how ` +
        "often it recurs and says nothing about when the first reading is owed.",
    };
  }

  return {
    obligation,
    nextDueAt: new Date(anchor + cadenceHours * 3_600_000).toISOString(),
    cadenceHours,
    cadenceSource: source,
    basis,
  };
}

export function isScheduled(
  row: ScheduledObligation | UnscheduledObligation,
): row is ScheduledObligation {
  return (row as ScheduledObligation).nextDueAt !== undefined;
}

export interface SchedulePass {
  readonly scheduled: readonly ScheduledObligation[];
  readonly unscheduled: readonly UnscheduledObligation[];
}

/** Schedule every obligation, and return what could not be scheduled with its reason. The caller states both counts. */
export function scheduleAll(
  obligations: readonly FreshnessObligation[],
  nowMs: number,
): SchedulePass {
  const scheduled: ScheduledObligation[] = [];
  const unscheduled: UnscheduledObligation[] = [];
  for (const o of obligations) {
    const row = scheduleObligation(o, nowMs);
    if (isScheduled(row)) scheduled.push(row);
    else unscheduled.push(row);
  }
  return { scheduled, unscheduled };
}

/** The rows that are due now, soonest first (no priority field, so nothing starves). */
export function dueNow(
  pass: SchedulePass,
  nowMs: number,
): readonly ScheduledObligation[] {
  return pass.scheduled
    .filter((row) => Date.parse(row.nextDueAt) <= nowMs)
    .sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));
}

/** What the plain-code queue reads from a debt row: whether the last attempt failed, and when its backoff ends. */
export interface QueueDebt {
  readonly consecutiveFailures: number;
  readonly retryAt: string;
}

/**
 * When a due row joined the plain-code queue: a row whose last attempt failed rejoins at the later of its
 * backoff's end and its next-due; any other row joins at its next-due. Never earlier than its next-due.
 */
export function waitingSince(row: { readonly nextDueAt: string }, debt: QueueDebt | null | undefined): string {
  if (debt === null || debt === undefined || debt.consecutiveFailures <= 0) return row.nextDueAt;
  return debt.retryAt > row.nextDueAt ? debt.retryAt : row.nextDueAt;
}

/**
 * The plain-code lane's order: longest-waiting first (`waitingSince`), stable. A dispatched row cannot pass a
 * waiting row again, so with A rows ahead and c rows a cycle it runs within ceil((A + 1) / c) cycles, except
 * behind a live foreign lease or the owner's placed-first rows.
 */
export function plainCodeQueueOrder<T extends { readonly obligation: { readonly id: string }; readonly nextDueAt: string }>(
  rows: readonly T[],
  debtFor: (obligationId: string) => QueueDebt | null | undefined,
): T[] {
  const keyed = rows.map((row, at) => ({ row, at, since: waitingSince(row, debtFor(row.obligation.id)) }));
  keyed.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : a.at - b.at));
  return keyed.map((k) => k.row);
}
