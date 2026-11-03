import assert from "node:assert/strict";
import test from "node:test";
import { door, type DoorInput } from "../lib/core/door.ts";
import { factClocks } from "../lib/facts/clocks.ts";
import { fileEntityPlaces, type EntityPlace } from "../lib/facts/entity-places.ts";
import { factDb } from "./helpers/fact-db.ts";

const ROOT = "ocd-division/country:us/state:az";
const FIRST = `${ROOT}/place:first`, SECOND = `${ROOT}/place:second`, OUTSIDE = `${ROOT}/place:outside`;
const GOVERNMENT = "az:special:regional", BODY = `${GOVERNMENT}#governing`;
const FIRST_PAGE = "zip:85201", SECOND_PAGE = "zip:85202", OUTSIDE_PAGE = "zip:85203";
const AT = new Date("2026-10-24T12:00:00.000Z"), CLOCKS = factClocks(null);
const served = (placeId: string): EntityPlace => ({ placeId, boundaryYear: 2025, basis: "SERVICE_AREA" });
const purge = async () => ({ purged: true });

const claim = (places: readonly EntityPlace[]): DoorInput => ({
  subjectId: BODY, places, field: "office_phone", fieldKind: "contact", provenance: "OFFICIAL", acquisition: "loader",
  value: "520-555-0100", valueText: "520-555-0100", quote: "", producedBy: "fixture", costUsd: 0,
  copy: { id: 1, finalUrl: "https://example.gov/board", text: "", fetchedAt: AT, isArchive: false },
});

async function fixture() {
  const db = await factDb({ withHourlyCounts: true });
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'place','Arizona','AZ',NULL),
    ($2,'place','First city','AZ',$1),($3,'place','Second city','AZ',$1),($4,'place','Outside city','AZ',$1),
    ($5,'government','Regional transit','AZ',$1),($6,'body','Regional Transit Board','AZ',$5),
    ($7,'place','First ZIP','AZ',$1),($8,'place','Second ZIP','AZ',$1),($9,'place','Outside ZIP','AZ',$1)`,
    [ROOT,FIRST,SECOND,OUTSIDE,GOVERNMENT,BODY,FIRST_PAGE,SECOND_PAGE,OUTSIDE_PAGE]);
  await db.query(`INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis)
    VALUES($1,$3,2025,'SERVICE_AREA'),($2,$3,2025,'SERVICE_AREA')`,[GOVERNMENT,BODY,FIRST]);
  await db.query(`INSERT INTO place_page(place_id,body) SELECT id,'{}'::jsonb FROM unnest($1::text[]) id`,[[FIRST_PAGE,SECOND_PAGE,OUTSIDE_PAGE]]);
  await db.query(`INSERT INTO place_page_dependency(page_id,entity_id) VALUES($1,$4),($2,$5),($3,$6),($1,$7),($2,$7),($3,$7)`,
    [FIRST_PAGE,SECOND_PAGE,OUTSIDE_PAGE,FIRST,SECOND,OUTSIDE,ROOT]);
  await db.query(`INSERT INTO source_copy(id,url,final_url,fetched_at,sha256,blob_key)
    VALUES(1,'https://example.gov/board','https://example.gov/board',$1,$2,'board'),
      (2,'https://news.example.test/board','https://news.example.test/board',$1,$2,'news')`,[AT.toISOString(),"a".repeat(64)]);
  return db;
}

test("replacing a bare state association queues the old root and newly served local pages",async()=>{
  const db=await fixture();
  try {
    await db.query("DELETE FROM entity_place WHERE entity_id=ANY($1::text[])",[[GOVERNMENT,BODY]]);
    await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA')",[BODY,ROOT]);
    await db.transaction(query=>fileEntityPlaces(query,BODY,[served(SECOND)],GOVERNMENT));
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1",[BODY]),[{place_id:SECOND}]);
    const queued=new Set((await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL")).map(row=>row.place_id));
    assert.ok(queued.has(ROOT),"the removed root's own ready page is replaced");
    assert.ok(queued.has(SECOND));
    await db.query("UPDATE place_page SET stale_at=NULL");
    assert.equal(await db.transaction(query=>fileEntityPlaces(query,BODY,[served(SECOND)],GOVERNMENT).then(filed=>filed.moved)),false);
    assert.deepEqual(await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL"),[],"unchanged source territory leaves the queue empty");
  }finally{await db.pg.close();}
});

test("a state is not filed again for an entity that holds a place within it, so the next filing does not unfile it", async () => {
  const db = await fixture();
  try {
    const filed = await db.transaction(query => fileEntityPlaces(query, BODY, [{ placeId: ROOT, boundaryYear: 0, basis: "SERVICE_AREA" }]));
    assert.deepEqual([filed.moved, filed.removed], [false, []]);
  } finally { await db.pg.close(); }
});

test("a refused fact cannot file an additional place or queue its readers",async()=>{
  const db=await fixture();
  try {
    await door(db,claim([served(FIRST)]),CLOCKS,AT,{purge});
    await db.query("UPDATE place_page SET stale_at=NULL");
    const before=await db.query("SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[BODY]);
    const refused=await door(db,{...claim([served(OUTSIDE)]),provenance:"NEWS",acquisition:"walker",quote:"not in the saved source",
      copy:{id:2,finalUrl:"https://news.example.test/board",text:"Unrelated publisher bytes",fetchedAt:AT,isArchive:false}},CLOCKS,AT,{purge});
    assert.ok("refused" in refused);
    assert.deepEqual(await db.query("SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[BODY]),before);
    assert.deepEqual(await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL"),[]);
  }finally{await db.pg.close();}
});
