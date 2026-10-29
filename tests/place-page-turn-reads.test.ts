import assert from "node:assert/strict";
import test from "node:test";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";
import { buildPageBody,storePlacePage, PLACE_PACKAGE_SQL, rebuildPlacePages, type PlaceTurnReads } from "../lib/reader/place-builder.ts";
import { unpackReadyPlace } from "../lib/reader/place-ready.ts";
import { EVERYDAY_ROUTING_POINTER } from "../lib/routing/everyday-data-plane.ts";
import type { FactDb, Query } from "../lib/facts/publish.ts";

const AT = "2026-10-26T19:00:00.000Z", STATE = "ocd-division/country:us/state:az", PAGES = 24;
const place = (n: number) => `${STATE}/place:fixture_${String(n).padStart(2, "0")}`;
/** The national projection every page carries, at about its production size (~25 KB). */
const routing = (label: string) => ({ kind: "everyday-routing", formatVersion: 1, denominator: { zips: ["85701", "03301", "07001"] },
  records: Array.from({ length: 120 }, (_, n) => ({ id: `${label}-route-${n}`, topicId: `topic-${n % 12}`, zip: "85701",
    contact: { name: `Office ${n}`, phone: "520-555-0100", url: `https://example.gov/${label}/${n}` }, sourceUrl: "https://example.gov/source" })) });

async function store() {
  const { pg, publish } = await migratedReaderDb();
  await publish({ id: "routing-1", value: routing("first"), at: AT, recordClass: EVERYDAY_ROUTING_POINTER.recordClass as "CURATED_READER_RECORD",
    scope: EVERYDAY_ROUTING_POINTER.scope, sourceId: "everyday-routing" });
  await publish({ id: "registration-az", at: AT, recordClass: "REGISTRATION", scope: "US-AZ:registration:v1", sourceId: "registration",
    value: { governments: [], divisions: Array.from({ length: PAGES }, (_, n) => ({ ocdId: place(n), parentOcdId: STATE, label: `Fixture ${n}`, divisionType: "place", state: "AZ" })) } });
  for (let n = 0; n < PAGES; n++) await pg.query("INSERT INTO entity(id,kind,name,state) VALUES($1,'place',$1,'AZ')", [place(n)]);
  const query: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  return { pg, query, publish };
}

interface Meter { requests: number; sent: number; received: number; pageReads: number; pageBytes: number; routingBodies: number }
const meter = (): Meter => ({ requests: 0, sent: 0, received: 0, pageReads: 0, pageBytes: 0, routingBodies: 0 });
/** Bytes as they cross the connection: statement text and parameters out, rows back. */
function metered(query: Query, into: Meter): Query {
  return async (text, params = []) => {
    const rows = await query(text, params), bytes = Buffer.byteLength(JSON.stringify(rows));
    into.requests++; into.sent += Buffer.byteLength(text) + Buffer.byteLength(JSON.stringify(params)); into.received += bytes;
    if (text === PLACE_PACKAGE_SQL) {
      into.pageReads++; into.pageBytes += bytes;
      if (rows[0]?.everyday_routing != null) into.routingBodies++;
    }
    return rows;
  };
}

test("one rebuild turn reads the national routing record once and stores the same pages", async () => {
  const { pg, query } = await store();
  try {
    // Before: every page's read carried the whole national record.
    const before = meter(), expected = new Map<string, Record<string, unknown>>();
    for (let n = 0; n < PAGES; n++) {
      await storePlacePage(query,place(n),await buildPageBody(place(n), "place", "AZ", metered(query, before)));
      const [saved]=await query("SELECT body,history_body,context-'prints' AS context FROM place_page WHERE place_id=$1",[place(n)]);
      expected.set(place(n),saved);
    }
    assert.equal(before.routingBodies, PAGES);
    await query('DELETE FROM place_page_dependency');
    await query('DELETE FROM place_page');
    for (let n = 0; n < PAGES; n++) await pg.query("INSERT INTO rebuild_queue(place_id) VALUES($1)", [place(n)]);
    const after = meter();
    const db: FactDb = { transaction: work => pg.transaction(tx => work(metered(async (text, params = []) =>
      (await tx.query<Record<string, unknown>>(text, [...params])).rows, after))) };
    assert.deepEqual(await rebuildPlacePages({ db, limit: PAGES, concurrency: 1, purge: async () => ({ purged: true }) }),
      { rebuilt: PAGES, failed: 0, remaining: 0 });
    assert.equal(after.pageReads, PAGES);
    assert.equal(after.routingBodies, 1, "the national record's body crosses the connection once in the turn");

    const stored = await pg.query<Record<string, unknown>>("SELECT place_id,body,history_body,context FROM place_page ORDER BY place_id");
    assert.equal(stored.rows.length, PAGES);
    for (const row of stored.rows) {
      const { place_id: id, context: { prints, ...context }, ...page } = row as { place_id: string; context: Record<string, unknown> };
      assert.ok(prints, "the page keeps the prints its next rebuild compares with");
      assert.deepEqual({ ...page, context }, expected.get(String(id)), `${id} stores the same page as a page that read the record itself`);
    }

    const perPage = (bytes: number) => Math.round(bytes / PAGES);
    console.log(`place-package rows, ${PAGES} pages: before ${before.pageBytes} B (${perPage(before.pageBytes)} B/page), `
      + `turn ${after.pageBytes} B (${perPage(after.pageBytes)} B/page); all turn reads ${after.requests} requests, `
      + `${after.received} B received (${perPage(after.received)} B/page), ${after.sent} B sent (${perPage(after.sent)} B/page)`);
    const routingBytes = Buffer.byteLength(JSON.stringify(routing("first")));
    assert.ok(after.pageBytes <= before.pageBytes - (PAGES - 1) * routingBytes + PAGES * 64,
      `the turn's page reads shed the repeated record: ${after.pageBytes} of ${before.pageBytes} bytes`);
  } finally { await pg.close(); }
});

test("a routing change during a turn reaches the next page, and concurrent builders share the held body", async () => {
  const { pg, query, publish } = await store();
  try {
    const shared: PlaceTurnReads = {}, reads = meter(), read = metered(query, reads);
    const routingOf = async (n: number) => (await buildPageBody(place(n), "place", "AZ", read, shared)).readyCurrent.everydayRouting;
    assert.deepEqual(await routingOf(0), routing("first"));
    assert.deepEqual(await routingOf(1), routing("first"));
    assert.equal(reads.routingBodies, 1);
    await publish({ id: "routing-2", value: routing("second"), at: AT, recordClass: EVERYDAY_ROUTING_POINTER.recordClass as "CURATED_READER_RECORD",
      scope: EVERYDAY_ROUTING_POINTER.scope, sourceId: "everyday-routing" });
    assert.deepEqual(await routingOf(2), routing("second"), "a new row version is read in the page's own snapshot");
    assert.deepEqual(await routingOf(3), routing("second"));
    assert.equal(reads.routingBodies, 2);

    for (let n = 0; n < PAGES; n++) await pg.query("INSERT INTO rebuild_queue(place_id) VALUES($1)", [place(n)]);
    const turn = meter();
    const db: FactDb = { transaction: work => pg.transaction(tx => work(metered(async (text, params = []) =>
      (await tx.query<Record<string, unknown>>(text, [...params])).rows, turn))) };
    assert.deepEqual(await rebuildPlacePages({ db, limit: PAGES, concurrency: 4, purge: async () => ({ purged: true }) }),
      { rebuilt: PAGES, failed: 0, remaining: 0 });
    assert.ok(turn.routingBodies >= 1 && turn.routingBodies <= 4, `each of the four builders reads the body at most once (${turn.routingBodies})`);
    const pages = await pg.query<{ body: unknown }>("SELECT body FROM place_page");
    for (const page of pages.rows) assert.deepEqual(unpackReadyPlace(page.body).everydayRouting, routing("second"));
  } finally { await pg.close(); }
});
