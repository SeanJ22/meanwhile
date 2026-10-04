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
  /**
   * A scout argued this record absent (RULING 52: an empty branch is one
   * measurement on one date, never a verdict; RULING 53: recorded absences
   * expire on a clock). The next reading is owed when the absence expires, not
   * on the ordinary cadence — so a proven negative is not re-walked every cycle.
   */
  "ARGUED_ABSENT",
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
  /** Owner-dispatched instructions, not evidence. Copied to each occurrence and retained across scheduler restarts. */
  readonly autonomousPlan?: import("../workers/autonomous-plan.ts").AutonomousWorkPlan;
  /** Durable scheduling hint: retain the first owed time until this obligation is actually worked. */
  readonly nextDueAt?: string | null;
  readonly id: string;
  /** The record class this keeps fresh — "meetings", "roster", "filings". */
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
  /** Retained upcoming and concluded sittings, for the rolling §4 clock. */
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
  /**
   * A recorded, EXPIRING absence (RULING 52/53). Set when a scout argued the
   * record absent after a proper walk; the obligation is not re-walked until
   * this time, then it comes due again on its ordinary cadence. Null/absent
   * means no standing absence. Runtime-owned and durable.
   */
  readonly absentUntil?: string | null;
  /** What would reopen a recorded absence before it expires, stored with it (DP-06). Cleared with `absentUntil`. */
  readonly absenceUnlock?: import("./absence.ts").AbsenceUnlock | null;
  /** The last time a new capability cleared this obligation's absence early, and what it was (DP-10). */
  readonly absenceReopened?: { readonly at: string; readonly because: string } | null;
  /**
   * Set when the owner's dispatch MATERIALIZED this obligation (MW-028,
   * `lib/control-plane/expansion/dispatch-work.ts`): the registry defined the
   * requirement, no standing provider carried it, and the runner created the
   * row because the owner sent the fleet there. The providers read it back to
   * keep the row in their corpus; a registration pass never resets it.
   * Absent on every row a standing provider registered on its own.
   */
  readonly materializedBy?: typeof OWNER_DISPATCH;
  /**
   * MW-001: every owner Send that reached this obligation, and how — appended
   * by the runner's dispatch-work step, never overwritten. A Send that created
   * the row is CREATED; one that found it already on a clock and put it first
   * is REORDERED. One obligation can serve several Sends. Runtime-owned and
   * durable; absent on rows no Send has reached, and on rows a Send created
   * before this field existed.
   */
  readonly assignments?: readonly ObligationAssignment[];
  /**
   * Set with `materializedBy`: which registry defined the government this row is about — a state's reviewed
   * registry, or its REGISTRATION where it has none (2026-09-25, `lib/registration/jurisdictions.ts`), so Admin
   * can say which. Runtime-owned like the mark: a registration pass never resets it.
   */
  readonly materializedFrom?: "REVIEWED_REGISTRY" | "REGISTRATION";
}

/** One owner Send, as it is recorded on an obligation it reached (MW-001). */
export interface ObligationAssignment {
  /** The Send: the scope decision key (`county:2020/04019`) or `dispatch:<intent id>`. */
  readonly assignmentKey: string;
  /** The gateway receipt (a scope) or the DISPATCH intent id that carried the Send when it reached this row. */
  readonly ref: string;
  readonly relation: "CREATED" | "REORDERED";
  /** When the runner recorded it. */
  readonly at: string;
  /** The questions the owner asked of the Send (MW-002); absent when it asked none. */
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

/** The one value `FreshnessObligation.materializedBy` carries. */
export const OWNER_DISPATCH = "OWNER_DISPATCH" as const;

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

  const isMeeting = /meeting|calendar|agenda|minutes/i.test(obligation.recordClass);
  const meetingCadence = meetingSourceCadenceHours(nowMs, [obligation.readerImpactAt, ...(obligation.meetingStartsAt ?? [])]);
  if (isMeeting) {
    hours = Math.min(hours, meetingCadence);
    basis = `Meeting sources are checked ${meetingCadence === 1 ? "hourly within seven days before or after a sitting" : "twice daily"} (§4). ${basis}`;
  }
  const cadenceHours = clamp(hours);

  /*
   * A RECORDED, UNEXPIRED ABSENCE HOLDS THE CLOCK (RULING 52/53). A scout that
   * walked the field and argued the record absent set `absentUntil`; until it
   * passes, the next reading is owed THEN, not on the ordinary cadence — so a
   * proven negative (≈83% of authored-site walks) is re-confirmed on the
   * absence's expiry clock, never every cycle. When it passes, this branch does
   * nothing and the row comes due on its cadence again, which is the expiry.
   */
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
        "(RULING 52: one measurement on one date; RULING 53: absences expire), so the next reading " +
        "is owed then rather than on the ordinary cadence, and the proven negative is not re-walked meanwhile",
    };
  }

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

/** What the plain-code queue reads from a debt row: whether the last attempt failed, and when its backoff ends. */
export interface QueueDebt {
  readonly consecutiveFailures: number;
  readonly retryAt: string;
}

/**
 * **WHEN A DUE ROW JOINED THE PLAIN-CODE QUEUE.** (2026-09-25.)
 *
 * A row's next-due advances only when a reading DISCHARGES it. A row whose
 * attempts keep failing keeps its first next-due forever, so ordering by
 * next-due alone put it back at the HEAD of the queue each time its backoff
 * (at most six hours) ended. On production, 2026-09-25, 133 such rows sat ahead
 * of 1,360 rows that share one next-due (2026-09-15T17:58:43.627Z). Of 1,882
 * plain-code dispatches in the 81 cycles since 2026-09-23, 1,361 failed. The
 * failed ones were mostly repeat tries of rows that return zero Wikipedia
 * results. Those 1,882 dispatches were more than enough to reach every one of
 * the lane's ~1,190 rows once. Still, 144 rows waiting since 2026-09-15 were
 * never tried. That is starvation caused by queue order, not by lack of
 * capacity.
 *
 * So a row whose last attempt failed rejoins the queue when its backoff ends,
 * behind every row already waiting. Precisely, it rejoins at the later of its
 * backoff's end and its next-due, so a row due only as a retry still comes after
 * every row due by the clock, as before. Any other row joins at its next-due,
 * as before. A row's key never moves earlier than its next-due, so a row
 * without failing debt never has more rows ahead of it than it did. Nothing
 * about a row's cadence or backoff changes here. This only orders rows that are
 * already due.
 */
export function waitingSince(row: { readonly nextDueAt: string }, debt: QueueDebt | null | undefined): string {
  if (debt === null || debt === undefined || debt.consecutiveFailures <= 0) return row.nextDueAt;
  return debt.retryAt > row.nextDueAt ? debt.retryAt : row.nextDueAt;
}

/**
 * The plain-code lane's order: the longest-waiting row first (`waitingSince`).
 * Ties keep their input order. The sort is stable, and a copy is returned.
 *
 * **THE BOUND.** A dispatch that ends in a reading or a failure puts its row
 * back behind the cycle that ran it. A discharged row rejoins at its next-due,
 * at least 15 minutes after the cycle started. A failed row rejoins no earlier
 * than its retry, and every backoff is at least 15 minutes. So a row that was dispatched
 * cannot pass a waiting row again. If A rows were waiting ahead of a row when it
 * joined, and the lane runs c ≥ 1 rows a cycle, the row is dispatched within
 * ⌈(A + 1) / c⌉ cycles. A row appears in the queue at most once, so A is
 * smaller than the lane's population. Two things are outside the bound. First,
 * a row a live foreign lease holds (NOT_CLAIMED) keeps its place until that
 * lease ends. Second, the owner's placed-first rows (ADM-8 DISPATCH, selected
 * expansion scopes) still go first, in the owner's order.
 */
export function plainCodeQueueOrder<T extends { readonly obligation: { readonly id: string }; readonly nextDueAt: string }>(
  rows: readonly T[],
  debtFor: (obligationId: string) => QueueDebt | null | undefined,
): T[] {
  const keyed = rows.map((row, at) => ({ row, at, since: waitingSince(row, debtFor(row.obligation.id)) }));
  keyed.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : a.at - b.at));
  return keyed.map((k) => k.row);
}
