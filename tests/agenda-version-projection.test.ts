import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

import { classifyAgendaPublication, readerAgendaDocuments } from "../lib/ask/agenda-publication.ts";
import type { AgendaDocument } from "../lib/meetings/agenda-documents.ts";

// The native runner strips TypeScript but does not compile TSX; the one reader
// leaf that states the version count is compiled through the existing tsx runtime.
const { AgendaDocuments } = await tsImport("../components/map/popup/agenda-section.tsx", import.meta.url) as typeof import("../components/map/popup/agenda-section.tsx");

const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";
const SITE_ROOT = "https://govboard.tusd1.org/";
const OWN_PAGE = "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=499";
const OWN_TEXT = "Skip Navigation Jump to SideBar Tucson Unified School District";
const SITE_ROOT_TEXT = "Governing Board Tucson Unified School District Board Meetings Board Members Policies Contact the Board Meeting Calendar Public Comment";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function row(meetingId: string, documentUrl: string, text: string | null, retrievedAt: string, bytes = `${documentUrl}|${retrievedAt}`): AgendaDocument {
  const contentHash = hash(bytes);
  return {
    id: `${meetingId}@${contentHash}`,
    meetingId,
    ocdId: TUSD,
    documentUrl,
    contentHash,
    retrievedAt,
    contentType: "text/html",
    text,
    extraction: text === null ? "failed" : "html",
    extractionNote: text === null ? "no text layer" : null,
    sourceUrl: documentUrl,
    sourceOrg: "Tucson Unified School District",
    collectedAt: retrievedAt,
    verifiedAt: null,
  };
}

function view(document: AgendaDocument) {
  return {
    id: document.id,
    documentUrl: document.documentUrl,
    contentHash: document.contentHash,
    retrievedAt: document.retrievedAt,
    contentType: document.contentType,
    extraction: document.extraction,
    extractionNote: document.extractionNote,
    text: document.text,
    sourceOrg: document.sourceOrg,
  };
}

const meetings = ["diligent:tusd1:495", "diligent:tusd1:497", "diligent:tusd1:499"].map((id) => ({ id, ocdId: TUSD }));

/** 88 hourly re-fetches of one unchanged page plus the board's site root. */
function tusd499Corpus(): AgendaDocument[] {
  const refetches = Array.from({ length: 88 }, (_, hour) =>
    row("diligent:tusd1:499", OWN_PAGE, OWN_TEXT, new Date(Date.parse("2026-09-19T00:05:00.000Z") + hour * 3_600_000).toISOString()));
  return [
    row("diligent:tusd1:499", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
    row("diligent:tusd1:495", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
    row("diligent:tusd1:497", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
    ...refetches,
  ];
}

function render(documents: readonly AgendaDocument[], publication: ReturnType<typeof classifyAgendaPublication>) {
  return renderToStaticMarkup(createElement(AgendaDocuments, {
    documents: documents.map(view),
    meetingId: documents[0]!.meetingId,
    agendaUrl: documents[0]!.documentUrl,
    agendaSentence: "",
    publication,
  }));
}

test("Tucson Unified 499: 88 identical re-reads of its portal page plus the site root are two index pages, never a version", () => {
  // 88 identical re-reads of a publication-index page are one content, never a version or a revision.
  const corpus = tusd499Corpus();
  const held = corpus.filter((document) => document.meetingId === "diligent:tusd1:499");
  assert.equal(held.length, 89);
  assert.equal(new Set(held.map((document) => document.contentHash)).size, 89, "every fetch hashed differently");

  const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: corpus, meetingsAcrossCorpus: meetings });
  assert.equal(shown.sittingSpecific, false, "the portal page is not the sitting's own document");
  assert.deepEqual(shown.documents.map((document) => document.documentUrl), [OWN_PAGE, SITE_ROOT]);
  assert.equal(shown.documents[0]!.retrievedAt, held.map((document) => document.retrievedAt).sort().at(-1), "the newest read speaks for its content");
  assert.equal(shown.heldRows, 89);
  assert.equal(shown.identicalContentRows, 87);
  assert.equal(shown.publicationIndexRowsSetAside, 0, "nothing is set aside when index pages are all it holds");
  assert.equal(shown.heldRows, shown.documents.length + shown.identicalContentRows + shown.publicationIndexRowsSetAside);

  const publication = classifyAgendaPublication({ meetingId: "diligent:tusd1:499", bodyName: "Governing Board",
    documentsForMeeting: held, documentsAcrossCorpus: corpus, meetingsAcrossCorpus: meetings, now: Date.parse("2026-09-22T18:00:00.000Z") });
  assert.equal(publication.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");
  assert.equal(publication.gap?.statement, "The link we hold for that meeting is Governing Board's agenda portal rather than the agenda itself.");
  assert.equal(publication.revised, false);
  assert.deepEqual(publication.supersededDocumentUrls, []);
  assert.equal(publication.currentDocumentUrl, OWN_PAGE);

  const markup = render(shown.documents, publication);
  assert.ok(markup.includes('data-agenda-publication="ACQUIRED_IS_PUBLICATION_INDEX"'), markup);
  assert.ok(!markup.includes("versions on file"), markup);
  assert.ok(!markup.includes("revised"), markup);
  assert.ok(!markup.includes("data-agenda-versions"), markup);
  assert.ok(markup.includes(`href="${OWN_PAGE.replaceAll("&", "&amp;")}"`));
  assert.ok(markup.includes("another listing page"), "the site root is linked as the listing page it is, never as a version");
  assert.ok(!markup.includes("Skip Navigation"), "the skip links are never shown as the sitting's document text");
});

test("a real revision is two versions: stated two, rendered as two rows, each address linked, with the revision wording", () => {
  const meetingId = "legistar:example:4410";
  const firstUrl = "https://example.legistar.com/View.ashx?M=A&ID=4410&GUID=A";
  const amendedUrl = "https://example.legistar.com/View.ashx?M=A&ID=4410&GUID=B";
  const original = "1. Call to order. 2. Public hearing on the fiscal year budget. 3. Adjournment.";
  const amended = "1. Call to order. 2. Public hearing on the fiscal year budget. 3. Rezoning of 12 Main Street. 4. Adjournment.";
  const held = [
    row(meetingId, firstUrl, original, "2026-09-01T10:00:00.000Z"),
    // Same words, different bytes and layout: a re-fetch of version one, not a third version.
    row(meetingId, firstUrl, `${original.replaceAll(" ", "  ")}\n`, "2026-09-02T10:00:00.000Z"),
    row(meetingId, amendedUrl, amended, "2026-09-10T10:00:00.000Z"),
  ];
  const corpusMeetings = [{ id: meetingId, ocdId: "ocd-division/country:us/state:az/place:example" }];
  const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: held, meetingsAcrossCorpus: corpusMeetings });
  assert.equal(shown.documents.length, 2);
  assert.deepEqual(shown.documents.map((document) => document.documentUrl), [amendedUrl, firstUrl]);
  assert.equal(shown.documents[1]!.retrievedAt, "2026-09-02T10:00:00.000Z");
  assert.equal(shown.identicalContentRows, 1);
  assert.equal(shown.publicationIndexRowsSetAside, 0);

  const publication = classifyAgendaPublication({ meetingId, bodyName: "Council", documentsForMeeting: held,
    documentsAcrossCorpus: held, meetingsAcrossCorpus: corpusMeetings, now: Date.parse("2026-09-12T00:00:00.000Z") });
  assert.equal(publication.revised, true);
  assert.deepEqual(publication.supersededDocumentUrls, [firstUrl]);

  const markup = render(shown.documents, publication);
  assert.ok(markup.includes("2 versions on file — a revised agenda is itself news"), markup);
  assert.equal(markup.match(/data-agenda-version=/g)?.length, 2, "stated N equals rendered rows");
  for (const url of [amendedUrl, firstUrl]) assert.ok(markup.includes(`href="${url.replaceAll("&", "&amp;")}"`), url);
});

test("a revision at the same address is still two versions, and the old address is not offered as the old text", () => {
  const meetingId = "legistar:example:4411";
  const url = "https://example.legistar.com/View.ashx?M=A&ID=4411";
  const held = [
    row(meetingId, url, "1. Call to order. 2. Consent agenda. 3. Adjournment.", "2026-09-03T10:00:00.000Z"),
    row(meetingId, url, "1. Call to order. 2. Consent agenda. 3. Water rate hearing. 4. Adjournment.", "2026-09-09T10:00:00.000Z"),
  ];
  const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: held, meetingsAcrossCorpus: [] });
  const publication = classifyAgendaPublication({ meetingId, bodyName: "Council", documentsForMeeting: held,
    documentsAcrossCorpus: held, now: Date.parse("2026-09-10T00:00:00.000Z") });
  const markup = render(shown.documents, publication);
  assert.equal(shown.documents.length, 2);
  assert.equal(publication.revised, true);
  assert.ok(markup.includes("2 versions on file — a revised agenda is itself news"));
  assert.equal(markup.match(/data-agenda-version=/g)?.length, 2);
  assert.ok(markup.includes("earlier version read"));
});

test("a sitting holding only publication-index pages is rendered as what it holds, with no version count and no revision", () => {
  const corpus = [
    // The site root read three times with the same words, and once after the page changed.
    row("diligent:tusd1:495", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-18T12:00:00.000Z"),
    row("diligent:tusd1:495", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-19T12:00:00.000Z"),
    row("diligent:tusd1:495", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-20T12:00:00.000Z"),
    row("diligent:tusd1:495", SITE_ROOT, `${SITE_ROOT_TEXT} Special Meeting Notice`, "2026-08-21T12:00:00.000Z"),
    row("diligent:tusd1:497", SITE_ROOT, SITE_ROOT_TEXT, "2026-08-21T12:00:00.000Z"),
  ];
  const held = corpus.filter((document) => document.meetingId === "diligent:tusd1:495");
  const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: corpus, meetingsAcrossCorpus: meetings });
  assert.equal(shown.sittingSpecific, false);
  assert.equal(shown.documents.length, 2, "two distinct contents of one listing page, never four");
  assert.equal(shown.identicalContentRows, 2);
  assert.equal(shown.publicationIndexRowsSetAside, 0, "nothing is set aside when the index is all we hold");

  const publication = classifyAgendaPublication({ meetingId: "diligent:tusd1:495", bodyName: "Governing Board",
    documentsForMeeting: held, documentsAcrossCorpus: corpus, meetingsAcrossCorpus: meetings, now: Date.parse("2026-09-22T18:00:00.000Z") });
  assert.equal(publication.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");
  assert.equal(publication.revised, false);
  assert.deepEqual(publication.supersededDocumentUrls, []);

  const markup = render(shown.documents, publication);
  assert.ok(markup.includes('data-agenda-publication="ACQUIRED_IS_PUBLICATION_INDEX"'), markup);
  assert.ok(markup.includes(`href="${SITE_ROOT}"`));
  assert.ok(!markup.includes("versions on file"), markup);
  assert.ok(!markup.includes("revised"), markup);
});
