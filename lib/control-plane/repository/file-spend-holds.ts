import { createRequire } from "node:module";
import { join } from "node:path";
import type { BudgetLedger, SpendHold } from "../budget.ts";
import { createLedger } from "../budget.ts";
import { areaRefusal, everyLineMustFit, hasBudgetLines, invalidAmountRefusal, newSpendHold, sendRefusal,
  settleHolds, SETTLED_HOLD_RETENTION_MS, SPEND_HOLD_STALE_MS, SPEND_HOLD_SWEEP_LIMIT, SPEND_HOLD_WINDOW_MS,
  type BudgetLine, type SpendHoldStore } from "../expansion/spend-holds.ts";
import type { AggregateRepository, LockManager } from "./types.ts";
import { BUDGET_AGGREGATE_ID } from "./shared.ts";

interface Statement {
  get(...values: unknown[]): Record<string, unknown> | undefined;
  all(...values: unknown[]): Record<string, unknown>[];
  run(...values: unknown[]): { changes: number };
}
interface Database { exec(sql: string): void; prepare(sql: string): Statement; close(): void }
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => Database };
const liveSql = "(h.lifetime=1 OR h.held_at>=?) AND ((h.settled_at IS NULL AND h.held_at>=?) OR (h.settled_at IS NOT NULL AND h.settled_at>=?))";
const cutoffs = (now: string) => {
  const time = Date.parse(now);
  if (!Number.isFinite(time)) throw new Error("Spend holds require an instant.");
  return [time - SPEND_HOLD_WINDOW_MS, time - SPEND_HOLD_STALE_MS, time - SETTLED_HOLD_RETENTION_MS];
};
const holdsOf = (rows: Record<string, unknown>[]): Record<string, SpendHold> => Object.fromEntries(rows.map(row => {
  const hold = JSON.parse(String(row.data)) as SpendHold;
  return [hold.holdId, hold];
}));

export async function createFileSpendHoldRepository(root: string, budget: AggregateRepository<BudgetLedger>, locks: LockManager): Promise<SpendHoldStore> {
  const file = join(root, "spend-holds.sqlite");
  const run = <T>(write: boolean, operation: (db: Database) => T): T => {
    const db = new DatabaseSync(file);
    let begun = false;
    try {
      db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA cache_size=-128; PRAGMA temp_store=FILE");
      if (write) { db.exec("BEGIN IMMEDIATE"); begun = true; }
      const result = operation(db);
      if (write) db.exec("COMMIT");
      return result;
    } catch (error) { if (begun) db.exec("ROLLBACK"); throw error; }
    finally { db.close(); }
  };
  run(false, db => db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS holds (id TEXT PRIMARY KEY, job TEXT NOT NULL, held_at INTEGER NOT NULL,
      settled_at INTEGER, amount REAL NOT NULL, settled_amount REAL, lifetime INTEGER NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS holds_job ON holds(job);
    CREATE INDEX IF NOT EXISTS holds_held ON holds(held_at);
    CREATE INDEX IF NOT EXISTS holds_settled ON holds(settled_at);
    CREATE TABLE IF NOT EXISTS hold_keys (key TEXT NOT NULL, id TEXT NOT NULL REFERENCES holds(id) ON DELETE CASCADE, PRIMARY KEY(key,id));
    CREATE INDEX IF NOT EXISTS hold_keys_id ON hold_keys(id);`));
  const put = (db: Database, hold: SpendHold, insertOnly = false) => {
    const result = db.prepare(`INSERT ${insertOnly ? "OR IGNORE" : "OR REPLACE"} INTO holds
      (id,job,held_at,settled_at,amount,settled_amount,lifetime,data) VALUES (?,?,?,?,?,?,?,?)`)
      .run(hold.holdId, hold.jobId, Date.parse(hold.heldAt), hold.settled ? Date.parse(hold.settled.costRecordedAt) : null,
        hold.usd, hold.settled?.usd ?? null, hold.lifetimeKeys?.length ? 1 : 0, JSON.stringify(hold));
    if (!result.changes) return;
    const key = db.prepare("INSERT OR IGNORE INTO hold_keys(key,id) VALUES (?,?)");
    for (const value of hold.keys) key.run(value, hold.holdId);
  };
  const previousBudget = await budget.read(BUDGET_AGGREGATE_ID);
  if (previousBudget && "spendHolds" in previousBudget.value) await locks.withLock(`budget:${BUDGET_AGGREGATE_ID}`, async () => {
    const previous = await budget.read(BUDGET_AGGREGATE_ID);
    if (!previous || !("spendHolds" in previous.value)) return;
    run(true, db => { for (const hold of Object.values(previous.value.spendHolds ?? {})) put(db, hold, true); });
    const next = { ...previous.value };
    delete next.spendHolds;
    await budget.compareAndSet(BUDGET_AGGREGATE_ID, previous.revision, next, new Date().toISOString());
  });
  const left = (db: Database, lines: readonly BudgetLine[], now: string) => {
    const since = cutoffs(now);
    const query = db.prepare(`SELECT coalesce(sum(CASE WHEN h.settled_at IS NULL THEN h.amount
      WHEN h.settled_at>? THEN h.settled_amount ELSE 0 END),0) amount FROM hold_keys k JOIN holds h ON h.id=k.id
      WHERE k.key=? AND ${liveSql} AND (?=1 OR h.held_at>=?)`);
    return lines.map(line => {
      const time = Date.parse(line.historyReadAt);
      if (!Number.isFinite(time)) throw new Error("Spend history requires an instant.");
      const held = Number(query.get(time, line.key, ...since, line.lifetime ? 1 : 0, since[0])?.amount ?? 0);
      const amount = Math.round((line.budgetUsd - line.historicalUsd - held) * 1e9) / 1e9;
      return amount === 0 ? 0 : amount;
    });
  };
  const sweep = (db: Database, now: string) => db.prepare(`DELETE FROM holds WHERE id IN
    (SELECT h.id FROM holds h WHERE NOT (${liveSql}) LIMIT ?)`)
    .run(...cutoffs(now), SPEND_HOLD_SWEEP_LIMIT).changes;
  return {
    admit: async (input, now) => run(true, db => {
      const since = cutoffs(now);
      const existing = db.prepare(`SELECT h.data FROM holds h WHERE h.id=? AND ${liveSql}`).get(input.holdId, ...since);
      if (existing) return { admit: true, hold: JSON.parse(String(existing.data)) as SpendHold };
      if (!hasBudgetLines(input.lines)) return { admit: true, hold: null };
      if (!Number.isFinite(input.usd) || input.usd < 0) return invalidAmountRefusal(input);
      const sends = left(db, input.lines.sends, now);
      if (sends.length && !sends.some(amount => amount >= input.usd)) return sendRefusal(input, sends[0]);
      const required = everyLineMustFit(input.lines), amounts = left(db, required, now);
      for (let index = 0; index < required.length; index++) if (amounts[index] < input.usd) return areaRefusal(input, required[index], amounts[index]);
      const hold = newSpendHold({ ...input, now });
      put(db, hold); sweep(db, now);
      return { admit: true, hold };
    }),
    settle: async (input, now) => run(true, db => {
      const rows = db.prepare(`SELECT h.data FROM holds h WHERE h.job=? AND ${liveSql}`).all(input.jobId, ...cutoffs(now));
      const ledger = settleHolds({ ...createLedger({ hosts: [] }), spendHolds: holdsOf(rows) }, { ...input, now });
      for (const hold of Object.values(ledger.spendHolds ?? {})) put(db, hold);
      sweep(db, now);
    }),
    release: async (id, now) => { cutoffs(now); run(true, db => db.prepare("DELETE FROM holds WHERE id=?").run(id)); },
    left: async (lines, now) => run(false, db => left(db, lines, now)),
    liveAll: async now => run(false, db => holdsOf(db.prepare(`SELECT h.data FROM holds h WHERE ${liveSql} ORDER BY h.id`).all(...cutoffs(now)))),
    sweep: async now => run(true, db => sweep(db, now)),
  };
}
