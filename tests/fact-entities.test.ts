import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { ensureFactEntities, resolvePerson } from "../lib/facts/entities.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = join(import.meta.dirname, "..");

test("every Arizona government, division, registry body and legislator becomes one entity, special districts on their county", async () => {
  const db = await factDb();
  assert.deepEqual(await ensureFactEntities(db, ROOT, ["az"]), ["az"]);
  const kinds = Object.fromEntries((await db.query("SELECT kind, count(*)::int AS n FROM entity WHERE state = 'AZ' GROUP BY kind"))
    .map(r => [r.kind, r.n]));
  assert.equal(kinds.government, 688);
  assert.equal(kinds.place, 779);
  assert.ok((kinds.body as number) > 100, `${kinds.body} bodies`);
  assert.ok((kinds.person as number) >= 90, `${kinds.person} legislators`);
  const [ganado] = await db.query("SELECT e.parent_id, p.place_id FROM entity e JOIN entity_place p ON p.entity_id = e.id WHERE e.id = 'az:special:ganado-fire-district'");
  assert.deepEqual(ganado, { parent_id: "ocd-division/country:us/state:az/county:apache", place_id: "ocd-division/country:us/state:az/county:apache" });
  assert.deepEqual(await db.query("SELECT scheme, value FROM entity_external_id WHERE entity_id = 'az:special:ganado-fire-district'"),
    [{ scheme: "census-pid6", value: "100258" }]);
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
