/**
 * ONE DAILY REFRESH, AND EACH SOURCE ON THE CADENCE IT ACTUALLY EARNS.
 *
 * Sean's instruction of 2026-08-24, items 1.3 and 1.4 — **RULING 124**.
 *
 * ## What five separate schedules were costing
 *
 * Five workflows refreshed five governed artifacts on five different crons, and
 * each one committed separately. Three fired on 2026-08-24 and produced three
 * commits, three production builds and three deploys before 5 AM. Every one of
 * those builds shipped the same application; only the data differed.
 *
 * A single daily run that commits ONCE cannot do that. The most a quiet day can
 * now cost is **zero commits and zero builds** — the orchestrator commits
 * nothing when nothing moved, which is the half a ceremonial "refreshed, no
 * changes" commit was quietly spending.
 *
 * ## THE CADENCE IS CALENDAR-DRIVEN ON PURPOSE
 *
 * The obvious implementation asks "when did this artifact last change?" with
 * `git log -1 -- <path>`. **That is wrong on CI and it fails silently**: in a
 * shallow clone, per-file `git log` returns the TIP date for every file, with no
 * error. A weekly source would read as refreshed-today, every day, forever, and
 * nothing would go red.
 *
 * So the cadence is a pure function of the run's calendar date. Weekly sources
 * run on Mondays; monthly sources run on the 1st. No state file, no clone-depth
 * assumption, no extra commit to record when a source last ran — and the answer
 * is checkable by reading a date off a calendar.
 *
 * ## WHY EACH SOURCE SITS WHERE IT SITS
 *
 * Every entry carries its justification, because "refresh everything daily" is
 * the default that burns a build to learn nothing, and a table of intervals
 * with no reasons is a table the next session edits by feel.
 */

/* ==========================================================================
 * **THIS IS LEGACY RUNTIME, AND IT IS NOT THE FRESHNESS CLOCK.**
 * (Session B, W3.6, 2026-08-30. RULING 218, RULING 212.)
 *
 * Everything below still RUNS and is still correct about what it does. What it
 * is not, and has not been since RULING 218, is authoritative about freshness.
 *
 * ```
 *   AUTHORITY      the runtime freshness scheduler
 *                  lib/control-plane/scheduler/*
 *                  next_due_at derived per obligation from reader impact and
 *                  observed change rate, claimed durably, retried as debt
 *
 *   THIS FILE      a coarse calendar-driven backup wakeup, non-authoritative
 *                  measured GitHub dispatch delays of 186-313 minutes typical
 *                  and ~699 worst are recorded evidence that it cannot be a
 *                  clock — a source due at 04:00 that fires at 15:39 was not
 *                  late by accident, it was never on time
 * ```
 *
 * **It is not removed, and removing it was never the plan.** RULING 212 and
 * RULING 218 share a transition rule: the legacy jobs remain as explicitly
 * non-authoritative runtime until the replacement is PROVED. Session B built
 * and shadow-ran the scheduler; proving it requires INDEPENDENTLY_REPRODUCED
 * results, which the session that built it cannot supply (RULING 216). So this
 * stays, labelled, until a later session's canonical run says otherwise —
 * because a gap between deleting the old clock and trusting the new one is a
 * gap in which nothing refreshes at all.
 *
 * **A late or failed dispatch here is an engineering and freshness defect** —
 * an operational incident and a WorkItem — and never a Needs-Owner escalation
 * by itself (RULING 218).
 * ========================================================================= */

/** What this scheduling surface is, for anything that reports on it. */
export const REFRESH_AUTHORITY = "LEGACY_NON_AUTHORITATIVE" as const;

/** The named replacement, so the classification points somewhere. */
export const REFRESH_REPLACEMENT =
  "the runtime freshness scheduler in lib/control-plane/scheduler/ — obligation.ts derives " +
  "next_due_at, dispatch.ts claims and runs it, debt.ts carries what failed. Shadow-run in " +
  "Session B; it takes authority when its results are INDEPENDENTLY_REPRODUCED by a canonical " +
  "run this session did not perform (RULING 212, RULING 216, RULING 218).";

export type Cadence = "daily" | "weekly" | "monthly";

export interface RefreshSource {
  /** Stable id, used in logs and in the run report. */
  id: string;
  /** What the orchestrator runs. Split so a source may take several steps. */
  commands: readonly string[];
  /**
   * The path(s) whose movement decides whether anything is committed. A
   * directory ends with `/`.
   */
  governs: readonly string[];
  cadence: Cadence;
  /**
   * A source may be temporarily faster than its resting cadence. The date is
   * the last day the elevated cadence applies, inclusive.
   */
  elevatedUntil?: { cadence: Cadence; until: string };
  /** One line. Why this cadence and not a faster one. */
  why: string;
}

export const REFRESH_SOURCES: readonly RefreshSource[] = [
  {
    id: "meetings",
    commands: ["ingest composite"],
    governs: ["data/meetings-snapshot.json"],
    cadence: "weekly",
    // The election is 2026-11-03. expected-future-date: the general election.
    elevatedUntil: { cadence: "daily", until: "2026-11-03" },
    why: "Agendas and notices are posted days ahead and move constantly through an election season; after 2026-11-03 the serving window is measured in weeks and RULING 53's clocks are 7 and 14 days.",
  },
  {
    id: "nj-filing",
    /*
     * THE REBUILD RUNS FIRST, AND THE CHECK MEASURES WHAT IT PRODUCED.
     *
     * The order was `["nj:filing:check", "nj:ballot --write"]` until
     * 2026-08-25, and in that order this source could never become fresh.
     * `nj:filing:check` exits non-zero on STALE — the pull being older than its
     * one-day window — which stopped the source before `nj:ballot --write`, the
     * command that performs the pull the check is complaining about. So the
     * gate blocked the only thing that could satisfy it, `curatedAt` froze at
     * 2026-08-23, and every daily run failed on it from then on: run
     * 32833989579, `nj-filing failed at 'pnpm nj:filing:check' (exit 1)`, with
     * the clerk's 272 candidacies and our 272 agreeing on the same line.
     *
     * Reversed, each half does the job it was written for. `nj:ballot --write`
     * fetches the clerk's candidates page, reads its current hrefs, extracts
     * the filed-candidate PDFs and stamps `curatedAt` on the day it read them.
     * `nj:filing:check` then asks the RULING 113 question of the step that just
     * ran — did it actually do the thing — and a divergence between the clerk's
     * published count and ours is a real alarm about a rebuild that just
     * happened rather than a complaint about one that never got to run.
     */
    /*
     * **AND THE INVITATIONS ARTIFACT IS REGENERATED IN THE SAME STEP.**
     * (2026-08-26, found by re-dispatching Refresh after R59's window fix.)
     *
     * `data/questionnaire/invitations-nj-morris-2026.json` is generated FROM the
     * clerk filing and embeds its `collectedAt` — a READ STAMP under RULING
     * 107, which SHOULD move when the filing is re-read. So every successful
     * `nj:ballot --write` makes that artifact stale by exactly one field, and
     * `tests/generated-artifacts.test.ts` refuses it byte-for-byte under
     * RULING 92.
     *
     * That is RULING 102's shape one step downstream: fixing a generator is not
     * finished until its output is regenerated, and here the INPUT moved and
     * nothing downstream re-ran. It stayed invisible while the F22 window guard
     * was failing first — the run never got far enough to reach it.
     *
     * The regeneration belongs HERE rather than in the workflow, beside the
     * command whose success creates the staleness, so a source added later
     * cannot inherit the hazard by being added somewhere else.
     */
    commands: [
      "nj:ballot --write",
      "nj:filing:check",
      "questionnaire:invitations --write",
    ],
    // `data/ballot/` was the pre-2026-09-03 home; the writer (`nj:ballot --write`)
    // has written `data/states/nj/ballot/` since the state-holdings reorg. The
    // stale prefix left the 2026-09-05 rewrite of both NJ files attributed to
    // nobody, so nothing could be refused or owed by name.
    governs: ["data/states/nj/ballot/", "data/questionnaire/"],
    cadence: "weekly",
    // The election is 2026-11-03. expected-future-date: the general election.
    elevatedUntil: { cadence: "daily", until: "2026-11-03" },
    why: "A clerk's certified filing moves in HOURS near a deadline — this is the RULING 53 one-day clock the meetings cadence change deliberately left alone.",
  },
  {
    id: "fec",
    commands: ["fec:fetch"],
    governs: ["data/fec/fec-2026.json"],
    cadence: "weekly",
    why: "Federal committees file monthly or quarterly; the FEC's own processing lag is measured in days, so a daily read returns yesterday's answer six times out of seven.",
  },
  {
    id: "legiscan",
    commands: ["legiscan:fetch"],
    governs: ["data/votes/state-votes-snapshot.json"],
    cadence: "weekly",
    why: "LegiScan rebuilds its dataset once a week on Sundays and the fetch is dataset_hash-gated — reading it more often cannot produce a different hash.",
  },
  {
    id: "dotgov",
    commands: ["dotgov:fetch"],
    governs: ["data/dotgov/snapshot.json"],
    cadence: "monthly",
    why: "The federal .gov domain list gains and loses a handful of entries a month; a daily read of a barely-moving federal register is the clearest case of a build spent to learn nothing.",
  },
] as const;

/** Parse `YYYY-MM-DD` as a UTC calendar day, with no local-timezone drift. */
function parseDay(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

/**
 * The cadence in force for this source on this date — its resting cadence,
 * unless an elevated window is still open.
 */
export function cadenceOn(source: RefreshSource, runDate: Date): Cadence {
  const e = source.elevatedUntil;
  if (!e) return source.cadence;
  const today = Date.UTC(
    runDate.getUTCFullYear(),
    runDate.getUTCMonth(),
    runDate.getUTCDate(),
  );
  return today <= parseDay(e.until) ? e.cadence : source.cadence;
}

/**
 * Is this source due today?
 *
 * Monday for weekly, the 1st for monthly. Both are UTC, because the schedule
 * that fires this is UTC and a cadence that disagreed with its own trigger
 * would skip or double a run at the month boundary.
 */
export function isDue(source: RefreshSource, runDate: Date): boolean {
  switch (cadenceOn(source, runDate)) {
    case "daily":
      return true;
    case "weekly":
      return runDate.getUTCDay() === 1;
    case "monthly":
      return runDate.getUTCDate() === 1;
  }
}

export function dueSources(runDate: Date): RefreshSource[] {
  return REFRESH_SOURCES.filter((s) => isDue(s, runDate));
}

/* -------------------------------------------------------------------------- */
/* CATCH-UP — THE ONE THING A CALENDAR-DRIVEN CADENCE CANNOT DO ON ITS OWN     */
/* -------------------------------------------------------------------------- */

/**
 * **A LATE RUN COMPUTES THE RIGHT CADENCE. A SKIPPED DAY IS GONE FOREVER.**
 * (2026-08-28.)
 *
 * The header above is right that a calendar-driven cadence is robust: `isDue`
 * is a pure function of the run's own date, so the run that fired 638 minutes
 * behind its 2026-08-27 slot still asked the correct question for 2026-08-27
 * and got the correct answer. Lateness costs nothing here.
 *
 * **Absence costs everything.** `fec` and `legiscan` are MONDAY-ONLY. If the
 * Monday slot produces no run — or produces one that fails before those sources
 * execute — Tuesday's run asks "is it Monday?", answers no, and skips them.
 * Nothing anywhere retries. **One missed Monday is a fourteen-day data gap in
 * federal committee filings and state roll-call votes**, and no instrument in
 * this repository would report it as anything but a normal Tuesday.
 *
 * The fix is not a second cron. `tests/refresh-cadence.test.ts` asserts exactly
 * one cron per workflow on purpose — more than one schedule on one workflow is
 * the duplicate-run shape RULING 78 removed — so a second offset schedule needs
 * a later-dated ruling before it can exist. The union below recovers the same
 * days lawfully, inside the run that is already happening, with no governance
 * change and no extra build: the workflow still commits at most once, and still
 * commits nothing when nothing moved.
 *
 * It is safe against overlap by construction: `refresh-daily.yml` declares
 * `concurrency: { group: refresh-daily, cancel-in-progress: false }`, so a
 * catch-up run that takes longer cannot race the next one.
 */

/**
 * How many calendar days back a catch-up may reach.
 *
 * **A CAP IS REQUIRED, AND THE REASON IS NOT PERFORMANCE.** The signal a caller
 * has for "when did a refresh last land" is the run report committed beside the
 * data (`docs/refresh-run.md`), which is committed ONLY when an artifact moved.
 * So from `main`, a genuinely quiet day and a skipped day are indistinguishable
 * — both leave no trace. Unbounded, a fortnight of legitimately quiet days
 * would saturate the union and put every weekly source on a daily cadence,
 * which is precisely the build-and-API burn RULING 124 removed.
 *
 * Eight days recovers a missed Monday with a week to spare, and recovers a
 * missed 1st-of-month for the eight days somebody has to notice it. It does NOT
 * recover a monthly slot missed and unnoticed for longer, and that limit is
 * stated here rather than papered over: `dotgov` skipped on the 1st and
 * unnoticed until the 12th is not repaired by this mechanism.
 */
export const CATCH_UP_MAX_DAYS = 8;

/** `YYYY-MM-DD` for a UTC calendar day — the cadence's own unit. */
export function utcDay(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Every calendar day whose cadence this run must answer for: the run's own day,
 * plus each day after the last landed refresh that no landed run has covered.
 *
 * Oldest first, and `runDate`'s own day is ALWAYS the last entry — a catch-up
 * that could drop today would be a repair that broke the thing it repaired.
 *
 * `lastLanded` absent, unparseable, or not before `runDate` yields today alone.
 * **No state is not permission to invent state**: with nothing to say a day was
 * missed, nothing is claimed to have been.
 */
export function catchUpSlots(
  lastLandedRunDate: Date | null | undefined,
  runDate: Date,
  maxDays: number = CATCH_UP_MAX_DAYS,
): Date[] {
  const today = Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate());
  const days: Date[] = [];

  const valid =
    lastLandedRunDate instanceof Date && !Number.isNaN(lastLandedRunDate.getTime()) ? lastLandedRunDate : null;
  if (!valid) return [new Date(today)];

  const last = Date.UTC(valid.getUTCFullYear(), valid.getUTCMonth(), valid.getUTCDate());
  if (last >= today) return [new Date(today)];

  const DAY = 24 * 60 * 60 * 1000;
  const cap = Math.max(1, Math.floor(maxDays));
  const earliest = Math.max(last + DAY, today - (cap - 1) * DAY);
  for (let t = earliest; t <= today; t += DAY) days.push(new Date(t));
  return days;
}

/** One source's standing across a catch-up window. */
export interface DueDecision {
  readonly source: RefreshSource;
  /** Due on at least one day in the window — this is what the runner obeys. */
  readonly due: boolean;
  /** Due on the run's own calendar day, by the ordinary cadence. */
  readonly dueToday: boolean;
  /**
   * The EARLIER days that made it due, `YYYY-MM-DD`, oldest first. Empty when
   * only today's cadence called for it. Named so the report says which day is
   * being recovered rather than reporting a source as mysteriously due.
   */
  readonly recoveredFrom: readonly string[];
  /**
   * The day this source first failed to land, when it carries open freshness
   * debt (`data/ops/refresh-debt.json`, 2026-09-02). A source in debt is DUE
   * whatever its cadence says: a weekly source whose data the gate refused on
   * Monday is not owed next Monday, it is owed now.
   */
  readonly debtSince?: string;
}

/** The UNION of what every day in the window asks for, in table order. */
export function dueSourcesAcross(days: readonly Date[]): RefreshSource[] {
  return REFRESH_SOURCES.filter((s) => days.some((d) => isDue(s, d)));
}

/**
 * The whole decision for one run: every source, whether it is due, and which
 * skipped day is being recovered if it is due for that reason.
 *
 * Returns an entry for EVERY source, never only the due ones — a report that
 * lists only what it decided to run cannot be checked against what it decided
 * to skip.
 */
export function dueDecisions(
  lastLandedRunDate: Date | null | undefined,
  runDate: Date,
  maxDays: number = CATCH_UP_MAX_DAYS,
  openDebt: readonly { sourceId: string; firstFailedOn: string }[] = [],
): DueDecision[] {
  const days = catchUpSlots(lastLandedRunDate, runDate, maxDays);
  const todayKey = utcDay(runDate);
  return REFRESH_SOURCES.map((source) => {
    const dueDays = days.filter((d) => isDue(source, d)).map(utcDay);
    const dueToday = dueDays.includes(todayKey);
    const debt = openDebt.find((d) => d.sourceId === source.id);
    return {
      source,
      due: dueDays.length > 0 || debt !== undefined,
      dueToday,
      recoveredFrom: dueDays.filter((d) => d !== todayKey),
      ...(debt ? { debtSince: debt.firstFailedOn } : {}),
    };
  });
}

/**
 * Builds per month, if every scheduled run found a change — the ceiling, not
 * the expectation. Stated as a number so a cadence edit that raises it is
 * visible in a diff rather than argued about.
 *
 * **CATCH-UP DOES NOT MOVE THIS NUMBER**, and that is the point of doing the
 * recovery inside the existing run rather than with a second cron. A catch-up
 * run makes more SOURCE calls; it does not make more runs, and the workflow
 * still commits at most once however many sources moved.
 */
export function maxScheduledBuildsPerMonth(): number {
  // One run a day, and the run commits at most once however many sources moved.
  return 30;
}

/**
 * The next calendar day after `runDate` on which the source's cadence calls for
 * it, or null if none inside 62 days (which the three cadences here never
 * produce — stated rather than assumed, so a fourth cadence cannot inherit a
 * silent null).
 *
 * Lives here rather than in `refresh-report.ts` because it is a question about
 * the CADENCE and nothing else: an admin page asking "when is this source next
 * due?" should not have to import a module that reads and writes files.
 */
export function nextCadenceDay(source: RefreshSource, runDate: Date): string | null {
  const base = Date.UTC(runDate.getUTCFullYear(), runDate.getUTCMonth(), runDate.getUTCDate());
  for (let i = 1; i <= 62; i++) {
    const day = new Date(base + i * 86_400_000);
    if (isDue(source, day)) return utcDay(day);
  }
  return null;
}
