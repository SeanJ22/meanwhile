/**
 * **ASK-18 — THE PRODUCT STOPS BLAMING ITSELF FOR SOMEONE ELSE'S TIMING.**
 * (Session B, WS2, 2026-08-30.)
 *
 * The owner asked *"what's on the Pima agenda?"* and read back: *We have not
 * yet acquired the agenda for that meeting — we're still looking for it.* He
 * had checked at 8:30 that morning and confirmed no agenda was posted for
 * either Pima sitting that day. His note: *"It makes me concerned that it's
 * kind of defaulting to 'we don't have this agenda.' Well we don't have the
 * agenda because it does exist"* — meaning the meeting exists and the agenda
 * does not, and the product should say so.
 *
 * `gapFor` has had a THEIRS branch since ASK-05 and it is correct. It is also
 * unreachable outside the Legistar lane, because nothing else populates a
 * first-party observation. `MeetingLike`, the hand-narrowed shape the Ask
 * route reads, did not even declare `provenance`, so the publisher, the page
 * and the read time travelled on the wire and were unreachable by declaration
 * — the defect ASK-05 recorded one type over, where two hand-copied contact
 * types dropped `sourceOrg` and `retrievedAt`. That is now widened.
 *
 * ## WHAT DID NOT SHIP, AND WHY IT IS RECORDED HERE RATHER THAN QUIETLY
 *
 * The first cut of this derived the observation from `agendaUrl === null` plus
 * a first-party provenance, and it was WRONG. It shipped green in this file
 * and was caught by `tests/agenda-publication-state.test.ts`, which exists for
 * exactly this and refused it:
 *
 * ```
 *   an EMPTY AGENDA CELL on a page that has one   is evidence
 *   a feed with NO AGENDA FIELD AT ALL            measures the file format
 * ```
 *
 * A Legistar grid prints a literal "Not Available"; an iCal feed has no agenda
 * field to be empty; plenty of bodies post packets on a page the calendar never
 * links. `agendaUrl === null` collapses all three, and turning it into *"they
 * have not posted an agenda"* would have been a false claim about a government
 * drawn from the shape of a file format — shipped to close a feedback row.
 *
 * So the gate is `agendaSlotObservedEmpty`, set by the ADAPTER at the moment of
 * the read. **No adapter records it yet, so this returns null everywhere
 * today.** The seam is built, wired into the Ask route and tested; ASK-18
 * stays OPEN with that adapter work as its named blocker.
 *
 * These tests hold the derivation and, more importantly, every case where it
 * REFUSES — because the failure mode of getting this wrong is a false claim
 * about a government, which is the one this product cannot survive.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  observationFromMeetingRecord,
  structuralBasisFor,
} from "../lib/ask/agenda-publication.ts";

function meeting(over: Record<string, unknown> = {}) {
  return {
    id: "pima:1381574",
    agendaUrl: null,
    /* The adapter measured the publisher's own agenda slot and it was empty.
       Nothing infers this from a null agendaUrl — see the narrowing note. */
    agendaSlotObservedEmpty: true,
    provenance: {
      sourceUrl: "https://pima.legistar.com/Calendar.aspx",
      sourceOrg: "Pima County",
      collectedAt: "2026-08-30T15:00:00.000Z",
    },
    ...over,
  };
}

test("ASK-18: a first-party calendar read with no agenda link IS an observation", () => {
  const observed = observationFromMeetingRecord(meeting());
  assert.ok(observed);
  assert.equal(observed.report, "NOT_AVAILABLE");
  assert.equal(observed.provenance, "FIRST_PARTY_PUBLISHER");
  assert.equal(observed.meetingId, "pima:1381574");
  assert.equal(observed.observedUrl, "https://pima.legistar.com/Calendar.aspx");
  assert.equal(observed.observedAt, "2026-08-30T15:00:00.000Z");
});

test("ASK-18: the basis describes the PAGE and never claims an agenda does not exist", () => {
  /*
   * The whole risk in this extension is a shade of wording. "carried no agenda
   * link" describes a surface a reader can open. "no agenda has been
   * published" is a claim about a government that no page was read for, and
   * the difference is the difference between evidence and an assertion.
   */
  const basis = structuralBasisFor("Pima County");
  assert.match(basis, /carried no agenda link when we read it/);
  assert.ok(!/no agenda (has been|was) published/i.test(basis));
  assert.ok(!/there is no agenda/i.test(basis));
  assert.equal(observationFromMeetingRecord(meeting())?.evidenceQuote, basis);
});

test("SEEDED ASK-18: a null agendaUrl ALONE is never an observation", () => {
  /*
   * The decisive refusal, and the one the first cut of this got wrong.
   *
   * Everything else about this record is impeccable — first-party provenance,
   * a nameable page, a real read time, not carried forward. The single thing
   * missing is the adapter having measured that the surface HAS an agenda slot
   * which was empty. Without that, `agendaUrl === null` might mean the cell
   * said "Not Available", or that the feed format has no agenda field, or that
   * the packet lives on a page this calendar never links.
   *
   * Not-measured is never not-published.
   */
  const unmeasured = meeting({ agendaSlotObservedEmpty: undefined });
  assert.equal(observationFromMeetingRecord(unmeasured), null);
  assert.equal(observationFromMeetingRecord(meeting({ agendaSlotObservedEmpty: false })), null);
});

test("ASK-18 REFUSAL: an agenda we hold is not an absence to observe", () => {
  assert.equal(
    observationFromMeetingRecord(meeting({ agendaUrl: "https://example.gov/a.pdf" })),
    null,
  );
});

test("ASK-18 REFUSAL: a page we cannot name is a page a reader cannot check", () => {
  /* An unverifiable observation is an assertion wearing a timestamp. */
  const noUrl = meeting({
    provenance: { sourceUrl: null, sourceOrg: "Pima County", collectedAt: "2026-08-30T15:00:00Z" },
  });
  assert.equal(observationFromMeetingRecord(noUrl), null);
});

test("ASK-18 REFUSAL: an aggregator's missing link says nothing about what the BODY posted", () => {
  const secondHand = meeting({
    provenance: {
      sourceUrl: "https://aggregator.example/cal",
      sourceOrg: "Some Index",
      collectedAt: "2026-08-30T15:00:00Z",
      secondHand: true,
    },
  });
  assert.equal(observationFromMeetingRecord(secondHand), null);
});

test("ASK-18 REFUSAL: a carried-forward row's timestamp is not when this listing was read", () => {
  /* The source refused that run and the row came out of the previous snapshot.
     Nothing about a carried row may render a freshness it does not have. */
  assert.equal(observationFromMeetingRecord(meeting({ carried: { reason: "source refused" } })), null);
});

test("ASK-18 REFUSAL: a shape that dropped provenance yields nothing, never blanks", () => {
  /* This is the state the Ask route was actually in. It must produce NO
     observation rather than one with empty fields — an observation that cannot
     say who published or when it was read is not evidence of anything. */
  assert.equal(observationFromMeetingRecord({ id: "m", agendaUrl: null }), null);
});
