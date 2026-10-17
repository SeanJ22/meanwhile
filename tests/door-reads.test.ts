import assert from "node:assert/strict";
import test from "node:test";

import { pgAggregateRepository, type Sql } from "@/lib/control-plane/repository/pg-store.ts";
import { SCOPED_HISTORY_INDEXES } from "@/lib/control-plane/repository/pg-schema.ts";
import { retireSourceDoors } from "@/lib/doors/source-capture.ts";
import type { DoorRecord } from "@/lib/doors/registry.ts";
import type { SourceDisposition } from "@/lib/doors/source-content.ts";

const NOW = "2026-10-17T12:00:00.000Z";
const PAGE = "https://records.example.gov/agendas";
const SKIP: SourceDisposition = { kind: "SKIP", family: null, recordClass: null, reason: "Not a government page", quote: "", belongs: false };

/** A control-plane door table of `doors` rows (half pages, half voting sources with the multi-KB source blob production holds), with two of them on PAGE. */
async function seed(doors: number) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY, revision bigint NOT NULL, updated_at timestamptz NOT NULL, value jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now())`);
  const index = SCOPED_HISTORY_INDEXES.find(row => row.name === "cp_doors_config_url")!;
  await db.exec(index.ddl.replace(" CONCURRENTLY", ""));
  await db.query(`INSERT INTO cp_doors (id, revision, updated_at, value)
    SELECT 'door-' || n, 1, $1::timestamptz, jsonb_build_object('doorId', 'door-' || n, 'kind', CASE WHEN n % 2 = 0 THEN 'page' ELSE 'official-voting-source' END,
      'origin', 'DERIVED', 'status', 'OPEN', 'ocdId', 'ocd-division/country:us/state:xx', 'readNow', false, 'updatedAt', $1::text,
      'config', jsonb_build_object('url', 'https://host' || n || '.example.gov/page', 'votingSource', jsonb_build_object('url', 'https://host' || n || '.example.gov/page', 'blob', repeat('x', 3000))::text))
    FROM generate_series(1, $2::int) AS n`, [NOW, doors]);
  const door = (id: string, kind: string, url: string) => ({ doorId: id, kind, origin: "DERIVED", status: "OPEN", ocdId: "ocd-division/country:us/state:xx", readNow: false, updatedAt: NOW,
    config: kind === "page" ? { url } : { url, votingSource: JSON.stringify({ url }) } });
  await db.query(`INSERT INTO cp_doors (id, revision, updated_at, value) VALUES ('mine-page', 1, $1, $2), ('mine-vote', 1, $1, $3), ('other-vote', 1, $1, $4)`,
    [NOW, JSON.stringify(door("mine-page", "page", PAGE)), JSON.stringify(door("mine-vote", "official-voting-source", PAGE)),
      JSON.stringify(door("other-vote", "official-voting-source", "https://elsewhere.example.gov/vote"))]);
  await db.exec("ANALYZE cp_doors");
  let bytes = 0, statements = 0;
  const sql: Sql = { query: async (text, params) => {
    const rows = (await db.query(text, params ? [...params] : [])).rows;
    bytes += Buffer.byteLength(JSON.stringify(rows)); statements += 1;
    return rows;
  } };
  return { db, repo: pgAggregateRepository<DoorRecord>(sql, "Door", "cp_doors"), measure: () => ({ bytes, statements }), reset: () => { bytes = 0; statements = 0; } };
}

async function observe(doors: number) {
  const held = await seed(doors);
  try {
    await retireSourceDoors(held.repo, { url: PAGE, ocdId: "ocd-division/country:us/state:xx", disposition: SKIP, capture: { contentType: "text/html", bytes: new Uint8Array() } }, NOW);
    const status = async (id: string) => (await held.db.query<{ status: string }>("SELECT value->>'status' AS status FROM cp_doors WHERE id = $1", [id])).rows[0]!.status;
    const plan = (await held.db.query<{ "QUERY PLAN": string }>(`EXPLAIN SELECT id FROM cp_doors WHERE value #>> '{config,url}' = $1`, [PAGE])).rows.map(row => row["QUERY PLAN"]).join("\n");
    return { ...held.measure(), mine: [await status("mine-page"), await status("mine-vote")], other: await status("other-vote"), plan };
  } finally { await held.db.close(); }
}

test("DR-01: a page observation reads only the doors for its own URL, however many doors exist", async () => {
  const small = await observe(400), large = await observe(6400);
  assert.deepEqual(small.mine, ["SUSPENDED", "SUSPENDED"], "the page's page door and its voting-source door are both retired");
  assert.equal(small.other, "OPEN", "a voting source for another URL is left alone");
  assert.deepEqual(large.mine, ["SUSPENDED", "SUSPENDED"]);
  assert.equal(large.other, "OPEN");
  assert.equal(large.bytes, small.bytes, `bytes per observation stay flat as the table grows 16x (${small.bytes} → ${large.bytes})`);
  assert.ok(large.bytes < 4_000, `an observation reads a few KB, not the table (${large.bytes} bytes)`);
  assert.equal(large.statements, small.statements);
  assert.match(large.plan, /cp_doors_config_url/, "the URL lookup is an index scan");
});

test("DR-01: the URL lookup index is built online by the schema bootstrap", () => {
  const index = SCOPED_HISTORY_INDEXES.find(row => row.name === "cp_doors_config_url");
  assert.ok(index);
  assert.match(index.ddl, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS cp_doors_config_url ON cp_doors \(\(value #>> '\{config,url\}'\)\);$/);
});
