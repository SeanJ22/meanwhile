/**
 * **THE ONE SENTENCE BOTH AGENDA SURFACES RENDER.**
 * (Session B resume, W2 — SWEEP-01 and ASK-18, 2026-08-31.)
 *
 * ## What was wrong
 *
 * `components/map/meeting-panel.tsx` and `components/map/popup/agenda-section.tsx`
 * each rendered *"No agenda posted yet"* on `!meeting.agendaUrl`. That is a
 * sentence about a GOVERNMENT — a clerk has not posted the packet — produced
 * from a measurement of US: this product holds no agenda link for that row.
 *
 * `agendaUrl === null` conflates at least four facts. A Legistar grid printing
 * a literal "Not Available". An iCal feed with no agenda field at all. A body
 * that posts packets on a page its calendar never links. And an adapter that
 * simply never looked. Only the first is evidence about the publisher, and the
 * render treated all four as the first.
 *
 * ## Why it could not simply be reworded
 *
 * The owner explicitly PRAISED this register (POS-2) and asked the Ask surface
 * to adopt it. Rewriting it to *"we haven't recorded this yet"* everywhere
 * would make the product worse by the owner's measure while making it more
 * correct by the constitution's. So the sentence is kept where it is EARNED
 * and attributed to us where it is not — which needs an observation, which is
 * what the adapter work now supplies.
 *
 * ## The rule
 *
 * ```
 *   a FRESH first-party observation that the slot was empty  ->  THEIRS
 *   anything else                                            ->  OURS
 * ```
 *
 * One function, called by both surfaces, so they cannot drift apart. The whole
 * defect was two components independently deciding what a null means.
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
  /**
   * The observation that earned a THEIRS, so a surface can offer the reader
   * the page it was read from. Null on every OURS.
   */
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

/**
 * A short, plain date. Never a relative one.
 *
 * "when we checked" needs a DAY a reader can place, and "2 days ago" drifts
 * with the render rather than with the reading — the same stale-snapshot shape
 * the observation window exists to prevent, moved into the sentence.
 */
function plainDay(iso: string): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  return new Date(at).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Decide the sentence for one meeting's agenda state.
 *
 * `now` is a parameter because this module is not a clock and because a
 * freshness window that read the wall clock could not be tested at its edges.
 */
export function agendaSentenceFor(
  meeting: AgendaSentenceInput,
  now: number = Date.now(),
): AgendaSentence {
  const observation = observationFromMeetingRecord(meeting);

  if (observation !== null && observationIsFresh(observation, now)) {
    const day = plainDay(observation.observedAt);
    return {
      whose: "THEIRS",
      /*
       * The owner's register, kept — short, plain, no verdict on anyone. What
       * is added is the two things that make it TRUE rather than assumed: whose
       * surface was read, and when. A reader can open `observedUrl` and see the
       * same empty slot, which is what makes this checkable rather than
       * asserted.
       */
      sentence: day
        ? `${observation.sourceOrg} hadn't posted an agenda for this meeting when we checked on ${day}`
        : `${observation.sourceOrg} hadn't posted an agenda for this meeting when we checked`,
      observation,
    };
  }

  /*
   * THE DEFAULT IS OURS, ALWAYS.
   *
   * An expired observation lands here too, and that is the point of the window:
   * a "not posted" read a week before a sitting is true of the moment it was
   * taken and false of now. Packets in this corpus land in the last days before
   * a meeting, so a stale negative is at its most wrong exactly when a reader
   * is most likely to be asking.
   */
  return {
    whose: "OURS",
    sentence: "We haven't recorded an agenda for this meeting yet",
    observation: null,
  };
}
