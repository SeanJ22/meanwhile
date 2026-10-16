import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { memoryWebsitePacing } from "../lib/control-plane/website-pacing.ts";
import { PUBLISHER_PAGE_SIGNAL, isPublisherPageNote } from "../lib/meetings/agenda-content.ts";
import {
  AgendaDocumentStore,
  canonicalAgendaDocument,
  contentHashOf,
  extractHtmlText,
  retrieveAgendaDocument,
  type AgendaDocument,
} from "../lib/meetings/agenda-documents.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { runWithSourceFetch } from "../lib/sources/fetch-source.ts";
import type { SavedSourceResponse, SourceFetchStore } from "../lib/sources/fetch-source-state.ts";

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

test("an unchanged successful check advances only the last-check date and never moves it backwards", () => {
  const store = new AgendaDocumentStore();
  const original = { ...docOf("m1", "aaa", "v1"), verifiedAt: "2026-08-13T01:00:00Z" };
  store.append(original);
  const checkedAt = "2026-08-14T00:00:00Z";
  assert.deepEqual(store.append({ ...original, retrievedAt: checkedAt, collectedAt: checkedAt, verifiedAt: null }),
    { stored: false, revised: false });
  assert.deepEqual(store.latestFor("m1"), { ...original, retrievedAt: checkedAt });
  store.append(original);
  assert.deepEqual(store.latestFor("m1"), { ...original, retrievedAt: checkedAt });
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
  assert.equal(store.latestFor("m1")?.contentHash, "bbb");
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

test("unchanged HTML reuses only the same meeting's exact URL and byte hash", async t => {
  const held = new AgendaDocumentStore();
  const body = "<html><main><p>1. Call to order.</p><p>2. Approval of the agenda.</p></main></html>";
  const read = (meeting: Meeting) => retrieveAgendaDocument(meeting, { held, fetchImpl: stubFetch(body, "text/html") });
  const first = await read(meetingWithAgenda);
  assert.ok(first);
  held.append(first);
  const decode = t.mock.method(TextDecoder.prototype, "decode");
  const same = await read(meetingWithAgenda);
  assert.equal(same?.text, first.text);
  assert.equal(same?.collectedAt, first.collectedAt);
  assert.equal(decode.mock.callCount(), 0, "the held successful extraction avoids decoding and HTML extraction");
  const otherMeeting = await read({ ...meetingWithAgenda, id: "stub:x:2" });
  assert.equal(otherMeeting?.meetingId, "stub:x:2");
  assert.equal(decode.mock.callCount(), 1, "another meeting must acquire its own extraction");
  const otherUrl = await read({ ...meetingWithAgenda, agendaUrl: "https://example.gov/another-agenda" });
  assert.equal(otherUrl?.documentUrl, "https://example.gov/another-agenda");
  assert.equal(decode.mock.callCount(), 2, "a different document URL is checked separately");
});

test("a failed extraction retries the same bytes and repairs its existing version", async () => {
  const held = new AgendaDocumentStore(), body = "<html><main><p>Public Hearing</p></main></html>";
  const original = { ...docOf(meetingWithAgenda.id, contentHashOf(new TextEncoder().encode(body)), ""),
    documentUrl: meetingWithAgenda.agendaUrl!, sourceUrl: meetingWithAgenda.agendaUrl!, contentType: "text/html",
    text: null, extraction: "failed" as const, extractionNote: "The previous extractor could not run." };
  held.append(original);
  const retry = await retrieveAgendaDocument(meetingWithAgenda, { held, fetchImpl: stubFetch(body, "text/html") });
  assert.equal(retry?.extraction, "html");
  assert.equal(retry?.text, "Public Hearing");
  assert.deepEqual(held.append(retry!), { stored: true, revised: false });
  assert.equal(held.documentCount, 1);
  assert.equal(held.latestFor(meetingWithAgenda.id)?.collectedAt, original.collectedAt);
  assert.equal(held.latestFor(meetingWithAgenda.id)?.text, "Public Hearing");
});

test("a conditional PDF check reuses its successful extraction and a cached replay preserves the wire check time", async t => {
  const { PDFWorker } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const extraction = t.mock.method(PDFWorker, "create");
  const bytes = readFileSync("tests/fixtures/pima-edu/agenda-2026-08-10.pdf");
  const values = new Map<string, SavedSourceResponse>();
  const store: SourceFetchStore = {
    pacing: memoryWebsitePacing(), withLease: async (_key, operation) => operation(),
    read: async key => values.get(key) ?? null, readRequestPlan: async () => null, saveRequestGroup: async () => {},
    record: async (key, value) => { if (value) values.set(key, value); },
  };
  const held = new AgendaDocumentStore(), vault = new MemoryEvidenceStore();
  const meeting = { ...meetingWithAgenda, agendaUrl: "https://example.gov/agenda.pdf" };
  let clock = Date.parse("2026-10-15T00:00:00.000Z"), requests = 0;
  const transport: typeof fetch = async (_url, init) => {
    requests++;
    if (requests === 1) return new Response(bytes, { headers: { "content-type": "application/pdf", etag: '"agenda-one"' } });
    assert.equal(new Headers(init?.headers).get("if-none-match"), '"agenda-one"');
    return new Response(null, { status: 304 });
  };
  const read = (dueAt: string) => runWithSourceFetch({ sourceId: meeting.id, dueAt, vault,
    runtime: { store, transport, now: () => clock } }, () => retrieveAgendaDocument(meeting, { held }));
  const first = await read(new Date(clock).toISOString());
  assert.equal(first?.extraction, "pdf");
  assert.ok(first?.text?.includes("Agenda"));
  assert.equal(extraction.mock.callCount(), 1);
  const original = { ...first!, verifiedAt: "2026-10-15T00:01:00.000Z" };
  held.append(original);
  clock += 3_600_000;
  const dueAt = new Date(clock).toISOString(), checked = await read(dueAt);
  assert.deepEqual(checked, { ...original, retrievedAt: dueAt });
  assert.deepEqual(held.append(checked!), { stored: false, revised: false });
  clock += 300_000;
  assert.deepEqual(await read(dueAt), checked, "saved response reuse cannot claim the later parser time as a source check");
  assert.equal(extraction.mock.callCount(), 1, "the unchanged PDF never enters the extraction engine again");
  assert.equal(requests, 2, "one initial download and one conditional check");
  assert.equal(held.documentCount, 1);
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

test("binary Office bytes retain their URL/hash but never become Reader text or JSONB NULs", async () => {
  const binary = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
  const doc = await retrieveAgendaDocument(meetingWithAgenda, {
    fetchImpl: (async () => new Response(binary, {
      status: 200,
      headers: { "content-type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
    })) as typeof fetch,
  });

  assert.ok(doc);
  assert.equal(doc.extraction, "failed");
  assert.equal(doc.text, null);
  assert.match(doc.extractionNote ?? "", /binary document bytes/i);
  assert.equal(doc.contentHash, contentHashOf(binary));

  const legacy = canonicalAgendaDocument(docOf("legacy", "abc", "PK\u0003\u0004\u0000binary"));
  assert.equal(legacy.text, null);
  assert.equal(legacy.extraction, "failed");
  assert.doesNotMatch(JSON.stringify(legacy), /\\u0000/);
});

/* ------------------- a read that returned nothing is failed --- */

/** A one-page PDF with an empty content stream, xref offsets computed. */
function blankPdf(): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>",
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

/** A held HTML row for another sitting, as the ingest's seeded store holds it. */
function heldHtml(meetingId: string, documentUrl: string, text: string): AgendaDocument {
  return {
    ...docOf(meetingId, contentHashOf(new TextEncoder().encode(`${meetingId}${text}`)), text),
    documentUrl,
    sourceUrl: documentUrl,
    contentType: "text/html; charset=utf-8",
    extraction: "html",
  };
}

const portal = "https://tusd.example.gov/Portal/MeetingInformation.aspx?Org=Cal&Id=";
const skipLinks = "<html><body><div><a href='#main'>Skip Navigation</a> <a href='#side'>Jump to SideBar</a></div>" +
  "<div class='sign-in'>Example Unified School District</div></body></html>";

test("an HTML page with no readable text is a failed read, and the note names why", async () => {
  const doc = await retrieveAgendaDocument(meetingWithAgenda, {
    fetchImpl: stubFetch("<html><body><nav><a href='/'>Home</a></nav><script>var x;</script></body></html>", "text/html"),
    held: new AgendaDocumentStore(),
  });
  assert.ok(doc);
  assert.equal(doc.extraction, "failed");
  assert.equal(doc.text, null, "an empty string is not a successful extraction");
  assert.match(doc.extractionNote ?? "", /^No readable text: /);
  assert.equal(doc.documentUrl, meetingWithAgenda.agendaUrl, "the link survives the failure");
});

test("a PDF with no text layer is a failed read, and the note names why", async () => {
  const doc = await retrieveAgendaDocument(
    { ...meetingWithAgenda, agendaUrl: "https://example.gov/scanned.pdf" },
    {
      fetchImpl: (async () => new Response(blankPdf(), { status: 200, headers: { "content-type": "application/pdf" } })) as unknown as typeof fetch,
      held: new AgendaDocumentStore(),
    },
  );
  assert.ok(doc);
  assert.equal(doc.extraction, "failed");
  assert.equal(doc.text, null);
  assert.match(doc.extractionNote ?? "", /^No readable text: the PDF has no text layer/);
});

test("a one-line notice is a document, not a failure: no length threshold decides", async () => {
  const doc = await retrieveAgendaDocument(meetingWithAgenda, {
    fetchImpl: stubFetch("<html><body><main><p>Meeting cancelled.</p></main></body></html>", "text/html"),
    held: new AgendaDocumentStore(),
  });
  assert.ok(doc);
  assert.equal(doc.extraction, "html");
  assert.equal(doc.text, "Meeting cancelled.");
});

test("the same words another sitting's page says are the publisher's page: failed, witness named", async () => {
  const held = new AgendaDocumentStore();
  // Another sitting's held page, word for word.
  held.append(heldHtml("stub:x:2", `${portal}500`, "Skip Navigation Jump to SideBar Example Unified School District"));
  const doc = await retrieveAgendaDocument(
    { ...meetingWithAgenda, agendaUrl: `${portal}502` },
    { fetchImpl: stubFetch(skipLinks, "text/html; charset=utf-8"), held },
  );
  assert.ok(doc);
  assert.equal(doc.extraction, "failed");
  assert.equal(doc.text, null);
  assert.ok(isPublisherPageNote(doc.extractionNote), "the note does not open with the named signal");
  assert.ok(doc.extractionNote?.startsWith(`${PUBLISHER_PAGE_SIGNAL}: `));
  assert.match(doc.extractionNote ?? "", /stub:x:2/, "the witness is not named");
  assert.equal(doc.documentUrl, `${portal}502`);
});

test("the recorded Diligent page read beside a same-type sitting's page is the publisher's page", async () => {
  const page = readFileSync("tests/fixtures/diligent/meeting-information-tusd-502.html");
  const fetchPage = (async () => new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })) as unknown as typeof fetch;
  // Alone, the page is read as what it is: the portal's own page.
  const alone = await retrieveAgendaDocument({ ...meetingWithAgenda, agendaUrl: `${portal}502` }, { fetchImpl: fetchPage, held: new AgendaDocumentStore() });
  assert.equal(alone?.extraction, "html");
  assert.match(alone?.text ?? "", /Bond Oversight Committee Meeting Agenda/);
  // Beside another sitting of the same committee, whose page says the same words, it is the publisher's page.
  const held = new AgendaDocumentStore();
  held.append(heldHtml("stub:x:496", `${portal}496`, alone!.text!));
  const beside = await retrieveAgendaDocument({ ...meetingWithAgenda, agendaUrl: `${portal}502` }, { fetchImpl: fetchPage, held });
  assert.equal(beside?.extraction, "failed");
  assert.ok(isPublisherPageNote(beside?.extractionNote));
});

test("negative controls: a re-read of the same sitting, another host, and a shared joint agenda stay documents", async () => {
  const text = "Skip Navigation Jump to SideBar Example Unified School District";
  // The same sitting's own earlier read is a re-fetch, never a witness.
  const self = new AgendaDocumentStore();
  self.append(heldHtml(meetingWithAgenda.id, `${portal}502`, text));
  const reread = await retrieveAgendaDocument({ ...meetingWithAgenda, agendaUrl: `${portal}502` }, { fetchImpl: stubFetch(skipLinks, "text/html"), held: self });
  assert.equal(reread?.extraction, "html");

  // The same words from a different publisher host are not this publisher's page.
  const elsewhere = new AgendaDocumentStore();
  elsewhere.append(heldHtml("stub:x:2", "https://other.example.org/meetings/9", text));
  const other = await retrieveAgendaDocument({ ...meetingWithAgenda, agendaUrl: `${portal}502` }, { fetchImpl: stubFetch(skipLinks, "text/html"), held: elsewhere });
  assert.equal(other?.extraction, "html");

  // Two sittings sharing one real agenda: it yields items, so it is kept.
  const joint = "<html><body><main><h1>Joint Meeting Agenda:</h1><p>1. Call to order and roll call of both boards.</p>" +
    "<p>2. Approval of the intergovernmental agreement on road maintenance.</p></main></body></html>";
  const jointText = extractHtmlText(joint);
  const shared = new AgendaDocumentStore();
  shared.append(heldHtml("stub:x:2", "https://example.gov/joint/2", jointText));
  const kept = await retrieveAgendaDocument(meetingWithAgenda, { fetchImpl: stubFetch(joint, "text/html"), held: shared });
  assert.equal(kept?.extraction, "html");
  assert.equal(kept?.text, jointText);
});
