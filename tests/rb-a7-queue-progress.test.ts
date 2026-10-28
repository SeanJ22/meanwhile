import assert from "node:assert/strict";
import test from "node:test";
import { PLACE_PACKAGE_SQL, rebuildPlacePages } from "../lib/reader/place-builder.ts";
import { enqueueReaderPlaces } from "../lib/reader/cache.ts";
import type { FactDb } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const PLACE = "ocd-division/country:us/state:az/county:pima";

async function queuedPlace() {
  const db = await factDb({ withHourlyCounts: true });
  await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Pima County','AZ')", [PLACE]);
  await db.query("INSERT INTO rebuild_queue(place_id) VALUES($1)", [PLACE]);
  let reads = 0;
  const wrapped: FactDb = { transaction: run => db.transaction(query => run(async (text, params) => {
    if (text !== PLACE_PACKAGE_SQL) return query(text, params);
    reads++;
    return [{ division_ids: [PLACE], entities: [], fields: [], rosters: [], comments: [], sittings: [], meeting_rows: [],
      archived_meetings: [], archived_documents: [], parts: {}, registry: null, governments: [], divisions: [] }];
  })) };
  return { db, wrapped, sourceReads: () => reads };
}

test("a purge retry reuses the stored generation and records one actual build", async t => {
  t.mock.method(console, "error", () => {});
  const { db, wrapped, sourceReads } = await queuedPlace();
  try {
    const first = await rebuildPlacePages({ db: wrapped, limit: 1, concurrency: 1, purge: async () => ({ purged: false, detail: "CDN unavailable" }) });
    await db.query("UPDATE rebuild_queue SET lease_until=NULL WHERE place_id=$1", [PLACE]);
    let purges = 0;
    const retry = await rebuildPlacePages({ db: wrapped, limit: 1, concurrency: 1, purge: async () => { purges++; return { purged: true }; } });
    const version = Number((await db.query("SELECT version FROM place_page WHERE place_id=$1", [PLACE]))[0]!.version);
    t.diagnostic(JSON.stringify({ first, retry, sourceReads: sourceReads(), version }));
    assert.equal(sourceReads(), 1, "a failed CDN purge does not reread source data");
    assert.equal(version, 1);
    assert.deepEqual(first, { rebuilt: 1, failed: 1, remaining: 1 });
    assert.deepEqual(retry, { rebuilt: 0, failed: 0, remaining: 0 });
    assert.equal(purges, 1);
    assert.deepEqual(await db.query("SELECT n::int AS n FROM count_hour WHERE state='AZ' AND step='v1:'||jsonb_build_array('Place pages','rebuilt','in')::text"), [{ n: 1 }]);
  } finally { await db.pg.close(); }
});

test("a source arrival after storage keeps its first waiting time and forces a new generation build", async t => {
  t.mock.method(console, "error", () => {});
  const { db, wrapped, sourceReads } = await queuedPlace();
  try {
    let firstPending = "";
    const first = await rebuildPlacePages({ db: wrapped, limit: 1, concurrency: 1, purge: async () => {
      await enqueueReaderPlaces({ places: [PLACE] }, db.query);
      const [arrival] = await db.query("SELECT next_queued_at::text AS pending FROM rebuild_queue WHERE place_id=$1", [PLACE]);
      firstPending = String(arrival!.pending);
      assert.notEqual(firstPending, "null");
      return { purged: false, detail: "CDN unavailable" };
    } });
    assert.deepEqual(first, { rebuilt: 1, failed: 1, remaining: 1 });
    assert.deepEqual(await db.query("SELECT generation::int,built_generation::int,queued_at::text AS since,next_queued_at,lease_token,lease_slot FROM rebuild_queue WHERE place_id=$1", [PLACE]),
      [{ generation: 2, built_generation: 1, since: firstPending, next_queued_at: null, lease_token: null, lease_slot: null }]);
    await db.query("UPDATE rebuild_queue SET lease_until=NULL WHERE place_id=$1", [PLACE]);
    assert.deepEqual(await rebuildPlacePages({ db: wrapped, limit: 1, concurrency: 1, purge: async () => ({ purged: true }) }),
      { rebuilt: 1, failed: 0, remaining: 0 });
    assert.equal(sourceReads(), 2);
    assert.equal(Number((await db.query("SELECT version FROM place_page WHERE place_id=$1", [PLACE]))[0]!.version), 2);
  } finally { await db.pg.close(); }
});

test("a missing stored page is rebuilt even when the queue remembers its built generation", async t => {
  t.mock.method(console, "error", () => {});
  const { db, wrapped, sourceReads } = await queuedPlace();
  try {
    await rebuildPlacePages({ db: wrapped, limit: 1, concurrency: 1, purge: async () => ({ purged: false }) });
    await db.query("DELETE FROM place_page WHERE place_id=$1", [PLACE]);
    await db.query("UPDATE rebuild_queue SET lease_until=NULL WHERE place_id=$1", [PLACE]);
    assert.deepEqual(await rebuildPlacePages({ db: wrapped, limit: 1, concurrency: 1, purge: async () => ({ purged: true }) }),
      { rebuilt: 1, failed: 0, remaining: 0 });
    assert.equal(sourceReads(), 2);
    assert.equal(Number((await db.query("SELECT version FROM place_page WHERE place_id=$1", [PLACE]))[0]!.version), 1);
  } finally { await db.pg.close(); }
});

test("a turn cannot bypass active leases or the shared four-worker limit", async () => {
  const { db, wrapped, sourceReads } = await queuedPlace();
  try {
    for (let slot = 1; slot <= 4; slot++) {
      const id = `${PLACE}/place:leased${slot}`;
      await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'AZ')", [id]);
      await db.query("INSERT INTO rebuild_queue(place_id,lease_token,lease_slot,lease_until) VALUES($1,$2,$3,clock_timestamp()+interval '5 minutes')", [id, `running-${slot}`, slot]);
    }
    const before = await db.query("SELECT place_id,lease_token,lease_slot,lease_until FROM rebuild_queue ORDER BY place_id");
    assert.deepEqual(await rebuildPlacePages({ db: wrapped, limit: 4, concurrency: 4, purge: async () => { throw Error("No page was claimed to purge"); } }),
      { rebuilt: 0, failed: 0, remaining: 5 });
    assert.equal(sourceReads(), 0);
    assert.deepEqual(await db.query("SELECT place_id,lease_token,lease_slot,lease_until FROM rebuild_queue ORDER BY place_id"), before);
  } finally { await db.pg.close(); }
});

test("a targeted source update rebuilds ahead of older bulk work without resetting its age",async()=>{
  const {db,wrapped}=await queuedPlace();
  try{
    const old=PLACE+'/place:bulk';
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place','Bulk place','AZ')",[old]);
    await db.query("INSERT INTO rebuild_queue(place_id,queued_at,next_queued_at) VALUES($1,clock_timestamp()-interval '1 day',clock_timestamp()-interval '1 hour')",[old]);
    const [age]=await db.query("SELECT queued_at FROM rebuild_queue WHERE place_id=$1",[old]);
    await db.query("UPDATE rebuild_queue SET queued_at=clock_timestamp()-interval '1 day' WHERE place_id=$1",[PLACE]);
    const [targetAge]=await db.query("SELECT queued_at FROM rebuild_queue WHERE place_id=$1",[PLACE]);
    await enqueueReaderPlaces({places:[PLACE]},db.query);
    const body=PLACE+'#body:bulk';
    await db.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'body','Body page','AZ')",[body]);
    await db.query("INSERT INTO rebuild_queue(place_id,next_queued_at) VALUES($1,clock_timestamp())",[body]);
    await db.query("INSERT INTO entity(id,kind,name,state,page_priority) VALUES('zip:85701','place','85701','AZ',5000)");
    await db.query("INSERT INTO rebuild_queue(place_id,priority) VALUES('zip:85701',1000005000)");
    assert.deepEqual(await db.query("SELECT queued_at FROM rebuild_queue WHERE place_id=$1",[PLACE]),[targetAge]);
    const result=await rebuildPlacePages({db:wrapped,limit:1,concurrency:1,purge:async()=>({purged:true})});
    assert.equal(result.rebuilt,1);assert.equal(result.failed,0);
    assert.deepEqual(await db.query("SELECT place_id FROM place_page"),[{place_id:PLACE}]);
    assert.deepEqual(await db.query("SELECT queued_at FROM rebuild_queue WHERE place_id=$1",[old]),[age]);
  }finally{await db.pg.close();}
});
