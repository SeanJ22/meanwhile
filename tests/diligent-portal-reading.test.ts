import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { tsImport } from "tsx/esm/api";

import {
  agendaDocumentRepresentation,
  classifyAgendaPublication,
  readerAgendaDocuments,
} from "../lib/ask/agenda-publication.ts";
import { PUBLISHER_PAGE_SIGNAL } from "../lib/meetings/agenda-content.ts";
import { extractHtmlText, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";

// The meeting card's agenda leaf, compiled through the existing tsx runtime.
const { AgendaDocuments } = await tsImport("../components/map/popup/agenda-section.tsx", import.meta.url) as typeof import("../components/map/popup/agenda-section.tsx");

/**
 * A Diligent meeting page is the body's agenda portal, however it was read: the sitting's agenda is a document the
 * page links, never the page, and its skip links must not be shown as the document's text.
 */

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function row(meetingId: string, documentUrl: string, text: string | null, retrievedAt: string,
  over: Partial<AgendaDocument> = {}): AgendaDocument {
  const contentHash = hash(`${documentUrl}|${retrievedAt}|${text}`);
  return {
    id: `${meetingId}@${contentHash}`, meetingId, ocdId: null, documentUrl, contentHash, retrievedAt,
    contentType: "text/html; charset=utf-8", text, extraction: text === null ? "failed" : "html",
    extractionNote: null, sourceUrl: documentUrl, sourceOrg: "Example Governing Board",
    collectedAt: retrievedAt, verifiedAt: null, ...over,
  };
}

/** The three tenants, their stored skip-link text and a sitting each, as production holds them. */
const TENANTS = [
  {
    meetingId: "diligent:tusd1:502", bodyName: "Bond Oversight Committee Meeting Agenda",
    url: "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=502",
    stored: "Skip Navigation Jump to SideBar Tucson Unified School District",
  },
  {
    meetingId: "diligent:pcc:698", bodyName: "Finance and Audit Committee Meeting",
    url: "https://pima.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=698",
    stored: "Skip Navigation Jump to SideBar Pima Community College",
  },
  {
    meetingId: "diligent:susd12:162", bodyName: "Governing Board",
    url: "https://susd-12.community.highbond.com/Portal/MeetingInformation.aspx?Org=Cal&Id=162",
    stored: "Skip Navigation Jump to SideBar Sunnyside Unified School District #12",
  },
];

function render(documents: readonly AgendaDocument[], publication: ReturnType<typeof classifyAgendaPublication>) {
  return renderToStaticMarkup(createElement(AgendaDocuments, {
    documents: documents.map((document) => ({
      id: document.id, documentUrl: document.documentUrl, contentHash: document.contentHash,
      retrievedAt: document.retrievedAt, contentType: document.contentType, extraction: document.extraction,
      extractionNote: document.extractionNote, text: document.text, sourceOrg: document.sourceOrg,
    })),
    meetingId: documents[0]!.meetingId, agendaUrl: documents[0]!.documentUrl, publication,
  }));
}

test("the stored skip-link rows of all three Diligent tenants read as the portal, not as an agenda we could not read", () => {
  for (const tenant of TENANTS) {
    // Three hourly re-reads with new bytes and the same words, as production stored them.
    const held = ["2026-09-23T04:08:00.000Z", "2026-09-23T05:08:00.000Z", "2026-09-23T06:08:00.000Z"]
      .map((at) => row(tenant.meetingId, tenant.url, tenant.stored, at));
    assert.equal(agendaDocumentRepresentation(held[0]!), "PUBLICATION_PORTAL", tenant.meetingId);

    const shown = readerAgendaDocuments(held, { documentsAcrossCorpus: held, meetingsAcrossCorpus: [] });
    assert.equal(shown.sittingSpecific, false, tenant.meetingId);
    assert.equal(shown.documents.length, 1, "identical re-reads are one page");

    const publication = classifyAgendaPublication({ meetingId: tenant.meetingId, bodyName: tenant.bodyName,
      documentsForMeeting: held, documentsAcrossCorpus: held, now: Date.parse("2026-09-23T12:00:00.000Z") });
    assert.equal(publication.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX", tenant.meetingId);
    assert.equal(publication.gap?.statement,
      `The link we hold for that meeting is ${tenant.bodyName}'s agenda portal rather than the agenda itself.`);
    assert.equal(publication.revised, false);

    const markup = render(shown.documents, publication);
    assert.ok(markup.includes('data-agenda-publication="ACQUIRED_IS_PUBLICATION_INDEX"'), markup);
    assert.ok(markup.includes("Open the publisher&#x27;s agenda portal"), markup);
    assert.ok(!markup.includes("Skip Navigation"), "the skip links are never shown as a document's text");
    assert.ok(!/could not extract its items/.test(markup));
  }
});

test("the fixed extractor's reading of the recorded pages is the portal too", () => {
  const pages = [
    { file: "tests/fixtures/diligent/meeting-information-tusd-502.html", tenant: TENANTS[0]! },
    { file: "tests/fixtures/diligent/meeting-information-pcc-698.html", tenant: TENANTS[1]! },
  ];
  for (const { file, tenant } of pages) {
    const text = extractHtmlText(readFileSync(file, "utf8"));
    assert.ok(text.length > tenant.stored.length, "the page's own content was read");
    assert.equal(agendaDocumentRepresentation(row(tenant.meetingId, tenant.url, text, "2026-09-24T00:00:00.000Z")), "PUBLICATION_PORTAL", file);
  }
});

test("a read recorded as the publisher's page is the portal; a read with no text stays unreadable", () => {
  const { meetingId, url, bodyName } = TENANTS[0]!;
  const publisherPage = row(meetingId, url, null, "2026-09-24T01:00:00.000Z", {
    extractionNote: `${PUBLISHER_PAGE_SIGNAL}: its text is word for word the page tusd1-schooldesk.community.diligentoneplatform.com ` +
      "serves for another meeting (diligent:tusd1:496), so it is the publisher's page rather than this meeting's document.",
  });
  const noText = row(meetingId, url, null, "2026-09-24T00:00:00.000Z", {
    extractionNote: "No readable text: once its scripts, controls and site navigation were set aside, the page held no words.",
  });
  assert.equal(agendaDocumentRepresentation(publisherPage), "PUBLICATION_PORTAL");
  assert.equal(agendaDocumentRepresentation(noText), "UNREADABLE");

  const onlyThePage = classifyAgendaPublication({ meetingId, bodyName, documentsForMeeting: [publisherPage],
    documentsAcrossCorpus: [publisherPage], now: Date.parse("2026-09-24T12:00:00.000Z") });
  assert.equal(onlyThePage.acquisition, "ACQUIRED_IS_PUBLICATION_INDEX");

  // Two failed reads of one address are two findings, told apart by their notes.
  const both = readerAgendaDocuments([publisherPage, noText], { documentsAcrossCorpus: [publisherPage, noText] });
  assert.deepEqual(both.documents.map((document) => document.id), [noText.id]);
  assert.equal(both.publicationIndexRowsSetAside, 1);
});

test("negative controls: the rule reads the portal's own furniture on the portal's own address, nothing wider", () => {
  const { meetingId, url } = TENANTS[0]!;
  // The same words from another publisher's address are not judged by this rule.
  assert.equal(agendaDocumentRepresentation(row(meetingId, "https://example.gov/meetings/502", TENANTS[0]!.stored, "2026-09-23T00:00:00.000Z")), "TEXT");
  // A page on the portal's address that carries none of its furniture is read as text.
  const agenda = "Regular Meeting Agenda 1. Call to order. 2. Approval of the consent agenda. 3. Adjournment.";
  assert.equal(agendaDocumentRepresentation(row(meetingId, url, agenda, "2026-09-23T00:00:00.000Z")), "TEXT");
  // A failed read with no note, or another note, is not the publisher's page.
  assert.equal(agendaDocumentRepresentation(row(meetingId, url, null, "2026-09-23T00:00:00.000Z")), "UNREADABLE");
});
