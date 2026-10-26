import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { refreshCensusGeography } from "../lib/census-geography/refresh.ts";
import { GRF_ROOT } from "../lib/census-geography/grf.ts";
import { CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE } from "../lib/census-geography/publication.ts";
import { censusProbeHash, censusSourceDependencies } from "../lib/census-geography/source-probe.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";

function harness() {
  const documents = new Map<string, string>(), requests: string[] = [];
  const listing = (names: readonly string[]) => names.map(name => `<a href="${name}">${name}</a>`).join("\n");
  const addYear = (year: number, session: number, plan: number) => {
    const root = `${GRF_ROOT}${year}/`, suffix = String(year).slice(-2);
    documents.set(root, listing([`public_grfc_cur${suffix}_04.txt`, `public_grfn_cur${suffix}_04.txt`]));
    documents.set(`${root}public_grfn_cur${suffix}_04.txt`, `TABBLKST|CDSESSN|LSY\n04|${session}|${plan}\n`);
    documents.set(`${root}public_grfc_cur${suffix}_04.txt`, "TABBLKST|ZCTA5CE|CDCURFP|SLDUST|SLDLST|AREALAND\n04|85701|07|020|020|100\n");
  };
  addYear(2026, 120, 2026);
  documents.set(GRF_ROOT, listing(["2026/"]));
  documents.set("https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/", "<html></html>");
  documents.set("https://www2.census.gov/geo/tiger/", listing(["TIGER2026/"]));
  documents.set("https://www2.census.gov/geo/tiger/TIGER2026/", "<html></html>");
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input); requests.push(url);
    const body = documents.get(url); assert.notEqual(body, undefined, `unexpected source ${url}`);
    const etag = JSON.stringify(body), headers = { etag, "content-length": String(Buffer.byteLength(body!)) };
    if (new Headers(init?.headers).get("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(init?.method === "HEAD" ? null : body, { headers });
  }) as typeof fetch;
  return { documents, addYear, listing, requests, options: { fetchImpl,
    only: ["cd120", "sldu2026", "sldl2026"], states: new Set(["04"]),
    cache: { store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks } } };
}

test("unchanged exact Census inputs confirm without opening a held dataset, candidate or history", async () => {
  const h = harness(), store = new MemoryRoutineDataStore();
  const first = await refreshCensusGeography(store, h.options); assert.ok(first.outcome?.promoted);
  assert.equal(first.candidate?.retrieval.rawHashBasis, "SOURCE_CONTENT_V1");
  const path = store.readCandidatePath.bind(store), reads: string[] = [];
  store.readCandidatePath = async <T>(id: string, keys: readonly string[]) => {
    reads.push(keys.join(".")); assert.deepEqual(keys, ["normalizedPayload", "sourceProbe"]);
    return path<T>(id, keys);
  };
  for (const key of ["readCandidate", "readPromotion", "readCandidateField", "events"] as const)
    Object.assign(store, { [key]: async () => { throw Error(`unchanged Census opened ${key}`); } });
  const again = await refreshCensusGeography(store, h.options);
  assert.ok(again.confirmed); assert.equal(again.candidate, null); assert.equal(again.outcome, null);
  assert.equal(again.confirmed.head.versionId, first.candidate!.id);
  assert.deepEqual(reads, ["normalizedPayload.sourceProbe"]);
});

test("a newly discovered native plan changes the hash and retains every established older plan", async () => {
  const h = harness(), store = new MemoryRoutineDataStore();
  const first = await refreshCensusGeography(store, h.options); assert.ok(first.outcome?.promoted);
  h.addYear(2027, 121, 2028); h.documents.set(GRF_ROOT, h.listing(["2027/", "2026/"]));
  const next = await refreshCensusGeography(store, h.options); assert.ok(next.outcome?.promoted, next.outcome?.candidate.failureDetail ?? "");
  assert.notEqual(next.candidate?.retrieval.rawHash, first.candidate?.retrieval.rawHash);
  const before = first.candidate!.readModel as BuiltDataset, after = next.candidate!.readModel as BuiltDataset;
  for (const scope of before.scopes) assert.deepEqual(after.scopes.find(row => row.version === scope.version)?.groupings, scope.groupings);
  for (const version of ["cd:121", "sldu:2028", "sldl:2028"]) assert.ok(after.scopes.some(scope => scope.version === version));
});

test("bad changed source bytes retain the exact GOOD pointer and never confirm", async () => {
  const h = harness(), store = new MemoryRoutineDataStore();
  const first = await refreshCensusGeography(store, h.options); assert.ok(first.outcome?.promoted);
  h.documents.set(`${GRF_ROOT}2026/public_grfc_cur26_04.txt`, "truncated");
  await assert.rejects(refreshCensusGeography(store, h.options), /header|parsed|malformed/i);
  assert.equal((await store.readPromotionIdentity(CENSUS_GEO_RECORD_CLASS, CENSUS_GEO_SCOPE))?.versionId, first.candidate!.id);
});

test("geography source identity includes parser and selection dependencies but excludes observation times", () => {
  const dependencies = censusSourceDependencies({ states: ["04"] });
  const source = { requestedUrl: GRF_ROOT, finalUrl: GRF_ROOT, rawHash: "a".repeat(64), checkedAt: "2026-10-26T00:00:00.000Z" };
  const probe = { formatVersion: 1 as const, dependencies, sources: [source], complete: true };
  assert.equal(censusProbeHash(probe), censusProbeHash({ ...probe, sources: [{ ...source, checkedAt: "2026-10-27T00:00:00.000Z" }] }));
  assert.notEqual(censusProbeHash(probe), censusProbeHash({ ...probe, dependencies: censusSourceDependencies({ states: ["06"] }) }));
  assert.notEqual(censusProbeHash(probe), censusProbeHash({ ...probe, dependencies: "b".repeat(64) }));
});
