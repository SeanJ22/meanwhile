import { copy } from "../design/copy.ts";
import type { Meeting, MeetingLocation, MeetingVenueGap, OnlineAccess } from "@/lib/sources/types";

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
 * ## Online map pins (FE-34, approved launch plan)
 *
 * Online-only sittings may have an ONLINE_ONLY venue at their body's published
 * office address. That coordinate orients the reader; it never changes the
 * meeting's null physical location. The marker says "Online only", and the
 * published join link remains the main action. A place we have not recorded
 * still gets no pin.
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
 *   online sentence and join line, plus an online-only office pin where sourced;
 * - PLACE NOT RECORDED (`location` null and no online access) — our own named
 *   gap, `PLACE_UNRECORDED_LINE`, never a pin and never "online".
 *
 * And a fourth, from official-page events (2026-09-23, `MeetingVenueGap`):
 *
 * - A NAMED VENUE GAP (`location` null, `venueGap` set, never with `online`) —
 *   a physical sitting. Where the publisher STATED its place and we hold no
 *   reviewed coordinates for it ("Cholla High School South Gym"), the place IS
 *   recorded, as the publisher's words, and those words render; where the
 *   publisher's page states no place, the gap is the publisher's and says so.
 *   Never a pin, never "online", never "we haven't recorded a place".
 *
 * All four stay listed. `hasPhysicalLocation` still describes a physical room;
 * the separate online office venue never changes that fact.
 */

/** The shape any surface needs to answer the question. Meetings satisfy it. */
type OnlineShaped = Pick<Meeting, "location"> & { online?: OnlineAccess; venueGap?: MeetingVenueGap };

/**
 * **Whether this sitting happens online, with no room to attend in person.**
 *
 * The single derivation. It needs BOTH halves: no building, and an online
 * access the body published. A sitting with no building and no published
 * online access is `isPlaceUnrecorded` instead — see the 2026-09-23 note above.
 */
export function isOnlineOnly(meeting: OnlineShaped): boolean {
  // Both halves, and no named venue gap: a physical meeting whose room is a
  // named gap (`venueGap`) also carries a null location, and it is NOT online —
  // labeling it so would send a reader looking for a join link that was never
  // published (official-page events, 2026-09-23).
  return meeting.location === null && meeting.online != null && !meeting.venueGap;
}

/**
 * **No building, no published online access and no named venue gap: we do not
 * hold its place.**
 *
 * Still a real, listed meeting. What renders is `PLACE_UNRECORDED_LINE`, which
 * is a fact about this product — never "online", which would be a claim about
 * the government that nothing established. A sitting with a `venueGap` is NOT
 * this state: the publisher either stated its place in words (which render) or
 * stated none (which is the publisher's gap, and says so) — see `venueGapOf`.
 */
export function isPlaceUnrecorded(meeting: OnlineShaped): boolean {
  return meeting.location === null && meeting.online == null && !meeting.venueGap;
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
 * Returns null for a physical meeting, for a sitting whose place is not
 * recorded (no building, no published online access) AND for a named venue gap.
 * Each is the absence of a published way in online, and a surface reading this
 * renders the named gap rather than inventing one.
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
export const PLACE_UNRECORDED_LINE = copy("copy.working");

/** The same gap, short enough for a list row's metadata line. */
export const PLACE_UNRECORDED_MARK = "place not recorded yet";

/**
 * **A physical sitting whose room is a named gap, or null.** (Official-page
 * events, 2026-09-23 — `MeetingVenueGap` in `lib/sources/types.ts`.)
 *
 * Read only where there is no building: a placed meeting's `location` is the
 * answer, whatever else the row carries.
 */
export function venueGapOf(meeting: OnlineShaped): MeetingVenueGap | null {
  return meeting.location === null && meeting.venueGap ? meeting.venueGap : null;
}

/**
 * The publisher's page names no place: the gap is THEIRS, and the line says whose
 * page it is. About the page we read, never a claim that the body published a
 * place nowhere.
 */
export function venueNotStatedLine(publisher: string): string {
  return `${publisher}'s page doesn't say where this meeting is held.`;
}

/** The same publisher's gap, short enough for a list row's metadata line. */
export const VENUE_NOT_STATED_MARK = "place not stated by the publisher";

/**
 * The place the publisher stated, verbatim, or null when its page states none.
 * A STATED_NOT_PLACED gap with no words is read as the page stating none: the
 * words are the whole claim, and there is nothing else to show.
 */
export function statedVenueText(gap: MeetingVenueGap): string | null {
  const stated = gap.kind === "STATED_NOT_PLACED" ? gap.publishedText?.trim() : "";
  return stated ? stated : null;
}

/**
 * What a named venue gap says about where the sitting is held. A STATED place is
 * the publisher's own words, verbatim — the place IS recorded, as text, and it
 * renders as text (never a pin, and never "we haven't recorded a place"). A page
 * that states none gets the publisher's named gap.
 */
export function venueGapLine(gap: MeetingVenueGap): string {
  return statedVenueText(gap) ?? venueNotStatedLine(gap.publisher);
}

/** The venue gap for a list row's metadata line: the stated place, or the publisher's gap. */
export function venueGapMark(gap: MeetingVenueGap): string {
  return statedVenueText(gap) ?? VENUE_NOT_STATED_MARK;
}

/**
 * The "Where" row for a sitting with no building: the online sentence where the
 * body published an online access; the publisher's stated place (or the
 * publisher's named gap) for a named venue gap; our own named gap otherwise.
 */
export function placelessWhereLine(meeting: OnlineShaped): string {
  if (isOnlineOnly(meeting)) return ONLINE_ONLY_LINE;
  const gap = venueGapOf(meeting);
  return gap ? venueGapLine(gap) : PLACE_UNRECORDED_LINE;
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
