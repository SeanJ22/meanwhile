/**
 * A first-party observation that a publisher has not posted an agenda is derived only when the
 * adapter measured the publisher's own agenda slot as empty (`agendaSlotObservedEmpty`). A null
 * `agendaUrl` alone may mean a "Not Available" cell, a feed format with no agenda field, or a packet
 * on an unlinked page, so it is never an observation.
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
  const basis = structuralBasisFor("Pima County");
  assert.match(basis, /carried no agenda link when we read it/);
  assert.ok(!/no agenda (has been|was) published/i.test(basis));
  assert.ok(!/there is no agenda/i.test(basis));
  assert.equal(observationFromMeetingRecord(meeting())?.evidenceQuote, basis);
});

test("SEEDED ASK-18: a null agendaUrl ALONE is never an observation", () => {
  // Not measured is never not published.
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
  assert.equal(observationFromMeetingRecord(meeting({ carried: { reason: "source refused" } })), null);
});

test("ASK-18 REFUSAL: a shape that dropped provenance yields nothing, never blanks", () => {
  assert.equal(observationFromMeetingRecord({ id: "m", agendaUrl: null }), null);
});
