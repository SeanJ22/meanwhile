/**
 * A saved method finds a body's own events page and the runner reuses it in another state, on recorded pages only.
 * An event verifies only on the body's own host, named in its title by the body's recorded name, the name without
 * class words, its initials, or the words the body's own homepage used to link the page, and dated in the body's
 * state's zone; a state that spans zones is never guessed. An Arizona page never verifies for a New Mexico body,
 * nor the reverse.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  runMeetingsDiscovery,
  walkMeetingsDiscoveryNeed,
  type DiscoveryOpen,
  type DiscoveryRuntime,
} from "../lib/control-plane/discovery/meetings-discovery-executor.ts";
import type { MeetingsDiscoveryNeed } from "../lib/hunt/meetings-discovery.ts";
import {
  OFFICIAL_PAGE_EVENTS_VERSION,
  anchorLinks,
  identityNameTerms,
  verifyEndpointBody,
} from "../lib/hunt/meetings-site-discovery.ts";
import { SEED_RECIPES, knownRecipes, recipeCandidates } from "../lib/hunt/meetings-recipes.ts";
import { eachStore } from "./control-plane-fixtures.ts";
import { COUNTY_TIME_ZONES, governmentTimeZone } from "../lib/time/county-time-zones.ts";

const FIXTURES = new URL("./fixtures/official-page-events/", import.meta.url);
const TUSD_HOME = readFileSync(new URL("tusd-home.html", FIXTURES), "utf8");
const TUSD_PAGE = readFileSync(new URL("tusd-reconfiguration.html", FIXTURES), "utf8");
const SFPS_PAGE = readFileSync(new URL("sfps-board-of-education.html", FIXTURES), "utf8");
// Offline official directory links, independent of the publisher event pages.
const OFFICIAL_DIRECTORY = { url: "https://fixture-directory.gov/schools", html: '<a href="https://www.tusd1.org/">Tucson Unified</a><a href="https://www.sfps.info/">Santa Fe Public Schools</a>' };
/** The instant the recorded pages were read (their .meta.json). */
const NOW = "2026-09-23T23:25:27.424Z";
// Synthetic saved government directory: authority is explicit evidence in this fixture.
const DIRECTORY = { url: "https://directory.example.gov/schools", html: '<a href="https://www.tusd1.org">Tucson Unified</a><a href="https://www.sfps.info">Santa Fe Public Schools</a>' };
const METHOD = "official-page-events-linked-committee-page";
const ALLOW = { status: 200, body: "User-agent: *\nAllow: /\n", contentType: "text/plain" } as const;

/** TUSD's need, carrying the reviewed registry's live homepage. */
const TUSD: MeetingsDiscoveryNeed = {
  jurisdictionId: "az:school:tucson-unified-school-district-1",
  stateCode: "AZ",
  countyFips: "04019",
  name: "TUCSON UNIFIED SCHOOL DISTRICT 1",
  govClass: "SCHOOL_DISTRICT",
  ownWebAddress: "https://www.tusd1.org/",
  basis: "SOURCE_DISCOVERY_OWED",
  sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"],
};

/** Santa Fe Public Schools: New Mexico identity only (the NCES directory's website for LEAID 3502370). */
const SFPS: MeetingsDiscoveryNeed = {
  jurisdictionId: "nm:school:santa-fe-public-schools",
  stateCode: "NM",
  name: "SANTA FE PUBLIC SCHOOLS",
  govClass: "SCHOOL_DISTRICT",
  ownWebAddress: "https://www.sfps.info/",
  basis: "SOURCE_DISCOVERY_OWED",
  sources: ["MEETINGS:THIS_JURISDICTION:this-government-itself"],
};
/** A recorded-shape Santa Fe homepage: its own link to the board page, and nothing else that names a route. */
const SFPS_HOME = `<html><body><nav><a href="/page/board-of-education-2">Board of Education</a><a href="/page/enroll">Enroll</a></nav></body></html>`;

type Reply = { readonly status: number; readonly body?: string; readonly contentType?: string };

function fakeOpen(map: Readonly<Record<string, Reply>>): { open: DiscoveryOpen; seen: string[] } {
  const seen: string[] = [];
  const open: DiscoveryOpen = async ({ url }) => {
    seen.push(url);
    const r = map[url] ?? { status: 404, body: "not found" };
    const body = r.body ?? "";
    return { status: r.status, body, bytes: body.length, contentType: r.contentType ?? "text/html", location: null, transportError: null };
  };
  return { open, seen };
}

function runtime(open: DiscoveryOpen, recipes = knownRecipes([]), now = NOW): DiscoveryRuntime {
  return {
    open,
    readOfficialPages: async () => [{canonicalUrl:DIRECTORY.url,text:DIRECTORY.html}],
    spaceOut: async () => {},
    vault: async () => ({ stored: true, where: "vault", why: "stored" }),
    now: () => now,
    budget: { spent: () => false },
    recipes,
    officialLinkingPageFor: () => OFFICIAL_DIRECTORY,
  };
}

const TUSD_SITE = {
  "https://www.tusd1.org/robots.txt": ALLOW,
  "https://www.tusd1.org/": { status: 200, body: TUSD_HOME },
  "https://www.tusd1.org/Reconfiguration": { status: 200, body: TUSD_PAGE },
};
const SFPS_SITE = {
  "https://www.sfps.info/robots.txt": ALLOW,
  "https://www.sfps.info/": { status: 200, body: SFPS_HOME },
  "https://www.sfps.info/page/board-of-education-2": { status: 200, body: SFPS_PAGE },
};

test("TERMS AND ZONES: a body's name forms come from its recorded name alone; a zone is tabled or never guessed", () => {
  assert.deepEqual(identityNameTerms("TUCSON UNIFIED SCHOOL DISTRICT 1"), ["Tucson Unified School District", "Tucson Unified", "TUSD"]);
  assert.deepEqual(identityNameTerms("SANTA FE PUBLIC SCHOOLS"), ["Santa Fe Public Schools", "Santa Fe", "SFPS"]);
  assert.deepEqual(identityNameTerms("CITY OF CHANDLER"), ["City of Chandler", "Chandler"], "two letters of initials name nothing");
  assert.deepEqual(identityNameTerms("CITY OF TUCSON"), ["City of Tucson", "Tucson"]);
  assert.notDeepEqual(identityNameTerms("TUCSON UNIFIED SCHOOL DISTRICT 1")[1], "Tucson", "a district's core name keeps Unified, so the city's events never verify for it");
  assert.equal(new Set([...COUNTY_TIME_ZONES.values()].map(row => row.stateCode)).size, 56);
  assert.deepEqual([governmentTimeZone("AZ", "04019"), governmentTimeZone("NH"), governmentTimeZone("NJ"), governmentTimeZone("NM"), governmentTimeZone("OH")], ["America/Phoenix", "America/New_York", "America/New_York", "America/Denver", "America/New_York"]);
  for (const split of ["AK", "AL", "AZ", "FL", "ID", "IN", "KS", "KY", "MI", "ND", "NE", "NV", "OR", "SD", "TN", "TX"]) assert.equal(governmentTimeZone(split), null, `${split} needs its county, never a statewide guess`);
  /* A government's own events page in a one-zone state is confirmed by the free walk. */
  const ohio = verifyEndpointBody(
    { vendor: "official-page-events", url: "https://www.sfps.info/page/board-of-education-2" },
    { status: 200, body: SFPS_PAGE, finalUrl: "https://www.sfps.info/page/board-of-education-2" },
    { bodyId: "oh:school:santa-fe-public-schools", name: "SANTA FE PUBLIC SCHOOLS", pageLabel: "Board of Education", officialHost: "www.sfps.info", linkingPage: OFFICIAL_DIRECTORY, stateCode: "OH", now: NOW },
  );
  assert.equal(ohio.verdict, "YIELDED", ohio.detail);
  const texas = verifyEndpointBody(
    { vendor: "official-page-events", url: "https://www.example-isd.org/board" },
    { status: 200, body: TUSD_PAGE, finalUrl: "https://www.example-isd.org/board" },
    { bodyId: "tx:x", name: "EXAMPLE ISD", pageLabel: "Board of Trustees", officialHost: "www.example-isd.org", stateCode: "TX", now: NOW },
  );
  assert.equal(texas.verdict, "NOT_CONFIRMED");
  assert.match(texas.detail, /TIME_ZONE_UNKNOWN/);
});

test("THE SAVED METHOD: TUSD's homepage links its reconfiguration page by name, and the method proposes exactly that, on its own host", () => {
  const links = anchorLinks(TUSD_HOME, "https://www.tusd1.org/");
  assert.ok(links.some((l) => l.url === "https://www.tusd1.org/Reconfiguration" && l.text === "Reconfiguration Committee"));
  const method = SEED_RECIPES.find((r) => r.recipeId === METHOD)!;
  assert.equal(method.state, null, "portable: nothing in it names Tucson");
  assert.equal(method.extractorId, "official-page-events");
  assert.equal(method.successes, 0, "counts start at zero; only the runner's walks move them");
  const proposed = recipeCandidates({ recipes: [method], need: TUSD, origin: "https://www.tusd1.org", homepageHtml: TUSD_HOME, nowIso: NOW });
  assert.ok(proposed.candidates.length <= 3);
  assert.ok(proposed.candidates.every((c) => new URL(c.url).host === "www.tusd1.org"), "never off the government's own host");
  assert.deepEqual(
    proposed.candidates.find((c) => c.url === "https://www.tusd1.org/Reconfiguration"),
    { recipeId: METHOD, extractorId: "official-page-events", url: "https://www.tusd1.org/Reconfiguration", label: "Reconfiguration Committee" },
  );
});

test("LABELS AND BOUNDS: only a label of two words or more names a body; a link step proposes at most its cap, never off-host", () => {
  const board = (pageLabel: string | null) => verifyEndpointBody(
    { vendor: "official-page-events", url: "https://www.sfps.info/page/board-of-education-2" },
    { status: 200, body: SFPS_PAGE, finalUrl: "https://www.sfps.info/page/board-of-education-2" },
    { bodyId: SFPS.jurisdictionId, name: SFPS.name, pageLabel, officialHost: "www.sfps.info", linkingPage: OFFICIAL_DIRECTORY, stateCode: "NM", now: NOW },
  ).verdict;
  assert.equal(board("Board of Education"), "YIELDED");
  assert.equal(board("Board"), "NOT_CONFIRMED", "one word is too general to say whose page this is");
  assert.equal(board(null), "NOT_CONFIRMED", "without the homepage's label, no Santa Fe event names the body");

  const home = [1, 2, 3, 4, 5].map((i) => `<a href="/committee-${i}">Advisory Committee ${i}</a>`).join("") +
    `<a href="https://other.gov/council">City Council</a>`;
  const method = SEED_RECIPES.find((r) => r.recipeId === METHOD)!;
  const proposed = recipeCandidates({ recipes: [method], need: SFPS, origin: "https://www.sfps.info", homepageHtml: home, nowIso: NOW }).candidates;
  assert.deepEqual(proposed.map((c) => c.url), [1, 2, 3].map((i) => `https://www.sfps.info/committee-${i}`), "the cap holds, and another government's link is never followed");
});

test("SEARCH: a search result on the body's own domain that is itself its events page is confirmed from the page already read", async () => {
  const site = fakeOpen({
    "https://district.gov/robots.txt": ALLOW,
    "https://district.gov/": { status: 200, body: "<html><body>Welcome</body></html>" },
    "https://district.gov/Reconfiguration": { status: 200, body: TUSD_PAGE },
  });
  const costs: unknown[] = [];
  const walk = await walkMeetingsDiscoveryNeed({ ...TUSD, ownWebAddress: "https://district.gov/" }, {
    ...runtime(site.open),
    search: async () => ({
      hits: [{ url: "https://district.gov/Reconfiguration", title: "Reconfiguration", provider: "brave" as const }],
      requests: [{ provider: "brave" as const, status: "DELIVERED" as const, error: null, bytes: 100, hitCount: 1 }],
    }),
    recordCost: async (entry) => {
      costs.push(entry);
    },
  });
  assert.equal(walk.outcome, "FOUND");
  const find = walk.found.find((f) => f.url === "https://district.gov/Reconfiguration");
  assert.ok(find);
  assert.deepEqual([find.vendor, find.basis, find.count], ["official-page-events", "SEARCH", 2]);
  assert.equal(site.seen.filter((u) => u === "https://district.gov/Reconfiguration").length, 1, "one request for the page");
  assert.equal(costs.length, 1, "the one search request sent is charged");
});

test("TUSD PROOF: the executor alone, from TUSD's homepage, confirms the reconfiguration page's sessions for Tucson Unified", async () => {
  const unproven = await walkMeetingsDiscoveryNeed(TUSD, {
    ...runtime(fakeOpen(TUSD_SITE).open), readOfficialPages: async () => [], officialLinkingPageFor: () => null,
  });
  assert.ok(!unproven.found.some(row => row.vendor === "official-page-events"),
    "a registry hostname and the site's own links cannot replace saved government endorsement");
  const site = fakeOpen(TUSD_SITE);
  const walk = await walkMeetingsDiscoveryNeed(TUSD, runtime(site.open));
  assert.equal(walk.outcome, "FOUND");
  const find = walk.found.find((f) => f.url === "https://www.tusd1.org/Reconfiguration");
  assert.ok(find, `found: ${JSON.stringify(walk.found.map((f) => f.url))}`);
  assert.equal(find.vendor, "official-page-events");
  assert.equal(find.basis, "RECIPE");
  assert.equal(find.count, 2, "the two community engagement sessions name Tucson Unified; the Joint Committee meeting does not, and is held");
  assert.match(find.detail, new RegExp(OFFICIAL_PAGE_EVENTS_VERSION));
  assert.match(find.detail, /Tucson Unified Facility Plans Community Engagement \(2026-09-23\)/);
  assert.deepEqual(walk.recipes.applied.filter((a) => a.recipeId === METHOD).map((a) => [a.url, a.verdict]), [["https://www.tusd1.org/Reconfiguration", "YIELDED"]]);
  assert.ok(site.seen.indexOf("https://www.tusd1.org/robots.txt") < site.seen.indexOf("https://www.tusd1.org/Reconfiguration"), "robots first");
});

test("SANTA FE TRANSFER: the same method, retrieved for a New Mexico district with its identity substituted, verifies its own board page; neither state's page verifies for the other", async () => {
  const nm = fakeOpen(SFPS_SITE);
  const walk = await walkMeetingsDiscoveryNeed(SFPS, runtime(nm.open));
  assert.equal(walk.outcome, "FOUND");
  const find = walk.found.find((f) => f.url === "https://www.sfps.info/page/board-of-education-2");
  assert.ok(find);
  assert.equal(find.count, 4, "the Board of Education's regular meetings, named by the homepage's own label for the page");
  assert.match(find.detail, /Board of Education Regular Meeting \(2026-10-08\)/);

  /* An Arizona page served where the New Mexico body's board page should be: nothing verifies for Santa Fe. */
  const swapped = fakeOpen({ ...SFPS_SITE, "https://www.sfps.info/page/board-of-education-2": { status: 200, body: TUSD_PAGE } });
  const azForNm = await walkMeetingsDiscoveryNeed(SFPS, runtime(swapped.open));
  assert.notEqual(azForNm.outcome, "FOUND");
  assert.deepEqual(azForNm.recipes.applied.filter((a) => a.recipeId === METHOD).map((a) => a.verdict), ["NOT_CONFIRMED"]);

  /* And a New Mexico page behind TUSD's link: nothing verifies for Tucson Unified. */
  const reverse = fakeOpen({ ...TUSD_SITE, "https://www.tusd1.org/Reconfiguration": { status: 200, body: SFPS_PAGE } });
  const nmForAz = await walkMeetingsDiscoveryNeed(TUSD, runtime(reverse.open));
  assert.equal(nmForAz.found.some((f) => f.url === "https://www.tusd1.org/Reconfiguration"), false);
});

test("LAZY VAULT: walks share the linking index, reload selected original pages, and keep the same events", async () => {
  const expected = await walkMeetingsDiscoveryNeed(TUSD, runtime(fakeOpen(TUSD_SITE).open));
  const reads = Array.from({ length: 3000 }, () => 0);
  let directoryReads = 0, pageSetReads = 0, captureReads = 0;
  const bodies = new Map<string, string>();
  const shared: DiscoveryRuntime = {
    ...runtime(fakeOpen(TUSD_SITE).open),
    officialLinkingPageFor: () => null,
    readOfficialPages: async () => {
      pageSetReads++;
      return [
        ...reads.map((_, i) => ({ canonicalUrl: `https://unrelated-${i}.gov/`, readText: async () => { reads[i]++; return "<p>held unrelated page</p>"; } })),
        { canonicalUrl: DIRECTORY.url, readText: async () => { directoryReads++; return DIRECTORY.html; } },
      ];
    },
    vault: async (artifact, bytes) => { bodies.set(artifact.contentHash, bytes); return { stored: true, where: "vault", why: "stored" }; },
    readOfficialPageTextFor: async artifact => { captureReads++; return bodies.get(artifact.contentHash)!; },
  };
  const first = await walkMeetingsDiscoveryNeed(TUSD, { ...shared });
  const second = await walkMeetingsDiscoveryNeed(TUSD, { ...shared });
  assert.deepEqual(first.found, expected.found);
  assert.deepEqual(second.found, expected.found);
  assert.equal(pageSetReads, 1, "spread per-walk runtimes still use one held page set");
  assert.ok(reads.every(n => n === 1), "each unrelated capture is ingested once across both walks");
  assert.ok(directoryReads > 1, "the selected endorsement is read again from its original capture");
  assert.ok(captureReads > 0, "fresh captures are loaded through the vault reader");
});

test("LAZY VAULT DEADLINE: an expired body read leaves the walk and remaining needs owed", async () => {
  for (const [label, repos] of await eachStore("wtp-lazy-discovery-")) {
    let left = 60_000;
    const pass = await runMeetingsDiscovery(repos, {
      needs: [TUSD, SFPS], cycleIndex: 0, maxWalks: 5,
      runtime: {
        ...runtime(fakeOpen({ ...TUSD_SITE, ...SFPS_SITE }).open),
        budget: { spent: () => left <= 0, remainingMs: () => left },
        readOfficialPages: async () => [{ canonicalUrl: DIRECTORY.url, readText: async () => { left = 0; throw new Error("vault read deadline"); } }],
      },
    });
    assert.deepEqual(pass.walked, [], label);
    assert.equal(pass.cutShort.length, 1, label);
    assert.deepEqual(new Set(pass.deferred), new Set([TUSD.jurisdictionId, SFPS.jurisdictionId]), label);
    assert.deepEqual(await repos.discoveryAttempts.readRecent(pass.cutShort[0].jurisdictionId, 5), [], label);
  }
});

test("VAULT INDEX DEADLINE: expiry before page metadata loads records no discovery reading", async () => {
  for (const [label, repos] of await eachStore("wtp-index-discovery-")) {
    let expired = false;
    const pass = await runMeetingsDiscovery(repos, {
      needs: [TUSD], cycleIndex: 0, maxWalks: 5,
      runtime: {
        ...runtime(fakeOpen(TUSD_SITE).open),
        budget: { spent: () => expired, remainingMs: () => expired ? 0 : 60_000 },
        readOfficialPages: async () => { expired = true; throw new Error("vault index deadline"); },
      },
    });
    assert.deepEqual(pass.walked, [], label);
    assert.deepEqual(pass.cutShort, [{ jurisdictionId: TUSD.jurisdictionId, requests: 0, search: [] }], label);
    assert.deepEqual(pass.deferred, [TUSD.jurisdictionId], label);
    assert.deepEqual(await repos.discoveryAttempts.readRecent(TUSD.jurisdictionId, 5), [], label);
  }
});

test("THE RUNNER USES WHAT IT SAVED: cycle 1 credits the method for TUSD; cycle 2, a later process in New Mexico, reads it from the store and applies it", async () => {
  for (const [label, repos] of await eachStore("wtp-official-page-")) {
    const first = await runMeetingsDiscovery(repos, {
      needs: [TUSD],
      runtime: runtime(fakeOpen(TUSD_SITE).open, knownRecipes((await repos.fieldManual.list()).map((row) => row.value))),
      cycleIndex: 0,
      maxWalks: 5,
    });
    assert.equal(first.walked[0].outcome, "FOUND", label);
    assert.ok(first.recipesUpdated.includes(METHOD), label);
    const saved = knownRecipes((await repos.fieldManual.list()).map((row) => row.value)).find((r) => r.recipeId === METHOD)!;
    assert.equal(saved.successes, 1, `${label}: the success is written to the field manual, which outlives the process`);
    assert.equal(saved.lastSuccess?.jurisdictionId, TUSD.jurisdictionId);

    const second = await runMeetingsDiscovery(repos, {
      needs: [SFPS],
      runtime: runtime(fakeOpen(SFPS_SITE).open, knownRecipes((await repos.fieldManual.list()).map((row) => row.value)), "2026-09-23T23:59:00.000Z"),
      cycleIndex: 0,
      maxWalks: 5,
    });
    assert.equal(second.walked[0].outcome, "FOUND", label);
    const after = knownRecipes((await repos.fieldManual.list()).map((row) => row.value)).find((r) => r.recipeId === METHOD)!;
    assert.equal(after.successes, 2, `${label}: the New Mexico walk used the saved method and added to it`);
    assert.equal(after.lastSuccess?.jurisdictionId, SFPS.jurisdictionId);
  }
});
