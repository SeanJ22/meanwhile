import assert from "node:assert/strict";
import test from "node:test";

import { pgAggregateRepository, pgAppendOnlyRepository, type Sql } from "@/lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { SCOPED_HISTORY_INDEXES } from "@/lib/control-plane/repository/pg-schema.ts";
import type { ArtifactRecord } from "@/lib/control-plane/repository/types.ts";
import { recordSourceObservation, retireSourceDoors } from "@/lib/doors/source-capture.ts";
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
  const meter = metered(db);
  return { db, repo: pgAggregateRepository<DoorRecord>(meter.sql, "Door", "cp_doors"), measure: meter.measure };
}

/** A Sql over PGlite that counts the bytes the database sends back and the statements it runs. */
function metered(db: { query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }> }) {
  let bytes = 0, statements = 0;
  const sql: Sql = { query: async (text, params) => {
    const rows = (await db.query(text, params ? [...params] : [])).rows;
    bytes += Buffer.byteLength(JSON.stringify(rows)); statements += 1;
    return rows;
  } };
  return { sql, measure: () => ({ bytes, statements }), reset: () => { bytes = 0; statements = 0; } };
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

const OCD = "ocd-division/country:us/state:xx/place:held";
const SOURCE_KEY = `source:${OCD}`;
const EVIDENCE: SourceDisposition = { kind: "EVIDENCE", family: "meetings", recordClass: "MEETING", reason: "Agenda page", quote: "", belongs: true };
const encode = (text: string) => new TextEncoder().encode(`<html><body>${text}</body></html>`);

/** An artifact log holding `held` captures under one place's source work item and `elsewhere` under other places', as the national table does. */
async function captured(held: number, elsewhere: number) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  await db.exec(`CREATE TABLE cp_log_heads (log_table text NOT NULL, log_key text NOT NULL, next_position bigint NOT NULL, PRIMARY KEY (log_table, log_key))`);
  await db.exec(`CREATE TABLE cp_log_artifacts (log_key text NOT NULL, record_id text NOT NULL, position bigint NOT NULL, recorded_at timestamptz NOT NULL,
    record jsonb NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (log_key, record_id))`);
  await db.exec(SCOPED_HISTORY_INDEXES.find(row => row.name === "cp_log_artifacts_artifact_id")!.ddl.replace(" CONCURRENTLY", ""));
  const record = (key: string) => `jsonb_build_object('artifactId', 'ar-' || ${key}, 'workItemId', '${SOURCE_KEY}', 'routeTaskId', null, 'attemptId', 'source-discovery:${SOURCE_KEY}:' || ${key},
    'tier', 'T1', 'contentHash', repeat('a', 64), 'byteLength', 48211, 'contentType', 'text/html', 'canonicalUrl', 'https://records.example.gov/page/' || ${key}, 'partial', false, 'recordedAt', $1::text)`;
  await db.query(`INSERT INTO cp_log_artifacts (log_key, record_id, position, recorded_at, record)
    SELECT '${SOURCE_KEY}', 'ar-h' || n, n - 1, $1::timestamptz, ${record("'h' || n")} FROM generate_series(1, $2::int) AS n`, [NOW, held]);
  await db.query(`INSERT INTO cp_log_artifacts (log_key, record_id, position, recorded_at, record)
    SELECT 'source:ocd-division/country:us/state:yy/place:p' || (n % 5000), 'ar-e' || n, n / 5000, $1::timestamptz, ${record("'e' || n")} FROM generate_series(1, $2::int) AS n`, [NOW, elsewhere]);
  await db.query(`INSERT INTO cp_log_heads SELECT 'cp_log_artifacts', '${SOURCE_KEY}', $1::int`, [held]);
  await db.exec("ANALYZE cp_log_artifacts");
  const meter = metered(db);
  const repos = createMemoryRepositories();
  const vault = { putBytes: async () => ({ stored: true as const }) };
  const observe = async (text: string, at: string) => {
    meter.reset();
    const result = await recordSourceObservation({ doors: repos.doors, fieldManual: repos.fieldManual,
      artifacts: pgAppendOnlyRepository<ArtifactRecord>(meter.sql, "artifacts") },
    { url: "https://records.example.gov/agenda", ocdId: OCD, state: "XX", names: ["Held"], disposition: EVIDENCE,
      capture: { contentType: "text/html", bytes: encode(text) } }, at, vault as never);
    return { ...meter.measure(), copyId: result.copyId };
  };
  return { db, observe };
}

test("DR-01: a capture reads the one artifact row it needs, however many captures the place already holds", async () => {
  const measured = [];
  for (const [held, elsewhere] of [[400, 2000], [6400, 20000], [25600, 200000]] as const) {
    const place = await captured(held, elsewhere);
    try {
      const first = await place.observe(`new ${held}`, "2026-10-17T13:00:00.000Z");
      const again = await place.observe(`new ${held}`, "2026-10-17T14:00:00.000Z");
      const rows = (await place.db.query<{ n: string }>(`SELECT count(*) AS n FROM cp_log_artifacts WHERE log_key = $1 AND record_id = $2`, [SOURCE_KEY, first.copyId])).rows[0]!.n;
      assert.equal(Number(rows), 1, "the repeated capture is recorded once");
      assert.equal(again.copyId, first.copyId);
      const plan = (await place.db.query<{ "QUERY PLAN": string }>(`EXPLAIN SELECT record FROM cp_log_artifacts WHERE log_key = $1 AND record #>> '{artifactId}' = $2`, [SOURCE_KEY, first.copyId!])).rows.map(row => row["QUERY PLAN"]).join("\n");
      measured.push({ held, first, again, plan });
    } finally { await place.db.close(); }
  }
  const [small, , large] = measured;
  assert.ok(large!.first.bytes - small!.first.bytes <= 8, "a first capture reads the same bytes at 64x the history; only the position number gains digits");
  assert.equal(large!.again.bytes, small!.again.bytes, "a repeated capture reads the same bytes at 64x the history");
  assert.equal(large!.again.statements, small!.again.statements);
  assert.equal(large!.first.statements, small!.first.statements);
  assert.ok(large!.again.bytes < 2_000, `a repeated capture reads one row (${large!.again.bytes} bytes)`);
  assert.doesNotMatch(large!.plan, /Seq Scan/, "the lookup never scans the place's history");
});
