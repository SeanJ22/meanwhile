import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

import { heldAgendaDocumentRecords } from "../lib/ask/held-agenda.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";

// The Ask reader leaf that renders these records, compiled through the
// existing tsx runtime exactly as tests/tester-9-4-ask.test.ts does.
const { AskAnswerRecords } = await tsImport("../components/ask/answer-records.tsx", import.meta.url) as typeof import("../components/ask/answer-records.tsx");

const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const BODY = `${TUSD}#board`;
const SITE_ROOT = "https://govboard.tusd1.org/";
const OWN_PAGE = "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=499";
const OWN_TEXT = "Skip Navigation Jump to SideBar Tucson Unified School District";
const SITE_ROOT_TEXT = "Governing Board Tucson Unified School District Board Meetings Board Members Policies Contact the Board Meeting Calendar Public Comment";

const sitting = {
  id: "diligent:tusd1:499",
  bodyId: BODY,
  title: "Regular Governing Board Meeting",
  bodyName: "Governing Board",
  startsAt: "2026-09-23T00:30:00.000Z",
};
const meetings = ["diligent:tusd1:495", "diligent:tusd1:497", "diligent:tusd1:499"].map((id) => ({ id, ocdId: TUSD }));

function row(meetingId: string, documentUrl: string, text: string, retrievedAt: string): AgendaDocument {
  const contentHash = createHash("sha256").update(`${documentUrl}|${retrievedAt}`).digest("hex");
  return {
    id: `${meetingId}@${contentHash}`, meetingId, ocdId: TUSD, documentUrl, contentHash, retrievedAt,
    contentType: "text/html", text, extraction: "html", extractionNote: null, sourceUrl: documentUrl,
    sourceOrg: "Tucson Unified School District", collectedAt: retrievedAt, verifiedAt: null,
  };
}

/** 88 hourly re-reads of the sitting's own unchanged page, plus the board's site root. */
function tusd499Corpus(): AgendaDocument[] {
  return [
    row("diligent:tusd1:499", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
    row("diligent:tusd1:495", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
    row("diligent:tusd1:497", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
    ...Array.from({ length: 88 }, (_, hour) =>
      row("diligent:tusd1:499", OWN_PAGE, OWN_TEXT, new Date(Date.parse("2026-09-19T00:05:00.000Z") + hour * 3_600_000).toISOString())),
  ];
}

const REVISION_LANGUAGE = /revis|version|amend/i;

test("Ask, Tucson Unified 499: 89 stored rows (88 re-reads of its portal page plus the site root) are two index records with no revision language", () => {
  /* The re-reads are the portal page's skip links, not the sitting's agenda, so both distinct contents are publication indexes; identical re-reads are one record. */
  const corpus = tusd499Corpus();
  assert.equal(corpus.filter((document) => document.meetingId === sitting.id).length, 89);
  const records = heldAgendaDocumentRecords(sitting, corpus, meetings);
  assert.deepEqual(records.map((record) => record.sourceUrl), [OWN_PAGE, SITE_ROOT]);
  assert.equal(records[0]!.retrievedAt, "2026-09-22T15:05:00.000Z", "the newest read of that content speaks for it");
  for (const record of records) {
    assert.equal(record.kind, "AGENDA_DOCUMENT");
    assert.equal(record.agendaDocument?.publicationIndex, true);
    assert.match(record.text, /publication index/);
    assert.doesNotMatch(record.text, REVISION_LANGUAGE);
  }

  // The reader's path: the Ask leaf renders exactly the records it was given.
  const markup = renderToStaticMarkup(createElement(AskAnswerRecords, { records, initiallyOpen: true, agendaLead: true, prose: null }));
  assert.equal(markup.match(/data-ask-document-id=/g)?.length, 2, "stated N equals rendered rows");
  assert.doesNotMatch(markup, REVISION_LANGUAGE);
});

test("Ask, a real revision: two distinct contents are two agenda records, each with its own source", () => {
  const meeting = { ...sitting, id: "legistar:example:4410", bodyId: "ocd-division/country:us/state:az/place:example#governing", title: "Council Meeting", bodyName: "Council" };
  const first = { ...row(meeting.id, "https://example.legistar.com/View.ashx?ID=4410&G=A", "1. Call to order. 2. Budget hearing. 3. Adjournment.", "2026-09-01T10:00:00.000Z"), ocdId: null };
  const refetch = { ...row(meeting.id, "https://example.legistar.com/View.ashx?ID=4410&G=A", "1. Call to order.  2. Budget hearing.\n3. Adjournment.", "2026-09-02T10:00:00.000Z"), ocdId: null };
  const amended = { ...row(meeting.id, "https://example.legistar.com/View.ashx?ID=4410&G=B", "1. Call to order. 2. Budget hearing. 3. Rezoning. 4. Adjournment.", "2026-09-10T10:00:00.000Z"), ocdId: null };
  const records = heldAgendaDocumentRecords(meeting, [first, refetch, amended], [{ id: meeting.id, ocdId: null }]);
  assert.deepEqual(records.map((record) => record.sourceUrl), [amended.documentUrl, refetch.documentUrl]);
  assert.deepEqual(records.map((record) => record.id), [amended.id, refetch.id]);
});

test("Ask, a sitting holding only the site root: its listing pages are named as publication indexes, never as an agenda", () => {
  const corpus = tusd499Corpus().filter((document) => document.documentUrl === SITE_ROOT);
  const records = heldAgendaDocumentRecords({ ...sitting, id: "diligent:tusd1:495" }, corpus, meetings);
  assert.equal(records.length, 1);
  assert.equal(records[0]!.agendaDocument?.publicationIndex, true);
  assert.match(records[0]!.text, /publication index/);
  assert.doesNotMatch(records[0]!.text, REVISION_LANGUAGE);
});
