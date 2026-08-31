import { localDate } from "./meeting-time.ts";

/**
 * **WHICH SITTING THE READER ASKED ABOUT — one implementation, two callers.**
 * (ASK02, 2026-08-27.)
 *
 * This function exists as its own module for a reason worth stating. The rule
 * it holds was first guarded by a test that RE-IMPLEMENTED it: the test built
 * its own `upcoming`/`past` split and asserted against that. Such a test
 * passes forever regardless of what the route does, which is the exact shape
 * of defect this repository spent PR #211 finding — a green check standing
 * beside broken behaviour.
 *
 * So the rule lives here, `app/api/ask/agenda/route.ts` and
 * `app/api/ask/grounded/route.ts` both call it, and the test calls the same
 * function the readers do.
 */

export type AgendaSelection = "NEXT" | "LAST" | "ANY";

export interface SittingLike {
  startsAt: string;
}

/**
 * Pick the sitting a tensed question asked for.
 *
 * **A tensed question never falls back to the other tense.** Asking what a
 * board discussed last time, against a body whose only sittings are in the
 * future, is an honest nothing — and answering it with the next agenda would
 * state that a discussion has already happened when it has not. `null` is a
 * real answer here and the callers turn it into a named gap.
 *
 * `ANY` is the pre-2026-08-27 behaviour, kept only for callers that genuinely
 * have no tense to offer — never as a default for a question that had one.
 */
export function selectSitting<T extends SittingLike>(
  selection: AgendaSelection,
  sittings: readonly T[],
  now: number,
): T | null {
  const upcoming = sittings
    .filter((m) => Date.parse(m.startsAt) >= now)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  const past = sittings
    .filter((m) => Date.parse(m.startsAt) < now)
    .sort((a, b) => (a.startsAt < b.startsAt ? 1 : -1));

  if (selection === "NEXT") return upcoming[0] ?? null;
  if (selection === "LAST") return past[0] ?? null;
  return upcoming[0] ?? past[0] ?? null;
}

/**
 * **EVERY SITTING THE BODY HOLDS ON THE CHOSEN ONE'S LOCAL DAY.**
 * (Session B resume, W2 — ASK-24, 2026-08-31.)
 *
 * The owner reported it precisely: Mayor & Council sit at 1 p.m. and again at
 * 5 p.m., the map card renders both, and Ask named only the first. That is
 * `selectSitting` working as designed — it returns ONE sitting — and an answer
 * built from its single return being read as the whole of the day.
 *
 * A reader who is told "the meeting is at 1 p.m." and turns up to a study
 * session that ends before the business meeting starts has been given a true
 * sentence and a wrong answer. Two sittings on one day is a normal shape for a
 * council, not an edge case.
 *
 * ## The day is the body's LOCAL day, and that is load-bearing
 *
 * Grouping on the UTC date would split a 7 p.m. Arizona sitting from a 1 p.m.
 * one on the same afternoon, because the evening meeting's UTC timestamp lands
 * on the following day. Every Vail row in this corpus carries a UTC date one
 * day after the meeting, and `localDate` is what `lib/map/format.ts` has
 * resolved it with since BC-12.
 *
 * Returned in start order, chosen sitting included, so a caller can render
 * "1 p.m. and again at 5 p.m." without deciding anything itself.
 */
export function sittingsOnSameLocalDay<T extends SittingLike & { timeZone?: string | null }>(
  chosen: T,
  sittings: readonly T[],
): readonly T[] {
  const day = localDate(chosen);
  return sittings
    .filter((m) => localDate(m) === day)
    .sort((a, b) => (a.startsAt < b.startsAt ? -1 : a.startsAt > b.startsAt ? 1 : 0));
}

/**
 * Which empty this is, so three different facts get three different sentences.
 *
 * "We hold no meetings at all for this body" is a fact about our collection;
 * "we hold meetings but none in the future" is a fact about the calendar.
 * Collapsing them lets a reader read a scheduling gap as a coverage gap.
 */
export function emptySelectionState(
  selection: AgendaSelection,
  totalSittings: number,
): "NO_MEETING_HELD" | "NO_UPCOMING_MEETING_HELD" | "NO_PAST_MEETING_HELD" {
  if (totalSittings === 0) return "NO_MEETING_HELD";
  if (selection === "NEXT") return "NO_UPCOMING_MEETING_HELD";
  if (selection === "LAST") return "NO_PAST_MEETING_HELD";
  return "NO_MEETING_HELD";
}
