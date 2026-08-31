/**
 * **DOES THIS SOURCE'S SURFACE HAVE A PLACE WHERE AN AGENDA WOULD APPEAR?**
 * (Session B closure, ASK-18, 2026-08-31.)
 *
 * ## The three answers, and why the third is not the second
 *
 * ```
 *   PRESENT   the surface carries an agenda slot. An empty one is OBSERVABLE,
 *             and an adapter that reads it may set `agendaSlotObservedEmpty`.
 *   ABSENT    the surface has no agenda field AT ALL. There is nothing to
 *             observe, and there never will be on this route.
 *   UNKNOWN   nobody has looked at this adapter's surface yet.
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

export const AGENDA_SLOT_STATES = ["PRESENT", "ABSENT", "UNKNOWN"] as const;
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
    state: "UNKNOWN",
    basis:
      "the source was WALLED on the 2026-08-31 run (timed out after 120s) and all 17 of its " +
      "agenda-less rows are CARRIED forward, so nothing was read to decide this on.",
  },
  clerksboards: { state: "UNKNOWN", basis: "not yet inspected. 103 agenda-less rows." },
  schedulepage: { state: "UNKNOWN", basis: "not yet inspected. 54 agenda-less rows." },
  civicplus: { state: "UNKNOWN", basis: "not yet inspected. 19 agenda-less rows." },
  diligent: { state: "UNKNOWN", basis: "not yet inspected. 16 agenda-less rows." },
  iqm2: { state: "UNKNOWN", basis: "not yet inspected. 16 agenda-less rows." },
  apptegy: { state: "UNKNOWN", basis: "not yet inspected. 8 agenda-less rows." },
  civicclerk: { state: "UNKNOWN", basis: "not yet inspected. 3 agenda-less rows." },
  onbase: { state: "UNKNOWN", basis: "not yet inspected. 2 agenda-less rows." },
  revize: { state: "UNKNOWN", basis: "not yet inspected. 1 agenda-less row." },
  boardbook: { state: "UNKNOWN", basis: "not yet inspected." },
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
