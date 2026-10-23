import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { bodyNamed, ensureFactEntities, ensureGoverningBody, resolvePerson } from "../lib/facts/entities.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");

test("every Arizona government, division, registry body and legislator becomes one entity, special districts on their own territory", async () => {
  const db = await factDb();
  assert.deepEqual(await ensureFactEntities(db, ROOT, ["az"]), ["az"]);
  const kinds = Object.fromEntries((await db.query("SELECT kind, count(*)::int AS n FROM entity WHERE state = 'AZ' GROUP BY kind"))
    .map(r => [r.kind, r.n]));
  const reference = JSON.parse(readFileSync(join(ROOT, "data", "derived", "registration", "az.json"), "utf8")) as { divisions: unknown[]; governments: unknown[] };
  assert.equal(kinds.government, reference.governments.length);
  assert.equal(kinds.place, reference.divisions.length);
  assert.ok((kinds.body as number) > 100, `${kinds.body} bodies`);
  assert.ok((kinds.person as number) >= 90, `${kinds.person} legislators`);
  assert.deepEqual(await db.query("SELECT id FROM entity WHERE kind='body' AND id LIKE '%school_district_not_defined#%'"),[],"Census placeholder land has no board");
  const place = async (id: string) => (await db.query("SELECT e.parent_id, p.place_id FROM entity e JOIN entity_place p ON p.entity_id = e.id WHERE e.id = $1", [id]))[0];
  const rincon = "ocd-division/country:us/state:az/special_district:rincon_valley_fire_district";
  assert.deepEqual(await place("az:special:rincon-valley-fire-district"), { parent_id: rincon, place_id: rincon }, "a district an official layer draws sits on that territory");
  assert.deepEqual(await place("az:special:alpine-sanitary-district"), { parent_id: "ocd-division/country:us/state:az", place_id: "ocd-division/country:us/state:az" },
    "a district no layer draws yet waits on the state, never spread over its office's county");
  const board = "curated:az/rincon-valley-fire-district#governing";
  assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id = $1", [board]), [{ parent_id: "az:special:rincon-valley-fire-district" }],
    "a registry board naming its Census government hangs on it, whatever website each lists");
  await db.query("UPDATE entity SET parent_id = 'ocd-division/country:us/state:az' WHERE id = $1", [board]);
  await db.query("UPDATE entity SET parent_id = 'ocd-division/country:us/state:az/county:pima' WHERE id = 'az:special:rincon-valley-fire-district'");
  await db.query("INSERT INTO entity_place (entity_id, place_id) VALUES ('az:special:rincon-valley-fire-district', 'ocd-division/country:us/state:az/county:pima')");
  await db.query("DELETE FROM fact_store_load");
  await ensureFactEntities(db, ROOT, ["az"]);
  assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id = 'az:special:rincon-valley-fire-district'"), [{ parent_id: rincon }], "a reload moves a government its reference moved");
  assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id = 'az:special:rincon-valley-fire-district'"), [{ place_id: rincon }]);
  assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id = $1", [board]), [{ parent_id: "az:special:rincon-valley-fire-district" }],
    "a reload moves a board filed on the state to its government");
  const tempe = "ocd-division/country:us/state:az/school_district:tempe_school_district#board";
  const [school] = await db.query("SELECT b.name,p.name AS owner_name FROM entity b JOIN entity p ON p.id=b.parent_id WHERE b.id=$1",[tempe]);
  assert.equal(school!.name,`${school!.owner_name} school board`,"a district place stands for its government when no government row is paired");
  const [city] = await db.query("SELECT name FROM entity WHERE id='ocd-division/country:us/state:az/place:phoenix#governing'");
  assert.equal(city!.name,"City Of Phoenix governing board","a paired government supplies its real name rather than a Census place label");
  await db.query("UPDATE entity SET name='Tempe School District governing' WHERE id=$1",[tempe]);
  await db.query("DELETE FROM fact_store_load");
  await ensureFactEntities(db,ROOT,["az"]);
  assert.deepEqual(await db.query("SELECT name FROM entity WHERE id=$1",[tempe]),[{name:school!.name}],"the next import replaces the former generated label");
  assert.deepEqual(await db.query("SELECT scheme, value FROM entity_external_id WHERE entity_id = 'az:special:alpine-sanitary-district'"),
    [{ scheme: "census-pid6", value: "122758" }]);
  assert.ok(Number((await db.query("SELECT count(*)::int AS n FROM entity_host"))[0]!.n) > 100);
  assert.deepEqual(await ensureFactEntities(db, ROOT, ["az"]), [], "an unchanged state is not loaded again");
});

test("the same person from two sources is one entity; a name alone never merges", async () => {
  const db = await factDb();
  const first = await resolvePerson(db, { name: "Juan Ciscomani", state: "AZ", externalIds: [["bioguide", "C001133"]] });
  const second = await resolvePerson(db, { name: "Juan Ciscomani", state: "AZ", externalIds: [["fec", "H2AZ06143"], ["bioguide", "C001133"]] });
  assert.equal(second, first);
  assert.equal(await resolvePerson(db, { name: "Juan Ciscomani", state: "AZ", externalIds: [["fec", "H2AZ06143"]] }), first);
  assert.notEqual(await resolvePerson(db, { name: "Juan Ciscomani", state: "AZ", externalIds: [["legistar-person:pima", "77"]] }), first);
});

test("statewide governments keep their own board name without spreading boards over the state", async () => {
  const db = await factDb();
  try {
    await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
      ('ocd-division/country:us/state:al','place','Alabama','AL',NULL),
      ('al:special:mobile-housing-authority','government','Mobile Housing Authority','AL','ocd-division/country:us/state:al')`);
    const board = await ensureGoverningBody(db.query, "al:special:mobile-housing-authority");
    assert.equal(board?.name, "Mobile Housing Authority governing board");
    assert.deepEqual(await db.query("SELECT * FROM entity_place WHERE entity_id=$1", [board!.id]), []);
    const committee = await bodyNamed(db.query, board!.id, board, "Finance Committee");
    assert.deepEqual(await db.query("SELECT * FROM entity_place WHERE entity_id=$1", [committee!.id]), []);
    await db.query("INSERT INTO entity_place VALUES ($1,'ocd-division/country:us/state:al')", [board!.id]);
    await db.query("UPDATE entity SET name='Alabama governing' WHERE id=$1", [board!.id]);
    assert.equal((await ensureGoverningBody(db.query, board!.id))?.id, board!.id);
    assert.deepEqual(await db.query("SELECT name FROM entity WHERE id=$1", [board!.id]), [{name:"Mobile Housing Authority governing board"}], "refresh repairs a held generated label too");
    assert.deepEqual(await db.query("SELECT * FROM entity_place WHERE entity_id=$1", [board!.id]), [], "refresh removes the old statewide pin too");
  } finally { await db.pg.close(); }
});

test("Alaska REAAs use their named school territories on the next registration load and board publication", async () => {
  const db = await factDb();
  try {
    await ensureFactEntities(db, ROOT, ["ak"]);
    const government = "ak:depschool:lower-kuskokwim-regional-educational-attendance-area-reaa";
    const place = "ocd-division/country:us/state:ak/school_district:lower_kuskokwim_school_district";
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id=$1", [government]), [{ parent_id: place }]);
    await db.query("UPDATE entity SET parent_id='ocd-division/country:us/state:ak' WHERE id=$1", [government]);
    const board = await ensureGoverningBody(db.query, government);
    assert.equal(board?.parentId, government);
    assert.match(board!.name, /^Lower Kuskokwim /);
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1", [board!.id]), [{ place_id: place }]);
    const missing = "ak:depschool:kuspuk-regional-educational-attendance-area-reaa";
    await db.query("DELETE FROM entity_external_id WHERE entity_id=$1", [missing]);
    await db.query("DELETE FROM entity_host WHERE entity_id=$1", [missing]);
    await db.query("DELETE FROM entity_place WHERE entity_id=$1", [missing]);
    await db.query("DELETE FROM entity WHERE id=$1", [missing]);
    assert.equal((await ensureGoverningBody(db.query, missing))?.name, "Kuspuk School District school board", "a missing government's REAA slug resolves to the held district");
    assert.deepEqual(await ensureFactEntities(db, ROOT, ["ak"]), [], "tomorrow's unchanged load remains idempotent");
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id=$1", [government]), [{ parent_id: place }]);
  } finally { await db.pg.close(); }
});

test("published local territory and merged board aliases survive registration reloads", async () => {
  const db = await factDb();
  try {
    await ensureFactEntities(db, ROOT, ["az"]);
    const government = "az:special:alpine-sanitary-district", county = "ocd-division/country:us/state:az/county:apache";
    const former = "curated:az/rincon-valley-fire-district#governing", canonical = "az:special:rincon-valley-fire-district#governing";
    await db.query("INSERT INTO entity(id,kind,name,state,parent_id) SELECT $1,kind,name,state,parent_id FROM entity WHERE id=$2", [canonical,former]);
    await db.query("INSERT INTO entity_external_id VALUES ($1,'body-alias',$2)", [canonical,former]);
    await db.query("DELETE FROM entity_host WHERE entity_id=$1", [former]);
    await db.query("DELETE FROM entity_place WHERE entity_id=$1", [former]);
    await db.query("DELETE FROM entity WHERE id=$1", [former]);
    await db.pg.exec("CREATE TABLE civic_data_promotions(key text PRIMARY KEY,payload jsonb)");
    await db.query("INSERT INTO civic_data_promotions VALUES ('REGISTRATION:US-AZ:registration:v1',$1::jsonb)", [JSON.stringify({governments:[
      {id:"government:US-AZ:cog:122758",jurisdictionId:government,associations:[{divisionId:county,basis:"SOURCE_BOUNDARY"}]}]})]);
    await ensureFactEntities(db,ROOT,["az"]);
    assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id=$1",[government]),[{parent_id:county}]);
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1",[government]),[{place_id:county}]);
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=$1",[former]),[],"the former board does not reappear");
    assert.equal((await ensureGoverningBody(db.query,former))?.id,canonical);
    assert.deepEqual(await ensureFactEntities(db,ROOT,["az"]),[],"the next unchanged scheduled load keeps the same data");
  } finally { await db.pg.close(); }
});
