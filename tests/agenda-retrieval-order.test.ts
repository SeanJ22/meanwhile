import { withSourceTransport } from "./helpers/source-fetch.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

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
  retrieveMeetingDocuments,
  seedHeldAgendaDocuments,
} from "../scripts/ingest.ts";

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
      inRetrievalOrder(reconciled.agendaDocuments).map(({ id }) => id),
      "the written rows are not in read order",
    );
    assert.deepEqual(new Set(reconciled.agendaDocuments.map(({ id }) => id)), new Set(held167.map(({ id }) => id)),
      "the re-check must preserve every historical version identity");
    assert.equal(reconciled.agendaDocuments.at(-1)?.retrievedAt, at, "the unchanged content carries its actual last check");
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

test("hot sittings precede older missing links and cold sittings follow by proximity", () => {
  const meetings = tucsonUnified("", new AgendaDocumentStore());
  const order = agendaRetrievalOrder(meetings, Date.parse(NOW)).map(({ id }) => id);
  assert.equal(order[0], "diligent:tusd1:499");
  assert.ok(order.indexOf("diligent:tusd1:502") < order.indexOf(boardActions[0]![0]));
  assert.ok(order.indexOf(boardActions[0]![0]) < order.indexOf(boardActions.at(-1)![0]));
});

test("one bounded turn reads each URL once and resumes only remaining due documents", async () => {
  const meetings = tucsonUnified("run:", agendaDocumentStore);
  const requested: string[] = [];
  const transport = (async (input: RequestInfo | URL) => {
    requested.push(String(input));
    return String(input).endsWith(".pdf")
      ? new Response(new Uint8Array(readFileSync("tests/fixtures/tusd-govboard/board-actions-2026-09-22.pdf")), { headers: { "content-type": "application/pdf" } })
      : new Response("<main><p>1. Call to order and public hearing.</p></main>", { headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const first = await withSourceTransport(transport, () => retrieveMeetingDocuments(meetings, { now: () => Date.parse(NOW), maxUrls: 3 }));
  assert.equal(requested.length, 3);
  assert.equal(new Set(requested).size, 3);
  assert.equal(requested[0], `${ACTIONS}09-22-2026S.pdf`);
  const before = new Set(requested);
  requested.length = 0;
  await withSourceTransport(transport, () => retrieveMeetingDocuments(meetings, { previous: first, now: () => Date.parse(NOW), maxUrls: 3 }));
  assert.equal(requested.length, 3);
  assert.ok(requested.every(url => !before.has(url)));
});
