import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const DIR = join(ROOT, "data", "derived", "zip-divisions");

interface Shard {
  readonly formatVersion: number;
  readonly divisions: readonly string[];
  readonly zips: Readonly<Record<string, readonly number[]>>;
  readonly partial: Readonly<Record<string, readonly number[]>>;
  readonly zipSamples: Readonly<Record<string, number>>;
}
interface Index {
  readonly formatVersion: number;
  readonly counts: { readonly zips: number; readonly shards: number; readonly edgesWithNoOcdId: Readonly<Record<string, number>> };
  readonly shards: Readonly<Record<string, { readonly sha256: string; readonly zips: number; readonly states: readonly string[] }>>;
  readonly statesToShards: Readonly<Record<string, readonly string[]>>;
  readonly inheritedSharedIds: Readonly<Record<string, readonly string[]>>;
  readonly staleInTheOldIndex: readonly string[];
}

const index = JSON.parse(readFileSync(join(DIR, "index.json"), "utf8")) as Index;
const shards = new Map<string, Shard>();
for (const file of readdirSync(DIR)) {
  if (file === "index.json" || !file.endsWith(".json")) continue;
  shards.set(file.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, file), "utf8")) as Shard);
}
function divisionsOf(zip: string): string[] {
  const shard = shards.get(zip.slice(0, 2));
  return (shard?.zips[zip] ?? []).map((i) => shard!.divisions[i]);
}

test("every ZIP the national lattice sampled is in exactly its prefix's shard, and every shard is what the index says", () => {
  const national = JSON.parse(readFileSync(join(ROOT, "data", "derived", "zip-governments.json"), "utf8")) as { zips: Record<string, unknown> };
  const expected = Object.keys(national.zips);
  assert.equal(expected.length, 33_791);
  assert.equal(index.counts.zips, expected.length);
  assert.deepEqual(index.counts.edgesWithNoOcdId, {}, "every edge the lattice found is given an id");
  assert.equal(shards.size, index.counts.shards);
  assert.deepEqual([...shards.keys()].sort(), Object.keys(index.shards).sort(), "the index names every shard file and no other");

  const seen = new Set<string>();
  for (const [name, shard] of shards) {
    const text = readFileSync(join(DIR, `${name}.json`), "utf8");
    assert.equal(createHash("sha256").update(text).digest("hex"), index.shards[name].sha256, `${name}.json matches its recorded sha256`);
    assert.equal(Object.keys(shard.zips).length, index.shards[name].zips);
    assert.equal(new Set(shard.divisions).size, shard.divisions.length, `${name}.json holds each division once`);
    for (const [zip, refs] of Object.entries(shard.zips)) {
      assert.equal(zip.slice(0, 2), name, `${zip} sits in its own prefix's shard`);
      assert.ok(!seen.has(zip), `${zip} appears once`);
      seen.add(zip);
      assert.ok(refs.length > 0 && refs.every((i) => Number.isInteger(i) && i >= 0 && i < shard.divisions.length), `${zip}'s references are in range`);
      for (const i of shard.partial[zip] ?? []) assert.ok(refs.includes(i), `${zip}: a partial division is one of its divisions`);
      assert.ok((shard.zipSamples[zip] ?? 0) > 0, `${zip} carries its sample total`);
      const residents = (shard as Shard & { residents?: Record<string, number[]> }).residents?.[zip];
      if (residents) assert.equal(residents.length, refs.length, `${zip}: one resident count per division`);
    }
  }
  assert.equal(seen.size, expected.length);
  for (const zip of expected) assert.ok(seen.has(zip), `${zip} is indexed`);
});

test("a code resolves to its governments anywhere, and the three-state index's ZIPs keep what the committed geometry carries", () => {
  const columbus = divisionsOf("43215");
  assert.ok(columbus.includes("ocd-division/country:us/state:oh/county:franklin"));
  assert.ok(columbus.includes("ocd-division/country:us/state:oh/place:columbus"));
  assert.ok(columbus.includes("ocd-division/country:us/state:oh/school_district:columbus_city_school_district"));
  assert.deepEqual(index.statesToShards.OH.length > 0, true);
  assert.equal(Object.keys(index.statesToShards).length, 56, "every state, DC and the territories the lattice reached");

  const rockaway = divisionsOf("07866");
  for (const id of [
    "ocd-division/country:us/state:nj/county:morris",
    "ocd-division/country:us/state:nj/county:morris/place:rockaway_borough",
    "ocd-division/country:us/state:nj/county:morris/place:rockaway_township",
    "ocd-division/country:us/state:nj/school_district:morris_hills_regional_school_district",
  ]) assert.ok(rockaway.includes(id), `07866 carries ${id}`);
  assert.ok(divisionsOf("03255").includes("ocd-division/country:us/state:nh/county:merrimack/place:newbury_town"));
  assert.ok(divisionsOf("85701").includes("ocd-division/country:us/state:az/place:tucson"));

  const old = JSON.parse(readFileSync(join(ROOT, "tests", "fixtures", "zip-division-ids-three-state.json"), "utf8")) as { zips: Record<string, string[]> };
  for (const [zip, ids] of Object.entries(old.zips)) {
    const now = new Set(divisionsOf(zip));
    for (const id of ids) {
      if (index.staleInTheOldIndex.includes(id)) continue;
      assert.ok(now.has(id), `${zip} keeps ${id}`);
    }
  }
  // The one stale id is named, and its ZIPs now carry the id the registry keys the body on.
  assert.deepEqual(index.staleInTheOldIndex, ["ocd-division/country:us/state:nj/school_district:washington_township_school_district"]);
  assert.ok(divisionsOf("07870").includes("ocd-division/country:us/state:nj/school_district:washington_township_school_district_3417130"));
  assert.deepEqual(Object.keys(index.inheritedSharedIds), ["ocd-division/country:us/state:nj/school_district:union_township_school_district"], "the one shared id is inherited and named");
});
