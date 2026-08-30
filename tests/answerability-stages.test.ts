import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ANSWERABILITY_STAGES,
  BLOCKS_ABOUT_THEM,
  DENOMINATOR_NOT_ESTABLISHED,
  classifySnapshotDocument,
  measureAnswerability,
  stageOf,
  type AnswerabilityCorpus,
  type DocumentInput,
  type LadderMeasurement,
  type ObligationInput,
} from "../lib/answerability/stages.ts";
import { renderLadderTable } from "../lib/answerability/report.ts";

/**
 * **THE LADDER, MEASURED — against the real committed corpus and against
 * seeded defects.**
 *
 * Two halves, and both are needed.
 *
 * The REAL half reads `data/meetings-snapshot.json` itself. A fixture would
 * prove the module runs; only the committed corpus proves the numbers it
 * prints are the numbers this repository actually has. Nothing here asserts a
 * hard-coded count that snapshot drift would break — it asserts the module's
 * output against the same corpus's own rows, so the test fails when the
 * MEASUREMENT disagrees with the DATA rather than when the data moves.
 *
 * The SEEDED half plants one defect at a time and proves the stage refuses to
 * credit it. Every seeded failure is followed by a POSITIVE CONTROL built
 * from the same shape with the defect removed, because a ladder that credits
 * nothing measures nothing.
 */

/* ─────────────────────────────────────────────── the committed corpus ── */

interface SnapshotMeeting {
  id: string;
  ocdId: string | null;
  bodyId: string | null;
  bodyName: string;
  startsAt: string | null;
  agendaUrl: string | null;
  status?: string;
}

interface SnapshotDocument {
  id: string;
  meetingId: string;
  ocdId: string | null;
  documentUrl: string;
  contentHash: string | null;
  retrievedAt: string | null;
  text: string | null;
  extraction: "html" | "pdf" | "failed";
  extractionNote: string | null;
  verifiedAt: string | null;
}

const SNAPSHOT = JSON.parse(
  readFileSync(new URL("../data/meetings-snapshot.json", import.meta.url), "utf8"),
) as { meetings: SnapshotMeeting[]; agendaDocuments: SnapshotDocument[] };

/*
 * "An operation that can return nothing must be asked what it returned."
 * A snapshot that parsed to zero rows is a FAILED read, and a suite that ran
 * against it would report a green ladder over an empty world.
 */
assert.ok(
  Array.isArray(SNAPSHOT.meetings) && SNAPSHOT.meetings.length > 0,
  "meetings-snapshot.json yielded no meetings — a zero-row read is a failed read",
);
assert.ok(
  Array.isArray(SNAPSHOT.agendaDocuments) && SNAPSHOT.agendaDocuments.length > 0,
  "meetings-snapshot.json yielded no agenda documents — a zero-row read is a failed read",
);

const PIMA_BOS = "ocd-division/country:us/state:az/county:pima#governing";

function realCorpus(bodyIds: readonly string[] | null): AnswerabilityCorpus {
  const wanted = bodyIds ? new Set(bodyIds) : null;
  const meetings = SNAPSHOT.meetings.filter(
    (m) => !wanted || (m.bodyId !== null && wanted.has(m.bodyId)),
  );
  const ids = new Set(meetings.map((m) => m.id));
  const obligations: ObligationInput[] = meetings.map((m) => ({
    meetingId: m.id,
    bodyId: m.bodyId ?? null,
    ocdId: m.ocdId ?? null,
    bodyName: m.bodyName ?? "",
    startsAt: m.startsAt ?? null,
    agendaUrl: m.agendaUrl ?? null,
  }));
  const documents: DocumentInput[] = SNAPSHOT.agendaDocuments
    .filter((d) => ids.has(d.meetingId))
    .map((d) => ({
      id: d.id,
      meetingId: d.meetingId,
      ocdId: d.ocdId ?? null,
      documentUrl: d.documentUrl,
      contentHash: d.contentHash ?? null,
      retrievedAt: d.retrievedAt ?? null,
      recordClass: classifySnapshotDocument(),
      text: d.text ?? null,
      extraction: d.extraction,
      extractionNote: d.extractionNote ?? null,
      verifiedAt: d.verifiedAt ?? null,
    }));
  return {
    obligations,
    documents,
    publishedObligationCount: null,
    publishedObligationSource: null,
  };
}

const DOC_BY_ID = new Map(SNAPSHOT.agendaDocuments.map((d) => [d.id, d]));

/* ══════════════════════════════════════════════════════════════════════
   1 · THE REAL CORPUS — the numbers, and the shape they must hold
   ══════════════════════════════════════════════════════════════════════ */

test("REAL CORPUS: the Pima BoS notice ladder is internally consistent", () => {
  const measurement = measureAnswerability({
    scope: "Pima County Board of Supervisors",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: realCorpus([PIMA_BOS]),
  });

  const pimaMeetings = SNAPSHOT.meetings.filter((m) => m.bodyId === PIMA_BOS);
  assert.ok(pimaMeetings.length > 0, "the committed corpus holds no Pima BoS sittings at all");

  assert.equal(
    stageOf(measurement, "DISCOVERED").numerator,
    pimaMeetings.length,
    "every sitting in the corpus is DISCOVERED, and no more than are in it",
  );

  // Monotone by construction: a stage may never credit more units than the
  // one below it. This is the "no upstream count flows downstream" invariant
  // read from the other direction.
  for (const [index, stage] of ANSWERABILITY_STAGES.entries()) {
    if (index === 0) continue;
    const previous = stageOf(measurement, ANSWERABILITY_STAGES[index - 1]);
    const current = stageOf(measurement, stage);
    assert.ok(
      current.numerator <= previous.numerator,
      `${stage} credits ${current.numerator} units over ${previous.numerator} at ${previous.stage}`,
    );
    assert.equal(
      current.denominator,
      previous.numerator,
      `${stage}'s denominator must BE the units that reached ${previous.stage}`,
    );
  }
});

test("REAL CORPUS: the DISCOVERED denominator is NOT ESTABLISHED, and says so", () => {
  /*
   * The whole point of the named value. No public source publishes how many
   * sittings the Board HELD over a window — Legistar lists what it lists —
   * so the share of them we hold is unknown. Substituting the numerator here
   * is how every coverage number in this trade becomes 100%.
   */
  const measurement = measureAnswerability({
    scope: "Pima County Board of Supervisors",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: realCorpus([PIMA_BOS]),
  });
  const discovered = stageOf(measurement, "DISCOVERED");
  assert.equal(discovered.denominator, DENOMINATOR_NOT_ESTABLISHED);
  assert.notEqual(
    discovered.denominator,
    discovered.numerator,
    "the numerator may never stand in for an unestablished denominator",
  );
  assert.match(discovered.denominatorBasis, /publisher exposes no count/i);
  assert.match(
    renderLadderTable(measurement),
    /DENOMINATOR_NOT_ESTABLISHED/,
    "and the rendered table prints the NAME, never a number",
  );
});

test("REAL CORPUS: a published count, when one exists, is used and attributed", () => {
  // The positive control for the clause above: the module is not hard-wired
  // to refuse a denominator, it refuses to INVENT one.
  const corpus = realCorpus([PIMA_BOS]);
  const measurement = measureAnswerability({
    scope: "Pima County Board of Supervisors",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: { ...corpus, publishedObligationCount: 44, publishedObligationSource: "test" },
  });
  const discovered = stageOf(measurement, "DISCOVERED");
  assert.equal(discovered.denominator, 44);
  assert.match(discovered.denominatorBasis, /test/);
});

test("REAL CORPUS: no ladder credits EXTRACTED over a document that failed extraction", () => {
  const measurement = measureAnswerability({
    scope: "whole corpus",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: realCorpus(null),
  });

  let failedCurrent = 0;
  for (const ladder of measurement.ladders) {
    if (!ladder.currentDocumentId) continue;
    const doc = DOC_BY_ID.get(ladder.currentDocumentId);
    if (!doc || doc.extraction !== "failed") continue;
    failedCurrent += 1;
    assert.notEqual(
      ladder.stageStates.EXTRACTED,
      "REACHED",
      `${ladder.meetingId}: a failed extraction was credited as EXTRACTED`,
    );
    assert.notEqual(
      ladder.stageStates.QUERY_RETRIEVABLE,
      "REACHED",
      `${ladder.meetingId}: a failed extraction was credited as QUERY_RETRIEVABLE`,
    );
    assert.equal(ladder.blockedBy, "EXTRACTION_FAILED");
  }
  assert.ok(
    failedCurrent > 0,
    "the committed corpus holds documents whose extraction failed; if this is 0 the " +
      "test is no longer exercising the real failure it was written for",
  );
});

test("REAL CORPUS: READER_VERIFIED is counted from verifiedAt and nothing else", () => {
  const measurement = measureAnswerability({
    scope: "whole corpus",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: realCorpus(null),
  });
  const verifiedDocs = SNAPSHOT.agendaDocuments.filter((d) => !!d.verifiedAt).length;
  assert.ok(
    stageOf(measurement, "READER_VERIFIED").numerator <= verifiedDocs,
    "READER_VERIFIED may never exceed the number of documents a human actually signed off",
  );
  // Today that number is zero, and the ladder must say zero rather than
  // letting QUERY_RETRIEVABLE stand in for a reader having checked anything.
  assert.equal(stageOf(measurement, "READER_VERIFIED").numerator, verifiedDocs);
});

test("REAL CORPUS: an agenda-only corpus answers NO outcome question", () => {
  /*
   * The structural claim, measured. The snapshot's `agendaDocuments` are fed
   * from `meeting.agendaUrl` or a curated notice override, so every row is
   * notice-class. Asked what the Board DECIDED, the ladder must return zero
   * acquired — not a high number with a caveat attached.
   */
  const measurement = measureAnswerability({
    scope: "Pima County Board of Supervisors",
    questionClass: "WHAT_WAS_DECIDED",
    corpus: realCorpus([PIMA_BOS]),
  });
  assert.equal(stageOf(measurement, "ACQUIRED").numerator, 0);
  assert.equal(stageOf(measurement, "QUERY_RETRIEVABLE").numerator, 0);
  assert.ok(
    measurement.refusedRecords.length > 0,
    "and every refused record is named, so the zero is a wall and not an emptiness",
  );
  assert.match(measurement.refusedRecords[0].reason, /NOTICED, not what was decided/i);
  const blocked = stageOf(measurement, "ACQUIRED").blocked;
  assert.ok(
    (blocked.RECORD_CLASS_CANNOT_ANSWER ?? 0) > 0,
    "the sittings we DO hold agendas for must be blocked by class, by name",
  );
});

test("REAL CORPUS: every invariant violation is a genuine impossibility", () => {
  const measurement = measureAnswerability({
    scope: "whole corpus",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: realCorpus(null),
  });
  for (const violation of measurement.invariantViolations) {
    assert.match(
      violation,
      /(EXTRACTED|NORMALIZED) passed its own test/,
      "only stages whose evidence is literally produced upstream may be called " +
        "contradictions; the orthogonal ones are uncredited and named separately",
    );
  }
});

/* ══════════════════════════════════════════════════════════════════════
   2 · SEEDED FAILURES — one defect at a time, each with its control
   ══════════════════════════════════════════════════════════════════════ */

const AGENDA_TEXT =
  "1. Call to order and roll call of the members present\n" +
  "2. Approval of the minutes of the regular meeting of June 9\n" +
  "3. Public hearing on the rezoning of the parcel on West River Road\n";

const OCD = "ocd-division/country:us/state:az/county:pima";

function sitting(over: Partial<ObligationInput> = {}): ObligationInput {
  return {
    meetingId: "m-1",
    bodyId: PIMA_BOS,
    ocdId: OCD,
    bodyName: "Board of Supervisors",
    startsAt: "2026-06-09T13:00:00-07:00",
    agendaUrl: "https://example.gov/agenda-1.pdf",
    ...over,
  };
}

function document(over: Partial<DocumentInput> = {}): DocumentInput {
  return {
    id: "d-1",
    meetingId: "m-1",
    ocdId: OCD,
    documentUrl: "https://example.gov/agenda-1.pdf",
    contentHash: "a".repeat(64),
    retrievedAt: "2026-06-01T00:00:00.000Z",
    recordClass: "AGENDA",
    text: AGENDA_TEXT,
    extraction: "pdf",
    extractionNote: null,
    verifiedAt: null,
    ...over,
  };
}

function measure(
  obligations: readonly ObligationInput[],
  documents: readonly DocumentInput[],
): LadderMeasurement {
  return measureAnswerability({
    scope: "seeded",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: { obligations, documents, publishedObligationCount: null },
  });
}

/* ---- 2a · ACQUIRED but EXTRACTION FAILED ------------------------------ */

test("SEEDED FAILURE: acquired, extraction FAILED — not EXTRACTED, not RETRIEVABLE", () => {
  const measurement = measure(
    [sitting()],
    [document({ text: null, extraction: "failed", extractionNote: "InvalidPDFException" })],
  );
  const ladder = measurement.ladders[0];

  assert.equal(ladder.stageStates.ACQUIRED, "REACHED", "the bytes really were retrieved");
  assert.equal(ladder.stageStates.EXTRACTED, "BLOCKED");
  assert.notEqual(ladder.stageStates.QUERY_RETRIEVABLE, "REACHED");
  assert.equal(ladder.reached, "ACQUIRED");
  assert.equal(ladder.blockedBy, "EXTRACTION_FAILED");

  assert.equal(stageOf(measurement, "ACQUIRED").numerator, 1);
  assert.equal(stageOf(measurement, "EXTRACTED").numerator, 0);
  assert.equal(stageOf(measurement, "QUERY_RETRIEVABLE").numerator, 0);
  assert.equal(
    stageOf(measurement, "EXTRACTED").blocked.EXTRACTION_FAILED,
    1,
    "the failure is reported by its own name, not folded into a low number",
  );
});

test("SEEDED FAILURE: extraction 'succeeded' and returned EMPTY — still not EXTRACTED", () => {
  /*
   * CLAUDE.md: a zero-row extraction is a FAILED extraction, never an empty
   * document. Empty text is a DIFFERENT state from a thrown extractor and
   * from no document at all, and it gets its own code.
   */
  const measurement = measure([sitting()], [document({ text: "   ", extraction: "pdf" })]);
  const ladder = measurement.ladders[0];
  assert.equal(ladder.stageStates.EXTRACTED, "BLOCKED");
  assert.equal(ladder.blockedBy, "EXTRACTED_TEXT_EMPTY");
  assert.notEqual(
    ladder.blockedBy,
    "EXTRACTION_FAILED",
    "three different facts, three different states",
  );
});

test("SEEDED FAILURE: text extracted, ZERO items — normalisation failed, not an empty agenda", () => {
  const measurement = measureAnswerability({
    scope: "seeded",
    questionClass: "WHAT_WAS_NOTICED",
    corpus: {
      obligations: [sitting()],
      documents: [document({ text: "Website menu. Home. Contact. Accessibility statement." })],
      publishedObligationCount: null,
    },
  });
  const ladder = measurement.ladders[0];
  assert.equal(ladder.stageStates.EXTRACTED, "REACHED");
  assert.equal(ladder.stageStates.NORMALIZED, "BLOCKED");
  assert.equal(ladder.blockedBy, "NORMALIZED_ZERO_ITEMS");
  assert.equal(ladder.itemCount, 0);
  assert.notEqual(ladder.stageStates.QUERY_RETRIEVABLE, "REACHED");
});

test("SEEDED FAILURE: no document at all is a THIRD state, and names whose fact it is", () => {
  /*
   * **OUR EMPTY FIELD IS OUR GAP.**
   *
   * This assertion used to expect `NO_DOCUMENT_URL_PUBLISHED`, a code that
   * lived in `BLOCKS_ABOUT_THEM`, on an input whose only distinguishing
   * feature is that OUR row has no url. On the day it was found, the report
   * was telling a reader that Pima County had published no document for 14 of
   * its 30 Board sittings — a claim about a government, resting on an empty
   * column of ours.
   */
  const noUrl = measure([sitting({ agendaUrl: null })], []);
  assert.equal(noUrl.ladders[0].blockedBy, "NO_DOCUMENT_URL_HELD");
  assert.ok(
    !BLOCKS_ABOUT_THEM.includes(noUrl.ladders[0].blockedBy!),
    "a null in our own corpus row is being counted as a fact about a government",
  );

  const urlNotAcquired = measure([sitting()], []);
  assert.equal(
    urlNotAcquired.ladders[0].blockedBy,
    "DOCUMENT_URL_PUBLISHED_NOT_ACQUIRED",
    "a link they published and we never fetched is OUR gap, not theirs",
  );
});

test("POSITIVE CONTROL: a current first-party reading DOES earn a fact about them", () => {
  const observed = measure(
    [
      sitting({
        agendaUrl: null,
        publication: {
          provenance: "FIRST_PARTY_PUBLISHER",
          report: "NOT_AVAILABLE",
          observedAt: new Date().toISOString(),
          observedUrl: "https://pima.legistar.com/Calendar.aspx",
        },
      }),
    ],
    [],
  );
  assert.equal(observed.ladders[0].blockedBy, "PUBLISHER_REPORTS_NO_DOCUMENT");
  assert.ok(
    BLOCKS_ABOUT_THEM.includes(observed.ladders[0].blockedBy!),
    "an asked-and-answered publisher state is exactly what may be a fact about them",
  );
});

test("SEEDED FAILURE: a stale or second-hand reading may not speak for the publisher", () => {
  const base = {
    report: "NOT_AVAILABLE",
    observedUrl: "https://pima.legistar.com/Calendar.aspx",
  } as const;
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  /*
   * Each of these is a DIFFERENT reason the reading cannot stand, and every one
   * of them falls back to our own gap rather than to a claim about them. A
   * publisher's "not available" becomes "agenda" with no event we would see,
   * so an old negative is not a current fact (RULING 170 — the negative
   * expires and is rechecked).
   */
  const refused: Array<[string, ObligationInput["publication"]]> = [
    ["a reading older than the freshness bound", { ...base, provenance: "FIRST_PARTY_PUBLISHER", observedAt: hoursAgo(72) }],
    ["an aggregator rather than the government", { ...base, provenance: "THIRD_PARTY", observedAt: hoursAgo(1) }],
    ["something we inferred rather than read", { ...base, provenance: "INFERRED", observedAt: hoursAgo(1) }],
    ["an unparseable timestamp", { ...base, provenance: "FIRST_PARTY_PUBLISHER", observedAt: "sometime last week" }],
    ["a future stamp from a broken clock", { ...base, provenance: "FIRST_PARTY_PUBLISHER", observedAt: hoursAgo(-5) }],
  ];

  for (const [why, publication] of refused) {
    const m = measure([sitting({ agendaUrl: null, publication })], []);
    assert.equal(
      m.ladders[0].blockedBy,
      "NO_DOCUMENT_URL_HELD",
      `${why} was allowed to speak for the publisher`,
    );
  }

  // POSITIVE CONTROL: the boundary case just inside the window still counts.
  const fresh = measure(
    [sitting({ agendaUrl: null, publication: { ...base, provenance: "FIRST_PARTY_PUBLISHER", observedAt: hoursAgo(1) } })],
    [],
  );
  assert.equal(fresh.ladders[0].blockedBy, "PUBLISHER_REPORTS_NO_DOCUMENT");
});

test("POSITIVE CONTROL: the same document, extracted, climbs the whole ladder", () => {
  const measurement = measure([sitting()], [document()]);
  const ladder = measurement.ladders[0];

  assert.equal(ladder.stageStates.EXTRACTED, "REACHED");
  assert.equal(ladder.stageStates.NORMALIZED, "REACHED");
  assert.equal(ladder.stageStates.CANONICALLY_LINKED, "REACHED");
  assert.equal(ladder.stageStates.QUERY_RETRIEVABLE, "REACHED");
  assert.ok(ladder.itemCount >= 3, `expected the three seeded items, got ${ladder.itemCount}`);

  assert.equal(stageOf(measurement, "QUERY_RETRIEVABLE").numerator, 1);
  // And it still stops at the last rung, because nobody has checked it.
  assert.equal(ladder.reached, "QUERY_RETRIEVABLE");
  assert.equal(ladder.blockedBy, "NOT_READER_VERIFIED");
  assert.equal(stageOf(measurement, "READER_VERIFIED").numerator, 0);
});

test("POSITIVE CONTROL: a verified document reaches the top rung", () => {
  const measurement = measure([sitting()], [document({ verifiedAt: "2026-08-20" })]);
  assert.equal(measurement.ladders[0].reached, "READER_VERIFIED");
  assert.equal(measurement.ladders[0].blockedBy, null);
  assert.equal(stageOf(measurement, "READER_VERIFIED").numerator, 1);
});

/* ---- 2b · LINKED TO THE WRONG MEETING --------------------------------- */

test("SEEDED FAILURE: extracted text whose division disagrees is NOT canonically linked", () => {
  /*
   * The document is real, the text is real, the items are real — and the row
   * says it belongs to a different government than the sitting does. That is
   * a wrong answer wearing a provenance record.
   */
  const measurement = measure(
    [sitting()],
    [document({ ocdId: "ocd-division/country:us/state:nj/county:morris" })],
  );
  const ladder = measurement.ladders[0];
  assert.equal(ladder.stageStates.NORMALIZED, "REACHED", "the text and items are fine");
  assert.equal(ladder.stageStates.CANONICALLY_LINKED, "BLOCKED");
  assert.equal(ladder.blockedBy, "LINK_DIVISION_MISMATCH");
  assert.equal(stageOf(measurement, "CANONICALLY_LINKED").numerator, 0);
  assert.notEqual(
    ladder.stageStates.QUERY_RETRIEVABLE,
    "REACHED",
    "and a mis-linked record may not be served to a reader either",
  );
});

test("SEEDED FAILURE: one URL stored against two sittings links to NEITHER", () => {
  /*
   * The landing-page signal `AgendaDocumentStore.isUrlOnAnotherMeeting`
   * already names: a body's portal root retrieved once per sitting and filed
   * as each one's agenda. Text from the wrong sitting, attached to this one.
   */
  const shared = "https://example.gov/portal-root";
  const measurement = measure(
    [sitting(), sitting({ meetingId: "m-2", startsAt: "2026-06-23T13:00:00-07:00" })],
    [
      document({ documentUrl: shared }),
      document({ id: "d-2", meetingId: "m-2", documentUrl: shared }),
    ],
  );
  for (const ladder of measurement.ladders) {
    assert.equal(ladder.stageStates.CANONICALLY_LINKED, "BLOCKED", ladder.meetingId);
    assert.equal(ladder.blockedBy, "LINK_URL_SHARED_ACROSS_MEETINGS");
  }
  assert.equal(stageOf(measurement, "CANONICALLY_LINKED").numerator, 0);
});

test("POSITIVE CONTROL: two sittings with their OWN documents both link", () => {
  const measurement = measure(
    [sitting(), sitting({ meetingId: "m-2", startsAt: "2026-06-23T13:00:00-07:00" })],
    [
      document(),
      document({
        id: "d-2",
        meetingId: "m-2",
        documentUrl: "https://example.gov/agenda-2.pdf",
      }),
    ],
  );
  assert.equal(stageOf(measurement, "CANONICALLY_LINKED").numerator, 2);
  assert.equal(stageOf(measurement, "QUERY_RETRIEVABLE").numerator, 2);
});

test("SEEDED FAILURE: a sitting a reader cannot address is not QUERY_RETRIEVABLE", () => {
  const noBody = measure([sitting({ bodyId: null })], [document()]);
  assert.equal(noBody.ladders[0].stageStates.QUERY_RETRIEVABLE, "BLOCKED");
  assert.equal(noBody.ladders[0].blockedBy, "NOT_ADDRESSABLE_NO_BODY_ID");

  const noStart = measure([sitting({ startsAt: "whenever" })], [document()]);
  assert.equal(noStart.ladders[0].stageStates.QUERY_RETRIEVABLE, "BLOCKED");
  assert.equal(noStart.ladders[0].blockedBy, "NOT_ADDRESSABLE_NO_START_TIME");
});

/* ---- 2c · A SUPERSEDED REVISION ---------------------------------------- */

test("SEEDED FAILURE: a superseded revision may not silently count as current", () => {
  /*
   * Agendas are revised, and a silently revised agenda is itself news. The
   * OLD revision here is a clean, extractable, correctly linked document —
   * everything the ladder likes — and the CURRENT one failed extraction. The
   * unit must be credited on the current revision and stop at ACQUIRED. A
   * ladder that reached for whichever revision happened to work would answer
   * a reader about a sitting that changed.
   */
  const measurement = measure(
    [sitting()],
    [
      document({ id: "d-old", contentHash: "b".repeat(64), retrievedAt: "2026-06-01T00:00:00.000Z" }),
      document({
        id: "d-new",
        contentHash: "c".repeat(64),
        retrievedAt: "2026-06-05T00:00:00.000Z",
        text: null,
        extraction: "failed",
        extractionNote: "the revised PDF is an image scan",
      }),
    ],
  );
  const ladder = measurement.ladders[0];
  assert.equal(ladder.currentDocumentId, "d-new", "the LATEST revision is the current one");
  assert.deepEqual(ladder.supersededDocumentIds, ["d-old"]);
  assert.equal(ladder.stageStates.EXTRACTED, "BLOCKED");
  assert.equal(ladder.blockedBy, "EXTRACTION_FAILED");
  assert.equal(
    stageOf(measurement, "EXTRACTED").numerator,
    0,
    "the readable OLD revision must not be counted in the current revision's place",
  );
});

test("POSITIVE CONTROL: when the CURRENT revision is the good one, it counts", () => {
  const measurement = measure(
    [sitting()],
    [
      document({
        id: "d-old",
        contentHash: "b".repeat(64),
        retrievedAt: "2026-06-01T00:00:00.000Z",
        text: null,
        extraction: "failed",
      }),
      document({
        id: "d-new",
        contentHash: "c".repeat(64),
        retrievedAt: "2026-06-05T00:00:00.000Z",
      }),
    ],
  );
  const ladder = measurement.ladders[0];
  assert.equal(ladder.currentDocumentId, "d-new");
  assert.deepEqual(ladder.supersededDocumentIds, ["d-old"]);
  assert.equal(ladder.stageStates.QUERY_RETRIEVABLE, "REACHED");
  assert.equal(stageOf(measurement, "QUERY_RETRIEVABLE").numerator, 1);
});

/* ---- 2d · NO UPSTREAM SUCCESS IMPLIES A DOWNSTREAM ONE ---------------- */

test("SEEDED FAILURE: text with no artifact behind it is a CONTRADICTION, not an EXTRACTED", () => {
  /*
   * The direct test of the rule the whole module exists for. This row claims
   * extracted text and carries no content hash — nothing was acquired, so the
   * text came from nowhere. The stage's own predicate passes and the unit is
   * still not credited.
   */
  const measurement = measure([sitting()], [document({ contentHash: null })]);
  const ladder = measurement.ladders[0];
  assert.equal(ladder.stageStates.ACQUIRED, "BLOCKED");
  assert.equal(ladder.blockedBy, "ACQUIRED_WITHOUT_ARTIFACT");
  assert.equal(ladder.stageStates.EXTRACTED, "NOT_REACHED");
  assert.equal(stageOf(measurement, "EXTRACTED").numerator, 0);
  // Both EXTRACTED and NORMALIZED are impossible over an unacquired document,
  // and both are reported. A contradiction that swallows the next one down
  // hides half the damage.
  assert.equal(ladder.invariantViolations.length, 2);
  assert.match(ladder.invariantViolations[0], /EXTRACTED passed its own test/);
  assert.match(ladder.invariantViolations[1], /NORMALIZED passed its own test/);
  assert.equal(measurement.invariantViolations.length, 2);
});

test("POSITIVE CONTROL: add the artifact back and the same row climbs", () => {
  const measurement = measure([sitting()], [document()]);
  assert.equal(measurement.ladders[0].stageStates.ACQUIRED, "REACHED");
  assert.equal(measurement.ladders[0].stageStates.EXTRACTED, "REACHED");
  assert.deepEqual(measurement.invariantViolations, []);
});

test("an orthogonal downstream pass is UNCREDITED and named, never a violation", () => {
  // A zero-item document that is otherwise correctly linked. Linking is not
  // produced by normalisation, so this is not a contradiction — and it is
  // still not credited, because a link to nothing is nothing.
  const measurement = measure(
    [sitting()],
    [document({ text: "Website menu. Home. Contact. Accessibility statement." })],
  );
  const ladder = measurement.ladders[0];
  assert.equal(ladder.stageStates.CANONICALLY_LINKED, "NOT_REACHED");
  assert.deepEqual(ladder.invariantViolations, []);
  assert.equal(ladder.uncreditedDownstreamPasses.length, 1);
  assert.match(ladder.uncreditedDownstreamPasses[0], /CANONICALLY_LINKED passed its own test/);
  assert.equal(stageOf(measurement, "CANONICALLY_LINKED").numerator, 0);
});

/* ══════════════════════════════════════════════════════════════════════
   3 · THE TABLE
   ══════════════════════════════════════════════════════════════════════ */

test("the rendered table carries all seven stages and no headline percentage", () => {
  const rendered = renderLadderTable(
    measureAnswerability({
      scope: "Pima County Board of Supervisors",
      questionClass: "WHAT_WAS_NOTICED",
      corpus: realCorpus([PIMA_BOS]),
    }),
  );
  for (const stage of ANSWERABILITY_STAGES) {
    assert.match(rendered, new RegExp(stage), `${stage} is missing from the table`);
  }
  assert.doesNotMatch(
    rendered,
    /\d+%/,
    "one percentage over a seven-stage pipeline reports the cheapest stage and implies the rest",
  );
});
