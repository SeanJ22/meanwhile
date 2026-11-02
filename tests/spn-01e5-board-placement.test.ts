import assert from "node:assert/strict";
import test from "node:test";
import { ensureEntity, settleBoards } from "../lib/facts/entities.ts";
import { migratedFactDb } from "./helpers/migrated-reader-db.ts";

const STATE_ROOT = "ocd-division/country:us/state:nh", COUNTY = `${STATE_ROOT}/county:merrimack`, OTHER_COUNTY = `${STATE_ROOT}/county:hillsborough`;
const CITY = "ocd-division/country:us/state:ak/place:juneau";
const AK = "ocd-division/country:us/state:ak";

async function open() {
  const db = await migratedFactDb();
  const place = (id: string, state: string, parent: string | null) => db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place',$1,$2,$3)", [id, state, parent]);
  await place(STATE_ROOT, "NH", null); await place(COUNTY, "NH", STATE_ROOT); await place(OTHER_COUNTY, "NH", STATE_ROOT);
  await place(AK, "AK", null); await place(CITY, "AK", AK);
  const board = (id: string, state: string, parent: string | null) => db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'body',$1,$2,$3)", [id, state, parent]);
  const placesOf = async (id: string) => (await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1 ORDER BY place_id", [id])).map(row => String(row.place_id));
  return { db, board, placesOf };
}

test("a board named for a place, with no parent, is filed on that place, and a board whose parent is a place is filed on it", async () => {
  const { db, board, placesOf } = await open();
  try {
    const unparented = `${CITY}#body:library-endowment-board`, parented = `${CITY}#body:utility-advisory-board`;
    await board(unparented, "AK", null); await board(parented, "AK", CITY);
    assert.deepEqual([...await settleBoards(db.query, "AK")].sort(), [parented, unparented].sort());
    assert.deepEqual([await placesOf(unparented), await placesOf(parented)], [[CITY], [CITY]]);
    assert.equal((await db.query("SELECT parent_id FROM entity WHERE id=$1", [unparented]))[0]!.parent_id, CITY, "the place it is named for becomes its owner");
    assert.deepEqual(await settleBoards(db.query, "AK"), [], "a board that is filed is not filed again");
  } finally { await db.pg.close(); }
});

test("a county office hung on the bare state is filed on the one county whose government holds its site, never on the state and so never on every ZIP in it", async () => {
  const { db, board, placesOf } = await open();
  try {
    const government = "government:US-NH:cog:merrimack", rival = "government:US-NH:cog:hillsborough";
    for (const [id, place] of [[government, COUNTY], [rival, OTHER_COUNTY]] as const) {
      await db.query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'government',$1,'NH',$2)", [id, place]);
      await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA')", [id, place]);
    }
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'merrimackcounty.net'),($2,'hillsboroughcounty.org'),($2,'shared.org'),($1,'shared.org')", [government, rival]);
    const attorney = "wtp-body/country:us/state:nh/county_attorney#governing", shared = "wtp-body/country:us/state:nh/shared_office#governing", unknown = "wtp-body/country:us/state:nh/unknown#governing";
    for (const id of [attorney, shared, unknown]) await board(id, "NH", STATE_ROOT);
    await db.query("INSERT INTO entity_host(entity_id,host) VALUES($1,'merrimackcounty.net'),($2,'shared.org'),($3,'elsewhere.org')", [attorney, shared, unknown]);
    assert.deepEqual(await settleBoards(db.query, "NH"), [attorney]);
    assert.deepEqual(await placesOf(attorney), [COUNTY], "filed on its county alone");
    assert.equal((await db.query("SELECT parent_id FROM entity WHERE id=$1", [attorney]))[0]!.parent_id, government);
    assert.deepEqual([await placesOf(shared), await placesOf(unknown)], [[], []], "a site two governments share, or none holds, names nobody, so the board waits");
  } finally { await db.pg.close(); }
});

test("a board a door creates without a parent is hung on the place its id names when it is first met", async () => {
  const { db, placesOf } = await open();
  try {
    const id = `${CITY}#body:aquatics-board`;
    assert.equal(await ensureEntity(db.query, { id, kind: "body", name: "Aquatics Board", state: "AK", parentId: null }), id);
    assert.deepEqual(await placesOf(id), [CITY]);
    assert.equal((await db.query("SELECT parent_id FROM entity WHERE id=$1", [id]))[0]!.parent_id, CITY);
  } finally { await db.pg.close(); }
});
