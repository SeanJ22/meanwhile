/**
 * **THE FRESHNESS OBLIGATION, AND ITS DERIVED NEXT-DUE.**
 * (Session B, W3.3, 2026-08-30. RULING 212, RULING 218.)
 *
 * ## The invariant, and it is the whole file
 *
 * > **No active obligation may have an unknown next-due.**
 *
 * That is RULING 212 in one line, and it is stronger than it looks. It is not
 * *most obligations have a cadence*, and it is not *we default everything to
 * daily*. It says a scheduler that cannot answer *when is this next owed?* for
 * some row is a scheduler with a silent hole, and a silent hole in a freshness
 * clock reads to every surface above it as freshness.
 *
 * So `scheduleAll` below returns TWO lists and the second one is the point: an
 * obligation it could not schedule comes back with the REASON, by name, and the
 * caller states both counts. Nothing is dropped and nothing is defaulted into
 * looking scheduled.
 *
 * ## Cadence is DERIVED, and the fixed daily floor is retired
 *
 * ```
 *   reader_impact_at        how long until staleness reaches a reader
 *   observed_change_rate    how often the publisher has actually moved
 *   cadence_source          which of those decided it, recorded per row
 * ```
 *
 * RULING 212 retires the fixed daily requirement and keeps daily as the
 * DEFAULT for an obligation with no better-derived signal. The distinction
 * matters at exactly one place — `cadenceSource`, which says whether this row's
 * interval was measured or fallen back to. A scheduler whose rows all read
 * `DEFAULT_NO_SIGNAL` is running a fixed daily cron wearing a derivation's
 * name, and the field is what makes that visible rather than arguable.
 *
 * ## Why a deadline beats a period
 *
 * Both inputs are converted to an INTERVAL and the shorter wins. A meeting
 * whose agenda lands the evening before is owed a check before that evening
 * whatever its publisher's long-run change rate says, and a publisher that
 * moves hourly is owed a check hourly whatever the reader deadline says. The
 * minimum is the only combination that cannot be wrong in the dangerous
 * direction.
 */

/** What decided this obligation's interval. Recorded per row, never assumed. */
export const CADENCE_SOURCES = [
  /** A reader-visible deadline is nearer than any observed change rate. */
  "READER_IMPACT",
  /** The publisher's measured movement is the binding constraint. */
  "OBSERVED_CHANGE_RATE",
  /** Both were available and agreed closely enough that either would do. */
  "READER_IMPACT_AND_CHANGE_RATE",
  /**
   * Neither signal exists yet. Daily, and SAID to be daily-because-nothing —
   * RULING 212 keeps this as a default and retires it as a requirement, and a
   * row wearing this label is a row whose cadence nobody has measured.
   */
  "DEFAULT_NO_SIGNAL",
  /** The obligation names its own interval — a statutory or published cycle. */
  "DECLARED_CYCLE",
] as const;
export type CadenceSource = (typeof CADENCE_SOURCES)[number];

/** RULING 212's surviving default, and the only place the number appears. */
export const DEFAULT_CADENCE_HOURS = 24;

/** Nothing is scheduled closer than this. A tighter loop is a hot loop. */
export const MIN_CADENCE_HOURS = 0.25;

/** Nor further out than this without a declared cycle saying so. */
export const MAX_DERIVED_CADENCE_HOURS = 24 * 30;

/**
 * One thing this project owes a fresh reading of.
 *
 * Deliberately NOT a WorkItem. A WorkItem is a piece of work with a completion
 * contract; this is a standing obligation that never completes — it comes due,
 * is worked, and comes due again. Modelling recurrence as a WorkItem that
 * re-opens itself would make "complete" mean two different things in one store.
 */
export interface FreshnessObligation {
  readonly id: string;
  /** The record class this keeps fresh — "meetings", "roster", "filings". */
  readonly recordClass: string;
  /** The canonical subject: a body id, a division, a committee. */
  readonly subjectId: string;
  /** The route this obligation is worked through, when one is known. */
  readonly routeId: string | null;
  readonly active: boolean;
  /**
   * When staleness in this record starts costing a reader something — a
   * meeting start, a filing deadline, an election. ISO, or null.
   */
  readonly readerImpactAt: string | null;
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
}

/** An obligation with a next-due, and the derivation that produced it. */
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

/**
 * Derive one obligation's cadence and next-due.
 *
 * Returns null ONLY when the inputs are unusable — a non-finite rate, an
 * unparseable timestamp — and the caller turns that into a NAMED unscheduled
 * row rather than a default. That is the difference between "we have no signal,
 * so daily" (a decision, recorded as `DEFAULT_NO_SIGNAL`) and "this row's data
 * is broken" (a defect, which may not be papered over with a cadence).
 */
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
    /*
     * HALF the remaining time, not all of it. A check scheduled AT the deadline
     * arrives when the staleness has already reached the reader; the point of a
     * reader-impact signal is to land before it, and halving is the cheapest
     * rule that always does while still backing off as the deadline recedes.
     */
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
      "RULING 212's surviving default of daily — which is a DEFAULT and not a derivation, and " +
      "this row says so rather than reading like a measured cadence";
  }

  const cadenceHours = clamp(hours);
  /*
   * From the last WORK, not from now. Scheduling from `now` on every pass makes
   * the interval restart every time the scheduler looks at the row, so a row
   * examined often is never due — the starvation shape a due-time scheduler
   * exists to avoid.
   */
  const anchor = obligation.lastWorkedAt ? Date.parse(obligation.lastWorkedAt) : NaN;

  /*
   * **A RECORD NOBODY HAS EVER WORKED IS OWED NOW.** (Session C, 2026-08-31.)
   *
   * This anchored an unworked row at `now` and added the cadence, so a newly
   * registered obligation's first due time was one full interval into the
   * future — and for anything whose only signal is a distant reader deadline,
   * that is a month. Registering Arizona's campaign-finance portfolio made the
   * consequence visible: seven brand-new obligations, every one scheduled, and
   * NOT ONE due, so the unattended loop would have registered them and then
   * walked nothing for thirty days while reporting a healthy schedule.
   *
   * The cadence answers *how often is this owed again*. It has nothing to say
   * about the first reading, and using it as a delay before the first reading
   * is the scheduler deciding that a record it has never opened can wait —
   * which is a claim about the record that nothing supports.
   *
   * Re-dispatch of a row that keeps FAILING is governed by debt backoff, not by
   * this anchor; `runCycle` holds a backed-off obligation out of the due set and
   * names it. Without that half this line would be a hot loop.
   */
  if (!Number.isFinite(anchor)) {
    return {
      obligation,
      nextDueAt: new Date(nowMs).toISOString(),
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

/**
 * Schedule every obligation, and say what could not be scheduled and why.
 *
 * **Both lists are returned and the caller must state both counts.** RULING
 * 212's invariant is that no ACTIVE obligation has an unknown next-due, and the
 * only way to know whether that holds is to count the rows where it does not
 * and name them. A pass that returned only the scheduled rows would satisfy the
 * invariant by construction and prove nothing.
 */
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

/**
 * The rows that are due now, soonest first.
 *
 * Soonest-first rather than by any priority field, and that is deliberate: a
 * priority order would let a low-priority obligation starve forever behind a
 * queue that never empties, and an obligation nothing ever works is an
 * obligation with an unknown next-due wearing a schedule.
 */
export function dueNow(
  pass: SchedulePass,
  nowMs: number,
): readonly ScheduledObligation[] {
  return pass.scheduled
    .filter((row) => Date.parse(row.nextDueAt) <= nowMs)
    .sort((a, b) => (a.nextDueAt < b.nextDueAt ? -1 : a.nextDueAt > b.nextDueAt ? 1 : 0));
}
