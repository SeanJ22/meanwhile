import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import { AgendaDocumentStore, agendaDocumentStore } from "../lib/meetings/agenda-documents.ts";
import { agendaRetrievalOrder, retrieveAgendas } from "../scripts/ingest.ts";
import type { Meeting } from "../lib/sources/types.ts";

const HELD = JSON.parse(readFileSync("tests/fixtures/notice-pages-held-2026-09-24.json", "utf8")) as {
  readonly cap: { readonly url: string; readonly text: string };
  readonly mesa: { readonly url: string; readonly text: string };
};
const AGENDA_WITH_ITEMS = "<p>1. Call to order.</p><p>2. Approval of the consent agenda.</p><p>3. Adjournment.</p>";

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Answers each notice page with the text production held for it; every other URL with an agenda. */
function publisher(mesaBody = `<p>${escape(HELD.mesa.text)}</p>`): string[] {
  const requested: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    const body = url === HELD.cap.url
      ? `<p>${escape(HELD.cap.text)}</p>`
      : url === HELD.mesa.url
        ? mesaBody
        : AGENDA_WITH_ITEMS;
    return new Response(`<html><body><main>${body}</main></body></html>`, {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }) as typeof fetch;
  return requested;
}

function sitting(input: {
  readonly id: string;
  readonly ocdId: string;
  readonly bodyId: string;
  readonly bodyName: string;
  readonly sourceOrg: string;
  readonly startsAt: string;
  readonly agendaUrl?: string | null;
}): Meeting {
  return {
    id: input.id,
    ocdId: input.ocdId,
    bodyId: input.bodyId,
    bodyName: input.bodyName,
    title: input.bodyName,
    startsAt: input.startsAt,
    timeZone: "America/Phoenix",
    location: null,
    agendaUrl: input.agendaUrl ?? null,
    jurisdiction: "test",
    status: "SCHEDULED",
    provenance: { sourceUrl: "https://example.gov/calendar", sourceOrg: input.sourceOrg, collectedAt: "2026-09-24T15:43:00Z", verifiedAt: null },
  } as Meeting;
}

const PIMA = "ocd-division/country:us/state:az/county:pima";
const MESA = "ocd-division/country:us/state:az/place:mesa";

const mesaSitting = (id: string, startsAt: string, agendaUrl: string | null = null) => sitting({
  id, ocdId: MESA, bodyId: `${MESA}#governing`, bodyName: "City Council",
  sourceOrg: "City of Mesa City Clerk", startsAt, agendaUrl,
});

test("a Pima Board sitting with no agenda link is never given the water district's meetings page", async () => {
  const requested = publisher();
  const studySession = sitting({
    id: "d1:legistar-insite:pima:1381578", ocdId: PIMA, bodyId: `${PIMA}#governing`, bodyName: "Board of Supervisors",
    sourceOrg: "Pima County Clerk of the Board", startsAt: "2026-10-13T13:00:00-07:00",
  });
  await retrieveAgendas([studySession]);
  assert.ok(!requested.includes(HELD.cap.url), `another publisher's notice page was requested for Pima: ${requested.join(", ")}`);
  assert.equal(agendaDocumentStore.latestFor(studySession.id), null, "the Pima sitting holds a document it has no route to");

  // The district's own sitting may read its own page, and an itemless page is
  // held by no sitting.
  const district = sitting({
    id: "d1:civicclerk:capaz:1", ocdId: PIMA, bodyId: `${PIMA}#central-arizona-water-conservation-district`,
    bodyName: "Central Arizona Water Conservation District", sourceOrg: "Central Arizona Water Conservation District",
    startsAt: "2026-10-01T10:00:00-07:00",
  });
  await retrieveAgendas([district]);
  assert.ok(requested.includes(HELD.cap.url), "the district's own notice page was not read for its own sitting");
  assert.equal(agendaDocumentStore.latestFor(district.id), null, "a meetings page stating no agenda item was held as an agenda");
});

test("Newbury's sittings are never given the Town of Bradford's calendar", async () => {
  const requested = publisher();
  const NEWBURY = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town";
  const selectBoard = sitting({
    id: "d1:ical:newbury:select-board", ocdId: NEWBURY, bodyId: `${NEWBURY}#governing`, bodyName: "Select Board",
    sourceOrg: "Town of Newbury", startsAt: "2026-10-05T18:00:00-04:00",
  });
  await retrieveAgendas([selectBoard]);
  assert.ok(!requested.some((url) => new URL(url).hostname === "bradfordnh.gov"), `Bradford's calendar was requested for Newbury: ${requested.join(", ")}`);
  assert.equal(agendaDocumentStore.latestFor(selectBoard.id), null);
});

test("a body's own notice page stating no agenda item is held by no sitting, and is read once per run", async () => {
  const requested = publisher();
  const first = mesaSitting("d1:legistar-insite:mesa:1343183", "2026-10-06T17:30:00-07:00");
  const second = mesaSitting("d1:legistar-insite:mesa:1343184", "2026-10-13T17:30:00-07:00");
  await retrieveAgendas([first, second]);
  assert.equal(requested.filter((url) => url === HELD.mesa.url).length, 1, "one run read the same notice page twice");
  assert.equal(agendaDocumentStore.latestFor(first.id), null, "the first sitting to reach the page kept it as its agenda");
  assert.equal(agendaDocumentStore.latestFor(second.id), null);
});

test("a notice page that states agenda items is still held", async () => {
  publisher(AGENDA_WITH_ITEMS);
  const posted = mesaSitting("d1:legistar-insite:mesa:1343190", "2026-10-20T17:30:00-07:00");
  await retrieveAgendas([posted]);
  assert.equal(agendaDocumentStore.latestFor(posted.id)?.documentUrl, HELD.mesa.url, "an agenda posted on the notice page was refused");
});

test("a sitting reached only through its body's notice page is read after every sitting's own link", () => {
  const nearNotice = mesaSitting("d1:order:notice", "2026-09-25T17:30:00-07:00");
  const farLinked = mesaSitting("d1:order:linked", "2026-11-10T17:30:00-07:00", "https://mesa.legistar.com/View.ashx?M=A&ID=9&GUID=X");
  // A store of its own: the tests above leave that page held, which would rank it last.
  const order = agendaRetrievalOrder([nearNotice, farLinked], Date.parse("2026-09-24T18:00:00Z"), new AgendaDocumentStore()).map(({ id }) => id);
  assert.deepEqual(order, ["d1:order:linked", "d1:order:notice"], "a notice page was read before a sitting's own unread link");
});
