import assert from "node:assert/strict";
import test from "node:test";

import type { AgendaDocumentLike } from "../lib/routing/agenda-search.ts";
import {
  classifyAgendaPublication,
  observationIsFresh,
  DEFAULT_PUBLISHER_OBSERVATION_HOURS,
  MAX_PUBLISHER_OBSERVATION_HOURS,
  type PublisherAgendaObservation,
} from "../lib/ask/agenda-publication.ts";

/**
 * Our empty hands are not their silence: a count of our own rows is never a claim that a
 * government has not published. Only a fresh first-party reading of the publisher's own page may
 * become a sentence about the publisher, scoped to its sitting and the day it was read.
 */

const ROUTE_NOW = Date.parse("2026-08-29T12:00:00.000Z");

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 2 (GREEN) — first-party publisher evidence earns a scoped THEIRS
   ══════════════════════════════════════════════════════════════════════ */

const firstParty = (over: Partial<PublisherAgendaObservation> = {}): PublisherAgendaObservation => ({
  meetingId: "m1",
  provenance: "FIRST_PARTY_PUBLISHER",
  report: "NOT_AVAILABLE",
  observedAt: new Date(ROUTE_NOW - 2 * 3_600_000).toISOString(),
  observedUrl: "https://example.gov/boards/calendar",
  sourceOrg: "Board of Adjustment",
  evidenceQuote: "Agenda: not yet posted",
  ...over,
});

test("GREEN: only FIRST-PARTY provenance can reach the THEIRS branch", () => {
  // A vendor portal or an inference is not the government's own statement about its docket.
  for (const provenance of ["THIRD_PARTY", "INFERRED"] as const) {
    const reading = classifyAgendaPublication({
      bodyName: "Board of Adjustment",
      meetingId: "m1",
      documentsForMeeting: [],
      documentsAcrossCorpus: [],
      observations: [firstParty({ meetingId: "m1", provenance })],
      now: ROUTE_NOW,
    });
    assert.equal(reading.publication, "UNKNOWN", provenance);
    assert.equal(reading.gap?.whose, "OURS", provenance);
  }
});

test("GREEN: an observation of a DIFFERENT sitting never speaks for this one", () => {
  const reading = classifyAgendaPublication({
    bodyName: "Board of Adjustment",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    observations: [firstParty({ meetingId: "m2" })],
    now: ROUTE_NOW,
  });
  assert.equal(reading.publication, "UNKNOWN");
  assert.equal(reading.gap?.whose, "OURS");
});

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 3 (RED) — a stale negative is not current truth
   ══════════════════════════════════════════════════════════════════════ */

test("RED: a publisher negative past its freshness window stops being renderable", () => {
  // Packets often land the evening before a sitting, so an old "not yet posted" reading is not current.
  const stale = firstParty({
    observedAt: new Date(ROUTE_NOW - 8 * 24 * 3_600_000).toISOString(),
  });
  assert.equal(observationIsFresh(stale, ROUTE_NOW), false);


  /* The state is NAMED rather than forgotten, and the obligation stays open. */
  const reading = classifyAgendaPublication({
    bodyName: "Board of Adjustment",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    observations: [{ ...stale, meetingId: "m1" }],
    now: ROUTE_NOW,
  });
  assert.equal(reading.publication, "STALE_OBSERVATION");
  assert.equal(reading.obligationOpen, true);
  assert.equal(reading.alternateSearchOpen, true);
  assert.ok(reading.recheckDueAt, "a stale reading carries the instant it went stale");
});

test("RED: a reading stamped in the future is not fresh either", () => {
  // Fails closed on a broken clock.
  const ahead = firstParty({ observedAt: new Date(ROUTE_NOW + 3_600_000).toISOString() });
  assert.equal(observationIsFresh(ahead, ROUTE_NOW), false);
  assert.equal(observationIsFresh(firstParty({ observedAt: "not-a-date" }), ROUTE_NOW), false);
});

test("the freshness window is bounded at both ends", () => {
  const now = ROUTE_NOW;
  const justInside = firstParty({
    observedAt: new Date(now - (DEFAULT_PUBLISHER_OBSERVATION_HOURS - 1) * 3_600_000).toISOString(),
  });
  const justOutside = firstParty({
    observedAt: new Date(now - (DEFAULT_PUBLISHER_OBSERVATION_HOURS + 1) * 3_600_000).toISOString(),
  });
  assert.equal(observationIsFresh(justInside, now), true);
  assert.equal(observationIsFresh(justOutside, now), false);

  /* A publisher cannot grant its own negative an unlimited shelf life. */
  const greedy = firstParty({
    freshnessHours: 100_000,
    observedAt: new Date(now - (MAX_PUBLISHER_OBSERVATION_HOURS + 1) * 3_600_000).toISOString(),
  });
  assert.equal(observationIsFresh(greedy, now), false);
});

/* ══════════════════════════════════════════════════════════════════════
   CONTROL 4 (GREEN) — the document states still each keep their OWN sentence
   ══════════════════════════════════════════════════════════════════════ */

const doc = (over: Partial<AgendaDocumentLike> = {}): AgendaDocumentLike => ({
  meetingId: "m1",
  documentUrl: "https://example.gov/agenda-2026-09-01.pdf",
  sourceUrl: "https://example.gov/boards",
  sourceOrg: "Town of Example",
  retrievedAt: "2026-08-28T12:00:00.000Z",
  text: "1. Call to order\n2. Approval of minutes\n3. Rezoning of parcel 44\n4. Adjournment",
  extraction: "pdf",
  ...over,
});

test("GREEN: every honest empty is a DIFFERENT state with a DIFFERENT sentence", () => {
  // The document states never collapse into one flat absence, and none is a fact about a government.
  const portal = doc({ documentUrl: "https://example.gov/portal", text: "Board Portal Home Calendar Contact" });
  const cases: Array<[string, ReturnType<typeof classifyAgendaPublication>]> = [
    [
      "NOTHING ACQUIRED",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [],
        documentsAcrossCorpus: [],
        now: ROUTE_NOW,
      }),
    ],
    [
      "ACQUIRED, UNREADABLE",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [doc({ text: null, extraction: "failed" })],
        documentsAcrossCorpus: [doc({ text: null, extraction: "failed" })],
        now: ROUTE_NOW,
      }),
    ],
    [
      "A PORTAL, NOT AN AGENDA",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [portal],
        documentsAcrossCorpus: [portal, { ...portal, meetingId: "m2" }],
        now: ROUTE_NOW,
      }),
    ],
    [
      "READ, NO ITEMS",
      classifyAgendaPublication({
        bodyName: "Town Board",
        meetingId: "m1",
        documentsForMeeting: [doc({ text: "The board will discuss the published budget proposal." })],
        documentsAcrossCorpus: [doc({ text: "The board will discuss the published budget proposal." })],
        now: ROUTE_NOW,
      }),
    ],
  ];

  const sentences = cases.map(([, r]) => r.gap?.statement ?? "");
  for (const [name, reading] of cases) {
    assert.ok(reading.gap, `${name} must produce a named gap`);
    assert.equal(reading.gap?.whose, "OURS", `${name} is a fact about US`);
    assert.equal(reading.obligationOpen, true, `${name} leaves the hunt open`);
  }
  assert.equal(
    new Set(sentences).size,
    cases.length,
    `a state lost its own sentence and collapsed into another: ${sentences.join(" | ")}`,
  );
  assert.equal(new Set(cases.map(([, r]) => r.acquisition)).size, cases.length);

  /* And the fifth: items reader-ready is NOT a gap at all. */
  const ready = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [doc()],
    documentsAcrossCorpus: [doc()],
    now: ROUTE_NOW,
  });
  assert.equal(ready.acquisition, "ITEMS_READER_READY");
  assert.equal(ready.gap, null);
  assert.equal(ready.obligationOpen, false);
  assert.ok(ready.items.length > 0);
});

test("a discovered link and a blocked route are their own states, and neither is an absence", () => {
  // A blocked route (CAPTCHA, 403, missing adapter) leaves the record question open.
  const discovered = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    discoveredDocumentUrl: "https://example.gov/agenda.pdf",
    now: ROUTE_NOW,
  });
  assert.equal(discovered.acquisition, "REPRESENTATION_DISCOVERED");
  assert.equal(discovered.gap?.whose, "OURS");

  const blocked = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    discoveredDocumentUrl: "https://example.gov/agenda.pdf",
    routeAttempts: [
      {
        meetingId: "m1",
        routeId: "novusagenda:direct",
        outcome: "BLOCKED",
        attemptedAt: "2026-08-29T00:00:00.000Z",
        note: "CAPTCHA",
      },
    ],
    now: ROUTE_NOW,
  });
  assert.equal(blocked.acquisition, "ROUTE_BLOCKED");
  assert.equal(blocked.gap?.whose, "OURS");
  assert.notEqual(blocked.gap?.statement, discovered.gap?.statement);
  assert.equal(blocked.alternateSearchOpen, true, "one blocked route is not an exhausted ladder");
});

test("an amended agenda is CURRENT plus SUPERSEDED, never one flat document", () => {
  // The reading names its version and keeps earlier ones addressable. An amendment is a change of
  // content: the same words at a second address, or re-read later, are one version.
  const first = doc({ documentUrl: "https://example.gov/a-v1.pdf", retrievedAt: "2026-08-20T12:00:00.000Z" });
  const amended = doc({
    documentUrl: "https://example.gov/a-v2.pdf",
    retrievedAt: "2026-08-27T12:00:00.000Z",
    text: "1. Call to order\n2. Approval of minutes\n3. Rezoning of parcel 44\n4. Road salt contract\n5. Adjournment",
  });
  const reading = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [first, amended],
    documentsAcrossCorpus: [first, amended],
    now: ROUTE_NOW,
  });
  assert.equal(reading.currentDocumentUrl, amended.documentUrl, "the CURRENT version is the newest");
  assert.deepEqual(reading.supersededDocumentUrls, [first.documentUrl]);
  assert.equal(reading.revised, true);
});

test("a publisher that says the agenda IS up, while we hold nothing, is still OURS", () => {
  // Their page saying a packet is posted makes the gap ours, and the sentence says where to go next.
  const reading = classifyAgendaPublication({
    bodyName: "Town Board",
    meetingId: "m1",
    documentsForMeeting: [],
    documentsAcrossCorpus: [],
    observations: [firstParty({ meetingId: "m1", report: "AVAILABLE" })],
    now: ROUTE_NOW,
  });
  assert.equal(reading.publication, "REPORTS_AVAILABLE");
  assert.equal(reading.gap?.whose, "OURS");
  assert.match(reading.gap!.statement, /going after it/);
  assert.equal(reading.obligationOpen, true);
});
