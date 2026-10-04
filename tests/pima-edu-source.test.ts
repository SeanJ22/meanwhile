import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { extractPdfText } from "../lib/meetings/agenda-documents.ts";
import {
  kindOf,
  makePimaEduSource,
  mergeSittings,
  parseAgendaHeader,
  parseCommitteeDocuments,
  parseCommitteeSchedule,
  parseDocumentsPage,
  parseEventListing,
  parseEventPage,
  type PimaEduRaw,
} from "../lib/sources/pima-edu/index.ts";
import { makePermissionGate, permittedText } from "../lib/sources/permission-gate.ts";
import { SOURCE_WIRING, type BodySourceWiring } from "../lib/registry/source-wiring.ts";

/**
 * Pima Community College's Governing Board, read from the college's OWN
 * permitted pages instead of its robots-disallowed Diligent tenant — against
 * responses recorded 2026-09-23 (tests/fixtures/pima-edu/retrieval.json names
 * each URL, instant, status, byte count and sha256). No live calls.
 *
 * The floors below are counts of what the recorded pages contain, so a parser
 * that returns [] on the real markup fails loudly rather than reporting an
 * empty board.
 */

const FIXTURES = join(import.meta.dirname, "fixtures", "pima-edu");
const read = (name: string) => readFileSync(join(FIXTURES, name), "utf8");
const RETRIEVAL = JSON.parse(read("retrieval.json")) as Record<string, { url: string }>;
const urlOf = (name: string) => RETRIEVAL[name].url;

const WIRING = SOURCE_WIRING.find((row) => row.bodyId === "curated:az/pima-community-college#governing")!;
// Inside the recording's coverage: Aug 10 is 44 days back, Dec 11 is 79 days ahead.
const NOW = new Date("2026-09-23T13:00:00-07:00");

async function recordedRaw(): Promise<PimaEduRaw> {
  const pdf = new Uint8Array(readFileSync(join(FIXTURES, "agenda-2026-08-10.pdf")));
  return {
    wiring: WIRING,
    collectedAt: "2026-09-23T20:05:00.000Z",
    documents: { url: urlOf("documents-2026.html"), html: read("documents-2026.html") },
    events: { url: urlOf("events-board-listing.html"), html: read("events-board-listing.html") },
    // Three of the eight upcoming event pages were recorded; the other five
    // exercise the teaser-only path (time and building from the listing).
    eventPages: [
      "event-2026-09-25-executive-session.html",
      "event-2026-09-25-regular.html",
      "event-2026-10-29-study-session.html",
    ].map((name) => ({ url: urlOf(name), html: read(name) })),
    committeeSchedule: { url: urlOf("finance-audit-committee.html"), html: read("finance-audit-committee.html") },
    committeeDocuments: {
      url: urlOf("finance-audit-agendas-minutes.html"),
      html: read("finance-audit-agendas-minutes.html"),
    },
    agendaPdfs: [{ url: urlOf("agenda-2026-08-10.pdf"), text: await extractPdfText(pdf) }],
  };
}

test("the wiring row reads permitted pima.edu hosts and never the Diligent tenant", () => {
  assert.ok(WIRING, "PCC's wiring row is missing");
  assert.equal(WIRING.agendaSourceType, "PIMA_EDU");
  for (const [key, value] of Object.entries(WIRING.config)) {
    if (!/^https?:/.test(value)) continue;
    const host = new URL(value).host;
    assert.ok(host === "www.pima.edu" || host === "events.pima.edu", `${key} names ${host}`);
  }
  assert.ok(
    !SOURCE_WIRING.some((row) =>
      Object.values(row.config).some((v) => /pima\.community\.highbond\.com/.test(v)),
    ),
    "a wiring row still names the retired Diligent tenant",
  );
});

test("the documents page parses every 2026 sitting row, month notes counted apart", () => {
  const page = parseDocumentsPage(read("documents-2026.html"), urlOf("documents-2026.html"));
  assert.equal(page.year, 2026);
  assert.equal(page.rows.length, 28, `${page.rows.length} sitting rows`);
  assert.equal(page.monthNotes, 2, "December and July carry NO REGULAR BOARD MEETING");
  assert.equal(page.unparsed, 0);

  const aug10 = page.rows.find((r) => r.date.m === 8 && r.date.d === 10)!;
  assert.equal(aug10.kind, "study-session");
  assert.equal(aug10.mode, "Hybrid");
  assert.equal(
    aug10.agendaHref,
    "https://www.pima.edu/about-pima/leadership-policies/governing-board/board-meetings/agendas-docs-2026/0810.pdf",
  );
  assert.match(aug10.approvedItemsHref ?? "", /august10-board-meeting-approved-items\.pdf$/);

  const sep25 = page.rows.filter((r) => r.date.m === 9 && r.date.d === 25);
  assert.deepEqual(sep25.map((r) => r.kind).sort(), ["executive-session", "regular"]);
  assert.match(sep25.find((r) => r.kind === "regular")!.agendaHref!, /MeetingInformation\.aspx\?Org=Cal&Id=705$/);

  // Future rows name an agenda cell with no link yet.
  const oct29 = page.rows.find((r) => r.date.m === 10 && r.date.d === 29)!;
  assert.equal(oct29.agendaHref, null);
  assert.equal(oct29.agendaNamed, true);
});

test("the events listing yields the board's eight upcoming sittings with times", () => {
  const teasers = parseEventListing(read("events-board-listing.html"), urlOf("events-board-listing.html"));
  assert.equal(teasers.length, 8);
  const exec = teasers.find((t) => t.date.m === 9 && t.date.d === 25 && kindOf(t.title) === "executive-session")!;
  assert.equal(exec.timeText, "4:15 pm - 5:00 pm");
  assert.equal(exec.locationText, "District Office");
  assert.match(exec.href, /^https:\/\/events\.pima\.edu\/events\/board-special-meeting-conduct-executive-session-18\?date=2026-09-25$/);
});

test("an event page states start, end and room as data in its own calendar link", () => {
  const exec = parseEventPage(read("event-2026-09-25-executive-session.html"))!;
  assert.deepEqual(exec.start, { date: { y: 2026, m: 9, d: 25 }, h: 16, mi: 15 });
  assert.equal(exec.location, "District Office C-228");
  const regular = parseEventPage(read("event-2026-09-25-regular.html"))!;
  assert.deepEqual(regular.start, { date: { y: 2026, m: 9, d: 25 }, h: 17, mi: 30 });
  assert.equal(regular.location, "District Office Community/Board Room, C-105");
});

test("the committee's schedule and document table parse", () => {
  const schedule = parseCommitteeSchedule(read("finance-audit-committee.html"));
  assert.equal(schedule.length, 6);
  assert.deepEqual(schedule[0], { date: { y: 2026, m: 8, d: 28 }, timeText: "9:00am", location: "Zoom Webinar" });
  const documents = parseCommitteeDocuments(read("finance-audit-agendas-minutes.html"), urlOf("finance-audit-agendas-minutes.html"));
  const aug28 = documents.find((d) => d.date.y === 2026 && d.date.m === 8 && d.date.d === 28)!;
  assert.match(aug28.agendaHref!, /Id=698$/);
  assert.match(aug28.approvedItemsHref!, /2026\.08\.28-finance-and-audit-committee-meeting-approved-agenda-items\.pdf$/);
});

test("a first-party agenda's header places its OWN sitting and ignores a later date it mentions", async () => {
  const text = await extractPdfText(new Uint8Array(readFileSync(join(FIXTURES, "agenda-2026-08-10.pdf"))));
  assert.deepEqual(parseAgendaHeader(text, { y: 2026, m: 8, d: 10 }), { h: 17, mi: 0, location: "VIRTUAL MEETING" });
  // Item 2.3 names September 14, 2026; that is not this agenda's sitting.
  assert.equal(parseAgendaHeader(text, { y: 2026, m: 9, d: 14 }), null);
});

test("normalize: every Diligent sitting in the window is re-found, conserved, with cited places", async () => {
  const raw = await recordedRaw();
  const merged = mergeSittings(raw);
  assert.equal(merged.logicalRecords, 34, "28 board rows and 6 committee rows");

  const source = makePimaEduSource([WIRING]);
  const { meetings, drops, accounting } = source.normalizeWithDrops([raw], NOW);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.equal(meetings.length, 12, meetings.map((m) => m.id).join(", "));
  assert.equal(drops.unknownVenue, 0);
  // DB-05: the held 120-day window reaches three more sittings (90 to 120 days out) that the college's pages date but
  // state no time for; they are counted as unplaceable in time, never guessed (they were out of the window: 22 then).
  assert.equal(drops.unplaceableInTime, 3);
  assert.equal(accounting.outOfWindow, 19);

  const byId = new Map(meetings.map((m) => [m.id, m]));
  // The seven sittings production held from the disallowed tenant (Diligent
  // ids 706, 698, 705, 707, 708, 699, 700), each on the college's own pages:
  const heldEquivalents = [
    ["pima-edu:pcc:2026-08-10-study-session", "2026-08-10T17:00:00-07:00"],
    ["pima-edu:pcc:2026-08-28-committee", "2026-08-28T09:00:00-07:00"],
    ["pima-edu:pcc:2026-09-25-regular", "2026-09-25T17:30:00-07:00"],
    ["pima-edu:pcc:2026-09-25-executive-session", "2026-09-25T16:15:00-07:00"],
    ["pima-edu:pcc:2026-10-14-regular", "2026-10-14T17:30:00-07:00"],
    ["pima-edu:pcc:2026-10-16-committee", "2026-10-16T09:00:00-07:00"],
    ["pima-edu:pcc:2026-12-11-committee", "2026-12-11T09:00:00-07:00"],
  ] as const;
  for (const [id, startsAt] of heldEquivalents) {
    const m = byId.get(id);
    assert.ok(m, `${id} missing`);
    assert.equal(Date.parse(m!.startsAt), Date.parse(startsAt), id);
    assert.equal(m!.bodyId, WIRING.bodyId);
    assert.equal(m!.ocdId, null);
  }

  // The study session's own agenda says VIRTUAL MEETING, and it is kept with no place.
  const aug10 = byId.get("pima-edu:pcc:2026-08-10-study-session")!;
  assert.equal(aug10.location, null);
  assert.deepEqual(aug10.online, { label: "VIRTUAL MEETING", joinUrl: null });
  assert.match(aug10.agendaUrl!, /^https:\/\/www\.pima\.edu\/.*\/0810\.pdf$/);
  assert.equal(aug10.status, "CONCLUDED");

  // Rooms resolve through the reviewed District Office venue rows.
  assert.equal(byId.get("pima-edu:pcc:2026-09-25-executive-session")!.location!.name, "PCC District Office, Board Conference Room C-228");
  assert.equal(byId.get("pima-edu:pcc:2026-09-25-regular")!.location!.name, "PCC District Office, Community/Board Room C-105");
  assert.equal(byId.get("pima-edu:pcc:2026-10-29-study-session")!.location!.name, "PCC District Office, Community/Board Room C-105");
  // A teaser with no recorded event page falls back to the building it prints.
  assert.equal(byId.get("pima-edu:pcc:2026-11-04-regular")!.location!.name, "PCC District Office");

  // The committee meets on Zoom: kept, placeless, never pinned.
  const aug28 = byId.get("pima-edu:pcc:2026-08-28-committee")!;
  assert.equal(aug28.bodyName, "Finance and Audit Committee");
  assert.deepEqual(aug28.online, { label: "Zoom Webinar", joinUrl: null });
  assert.match(aug28.agendaUrl!, /Id=698$/, "the college's own link into its agenda platform is carried as a link");

  // Nothing claims the publisher left a slot empty (the page mirrors, and can lag, the platform).
  for (const m of meetings) assert.equal(m.agendaSlotObservedEmpty, undefined, m.id);
  // Provenance names a page the record was read from, on a permitted host.
  for (const m of meetings) {
    const host = new URL(m.provenance.sourceUrl!).host;
    assert.ok(host === "www.pima.edu" || host === "events.pima.edu", `${m.id} cites ${host}`);
  }
});

test("a place nothing sitting-specific states drops the sitting, counted, never guessed", async () => {
  const raw = await recordedRaw();
  const doctored = { ...raw, agendaPdfs: [] };
  const source = makePimaEduSource([WIRING]);
  const { meetings, drops, accounting } = source.normalizeWithDrops([doctored], NOW);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.ok(!meetings.some((m) => m.id === "pima-edu:pcc:2026-08-10-study-session"));
  assert.equal(drops.unplaceableInTime, 4, "the Aug 10 sitting has no statement of its time without its agenda, nor do the three the held window reaches (DB-05)");
});

test("the permission gate reads robots.txt first, records a disallow, and still reads the public page (owner decision 2026-09-25)", async () => {
  const requested: string[] = [];
  const fake: typeof fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    const headers = new Headers(init?.headers);
    assert.equal(headers.has("authorization") || headers.has("cookie"), false, "no credential or cookie is ever sent");
    if (url.endsWith("/robots.txt")) {
      return new Response("User-agent: *\nDisallow: /\n", { status: 200, headers: { "content-type": "text/plain" } });
    }
    return new Response("<html><h1>Governing Board</h1></html>", { status: 200, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  const gate = makePermissionGate({ fetchImpl: fake });
  const html = await permittedText(gate, urlOf("documents-2026.html"), { fetchImpl: fake });
  assert.match(html, /Governing Board/, "robots.txt alone never blocks a public page");
  assert.deepEqual(requested, ["https://www.pima.edu/robots.txt", urlOf("documents-2026.html")], "the rules first, then the page");
  const [recorded] = gate.readings();
  assert.equal(recorded?.reading.verdict, "DISALLOWED", "the disallow is recorded");
  assert.equal(recorded?.reading.matchedRule, "Disallow: /");
});

test("the gate reads robots once per origin and admits a permitted path", async () => {
  let robotsReads = 0;
  const fake: typeof fetch = (async (input: string | URL | Request) => {
    if (String(input).endsWith("/robots.txt")) {
      robotsReads += 1;
      return new Response(read("robots-www.pima.edu.txt"), { status: 200, headers: { "content-type": "text/plain" } });
    }
    throw new Error("the gate must not fetch the page itself");
  }) as typeof fetch;
  const gate = makePermissionGate({ fetchImpl: fake });
  const a = await gate.assertPermitted(urlOf("documents-2026.html"));
  const b = await gate.assertPermitted(urlOf("agenda-2026-08-10.pdf"));
  assert.equal(a.verdict, "ALLOWED");
  assert.equal(b.verdict, "ALLOWED");
  assert.equal(robotsReads, 1);
  const secure = await gate.assertPermitted("https://www.pima.edu/secure/x.html");
  assert.equal(secure.verdict, "DISALLOWED", "a disallowed path is recorded as such, and resolves: robots.txt is recorded, not blocking");
  assert.equal(robotsReads, 1, "still one read of the origin's rules");
});

test("the wiring type is a registered agenda-source type (BodySourceWiring compiles)", () => {
  const row: BodySourceWiring = { ...WIRING };
  assert.equal(row.config.slug, "pcc");
});
