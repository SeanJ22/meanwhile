/**
 * **DOES THIS SOURCE'S SURFACE HAVE A PLACE WHERE AN AGENDA WOULD APPEAR?**
 * (Session B closure, ASK-18, 2026-08-31.)
 *
 * ## The four answers, and no two of them mean the same thing
 *
 * ```
 *   PRESENT                  the surface carries a PER-SITTING agenda slot. An
 *                            empty one is OBSERVABLE, and an adapter that reads
 *                            it may set `agendaSlotObservedEmpty`.
 *   PRESENT_NOT_PER_SITTING  a slot exists and is not attached to a sitting, so
 *                            an empty one is not THAT sitting's answer. Added
 *                            2026-08-31 — see the note on AGENDA_SLOT_STATES.
 *   ABSENT                   the surface has no agenda field AT ALL. There is
 *                            nothing to observe, and never will be on this
 *                            route.
 *   UNKNOWN                  nobody has looked at this adapter's surface yet.
 * ```
 *
 * `ABSENT` and `UNKNOWN` both produce no observation and therefore render the
 * same OURS gap to a reader — which is exactly why they have to be different
 * facts in the record. `ABSENT` is a finished answer: an iCalendar VEVENT has
 * no agenda property, so a missing agenda link on an iCal row says nothing
 * whatsoever about whether the body posted a packet, and no amount of adapter
 * work will change that. `UNKNOWN` is work nobody has done.
 *
 * Without this distinction the two are indistinguishable in the codebase — an
 * adapter that will never observe and an adapter nobody has got to yet look
 * identical, which is how the second quietly becomes the first.
 *
 * ## What this does NOT do
 *
 * It does not permit a THEIRS claim. `PRESENT` says the slot exists; only the
 * adapter's own reading of THAT SITTING, at the moment of the read, can say the
 * slot was empty, and `observationFromMeetingRecord` refuses everything else.
 * This is the precondition, never the evidence.
 *
 * **An `ABSENT` route is a route, not a verdict on the record.** The record
 * obligation stays open: `IT EXISTS = GET IT` is unaffected by one route having
 * no agenda field, and the answer is to find another representation, not to
 * conclude anything about the publisher.
 */

/**
 * **A FOURTH STATE, AND THE 2026-08-31 INSPECTION IS WHY.** (ASK-18.)
 *
 * Opening all eleven UNKNOWN adapters found two surfaces the three states
 * could not describe honestly, and both are the same shape: an agenda slot
 * that exists but is not attached to a SITTING.
 *
 * `clerksboards` posts one CURRENT agenda for the board, so a null on any
 * other sitting means the current agenda is not that one's. `civicplus` runs
 * two routes and only one of them carries a per-meeting link, so whether a
 * sitting is observable depends on which route produced it.
 *
 * Calling either `PRESENT` would license a THEIRS sentence the surface does
 * not support — the exact overreach ASK-07 corrected, where a branch emitted
 * *the district has not published* off our own empty field. Calling either
 * `ABSENT` would say the surface has no agenda at all, which is false and
 * would retire a route that does publish them.
 *
 * So the state says what is true: a slot exists, it is not per-sitting, and an
 * empty one is therefore not observable FOR A SITTING. No source taxonomy in
 * this project is ever complete — this is that rule working rather than a
 * vocabulary being stretched.
 */
export const AGENDA_SLOT_STATES = [
  "PRESENT",
  "PRESENT_NOT_PER_SITTING",
  "ABSENT",
  "UNKNOWN",
] as const;
export type AgendaSlotState = (typeof AGENDA_SLOT_STATES)[number];

export interface AgendaSlotDeclaration {
  readonly state: AgendaSlotState;
  /** What was actually looked at to decide. Never a guess about a vendor. */
  readonly basis: string;
}

/**
 * Per adapter, as this project currently knows it.
 *
 * Every row is a claim about a SURFACE we have read, and the basis says which.
 * A vendor's product having an agenda feature somewhere is not evidence that
 * the surface THIS adapter reads exposes one.
 */
export const AGENDA_SLOT_BY_ADAPTER: Readonly<Record<string, AgendaSlotDeclaration>> = {
  legistar: {
    state: "PRESENT",
    basis:
      "the Events resource returns `EventAgendaFile` on the event object itself. The key being " +
      "present with a null value is the publisher's own record saying this sitting has a place " +
      "for an agenda and it is empty. lib/sources/legistar/index.ts sets the observation from it.",
  },
  ical: {
    state: "ABSENT",
    basis:
      "an iCalendar VEVENT has no agenda property. lib/sources/ical/index.ts writes " +
      "`agendaUrl: null` unconditionally because there is no field to read — not because a body " +
      "posted nothing. 187 of the 426 agenda-less rows in the 2026-08-31 snapshot come from " +
      "here, and every one of them is OUR gap permanently on this route. The record is still " +
      "owed; the answer is another representation, not a conclusion about the publisher.",
  },
  "legistar-insite": {
    state: "PRESENT",
    basis:
      "the calendar grid carries a per-row agenda cell with an href and a status string, and " +
      "lib/sources/legistar-insite/index.ts reads BOTH — it keeps the cell's own words as a " +
      "per-sitting observation rather than discarding them into a null. Read from the 19 " +
      "committed insite fixtures rather than from the 2026-08-31 run, which was WALLED; a wall " +
      "is a fact about that run's transport and never about the surface.",
  },
  clerksboards: {
    state: "PRESENT_NOT_PER_SITTING",
    basis:
      "the board page posts ONE CURRENT agenda PDF, and lib/sources/clerksboards/index.ts " +
      "attaches it only to the sitting whose date its title names. So a null on any other " +
      "sitting means the current agenda is not that one's — not that the Clerk left that " +
      "sitting's slot empty. 103 agenda-less rows, and none of them is observable per sitting " +
      "on this route.",
  },
  schedulepage: {
    state: "PRESENT",
    basis:
      "the schedule page carries a per-row agenda link and lib/sources/schedulepage/index.ts " +
      "resolves it against the page base. A row with no link is the page's own per-sitting " +
      "answer. 54 agenda-less rows.",
  },
  civicplus: {
    state: "PRESENT_NOT_PER_SITTING",
    basis:
      "TWO routes, and they disagree, which is why this is not PRESENT. The iCal feed carries " +
      "no per-meeting agenda link at all — lib/sources/civicplus/index.ts writes a null agenda " +
      "unconditionally on that path and says so in its own comment — while the ARCHIVE path " +
      "reads a per-sitting agendaHref. A sitting produced by the feed is therefore not " +
      "observable and a sitting produced by the archive is. An adapter is a route portfolio, " +
      "not one fetch function (RULING 207), and this row states the WEAKER of its two routes " +
      "because a reader sentence may only rest on the route the sitting actually came from.",
  },
  diligent: {
    state: "ABSENT",
    basis:
      "the meeting object has NO agenda field. Read from tests/fixtures/diligent-tusd-" +
      "meetings.json, whose keys are CleanName, MeetingDate, MeetingLocation, MeetingTypeName, " +
      "Published and VideoIcon. lib/sources/diligent/index.ts maps Published to the MEETING " +
      "page URL — so a false Published is a fact about the meeting record's publication and " +
      "never about an agenda. 16 agenda-less rows, none observable on this route.",
  },
  iqm2: {
    state: "PRESENT",
    basis:
      "the citizens calendar carries a per-row agenda anchor; lib/sources/iqm2/index.ts parses " +
      "it into agendaHref per row and resolves it against the portal base. A row without one " +
      "is the portal's own per-sitting answer. 16 agenda-less rows.",
  },
  apptegy: {
    state: "ABSENT",
    basis:
      "the events JSON has no agenda field. Read from tests/fixtures/apptegy-vail-events.json, " +
      "whose keys are id, title, venue, address, description, start_at, end_at and date " +
      "formatting. lib/sources/apptegy/index.ts calls agendaLinkFrom(event.description), which " +
      "SCRAPES free-text prose — so a missing link means the description did not happen to " +
      "contain one, which says nothing about whether the district posted a packet. 8 " +
      "agenda-less rows.",
  },
  civicclerk: {
    state: "PRESENT",
    basis:
      "the portal's event object carries hasAgenda, the publisher's OWN boolean for a published " +
      "agenda, read directly by lib/sources/civicclerk/index.ts. This is the strongest form the " +
      "declaration takes: false is the publisher stating the slot is empty for that sitting. " +
      "3 agenda-less rows.",
  },
  onbase: {
    state: "PRESENT",
    basis:
      "the meeting table carries a per-row agenda PDF link, parsed into agendaPdfUrl by " +
      "lib/sources/onbase/index.ts against tests/fixtures/onbase-tucson.html. 2 agenda-less rows.",
  },
  revize: {
    state: "PRESENT",
    basis:
      "each sitting carries a documents list and lib/sources/revize/index.ts selects the agenda " +
      "document from it per sitting. A sitting whose list holds no agenda is the site's own " +
      "per-sitting answer. 1 agenda-less row.",
  },
  boardbook: {
    state: "PRESENT",
    basis:
      "each row-for-board block carries an Agenda link, and lib/sources/boardbook/index.ts sets " +
      "hasAgenda from the block's own markup — verified against " +
      "tests/fixtures/boardbook-amphi-2065.html, which contains the Agenda cell the parser " +
      "matches. A row without one is BoardBook's per-sitting answer.",
  },
  "pima-edu": {
    state: "PRESENT",
    basis:
      "the college's documents table carries a per-sitting Agenda cell, read by " +
      "lib/sources/pima-edu/index.ts from tests/fixtures/pima-edu/documents-2026.html: a link (a " +
      "first-party PDF, or the college's link into its agenda platform) or plain text. The adapter " +
      "carries the link and deliberately records NO observation for a text-only cell, because this " +
      "page mirrors the college's agenda platform and can lag it — an unlinked cell here is not the " +
      "college saying it posted nothing, so every null stays OUR gap.",
  },
  mock: { state: "ABSENT", basis: "fixtures are not a publisher surface and observe nothing." },
};

/** What this project knows about one adapter's surface. Never defaults to ABSENT. */
export function agendaSlotFor(adapter: string): AgendaSlotDeclaration {
  return (
    AGENDA_SLOT_BY_ADAPTER[adapter] ?? {
      /* An adapter nobody declared is UNKNOWN, never ABSENT. Defaulting to
         ABSENT would silently convert every new adapter into a finished answer
         about a surface nobody has opened. */
      state: "UNKNOWN",
      basis: `no declaration exists for adapter ${JSON.stringify(adapter)}; nobody has looked`,
    }
  );
}

/** Adapters that could, with work, produce a publisher observation. */
export function adaptersAwaitingInspection(): readonly string[] {
  return Object.entries(AGENDA_SLOT_BY_ADAPTER)
    .filter(([, d]) => d.state === "UNKNOWN")
    .map(([name]) => name)
    .sort();
}

/**
 * **MAY AN ADAPTER'S NULL EVER BE THE PUBLISHER'S ANSWER FOR ONE SITTING?**
 * (ASK-18, 2026-08-31.)
 *
 * `PRESENT` is the only state that admits a per-sitting observation, and the
 * word "only" is the whole function. The other three each fail for their own
 * reason and the reasons are not interchangeable:
 *
 * ```
 *   PRESENT_NOT_PER_SITTING  a slot exists and is not attached to a sitting,
 *                            so an empty one is not that sitting's answer
 *   ABSENT                   there is no slot, so there is nothing to be empty
 *   UNKNOWN                  nobody has looked, and not-looked is not empty
 * ```
 *
 * This is the second wall behind `observationFromMeetingRecord`, which already
 * refuses everything but an adapter's explicit `agendaSlotObservedEmpty`. That
 * gate is about the READING; this one is about the SURFACE, and a surface that
 * cannot answer per sitting must not have an adapter setting the flag on it
 * however carefully the adapter reads.
 */
export function mayObservePerSitting(adapter: string): boolean {
  return agendaSlotFor(adapter).state === "PRESENT";
}
