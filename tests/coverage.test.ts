import { geometryFiles } from "../lib/holdings/files.ts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveZip } from "../lib/geo/zcta.ts";
import { summarizeCoverage } from "../lib/registry/coverage.ts";
import { type GeoFeature } from "../lib/registry/resolve.ts";
import type { Division, Registry } from "../lib/registry/types.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { planPlaceHunt } from "../lib/hunt/place-plan.ts";
import { buildPlaceOwedList, missingPlaceWork, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { runPlaceSource } from "../lib/hunt/place-source.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { loadStateDistrictBoundaries } from "../lib/control-plane/expansion/national-geography.ts";

test("national district provenance identifies its saved query rather than layer metadata", async () => {
  const captures = new Map<string, string>();
  const districts = await loadStateDistrictBoundaries("OH", { congress: 119, legislativeYear: 2024,
    capture: async (url, text) => { captures.set(url, text); },
    fetchImpl: (async (url, options) => {
      if (String(url).endsWith("?f=json")) return Response.json({ layers: [
        { id: 1, type: "Feature Layer", name: "119th Congressional Districts" },
        { id: 2, type: "Feature Layer", name: "2024 State Legislative Districts - Upper" },
        { id: 3, type: "Feature Layer", name: "2024 State Legislative Districts - Lower" },
      ] });
      assert.equal(options?.method, "POST");
      return Response.json({ features: [{ attributes: { STATE: "39", GEOID: "39007", NAME: "District 7", CD: "7", SLDU: "7", SLDL: "7" } }] });
    }) as typeof fetch });
  assert.equal(districts.length, 3);
  for (const district of districts) {
    assert.equal(district.sourceDataset, "TIGERWEB_CURRENT");
    assert.equal(new URL(district.sourceUrl).searchParams.get("where"), "STATE='39'");
    assert.match(captures.get(district.sourceUrl) ?? "", /39007/);
  }
});

test("Census statistical and duplicate subdivisions stay geography without invented government inventories", () => {
  const items = buildPlaceOwedList({ now: "2026-09-30T00:00:00Z", subjects: [], held: [], divisions: [
    { id: "active-town", label: "Real town", funcstat: "A" },
    { id: "duplicate-town", label: "Census duplicate", funcstat: "F" },
    { id: "statistical-area", label: "Census statistical area", funcstat: "S" },
  ] });
  assert.ok(items.some(item => item.subject.id === "active-town#inventory:body"));
  assert.ok(items.some(item => item.subject.id === "duplicate-town"));
  assert.ok(!items.some(item => /^(?:duplicate-town|statistical-area)#inventory:/.test(item.subject.id)));
});

test("known record classes owe their own facts while place inventories and unknown classes stay open", () => {
  const division = { id: "ocd-division/country:us/state:mo", label: "Missouri" };
  const now = "2026-10-02T00:00:00Z";
  const records: PlaceSubject[] = [
    { id: "state-seat", kind: "seat", captureKind: "state-legislator", label: "Any member", divisionIds: [division.id] },
    { id: "federal-seat", kind: "seat", captureKind: "federal-legislator", label: "Any member", divisionIds: [division.id] },
    { id: "executive", kind: "seat", captureKind: "executive", label: "Any executive", divisionIds: [division.id] },
    { id: "committee", kind: "funding", captureKind: "campaign-finance", label: "Any committee", divisionIds: [division.id] },
    { id: "budget", kind: "funding", captureKind: "public-finance", label: "Any budget", divisionIds: [division.id] },
    { id: "date", kind: "deadline", captureKind: "voting-deadline", label: "Any date", divisionIds: [division.id] },
    { id: "unknown", kind: "seat", label: "Unknown role", divisionIds: [division.id] },
  ];
  const items = buildPlaceOwedList({ divisions: [division], subjects: records, held: [], now });
  const ids = (subject: string) => items.filter(i => i.subject.id === subject).map(i => i.checklistId);
  assert.ok(ids("state-seat").includes("LEG-02") && !ids("state-seat").includes("LEG-22"), "publisher authority is the legislature's, not each seat's");
  assert.deepEqual(ids("ocd-division/country:us/state:mo#legislature").sort(), ["LEG-01", "LEG-10", "LEG-22"]);
  assert.ok(!ids("state-seat").some(id => /^(EXE|PRL)-/.test(id) || ["LEG-20", "LEG-21"].includes(id)));
  assert.ok(ids("federal-seat").includes("PRL-01") && ids("federal-seat").includes("LEG-21"));
  assert.ok(!ids("federal-seat").includes("LEG-22"));
  assert.ok(ids("executive").includes("EXE-01") && !ids("executive").includes("LEG-01"));
  assert.ok(ids("committee").every(id => id.startsWith("CAM-")));
  assert.ok(ids("budget").every(id => id.startsWith("FIN-")));
  assert.deepEqual(ids("date"), ["ELE-08"]);
  assert.ok(ids("unknown").includes("EXE-01") && ids("unknown").includes("PRL-01"));
  assert.equal(items.filter(i => i.subject.id.includes("#inventory:")).length, 6);
  const field = { subjectId: "date", checklistId: "ELE-08", state: "published" as const,
    sourceUrl: "https://elections.example.gov/dates", checkedAt: now, freshUntil: "2026-10-03T00:00:00Z" };
  const filled = buildPlaceOwedList({ divisions: [division], subjects: records, held: [field], now });
  assert.ok(!missingPlaceWork(filled).some(i => i.subject.id === "date"));
  assert.ok(missingPlaceWork(filled).some(i => i.subject.id === `${division.id}#inventory:deadline`));
});

test("the place source reads shared holdings, publishes source data, then uses the actual published projection", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-09-30T00:00:00Z";
  const division = { id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" };
  const body = { id: `${division.id}#executive`, label: "Governor", kind: "body" as const, divisionIds: [division.id] };
  const events: string[] = [];
  let live = false;
  let clock = now;
  const acquiredAt = "2026-09-30T00:02:00Z";
  const result = await runPlaceSource({ repos, store: new MemoryRoutineDataStore(), zip: "65101", divisions: [division], now,
    clock: () => clock,
    geographyCaptures: [], readSource: async (url, knowledge) => {
      events.push("source"); assert.equal(knowledge.error, undefined);
      clock = acquiredAt;
      return { url, text: "<h1>Public source</h1>", collectedAt: acquiredAt };
    },
    readHeld: async () => {
      events.push("held"); return { subjects: [body], held: live ? [{ subjectId: body.id,
      checklistId: "GOV-01", state: "published", sourceUrl: "https://example.gov", checkedAt: acquiredAt, freshUntil: "2026-10-01T00:00:00Z" }] : [] }; },
    publish: async input => { assert.equal(input.now, acquiredAt); events.push("publish"); live = true; return { published: true }; } });
  assert.equal(events[0], "held");
  assert.equal(events.at(-1), "held");
  assert.ok(events.indexOf("source") < events.indexOf("publish"));
  assert.equal(result.items.find(item => item.subject.id === body.id && item.checklistId === "GOV-01")?.state, "published");
});

test("a registry publication failure leaves its fields open while later election fields still reach publication", async () => {
  const now = "2026-09-30T00:00:00Z";
  const division = { id: "ocd-division/country:us/state:mo", label: "Missouri", divisionType: "state", geoid: "29", sourceUrl: "https://census.gov" };
  const pages: Record<string, string> = {
    "https://www.usa.gov/state-governments": '<a id="mo" href="/states/missouri">Missouri</a>',
    "https://www.usa.gov/states/missouri": '<h1>Missouri</h1><a href="https://governor.example.gov/">Governor Jane Doe</a><a href="https://elections.example.gov/">Voting</a>',
    "https://elections.example.gov/": '<p>October 5, 2026: Last day to register to vote.</p>',
  };
  let offers = 0;
  const result = await runPlaceSource({ repos: createMemoryRepositories(), store: new MemoryRoutineDataStore(), zip: "65101", now,
    divisions: [division], geographyCaptures: [], readHeld: async () => ({ subjects: [], held: [] }),
    readSource: async url => { if (!(url in pages)) throw Error("Unavailable source"); return { url, text: pages[url], collectedAt: now }; },
    publish: async () => { offers++; throw Error("Registry temporarily unavailable"); },
    publishElection: async (fields, publishedAt) => {
      assert.equal(publishedAt, now);
      assert.equal(fields[0].kind, "registration_deadline");
      return { candidateId: "election-candidate", promotedVersionId: "election-version", fields: ["deadline"], gaps: [] };
    } });
  assert.equal(offers, 2, "later publication batches survive the earlier rejected call");
  assert.deepEqual(result.publications, [{ error: "Registry temporarily unavailable" }, { error: "Registry temporarily unavailable" }]);
  assert.equal(result.electionPublications.length, 1);
});

test("a place inherits other jobs' published fields before national acquisition", async () => {
  const repos = createMemoryRepositories();
  const now = "2026-09-30T00:00:00Z";
  const division = { id: "ocd-division/country:us/state:az/county:test", label: "Test County" };
  const subject = { id: `${division.id}#governing`, label: "Test County Board", kind: "body" as const, divisionIds: [division.id] };
  const owed = buildPlaceOwedList({ divisions: [division], subjects: [subject], held: [], now });
  const name = owed.find(i => i.subject.id === subject.id && i.checklistId === "GOV-01")!;
  const contact = owed.find(i => i.subject.id === subject.id && i.checklistId === "GOV-08")!;
  const seen: string[] = [];
  const bank = repos.fieldManual.read.bind(repos.fieldManual);
  repos.fieldManual.read = async id => { seen.push("knowledge"); return bank(id); };
  const result = await planPlaceHunt({ repos, divisions: [division], now,
    readHeld: async ids => {
      seen.push("held"); assert.deepEqual(ids, [division.id]);
      return { subjects: [subject], held: [{ subjectId: subject.id, checklistId: "GOV-01", state: "published", sourceUrl: "https://county.example.gov/board", checkedAt: now, freshUntil: "2026-10-01T00:00:00Z", value: "Test County Board", workItemId: "some-other-job" }] };
    },
    acquireNational: async blanks => {
      seen.push("national");
      assert.ok(!blanks.some(i => i.id === name.id), "already published facts are not reacquired");
      assert.ok(blanks.some(i => i.id === contact.id), "contact stays open");
      return { subjects: [], held: [] };
    } });
  assert.deepEqual(seen, ["knowledge", "held", "national"]);
  assert.ok(result.work.some(i => i.id === contact.id));
  const expired = await planPlaceHunt({ repos, divisions: [division], now: "2026-10-02T00:00:00Z",
    readHeld: async () => ({ subjects: [subject], held: [{ subjectId: subject.id, checklistId: "GOV-01", state: "published",
      sourceUrl: "https://county.example.gov/board", checkedAt: now, freshUntil: "2026-10-01T00:00:00Z" }] }),
    acquireNational: async () => ({ subjects: [], held: [] }) });
  assert.ok(expired.work.some(i => i.id === name.id), "expired fields return to standing work using the same identity");
  assert.equal(expired.items.find(i => i.id === name.id)?.state, "stale");
  assert.match(expired.items.find(i => i.id === name.id)?.label ?? "", /source refresh due/);
  await assert.rejects(planPlaceHunt({ repos, divisions: [division], now,
    readHeld: async () => { throw Error("Shared holdings unavailable"); },
    acquireNational: async () => { throw Error("Must not acquire from a failed empty read"); } }), /Shared holdings unavailable/);
});

await installRegistryRuntimeFirstSeeds();

/**
 * Coverage language, and the count that proves the derivation rule is right.
 *
 * Two jobs. The first is the four states of 4.6.6 — the reader must always be
 * able to tell "nothing is scheduled" from "we cannot see what is scheduled",
 * and must never be told they have no representation.
 *
 * The second is the federal check. Phase 4.7 says the derivation rule is
 * validated against the Census of Governments rather than invented, and this is
 * where that happens: the three clip counties hold exactly 74 general-purpose
 * governments, and a rule producing a different number is wrong.
 */

const here = dirname(fileURLToPath(import.meta.url));
const HOLDINGS_ROOT = join(here, "..");

async function loadFeatures(): Promise<GeoFeature[]> {
  const names = geometryFiles(HOLDINGS_ROOT);
  const all: GeoFeature[] = [];
  for (const name of names) {
    const parsed = JSON.parse(await readFile(join(HOLDINGS_ROOT, name), "utf8"));
    all.push(...(parsed.features as GeoFeature[]));
  }
  return all;
}

const features = await loadFeatures();
const registry = JSON.parse(
  await readFile(join(here, "..", "lib", "registry", "registry.json"), "utf8"),
) as Registry;
const byId = new Map<string, Division>(registry.divisions.map((d) => [d.ocdId, d]));

function coverageFor(zip: string, meetingCount: number) {
  const r = resolveZip(zip);
  assert.ok(r.ok, `${zip} must resolve to a centroid`);
  return summarizeCoverage(
    [r.centroid.lng, r.centroid.lat],
    features,
    byId,
    registry.bodies,
    meetingCount,
  );
}

/**
 * The 2022 Census of Governments count for the three clip counties.
 *
 * 39 municipalities in Morris NJ, 27 in Merrimack NH, 5 incorporated places in
 * Pima AZ, plus the 3 county governments. This is the number the derivation has
 * to reproduce, and reproducing it is what turns "the rule looks reasonable"
 * into "the rule agrees with the federal enumeration".
 */
const COG_GENERAL_PURPOSE = 74;

/** Per-county, from the same federal source. */
const COG_BY_COUNTY: Record<string, number> = {
  "Pima AZ": 5,
  "Merrimack NH": 27,
  "Morris NJ": 39,
};

const bodyOcdIds = new Set(registry.bodies.map((b) => b.ocdId));

/** Average of every exterior-ring vertex. Good enough to place a municipality in its county. */
function _centroid(feature: GeoFeature): [number, number] {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (const poly of polys) {
    for (const [x, y] of poly[0]) {
      sx += x;
      sy += y;
      n++;
    }
  }
  return [sx / n, sy / n];
}

test("the clip counties hold exactly the 74 governments Census enumerates", () => {
  // The federal check, and the reason the derivation rule is credible rather
  // than merely plausible. Done by geometric containment, not by reading county
  // out of the identifier: after the FUNCSTAT fix a New Jersey borough is a flat
  // `state:nj/place:*` row with no county segment at all, so an identifier-shaped
  // test would silently miss 29 governments.
  /*
   * **THE COUNTY IS READ, NOT GUESSED.** (RULING 80, NJ Hunt 4 item 4,
   * 2026-08-22.)
   *
   * This used to place each municipality in a county by AVERAGING its
   * exterior-ring vertices and testing that point against the simplified county
   * polygon. Both halves of that are approximations, and once the clip widened
   * from three counties to twenty-two they stopped cancelling out: three Sussex
   * County municipalities on the Lake Hopatcong shore — Byram township,
   * Hopatcong and Stanhope — reported as Morris, and inflated a federal
   * cross-check by three. A vertex average is not a centroid, and a
   * 200-metre-simplified boundary is not a boundary.
   *
   * `clipCounties` is written onto every clipped feature at build time from the
   * REAL overlap against the county polygons the clip is built from, before any
   * simplification. It is exact. A municipality that genuinely straddles a
   * county line carries both, and is counted in both — which is the truth about
   * it, not a rounding of it.
   */
  const measuredCounties = registry.divisions.filter(d => d.divisionType === "county" && Object.hasOwn(COG_BY_COUNTY, `${d.label.replace(/ County$/, "")} ${d.state}`));
  const countyLabel = new Map(measuredCounties.map(d => [d.geoid!, `${d.label.replace(/ County$/, "")} ${d.state}`]));

  const perCounty: Record<string, number> = {};
  let outsideThePrimaries = 0;
  for (const feature of features) {
    if (!bodyOcdIds.has(feature.properties.ocdId)) continue;
    const division = byId.get(feature.properties.ocdId);
    if (division?.divisionType !== "place") continue;

    const homes = (feature.properties as { clipCounties?: string[] }).clipCounties ?? [];
    const primaries = homes.filter((fips) => countyLabel.has(fips));
    if (primaries.length === 0) {
      outsideThePrimaries++;
      continue;
    }
    for (const fips of primaries) {
      const key = countyLabel.get(fips)!;
      perCounty[key] = (perCounty[key] ?? 0) + 1;
    }
  }

  /*
   * THE PAIR. The widened extent draws municipal governments outside the three
   * counties this federal cross-check is about, and saying only the in-scope
   * number would hide that. The standing figure is the per-county one below.
   */
  console.log(
    `COG cross-check: ${Object.values(perCounty).reduce((a, b) => a + b, 0)} municipal ` +
      `bodies inside the three primary counties · ${outsideThePrimaries} held in the ` +
      `adjacent counties the RULING 80 extent now draws`,
  );

  assert.deepEqual(
    perCounty,
    COG_BY_COUNTY,
    `municipal counts per county disagree with the Census of Governments: ${JSON.stringify(perCounty)}`,
  );

  /*
   * The county term is the CLIP counties, which is what this test's constant
   * has always meant — "plus the 3 county governments", per the note above
   * COG_GENERAL_PURPOSE.
   *
   * It used to count every `divisionType === "county"` row, which was the same
   * number for as long as the registry held only the clip counties. NH Hunt 5
   * added Sullivan County: 03255's first-rung circle crosses three counties
   * and the geometry is clipped to one, so Sullivan is now a division here
   * with no polygon (lib/registry/curated-divisions.ts). It is a real
   * government and it is correctly in the registry; it is simply not one of
   * the three counties this federal cross-check is about, and counting it here
   * would have made the check fail for being MORE complete.
   *
   * Scoped by the clip manifest rather than by a literal 3, so the two move
   * together if the clip ever widens.
   */
  const clipFips = new Set(measuredCounties.map(d => d.geoid));
  const clipCountyRows = registry.divisions.filter(
    (d) => d.divisionType === "county" && d.geoid !== null && clipFips.has(d.geoid),
  );
  assert.equal(
    clipCountyRows.length,
    measuredCounties.length,
    "every clip county must be a division here, matched on its GEOID",
  );

  const total =
    Object.values(perCounty).reduce((a, b) => a + b, 0) + clipCountyRows.length;

  assert.equal(total, COG_GENERAL_PURPOSE, `expected ${COG_GENERAL_PURPOSE}, got ${total}`);
});

test("a government listed in both layers keeps the real row, not the fictitious one", () => {
  // Concord NH is in the place file and the county-subdivision file. One city.
  // Census marks the duplicate itself: the place row is FUNCSTAT=A and the
  // subdivision row is FUNCSTAT=F, a fictitious entity that exists only to fill
  // the geographic hierarchy.
  //
  // Which row survives matters as much as how many. An earlier read-layer
  // dedupe kept the county-subdivision row and dropped `place:concord` — the
  // count was right and the identity was wrong, which is worse, because every
  // officeholder and meeting downstream joins on that key.
  const concord = registry.divisions.filter(
    (d) => d.divisionType === "place" && /concord/.test(d.ocdId) && d.state === "NH",
  );
  assert.ok(
    concord.length >= 2,
    "expected Concord NH in both layers — if this fails the registry build changed",
  );

  const withBody = concord.filter((d) => bodyOcdIds.has(d.ocdId));
  assert.equal(withBody.length, 1, "one city is one governing body");
  assert.equal(withBody[0].funcstat, "A");
  assert.equal(
    withBody[0].ocdId,
    "ocd-division/country:us/state:nh/place:concord",
    "the active place row is the City of Concord",
  );

  const dropped = concord.filter((d) => !bodyOcdIds.has(d.ocdId));
  assert.ok(dropped.every((d) => d.funcstat === "F"));
});

test("every fictitious row is suppressed, and only fictitious rows are", () => {
  /*
   * **121 across the clip EXTENT**, which is the three primary counties plus
   * every county adjacent to them (RULING 80, 2026-08-22). It was 32 while the
   * clip was three counties; the rule did not change and the universe did.
   *
   * If this number moves again, either Census changed a vintage, the clip
   * changed, or the rule stopped reading FUNCSTAT — and the second assertion
   * below is the one that distinguishes the third case from the first two,
   * because it is about the RULE rather than about the count.
   */
  const municipal = registry.divisions.filter((d) => d.divisionType === "place");
  const fictitious = municipal.filter((d) => d.funcstat === "F");

  assert.equal(fictitious.length, 121, "expected 121 fictitious duplicate rows");
  assert.ok(
    fictitious.every((d) => !bodyOcdIds.has(d.ocdId)),
    "a fictitious row must never produce a governing body",
  );
  assert.ok(
    municipal
      .filter((d) => d.funcstat === "A")
      .every((d) => bodyOcdIds.has(d.ocdId)),
    "every active municipal government must produce a governing body",
  );
});

test("Rockaway borough and township both survive as separate governments", () => {
  // The case that makes the direction of the fix matter. Morris County holds
  // both, and they are two municipalities with two councils. The borough is a
  // flat place row; the township is a county subdivision; and there is a third,
  // fictitious row duplicating the borough.
  const rockaway = registry.divisions.filter((d) => /place:rockaway/.test(d.ocdId));
  const governing = rockaway.filter((d) => bodyOcdIds.has(d.ocdId)).map((d) => d.ocdId);

  assert.equal(governing.length, 2, `expected two governments, got ${governing.join(", ")}`);
  assert.ok(governing.some((id) => id.endsWith("/place:rockaway")), "the borough");
  assert.ok(
    governing.some((id) => id.endsWith("/place:rockaway_township")),
    "the township",
  );
});

test("85701 keeps the City of Tucson and is not called unincorporated", () => {
  // The regression the dedupe introduced and this test now pins. Downtown
  // Tucson is covered by both `place:tucson` (the city) and
  // `county:pima/place:tucson_ccd` (a statistical Census County Division).
  // Reading the CCD as a subdivision government dropped the city, leaving the
  // largest municipality in the test set unrepresented and reporting downtown
  // as having no city government.
  const coverage = coverageFor("85701", 0);

  assert.equal(
    coverage.unincorporated,
    false,
    "downtown Tucson has a city government",
  );

  // Exactly one municipal *government*. The division now also carries the
  // city's boards, commissions and the PHA as curated bodies (D29) — real
  // bodies, not extra city governments, and they must not read as one.
  const municipal = coverage.bodies.filter(
    (b) => b.divisionType === "place" && b.name === null,
  );
  assert.equal(municipal.length, 1, `expected the city, got ${municipal.length}`);
  assert.match(municipal[0].divisionLabel, /tucson/i);
  assert.ok(
    coverage.bodies.some((b) => b.name === "Planning Commission (PC)"),
    "the curated boards should surface alongside the city",
  );
});

test("85641 states the unincorporated fact and still names its government", () => {
  // The case the whole phase exists for. Vail is a CDP: no municipal
  // government at all. The old answer was an empty map reading as civic
  // silence; the correct one names the county and the school district and says
  // plainly that there is no city government.
  const coverage = coverageFor("85641", 0);

  /*
   * NONE_SCHEDULED since 2026-08-13, and it SURVIVED a real test of itself on
   * 2026-08-27 — which is worth recording, because the survival was earned.
   *
   * That day found a governing body nobody knew about: the CENTRAL ARIZONA
   * WATER CONSERVATION DISTRICT, which levies on every parcel in Pima County
   * (Resolution 2026-43, ad valorem secondary 0.1000 plus water storage 0.0400
   * on the county's whole valuation) and whose board is DIRECTLY ELECTED. Its
   * own meetings page renders no meeting, so adding it turned this assertion to
   * NO_SOURCE — correctly, because there was now a government here whose
   * calendar we could not read.
   *
   * The available shortcut was to leave the district out and keep the greener
   * state. CLAUDE.md forbids exactly that: collection state never governs
   * display. So the district went in, and then the adapter did — its CivicClerk
   * tenant slug is in its own page's `clerkEmbedProps` and the portal's OData
   * API answers a plain GET. Every governing body at this point is LIVE again,
   * and an empty calendar is once more a statement about the calendar.
   */
  assert.equal(coverage.state, "NONE_SCHEDULED");
  assert.equal(coverage.unincorporated, true, "Vail is unincorporated and must say so");

  const labels = coverage.bodies.map((b) => b.divisionLabel);
  assert.ok(
    labels.some((l) => /pima/i.test(l)),
    `expected the county, got ${labels.join(", ")}`,
  );
  assert.ok(
    labels.some((l) => /vail/i.test(l)),
    `expected Vail Unified, got ${labels.join(", ")}`,
  );
  assert.equal(
    coverage.bodies.filter((b) => b.divisionType === "place").length,
    0,
    "a CDP must never produce a municipal body",
  );
});

test("nobody is ever told they have no representation", () => {
  // Every square foot of the country is governed by something. Whatever the
  // coverage state, a target zip always resolves at least a county board, a
  // school board, and state and federal seats.
  for (const zip of ["85701", "85641", "07866", "03255"]) {
    const coverage = coverageFor(zip, 0);
    assert.ok(
      coverage.bodies.length > 0,
      `${zip} resolved no governing body at all`,
    );
    assert.ok(
      coverage.seats.length > 0,
      `${zip} resolved no legislative representation`,
    );
    assert.notEqual(coverage.state, "UNMAPPED", `${zip} should be mapped`);
  }
});

test("finding meetings and finding nothing are different states", () => {
  assert.equal(coverageFor("85701", 4).state, "MEETINGS");
  /*
   * 85701 moved with 85641 through the Central Arizona Water Conservation
   * District episode of 2026-08-27 described above — out of NONE_SCHEDULED
   * when the district was added with no adapter, and back into it when the
   * CivicClerk adapter landed. Both Pima zips move together because the
   * district's territory is the county, which is itself the check that the
   * finding was applied to the district's real reach rather than pinned to the
   * zip that happened to find it.
   */
  assert.equal(coverageFor("85701", 0).state, "NONE_SCHEDULED");
  // …and 07866 joined it on 2026-08-15, when Morris Hills Regional — the last
  // GOVERNING body at the point without a source — was wired (M78). The two
  // bodies still unwired there are Rockaway's Environmental Commission and
  // Board of Assessment Commissioners, both COMMISSION class, and the state
  // deliberately does not turn on those: an unwired commission must not read
  // as a government whose calendar is missing. The sidebar still counts them.
  const rockaway = coverageFor("07866", 0);
  assert.equal(rockaway.state, "NONE_SCHEDULED");
  assert.ok(
    rockaway.counts.withoutSource >= 2,
    `${rockaway.counts.withoutSource} bodies without a source — the two ` +
      `unwired commissions must still be counted, not absorbed by the state`,
  );
  assert.deepEqual(
    rockaway.bodies
      .filter((b) => b.bodyClass === "GOVERNING" && b.coverageStatus !== "LIVE")
      .map((b) => b.bodyId),
    [],
    "a governing body at 07866 lost its source",
  );
});

test("a body's name is never invented for display", () => {
  // The copy prints the *division's* label, which Census sourced. A DERIVED
  // body's own name is null and must stay that way until something sources
  // it. A CURATED row may carry a name — that is what the origin means — and
  // then it must cite the page the name was read off. (Rockaway's Planning
  // Board and Board of Adjustment arrived curated on 2026-08-15, named from
  // the township's own AgendaCenter headings.)
  const coverage = coverageFor("07866", 0);
  assert.ok(coverage.bodies.length > 0);

  for (const body of coverage.bodies) {
    const source = registry.bodies.find((b) => b.id === body.bodyId);
    assert.ok(source, `${body.bodyId} is not in the registry`);
    if (source.bodyOrigin === "CURATED") {
      assert.ok(
        source.provenance?.sourceUrl,
        `${body.bodyId} is curated but cites no page for its name`,
      );
    } else {
      assert.equal(source.name, null, `${body.bodyId} gained a name from nowhere`);
    }
    // The coverageStatus assertion that used to sit here was incidental to this
    // test and is now false: Rockaway township has an audit row, so it reads
    // KNOWN_UNCOVERED. What this test is actually about — a name never being
    // invented — is unaffected, and holds even for the audited rows, since a
    // source hunt finds a website and never a body's name.
    assert.notEqual(body.divisionLabel, "", "a division label must be present to render");
  }
});

test("07866 counts its two school districts separately", () => {
  // A K-8 district and a regional high school district cover the same ground,
  // and they are two governments with two boards.
  const coverage = coverageFor("07866", 0);
  const schools = coverage.bodies.filter((b) => b.divisionType === "school_district");

  assert.ok(
    schools.length >= 2,
    `expected two school boards, got ${schools.map((s) => s.divisionLabel).join(", ")}`,
  );
});

test("03255 resolves the town, deduped to one municipal division", () => {
  // Newbury NH is a county subdivision and absent from the place file. Nothing
  // should double it, and the town government must survive the dedupe.
  //
  // **The claim is one DIVISION, not one body** (corrected 2026-08-15, the
  // truth session). This asserted one municipal body until the browser rung
  // reached the town's own site and found the Planning Board, the
  // Conservation Commission and the Zoning Board of Adjustment sitting beside
  // the Selectboard — one division, many bodies, which the registry has
  // always said is the normal case and which Tucson and Rockaway already
  // demonstrate. The dedupe this test guards is of the DIVISION; a body count
  // standing in for it would have made finding a town's other governments
  // look like a regression.
  const coverage = coverageFor("03255", 0);
  const municipal = coverage.bodies.filter((b) => b.divisionType === "place");
  const divisions = new Set(municipal.map((b) => b.divisionLabel));

  assert.equal(divisions.size, 1, `expected one town, got ${[...divisions].join(", ")}`);
  assert.match(municipal[0].divisionLabel, /newbury/i);
  assert.ok(municipal.length >= 4, `expected the town's four bodies, got ${municipal.length}`);
  assert.equal(coverage.unincorporated, false);
});
