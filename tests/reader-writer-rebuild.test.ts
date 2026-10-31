import assert from "node:assert/strict";
import test from "node:test";
import { ensureEntity, placeBody, resolvePerson } from "../lib/facts/entities.ts";
import { factDb } from "./helpers/fact-db.ts";

const state = "ocd-division/country:us/state:az";
const local = `${state}/place:example`;
const body = "az:city:example#governing";

async function seeded() {
  const db = await factDb();
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES
    ($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1),
    ('az:city:example','government','Example','AZ',$2),($3,'body','Council','AZ','az:city:example')`, [state, local, body]);
  return db;
}

test("new person aliases and place links rebuild their served page; resolving again preserves the empty queue", async () => {
  const db = await seeded();
  try {
    const person = { name: "Ada Sample", state: "AZ", placeId: local, externalIds: [["sample-person", "ada"]] as const };
    const id = await resolvePerson(db, person);
    assert.ok((await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL AND place_id=$1", [local])).length);
    await db.query("UPDATE place_page SET stale_at=NULL");
    assert.equal(await resolvePerson(db, person), id);
    assert.deepEqual(await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL"), []);
    assert.equal(await resolvePerson(db, { ...person, externalIds: [...person.externalIds, ["another-source", "same-ada"]] }), id);
    assert.ok((await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL AND place_id=$1", [local])).length);
  } finally { await db.pg.close(); }
});

test("moving a body from its bare state association queues the old and new places once", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)", [body, state]);
    await placeBody(db.query, body, local);
    const queued = new Set((await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL")).map(row => row.place_id));
    assert.ok(queued.has(state));
    assert.ok(queued.has(local));
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1", [body]), [{ place_id: local }]);
    await db.query("UPDATE place_page SET stale_at=NULL");
    await placeBody(db.query, body, local);
    assert.deepEqual(await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL"), []);
  } finally { await db.pg.close(); }
});

test("entity publication and its queued page roll back together", async () => {
  const db = await seeded();
  const id = "az:city:example#body:parks-commission";
  try {
    await assert.rejects(db.transaction(async query => {
      await ensureEntity(query, { id, kind: "body", name: "Parks Commission", state: "AZ", parentId: "az:city:example" });
      assert.ok((await query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL AND place_id=$1", [local])).length);
      throw new Error("publication failed");
    }), /publication failed/);
    assert.deepEqual(await db.query("SELECT id FROM entity WHERE id=$1", [id]), []);
    assert.deepEqual(await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL"), []);
  } finally { await db.pg.close(); }
});
