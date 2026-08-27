import { CAPABILITIES } from "../sources/composite/wiring.ts";

/**
 * The human name for a calendar an internal source id points at.
 *
 * ## Why this file exists before anything renders from it
 *
 * `schedulepage`, `civicplus`, `iqm2`, `clerksboards` — these are ADAPTER
 * ids. They are the right names in the wiring, the snapshot and the ladder,
 * and they are the wrong names in front of a person: `CLAUDE.md`'s rule is
 * that identifiers, enum values and internal keys never render outside a
 * technical-details disclosure, and "schedulepage" fails the 15-year-old test
 * on sight.
 *
 * Checked against production 2026-08-17, at all four zips: NOTHING renders one
 * today. The server HTML and `/about-area` are clean of all ten ids, and the
 * one place a source could surface — a carried row's provenance — renders
 * `lastFreshAt` and the sentence "our latest check couldn't reach this
 * calendar", never `carried.source`. So this is not a fix; it is the fix's
 * precondition, put in place while the answer is still clean.
 *
 * The pressure is real and structural. `/api/meetings` ships the ids to the
 * client in three places (`sources[].source`, every meeting `id`, and
 * `carried.source`), so the value is always one interpolation away from a
 * surface. The next session that wants to say WHICH calendar failed will reach
 * for the nearest string, and the nearest string is the adapter id.
 *
 * ## What the labels say, and what they deliberately do not
 *
 * They name the KIND OF PLACE the calendar is, in the possessive the coverage
 * notice already uses ("their …"), because that is what a reader can act on. A
 * reader does not care that a township runs CivicPlus; they care that the
 * thing we could not reach is the town website's agenda page. Vendor names are
 * left out for the same reason the funding rule leaves out characterisations:
 * naming a private company on a claim surface invites the reader to weigh a
 * company we have no business asking them to weigh.
 *
 * ## The absent label is null, never a plausible phrase
 *
 * `calendarLabel` returns null for an id it does not know, and the caller
 * renders its own generic sentence. A default here would be a render default
 * manufacturing a claim: an unlabelled adapter would silently describe itself
 * as something it may not be, and nothing would ever catch the missing entry.
 * `tests/source-labels.test.ts` asserts every WIRED adapter has one, so a new
 * adapter cannot ship label-less.
 */
export const CALENDAR_LABELS: Readonly<Record<string, string>> = {
  legistar: "their online agenda portal",
  civicplus: "their town website's agenda page",
  onbase: "their records portal",
  apptegy: "their district website's events calendar",
  diligent: "their online agenda portal",
  clerksboards: "the clerk's board-of-supervisors calendar",
  civicclerk: "their board's online meeting portal",
  boardbook: "their board's online meeting book",
  iqm2: "their online agenda portal",
  revize: "their town website's meetings page",
  schedulepage: "their own published schedule page",
  // Plain words for a format a reader has no reason to know the name of. Not
  // "their iCalendar feed": the reader is trying to find out when their town
  // meets, and "iCalendar" is an identifier wearing a label's clothes.
  ical: "their town website's events calendar",
};

/** The human name, or null when there is none — never a plausible stand-in. */
export function calendarLabel(sourceId: string | null | undefined): string | null {
  if (!sourceId) return null;
  return CALENDAR_LABELS[sourceId] ?? null;
}

/**
 * Every internal id a reader surface must never contain.
 *
 * Read from the wiring rather than restated, so an adapter added tomorrow is
 * covered by the guard the day it lands rather than the day someone remembers.
 */
export function internalSourceIds(): string[] {
  return CAPABILITIES.map((c) => c.name);
}
