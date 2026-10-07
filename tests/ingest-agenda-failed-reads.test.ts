import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { agendaDocumentStore, contentHashOf, type AgendaDocument } from "../lib/meetings/agenda-documents.ts";
import type { Meeting } from "../lib/sources/types.ts";
import { retrieveAgendas } from "../scripts/ingest.ts";

/** A failed read is never a new version over one we hold. These run the ingest's own retrieval pass with the network replaced by a recorded or stated page. */

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

function serve(body: string | Uint8Array, contentType = "text/html; charset=utf-8"): void {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(bytes), { status: 200, headers: { "content-type": contentType } })) as typeof fetch;
}

function meeting(id: string, agendaUrl: string): Meeting {
  return {
    id,
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    bodyName: "Stub Board",
    title: "Stub Meeting",
    startsAt: "2026-09-01T19:00:00.000-07:00",
    timeZone: "America/Phoenix",
    location: { name: "Hall", address: null, lat: 0, lng: 0 },
    agendaUrl,
    jurisdiction: "Stub, AZ",
    status: "CONCLUDED",
    provenance: { sourceUrl: agendaUrl, sourceOrg: "Stub Clerk", collectedAt: "2026-09-01T00:00:00Z", verifiedAt: null },
  };
}

function held(meetingId: string, documentUrl: string, text: string): AgendaDocument {
  const contentHash = contentHashOf(new TextEncoder().encode(`${meetingId}\n${text}`));
  return {
    id: `${meetingId}@${contentHash}`,
    meetingId,
    ocdId: "ocd-division/country:us/state:az/place:tucson",
    documentUrl,
    contentHash,
    retrievedAt: "2026-09-20T00:00:00Z",
    contentType: "text/html; charset=utf-8",
    text,
    extraction: "html",
    extractionNote: null,
    sourceUrl: documentUrl,
    sourceOrg: "Stub Clerk",
    collectedAt: "2026-09-20T00:00:00Z",
    verifiedAt: null,
  };
}

const navOnly = "<html><body><nav><a href='/'>Home</a> <a href='/board'>Board</a></nav></body></html>";

test("a failed read is not stored over a version the sitting already holds", async () => {
  const m = meeting("stub:ingest:1", "https://example.gov/agendas/1");
  agendaDocumentStore.append(held(m.id, m.agendaUrl!, "1. Call to order and approval of the minutes of the last meeting."));
  serve(navOnly);
  await retrieveAgendas([m]);
  const versions = agendaDocumentStore.versionsFor(m.id);
  assert.equal(versions.length, 1, "the failed read became a version over the held one");
  assert.equal(versions[0].extraction, "html");
});

test("a sitting that holds nothing still records its failed read, so the gap is named", async () => {
  const m = meeting("stub:ingest:2", "https://example.gov/agendas/2");
  serve(navOnly);
  await retrieveAgendas([m]);
  const versions = agendaDocumentStore.versionsFor(m.id);
  assert.equal(versions.length, 1);
  assert.equal(versions[0].extraction, "failed");
  assert.equal(versions[0].text, null);
  assert.match(versions[0].extractionNote ?? "", /^No readable text: /);
});

test("a readable revision over a held version is still stored beside it", async () => {
  const m = meeting("stub:ingest:3", "https://example.gov/agendas/3");
  agendaDocumentStore.append(held(m.id, m.agendaUrl!, "1. Call to order and approval of the minutes of the last meeting."));
  serve("<html><body><main><p>1. Call to order and approval of the minutes of the last meeting.</p>" +
    "<p>2. Public hearing on the proposed budget amendment for the coming year.</p></main></body></html>");
  await retrieveAgendas([m]);
  assert.equal(agendaDocumentStore.versionsFor(m.id).length, 2);
});

test("the recorded Diligent page, read for a sitting already holding its skip links, adds nothing", async () => {
  // The second sitting's next read says the same words as the first's page, so it is the publisher's page and is not stored over what the sitting holds.
  const portal = "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=";
  const page = readFileSync("tests/fixtures/diligent/meeting-information-tusd-502.html");
  const first = meeting("stub:ingest:496", `${portal}496`);
  serve(page);
  await retrieveAgendas([first]);
  const firstVersions = agendaDocumentStore.versionsFor(first.id);
  assert.equal(firstVersions.length, 1);
  assert.equal(firstVersions[0].extraction, "html", "alone, the committee page is read as the page it is");

  const second = meeting("stub:ingest:502", `${portal}502`);
  agendaDocumentStore.append(held(second.id, second.agendaUrl!, "Skip Navigation Jump to SideBar Tucson Unified School District"));
  serve(page);
  await retrieveAgendas([second]);
  const secondVersions = agendaDocumentStore.versionsFor(second.id);
  assert.equal(secondVersions.length, 1, "a publisher-page read was stored over the held version");
  assert.equal(secondVersions[0].text, "Skip Navigation Jump to SideBar Tucson Unified School District");
});
