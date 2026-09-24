import type { Meeting, MeetingLocation, OnlineAccess } from "@/lib/sources/types";

/**
 * **ONLINE-NESS IS ONE QUESTION, ASKED IN ONE PLACE.** (MTG-14, 2026-08-28.)
 *
 * ## What was wrong
 *
 * There was no helper. Thirteen call sites re-derived `meeting.location ===
 * null` inline — the venue gate, the query split, the search index, the state
 * derivation, the calendar export, the digest, three components and four test
 * files — and the sentence a reader is shown about it, *"Online only — there is
 * no room to attend in person."*, was written out TWICE, in
 * `components/map/popup/meeting-popup.tsx` and in `components/map/map-entry.tsx`.
 *
 * A predicate with thirteen copies is a predicate that will be got right twelve
 * times. The evidence that it already had been: the primary list surface marks
 * an online sitting, and **two discovery surfaces did not** — the door
 * overlay's "Next meeting" line and the Ask autocomplete. A reader met the
 * meeting on either of those, saw a time and a body, and had no way to learn
 * there was no room to go to.
 *
 * ## The invariant, and what actually holds it up
 *
 * `location === null` and `online !== undefined` are a PAIR. `lib/sources/types.ts`
 * requires them to agree, and over the committed snapshot they do, exactly —
 * measured both ways, with neither side hard-coded, in
 * `tests/meeting-online-marker.test.ts`.
 *
 * But nothing MECHANICAL holds it: there is no discriminated union, no boolean
 * on the row, and no check constraint on `online_label` / `online_join_url` in
 * `lib/db/schema.ts`. It is held by prose and by adapter tests. So this module
 * is deliberately written against `location`, which is the field the pair's
 * meaning actually lives in — a meeting with no room is online whatever the
 * `online` column happens to hold — and `onlineAccessFor` is the one place that
 * asks for the other half, so a divergence surfaces as a NAMED GAP rather than
 * as a surface silently deciding a meeting is physical.
 *
 * ## What this module refuses to do
 *
 * It does not produce a coordinate, a venue key or a pin. `lib/meetings/venues.ts`
 * keeps online sittings off the map and that gate is CORRECT: a marker on the
 * body's home address would put a reader outside a building nobody is going to.
 *
 * ## No room is NOT the same as online (2026-09-23, the owner's directive)
 *
 * This module used to answer "online only" for every sitting with no building,
 * on the reasoning that `location === null` is where the pair's meaning lives.
 * The owner's rule for the Tucson Unified report says otherwise: *"Represent
 * unknown details honestly … Missing agenda text or a missing location must not
 * automatically suppress an otherwise verified meeting."* A sitting whose place
 * we simply do not hold is not a sitting "with no room to attend in person" —
 * that sentence is a claim about the government, and nothing established it.
 *
 * So there are three states, and each has one answer:
 *
 * - a BUILDING (`location` set) — the venue gate pins it;
 * - ONLINE (`location` null, the body published an online access) — the
 *   online sentence, the join line, never a pin;
 * - PLACE NOT RECORDED (`location` null and no online access) — our own named
 *   gap, `PLACE_UNRECORDED_LINE`, never a pin and never "online".
 *
 * All three stay listed. `hasPhysicalLocation` is unchanged, so the venue gate
 * is unchanged.
 */

/** The shape any surface needs to answer the question. Meetings satisfy it. */
type OnlineShaped = Pick<Meeting, "location"> & { online?: OnlineAccess };

/**
 * **Whether this sitting happens online, with no room to attend in person.**
 *
 * The single derivation. It needs BOTH halves: no building, and an online
 * access the body published. A sitting with no building and no published
 * online access is `isPlaceUnrecorded` instead — see the 2026-09-23 note above.
 */
export function isOnlineOnly(meeting: OnlineShaped): boolean {
  return meeting.location === null && meeting.online != null;
}

/**
 * **No building and no published online access: we do not hold its place.**
 *
 * Still a real, listed meeting. What renders is `PLACE_UNRECORDED_LINE`, which
 * is a fact about this product — never "online", which would be a claim about
 * the government that nothing established.
 */
export function isPlaceUnrecorded(meeting: OnlineShaped): boolean {
  return meeting.location === null && meeting.online == null;
}

/**
 * The same question from the other side, as a TYPE PREDICATE.
 *
 * It exists so the venue gate can narrow rather than assert: `if
 * (!hasPhysicalLocation(m)) continue;` leaves the compiler holding a non-null
 * `location`, where a boolean helper would have forced a `!` or a cast at the
 * exact line whose whole job is refusing to invent a coordinate.
 */
export function hasPhysicalLocation<T extends OnlineShaped>(
  meeting: T,
): meeting is T & { location: MeetingLocation } {
  return meeting.location !== null;
}

/**
 * The published online access for a sitting, or null.
 *
 * Returns null for a physical meeting AND for a sitting whose place is not
 * recorded (no building, no published online access). Both are the absence of
 * a published way in, and a surface reading this renders the named gap rather
 * than inventing one.
 */
export function onlineAccessFor(meeting: OnlineShaped): OnlineAccess | null {
  if (!isOnlineOnly(meeting)) return null;
  return meeting.online ?? null;
}

/**
 * The sentence, once.
 *
 * It says there is no ROOM, not merely that the meeting is online: a reader who
 * sees "Location: Virtual Meeting" and nothing else may still turn up at city
 * hall. That is the whole content of the line, and it is why it is a sentence
 * rather than a word.
 */
export const ONLINE_ONLY_LINE = "Online only — there is no room to attend in person.";

/**
 * What a sitting with no building and no published online access says about
 * where it is held. OURS, in the house register ("We haven't recorded …"),
 * because nothing we hold says whether the body has published a place — the
 * same default `lib/ask/agenda-sentence.ts` applies to a missing agenda.
 */
export const PLACE_UNRECORDED_LINE = "We haven't recorded a place for this meeting yet.";

/** The same gap, short enough for a list row's metadata line. */
export const PLACE_UNRECORDED_MARK = "place not recorded yet";

/**
 * The "Where" row for a sitting with no building: the online sentence where the
 * body published an online access, our own named gap where it did not.
 */
export function placelessWhereLine(meeting: OnlineShaped): string {
  return isOnlineOnly(meeting) ? ONLINE_ONLY_LINE : PLACE_UNRECORDED_LINE;
}

/**
 * What the "How to join" row says when the body published no link.
 *
 * The render-default rule exactly: the gap is named as THEIRS. Over the
 * committed snapshot, **every** online sitting is in this branch — not one body
 * publishes a join URL — so this is not the rare path, it is the only one, and
 * anything plausible in its place (the body's homepage, the agenda portal)
 * would look like a way in and not be one.
 */
export function joinLine(access: OnlineAccess): string {
  return `${access.label} — the body hasn't published a join link`;
}

/**
 * **THE READER-FACING WORD FOR AN ONLINE SITTING, AND WHY IT IS NOT THE LABEL.**
 *
 * The published labels are free text with inconsistent case — over the
 * committed snapshot they include `"VIRTUAL MEETING"`, `"Virtual Meeting"`,
 * `"Via Zoom"`, `"via Zoom"`, `"Via Zoom Webinar"`, `"Virtual Event"` and
 * `"Microsoft Teams (Virtual)"`, which is seven strings for one fact and two
 * spellings of the same one. A badge that printed them verbatim would shout
 * `VIRTUAL MEETING` at a reader in one row and murmur `via Zoom` in the next,
 * and neither would answer the question the badge exists to answer.
 *
 * So the MARK never carries the label. It carries this — the fact, in the
 * product's own words. The published string still reaches the reader, in the
 * "How to join" row, where it is quoted data about the body rather than the
 * app's own vocabulary.
 */
export const ONLINE_MARK_WORD = "Online only";
