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
    governs: ["data/ballot/", "data/questionnaire/"],
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

/**
 * Builds per month, if every scheduled run found a change — the ceiling, not
 * the expectation. Stated as a number so a cadence edit that raises it is
 * visible in a diff rather than argued about.
 */
export function maxScheduledBuildsPerMonth(): number {
  // One run a day, and the run commits at most once however many sources moved.
  return 30;
}
