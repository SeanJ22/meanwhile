/** Read-only reproduction of the owed-list connection checks. No migration or production write. */
import assert from "node:assert/strict";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { readStateOwedCounts, readPlaceNeeds } from "../lib/coverage/owed-read.ts";
import { owedTable } from "../lib/coverage/owed-table.ts";
import { isAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { Query } from "../lib/facts/publish.ts";

const argument = (name: string) => process.argv[process.argv.indexOf(name) + 1];
function connection(flag: string, role: string) {
  if (!process.argv.includes(flag)) throw new Error(`Supply ${flag}`);
  const url = readFileSync(argument(flag), "utf8").trim();
  assert.equal(new URL(url).username, role, "Use the assigned read-only role");
  return neon(url);
}
const reader = connection("--reader-url-file", "readonly");
const control = connection("--control-url-file", "wtp_cp_release_readonly");
const query: Query = async (text, params = []) => reader.query(text, [...params]) as Promise<Record<string, unknown>[]>;
const [identity] = await reader.query("SELECT current_user AS role,current_database() AS database");
const [cpIdentity] = await control.query("SELECT current_user AS role,current_database() AS database,(SELECT count(*) FROM cp_admin_setting_history) AS history_rows");
const [setting] = await control.query("SELECT value FROM cp_admin_config WHERE id='current'");
if (setting && !isAdminConfig(setting.value)) throw new Error("Admin settings could not be read");
const config = setting?.value ?? null;
const now = new Date().toISOString();
let statement = "", params: readonly unknown[] = [];
await readStateOwedCounts(async (sql, bound) => { statement = sql; params = bound ?? []; return []; }, config, now);

/** Independently form the set of entity/field pairs from rules, facts and blanks, then count it. */
const direct = `WITH inputs AS (SELECT $1::jsonb AS rules,$2::timestamptz AS at,$3::jsonb AS clocks),
  rules AS (SELECT r.* FROM inputs CROSS JOIN LATERAL jsonb_to_recordset(rules) r(kind text,field text,label text,clock text,state text,place_kind text)),
  actual AS (SELECT entity_id,field FROM fact WHERE status IN ('live','held') UNION SELECT entity_id,field FROM blank),
  expected AS (
    SELECT e.id AS entity_id,r.field FROM entity e JOIN rules r ON e.kind=r.kind AND (r.state IS NULL OR r.state=coalesce(e.state,'US'))
      AND (r.place_kind IS NULL OR r.place_kind=split_part(regexp_replace(e.id,'^.*/',''),':',1))
    WHERE NOT EXISTS(SELECT 1 FROM actual a WHERE a.entity_id=e.id AND (a.field=r.field OR starts_with(a.field,r.field||':')))
    UNION SELECT entity_id,field FROM actual
  ), present AS (SELECT DISTINCT entity_id,field FROM fact WHERE status IN ('live','held'))
  SELECT coalesce(e.state,'US') AS state,count(*) AS owed,count(p.entity_id) AS held,count(*)-count(p.entity_id) AS missing
  FROM expected x JOIN entity e ON e.id=x.entity_id LEFT JOIN present p ON p.entity_id=x.entity_id AND p.field=x.field GROUP BY e.state`;
const start = performance.now();
const [countRows, independentRows] = await reader.transaction([
  reader.query(statement, [...params]), reader.query(direct, [...params]),
], { isolationLevel: "RepeatableRead", readOnly: true });
const countMs = Math.round(performance.now() - start);
const counts = await readStateOwedCounts(async () => countRows, config, now);
for (const count of counts) {
  const expected = independentRows.find(row => row.state === count.state);
  for (const field of ["owed", "held", "missing"] as const) assert.equal(count[field], Number(expected?.[field] ?? 0), `${count.state} ${field}`);
  assert.equal(count.owed, count.held + count.missing);
}
console.log(`All ${counts.length} state/national totals match independent SQL (${countMs} ms for both queries).`);

const places = await reader.query(`SELECT DISTINCT ON (p.state) p.id,p.name,p.state FROM entity p
  WHERE p.kind='place' AND p.state=ANY($1::char(2)[]) AND p.id LIKE '%/county:%'
    AND EXISTS(SELECT 1 FROM entity_place ep JOIN fact f ON f.entity_id=ep.entity_id
      WHERE ep.place_id=p.id AND f.status IN ('live','held')) ORDER BY p.state,p.id`, [["AZ", "CA", "CO", "FL", "GA", "IL", "NH", "NJ", "TX", "WI"]]);
assert.equal(places.length, 10, "Ten production places in ten states");
const checks = [];
for (const place of places) {
  const start = performance.now();
  const needs = await readPlaceNeeds(query, config, String(place.id), now);
  const keys = new Set([...needs.held, ...needs.missing].map(item => JSON.stringify([item.entityId, item.field])));
  assert.equal(keys.size, needs.counts.owed);
  for (const item of needs.held) assert.ok(item.facts.length > 0);
  const entities = [...new Set([...needs.held, ...needs.missing].map(item => item.entityId))];
  const held = await reader.query(`SELECT DISTINCT entity_id,field FROM fact WHERE status IN ('live','held') AND entity_id=ANY($1::text[])`, [entities]);
  const heldKeys = new Set(held.map(row => JSON.stringify([row.entity_id, row.field])));
  assert.equal(needs.counts.held, heldKeys.size, String(place.id));
  for (const item of needs.missing) assert.ok(!heldKeys.has(JSON.stringify([item.entityId, item.field])));
  const next = await readPlaceNeeds(query, config, String(place.id), new Date(Date.parse(now) + 20 * 60_000).toISOString());
  assert.ok(next.counts.held >= needs.counts.held, "A later pass keeps held values");
  checks.push({ state: place.state, placeId: place.id, name: place.name, ...needs.counts, readMs: Math.round(performance.now() - start),
    heldExample: needs.held.find(item => item.facts.some(fact => fact.sourceUrl)) ?? null,
    missingExample: needs.missing[0] ?? null, nextPass: next.counts });
  console.log(`${place.state} ${place.name}: ${needs.counts.owed} owed, ${needs.counts.held} held, ${needs.counts.missing} missing.`);
}
mkdirSync("docs/rb-a6", { recursive: true });
writeFileSync("docs/rb-a6/production.json", JSON.stringify({ observedAt: now, reader: identity, control: cpIdentity,
  table: { base: owedTable(config).base.length, states: Object.keys(owedTable(config).states) }, countMs, counts, places: checks }, null, 2) + "\n");
