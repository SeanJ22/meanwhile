import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { aggregatePricedSpend, pricedModelCharge } from "../lib/control-plane/fleet-safety.ts";
import { MODELS } from "../lib/models.ts";
import { costRecordId } from "../lib/control-plane/spend-window.ts";
import { backfillModelCharges, MODEL_CHARGES_DDL, pgModelCharges } from "../lib/control-plane/repository/model-charges.ts";
import { MS_01_MODEL_CHARGES } from "../lib/control-plane/repository/MS-01-model-charges.ts";

const NOW = "2026-10-15T18:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
function entry(id: string, hours: number, usd: number | null, extra: Partial<CostEntry> = {}): CostEntry {
  return { attemptId: id, workItemId: `wi-${id}`, routeTaskId: `rt-${id}`, routeId: null, source: "api.anthropic.com", jurisdiction: null,
    project: "freshness", role: "SCOUT", model: MODELS.haiku.model, recordedAt: at(hours), cost: { ...ZERO_COST, usd, requestCount: 1 }, ...extra };
}
async function fixture() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE cp_log_costs (log_key text,position bigint,recorded_at timestamptz,record jsonb);
    CREATE INDEX costs_at ON cp_log_costs(recorded_at);
    CREATE TABLE cp_schema_version (singleton boolean,version integer);`);
  for (const sql of MODEL_CHARGES_DDL) await pg.exec(sql);
  const emitted: number[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    const rows = (await pg.query<Record<string, unknown>>(text, params)).rows;
    emitted.push(rows.length);
    return rows;
  };
  return { pg, query, emitted, charges: pgModelCharges(query),
    async append(row: CostEntry, position = 0, storedAt = row.recordedAt) {
      await pg.query("INSERT INTO cp_log_costs VALUES ($1,$2,$3,$4)", [row.workItemId, position, storedAt, JSON.stringify(row)]);
    } };
}

test("SQL totals match exact window and measured/unknown request pricing", async () => {
  const db = await fixture();
  try {
    const rows = [entry("before", 25, 9), entry("boundary", 24, 2), entry("today", 1, 0.5), entry("unknown", 2, null),
      entry("null-route", 3, 0.2, { routeTaskId: null }), entry("future", -1, 7),
      entry("search", 2, 3, { role: "DISCOVERY_SEARCH", source: "api.search.brave.com" }),
      entry("own-before", 5, 0.4, { routeTaskId: "own" }), entry("own-current", 1, 0.6, { routeTaskId: "own" })];
    for (const row of rows) { await db.append(row); await db.charges.record(row); }
    const counted = rows.flatMap(row => pricedModelCharge(row, costRecordId(row)) ?? []);
    const actual = await db.charges.totals({ since: at(24), until: NOW });
    const expected = aggregatePricedSpend(counted, at(24), NOW);
    assert.ok(Math.abs(actual.usd - expected.usd) < 1e-12);
    assert.ok(Math.abs(actual.knownUsd - expected.knownUsd) < 1e-12);
    assert.deepEqual({ ...actual, usd: 0, knownUsd: 0 }, { ...expected, usd: 0, knownUsd: 0 });
    assert.equal(db.emitted.at(-1), 1);
    assert.equal(actual.unmeasured, 1);
    assert.equal(actual.worstCaseCharges, 1);
    assert.equal((await db.charges.totals({ since: NOW, until: NOW })).usd, 0);
  } finally { await db.pg.close(); }
});

test("bounded ledger replay repairs missing prices, preserves existing prices and rejects incomplete admission", async () => {
  const db = await fixture();
  try {
    const old = entry("old", 2, 3);
    await db.append(old);
    const price = { ...pricedModelCharge(old, costRecordId(old))!, usd: 0.125, knownUsd: 0.125 };
    await db.pg.exec("CREATE TABLE cp_spend_window (value jsonb)");
    await db.pg.query("INSERT INTO cp_spend_window VALUES ($1)", [JSON.stringify({ charges: [price] })]);
    await db.pg.exec(MS_01_MODEL_CHARGES);
    await db.pg.exec(MS_01_MODEL_CHARGES);
    assert.equal((await db.pg.query<{ old: string | null }>("SELECT to_regclass('cp_spend_window') old")).rows[0].old, "cp_spend_window");
    await db.charges.record(old);
    assert.equal((await db.charges.totals({ since: at(24), until: NOW })).usd, 0.125);
    for (let i = 0; i < 205; i++) await db.append(entry(`new-${i}`, 1, 0.5));
    await assert.rejects(db.charges.totals({ since: at(24), until: NOW }), /pricing is incomplete/);
    db.emitted.length = 0;
    assert.equal(await backfillModelCharges(db.query, NOW), 100);
    assert.equal(db.emitted.length, 2, "one bounded read and one atomic batch price write");
    await assert.rejects(db.charges.totals({ since: at(24), until: NOW }), /pricing is incomplete/);
    assert.equal(await backfillModelCharges(db.query, NOW), 100);
    assert.equal(await backfillModelCharges(db.query, NOW), 5);
    assert.ok(Math.max(...db.emitted) <= 100);
    assert.deepEqual(db.emitted.filter(n => n > 1), [100, 100, 5]);
    const total = await db.charges.totals({ since: at(24), until: NOW });
    assert.equal(total.usd, 102.625);
    assert.equal(total.measured, 206);
    assert.equal(db.emitted.at(-1), 1);
    db.emitted.length = 0;
    assert.equal(await backfillModelCharges(db.query, NOW), 0);
    assert.deepEqual(db.emitted, [0]);
  } finally { await db.pg.close(); }
});

test("atomic price replay retries rolled-back deadlocks and leaves other database refusals visible", async () => {
  const db = await fixture();
  try {
    const row = entry("retry", 1, 0.5);
    await db.append(row);
    let attempts = 0;
    const charges = pgModelCharges(async (sql, params) => {
      if (++attempts < 3) throw Object.assign(new Error("deadlock detected"), { code: "40P01" });
      return db.query(sql, params);
    });
    await charges.record(row);
    assert.equal(attempts, 3);
    assert.equal((await db.charges.totals({ since: at(24), until: NOW })).usd, 0.5);
    attempts = 0;
    const refused = pgModelCharges(async () => { attempts++; throw Object.assign(new Error("refused"), { code: "42501" }); });
    await assert.rejects(refused.record(row), /refused/);
    assert.equal(attempts, 1);
  } finally { await db.pg.close(); }
});


test("replay and completeness follow the model request clock even when ledger persistence was delayed", async () => {
  const db = await fixture();
  try {
    const row = entry("clock-skew", 1, 0.75);
    await db.append(row, 0, at(80));
    await assert.rejects(db.charges.totals({ since: at(24), until: NOW }), /pricing is incomplete/);
    await backfillModelCharges(db.query, NOW);
    assert.equal((await db.charges.totals({ since: at(24), until: NOW })).usd, 0.75);
  } finally { await db.pg.close(); }
});

test("prefix sums preserve every millisecond across negative, radix and future boundaries", async () => {
  const db = await fixture();
  try {
    const clocks = [-1001, -1, 0, 1, 255, 256, 65535, 65536, Date.parse(NOW), Date.parse(NOW) + 1, Date.parse("2060-01-01T00:00:00Z")];
    const rows = clocks.map((clock, i) => ({ ...entry(`boundary-${i}`, 0, 0.125), recordedAt: new Date(clock).toISOString() }));
    for (const row of rows) { await db.append(row); await db.charges.record(row); }
    const priced = rows.map(row => pricedModelCharge(row, costRecordId(row))!);
    for (let i = 0; i < clocks.length; i++) {
      for (let j = i; j < clocks.length; j++) {
        const since = new Date(clocks[i]).toISOString(), until = new Date(clocks[j]).toISOString();
        assert.deepEqual(await db.charges.totals({ since, until }), aggregatePricedSpend(priced, since, until));
      }
    }
  } finally { await db.pg.close(); }
});

test("a failed aggregate write rolls back the price and retains the pending hold; retry counts once", async () => {
  const db = await fixture();
  try {
    const row = entry("atomic", 0, 2);
    await db.append(row);
    await db.pg.exec("ALTER TABLE cp_model_spend_totals ADD CONSTRAINT fixture_ceiling CHECK (usd < 1)");
    await assert.rejects(db.charges.record(row), /fixture_ceiling/);
    assert.equal((await db.pg.query<{ count: number }>("SELECT count(*)::integer count FROM cp_model_charges")).rows[0].count, 0);
    await assert.rejects(db.charges.totals({ since: at(24), until: NOW }), /pricing is incomplete/);
    await db.pg.exec("ALTER TABLE cp_model_spend_totals DROP CONSTRAINT fixture_ceiling");
    await db.charges.record(row);
    await db.charges.record(row);
    assert.equal((await db.charges.totals({ since: at(24), until: NOW })).usd, 2);
    assert.equal((await db.pg.query<{ count: number }>("SELECT count(*)::integer count FROM cp_model_spend_totals")).rows[0].count, 7);
    assert.equal((await db.pg.query<{ count: number }>("SELECT count(*)::integer count FROM cp_model_charge_pending")).rows[0].count, 0);
  } finally { await db.pg.close(); }
});

test("the additive migration queues pre-trigger ledger gaps once and preserves old writers until retirement", async () => {
  const db = await fixture();
  try {
    await db.pg.exec("ALTER TABLE cp_log_costs DISABLE TRIGGER cp_log_costs_price_pending");
    const now = new Date().toISOString(), row = { ...entry("legacy-gap", 0, 0.25), recordedAt: now };
    await db.append(row);
    await db.pg.exec("ALTER TABLE cp_log_costs ENABLE TRIGGER cp_log_costs_price_pending");
    await db.pg.exec(MS_01_MODEL_CHARGES);
    const range = { since: new Date(Date.parse(now) - 86_400_000).toISOString(), until: now };
    await assert.rejects(db.charges.totals(range), /pricing is incomplete/);
    await backfillModelCharges(db.query, now);
    assert.equal((await db.charges.totals(range)).usd, 0.25);
    await db.pg.exec("INSERT INTO cp_schema_version VALUES (true,33)");
    await db.pg.exec(MS_01_MODEL_CHARGES);
    assert.equal((await db.charges.totals(range)).usd, 0.25);
  } finally { await db.pg.close(); }
});

test("pending prefixes preserve exact request clocks and duplicate queue writes count once", async () => {
  const db = await fixture();
  try {
    const future = entry("pending-future", -1, 1), boundary = entry("pending-boundary", 0, 0.25);
    await db.append(future);
    assert.equal((await db.charges.totals({ since: at(24), until: NOW })).usd, 0);
    await db.append(boundary);
    await db.append(boundary, 1);
    await assert.rejects(db.charges.totals({ since: NOW, until: NOW }), /pricing is incomplete/);
    await db.charges.record(boundary);
    await db.charges.record(boundary);
    assert.equal((await db.charges.totals({ since: NOW, until: NOW })).usd, 0.25);
    await assert.rejects(db.charges.totals({ since: NOW, until: future.recordedAt }), /pricing is incomplete/);
  } finally { await db.pg.close(); }
});

test("pending prefix installation preserves existing prices and initializes existing queue rows exactly once", async () => {
  const db = await fixture();
  try {
    const priced = entry("upgrade-priced", 1, 0.625), waiting = entry("upgrade-pending", 1, 0.125);
    await db.append(priced);
    await db.charges.record(priced);
    await db.pg.exec("DROP TRIGGER cp_model_charge_pending_totals ON cp_model_charge_pending; ALTER TABLE cp_model_spend_totals DROP COLUMN pending");
    await db.append(waiting);
    for (let pass = 0; pass < 2; pass++) for (const ddl of MODEL_CHARGES_DDL) await db.pg.exec(ddl);
    await assert.rejects(db.charges.totals({ since: at(24), until: NOW }), /pricing is incomplete/);
    await db.charges.record(waiting);
    assert.equal((await db.charges.totals({ since: at(24), until: NOW })).usd, 0.75);
  } finally { await db.pg.close(); }
});
