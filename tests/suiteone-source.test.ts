/**
 * A city council from the city's SuiteOne media portal, whose home page is
 * server-rendered. No live calls: `tests/fixtures/winslow/suiteone-web.html` is
 * the recorded home page (retrieval.json says when and how).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { meetingPartitionForRow } from "../lib/civic-data/meeting-partitions.ts";
import { POST_FIXTURE_MEETING_PARTITIONS } from "./helpers/meeting-partition-fixture.ts";
import { SOURCE_WIRING } from "../lib/registry/source-wiring.ts";
import {
  makeSuiteOneSource,
  portalRows,
  printedWallClock,
  ticksWallClock,
  type SuiteOneRaw,
} from "../lib/sources/suiteone/index.ts";

const HTML = readFileSync(join(import.meta.dirname, "fixtures", "winslow", "suiteone-web.html"), "utf8");
const PORTAL = "https://winslowaz.suiteonemedia.com/?embed=1";
const WIRING = SOURCE_WIRING.find((row) => row.agendaSourceType === "SUITEONE" && row.config.slug === "winslow-city-council")!;
const READ_AT = "2026-09-25T17:51:59.000Z";
const NOW = new Date("2026-09-25T18:00:00Z");
const at = (path: string) => `https://winslowaz.suiteonemedia.com${path}`;

function raw(html = HTML): SuiteOneRaw {
  return { wiring: WIRING, html, collectedAt: READ_AT };
}

test("WINSLOW · the wired body is Winslow's registered governing body, read from its portal in its own partition", () => {
  assert.ok(WIRING, "a SUITEONE row for Winslow's council");
  assert.equal(WIRING.bodyId, "ocd-division/country:us/state:az/place:winslow#governing");
  assert.equal(WIRING.timeZone, "America/Phoenix");
  const partition = meetingPartitionForRow("suiteone", WIRING.bodyId);
  assert.equal(partition.acquisitionFailureDomain, "meeting-upstream:winslowaz.suiteonemedia.com");
  assert.ok(POST_FIXTURE_MEETING_PARTITIONS.includes(partition.id), "named as registered after the frozen import");
  assert.equal(authorityFor("meetings-public-bodies", "MEETING", PORTAL).ok, true);
  assert.equal(authorityFor("meetings-public-bodies", "MEETING", at("/Account/LoadLoginModal")).ok, false,
    "authority is the one page read, not the whole tenant");
});

test("WINSLOW · the portal's two lists are read as printed, and each panel's own count is met", () => {
  const { upcoming, groups } = portalRows(HTML, PORTAL);
  assert.equal(upcoming.length, 10, "the next ten meetings of every body");
  const counts = Object.fromEntries([...groups].map(([name, g]) => [name, [g.rows.length, g.declared]]));
  assert.deepEqual(counts, {
    "Airport Commission": [21, 21],
    "Arts Council": [32, 32],
    "Board of Adjustment": [6, 6],
    "City Council": [50, 50],
    "Historic Preservation Commission": [21, 21],
    "Housing Authority": [8, 8],
    "Planning & Zoning": [21, 21],
    "Public Safety Police & Fire Personnel Retirement Board": [2, 2],
  });
  const sept22 = groups.get("City Council")!.rows.find((r) => r.eventId === "1520")!;
  assert.deepEqual(sept22, {
    eventId: "1520",
    title: "City Council Regular Meeting (4th Tuesday)",
    printed: "Sep 22, 2026 | 06:30 PM",
    ticks: sept22.ticks,
    agenda: at("/event/GetAgendaFile/Agenda?aid=840"),
    packet: at("/event/GetAgendaPacketFile/Agenda%20Packet?apid=141"),
    minutes: null,
    media: true,
  });
  // Every row's two readings of its own time agree.
  for (const r of [...upcoming, ...[...groups.values()].flatMap((g) => g.rows)]) {
    assert.deepEqual(ticksWallClock(r.ticks!), printedWallClock(r.printed), `${r.eventId} ${r.printed}`);
  }
});

test("WINSLOW · the council's in-window sittings reach readers with their own time, agenda and cancellations", () => {
  const { meetings, drops, accounting } = makeSuiteOneSource([WIRING]).normalizeWithDrops([raw()], NOW);
  assert.equal(accounting.outcome, "CONSERVED");
  assert.deepEqual(meetings.map((m) => [m.startsAt, m.status, m.title]), [
    // The held 120-day window reaches back to 9 and 23 June.
    ["2026-06-09T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (2nd Tuesday)"],
    ["2026-06-23T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (4th Tuesday)"],
    ["2026-06-23T19:30:00-07:00", "CONCLUDED", "City Council Special Meetings & Work Sessions"],
    ["2026-07-14T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (2nd Tuesday)"],
    ["2026-07-28T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (4th Tuesday)"],
    ["2026-08-11T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (2nd Tuesday)"],
    ["2026-08-25T18:30:00-07:00", "CANCELED", "City Council Regular Meeting (4th Tuesday) ~ CANCELLED"],
    ["2026-09-08T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (2nd Tuesday)"],
    ["2026-09-22T18:30:00-07:00", "CONCLUDED", "City Council Regular Meeting (4th Tuesday)"],
    ["2026-10-13T18:30:00-07:00", "CANCELED", "City Council Regular Meeting (2nd Tuesday) ~ CANCELLED"],
    ["2026-10-27T18:30:00-07:00", "SCHEDULED", "City Council Regular Meeting (4th Tuesday)"],
    ["2026-11-10T18:30:00-07:00", "CANCELED", "City Council Regular Meeting (2nd Tuesday) ~ CANCELLED"],
    ["2026-11-18T18:30:00-07:00", "SCHEDULED", "City Council Special Meetings & Work Sessions"],
  ]);
  for (const m of meetings) {
    assert.equal(m.bodyId, WIRING.bodyId);
    assert.equal(m.bodyName, "City Council");
    assert.equal(m.startPrecision, "MINUTE");
    assert.equal(m.location, null);
    assert.equal(m.venueGap, undefined, "our own place-not-recorded gap: the agenda states the room");
    assert.equal(m.online, undefined, "never online");
    assert.equal(m.provenance.sourceUrl, PORTAL);
    assert.equal(m.provenance.sourceOrg, "City of Winslow");
  }
  const sept22 = meetings.find((m) => m.id === "suiteone:winslow-city-council:1520")!;
  assert.equal(sept22.agendaUrl, at("/event/GetAgendaFile/Agenda?aid=840"));
  assert.deepEqual(sept22.publishedLinks, [
    { label: "Agenda packet", href: at("/event/GetAgendaPacketFile/Agenda%20Packet?apid=141") },
    { label: "Meeting page and video", href: at("/event/?id=1520") },
  ]);
  const sept8 = meetings.find((m) => m.id === "suiteone:winslow-city-council:1495")!;
  assert.ok(sept8.publishedLinks?.some((l) => l.label === "Minutes (not marked draft or approved)" && l.href === at("/event/GetMinutesFile/Minutes?mid=1112")));
  const oct27 = meetings.find((m) => m.id === "suiteone:winslow-city-council:1509")!;
  assert.equal(oct27.agendaUrl, null);
  assert.equal(oct27.agendaSlotObservedEmpty, true, "the row's document area shows no agenda yet");
  // Six other bodies' upcoming rows are set aside and counted.
  assert.equal(drops.notConfigured, 6);
  assert.equal(drops.unknownVenue, 13);
});

test("WINSLOW · a portal that no longer carries the council's own panel is never read as a council with no meetings", () => {
  const without = HTML.replace(/City Council <small>/g, "Town Council <small>");
  const { meetings, unreachableOcdIds, accounting } = makeSuiteOneSource([WIRING]).normalizeWithDrops([raw(without)], NOW);
  assert.deepEqual(meetings, []);
  assert.deepEqual(unreachableOcdIds, [WIRING.ocdId]);
  assert.equal(accounting.outcome, "CONSERVED");

  // A row whose printed time and sort key disagree is not placed in time.
  const skewed = HTML.replace("Oct 27, 2026 | 06:30 PM", "Oct 27, 2026 | 07:30 PM");
  const read = makeSuiteOneSource([WIRING]).normalizeWithDrops([raw(skewed)], NOW);
  assert.equal(read.meetings.some((m) => m.id === "suiteone:winslow-city-council:1509"), false);
  assert.equal(read.drops.unplaceableInTime, 1);
  assert.equal(read.accounting.outcome, "CONSERVED");
});

test("WINSLOW · robots.txt is read first and recorded; a host with no robots.txt states no restriction, and a Disallow never stops the read", async () => {
  const requested: string[] = [];
  const served: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    requested.push(url);
    if (url.endsWith("/robots.txt")) return new Response("<html>404 - File or directory not found.</html>", { status: 404, headers: { "content-type": "text/html" } });
    if (url === PORTAL) return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  const rows = await makeSuiteOneSource([WIRING], served).fetch({ lat: 35.02, lng: -110.7, radiusKm: 25 });
  assert.deepEqual(requested, [at("/robots.txt"), PORTAL]);
  assert.equal(rows[0].error, undefined);
  assert.equal(rows[0].html, HTML);

  /* robots.txt alone never blocks a public page. The rules are still read first. */
  const disallowedAsked: string[] = [];
  const disallowed: typeof fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    disallowedAsked.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /\n", { status: 200, headers: { "content-type": "text/plain" } });
    if (url === PORTAL) return new Response(HTML, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    throw new Error(`unexpected request ${url}`);
  }) as typeof fetch;
  const read = await makeSuiteOneSource([WIRING], disallowed).fetch({ lat: 35.02, lng: -110.7, radiusKm: 25 });
  assert.deepEqual(disallowedAsked, [at("/robots.txt"), PORTAL], "the rules first, then the page they name");
  assert.equal(read[0].error, undefined);
  assert.equal(read[0].html, HTML);
});
