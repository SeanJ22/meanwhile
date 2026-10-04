/**
 * **HOLBROOK'S CITY COUNCIL, FROM THE CITY'S OWN AGENDAS-AND-MINUTES PAGE.**
 * (2026-09-25.)
 *
 * The City of Holbrook, AZ publishes its council's sittings on its own site,
 * one page per year, one link per agenda and per set of minutes, each labelled
 * with the sitting's kind and date. Its discovered iCal feed stays held
 * (local times stored as UTC, no council meeting in it); this is the route
 * that reaches readers instead.
 *
 * No live calls: `tests/fixtures/holbrook/` holds the recorded page and the
 * robots.txt it was read under (retrieval.json says when and how).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { WEBSITE_CORRECTIONS } from "../lib/civic-data/website-corrections.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { POST_FIXTURE_MEETING_PARTITIONS } from "./helpers/meeting-partition-fixture.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import {
  datedLabel,
  listedDocuments,
  listedSittings,
  makeDocumentListingSource,
  minutesLabel,
  yearsToRead,
  type DocumentListingRaw,
} from "../lib/sources/document-listing/index.ts";

const FIXTURES = join(import.meta.dirname, "fixtures", "holbrook");
const PAGE_2026 = readFileSync(join(FIXTURES, "council-2026-agendas-minutes.html"), "utf8");
const ROBOTS = readFileSync(join(FIXTURES, "robots.txt"), "utf8");
const URL_2026 = "https://holbrookaz.gov/government/council-agenda/2026-agendas-minutes/";
const URL_2027 = "https://holbrookaz.gov/government/council-agenda/2027-agendas-minutes/";
const WIRING = SOURCE_WIRING.find((row) => row.agendaSourceType === "DOCUMENT_LISTING" && row.config.slug === "holbrook-city-council")!;
const READ_AT = "2026-09-25T17:46:24.000Z";
/** The clock a fetch picks "this year's" required page by, fixed so the test cannot rot. */
const SEPT_25 = () => new Date("2026-09-25T18:00:00Z");
const drive = (id: string) => `https://drive.google.com/file/d/${id}/view?usp=sharing`;

function raw(pages = [{ year: 2026, url: URL_2026, html: PAGE_2026 }]): DocumentListingRaw {
  return { wiring: WIRING, pages, notPosted: [], unread: [], collectedAt: READ_AT };
}

test("HOLBROOK · the wired body is Holbrook's registered governing body, on the city's reviewed site, in its own partition", () => {
  assert.ok(WIRING, "a DOCUMENT_LISTING row for Holbrook's council");
  assert.equal(WIRING.bodyId, "ocd-division/country:us/state:az/place:holbrook#governing");
  assert.equal(WIRING.ocdId, "ocd-division/country:us/state:az/place:holbrook");
  assert.equal(WIRING.timeZone, "America/Phoenix");
  const correction = WEBSITE_CORRECTIONS.find((c) => c.jurisdictionId === "az:city:city-of-holbrook")!;
  assert.equal(new URL(correction.corrected).hostname, WIRING.config.officialHost, "the registry's reviewed website is the host read");
  const partition = meetingPartitionForRow("document-listing", WIRING.bodyId);
  assert.equal(partition.acquisitionFailureDomain, "meeting-upstream:holbrookaz.gov");
  assert.ok(POST_FIXTURE_MEETING_PARTITIONS.includes(partition.id), "named as registered after the frozen import");
  for (const url of ["https://holbrookaz.gov/robots.txt", URL_2026, URL_2027]) {
    assert.equal(authorityFor("meetings-public-bodies", "MEETING", url).ok, true, url);
  }
  assert.equal(authorityFor("meetings-public-bodies", "MEETING", "https://holbrookaz.gov/departments/").ok, false,
    "authority is the council-agenda path, not the whole host");
});

test("HOLBROOK · every agenda and minutes link on the 2026 page is read as the sitting its label names", () => {
  const docs = listedDocuments(PAGE_2026, URL_2026);
  const { sittings, counts } = listedSittings(docs, { sittingKinds: ["Regular Meeting", "Special Meeting", "Work Session"], agendaHeading: "Agendas", minutesHeading: "Minutes" });
  assert.deepEqual(counts, { documents: 38, folded: 19, unattached: 0, undated: 0 });
  assert.equal(sittings.length, 19);
  assert.deepEqual(sittings.map((s) => `${s.date} ${s.kind}`), [
    "2026-01-14 Regular Meeting", "2026-02-11 Regular Meeting", "2026-03-11 Regular Meeting", "2026-03-25 Work Session",
    "2026-04-08 Regular Meeting", "2026-04-22 Special Meeting", "2026-04-22 Work Session", "2026-05-13 Regular Meeting",
    "2026-05-13 Work Session", "2026-05-27 Special Meeting", "2026-05-27 Work Session", "2026-06-10 Regular Meeting",
    "2026-06-24 Special Meeting", "2026-06-24 Work Session", "2026-07-08 Regular Meeting", "2026-07-22 Special Meeting",
    "2026-07-28 Special Meeting", "2026-08-12 Regular Meeting", "2026-09-09 Regular Meeting",
  ]);
  // Two sittings on one date are two sittings, each with its own agenda.
  const april22 = sittings.filter((s) => s.date === "2026-04-22");
  assert.deepEqual(april22.map((s) => s.agenda), [drive("1-1jr3IiX6QjCgQeBN3QIdxTBGRXmJEsP"), drive("1pvTrANP5K5id161Ykx7qrKmZhTBqXA7T")]);
  assert.ok(sittings.every((s) => s.agenda !== null && s.time === null && !s.canceled));
  // A two-digit year is this century's: "Work Session 03-25-26".
  assert.equal(sittings.find((s) => s.kind === "Work Session" && s.date === "2026-03-25")?.agenda, drive("1ourPpgghFKPZOahkrA70uV-ew5KzraVK"));
  // The Statement of Legal Action is a document of the 9 September sitting, never a sitting.
  const sept9 = sittings.find((s) => s.date === "2026-09-09")!;
  assert.deepEqual(sept9.links, [{ label: "Statement of Legal Action", href: drive("1YDL1CjG9gsrTcvroPt1fLAW_hFvdTiuY") }]);
});

test("HOLBROOK · in-window sittings reach readers date-only, each citing its own agenda, with no time or place invented", () => {
  const source = makeDocumentListingSource([WIRING]);
  const { meetings, drops, accounting } = source.normalizeWithDrops([raw()], new Date("2026-09-25T18:00:00Z"));
  assert.equal(accounting.outcome, "CONSERVED");
  // DB-05 (2026-10-04): the adapter holds 120 days, so the three sittings of 10 and 24 June (between 90 and 120 days back) are in.
  assert.deepEqual(meetings.map((m) => m.id), [
    "document-listing:holbrook-city-council:2026-06-10:regular-meeting",
    "document-listing:holbrook-city-council:2026-06-24:special-meeting",
    "document-listing:holbrook-city-council:2026-06-24:work-session",
    "document-listing:holbrook-city-council:2026-07-08:regular-meeting",
    "document-listing:holbrook-city-council:2026-07-22:special-meeting",
    "document-listing:holbrook-city-council:2026-07-28:special-meeting",
    "document-listing:holbrook-city-council:2026-08-12:regular-meeting",
    "document-listing:holbrook-city-council:2026-09-09:regular-meeting",
  ]);
  for (const m of meetings) {
    assert.equal(m.bodyId, WIRING.bodyId);
    assert.equal(m.bodyName, "City Council");
    assert.equal(m.startPrecision, "DAY", "the page states no hour, so none is claimed");
    assert.match(m.startsAt, /T00:00:00-07:00$/, "local midnight as an ordering artifact only");
    assert.equal(m.location, null);
    assert.equal(m.venueGap, undefined, "our own place-not-recorded gap");
    assert.equal(m.online, undefined, "never online");
    assert.equal(m.status, "CONCLUDED");
    assert.equal(m.provenance.sourceUrl, URL_2026);
    assert.equal(m.provenance.sourceOrg, "City of Holbrook");
    assert.ok(m.agendaUrl?.startsWith("https://drive.google.com/file/d/"));
  }
  const sept9 = meetings.at(-1)!;
  assert.equal(sept9.title, "Regular Meeting");
  assert.equal(sept9.agendaUrl, drive("1M_HnC-Qbg9Pm9Jp1ohE99fq5-37-9zFD"));
  assert.deepEqual(sept9.publishedLinks, [{ label: "Statement of Legal Action", href: drive("1YDL1CjG9gsrTcvroPt1fLAW_hFvdTiuY") }]);
  assert.equal(sept9.provenance.evidenceExcerpt, "Agendas: Regular Meeting 9-9-2026 | Minutes: Statement of Legal Action 9-9-2026");
  const aug12 = meetings.find((m) => m.id.endsWith(":2026-08-12:regular-meeting"))!;
  assert.deepEqual(aug12.publishedLinks, [{ label: "Minutes (not marked draft or approved)", href: drive("1wPZOYCFD89mSjHLnulf4t-rkC4PdVJSR") }]);
  assert.equal(drops.unknownVenue, 8);
});

test("HOLBROOK · a sitting whose agenda is posted is upcoming until its day ends; two on one day stay two", () => {
  const { meetings } = makeDocumentListingSource([WIRING]).normalizeWithDrops([raw()], new Date("2026-05-27T15:00:00Z"));
  const may27 = meetings.filter((m) => m.startsAt.startsWith("2026-05-27"));
  assert.deepEqual(may27.map((m) => [m.title, m.status]), [["Special Meeting", "SCHEDULED"], ["Work Session", "SCHEDULED"]]);
  assert.notEqual(may27[0].agendaUrl, may27[1].agendaUrl);
  const may13 = meetings.filter((m) => m.startsAt.startsWith("2026-05-13"));
  assert.ok(may13.every((m) => m.status === "CONCLUDED"));
});

test("HOLBROOK · labels: dates as a clerk writes them, minutes labelled only in the city's own words", () => {
  assert.deepEqual(datedLabel("Regular Meeting 01-14-2026"), { kind: "Regular Meeting", date: "2026-01-14", time: null });
  assert.deepEqual(datedLabel("Work Session 03-25-26"), { kind: "Work Session", date: "2026-03-25", time: null });
  assert.deepEqual(datedLabel("Regular Meeting 10-14-2026 6:00 PM"), { kind: "Regular Meeting", date: "2026-10-14", time: { hour: 18, minute: 0 } });
  assert.deepEqual(datedLabel("Special Meeting 2-30-2026"), { kind: "Special Meeting", date: null }, "not a real date: counted, never rolled");
  assert.equal(datedLabel("City Code"), null);
  assert.equal(minutesLabel("Regular Meeting 9-9-2026 DRAFT", "Minutes"), "Minutes (draft)");
  assert.equal(minutesLabel("Regular Meeting 9-9-2026", "Approved Minutes"), "Minutes (approved)");
  assert.equal(minutesLabel("Regular Meeting 9-9-2026", "Minutes"), "Minutes (not marked draft or approved)");

  // A sitting the page lists only by its minutes, in a section that carries an
  // agendas heading, is the publisher's agenda slot observed empty.
  const html = `<details><summary><div class="t">October</div></summary><h2>Agendas</h2><p><a href="/a.pdf">Special Meeting 10-21-2026</a></p>` +
    `<h2>Minutes</h2><p><a href="/m.pdf">Regular Meeting 10-14-2026 (Draft)</a></p><p><a href="/x.pdf">Budget Workshop 10-30-2026</a></p></details>`;
  const { sittings, counts } = listedSittings(listedDocuments(html, "https://t.gov/2026/"), { sittingKinds: ["Regular Meeting", "Special Meeting"], agendaHeading: "Agendas", minutesHeading: "Minutes" });
  assert.deepEqual(counts, { documents: 3, folded: 0, unattached: 1, undated: 0 }, "a dated document of another kind with no sitting that day is counted, not placed");
  const oct14 = sittings.find((s) => s.date === "2026-10-14")!;
  assert.equal(oct14.kind, "Regular Meeting", "the clerk's \"(Draft)\" is the document's qualifier, not the sitting's kind");
  assert.equal(oct14.agenda, null);
  assert.equal(oct14.agendaSlotEmpty, true);
  assert.deepEqual(oct14.links, [{ label: "Minutes (draft)", href: "https://t.gov/m.pdf" }]);
  assert.equal(sittings.find((s) => s.date === "2026-10-21")?.agendaSlotEmpty, false);
  assert.deepEqual(datedLabel("CANCELLED - Special Meeting 11-04-2026"), { kind: "Special Meeting", date: "2026-11-04", time: null });
});

test("HOLBROOK · the serving window's years are read; next year's missing page is the city not having posted it", async () => {
  // 120 days ahead of 25 September reaches 23 January, so the held window already reads next year's page.
  assert.deepEqual(yearsToRead({ now: new Date("2026-09-25T18:00:00Z") }), { years: [2026, 2027], required: 2026 });
  assert.deepEqual(yearsToRead({ now: new Date("2026-08-25T18:00:00Z") }), { years: [2026], required: 2026 });
  assert.deepEqual(yearsToRead({ now: new Date("2027-01-10T18:00:00Z") }), { years: [2026, 2027], required: 2027 });

  const requested: string[] = [];
  const served = (status2027: number): typeof fetch => (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url === "https://holbrookaz.gov/robots.txt") return new Response(ROBOTS, { status: 200, headers: { "content-type": "text/plain" } });
    if (url === URL_2026) return new Response(PAGE_2026, { status: 200, headers: { "content-type": "text/html" } });
    if (url === URL_2027) return new Response("<html><body>Page not found</body></html>", { status: status2027, headers: { "content-type": "text/html" } });
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;

  const notYet = await makeDocumentListingSource([WIRING], served(404), SEPT_25).fetch({ lat: 34.9, lng: -110.16, radiusKm: 25, startsAfter: "2026-06-27T00:00:00Z", startsBefore: "2027-01-23T00:00:00Z" });
  assert.equal(notYet.length, 1);
  assert.equal(notYet[0].error, undefined);
  assert.deepEqual(notYet[0].pages.map((p) => p.year), [2026]);
  assert.deepEqual(notYet[0].notPosted, [{ year: 2027, url: URL_2027 }]);
  assert.deepEqual(notYet[0].unread, []);
  assert.equal(requested[0], "https://holbrookaz.gov/robots.txt", "permission is asked before the first page");
  assert.equal(requested.filter((u) => u.endsWith("/robots.txt")).length, 1, "once per origin");

  const refused = await makeDocumentListingSource([WIRING], served(403), SEPT_25).fetch({ lat: 34.9, lng: -110.16, radiusKm: 25, startsAfter: "2026-06-27T00:00:00Z", startsBefore: "2027-01-23T00:00:00Z" });
  assert.deepEqual(refused[0].unread.map((u) => [u.year, u.scope]), [[2027, "UPCOMING"]]);
  const { partialScopes } = makeDocumentListingSource([WIRING]).normalizeWithDrops(refused, new Date("2026-09-25T18:00:00Z"));
  assert.deepEqual(partialScopes?.map((p) => [p.scope, p.ocdIds]), [["UPCOMING", [WIRING.ocdId]]], "a partial read is said to be one");
});

test("HOLBROOK · the current year's page failing is the row failing, never an empty council", async () => {
  const gone: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/robots.txt")) return new Response(ROBOTS, { status: 200, headers: { "content-type": "text/plain" } });
    return new Response("<html><body>Page not found</body></html>", { status: 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  await assert.rejects(
    () => makeDocumentListingSource([WIRING], gone, SEPT_25).fetch({ lat: 34.9, lng: -110.16, radiusKm: 25, startsAfter: "2026-06-27T00:00:00Z", startsBefore: "2027-01-23T00:00:00Z" }),
    /HTTP 404/,
  );
  /* A Disallow is recorded and never stops the read (owner decision 2026-09-25): the page's own 404 is what fails the row. */
  const disallowedAsked: string[] = [];
  const disallowed: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    disallowedAsked.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /government/\n", { status: 200, headers: { "content-type": "text/plain" } });
    return new Response("<html><body>Page not found</body></html>", { status: 404, headers: { "content-type": "text/html" } });
  }) as typeof fetch;
  await assert.rejects(
    () => makeDocumentListingSource([WIRING], disallowed, SEPT_25).fetch({ lat: 34.9, lng: -110.16, radiusKm: 25 }),
    /HTTP 404/,
  );
  assert.ok(disallowedAsked[0]?.endsWith("/robots.txt") && disallowedAsked.length > 1, "the rules are read first, and the disallowed page is still requested");
  const failed: DocumentListingRaw = { ...raw([]), error: "HTTP 404" };
  const { meetings, unreachableOcdIds, accounting } = makeDocumentListingSource([WIRING]).normalizeWithDrops([failed], new Date("2026-09-25T18:00:00Z"));
  assert.deepEqual(meetings, []);
  assert.deepEqual(unreachableOcdIds, [WIRING.ocdId]);
  assert.equal(accounting.outcome, "CONSERVED");
});
