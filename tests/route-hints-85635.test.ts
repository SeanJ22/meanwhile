/**
 * **THE 85635 GOVERNMENTS' COMMITTED HINTS DO WHAT THEY SAY.** (2026-09-26.)
 *
 * Sierra Vista publishes its sittings on its own "Calendar Meeting List" page as schema.org Event JSON-LD, which the
 * official-page-events adapter already reads; the walk could not confirm it for the city, because no event title
 * names the city. The hint names the body the events do carry, "City Council", so the walk confirms the page with the
 * adapter's own rules and no reader-bound change. The fixture is the page's own JSON-LD, read 2026-09-26T04:58Z.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { walkMeetingsDiscoveryNeed, type DiscoveryRuntime } from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import { ROUTE_HINTS, routeHintsFor } from "../lib/hunt/meetings-route-hints.ts";
import { verifyEndpointBody } from "../lib/hunt/meetings-site-discovery.ts";
import { recordedDiscoveryOpen } from "./helpers/recorded-discovery-open.ts";

const PAGE = readFileSync("tests/fixtures/sierra-vista-calendar-meeting-list.html", "utf8");
const PAGE_URL = "https://www.sierravistaaz.gov/our-city/calendar-meeting-list";
const SIERRA_VISTA = "az:city:city-of-sierra-vista";
const NOW = "2026-09-26T05:00:00.000Z";

const identity = (pageLabel: string | null) => ({
  bodyId: SIERRA_VISTA, name: "CITY OF SIERRA VISTA", pageLabel, officialHost: "www.sierravistaaz.gov", stateCode: "AZ", now: NOW,
});

test("SIERRA VISTA: the meeting list page is confirmed for the city only under the body its events name, by the adapter's own rules", () => {
  const plain = verifyEndpointBody({ vendor: "official-page-events", url: PAGE_URL }, { status: 200, body: PAGE, finalUrl: PAGE_URL }, identity(null));
  assert.equal(plain.verdict, "NOT_CONFIRMED", "no event title names the city itself");
  const hint = routeHintsFor(SIERRA_VISTA, ROUTE_HINTS)!.routes.find((r) => r.url === PAGE_URL)!;
  assert.equal(hint.verifyAs, "official-page-events");
  const labelled = verifyEndpointBody({ vendor: "official-page-events", url: PAGE_URL }, { status: 200, body: PAGE, finalUrl: PAGE_URL }, identity(hint.body));
  assert.equal(labelled.verdict, "YIELDED");
  assert.equal(labelled.count, 8, "the City Council's 8 dated sittings");
  assert.match(labelled.detail, /City Council Work Session \(2026-10-06\); City Council Regular Meeting \(2026-10-08\)/);
});

test("FORT HUACHUCA: the walk reads the district's current site in place of its dead k12.az.us host, while that site still names the district", async () => {
  const hints = routeHintsFor("az:depschool:fort-huachuca-accommodation-school", ROUTE_HINTS)!;
  assert.equal(hints.officialSite?.origin, "https://www.fhasd.org");
  assert.equal(hints.officialSite?.replaces, "http://fthuachuca.k12.az.us/");
  const seen: string[] = [];
  const open = recordedDiscoveryOpen({
    "https://www.fhasd.org/robots.txt": { status: 404, body: "not found" },
    "https://www.fhasd.org/": {
      status: 200,
      body: `<title>Fort Huachuca Accommodation Schools</title><a href="https://fhasd.community.highbond.com/Portal/">Governing Board Agenda/Minutes</a>`,
    },
  });
  let tick = 0;
  const attempt = await walkMeetingsDiscoveryNeed({
    jurisdictionId: "az:depschool:fort-huachuca-accommodation-school", stateCode: "AZ", name: "FORT HUACHUCA ACCOMMODATION SCHOOL",
    govClass: "DEPENDENT_SCHOOL_SYSTEM", ownWebAddress: "http://fthuachuca.k12.az.us/", basis: "SOURCE_DISCOVERY_OWED", sources: [],
  }, {
    open: async (input) => (seen.push(input.url), open(input)),
    spaceOut: async () => {},
    vault: async (artifact) => ({ stored: true, where: `vault/${artifact.id}`, why: "stored" }),
    now: () => new Date(Date.parse(NOW) + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
    routeHints: ROUTE_HINTS,
  });
  assert.deepEqual(seen.slice(0, 2), ["https://www.fhasd.org/robots.txt", "https://www.fhasd.org/"]);
  assert.equal(attempt.site?.homepage?.basis, "ROUTE_HINT");
  assert.deepEqual(attempt.leads.map((l) => l.vendor), ["diligent"], "its board portal is a lead until an adapter reads it");
});

test("SIERRA VISTA, THE WALK: the hinted page is read robots-first and found, attested by the hint", async () => {
  const seen: string[] = [];
  const open = recordedDiscoveryOpen({
    "https://www.sierravistaaz.gov/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /admin\n", contentType: "text/plain" },
    "https://www.sierravistaaz.gov/": { status: 200, body: "<title>City of Sierra Vista, AZ</title>" },
    [PAGE_URL]: { status: 200, body: PAGE },
  });
  let tick = 0;
  const runtime: DiscoveryRuntime = {
    open: async (input) => (seen.push(input.url), open(input)),
    spaceOut: async () => {},
    vault: async (artifact) => ({ stored: true, where: `vault/${artifact.id}`, why: "stored" }),
    now: () => new Date(Date.parse(NOW) + (tick++) * 1000).toISOString(),
    budget: { spent: () => false },
    routeHints: ROUTE_HINTS,
  };
  const need: MeetingsDiscoveryNeed = {
    jurisdictionId: SIERRA_VISTA, stateCode: "AZ", name: "CITY OF SIERRA VISTA", govClass: "CITY_OR_TOWN", ownWebAddress: "http://www.sierravistaaz.gov",
    basis: "SOURCE_DISCOVERY_OWED", sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"],
  };
  const attempt = await walkMeetingsDiscoveryNeed(need, runtime);
  assert.deepEqual(seen, ["https://www.sierravistaaz.gov/robots.txt", "https://www.sierravistaaz.gov/", PAGE_URL]);
  assert.equal(attempt.outcome, "FOUND");
  assert.deepEqual(attempt.found.map((f) => [f.vendor, f.url, f.basis, f.count]), [["official-page-events", PAGE_URL, "HINT", 8]]);
});
