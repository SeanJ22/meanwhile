import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import test from "node:test";
import { parseCsv } from "../lib/reference/csv.ts";
import { normalize, fetch as fetchAcs, ACS_GEOGRAPHIES, type AcsFetch } from "../lib/sources/census-acs-population/index.ts";
import { latestAcsRelease, joinAcsRows, acsLoadCounts, acquireNationalAcs, acsPublicationDate } from "../lib/sources/census-acs-population/national.ts";
import { censusAcsCandidate, normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { acsPayloadHash } from "../lib/sources/census-acs-population/hash.ts";
import { civicRecordFacts, civicRecordsFor } from "../lib/civic-data/changes.ts";
import { readPopulationFacts, type PopulationFact } from "../lib/reference/population-facts.ts";
import { populationEvidence, composePopulationAnswer, populationEvidenceIds } from "../lib/ask/population.ts";
import { populationKeys } from "../lib/control-plane/data-business/population.ts";
import { readRecipe, type Sources } from "../lib/control-plane/data-business/read.ts";
import { keyRefFor } from "../lib/doors/seed-feeds.ts";
import { heldAcsJoinTargets } from "../lib/sources/census-acs-population/held-joins.ts";

import { buildCensusDistrictEdge } from "../lib/census-geography/state-publication.ts";
import { censusGeographyScope } from "../lib/census-geography/publication.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { LocalFileArtifactStore } from "../lib/meetings/edge-store-local.ts";

const CAPTURED_AT = "2026-09-06T00:00:00.000Z";
function saved(scope: "state" | "zcta"): AcsFetch {
  const [, ...rows] = parseCsv(readFileSync(`tests/fixtures/census-acs/${scope}.csv`, "utf8"));
  return { scope, vintage: 2024, publishedAt: null, status: 200, fetchedAt: CAPTURED_AT,
    url: `https://api.census.gov/data/2024/acs/acs5?for=${encodeURIComponent(ACS_GEOGRAPHIES[scope] + ":*")}`,
    rows: [["NAME", "B01003_001E", "B01003_001M", ACS_GEOGRAPHIES[scope]], ...rows.map(([code, name, pop, margin]) => [name, pop, margin || null, code])] };
}

test("fresh official geography excerpts normalize every supported government layer and keep the actual publication day", async () => {
  const captures = JSON.parse(readFileSync("tests/fixtures/census-acs/geography-samples.json", "utf8")) as AcsFetch[];
  const release = latestAcsRelease(JSON.parse(readFileSync("tests/fixtures/census-acs/catalog.json", "utf8")));
  assert.equal(release.vintage, 2024);
  assert.equal(release.publishedAt, null, "catalog modified is not the publication day");
  assert.equal(acsPublicationDate(readFileSync("tests/fixtures/census-acs/release-schedule.html", "utf8")), "2026-01-29T00:00:00.000Z");
  assert.throws(() => acsPublicationDate('<table><tr><td>March 5, 2026</td><td>5-Year Public Use Microdata Sample</td></tr></table>'), /no dated/);
  for (const capture of captures) {
    const rows = normalize(capture);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.attribution?.publishedAt === "2026-01-29T00:00:00.000Z"));
    assert.ok(rows.every(row => row.attribution?.sourceKind === "OFFICIAL"));
    assert.ok(rows.every(row => row.attribution?.citationUrl?.startsWith("https://data.census.gov/table/ACSDT5Y2024.B01003?g=")), "readers have an official public citation without an API key");
    assert.doesNotMatch(capture.url, /[?&]key=/i);
    assert.ok(rows.every(row => capture.scope === "nation" ? row.censusGeoId === "0100000US" : row.censusGeoId?.endsWith(row.code)), "native GEO_ID retains the GEOID");
    assert.equal(populationEvidence(rows as PopulationFact[])[0].sourceUrl, rows[0].attribution?.citationUrl);
  }
  const vermont = captures.find(capture => capture.scope === "state_leg_lower" && capture.url.includes("state%3A50"));
  assert.ok(vermont);
  assert.equal(normalize(vermont).find(row => row.code === "50A-1")?.population, 8320, "Vermont's native hyphenated district code survives normalization");
  const school = normalize(captures.find(capture => capture.scope === "school_unified")!);
  const targets = await heldAcsJoinTargets("04", [], async () => [[], []]);
  assert.ok(joinAcsRows(school, targets).some(row => row.divisionIds?.length), "held native unsd identifiers join school populations");
});

test("real captured samples preserve estimates and margins in three states, zero and unstated margins", () => {
  const state = normalize(saved("state")), zcta = normalize(saved("zcta"));
  assert.equal(state.length, 52);
  for (const [code, population] of [["04", 7378838], ["33", 1394868], ["34", 9343809]] as const) {
    assert.equal(state.find(row => row.code === code)?.population, population);
  }
  assert.deepEqual(zcta.map(row => [row.code, row.population, row.marginOfError]), [
    ["00627", 32734, null], ["03255", 2015, 229], ["07866", 22663, 1153], ["85633", 48, 29], ["85654", 0, 14], ["85701", 5498, 734],
  ]);
  assert.equal(zcta[0].attribution?.sourceKind, "OFFICIAL");
  assert.equal(zcta[0].attribution?.retrievedAt, CAPTURED_AT);
  assert.equal(zcta[0].attribution?.publishedAt, null);
});

test("synthetic protocol cases join complete GEOIDs within geography, preserve leading zeros and unjoined rows", () => {
  const response: AcsFetch = { scope: "county_subdivision", vintage: 2024, fetchedAt: CAPTURED_AT, url: "https://api.census.gov/data/2024/acs/acs5", status: 200,
    rows: [["NAME", "B01003_001E", "B01003_001M", "state", "county", "county subdivision"], ["Synthetic township", "15", "2", "33", "001", "00010"]] };
  const rows = normalize(response);
  assert.equal(rows[0].code, "3300100010");
  assert.equal(joinAcsRows(rows, [{ geography: "county_subdivision", geoid: "3300100010", divisionId: "held-township" }])[0].divisionIds?.[0], "held-township");
  const unjoined = joinAcsRows(rows, [{ geography: "county", geoid: "3300100010", divisionId: "wrong-layer" }]);
  assert.equal(unjoined.length, 1);
  assert.deepEqual(acsLoadCounts(unjoined), [{ state: "NH", loaded: 1, joined: 0, unjoined: 1 }]);
  assert.throws(() => normalize({ ...response, rows: [...response.rows, response.rows[1]] }), /repeat/);
  assert.throws(() => normalize({ ...response, rows: [response.rows[0], response.rows[1].slice(0, 4)] }), /incomplete/);
});

test("synthetic catalog cases discover a new five-year vintage without selecting one-year or profiles", () => {
  assert.deepEqual(latestAcsRelease({ dataset: [
    { c_dataset: ["acs", "acs5"], c_vintage: 2024 },
    { c_dataset: ["acs", "acs1"], c_vintage: 2026 },
    { c_dataset: ["acs", "acs5", "profile"], c_vintage: 2026 },
    { c_dataset: ["acs", "acs5"], c_vintage: 2025, issued: "2026-12-01" },
  ] }), { vintage: 2025, publishedAt: "2026-12-01T00:00:00.000Z" });
  assert.throws(() => latestAcsRelease({ dataset: [] }), /no ACS/);
});

test("bulk protocol double enumerates every returned state and every geography, keeping empty successful tables", async () => {
  const requests: URL[] = [];
  const states = saved("state"), zctas = saved("zcta");
  const fetcher: typeof globalThis.fetch = async input => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname === "/data.json") return Response.json({ dataset: [{ c_dataset: ["acs", "acs5"], c_vintage: 2024 }] });
    if (url.pathname.endsWith("release-schedule.html")) return new Response('<table><tr><td>January 29, 2026</td><td>5-Year Data Release</td></tr></table>');
    const scope = Object.entries(ACS_GEOGRAPHIES).find(([, name]) => url.searchParams.get("for") === `${name}:*`)?.[0];
    if (scope === "state") return Response.json(states.rows);
    if (scope === "zcta") return Response.json(zctas.rows);
    // Synthetic nation field exercises the protocol only; no production population is asserted.
    if (scope === "nation") return Response.json([["NAME", "B01003_001E", "B01003_001M", "us"], ["Synthetic nation", "1", null, "1"]]);
    return new Response(null, { status: 204 });
  };
  const load = await acquireNationalAcs({ key: "synthetic-secret", fetcher, targets: async () => [] });
  assert.equal(load.rows.length, 59);
  assert.equal(requests.length, 5 + 52 * (Object.keys(ACS_GEOGRAPHIES).length - 3));
  assert.equal(load.counts.reduce((sum, row) => sum + row.loaded, 0), load.rows.length);
  assert.equal(load.counts.reduce((sum, row) => sum + row.joined + row.unjoined, 0), load.rows.length);
  assert.ok(load.captures.every(capture => !capture.url.includes("synthetic-secret")));
  const stateRequest = requests.find(url => url.searchParams.get("for") === "state:*")!;
  assert.equal(stateRequest.searchParams.get("key"), "synthetic-secret");
  assert.ok(requests.some(url => url.searchParams.get("in") === "state:04 county:*"));
});

test("an unreachable source yields a classified outage and does not leak credentials", async () => {
  await assert.rejects(fetchAcs("state", "secret-key", async () => { throw new TypeError("https://api.census.gov?key=secret-key"); }), error => {
    assert.equal((error as { code: string }).code, "PUBLISHER_UNAVAILABLE");
    assert.doesNotMatch(String(error), /secret-key/);
    return true;
  });
  assert.equal(keyRefFor("census-acs-population"), "CENSUS_API_KEY");
});

test("a second successful unchanged check ignores capture stamps but retains source dates and exact population facts", () => {
  const candidate = censusAcsCandidate(saved("zcta"), saved("state"));
  assert.equal(acsPayloadHash(candidate.readModel), normalizedHash(candidate.readModel), "incremental fingerprint uses the existing canonical JSON contract");
  const changed = censusAcsCandidate({ ...saved("zcta"), fetchedAt: "2026-10-12T00:00:00.000Z" }, { ...saved("state"), fetchedAt: "2026-10-12T00:00:00.000Z" });
  const facts = (value: typeof candidate) => civicRecordsFor(value.recordClass, value.readModel).map(member => civicRecordFacts(value.recordClass, member));
  assert.deepEqual(facts(candidate), facts(changed));
  assert.equal(candidate.normalization.droppedRecords, 0);
  assert.equal(candidate.retrieval.requestedUrl, saved("zcta").url);
});

test("scoped promoted facts feed Ask with the actual estimate, period, margin and official citation", async () => {
  const fact = normalize(saved("zcta")).find(row => row.code === "85701") as PopulationFact;
  const ids = ["zcta:85701"];
  const read = await readPopulationFacts(ids, async statements => {
    if (statements[0].text.startsWith("SELECT current_version_id")) return [[{ current_version_id: "saved-version" }]];
    assert.deepEqual(statements[0].params[2], ids);
    assert.match(statements[0].text, /WITH RECURSIVE/);
    assert.match(statements[0].text, /divisionIds.*\?\|/);
    return [[{ scope: "acs-population", field: "$version", rows: "saved-version" }, { scope: "acs-population", field: "zcta", rows: [fact] }]];
  });
  assert.equal(read.kind, "HELD");
  const evidence = populationEvidence(read.rows);
  const answer = composePopulationAnswer("How many people live in this ZIP?", evidence);
  assert.match(answer?.answer ?? "", /5,498 ± 734/);
  assert.match(answer?.answer ?? "", /2020–2024.*Tabulation Area/);
  assert.deepEqual(answer?.citedUrls, [fact.attribution.sourceUrl]);
  assert.equal((await readPopulationFacts(ids, null)).kind, "UNREAD");
  assert.equal((await readPopulationFacts(ids, async () => [[], []])).kind, "NOT_PUBLISHED");
  assert.deepEqual(populationEvidenceIds("BODY", null, "85701", ["other-county"]), [], "a named government's gap cannot become a ZIP population");
  assert.deepEqual(populationEvidenceIds("PERSON", null, "85701", ["other-county"]), [], "a person's represented population cannot become a ZIP population");
  assert.deepEqual(populationEvidenceIds(null, null, "85701", []), ids);
});

test("the sold read carries the source population alongside aggregates and leaves a missing denominator null", async () => {
  const fact = normalize(saved("zcta")).find(row => row.code === "85701") as PopulationFact;
  const sources: Sources = { totals: async () => ({ kind: "ROWS", rows: [{ grain: "day", period: "2026-10-01", zip: "85701", district: null, topic: "*", type: "ASK", events: 20, users: 3 }] }),
    cohorts: async () => ({ kind: "ROWS", rows: [] }), events: async () => ({ kind: "ROWS", rows: [] }),
    places: { of: async () => new Map(), zipsIn: async () => [] },
    populations: async keys => keys.map(place => ({ place, fact: place === "zcta:85701" ? fact : null })) };
  const read = await readRecipe({ recipe: "events-by-type", audience: "customer:sample", slice: { grain: "day", from: "2026-10-01", to: "2026-10-01", place: { kind: "zip", id: "85701" } } },
    { sources, switchOn: () => true });
  assert.equal(read.kind, "READ");
  if (read.kind !== "READ") return;
  assert.equal(read.population?.[0].fact?.population, 5498);
  assert.equal(read.body.shape === "totals" && read.body.rows[0].value, 20);
  assert.deepEqual(populationKeys({ grain: "day", from: "2026-10-01", to: "2026-10-01", place: { kind: "state", id: "AZ" } }, read.body, "events-by-type"), ["state:04"]);
});
test("ACS joins read only the selected Census state metadata and its real ZIP memberships", async () => {
  const directory = mkdtempSync(join(tmpdir(), "acs-held-state-"));
  try {
    const artifacts = new LocalFileArtifactStore(directory);
    const dataset = JSON.parse(readFileSync("lib/census-geography/bootstrap-az.json", "utf8")) as BuiltDataset;
    const expectedZips = [...new Set(dataset.scopes.flatMap(scope => scope.groupings.filter(group => group.stateFips === "04")
      .flatMap(group => group.overlaps.map(overlap => overlap.zcta5))))].sort();
    const index = await buildCensusDistrictEdge(dataset, "acs-held-state", artifacts);
    let servedIndex = index;
    const reads: string[] = [];
    const readonly = { kind: artifacts.kind, readManifest: () => artifacts.readManifest(), readArtifact: (key: string) => artifacts.readArtifact(key),
      readBytes: (key: string) => { reads.push(key); return artifacts.readBytes(key); } };
    let censusReads = 0;
    const query: ReadOnlyQuery = async statements => {
      assert.equal(statements.length, 1);
      const statement = statements[0];
      if (statement.text.startsWith("SELECT d AS division")) return [[]];
      censusReads++;
      assert.deepEqual(statement.params, ["CENSUS_GEOGRAPHY", censusGeographyScope("AZ")]);
      assert.doesNotMatch(statement.text, /jsonb_array_elements|groupings|RECURSIVE/);
      return [[{ version_id: "held-acs-state", payload: servedIndex }]];
    };
    const targets = await heldAcsJoinTargets("04", [], query, readonly);
    assert.equal(censusReads, 1);
    assert.deepEqual(reads, [index.states.AZ.key], "ZIP joins come from that state's code table, without prefix, polygon or foreign-state reads");
    assert.deepEqual(targets.filter(target => target.geography === "zcta").map(target => target.geoid).sort(), expectedZips);
    assert.ok(targets.some(target => target.geography === "congressional_district" && target.geoid === "0406"
      && target.divisionId === "ocd-division/country:us/state:az/cd:6"));
    assert.ok(targets.every(target => target.geography === "zcta" || !/^ocd-division\/country:us\/(?:state|territory|district):/.test(target.divisionId)
      || target.divisionId.startsWith("ocd-division/country:us/state:az/")));
    const absent = await heldAcsJoinTargets("04", [], async () => [[]], { ...readonly, readBytes: async () => assert.fail("an absent state must not read artifacts") });
    assert.equal(absent.some(target => target.geography === "zcta"), false, "a missing state index supplies no Census ZIP joins");
    assert.ok(absent.some(target => target.geography === "school_unified"), "native registration joins remain available");
    const malformed: ReadOnlyQuery = async statements => statements[0].text.startsWith("SELECT d AS division") ? [[]]
      : [[{ version_id: "invalid", payload: { ...index, states: { ...index.states, CA: index.states.AZ } } }]];
    await assert.rejects(heldAcsJoinTargets("04", [], malformed, readonly), /state index could not be read/);
    await assert.rejects(heldAcsJoinTargets("04", [], query, { ...readonly, readBytes: async () => null }), /state artifact is unavailable or invalid/);
    const invalid = JSON.parse(gunzipSync((await artifacts.readBytes(index.states.AZ.key))!).toString("utf8"));
    invalid.codes[expectedZips[0]][0][0] = invalid.containers.length;
    const bytes = gzipSync(JSON.stringify(invalid));
    const key = await artifacts.putImmutable(bytes, "json.gz");
    servedIndex = { ...index, states: { AZ: { key, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength } } };
    await assert.rejects(heldAcsJoinTargets("04", [], query, { ...readonly, readBytes: key => artifacts.readBytes(key) }), /ZIP membership is invalid/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
