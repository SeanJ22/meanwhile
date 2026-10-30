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
  value: "520-555-0100", valueText: "520-555-0100", quote: "Office phone 520-555-0100", producedBy: "fixture", costUsd: 0,
  copy: { id: 1, finalUrl: "https://example.gov/board", text: "Office phone 520-555-0100", fetchedAt: AT, isArchive: false },
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

const factCounts = (db: Awaited<ReturnType<typeof fixture>>) => db.query(`SELECT state,hour,step,n FROM count_hour
  WHERE left(step,3)='v1:' AND substring(step FROM 4)::jsonb->>1='fact:live' ORDER BY state,hour,step`);

test("an exact saved fact files a second served city while retaining page generations and one fact arrival",async()=>{
  const db=await fixture();
  try {
    const original=claim([served(FIRST)]);
    assert.equal((await door(db,original,CLOCKS,AT,{purge}) as {decision:string}).decision,"PUBLISH");
    const facts=await db.query("SELECT * FROM fact ORDER BY id"), counts=await factCounts(db);
    assert.equal(facts.length,1);
    assert.ok(counts.length,"the real hourly hooks observed the first fact");
    await db.query(`INSERT INTO rebuild_queue(place_id,generation) SELECT id,7 FROM unnest($1::text[]) id
      ON CONFLICT(place_id) DO UPDATE SET generation=excluded.generation`,[[FIRST_PAGE,SECOND_PAGE]]);
    await db.query(`UPDATE rebuild_queue SET lease_token='building-first-city',lease_until=clock_timestamp()+interval '5 minutes',lease_slot=1,next_queued_at=NULL
      WHERE place_id=$1`,[FIRST_PAGE]);
    const expanded=claim([served(FIRST),served(SECOND)]);
    assert.equal((await door(db,expanded,CLOCKS,AT,{purge}) as {decision:string}).decision,"CONFIRM");
    assert.deepEqual(await db.query("SELECT * FROM fact ORDER BY id"),facts,"filing territory does not rewrite the saved fact or its source dates");
    assert.deepEqual(await factCounts(db),counts,"filing territory does not count another fact arrival");
    assert.deepEqual(await db.query("SELECT place_id,boundary_year FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[BODY]),
      [FIRST,SECOND].map(place_id=>({place_id,boundary_year:2025})));
    const pages=await db.query("SELECT place_id,generation,lease_token,next_queued_at FROM rebuild_queue WHERE place_id=ANY($1::text[]) ORDER BY place_id",[[FIRST_PAGE,SECOND_PAGE,OUTSIDE_PAGE]]);
    assert.deepEqual(pages.map(row=>[row.place_id,Number(row.generation)]),[[FIRST_PAGE,8],[SECOND_PAGE,7]],"the active page retains one later generation; the waiting page already reads the latest filing");
    assert.equal(pages[0]!.lease_token,"building-first-city");
    assert.ok(pages[0]!.next_queued_at,"the placement arrival survives a page already being built");
    await door(db,expanded,CLOCKS,AT,{purge});
    assert.deepEqual(await db.query("SELECT place_id,generation,lease_token,next_queued_at FROM rebuild_queue WHERE place_id=ANY($1::text[]) ORDER BY place_id",[[FIRST_PAGE,SECOND_PAGE,OUTSIDE_PAGE]]),pages,
      "replaying the same complete filing changes no queue generation or active lease");
  }finally{await db.pg.close();}
});

test("replacing a bare state association queues the old root and newly served local pages",async()=>{
  const db=await fixture();
  try {
    await db.query("DELETE FROM entity_place WHERE entity_id=ANY($1::text[])",[[GOVERNMENT,BODY]]);
    await db.query("INSERT INTO entity_place(entity_id,place_id,boundary_year,placement_basis) VALUES($1,$2,0,'SERVICE_AREA')",[BODY,ROOT]);
    await db.transaction(query=>fileEntityPlaces(query,BODY,[served(SECOND)],GOVERNMENT));
    assert.deepEqual(await db.query("SELECT place_id FROM entity_place WHERE entity_id=$1",[BODY]),[{place_id:SECOND}]);
    const queued=new Set((await db.query("SELECT place_id FROM rebuild_queue")).map(row=>row.place_id));
    assert.ok(queued.has(ROOT),"the removed root's own ready page is replaced");
    assert.ok(queued.has(SECOND));
    assert.ok(queued.has(SECOND_PAGE),"the newly served city's existing ZIP page is replaced");
    assert.ok(queued.has(FIRST_PAGE),"previous state-wide consumers lose the old blanket association");
    await db.query("DELETE FROM rebuild_queue");
    assert.equal(await db.transaction(query=>fileEntityPlaces(query,BODY,[served(SECOND)],GOVERNMENT)),false);
    assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue"),[],"unchanged source territory leaves the queue empty");
  }finally{await db.pg.close();}
});

test("a refused fact cannot file an additional place or queue its readers",async()=>{
  const db=await fixture();
  try {
    await door(db,claim([served(FIRST)]),CLOCKS,AT,{purge});
    await db.query("DELETE FROM rebuild_queue");
    const before=await db.query("SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[BODY]);
    const refused=await door(db,{...claim([served(OUTSIDE)]),provenance:"NEWS",acquisition:"walker",quote:"not in the saved source",
      copy:{id:2,finalUrl:"https://news.example.test/board",text:"Unrelated publisher bytes",fetchedAt:AT,isArchive:false}},CLOCKS,AT,{purge});
    assert.ok("refused" in refused);
    assert.deepEqual(await db.query("SELECT place_id,boundary_year,placement_basis FROM entity_place WHERE entity_id=$1 ORDER BY place_id",[BODY]),before);
    assert.deepEqual(await db.query("SELECT place_id FROM rebuild_queue"),[]);
  }finally{await db.pg.close();}
});
