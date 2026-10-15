import assert from "node:assert/strict";
import test from "node:test";

import { acquireDataset, acquireStateDatasets, DEFAULT_SCOPES } from "../lib/census-geography/acquire.ts";
import { acquireGrfScopes, GRF_2026_TARGETS, GRF_ROOT, grfTargetsFromNames } from "../lib/census-geography/grf.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { isSourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-error.ts";
import { buildWorkbook } from "../scripts/xlsx.mjs";
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import type { CensusDistrictStateInput } from "../lib/census-geography/district-edge.ts";

const HEADER = "TABBLKST|TABBLKCOU|ZCTA5CE|CDDECFP|CDCURFP|SLDUST|SLDLST|AREALAND";
const BLOCKS = `${HEADER}\n04|019|85701|03|07|020|020|100\n04|019|85641|02|06|017|017|60\n04|019|85641|02|06|019|019|40\n`;
const NAMES = "TABBLKST|CDSESSN|LSY\n04|120|2026\n";
const GRF_KEYS = ["cd120", "sldu2026", "sldl2026"];
function cache() { return { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks }; }
function listing(names: readonly string[]): string { return names.map(name => `<a href="${name}">${name}</a>`).join("\n"); }
function harness(year = 2026, session = 120, legislativeYear = 2026) {
  const root = `${GRF_ROOT}${year}/`, suffix = String(year).slice(-2);
  const blockUrl = `${root}public_grfc_cur${suffix}_04.txt`, namesUrl = `${root}public_grfn_cur${suffix}_04.txt`;
  const requests: { url: string; method: string }[] = [];
  let blocks = BLOCKS, etag = '"blocks-1"';
  const documents = new Map<string, string>([
    [GRF_ROOT, listing([`${year}/`])],
    [root, listing([`public_grfc_cur${suffix}_04.txt`, `public_grfn_cur${suffix}_04.txt`])],
    [namesUrl, NAMES.replace("120|2026", `${session}|${legislativeYear}`)],
    ["https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/", "<html></html>"],
    ["https://www2.census.gov/geo/tiger/", listing([`TIGER${year}/`])],
    [`https://www2.census.gov/geo/tiger/TIGER${year}/`, listing(["CD/"])],
    [`https://www2.census.gov/geo/tiger/TIGER${year}/CD/`, listing([`tl_${year}_04_cd${session}.zip`])],
  ]);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? "GET";
    requests.push({ url, method });
    const text = url === blockUrl ? blocks : documents.get(url);
    if (text === undefined) return new Response(null, { status: 404 });
    const tag = url === blockUrl ? etag : '"stable"';
    const headers = { etag: tag, "content-length": String(Buffer.byteLength(text)) };
    if (new Headers(init?.headers).get("if-none-match") === tag) return new Response(null, { status: 304, headers });
    return new Response(method === "HEAD" ? null : text, { headers });
  }) as typeof fetch;
  return { fetchImpl, requests, blockUrl, documents, change: (text: string) => { blocks = text; etag = '"blocks-2"'; } };
}

test("routine defaults hold the three Census 2026 district plans", () => {
  assert.ok(GRF_KEYS.every(key => DEFAULT_SCOPES.includes(key)));
});

test("one state GRF download supplies House, Senate and State House, and a fresh HEAD reuses unchanged held rows", async () => {
  const h = harness(), options = { only: GRF_KEYS, states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: cache() };
  const first = await acquireDataset(options);
  assert.deepEqual(first.scopes.map(scope => scope.version).sort(), ["cd:120", "sldl:2026", "sldu:2026"]);
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "GET").length, 1);
  for (const scope of first.scopes) {
    assert.equal(scope.versionMeta.retrievalComplete, true);
    assert.equal(scope.versionMeta.provenance.sourceFiles.length, scope.versionMeta.provenance.sourceChecksums.length);
    assert.equal(scope.groupings.find(group => group.overlaps.some(overlap => overlap.zcta5 === "85701"))!.geoid,
      scope.version === "cd:120" ? "0407" : "04020");
    assert.equal(scope.groupings.filter(group => group.overlaps.some(overlap => overlap.zcta5 === "85641")).length,
      scope.version === "cd:120" ? 1 : 2);
  }
  const second = await acquireDataset({ ...options, previousDataset: first });
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "GET").length, 1);
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "HEAD").length, 1);
  assert.deepEqual(second.scopes.map(scope => scope.groupings), first.scopes.map(scope => scope.groupings));

  h.change(BLOCKS.replace("|07|020|020|100", "|08|021|021|100"));
  const third = await acquireDataset({ ...options, previousDataset: second });
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "GET").length, 2);
  assert.equal(third.scopes.find(scope => scope.version === "cd:120")!.groupings.find(group => group.overlaps.some(overlap => overlap.zcta5 === "85701"))!.geoid, "0408");
});

test("new GRF and TIGER releases discover actual grfn plans without changing the scope registry", async () => {
  const h = harness(2028, 121, 2028);
  const dataset = await acquireDataset({ only: GRF_KEYS, discoverPlans: true, states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: cache() });
  assert.deepEqual(dataset.scopes.map(scope => scope.version).sort(), ["cd:121", "sldl:2028", "sldu:2028"]);
  assert.deepEqual(dataset.scopes.find(scope => scope.version === "cd:121")!.versionMeta.applicability, [
    { purpose: "election", from: "2028-11-07" }, { purpose: "representation", from: "2029-01-03" },
  ]);
  const release = { year: 2028, files: [h.blockUrl, `${GRF_ROOT}2028/public_grfn_cur28_04.txt`] };
  const scopes = await acquireGrfScopes(GRF_2026_TARGETS, { release, states: new Set(["04"]), fetchImpl: harness(2028, 120, 2026).fetchImpl, cache: cache() });
  assert.deepEqual(scopes.map(scope => scope.version).sort(), ["cd:120", "sldl:2026", "sldu:2026"], "directory year does not invent a plan year");
});

test("complete evidence for an unassigned district family reuses its empty held rows", async () => {
  const h = harness();
  h.change(`${HEADER}\n04|019|85701|03|07|020|ZZZ|100\n04|019|85641|02|06|017|999|100\n`);
  const options = { only: GRF_KEYS, states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: cache() };
  const first = await acquireDataset(options);
  const lower = first.scopes.find(scope => scope.version === "sldl:2026")!;
  assert.equal(lower.versionMeta.retrievalComplete, true);
  assert.equal(lower.groupings.length, 0);
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "GET").length, 1);

  const second = await acquireDataset({ ...options, previousDataset: first });
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "HEAD").length, 1);
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "GET").length, 1);
  assert.deepEqual(second.scopes.find(scope => scope.version === "sldl:2026")!.groupings, []);
  assert.deepEqual(second.scopes.map(scope => scope.groupings), first.scopes.map(scope => scope.groupings));
});

test("a newly published TIGER district relationship is acquired from its official file listing", async () => {
  const h = harness();
  const url = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd12120_zcta520_natl.txt";
  h.documents.set(url.slice(0, url.lastIndexOf("/") + 1), listing(["tab20_cd12120_zcta520_natl.txt"]));
  h.documents.set(url, "GEOID_CD121_20|NAMELSAD_CD121_20|AREALAND_CD121_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n0407|Congressional District 7|100|85701|100|100\n");
  const dataset = await acquireDataset({ only: GRF_KEYS, discoverPlans: true, states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: cache() });
  assert.equal(dataset.scopes.find(scope => scope.version === "cd:121")!.groupings[0].geoid, "0407");
  assert.ok(h.requests.some(row => row.url === url));
});

test("a failed or malformed changed block release leaves held parsed evidence intact", async () => {
  const h = harness(), options = { only: GRF_KEYS, states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: cache() };
  const held = await acquireDataset(options), original = structuredClone(held);
  h.change(`${HEADER}\n04|019|85701|03|07|020\n`);
  await assert.rejects(acquireDataset({ ...options, previousDataset: held }), isSourceAcquisitionFailure);
  assert.deepEqual(held, original);
});

test("a HEAD transport failure is recorded as publisher unavailable and preserves held data", async () => {
  const h = harness(), options = { only: GRF_KEYS, states: new Set(["04"]), fetchImpl: h.fetchImpl, cache: cache() };
  const held = await acquireDataset(options), original = structuredClone(held);
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === "HEAD") throw new TypeError("fetch failed");
    return h.fetchImpl(input, init);
  }) as typeof fetch;
  await assert.rejects(acquireDataset({ ...options, fetchImpl, previousDataset: held }), error =>
    isSourceAcquisitionFailure(error) && error.code === "PUBLISHER_UNAVAILABLE");
  assert.deepEqual(held, original);
  assert.equal(h.requests.filter(row => row.url === h.blockUrl && row.method === "GET").length, 1);
});

test("national GRF completeness excludes unpublished territories, and missing requested state files fail", async () => {
  const h = harness();
  const files: string[] = [];
  for (const [fips, state] of Object.entries(FIPS_TO_STATE)) {
    if (state.prefix === "territory") continue;
    const blockUrl = `${GRF_ROOT}2026/public_grfc_cur26_${fips}.txt`, namesUrl = `${GRF_ROOT}2026/public_grfn_cur26_${fips}.txt`;
    files.push(blockUrl, namesUrl);
    h.documents.set(blockUrl, BLOCKS.replaceAll("\n04|", `\n${fips}|`));
    h.documents.set(namesUrl, NAMES.replace("\n04|", `\n${fips}|`));
  }
  const scopes = await acquireGrfScopes(GRF_2026_TARGETS, { release: { year: 2026, files }, fetchImpl: h.fetchImpl, cache: cache() });
  assert.ok(scopes.every(scope => scope.versionMeta.retrievalComplete === true));
  assert.equal(h.requests.filter(row => /public_grfc/.test(row.url) && row.method === "GET").length, 51);
  await assert.rejects(acquireGrfScopes(GRF_2026_TARGETS, { release: { year: 2026, files: [h.blockUrl] }, fetchImpl: h.fetchImpl, cache: cache() }), /missing requested state files/);
  await assert.rejects(acquireGrfScopes(GRF_2026_TARGETS, { release: { year: 2026, files: [h.blockUrl] }, states: new Set(["48"]), fetchImpl: h.fetchImpl, cache: cache() }), /missing requested state files: 48/);
});

test("grfn metadata must establish a single actual Congress and legislative plan", () => {
  assert.deepEqual(grfTargetsFromNames(NAMES).map(target => target.version), ["cd:120", "sldu:2026", "sldl:2026"]);
  assert.throws(() => grfTargetsFromNames("TABBLKST|CDSESSN|LSY\n04|120|2026\n04|121|2026\n"), /one CDSESSN/);
});

test("national source rows are partitioned once before each state's overlaps are built", async () => {
  const calls: string[] = [];
  const url = "https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt";
  const body = "GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n23001|First County|60|00001|100|60\n33001|Second County|40|00001|100|40\n";
  const fetchImpl = (async (input, init) => {
    calls.push(`${init?.method ?? "GET"} ${String(input)}`);
    assert.equal(String(input), url);
    return new Response(body, { headers: { etag: '"unchanged"', "content-length": String(Buffer.byteLength(body)) } });
  }) as typeof fetch;
  const states = [];
  for await (const input of acquireStateDatasets({ only: ["county"], states: new Set(["23", "33"]), fetchImpl, cache: cache() })) states.push(input);
  assert.deepEqual(calls, [`GET ${url}`]);
  assert.deepEqual(states.map(input => input.state), ["ME", "NH"]);
  assert.deepEqual(states.map(input => input.dataset.scopes[0].groupings.map(group => group.geoid)), [["23001"], ["33001"]]);
  assert.deepEqual(states.map(input => input.dataset.scopes[0].groupings[0].overlaps[0].fraction), [0.6, 0.4]);
  assert.ok(states.every(input => input.dataset.zctaUniverse.join() === "00001"));
});

test("a place acquisition cannot load several states", async () => {
  await assert.rejects(acquireDataset({ only: ["county"] }), /exactly one state/);
  await assert.rejects(acquireDataset({ only: ["county"], states: new Set(["23", "33"]) }), /exactly one state/);
});

test("unchanged national source checks once and loads held state artifacts lazily", async () => {
  const calls: string[] = [], sourceCache = cache();
  const body = "GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n23001|First County|60|00001|100|60\n33001|Second County|40|00001|100|40\n";
  const fetchImpl = (async (_input, init) => {
    calls.push(init?.method ?? "GET");
    return new Response(init?.method === "HEAD" ? null : body, { status: init?.method === "HEAD" ? 304 : 200,
      headers: { etag: '"unchanged"', "content-length": String(Buffer.byteLength(body)) } });
  }) as typeof fetch;
  const options = { only: ["county"], states: new Set(["23", "33"]), fetchImpl, cache: sourceCache };
  const first: CensusDistrictStateInput[] = [];
  for await (const input of acquireStateDatasets(options)) first.push(input);
  const loaded: string[] = [];
  for await (const input of acquireStateDatasets({ ...options, previousScopes: first[0].dataset.scopes,
    previousStateDataset: async state => { loaded.push(state); return first.find(value => value.state === state)?.dataset; },
  })) assert.equal(input.dataset.scopes[0], first.find(value => value.state === input.state)?.dataset.scopes[0]);
  assert.deepEqual(calls, ["GET", "HEAD"]);
  assert.deepEqual(loaded, ["ME", "NH"]);
});

test("a state keeps exact cross-state metro shares without retaining foreign ZIPs", async () => {
  const xlsx = buildWorkbook([{ name: "Areas", widths: [],
    header: ["CBSA Code", "CBSA Title", "Metropolitan/Micropolitan Statistical Area", "FIPS State Code", "FIPS County Code"],
    rows: [["12345", "Shared metro", "Metropolitan Statistical Area", "23", "001"],
      ["12345", "Shared metro", "Metropolitan Statistical Area", "33", "001"]],
  }], "2026-01-01");
  const county = "GEOID_COUNTY_20|NAMELSAD_COUNTY_20|AREALAND_COUNTY_20|GEOID_ZCTA5_20|AREALAND_ZCTA5_20|AREALAND_PART\n23001|First County|60|00001|100|60\n33001|Second County|40|00001|100|40\n33001|Second County|100|00002|100|100\n";
  const gets: string[] = [];
  const fetchImpl = (async input => {
    const url = String(input); gets.push(url);
    return new Response(url.endsWith(".xlsx") ? Uint8Array.from(xlsx) : county);
  }) as typeof fetch;
  const states = [];
  for await (const input of acquireStateDatasets({ only: ["county", "cbsa"], states: new Set(["23", "33"]), fetchImpl, cache: cache() })) states.push(input);
  assert.equal(gets.length, 2);
  const first = states[0].dataset, second = states[1].dataset;
  assert.deepEqual(first.zctaUniverse, ["00001"]);
  assert.deepEqual(second.zctaUniverse, ["00001", "00002"]);
  assert.deepEqual(first.scopes.find(scope => scope.type === "cbsa")!.groupings[0].overlaps,
    [{ zcta5: "00001", fraction: 1, whole: true }]);
  assert.deepEqual(second.scopes.find(scope => scope.type === "cbsa")!.groupings[0].overlaps,
    [{ zcta5: "00001", fraction: 1, whole: true }, { zcta5: "00002", fraction: 1, whole: true }]);
});
