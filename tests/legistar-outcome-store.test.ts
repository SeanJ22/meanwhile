import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { legistarMeetingId } from "../lib/sources/legistar/index.ts";
import {
  publicationStatusFor,
  refreshDecision,
  mergeSnapshot,
  toPersistedSitting,
} from "../lib/outcomes/ingest.ts";
import {
  answerableMeetingIds,
  getOutcomeSnapshot,
  outcomeEvidenceFor,
  publicationObservationsFor,
  resetOutcomeSnapshotCache,
  useOutcomeSnapshotForTests,
  loadedFrom,
  sittingsForBody,
} from "../lib/outcomes/store.ts";
import type {
  OutcomeSnapshot,
  PersistedSittingOutcomes,
} from "../lib/outcomes/types.ts";
import type { LegistarEvent } from "../lib/sources/legistar/types.ts";

/**
 * **THE DURABLE OUTCOME STORE.**
 * (WS-LEGI, 2026-08-29.)
 *
 * Two stores are exercised here and they answer different questions.
 *
 * `tests/fixtures/legistar-outcome-store/` is a small committed store built out
 * of REAL walked Pima sittings plus two SEEDED FAILURES that a real four-month
 * window happened not to contain. It is what the state machine is tested
 * against, because a state machine tested only against data that happens to be
 * healthy is a state machine whose failure branches have never run.
 *
 * `data/states/az/outcomes/legistar-outcomes.json` is the real committed store. It is
 * asserted on for LINKAGE and SHAPE — that its ids join to the meetings snapshot
 * byte for byte — and never for exact counts, because it grows every time the
 * ingest walks a wider window and a test that pinned its totals would have to be
 * edited on every successful collection. Growing coverage must not read as a
 * regression.
 */

const FIXTURE_PATH = join(process.cwd(), "tests/fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json");
const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";

function fixtureStore(): OutcomeSnapshot {
  return JSON.parse(
    readFileSync(FIXTURE_PATH, "utf8"),
  ) as OutcomeSnapshot;
}

/* ------------------------------------------------------------------ *
 * The chain, and that it is EXACT
 * ------------------------------------------------------------------ */

test("the meeting id the store keys on is byte-identical to the one the meetings snapshot carries", () => {
  /*
   * The linkage assertion, and the reason `legistarMeetingId` exists as a
   * function rather than as a template literal in two files.
   *
   * Two independent spellings of a join key do not fail loudly. They produce a
   * store whose rows match nothing, and an outcome that exists and cannot be
   * found reads to a reader as an outcome that was never collected — the exact
   * failure this whole workstream was closing.
   */
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
  ) as unknown;
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { meetings?: unknown[] }).meetings ?? [])
  ) as { id?: string; bodyId?: string | null }[];

  const legistarRows = rows.filter((row) => String(row.id ?? "").startsWith("legistar:"));
  assert.ok(
    legistarRows.length > 0,
    "the meetings snapshot holds Legistar sittings to join against",
  );

  for (const row of legistarRows) {
    const [, slug, eventId] = String(row.id).split(":");
    assert.equal(
      legistarMeetingId(String(slug), Number(eventId)),
      row.id,
      "legistarMeetingId must reproduce the snapshot's own id exactly",
    );
  }
});

test("every sitting in the real store links to a body id the meetings snapshot also uses", () => {
  const snapshot = getOutcomeSnapshot();
  assert.ok(snapshot.sittings.length > 0, "the committed outcome store is not empty");

  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "data", "meetings-snapshot.json"), "utf8"),
  ) as unknown;
  const rows = (
    Array.isArray(raw) ? raw : ((raw as { meetings?: unknown[] }).meetings ?? [])
  ) as { bodyId?: string | null }[];
  const knownBodyIds = new Set(rows.map((row) => row.bodyId).filter(Boolean));

  for (const sitting of snapshot.sittings) {
    assert.match(
      sitting.meetingId,
      /^legistar:[a-z0-9-]+:\d+$/,
      "a store id must be <adapter>:<tenant>:<upstream id>",
    );
    if (sitting.bodyId !== null) {
      assert.ok(
        knownBodyIds.has(sitting.bodyId),
        `${sitting.meetingId} carries body id ${sitting.bodyId}, which the meetings ` +
          "snapshot does not use — the outcome would be unreachable from a body query",
      );
    }
  }
});

test("the real store holds outcome records for sittings that previously had none", () => {
  /*
   * THE MEASUREMENT THIS WORKSTREAM EXISTED TO MOVE. Reader outcome
   * answerability was 0 of 30 held Pima Board sittings: the data was harvested
   * by a probe every run and written nowhere.
   *
   * A FLOOR and not an equality, deliberately — see this file's header.
   */
  const answerable = answerableMeetingIds();
  assert.ok(
    answerable.size >= 15,
    `the committed store answers outcome questions for ${answerable.size} sitting(s); ` +
      "it held zero before this store existed",
  );

  const board = sittingsForBody(PIMA_BOARD);
  assert.ok(board.length >= 15, "and they are reachable by body id");
  assert.ok(
    board.every((s, i) => i === 0 || String(s.startsAt) <= String(board[i - 1]?.startsAt)),
    "sittings come back newest first, so 'the last meeting' is the first row",
  );
});

test("the real store never persists a zero-row extraction as an empty agenda (RULING 100)", () => {
  for (const sitting of getOutcomeSnapshot().sittings) {
    if (sitting.agenda.length === 0) {
      assert.notEqual(
        sitting.extraction,
        "RETRIEVED",
        `${sitting.meetingId} has no agenda records and claims a successful ` +
          "extraction — a zero-row extraction is a FAILED extraction, never an " +
          "agenda with nothing on it",
      );
      assert.ok(
        sitting.extractionNote !== null && sitting.extractionNote.length > 0,
        "and a failure always names itself",
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * The semantic distinctions, structurally
 * ------------------------------------------------------------------ */

test("agenda item is not action, and action is not roll call — three arrays, never one wide row", () => {
  const sitting = getOutcomeSnapshot().sittings.find(
    (s) => s.extraction === "RETRIEVED" && s.rollCalls.length > 0,
  );
  assert.ok(sitting, "the store holds a sitting with real roll calls");

  assert.ok(
    sitting.agenda.length > sitting.outcomes.length,
    "a body notices more than it acts on; 1,360 Pima items yielded 525 actions",
  );
  assert.ok(
    sitting.outcomes.length >= sitting.rollCalls.length,
    "and it acts more often than it takes a per-person roll",
  );

  for (const record of sitting.agenda) {
    assert.equal(record.recordClass, "AGENDA");
    assert.ok(!("disposition" in record), "an agenda record has no disposition field");
    assert.ok(!("action" in record), "and no action field a decision could live in");
  }
  for (const record of sitting.outcomes) {
    assert.equal(record.recordClass, "ACTION_SUMMARY");
  }
  for (const record of sitting.rollCalls) {
    assert.equal(record.recordClass, "ROLL_CALL");
  }
});

test("tally text lives on the ACTION_SUMMARY and NEVER on the roll call", () => {
  /*
   * The single most dangerous available inference in this dataset. 48 Pima items
   * carry prose like "unanimously carried by a 5-0 vote" and have no per-person
   * roll. Expanding one of those strings into five named positions would invent
   * a record of how five real people voted.
   *
   * The defence is structural: the ROLL_CALL record has no field a tally could
   * occupy, so the expansion has nowhere to be written even by accident.
   */
  const snapshot = getOutcomeSnapshot();
  let tallies = 0;
  for (const sitting of snapshot.sittings) {
    for (const outcome of sitting.outcomes) {
      if (/carried by a|\d+-\d+ vote/i.test(outcome.tallyText ?? "")) tallies += 1;
    }
    for (const roll of sitting.rollCalls) {
      assert.ok(!("tallyText" in roll), "a roll call has no tallyText field");
      assert.ok(!("disposition" in roll), "and no disposition field");
      for (const vote of roll.votes) {
        assert.deepEqual(
          Object.keys(vote).sort(),
          ["personId", "personName", "sort", "value"],
          "a recorded vote is a person and their verbatim value, and nothing else",
        );
      }
    }
  }
  assert.ok(tallies > 0, "the store really does hold tally prose to be careful about");
});

test("a member's cast value is carried verbatim — Not Present is a position, not missing data", () => {
  const values = new Set<string>();
  for (const sitting of getOutcomeSnapshot().sittings) {
    for (const roll of sitting.rollCalls) {
      for (const vote of roll.votes) if (vote.value) values.add(vote.value);
    }
  }
  assert.ok(values.size > 0, "the store holds cast values");
  /*
   * Nothing is mapped to a yes/no vocabulary. A tenant that records "Not
   * Present", "Abstain" or "Recused" is recording a POSITION, and normalising it
   * to a boolean would erase the distinction between a member who voted no and
   * a member who was not in the room.
   */
  for (const value of values) {
    assert.ok(
      !["true", "false", "YES", "NO", "1", "0"].includes(value),
      `${value} looks like a mapped vocabulary rather than the publisher's word`,
    );
  }
});

test("the attendance roll call is never mistaken for an item vote", () => {
  /*
   * On Pima, `EventItemRollCallFlag` is 1 on exactly one item per sitting — the
   * literal "ROLL CALL" attendance item, which has no action and whose votes
   * route returns zero rows. All 20 land in `failedRollCallExtractions` and none
   * of them produces a ROLL_CALL record.
   */
  const snapshot = getOutcomeSnapshot();
  const flagged = snapshot.sittings.reduce(
    (n, s) => n + s.failedRollCallExtractions.length,
    0,
  );
  assert.ok(
    flagged > 0,
    "the store reports the flagged-but-empty items rather than reconciling them away",
  );

  for (const sitting of snapshot.sittings) {
    const rolled = new Set(sitting.rollCalls.map((roll) => roll.eventItemId));
    for (const itemId of sitting.failedRollCallExtractions) {
      assert.ok(
        !rolled.has(itemId),
        `item ${itemId} is reported as a failed extraction AND carries a roll call`,
      );
    }
  }
});

/* ------------------------------------------------------------------ *
 * The retrieval contract — every named state, including the seeded ones
 * ------------------------------------------------------------------ */

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
  /*
   * The defect `lib/ask/outcome-question.ts` was written for, closed at the
   * store instead of at the prompt. Asked in production, three outcome questions
   * came back with AGENDA_ITEM records and ZERO gaps — an evidence pack of
   * things that were merely SCHEDULED, handed to a synthesis model with nothing
   * saying no outcome record was held.
   *
   * Here the agenda records are not deprioritised. They are ABSENT from
   * `records` and present in `refused` with the sentence explaining why.
   */
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
  /*
   * 108 acted Pima items in four months. The board demonstrably decided them and
   * the clerk entered no per-person roll. Returning "no records" for those would
   * describe a real, published decision as an absence.
   */
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
  /*
   * **A COVERAGE CHANGE, STATED RATHER THAN HIDDEN.** (2026-08-29.)
   *
   * This pointed `outcomeEvidenceFor` at a directory that does not exist, to
   * prove a missing file yields the EMPTY store rather than throwing in a
   * request path. It cannot do that any more: the store's read is now a
   * LITERAL because a variable in that path made Turbopack trace 4,532 files
   * into the Ask route bundle, and a literal read has no directory to point
   * somewhere else.
   *
   * What is still tested is the property that mattered downstream — an empty
   * store answers with an honest named state and a gap that claims nothing
   * about the body. What is no longer covered HERE is the try/catch around a
   * failed read itself; that is asserted by `loadedFrom()` reporting
   * `EMPTY_STORE`, below.
   */
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

/* ------------------------------------------------------------------ *
 * Publication status, and the refresh policy
 * ------------------------------------------------------------------ */

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

  /*
   * No verdict is computed. "Is the agenda published" is a question the
   * consuming vocabulary answers from these fields; a boolean minted here would
   * be this module deciding what "published" means for every tenant at once —
   * and on this tenant "Draft" minutes is the STEADY STATE across all 20 Board
   * sittings measured, including sittings four months old.
   */
  for (const key of Object.keys(status)) {
    assert.ok(
      !/^(is|has|should|can)[A-Z]/.test(key),
      `${key} looks like a rendered verdict rather than a publisher observation`,
    );
  }
});

test("the store exposes the publisher's agenda reading, reconciled and scoped", () => {
  /*
   * The second handoff. `publicationObservationsFor` is what the integration
   * owner feeds to `classifyAgendaPublication` in `lib/ask/agenda-publication.ts`
   * — and the observations satisfy `PublisherAgendaObservation` field for field
   * so no adaptation is needed at the boundary.
   */
  const snapshot = getOutcomeSnapshot();
  const sitting = snapshot.sittings.find(
    (s) => (s.publicationObservations ?? []).length > 0,
  );
  assert.ok(sitting, "the committed store carries publisher readings");

  const reconciled = publicationObservationsFor(sitting.meetingId);
  assert.equal(reconciled.meetingId, sitting.meetingId);
  assert.ok(reconciled.note.length > 0, "always a sentence");

  for (const observation of reconciled.observations) {
    // The consumer's required fields, all present and all non-empty.
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

  // An unknown sitting yields no reading and, critically, no claim.
  const unknown = publicationObservationsFor("legistar:pima:99999999");
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

  /*
   * CANNOT_TELL fails safe toward WALKING (RULING 182). The cost of re-reading a
   * sitting that did not change is a few requests; the cost of skipping one that
   * did is a stale record served as current.
   */
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
  /*
   * The merge is keyed on meetingId and preserves everything it did not see.
   * A merge that rebuilt the array from only what this run walked would let
   * `--slug mesa` silently delete every Pima outcome in the store.
   */
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

  /*
   * And the minutes pointer is still recorded — the document is known to exist
   * and is not held. A lead with NO record class, so it can never be handed to
   * `assertAnswerable` as evidence of what the body decided.
   */
  assert.ok(!("recordClass" in sitting.minutesPointer));
  assert.match(sitting.minutesPointer.retrievalNote, /Disallow/i);
});
