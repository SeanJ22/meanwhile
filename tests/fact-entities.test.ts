import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { ensureFactEntities, resolvePerson } from "../lib/facts/entities.ts";
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
  const place = async (id: string) => (await db.query("SELECT e.parent_id, p.place_id FROM entity e JOIN entity_place p ON p.entity_id = e.id WHERE e.id = $1", [id]))[0];
  const rincon = "ocd-division/country:us/state:az/special_district:rincon_valley_fire_district";
  assert.deepEqual(await place("az:special:rincon-valley-fire-district"), { parent_id: rincon, place_id: rincon }, "a district an official layer draws sits on that territory");
  assert.deepEqual(await place("az:special:alpine-sanitary-district"), { parent_id: "ocd-division/country:us/state:az", place_id: "ocd-division/country:us/state:az" },
    "a district no layer draws yet waits on the state, never spread over its office's county");
  await db.query("UPDATE entity SET parent_id = 'ocd-division/country:us/state:az/county:pima' WHERE id = 'az:special:rincon-valley-fire-district'");
  await db.query("INSERT INTO entity_place (entity_id, place_id) VALUES ('az:special:rincon-valley-fire-district', 'ocd-division/country:us/state:az/county:pima')");
  await db.query("DELETE FROM fact_store_load");
  await ensureFactEntities(db, ROOT, ["az"]);
  assert.deepEqual(await db.query("SELECT parent_id FROM entity WHERE id = 'az:special:rincon-valley-fire-district'"), [{ parent_id: rincon }], "a reload moves a government its reference moved");
  assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id = 'az:special:rincon-valley-fire-district'"), [{ place_id: rincon }]);
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
