import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { acquireDataset } from "../lib/census-geography/acquire.ts";
import { acquireTigerScopes, discoverTigerDistrictFiles, TIGER_ROOT, TIGER_ZCTA_2020 } from "../lib/census-geography/tiger-acquire.ts";
import { buildCensusDistrictEdge } from "../lib/census-geography/district-edge.ts";
import { selectGeographyVersion } from "../lib/census-geography/selection.ts";
import { geographyOfRows } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import { CENSUS_GEO_CONTRACT_ID, CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { createLookup } from "../lib/census-geography/lookup.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";

/** All HTTP responses come from committed schema samples. Coordinates and
 * ZIPs are artificial and make no claim about an actual state's geography. */
function harness() {
  const documents = new Map<string, Uint8Array>();
  const putText = (url: string, text: string) => documents.set(url, new TextEncoder().encode(text));
  const listing = (...files: string[]) => `<html>${files.map(file => `<a href="${file}">${file}</a>`).join("\n")}</html>`;
  const root = `${TIGER_ROOT}TIGER2028/`, grf = "https://www2.census.gov/geo/docs/maps-data/data/grf/";
  putText(TIGER_ROOT, listing("TIGER2028/"));
  putText(root, listing("CD/", "SLDU/", "SLDL/"));
  for (const [folder, file] of [["CD", "tl_2028_04_cd121.zip"], ["SLDU", "tl_2028_04_sldu.zip"], ["SLDL", "tl_2028_04_sldl.zip"]]) {
    putText(`${root}${folder}/`, listing(file));
    documents.set(`${root}${folder}/${file}`, Uint8Array.from(readFileSync(join(import.meta.dirname, "fixtures/census-tiger", file))));
  }
  documents.set(TIGER_ZCTA_2020, Uint8Array.from(readFileSync(join(import.meta.dirname, "fixtures/census-tiger/tl_2020_us_zcta520.zip"))));
  putText(`${grf}`, listing("2026/"));
  putText(`${grf}2026/`, listing("public_grfc_cur26_04.txt", "public_grfn_cur26_04.txt"));
  putText(`${grf}2026/public_grfn_cur26_04.txt`, "TABBLKST|CDSESSN|LSY\n04|120|2026\n");
  putText(`${grf}2026/public_grfc_cur26_04.txt`, "TABBLKST|ZCTA5CE|CDCURFP|SLDUST|SLDLST|AREALAND\n04|90001|01|001|001|100\n");
  putText("https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/", listing());
  putText("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt",
    "GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n" +
    Array.from({ length: 8 }, (_, i) => `04001|Sample County|800|9000${i + 1}|100|100\n`).join(""));
  const requests: { url: string; method: string; body: boolean }[] = [];
  let revision = "1";
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET", bytes = documents.get(url);
    if (!bytes) { requests.push({ url, method, body: false }); return new Response(null, { status: 404 }); }
    const etag = `"${url}-${revision}"`, headers = { etag, "content-length": String(bytes.length) };
    if (new Headers(init?.headers).get("if-none-match") === etag) {
      requests.push({ url, method, body: false }); return new Response(null, { status: 304, headers });
    }
    requests.push({ url, method, body: method !== "HEAD" });
    return new Response(method === "HEAD" ? null : Uint8Array.from(bytes), { headers });
  }) as typeof fetch;
  const cache = { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks };
  return { documents, putText, requests, fetchImpl, cache, root, change: () => { revision = "2"; } };
}

test("the routine discovers and acquires all three TIGER-only successor plans from committed files", async () => {
  const h = harness();
  const dataset = await acquireDataset({ only: ["cd120", "sldu2026", "sldl2026"], discoverPlans: true,
    states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: h.cache });
  assert.deepEqual(dataset.scopes.map(scope => scope.version).sort(), ["cd:120", "cd:121", "sldl:2026", "sldl:2028", "sldu:2026", "sldu:2028"]);
  for (const version of ["cd:121", "sldu:2028", "sldl:2028"]) {
    const scope = dataset.scopes.find(scope => scope.version === version)!;
    assert.equal(scope.versionMeta.retrievalComplete, true);
    assert.deepEqual(scope.versionMeta.states, ["AZ"]);
    assert.equal(scope.fractionBasis, "unknown");
    assert.equal(scope.groupings.length, 2);
    const one = scope.groupings.find(group => group.geoid.endsWith(version.startsWith("cd:") ? "01" : "001"))!;
    assert.equal(one.overlaps.find(overlap => overlap.zcta5 === "90001")!.whole, true);
    assert.equal(one.overlaps.find(overlap => overlap.zcta5 === "90002")!.whole, false);
    assert.ok(scope.groupings.every(group => group.overlaps.every(overlap => overlap.fraction === null)));
    assert.equal(scope.versionMeta.provenance.sourceFiles.length, scope.versionMeta.provenance.sourceChecksums.length);
  }
  assert.equal(h.requests.filter(request => request.url === TIGER_ZCTA_2020 && request.body).length, 1, "the national compressed ZIP is downloaded once for all three state joins");
  const versions = dataset.scopes.map(scope => scope.versionMeta);
  const election = { purpose: "election" as const, asOf: "2028-10-01", electionDate: "2028-11-07" };
  assert.equal(selectGeographyVersion(versions, "congressional_district", election, "AZ")?.key, "cd:121");
  assert.equal(selectGeographyVersion(versions, "congressional_district", election, "TX")?.key, "cd:120", "one state's new plan does not supersede another state's held plan");
  const edge = buildCensusDistrictEdge(dataset, "offline-tiger-test");
  assert.deepEqual(edge.scopes.find(scope => scope.version === "cd:121")!.states, ["AZ"]);

  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredRoutineCandidate(store, CENSUS_GEO_CONTRACT_ID, censusGeographyCandidate(dataset), dataset.builtAt);
  assert.ok(outcome.promoted, `TIGER memberships must pass the routine publication door: ${outcome.candidate.state}`);
  const read = await readPromotedCivicData<BuiltDataset>(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE, { store, now: dataset.builtAt, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") return;
  const lookup = createLookup(read.value, read.projection.versionId);
  const memberships = await lookup.groupingsForZcta("90002");
  assert.equal(memberships.status.kind, "OK");
  const congress = memberships.memberships.filter(membership => membership.geography.version === "cd:121");
  assert.equal(congress.length, 2, "the promoted reader retains both sides of the TIGER split");
  assert.ok(congress.every(membership => membership.fraction === null && membership.fractionBasis === "unknown"));
});

test("a checked TIGER holding skips unchanged ZIP bodies and retains complete per-state rows", async () => {
  const h = harness(), files = await discoverTigerDistrictFiles({ fetchImpl: h.fetchImpl, cache: h.cache }, new Set(["04"]));
  const options = { fetchImpl: h.fetchImpl, cache: h.cache, heldScopes: [] };
  const first = await acquireTigerScopes(files, options);
  const bodies = h.requests.filter(request => request.body && request.url.endsWith(".zip")).length;
  const second = await acquireTigerScopes(files, { ...options, heldScopes: first });
  assert.equal(h.requests.filter(request => request.body && request.url.endsWith(".zip")).length, bodies);
  assert.deepEqual(second, first);
  assert.equal(h.requests.filter(request => request.method === "HEAD" && request.url === TIGER_ZCTA_2020).length, 1, "the shared ZCTA validator is checked once");
  const previous = Array.from(structuredClone(first));
  previous[0] = { ...previous[0], versionMeta: { ...previous[0].versionMeta, states: ["AZ", "CO"] },
    groupings: [...previous[0].groupings, { ...previous[0].groupings[0], stateFips: "08", stateAbbr: "CO", memberStates: ["CO"], geoid: "0801" }] };
  const merged = await acquireTigerScopes(files, { ...options, heldScopes: previous });
  const cd = merged.find(scope => scope.version === "cd:121")!;
  assert.equal(new Set(cd.groupings.map(group => group.geoid)).size, cd.groupings.length);
  assert.ok(cd.groupings.some(group => group.geoid === "0801"));
});

test("a changed malformed TIGER file preserves the held dataset and archive cache", async () => {
  const h = harness(), files = await discoverTigerDistrictFiles({ fetchImpl: h.fetchImpl, cache: h.cache }, new Set(["04"]));
  const options = { fetchImpl: h.fetchImpl, cache: h.cache, heldScopes: [] };
  const held = await acquireTigerScopes(files, options), original = structuredClone(held);
  const manifests = await h.cache.store.list("project/freshness/source/census-geography-relationships/tiger/");
  const manifestBytes = await Promise.all(manifests.filter(key => key.endsWith("manifest.json")).map(async key => (await h.cache.store.get(key))!.bytes));
  h.documents.set(files[0].url, new Uint8Array([1, 2, 3])); h.change();
  await assert.rejects(acquireTigerScopes(files, { ...options, heldScopes: held }), isSourceAcquisitionFailure);
  assert.deepEqual(held, original);
  const after = await Promise.all(manifests.filter(key => key.endsWith("manifest.json")).map(async key => (await h.cache.store.get(key))!.bytes));
  assert.deepEqual(after, manifestBytes);
});

test("promoted geography carries per-state plan availability into the reader selection", () => {
  const slice = geographyOfRows([{ row_kind: "scope", type: "state_leg_upper", version: "sldu:2028", plan: "2028",
    version_meta: { states: ["AZ"], applicability: [{ purpose: "election", from: "2028-11-07" }], retrievalComplete: true } }], false);
  assert.deepEqual(slice.scopes[0].states, ["AZ"]);
  const versions = [{ key: "sldu:2026", type: "state_leg_upper" as const }, { ...slice.scopes[0], key: "sldu:2028" }];
  const selection = { purpose: "election" as const, asOf: "2028-10-01", electionDate: "2028-11-07" };
  assert.equal(selectGeographyVersion(versions, "state_leg_upper", selection, "AZ")?.key, "sldu:2028");
  assert.equal(selectGeographyVersion(versions, "state_leg_upper", selection, "MI")?.key, "sldu:2026");
});
