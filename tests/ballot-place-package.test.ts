import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { seedPlacePages } from "./helpers/place-pages.ts";
import { readBallotPlacePackage } from "../lib/ballot/place-package-until-nov-4.ts";
import { readPlacePackage } from "../lib/reader/place.ts";
import { buildPlacePackage } from "../lib/reader/place-builder.ts";
import type { Query } from "../lib/facts/publish.ts";

const AT = "2026-10-24T12:00:00.000Z";
const DIVISION = "ocd-division/country:us/state:co/place:fixture", BODY = `${DIVISION}#council`, PERSON = "person:fixture";

async function fixture() {
  const { pg } = await migratedReaderDb();
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  await query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Fixture','CO'),($2,'body','Fixture council','CO'),($3,'person','Casey Resident','CO')", [DIVISION, BODY, PERSON]);
  await query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)", [BODY, DIVISION]);
  await query("INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key) VALUES(1,$1,$1,$2,$3,'source')", ["https://example.gov/council", AT, "c".repeat(64)]);
  const fact = (id: string, field: string, value: unknown) => query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
    VALUES($1,$2,$3,'saved','live','OFFICIAL',1,'Official roster',$4,'fixture')`, [id, field, JSON.stringify(value), AT]);
  await fact(BODY, `member:${PERSON}`, { name: "Casey Resident", office: "Member" });
  await fact(PERSON, "name", "Casey Resident");
  return { pg, query };
}

test("the ballot's place read still assembles an unbuilt division live, and the combine assembles it live too", async () => {
  const { pg, query } = await fixture();
  try {
    const input = { state: "CO", divisionIds: [DIVISION], bodyIds: [BODY], bodyFactsOnly: true } as const;
    const live = await buildPlacePackage({ ...input, includeAgenda: false }, query);
    assert.equal(live.bodies.find(body => body.id === BODY)?.roster?.members[0]?.name, "Casey Resident", "the fixture division has a board with a member");
    assert.deepEqual(await query("SELECT place_id FROM place_page"), [], "no page is built for it");
    assert.deepEqual(await readBallotPlacePackage(input, query), live, "the ballot path assembles it live, as before");
    assert.deepEqual((await readPlacePackage(input, query)).bodies, live.bodies, "the combine assembles an unbuilt place live");
  } finally { await pg.close(); }
});

test("a built division is combined from its page, an unbuilt board beside it is assembled live, and the ballot path still falls back whole", async () => {
  const { pg, query } = await fixture();
  try {
    const input = { state: "CO", divisionIds: [DIVISION], bodyIds: [BODY], bodyFactsOnly: true } as const;
    const live = await buildPlacePackage({ ...input, includeAgenda: false }, query);
    await seedPlacePages(query, { state: "CO", divisionIds: [DIVISION] });
    await query("DELETE FROM place_page WHERE place_id=$1", [BODY]);
    assert.deepEqual((await query("SELECT place_id FROM place_page")).map(row => row.place_id), [DIVISION], "only the division is built");
    assert.deepEqual((await readPlacePackage(input, query)).bodies, live.bodies, "the combine matches a live build");
    assert.deepEqual((await readBallotPlacePackage(input, query)).bodies, live.bodies, "the ballot path falls back to live assembly for the whole selection");
  } finally { await pg.close(); }
});
