import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { shareVersionedRows } from "../lib/db/versioned-rows.ts";
import { pgAggregateRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";

test("aggregate writes retain the submitted JSON when the caller changes its object during the database request", async () => {
  const db = new PGlite(), copies = new Map<string, string>();
  let started: (() => void) | undefined, release: (() => void) | undefined;
  let blocked = Promise.resolve();
  const block = () => {
    const entered = new Promise<void>(resolve => { started = resolve; });
    blocked = new Promise<void>(resolve => { release = resolve; });
    return entered;
  };
  const sql: Sql = { query: async (text, params = []) => {
    const result = await db.query<Record<string, unknown>>(text, [...params]);
    if (/^(?:INSERT INTO|UPDATE) cp_doors/.test(text.trim()) && started) {
      const notify = started; started = undefined; notify(); await blocked;
    }
    return result.rows;
  } };
  shareVersionedRows(sql, "postgres://fixture:fixture@write-snapshot.invalid/neondb", new CivicReadCache({
    read: async key => copies.get(key) ?? null,
    write: async (key, value) => { copies.set(key, value); },
  }));
  try {
    await db.exec("CREATE TABLE cp_doors(id text PRIMARY KEY,revision bigint,updated_at timestamptz,changed_at timestamptz DEFAULT now(),value jsonb)");
    const repo = pgAggregateRepository<{ capture: string }>(sql, "Door", "cp_doors");
    const input = { capture: "original" }, inserted = block();
    const pending = repo.put("held", input, "2026-10-23T10:00:00.000Z");
    await inserted; input.capture = "caller changed the insert"; release!();
    const created = await pending;
    assert.equal(created.persisted.value.capture, "original");
    assert.equal((await repo.mustRead("held")).value.capture, "original", "the revision-checked copy must match persisted bytes");
    const next = { capture: "updated" }, swapped = block();
    const changing = repo.compareAndSet("held", created.persisted.revision, next, "2026-10-23T10:01:00.000Z");
    await swapped; next.capture = "caller changed the update"; release!();
    assert.equal((await changing).value.capture, "updated");
    assert.equal((await repo.mustRead("held")).value.capture, "updated");
    assert.deepEqual((await db.query<{ value: unknown }>("SELECT value FROM cp_doors WHERE id='held'")).rows[0].value, { capture: "updated" });
  } finally { release?.(); await db.close(); }
});
