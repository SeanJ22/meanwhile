import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { districtSourceName, type DistrictBoundarySources } from "../lib/registration/district-sources.ts";
import { loadRegistrationReference } from "../lib/registration/reference.ts";
import { ensureFactEntities } from "../lib/facts/entities.ts";
import { factDb } from "./helpers/fact-db.ts";
import { shardEntry, type ZipDivisionShard } from "../lib/geo/zip-division-index.ts";

const root = process.cwd();
const sources = (JSON.parse(readFileSync("data/reference/district-boundary-sources.json", "utf8")) as DistrictBoundarySources).sources;
const government = "nv:special:washoe-rural-fire";
const place = "ocd-division/country:us/state:nv/special_district:washoe_rural_fire";

test("Washoe Rural uses the district's county boundary and the WFPP source cannot regenerate its competing record", () => {
  const county = sources.find(s => s.id === "nv-washoe-county-fire-protection-districts-4d2236")!;
  const wfpp = sources.find(s => s.id === "nv-nevada-wildland-fire-protection-program-wfpp-fire-protect-22a553")!;
  assert.equal(districtSourceName(wfpp, { District: "Washoe Rural" }), null);
  assert.equal(districtSourceName(wfpp, { District: " WASHOE RURAL " }), null);
  assert.equal(districtSourceName(wfpp, { District: "White Pine County" }), "White Pine County");
  assert.equal(districtSourceName(county, { District: "WASHOE RURAL" }), "WASHOE RURAL");
  const ref = loadRegistrationReference(root, "nv").reference;
  const rows = ref.governments.filter(g => g[1] === government);
  assert.equal(rows.length, 1);
  const division = ref.divisions[rows[0][4]];
  assert.equal(division[0], place);
  assert.equal(division[2], `${county.id}#0`);
  assert.equal(ref.boundarySources![county.id].officialPage, county.officialPage);
  assert.equal(ref.divisions.filter(d => /washoe_rural_fire/.test(d[0])).length, 1);
});

test("Nevada imports its reconciled territory and preserves it on an unchanged scheduled reload", async () => {
  const db = await factDb();
  try {
    assert.deepEqual(await ensureFactEntities(db, root, ["nv"]), ["nv"]);
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id=$1", [government]), [{ parent_id: place }]);
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1", [government]), [{ place_id: place }]);
    assert.deepEqual(await ensureFactEntities(db, root, ["nv"]), []);
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1", [government]), [{ place_id: place }]);
  } finally { await db.pg.close(); }
});

test("the map and every affected ZIP use one Washoe Rural territory with unchanged Census residents", () => {
  const geo = JSON.parse(readFileSync("data/states/nv/geo/territory-32.geojson", "utf8")) as { features: { properties: { ocdId: string } }[] };
  assert.deepEqual(geo.features.filter(f => f.properties.ocdId.includes("washoe_rural_fire")).map(f => f.properties.ocdId), [place]);
  const shard = JSON.parse(readFileSync("data/derived/zip-divisions/89.json", "utf8")) as ZipDivisionShard;
  assert.deepEqual(shard.divisions.filter(id => id.includes("washoe_rural_fire")), [place]);
  for (const [zip, residents] of Object.entries({ "89405": 49, "89412": 253, "89424": 525, "89506": 3, "89508": 895, "89510": 651 })) {
    const at = shard.zips[zip].findIndex(i => shard.divisions[i] === place);
    assert.equal(shard.residents![zip][at], residents);
    const entry = shardEntry(shard, zip)!;
    assert.equal([...entry.ids, ...(entry.fringe ?? [])].filter(id => id === place).length, 1);
    assert.equal(entry.fringe?.includes(place) ?? false, zip === "89506", "a three-resident fringe must not become a claim about the whole ZIP");
  }
});
