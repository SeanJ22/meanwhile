/**
 * The one agenda sentence both meeting surfaces render. `agendaUrl === null`
 * alone is a fact about us, not the publisher. A fresh first-party observation
 * that the slot was empty yields THEIRS ("No agenda posted yet", with whose
 * page and when); anything else yields OURS.
 */

import {
  observationFromMeetingRecord,
  observationIsFresh,
  type PublisherAgendaObservation,
} from "./agenda-publication.ts";

/** What a surface needs to render, and whose fact it is. */
export interface AgendaSentence {
  /** OURS is a fact about this product. THEIRS is a fact about a publisher. */
  readonly whose: "OURS" | "THEIRS";
  /** Reader-facing, plain language. No enum value, no OCD-ID. */
  readonly sentence: string;
  /** The observation that earned a THEIRS, so a surface can link the page. Null on every OURS. */
  readonly observation: PublisherAgendaObservation | null;
}

/** The minimum a surface must pass. Deliberately the shape of a `Meeting`. */
export interface AgendaSentenceInput {
  readonly id: string;
  readonly agendaUrl?: string | null;
  readonly agendaSlotObservedEmpty?: boolean;
  readonly provenance?: {
    readonly sourceUrl: string | null;
    readonly sourceOrg: string;
    readonly collectedAt: string;
    readonly secondHand?: boolean;
  };
  readonly carried?: unknown;
}

/** A short plain date, never a relative one, which would drift with the render. */
function plainDay(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The sentence for one meeting's agenda state. `now` is a parameter: this module is not a clock. */
export function agendaSentenceFor(
  meeting: AgendaSentenceInput,
  now: number = Date.now(),
): AgendaSentence {
  const observation = observationFromMeetingRecord(meeting);

  if (observation !== null && observationIsFresh(observation, now)) {
    const day = plainDay(observation.observedAt);
    return {
      whose: "THEIRS",
      /* Short and plain, with whose surface was read and when, so the reader can check `observedUrl`. */
      sentence: day
        ? `${observation.sourceOrg} hadn't posted an agenda for this meeting when we checked on ${day}`
        : `${observation.sourceOrg} hadn't posted an agenda for this meeting when we checked`,
      observation,
    };
  }

  /* The default is OURS, including an expired observation. */
  return {
    whose: "OURS",
    sentence: "We haven't recorded an agenda for this meeting yet",
    observation: null,
  };
}
