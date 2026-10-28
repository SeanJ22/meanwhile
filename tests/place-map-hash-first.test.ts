import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { memoryLockManager } from "../lib/control-plane/repository/memory.ts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { censusGeographyCandidate } from "../lib/census-geography/candidate.ts";
import type { BuiltDataset } from "../lib/census-geography/dataset.ts";
import { placeMapDependencyHash, refreshStatePlaceMap } from "../lib/place-map/refresh.ts";

const ROOT = join(import.meta.dirname, "..");
const url = "https://www2.census.gov/geo/docs/maps-data/data/grf/", body = "<html>Acquired source listing</html>";
async function fixture() {
  let bindings = "a".repeat(32), failSource = false, heldZips = 420;
  const order: string[] = [], query: Query = async (text, params) => {
    if (/FROM place_map_counts/.test(text)) {
      assert.deepEqual(params, [["AZ"]]);
      order.push("production map count"); return heldZips ? [{ state: "AZ", zips: heldZips }] : [];
    }
    assert.match(text, /SELECT md5\(coalesce\(jsonb_agg/);
    assert.match(text, /entity_external_id WHERE scheme='census-pid6'/);
    order.push("native binding digest"); return [{ hash: bindings }];
  };
  const dependencies = await placeMapDependencyHash(query, ROOT, "AZ", ["85"]);
  const now = new Date().toISOString(), probe = { formatVersion: 1 as const, dependencies, complete: true, postalPrefixes: ["85"],
    sources: [{ requestedUrl: url, finalUrl: url, rawHash: createHash("sha256").update(body).digest("hex"), checkedAt: now, httpStatus: 200 as const }] };
  const dataset = { ...JSON.parse(readFileSync(join(ROOT, "lib/census-geography/bootstrap-az.json"), "utf8")) as BuiltDataset, builtAt: now };
  const store = new MemoryRoutineDataStore(), candidate = censusGeographyCandidate(dataset, "US-AZ:place-map", probe);
  const first = await processRegisteredRoutineCandidate(store, "place-map-az", candidate, now); assert.ok(first.promoted, first.candidate.failureDetail ?? JSON.stringify(first.candidate.receipt));
  const path = store.readCandidatePath.bind(store);
  store.readCandidatePath = async <T>(id: string, keys: readonly string[]) => {
    assert.deepEqual(keys, ["normalizedPayload", "sourceProbe"]); order.push("saved source digest"); return path<T>(id, keys);
  };
  for (const key of ["readCandidate", "readPromotion", "readCandidateField", "events"] as const)
    Object.assign(store, { [key]: async () => { throw Error(`unchanged map opened ${key}`); } });
  const db: FactDb & { query: Query } = { query, transaction: async () => { throw Error("unchanged map rewrote map facts"); } };
  const options = { cache: { store: new MemoryEvidenceStore(), locks: memoryLockManager() }, fetchImpl: (async input => {
    order.push("actual Census source"); assert.equal(String(input), url);
    return failSource ? new Response(null, { status: 503 }) : new Response(body, { headers: { etag: '"listing"' } });
  }) as typeof fetch };
  order.length = 0;
  return { store, db, options, candidate, order, query, dependencies,
    moveBinding: () => { bindings = "b".repeat(32); }, fail: () => { failSource = true; }, empty: () => { heldZips = 0; } };
}

test("unchanged place-map inputs confirm before held datasets, aliases or map writes are opened", async () => {
  const f = await fixture();
  const result = await refreshStatePlaceMap(f.db, ROOT, "AZ", f.store, f.options);
  assert.ok(result.confirmed); assert.equal(result.dataset, null); assert.equal(result.map, null);
  assert.equal(result.confirmed.head.versionId, f.candidate.id);
  assert.deepEqual(f.order, ["production map count", "saved source digest", "actual Census source", "native binding digest"]);
});

test("an unchanged source never confirms a state map production holds no ZIPs for: the map is loaded again", async () => {
  const f = await fixture(); f.empty(); f.fail();
  // The full load starts with the state's actual Census sources; this fixture refuses them, so it stops there.
  await assert.rejects(refreshStatePlaceMap(f.db, ROOT, "AZ", f.store, f.options));
  assert.deepEqual(f.order.slice(0, 1), ["production map count"]);
  assert.ok(!f.order.includes("saved source digest"), "the saved digest is never read to confirm an empty map");
  assert.equal((await f.store.readPromotionIdentity("CENSUS_GEOGRAPHY", "US-AZ:place-map"))?.versionId, f.candidate.id, "the prior pointer stays");
});

test("a changed native government binding invalidates the map source digest and cannot bless an earlier map snapshot", async () => {
  const f = await fixture(); f.moveBinding();
  assert.notEqual(await placeMapDependencyHash(f.query, ROOT, "AZ", ["85"]), f.dependencies);
  await assert.rejects(placeMapDependencyHash(f.query, ROOT, "AZ", ["85"], "a".repeat(32)), /PLACE_MAP_NATIVE_BINDINGS_MOVED/);
});

test("a failed Census source check retains the exact map pointer and performs no alias or map work", async () => {
  const f = await fixture(); f.fail();
  await assert.rejects(refreshStatePlaceMap(f.db, ROOT, "AZ", f.store, f.options), /503/);
  assert.deepEqual(f.order, ["production map count", "saved source digest", "actual Census source"]);
  assert.equal((await f.store.readPromotionIdentity("CENSUS_GEOGRAPHY", "US-AZ:place-map"))?.versionId, f.candidate.id);
});


test("actual Census map inputs have source authority while unrelated routes and lookalike hosts stay refused", () => {
  for (const source of [
    "https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt",
    "https://www2.census.gov/geo/docs/maps-data/data/grf/2026/public_grfc_cur26_04.txt",
    "https://www2.census.gov/geo/tiger/TIGER2026/SLDU/tl_2026_04_sldu.zip",
    "https://www2.census.gov/programs-surveys/metro-micro/geographies/reference-files/2023/delineation-files/list1_2023.xlsx",
  ]) assert.equal(authorityFor("census-geography-relationships", "CENSUS_GEOGRAPHY", source).ok, true, source);
  for (const source of ["https://www2.census.gov.example.org/geo/tiger/TIGER2026/SLDU/tl_2026_04_sldu.zip",
    "https://www2.census.gov/unrelated/source.txt", "https://example.gov/geo/docs/maps-data/data/grf/2026/public_grfc_cur26_04.txt"])
    assert.equal(authorityFor("census-geography-relationships", "CENSUS_GEOGRAPHY", source).ok, false, source);
});
