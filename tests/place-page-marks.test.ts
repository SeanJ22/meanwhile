import assert from "node:assert/strict";
import test from "node:test";
import { enqueueReaderPlaces } from "../lib/reader/cache.ts";
import { PLACE_PACKAGE_SQL, rebuildPlacePages as rebuild } from "../lib/reader/place-builder.ts";
import type { FactDb } from "../lib/facts/publish.ts";
import { factDb } from "./helpers/fact-db.ts";

const STATE = "ocd-division/country:us/state:az";
const CITY = `${STATE}/place:example`;
const BOARD = "az:city:example#governing";
const purged = { purged: true } as const;

/** The page read is answered with one board on the page; everything else runs on the fixture database. */
const rawPage = (id: string) => ({ division_ids: [id], entities: [{ id: BOARD, kind: "body", name: "Council", state: "AZ" }], fields: [], rosters: [], comments: [],
  sittings: [], meeting_rows: [], archived_meetings: [], archived_documents: [], parts: {}, registry: null, governments: [], divisions: [] });
const rebuildPlacePages = (options: Parameters<typeof rebuild>[0] & { db: FactDb }) => rebuild({ ...options, db: { transaction: run => options.db.transaction(query =>
  run(async (text, params) => text === PLACE_PACKAGE_SQL ? [rawPage(String(((params?.[1] as string[])[0]) ?? (params?.[2] as string[])[0]))] : query(text, params))) } });

async function seeded() {
  const db = await factDb({ withHourlyCounts: true });
  await db.query(`INSERT INTO entity(id,kind,name,state,parent_id) VALUES ($1,'place','Arizona','AZ',NULL),($2,'place','Example','AZ',$1),
    ('az:city:example','government','Example','AZ',$2),($3,'body','Council','AZ','az:city:example')`, [STATE, CITY, BOARD]);
  await db.query("INSERT INTO entity_place(entity_id,place_id) VALUES($1,$2)", [BOARD, CITY]);
  return db;
}
const marked = async (db: Awaited<ReturnType<typeof seeded>>) => (await db.query("SELECT place_id FROM place_page WHERE stale_at IS NOT NULL ORDER BY place_id")).map(row => String(row.place_id));

test("a change marks the pages it reaches, keeps the oldest mark, and a turn builds them and clears the marks", async () => {
  const db = await seeded();
  try {
    await db.transaction(query => enqueueReaderPlaces({ entities: [BOARD] }, query));
    assert.ok((await marked(db)).includes(CITY));
    const [first] = await db.query("SELECT stale_at::text AS at FROM place_page WHERE place_id=$1", [CITY]);
    await db.transaction(query => enqueueReaderPlaces({ entities: [BOARD] }, query));
    assert.equal((await db.query("SELECT stale_at::text AS at FROM place_page WHERE place_id=$1", [CITY]))[0]!.at, first!.at, "a second mark does not make the page wait longer");
    const turn = await rebuildPlacePages({ db, purge: async () => purged, limit: 20, concurrency: 1 });
    assert.equal(turn.failed, 0);
    assert.deepEqual(await marked(db), []);
    const [page] = await db.query("SELECT context ? 'formatVersion' AS built, depends FROM place_page WHERE place_id=$1", [CITY]);
    assert.equal(page!.built, true);
    assert.ok((page!.depends as string[]).includes(BOARD), "the page keeps the entities it shows");
  } finally { await db.pg.close(); }
});

test("a change that arrives while a page builds keeps it marked, and a failed purge keeps its mark and waits a minute", async () => {
  const db = await seeded();
  try {
    await db.transaction(query => enqueueReaderPlaces({ places: [CITY] }, query));
    await rebuildPlacePages({ db, purge: async () => { await db.transaction(query => enqueueReaderPlaces({ places: [CITY] }, query)); return purged; }, limit: 1, concurrency: 1 });
    assert.deepEqual(await marked(db), [CITY], "the mark made during the build is not cleared by it");
    const failing = await rebuildPlacePages({ db, purge: async () => ({ purged: false, detail: "refused" }), limit: 1, concurrency: 1 });
    assert.equal(failing.failed, 1);
    assert.deepEqual(await marked(db), [CITY]);
    const [held] = await db.query("SELECT lease_token, lease_until > clock_timestamp() AS waiting FROM place_page WHERE place_id=$1", [CITY]);
    assert.equal(held!.lease_token, null);
    assert.equal(held!.waiting, true);
  } finally { await db.pg.close(); }
});

test("the old queue's marks and each page's dependencies move onto the pages, once, in place order", async () => {
  const db = await seeded();
  try {
    await db.query("INSERT INTO place_page(place_id,context) VALUES($1,'{\"formatVersion\":1}'::jsonb)", [CITY]);
    await db.query("INSERT INTO place_page_dependency(page_id,entity_id) VALUES($1,$2),($1,$1)", [CITY, BOARD]);
    await db.query("INSERT INTO rebuild_queue(place_id,priority) VALUES($1,5),($2,3)", [CITY, STATE]);
    await rebuildPlacePages({ db, purge: async () => purged, limit: 1, concurrency: 1, timeBudgetMs: 4_000 });
    const [moved] = await db.query("SELECT depends FROM place_page WHERE place_id=$1", [CITY]);
    assert.ok((moved!.depends as string[]).includes(BOARD));
    assert.deepEqual((await db.query("SELECT place_id FROM place_page WHERE place_id=$1", [STATE])).length, 1, "a queued place with no page gets a marked row");
    assert.equal((await db.query("SELECT position FROM pass_cursor WHERE name='place-pages:adopt'"))[0]!.position, "done");
  } finally { await db.pg.close(); }
});
