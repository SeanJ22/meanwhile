import assert from "node:assert/strict";
import test from "node:test";
import type { FactDb, Query } from "../lib/facts/publish.ts";
import { loadStatePlaceMap, PLACE_BOUNDARY_STATEMENT_BYTES, PLACE_PAGE_QUEUE_IDS, type StatePlaceMap } from "../lib/place-map/load.ts";
import { placeMapRoute, runStatePlaceMapJob } from "../lib/place-map/job.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { sourceAcquisitionFailure } from "../lib/civic-data/source-acquisition-failure.ts";
import { Pool } from "../lib/db/client.ts";
import { readerFactDb } from "../lib/facts/db.ts";

const state = "ocd-division/country:us/state:sd";
const ring = (n: number) => Array.from({ length: n }, (_, i) => [-100 + i * 1e-6, 44 + i * 1e-6] as [number, number]);

/** South Dakota's shape on 2026-10-28: 2,590 places and 1,889 governments, with rural polygons of several hundred KB each. */
function southDakotaScale(): StatePlaceMap {
  const places = Array.from({ length: 2590 }, (_, i) => ({ id: `${state}/place:p${i}`, name: `P${i}`, state: "SD", aliases: [] }));
  return {
    places,
    boundaries: places.slice(0, 60).map((place, i) => ({ placeId: place.id, boundaryYear: 2026, layer: "cousub", version: "cousub:2026",
      geometry: { type: "MultiPolygon" as const, coordinates: [[ring(i < 10 ? 30_000 : 300)]] }, hostCountyId: null, countyAttachment: false,
      sourceUrls: ["https://www2.census.gov/geo/tiger/TIGER2026/COUSUB/tl_2026_46_cousub.zip"], checkedAt: "2026-10-28T08:00:00.000Z" })),
    zipEdges: [], zctaEdges: [],
    entityPlaces: Array.from({ length: 1889 }, (_, i) => ({ entityId: `sd:special:d${i}`, placeId: places[i % places.length]!.id, boundaryYear: 2022 })),
  };
}

/** A database that answers like production did: a statement queueing a whole state's pages runs past the read bound. */
function recordingDb() {
  const events: { readonly tx: number; readonly text: string; readonly params: readonly unknown[] }[] = [];
  const commits: number[] = [];
  let next = 0;
  const db: FactDb = {
    transaction: async work => {
      const tx = ++next;
      const query: Query = async (text, params = []) => {
        events.push({ tx, text, params });
        if (/INSERT INTO rebuild_queue/.test(text)) {
          const ids = (params[1] as string[]).length + (params[2] as string[]).length;
          if (ids > 1000) throw new Error("Query read timeout");
        }
        return [];
      };
      const out = await work(query);
      commits.push(tx);
      return out;
    },
  };
  return { db, events, commits };
}

test("a South Dakota-scale map queues its pages after the map commits, in statements far inside the read bound", async () => {
  const { db, events, commits } = recordingDb();
  await loadStatePlaceMap(db, southDakotaScale());
  const mapTx = events.find(event => /INSERT INTO place_boundary/.test(event.text))!.tx;
  const queued = events.filter(event => /INSERT INTO rebuild_queue/.test(event.text));
  assert.ok(queued.length >= 2);
  for (const event of queued) {
    assert.notEqual(event.tx, mapTx, "page queueing never waits inside the map's own transaction");
    assert.ok(commits.indexOf(event.tx) > commits.indexOf(mapTx), "pages are queued after the map commits");
    assert.ok((event.params[1] as string[]).length + (event.params[2] as string[]).length <= PLACE_PAGE_QUEUE_IDS);
  }
  const places = new Set(queued.flatMap(event => event.params[1] as string[]));
  const entities = new Set(queued.flatMap(event => event.params[2] as string[]));
  assert.equal(places.size, 2590);
  assert.equal(entities.size, 1889);
  assert.ok(events.find(event => /INSERT INTO place_map_counts/.test(event.text)), "Admin totals refresh after the pages are queued");
});

test("boundary geometry is sent in statements of at most the byte cap, every row exactly once", async () => {
  const { db, events } = recordingDb();
  const map = southDakotaScale();
  await loadStatePlaceMap(db, map);
  const statements = events.filter(event => /INSERT INTO place_boundary/.test(event.text)).map(event => String(event.params[0]));
  const rows = statements.flatMap(text => JSON.parse(text) as { place_id: string }[]);
  assert.deepEqual(rows.map(row => row.place_id), map.boundaries.map(row => row.placeId));
  for (const text of statements) {
    const count = (JSON.parse(text) as unknown[]).length;
    assert.ok(Buffer.byteLength(text) <= PLACE_BOUNDARY_STATEMENT_BYTES || count === 1, `${Buffer.byteLength(text)} bytes in ${count} rows`);
  }
  assert.ok(statements.length > 1);
});

test("a database read timeout while a state's map loads is recorded as that state's failed attempt, with exactly one receipt", async () => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  let code: number;
  try {
    code = await runStatePlaceMapJob({ facts: { query: async () => [], transaction: async () => { throw new Error("unused"); } }, store,
      root: process.cwd(), state: "SD", refresh: async () => { throw new Error("Query read timeout"); } });
  } finally { console.log = log; }
  assert.equal(code, 2);
  const receipts = lines.filter(line => line.startsWith("RCD_RECEIPT="));
  assert.equal(receipts.length, 1);
  const receipt = JSON.parse(receipts[0]!.slice("RCD_RECEIPT=".length));
  assert.equal(receipt.source, "place-map-sd");
  assert.equal(receipt.acquisitionSucceeded, false);
  assert.equal(receipt.state, "SOURCE_BLOCKED");
  const candidate = await store.readCandidate(receipt.candidateId);
  assert.equal(candidate?.candidate.retrieval.requestedUrl, placeMapRoute("SD"));
  assert.equal(candidate?.candidate.retrieval.failureDetail, "PLACE_MAP_LOAD_FAILED: Query read timeout");
});

test("an unavailable Census source for a state map is recorded with the state's own route", async () => {
  const store = new MemoryRoutineDataStore(), lines: string[] = [], log = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(" ")); };
  try {
    assert.equal(await runStatePlaceMapJob({ facts: { query: async () => [], transaction: async () => { throw new Error("unused"); } }, store,
      root: process.cwd(), state: "ND", refresh: async () => { throw sourceAcquisitionFailure("PUBLISHER_UNAVAILABLE", "Census HTTP 503"); } }), 2);
  } finally { console.log = log; }
  const receipt = JSON.parse(lines.find(line => line.startsWith("RCD_RECEIPT="))!.slice("RCD_RECEIPT=".length));
  assert.equal(receipt.source, "place-map-nd");
  assert.equal((await store.readCandidate(receipt.candidateId))?.candidate.retrieval.failureDetail, "PUBLISHER_UNAVAILABLE: Census HTTP 503");
});

test("a transaction whose statement passed the read bound closes its connection instead of queueing a ROLLBACK behind it", async () => {
  const sent: string[] = [], released: unknown[] = [];
  const connect = Pool.prototype.connect;
  Pool.prototype.connect = (async () => ({
    query: async (config: { text: string }) => {
      sent.push(config.text);
      if (config.text === "SLOW") throw new Error("Query read timeout");
      return { rows: [] };
    },
    release: (error?: unknown) => { released.push(error); },
  })) as unknown as typeof Pool.prototype.connect;
  try {
    const db = readerFactDb("postgresql://reader@place-map-load-bounds.invalid/db");
    await assert.rejects(db.transaction(query => query("SLOW")), /Query read timeout/);
    assert.deepEqual(sent, ["BEGIN", "SLOW"]);
    assert.match(String(released[0]), /Query read timeout/);
    sent.length = 0; released.length = 0;
    await assert.rejects(db.transaction(async query => { await query("UPDATE pass_cursor SET position=position"); throw new Error("ordinary failure"); }), /ordinary failure/);
    assert.deepEqual(sent, ["BEGIN", "UPDATE pass_cursor SET position=position", "ROLLBACK"]);
    assert.equal(released[0], undefined, "a rolled-back connection returns to the pool");
  } finally { Pool.prototype.connect = connect; }
});
