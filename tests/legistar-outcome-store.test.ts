import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  publicationStatusFor,
  refreshDecision,
  mergeSnapshot,
  toPersistedSitting,
} from "../lib/outcomes/ingest.ts";
import {
  outcomeEvidenceFor,
  publicationObservationsFor,
  resetOutcomeSnapshotCache,
  useOutcomeSnapshotForTests,
  loadedFrom,
} from "../lib/outcomes/store.ts";
import type {
  OutcomeSnapshot,
  PersistedSittingOutcomes,
} from "../lib/outcomes/types.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";

const FIXTURE_PATH = join(process.cwd(), "tests/fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json");
const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";

function fixtureStore(): OutcomeSnapshot {
  return JSON.parse(
    readFileSync(FIXTURE_PATH, "utf8"),
  ) as OutcomeSnapshot;
}

test("the fixture store carries the shape and the seeded failures claimed for it", () => {
  const store = fixtureStore();
  const states = store.sittings.map((s) => s.extraction);
  assert.ok(states.includes("RETRIEVED"), "a healthy sitting");
  assert.ok(states.includes("ZERO_ROWS_FAILED"), "a seeded zero-row failure");
  assert.ok(
    store.sittings.some((s) => s.outcomes.length > 0 && s.rollCalls.length === 0),
    "a seeded acted-with-no-roll-call sitting",
  );
  assert.ok(
    store.sittings.some((s) => s.agenda.length > 0 && s.outcomes.length === 0),
    "a seeded noticed-but-not-acted sitting",
  );
});

test("HELD: a sitting with roll calls answers HOW_DID_THEY_VOTE with roll calls only", () => {
  const healthy = fixtureStore().sittings.find((s) => s.rollCalls.length > 0);
  assert.ok(healthy, "the fixture holds a sitting with real roll calls");

  useOutcomeSnapshotForTests(fixtureStore());
  const evidence = outcomeEvidenceFor(
    { meetingId: healthy.meetingId, questionClass: "HOW_DID_THEY_VOTE" },
  );
  useOutcomeSnapshotForTests(null);

  assert.equal(evidence.state, "HELD");
  assert.equal(evidence.answerable, true);
  assert.ok(evidence.records.length > 0);
  assert.equal(evidence.gap, null);
  for (const record of evidence.records) {
    assert.equal(
      record.recordClass,
      "ROLL_CALL",
      "only a roll call answers how each member voted; an ACTION_SUMMARY carries " +
        "the result and not each member's position",
    );
  }
});

test("SEEDED FAILURE: 135 agenda records can never reach a WHAT_WAS_DECIDED answer", () => {
  // Agenda records are absent from `records` and reported in `refused`.
  useOutcomeSnapshotForTests(fixtureStore());
  const evidence = outcomeEvidenceFor(
    {
      meetingId: "legistar:pima:9000001",
      questionClass: "WHAT_WAS_DECIDED",
    },
  );
  useOutcomeSnapshotForTests(null);

  assert.equal(evidence.state, "NO_ACTION_RECORDED");
  assert.equal(evidence.answerable, false);
  assert.deepEqual(evidence.records, []);
  assert.ok(
    evidence.refused.some((r) => r.recordClass === "AGENDA" && r.count > 0),
    "the agenda records are reported as refused, never silently dropped",
  );
  assert.match(String(evidence.gap), /no action recorded/i);
});

test("SEEDED FAILURE: a zero-row extraction reads as OUR failed retrieval, not as their empty meeting", () => {
  useOutcomeSnapshotForTests(fixtureStore());
  const evidence = outcomeEvidenceFor(
    { meetingId: "legistar:pima:9000002", questionClass: "WHAT_WAS_DECIDED" },
  );
  useOutcomeSnapshotForTests(null);

  assert.equal(evidence.state, "EXTRACTION_FAILED");
  assert.equal(evidence.answerable, false);
  assert.match(
    String(evidence.gap),
    /failed retrieval on our side/i,
    "the gap must name OUR failure — a meeting with nothing on it is a claim " +
      "about a government and this is not one",
  );
  assert.ok(evidence.openFailures.length > 0, "and it stays open for retry");
});

test("ACTION_WITHOUT_ROLL_CALL is a fact about THEM and is not the same state as holding nothing", () => {
  useOutcomeSnapshotForTests(fixtureStore());
  const evidence = outcomeEvidenceFor(
    { meetingId: "legistar:pima:9000003", questionClass: "HOW_DID_THEY_VOTE" },
  );
  useOutcomeSnapshotForTests(null);

  assert.equal(evidence.state, "ACTION_WITHOUT_ROLL_CALL");
  assert.equal(evidence.answerable, false);
  assert.match(String(evidence.gap), /action is published/i);

  // And the same sitting DOES answer what was decided.
  useOutcomeSnapshotForTests(fixtureStore());
  const decided = outcomeEvidenceFor(
    { meetingId: "legistar:pima:9000003", questionClass: "WHAT_WAS_DECIDED" },
  );
  useOutcomeSnapshotForTests(null);
  assert.equal(decided.state, "HELD");
  assert.ok(decided.records.length > 0);
});

test("NO_SITTING_HELD is about US, and an unknown body does not read as a body that never met", () => {
  useOutcomeSnapshotForTests(fixtureStore());
  const evidence = outcomeEvidenceFor(
    {
      bodyId: "ocd-division/country:us/state:az/county:nowhere#governing",
      questionClass: "WHAT_WAS_DECIDED",
    },
  );
  useOutcomeSnapshotForTests(null);

  assert.equal(evidence.state, "NO_SITTING_HELD");
  assert.match(String(evidence.gap), /gap in what we have collected/i);
  assert.ok(
    !/did not meet|no meetings|has not published/i.test(String(evidence.gap)),
    "the gap sentence must not make a claim about the body",
  );
});

test("an empty store is the empty store and every query stays honest", () => {
  useOutcomeSnapshotForTests({
    generatedOn: "UNKNOWN",
    generatedAt: "UNKNOWN",
    tenants: [],
    sittings: [],
  });
  const evidence = outcomeEvidenceFor({
    bodyId: PIMA_BOARD,
    questionClass: "WHAT_WAS_DECIDED",
  });
  const loaded = loadedFrom();
  useOutcomeSnapshotForTests(null);

  assert.equal(evidence.state, "NO_SITTING_HELD");
  assert.equal(evidence.answerable, false);
  assert.equal(loaded, "EMPTY_STORE", "an empty store must report itself as empty, never as a file");
  assert.ok(
    !/did not meet|no meetings|has not published|recorded no/i.test(String(evidence.gap)),
    "an empty store produced a sentence about the body rather than about us",
  );
});

test("publication status is carried verbatim beside the instant WE observed it", () => {
  const event = JSON.parse(
    readFileSync(
      join(process.cwd(), "tests", "fixtures", "legistar", "pima-event-1825.json"),
      "utf8",
    ),
  ) as LegistarEvent;

  const status = publicationStatusFor(event, "2026-08-29T20:00:00.000Z");

  assert.equal(status.agendaStatusName, "Final");
  assert.equal(status.agendaStatusId, 10);
  assert.equal(status.agendaLastPublishedUtc, "2026-08-25T18:04:04.46");
  assert.equal(status.minutesStatusName, "Draft");
  assert.equal(status.minutesLastPublishedUtc, "2026-08-27T18:33:36.263");
  assert.equal(status.lastModifiedUtc, "2026-08-27T18:33:36.35");
  assert.equal(status.observedAt, "2026-08-29T20:00:00.000Z");

  // No verdict is computed: "is the agenda published" is answered by the consumer from these fields.
  for (const key of Object.keys(status)) {
    assert.ok(
      !/^(is|has|should|can)[A-Z]/.test(key),
      `${key} looks like a rendered verdict rather than a publisher observation`,
    );
  }
});

test("the store exposes the publisher's agenda reading, reconciled and scoped", () => {
  const store = fixtureStore();
  const sitting = store.sittings.find(
    (s) => (s.publicationObservations ?? []).length > 0,
  );
  assert.ok(sitting, "the fixture store carries publisher readings");

  useOutcomeSnapshotForTests(store);
  const reconciled = publicationObservationsFor(sitting.meetingId);
  const unknown = publicationObservationsFor("legistar:pima:99999999");
  useOutcomeSnapshotForTests(null);
  assert.equal(reconciled.meetingId, sitting.meetingId);
  assert.ok(reconciled.note.length > 0, "always a sentence");

  for (const observation of reconciled.observations) {
    assert.equal(observation.meetingId, sitting.meetingId, "scoped to ONE sitting");
    assert.ok(["FIRST_PARTY_PUBLISHER", "THIRD_PARTY", "INFERRED"].includes(observation.provenance));
    assert.ok(["AVAILABLE", "NOT_AVAILABLE"].includes(observation.report));
    assert.ok(observation.observedAt.length > 0);
    assert.ok(observation.observedUrl.startsWith("http"));
    assert.ok(observation.sourceOrg.length > 0);
    assert.ok(
      observation.evidenceQuote.length > 0,
      "a report with no quoted basis is an assertion, and this product does not " +
        "carry those",
    );
    assert.ok(
      !/granicus/i.test(observation.sourceOrg),
      "the source org is the PUBLIC BODY, never the vendor",
    );
  }

  // An unknown sitting yields no reading and no claim.
  assert.equal(unknown.actionable, null);
  assert.equal(unknown.observations.length, 0);
});

test("incremental refresh: an unchanged sitting is skipped, and every ambiguity walks", () => {
  const held = fixtureStore().sittings.find((s) => s.extraction === "RETRIEVED");
  assert.ok(held, "a healthy held sitting to compare against");

  const same = {
    EventId: held.eventId,
    EventLastModifiedUtc: held.publication.lastModifiedUtc,
  } as LegistarEvent;

  assert.deepEqual(refreshDecision(same, held), {
    walk: false,
    reason: "UNCHANGED_SKIP",
  });

  assert.equal(
    refreshDecision({ ...same, EventLastModifiedUtc: "2099-01-01T00:00:00" }, held).reason,
    "PUBLISHER_MODIFIED",
  );
  assert.equal(refreshDecision(same, undefined).reason, "NEW");

  // An ambiguous modification stamp fails safe toward walking.
  assert.equal(
    refreshDecision({ ...same, EventLastModifiedUtc: null } as LegistarEvent, held).reason,
    "NO_MODIFICATION_STAMP",
  );
  assert.equal(
    refreshDecision(same, {
      ...held,
      voteRequestFailures: [{ eventItemId: 1, reason: "socket hang up" }],
    }).reason,
    "OPEN_VOTE_FAILURES",
  );
  assert.equal(
    refreshDecision(same, { ...held, extraction: "ZERO_ROWS_FAILED" }).reason,
    "PRIOR_EXTRACTION_FAILED",
  );

  for (const decision of [
    refreshDecision(same, undefined),
    refreshDecision({ ...same, EventLastModifiedUtc: null } as LegistarEvent, held),
  ]) {
    assert.equal(decision.walk, true, "every ambiguous case walks");
  }
});

test("a refresh of one tenant can never drop another tenant's sittings", () => {
  // The merge is keyed on meetingId and preserves every sitting this run did not walk.
  const held = fixtureStore();
  const other: PersistedSittingOutcomes = {
    ...held.sittings[0]!,
    meetingId: "legistar:othertenant:1",
    slug: "othertenant",
    eventId: 1,
  };

  const merged = mergeSnapshot(held, [other], {
    generatedOn: "2026-08-29",
    generatedAt: "2026-08-29T20:00:00.000Z",
  });

  assert.equal(merged.sittings.length, held.sittings.length + 1);
  for (const sitting of held.sittings) {
    assert.ok(
      merged.sittings.some((s) => s.meetingId === sitting.meetingId),
      `${sitting.meetingId} survived a merge that did not walk it`,
    );
  }
  assert.deepEqual([...merged.tenants].sort(), ["othertenant", "pima"]);
  assert.ok(
    merged.sittings.every(
      (s, i) => i === 0 || s.meetingId.localeCompare(merged.sittings[i - 1]!.meetingId) >= 0,
    ),
    "sorted by id, so the committed artefact has a stable diff",
  );
});

test("a request failure persists as a named open failure and never as an empty sitting", () => {
  const event = JSON.parse(
    readFileSync(
      join(process.cwd(), "tests", "fixtures", "legistar", "pima-event-1825.json"),
      "utf8",
    ),
  ) as LegistarEvent;

  const sitting = toPersistedSitting({
    event,
    client: {
      slug: "pima",
      eventBodyId: 138,
      ocdId: "ocd-division/country:us/state:az/county:pima",
      bodyId: PIMA_BOARD,
      jurisdiction: "Pima County, AZ",
      publishingOrg: "Pima County Clerk of the Board",
      timeZone: "America/Phoenix",
      insiteHost: "pima.legistar.com",
      venues: [],
    },
    collected: {
      slug: "pima",
      eventId: event.EventId,
      agenda: [],
      outcomes: [],
      rollCalls: [],
      failedRollCallExtractions: [],
      voteRequestFailures: [],
    },
    observedAt: "2026-08-29T20:00:00.000Z",
    startsAt: null,
    routesWalked: ["WEBAPI_EVENTS"],
    requestError: "LegistarError: HTTP 503",
  });

  assert.equal(sitting.extraction, "REQUEST_FAILED");
  assert.match(String(sitting.extractionNote), /retryable and stays open/i);
  assert.match(String(sitting.extractionNote), /Nothing is claimed/i);
  assert.equal(sitting.meetingId, "legistar:pima:1825");

  // The minutes pointer has no record class, so it can never be handed to `assertAnswerable` as evidence.
  assert.ok(!("recordClass" in sitting.minutesPointer));
  assert.match(sitting.minutesPointer.retrievalNote, /No minutes adapter reads the file/);
  assert.doesNotMatch(sitting.minutesPointer.retrievalNote, /Disallow/i);
});
