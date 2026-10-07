import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { classifyAgendaPublication } from "../lib/ask/agenda-publication.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";
import { sittingAgendaHoldings } from "../lib/ask/held-agenda.ts";
import { synthesisContextPayload } from "../lib/ask/synthesize.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import { readSnapshot, type MeetingsSnapshot } from "../lib/meetings/snapshot.ts";

const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const TUSD_BOARD = `${TUSD}#board`;
const TUSD_499 = "diligent:tusd1:499";
const SITE_ROOT = "https://govboard.tusd1.org/";
const OWN_PAGE = "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=499";
const OWN_TEXT = "Skip Navigation Jump to SideBar Tucson Unified School District";
const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const PIMA_1827 = "legistar:pima:1827";
const PIMA_SCHEDULE = "https://www.pima.gov/2559/Board-of-Supervisors-Meeting-Schedule";
const REVISION_LANGUAGE = /revis|amend|\bversions?\b/i;

function row(over: Partial<AgendaDocument> & Pick<AgendaDocument, "meetingId" | "documentUrl" | "retrievedAt">): AgendaDocument {
  const contentHash = createHash("sha256").update(`${over.documentUrl}|${over.retrievedAt}|${over.meetingId}`).digest("hex");
  return {
    id: `${over.meetingId}@${contentHash}`,
    ocdId: TUSD,
    contentHash,
    contentType: "text/html",
    text: OWN_TEXT,
    extraction: "html",
    extractionNote: null,
    sourceUrl: over.documentUrl,
    sourceOrg: "Tucson Unified School District",
    collectedAt: over.retrievedAt,
    verifiedAt: null,
    ...over,
  };
}

/** 88 hourly re-reads of 499's own unchanged page, beside the site root the fixture already holds for it. */
function tusd499Rereads(): AgendaDocument[] {
  return Array.from({ length: 88 }, (_, hour) => row({
    meetingId: TUSD_499,
    documentUrl: OWN_PAGE,
    retrievedAt: new Date(Date.parse("2026-09-19T00:05:00.000Z") + hour * 3_600_000).toISOString(),
  }));
}
const NEWEST_REREAD = "2026-09-22T15:05:00.000Z";

function agendaRecordsFor(records: readonly EvidenceRecord[], meetingId: string) {
  return records.filter((record) => record.kind === "AGENDA_DOCUMENT" && record.meetingId === meetingId);
}

test("one reading per sitting: Tucson Unified 499's 89 stored rows are its two index pages, the portal page's newest read first", () => {
  /* The re-reads are the portal page's skip links, so the sitting holds two publication-index pages and no agenda; identical re-reads are one shown document. */
  const base = readSnapshot();
  assert.ok(base);
  const documents = [...base.agendaDocuments, ...tusd499Rereads()];
  assert.equal(documents.filter((document) => document.meetingId === TUSD_499).length, 89, "88 re-reads plus the committed site-root row");
  const meeting = base.meetings.find((candidate) => candidate.id === TUSD_499)!;
  const sitting = { ...meeting, bodyId: meeting.bodyId ?? null };
  const holdings = sittingAgendaHoldings(sitting, documents, base.meetings);
  assert.deepEqual(holdings.documents.map((document) => document.documentUrl), [OWN_PAGE, SITE_ROOT]);
  assert.equal(holdings.documents[0]!.retrievedAt, NEWEST_REREAD);
  assert.deepEqual(holdings.records.map((record) => record.documentId), holdings.documents.map((document) => document.id));
  for (const record of holdings.records) {
    assert.equal(record.agendaDocument?.publicationIndex, true);
    assert.doesNotMatch(record.text, REVISION_LANGUAGE);
  }
});

test("the document every agenda item cites is the one the reading was taken over, never a newer index page", () => {
  const agendaUrl = "https://legistar.granicus.com/example/meetings/2026/9/1_A_Council_Agenda.pdf";
  const agenda = row({ meetingId: "legistar:example:1", documentUrl: agendaUrl, retrievedAt: "2026-09-02T16:00:00.000Z",
    text: "1. Call to order.\n2. Public hearing on the budget.\n3. Adjournment.", extraction: "pdf", contentType: "application/pdf" });
  // A calendar page later attached to this sitting AND another one: an index by construction, read after the agenda.
  const index = row({ meetingId: "legistar:example:1", documentUrl: "https://example.gov/meetings", retrievedAt: "2026-09-04T00:00:00.000Z", text: "Council meetings calendar" });
  const other = row({ meetingId: "legistar:example:2", documentUrl: "https://example.gov/meetings", retrievedAt: "2026-09-04T00:00:00.000Z", text: "Council meetings calendar" });
  const documents = [agenda, index, other];
  const meetings = [{ id: "legistar:example:1", ocdId: "ocd-division/country:us/state:az/place:example" }, { id: "legistar:example:2", ocdId: "ocd-division/country:us/state:az/place:example" }];
  const sitting = { id: "legistar:example:1", bodyId: "ocd-division/country:us/state:az/place:example#governing", title: "Council Meeting", bodyName: "Council", startsAt: "2026-09-08T17:00:00.000Z" };
  const holdings = sittingAgendaHoldings(sitting, documents, meetings);
  const reading = classifyAgendaPublication({ meetingId: sitting.id, bodyName: sitting.bodyName, documentsForMeeting: [agenda, index],
    documentsAcrossCorpus: documents, meetingsAcrossCorpus: meetings, now: Date.parse("2026-09-05T12:00:00.000Z") });
  assert.deepEqual(holdings.documents.map((document) => document.id), [agenda.id], "the index page is set aside once the agenda is held");
  assert.equal(reading.acquisition, "ITEMS_READER_READY");
  assert.equal(reading.currentDocumentUrl, holdings.documents[0]!.documentUrl, "items and their citation come from one document");
  assert.ok(reading.items.length > 0);
});

test("the real grounded route hands the answer model Tucson Unified 499's two index pages, the projection's, and cites Pima items to the agenda", () => {
  const base = readSnapshot();
  assert.ok(base);
  // Preconditions on the committed holding this case extends (not a case built for this fix).
  assert.deepEqual(base.agendaDocuments.filter((document) => document.meetingId === TUSD_499).map((document) => document.documentUrl), [SITE_ROOT]);
  const pimaAgenda = base.agendaDocuments.filter((document) => document.meetingId === PIMA_1827);
  assert.equal(pimaAgenda.length, 1);
  // 1826 (the same-day study session) holds its own agenda too; both sittings answer the question.
  assert.equal(base.agendaDocuments.filter((document) => document.meetingId === "legistar:pima:1826").length, 1);
  const pimaCalendar = (meetingId: string) => row({ meetingId, documentUrl: PIMA_SCHEDULE, retrievedAt: "2026-09-04T00:00:00.000Z",
    ocdId: "ocd-division/country:us/state:az/county:pima", sourceOrg: "Pima County", text: "Board of Supervisors Meeting Schedule Pima County meeting calendar and archived agendas" });
  const snapshot: MeetingsSnapshot = {
    ...base,
    agendaDocuments: [...base.agendaDocuments, ...tusd499Rereads(), pimaCalendar(PIMA_1827), pimaCalendar("legistar:pima:1825")],
  };

  const directory = mkdtempSync(join(tmpdir(), "grounded-agenda-projection-"));
  let results: { status: number; payload: { subject?: { id: string } | null; answer?: string | null; records: EvidenceRecord[];
    gaps: { whose: string; statement: string }[]; denominators: Record<string, number> } }[];
  try {
    const casesPath = join(directory, "cases.json");
    writeFileSync(casesPath, JSON.stringify({
      snapshot,
      requests: [
        { question: "What's on the Tucson Unified School District Governing Board agenda?", today: "2026-09-22", ocdIds: [TUSD] },
        { question: "What's on the Pima County Board of Supervisors agenda?", today: "2026-09-05", ocdIds: ["ocd-division/country:us/state:az/county:pima"] },
      ],
    }));
    const output = execFileSync(process.execPath, [
      "--experimental-test-module-mocks", "--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "tests/helpers/grounded-route-with-meetings.mts", casesPath,
    ], { cwd: process.cwd(), encoding: "utf8", timeout: 240_000, maxBuffer: 64_000_000, env: { ...process.env, NODE_TEST_CONTEXT: process.env.NODE_TEST_CONTEXT ?? "child-v8" } });
    const line = output.split(/\r?\n/).find((candidate) => candidate.startsWith("GROUNDED_ROUTE_RESULTS="));
    assert.ok(line, output.slice(-2_000));
    results = JSON.parse(line.slice("GROUNDED_ROUTE_RESULTS=".length));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }

  const [tusd, pima] = results;
  assert.equal(tusd!.status, 200);
  assert.equal(tusd!.payload.subject?.id, TUSD_BOARD);
  // The re-reads are the portal page's skip links, so 499 holds two publication-index pages, each named as one.
  const tusdDocuments = agendaRecordsFor(tusd!.payload.records, TUSD_499);
  assert.deepEqual(tusdDocuments.map((record) => record.sourceUrl), [OWN_PAGE, SITE_ROOT], "two distinct index pages, not 89 stored rows");
  assert.equal(tusdDocuments[0]!.retrievedAt, NEWEST_REREAD, "the projection's newest read of that content");
  for (const record of tusdDocuments) {
    assert.equal(record.agendaDocument?.publicationIndex, true, "an index page is never presented as the sitting's agenda");
  }
  assert.ok(tusd!.payload.gaps.some((gap) => /agenda portal rather than the agenda itself/.test(gap.statement)), JSON.stringify(tusd!.payload.gaps));
  assert.equal(tusd!.payload.denominators.agendaDocumentsForThatMeeting, 2);
  for (const text of [tusd!.payload.answer ?? "", ...tusd!.payload.records.map((record) => record.text), ...tusd!.payload.gaps.map((gap) => gap.statement)]) {
    assert.doesNotMatch(text, REVISION_LANGUAGE);
  }
  // Exactly what the answer model is given: the pack's records, named gaps and searched counts.
  const modelContext = JSON.parse(synthesisContextPayload({
    question: "What's on the Tucson Unified School District Governing Board agenda?", intent: "UPCOMING_AGENDA", temporal: { kind: "NEXT" },
    subject: tusd!.payload.subject as never, records: tusd!.payload.records, gaps: tusd!.payload.gaps as never,
    denominators: tusd!.payload.denominators, today: "2026-09-22",
  })) as { whatWasSearched: Record<string, number>; records: EvidenceRecord[] };
  assert.equal(modelContext.whatWasSearched.agendaDocumentsForThatMeeting, 2);
  assert.equal(agendaRecordsFor(modelContext.records, TUSD_499).length, 2);

  assert.equal(pima!.status, 200);
  assert.equal(pima!.payload.subject?.id, PIMA_BOARD);
  const items = pima!.payload.records.filter((record) => record.kind === "AGENDA_ITEM" && record.id.startsWith(`${PIMA_1827}#`));
  assert.ok(items.length > 20, `the held Pima 1827 agenda is item-ready (${items.length})`);
  for (const item of items) {
    assert.equal(item.sourceUrl, pimaAgenda[0]!.documentUrl, "an item cites the agenda it was read from, not the newer calendar page");
    assert.equal(item.documentId, pimaAgenda[0]!.id);
    assert.equal(item.retrievedAt, pimaAgenda[0]!.retrievedAt);
  }
  assert.ok(!agendaRecordsFor(pima!.payload.records, PIMA_1827).some((record) => record.sourceUrl === PIMA_SCHEDULE), "the calendar page is not this sitting's agenda");
  assert.equal(pima!.payload.denominators.agendaDocumentsForThatMeeting, 2, "1826's and 1827's own agendas; the calendar page is set aside, not counted");
});
