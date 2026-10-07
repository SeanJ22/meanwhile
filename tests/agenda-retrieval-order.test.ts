import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";

import {
  AgendaDocumentStore,
  agendaDocumentStore,
  contentHashOf,
  type AgendaDocument,
} from "../lib/meetings/agenda-documents.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { Meeting } from "../lib/sources/types.ts";
import {
  agendaRetrievalOrder,
  inRetrievalOrder,
  reconcileSuccessfulMeetingPartition,
  retrieveAgendas,
  seedHeldAgendaDocuments,
} from "../scripts/ingest.ts";

/**
 * "Latest" means latest, and a link never read is read first:
 * - held rows are compared in read order, so re-reading the same words stores nothing new;
 * - a sitting holding versions only from an old link does not outrank one never read, and a notice
 *   page shared by several sittings is read once.
 * Held rows are recorded in tests/fixtures/diligent/susd-167-held-rows.json. No live call is made.
 */

const realFetch = globalThis.fetch;
after(() => {
  globalThis.fetch = realFetch;
});

interface HeldRowsFixture {
  readonly shared: Omit<AgendaDocument, "id" | "retrievedAt" | "contentHash" | "text" | "collectedAt">;
  readonly texts: readonly string[];
  readonly rows: readonly { readonly id: string; readonly retrievedAt: string; readonly text: number }[];
}

const fixture = JSON.parse(
  readFileSync("tests/fixtures/diligent/susd-167-held-rows.json", "utf8"),
) as HeldRowsFixture;

const held167: AgendaDocument[] = fixture.rows.map((row) => ({
  ...fixture.shared,
  id: row.id,
  contentHash: row.id.slice(row.id.indexOf("@") + 1),
  retrievedAt: row.retrievedAt,
  collectedAt: row.retrievedAt,
  text: fixture.texts[row.text]!,
}));

const SUSD = "ocd-division/country:us/state:az/school_district:sunnyside_unified_district";
const TUSD = "ocd-division/country:us/state:az/school_district:tucson_unified_district";

function sitting(id: string, startsAt: string, agendaUrl: string | null, ocdId = TUSD): Meeting {
  return {
    id,
    ocdId,
    bodyName: "Governing Board",
    title: "Governing Board Meeting",
    startsAt,
    timeZone: "America/Phoenix",
    location: { name: "Board Room", address: null, lat: 32.22, lng: -110.97 },
    agendaUrl,
    jurisdiction: "Tucson, AZ",
    status: Date.parse(startsAt) > Date.parse(NOW) ? "SCHEDULED" : "CONCLUDED",
    provenance: {
      sourceUrl: agendaUrl ?? "https://govboard.tusd1.org/",
      sourceOrg: "Stub Clerk",
      collectedAt: "2026-09-24T00:00:00Z",
      verifiedAt: null,
    },
  };
}

function version(meetingId: string, documentUrl: string, text: string, retrievedAt: string, ocdId = TUSD): AgendaDocument {
  const contentHash = contentHashOf(new TextEncoder().encode(`${meetingId}\n${documentUrl}\n${text}\n${retrievedAt}`));
  return {
    id: `${meetingId}@${contentHash}`,
    meetingId,
    ocdId,
    documentUrl,
    contentHash,
    retrievedAt,
    contentType: "text/html; charset=utf-8",
    text,
    extraction: "html",
    extractionNote: null,
    sourceUrl: documentUrl,
    sourceOrg: "Stub Clerk",
    collectedAt: retrievedAt,
    verifiedAt: null,
  };
}

function snapshotOf(meetings: Meeting[], agendaDocuments: AgendaDocument[]): MeetingsSnapshot {
  return {
    formatVersion: 1,
    generatedAt: "2026-09-24T11:15:08.662Z",
    counts: { fresh: meetings.length, carried: 0, total: meetings.length },
    sources: [],
    meetings,
    agendaDocuments,
  };
}

const NOW = "2026-09-24T12:25:00.000Z";
const sunnyside167 = sitting("diligent:susd12:167", "2026-09-23T23:30:00.000Z", fixture.shared.documentUrl, SUSD);

/** Sunnyside 167's page read again: the same words, new bytes (the portal restamps every response). */
function reread167(at: string): AgendaDocument {
  const latest = held167.find(({ text }) => text === fixture.texts[1])!;
  const contentHash = contentHashOf(new TextEncoder().encode(`__VIEWSTATE=${at}\n${latest.text}`));
  return { ...latest, id: `${latest.meetingId}@${contentHash}`, contentHash, retrievedAt: at, collectedAt: at };
}

test("the recorded Sunnyside 167 rows are out of read order, as production holds them", () => {
  assert.equal(held167.length, 153);
  const inversions = held167.filter((row, index) => index > 0 && row.retrievedAt < held167[index - 1]!.retrievedAt);
  assert.ok(inversions.length > 0, "the recorded payload order is already chronological");
  assert.deepEqual([...new Set(held167.map(({ text }) => text))].length, 2);
});

test("seeded in payload order an unchanged read is stored again; seeded in read order it is not", () => {
  const asBefore = new AgendaDocumentStore();
  for (const row of held167) asBefore.append(row);
  assert.equal(asBefore.append(reread167(NOW)).stored, true, "the defect this fixes did not reproduce");

  const seeded = new AgendaDocumentStore();
  const { carried, refused } = seedHeldAgendaDocuments(snapshotOf([sunnyside167], held167), seeded);
  assert.equal(carried, 153);
  assert.equal(refused, 0);
  assert.equal(seeded.latestFor(sunnyside167.id)?.text, fixture.texts[1], "latest is not the newest read");
  assert.equal(seeded.append(reread167(NOW)).stored, false, "the same words with new bytes were stored again");
});

test("two runs of seed, re-read and reconcile add no row and write the rows in read order", () => {
  let previous = snapshotOf([sunnyside167], held167);
  for (const at of [NOW, "2026-09-24T13:30:00.000Z"]) {
    const store = new AgendaDocumentStore();
    seedHeldAgendaDocuments(previous, store);
    assert.equal(store.append(reread167(at)).stored, false, `the ${at} re-read was stored`);
    // As the ingest composes a partition's fresh documents: the store's rows,
    // then the previous payload's, first occurrence of each id kept.
    const fresh = [...store.versionsFor(sunnyside167.id), ...previous.agendaDocuments]
      .filter((document, index, all) => all.findIndex(({ id }) => id === document.id) === index);
    const reconciled = reconcileSuccessfulMeetingPartition({
      sourceName: "diligent",
      generatedAt: at,
      freshMeetings: [sunnyside167],
      freshAgendaDocuments: fresh,
      previous,
    });
    assert.equal(reconciled.agendaDocuments.length, 153, `the ${at} run changed the number of held rows`);
    assert.deepEqual(
      reconciled.agendaDocuments.map(({ id }) => id),
      inRetrievalOrder(held167).map(({ id }) => id),
      "the written rows are not in read order",
    );
    previous = snapshotOf([sunnyside167], [...reconciled.agendaDocuments]);
  }
});

test("read order is retrievedAt, then id, whatever order the rows arrive in", () => {
  const rows = [
    { id: "m@c", retrievedAt: "2026-09-24T03:25:00.000Z" },
    { id: "m@b", retrievedAt: "2026-09-14T12:45:00.000Z" },
    { id: "m@a", retrievedAt: "2026-09-24T03:25:00.000Z" },
    { id: "m@z", retrievedAt: "not a time" },
  ];
  assert.deepEqual(inRetrievalOrder(rows).map(({ id }) => id), ["m@z", "m@b", "m@a", "m@c"]);
  assert.deepEqual(inRetrievalOrder([...rows].reverse()).map(({ id }) => id), ["m@z", "m@b", "m@a", "m@c"]);
});

// ── one board, linked and unlinked sittings ───────────────────────────────
const NOTICE = "https://govboard.tusd1.org/";
const PORTAL = "https://tusd1-schooldesk.community.diligentoneplatform.com/Portal/MeetingInformation.aspx?Org=Cal&Id=";
const ACTIONS = "https://govboard.tusd1.org/_theme/files/GovBoard/Docs/actions/";

const boardActions: readonly [string, string, string][] = [
  ["diligent:tusd1:498", "2026-09-08T16:30:00-07:00", `${ACTIONS}09-08-2026R.pdf`],
  ["diligent:tusd1:493", "2026-08-25T16:30:00-07:00", `${ACTIONS}08-25-2026S.pdf`],
  ["diligent:tusd1:492", "2026-08-11T16:30:00-07:00", `${ACTIONS}08-11-2026R.pdf`],
  ["diligent:tusd1:491", "2026-08-04T17:00:00-07:00", `${ACTIONS}08-04-2026S(2).pdf`],
  ["diligent:tusd1:485", "2026-07-28T16:30:00-07:00", `${ACTIONS}07-28-2026.pdf`],
  ["diligent:tusd1:484", "2026-07-14T16:30:00-07:00", `${ACTIONS}07-14-2026R(1).pdf`],
];
// Unlinked scheduled sittings, given the board's notice page (the wiring's `noticeUrl`) directly.
const noticeOnly: readonly [string, string][] = [
  ["diligent:tusd1:503", "2026-09-28T18:15:00-07:00"],
  ["diligent:tusd1:505", "2026-09-30T16:00:00-07:00"],
  ["diligent:tusd1:504", "2026-10-05T17:30:00-07:00"],
  ["diligent:tusd1:2026-10-06T1630-governing-board", "2026-10-06T16:30:00-07:00"],
  ["diligent:tusd1:2026-10-27T1630-governing-board", "2026-10-27T16:30:00-07:00"],
  ["diligent:tusd1:2026-11-17T1630-governing-board", "2026-11-17T16:30:00-07:00"],
  ["diligent:tusd1:2026-12-08T1630-governing-board", "2026-12-08T16:30:00-07:00"],
];

function tucsonUnified(prefix: string, store: AgendaDocumentStore): Meeting[] {
  const id = (raw: string) => `${prefix}${raw}`;
  const skip = "Skip Navigation Jump to SideBar Tucson Unified School District";
  const meetings: Meeting[] = [];
  for (const [raw, startsAt, pdf] of boardActions) {
    const portalId = raw.slice(raw.lastIndexOf(":") + 1);
    meetings.push(sitting(id(raw), startsAt, pdf));
    store.append(version(id(raw), `${PORTAL}${portalId}`, skip, "2026-09-14T12:45:00.000Z"));
  }
  meetings.push(sitting(id("diligent:tusd1:499"), "2026-09-22T16:30:00-07:00", `${ACTIONS}09-22-2026S.pdf`));
  store.append(version(id("diligent:tusd1:499"), `${ACTIONS}09-22-2026S.pdf`, "1. Call to order. 2. Consent agenda approved.", "2026-09-24T07:49:00.000Z"));
  meetings.push(sitting(id("diligent:tusd1:502"), "2026-09-17T13:00:00-07:00", `${PORTAL}502`));
  store.append(version(id("diligent:tusd1:502"), `${PORTAL}502`, skip, "2026-09-24T05:40:00.000Z"));
  meetings.push(sitting(id("diligent:tusd1:495"), "2026-09-16T14:30:00-07:00", NOTICE));
  store.append(version(id("diligent:tusd1:495"), NOTICE, "Governing Board Tucson Unified School District Home Meetings", "2026-08-18T00:19:00.000Z"));
  for (const [raw, startsAt] of noticeOnly) meetings.push(sitting(id(raw), startsAt, NOTICE));
  return meetings;
}

test("a link never read goes first, re-reads by nearness to today, and another sitting's page last", () => {
  const store = new AgendaDocumentStore();
  const meetings = tucsonUnified("", store);
  const order = agendaRetrievalOrder(meetings, Date.parse(NOW), store).map(({ id }) => id);
  assert.deepEqual(order.slice(0, 6), boardActions.map(([id]) => id), "the Board Actions links are not read first");
  assert.deepEqual(order.slice(6, 9), ["diligent:tusd1:499", "diligent:tusd1:502", "diligent:tusd1:495"]);
  assert.deepEqual(order.slice(9), noticeOnly.map(([id]) => id), "the shared notice page is not last");
});

test("one run reads all six Board Actions links and no landing page; the next run reads no link twice", async () => {
  const meetings = tucsonUnified("run:", agendaDocumentStore);
  const requested: string[] = [];
  const pdf = readFileSync("tests/fixtures/tusd-govboard/board-actions-2026-09-22.pdf");
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requested.push(url);
    return url.endsWith(".pdf")
      ? new Response(new Uint8Array(pdf), { status: 200, headers: { "content-type": "application/pdf" } })
      : new Response("<html><body><main><p>1. Call to order.</p></main></body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
  }) as typeof fetch;

  await retrieveAgendas(meetings);
  assert.equal(requested.length, 8);
  for (const [, , link] of boardActions) assert.ok(requested.includes(link), `${link} was not read`);
  assert.ok(!requested.includes(NOTICE), "a read was spent on the notice page while new links waited");
  for (const [raw, , link] of boardActions) {
    assert.ok(
      agendaDocumentStore.versionsFor(`run:${raw}`).some(({ documentUrl }) => documentUrl === link),
      `run:${raw} holds nothing read from its Board Actions link`,
    );
  }

  // Every sitting now holds its own link: the second run re-reads the eight
  // nearest today. Sitting 495 holds the notice page, so the page is read
  // once for it and for none of the seven sittings that share it.
  requested.length = 0;
  await retrieveAgendas(meetings);
  assert.equal(requested.length, 8);
  assert.equal(new Set(requested).size, requested.length, "one run read a link twice");
  assert.ok(!requested.includes(`${ACTIONS}07-14-2026R(1).pdf`), "the farthest re-read was preferred to a nearer one");
});

test("a vendor-host link read through its portal page ranks as read once the sitting holds the portal's link", () => {
  const API = "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf";
  const DETAIL = "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
  const PORTAL_AGENDA = "https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=00EFD752-6A28-42D3-B329-E717E49891D0&G=7B470E9E-E35C-4698-8FA6-D778FB28F394";
  const PIMA = "ocd-division/country:us/state:az/county:pima";
  const pima: Meeting = {
    ...sitting("legistar:pima:1828", "2026-09-22T17:00:00-07:00", API, PIMA),
    provenance: { sourceUrl: DETAIL, sourceOrg: "Pima County Clerk", collectedAt: "2026-09-24T00:00:00Z", verifiedAt: null },
  };
  const unread = sitting("legistar:pima:1829", "2026-10-06T17:00:00-07:00", "https://example.gov/agendas/1829", PIMA);
  const store = new AgendaDocumentStore();
  assert.deepEqual(agendaRetrievalOrder([pima, unread], Date.parse(NOW), store).map(({ id }) => id),
    ["legistar:pima:1828", "legistar:pima:1829"], "an unread portal-routed sitting does not compete as unread");
  store.append(version(pima.id, PORTAL_AGENDA, "1. Call to order. 2. Minutes.", "2026-09-24T11:14:00.000Z", PIMA));
  assert.deepEqual(agendaRetrievalOrder([pima, unread], Date.parse(NOW), store).map(({ id }) => id),
    ["legistar:pima:1829", "legistar:pima:1828"], "a portal-routed sitting holding its portal agenda does not rank as unread");
  // A sitting holding the vendor's own file has been read too.
  const vendorHeld = new AgendaDocumentStore();
  vendorHeld.append(version(pima.id, API, "1. Call to order. 2. Minutes.", "2026-09-25T11:14:00.000Z", PIMA));
  assert.deepEqual(agendaRetrievalOrder([pima, unread], Date.parse(NOW), vendorHeld).map(({ id }) => id),
    ["legistar:pima:1829", "legistar:pima:1828"], "a sitting holding the vendor's file does not rank as unread");
});
