import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AgendaDocumentStore,
  contentHashOf,
  extractHtmlText,
  retrieveAgendaDocument,
  type AgendaDocument,
} from "../lib/meetings/agenda-documents.ts";
import type { Meeting } from "../lib/sources/types.ts";

/**
 * The agenda-document store's append-only contract, and retrieval against a
 * stubbed fetch. No live calls; extraction failure is a recorded state, not
 * an exception.
 */

function docOf(meetingId: string, hash: string, text: string): AgendaDocument {
  return {
    id: `${meetingId}@${hash}`,
    meetingId,
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    documentUrl: "https://example.gov/agenda.pdf",
    contentHash: hash,
    retrievedAt: "2026-08-13T00:00:00Z",
    contentType: "application/pdf",
    text,
    extraction: "pdf",
    extractionNote: null,
    sourceUrl: "https://example.gov/agenda.pdf",
    sourceOrg: "Example Clerk",
    collectedAt: "2026-08-13T00:00:00Z",
    verifiedAt: null,
  };
}

test("an unchanged document is not stored twice", () => {
  const store = new AgendaDocumentStore();
  assert.deepEqual(store.append(docOf("m1", "aaa", "v1")), {
    stored: true,
    revised: false,
  });
  assert.deepEqual(store.append(docOf("m1", "aaa", "v1")), {
    stored: false,
    revised: false,
  });
  assert.equal(store.documentCount, 1);
});

test("a revised agenda appends beside the old version, never over it", () => {
  const store = new AgendaDocumentStore();
  store.append(docOf("m1", "aaa", "the original"));
  const result = store.append(docOf("m1", "bbb", "the revision"));

  assert.deepEqual(result, { stored: true, revised: true });
  const versions = store.versionsFor("m1");
  assert.equal(versions.length, 2, "both versions kept");
  assert.equal(versions[0].text, "the original");
  assert.equal(store.latestFor("m1")?.text, "the revision");
  assert.equal(store.latestHashFor("m1"), "bbb");
});

test("extractHtmlText strips markup and scripts, keeps the words", () => {
  const text = extractHtmlText(
    "<html><head><script>var x=1;</script><style>p{}</style></head>" +
      "<body><h1>Call to Order</h1><p>Item&nbsp;1 &amp; Item 2</p></body></html>",
  );
  assert.equal(text, "Call to Order Item 1 & Item 2");
});

test("contentHashOf is stable for identical bytes", () => {
  const bytes = new TextEncoder().encode("agenda");
  assert.equal(contentHashOf(bytes), contentHashOf(bytes));
  assert.notEqual(
    contentHashOf(bytes),
    contentHashOf(new TextEncoder().encode("agenda2")),
  );
});

const meetingWithAgenda: Meeting = {
  id: "stub:x:1",
  ocdId: "ocd-division/country:us/state:az/place:tucson",
  bodyName: "Stub Board",
  title: "Stub Meeting",
  startsAt: "2026-09-01T19:00:00.000-07:00",
  timeZone: "America/Phoenix",
  location: { name: "Hall", address: null, lat: 0, lng: 0 },
  agendaUrl: "https://example.gov/agenda",
  jurisdiction: "Stub, AZ",
  status: "SCHEDULED",
  provenance: {
    sourceUrl: "https://example.gov/meeting/1",
    sourceOrg: "Example Clerk",
    collectedAt: "2026-08-13T00:00:00Z",
    verifiedAt: null,
  },
};

function stubFetch(body: string, contentType: string): typeof fetch {
  return (async () =>
    new Response(new TextEncoder().encode(body), {
      status: 200,
      headers: { "content-type": contentType },
    })) as unknown as typeof fetch;
}

test("retrieveAgendaDocument extracts HTML text and records provenance", async () => {
  const doc = await retrieveAgendaDocument(meetingWithAgenda, {
    fetchImpl: stubFetch("<html><body><p>Public Hearing</p></body></html>", "text/html"),
  });

  assert.ok(doc);
  assert.equal(doc.extraction, "html");
  assert.equal(doc.text, "Public Hearing");
  assert.equal(doc.meetingId, "stub:x:1");
  assert.equal(doc.sourceOrg, "Example Clerk");
  assert.ok(doc.contentHash.length === 64, "sha-256 hex");
  assert.equal(doc.id, `stub:x:1@${doc.contentHash}`);
});

test("a meeting with no agenda link yields null, not a fabricated fetch", async () => {
  const doc = await retrieveAgendaDocument(
    { ...meetingWithAgenda, agendaUrl: null },
    { fetchImpl: stubFetch("", "text/html") },
  );
  assert.equal(doc, null);
});

test("a PDF that cannot be parsed records the failure and keeps the link", async () => {
  const doc = await retrieveAgendaDocument(
    { ...meetingWithAgenda, agendaUrl: "https://example.gov/broken.pdf" },
    { fetchImpl: stubFetch("this is not a pdf", "application/pdf") },
  );

  assert.ok(doc);
  assert.equal(doc.extraction, "failed");
  assert.equal(doc.text, null, "no partial text presented as complete");
  assert.ok(doc.extractionNote, "the failure is recorded on the row");
  assert.equal(doc.documentUrl, "https://example.gov/broken.pdf");
});
