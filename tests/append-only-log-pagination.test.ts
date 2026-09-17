/**
 * The append-only log read must not exceed the Neon HTTP driver's 64 MiB
 * response cap. Before 2026-09-17 `pgAppendOnlyRepository.read`/`readAll` issued
 * ONE `SELECT ... ORDER BY position` with no bound, so when the owner-digest log
 * crossed 64 MiB the read threw `NeonDbError: response is too large`. That read
 * is how the standing runner verifies its method-candidate adoption receipt at
 * startup, so the throw stopped the runner in a five-minute crash loop.
 *
 * These are deterministic, provider-independent tests over a fake `Sql` that
 * enforces the keyset contract the paginated read depends on: every read is
 * bounded by `LIMIT`, and the concatenation across pages equals the whole log in
 * the same order the single statement produced. The fake THROWS on an unbounded
 * `SELECT`, so the pre-fix code fails these tests rather than passing by luck.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEND_ONLY_LOG_READ_PAGE,
  pgAppendOnlyRepository,
} from "../lib/control-plane/repository/pg-store.ts";

interface Row {
  readonly log_key: string;
  readonly position: number;
  readonly record: unknown;
}

/**
 * A minimal in-memory stand-in for the one method the repository calls. It
 * understands only the two paged read shapes and refuses anything unbounded, so
 * a regression to a single `SELECT ... ORDER BY position` (no `LIMIT`) is caught
 * here instead of only against a >64 MiB production log.
 */
function fakeLogSql(rows: readonly Row[]) {
  const calls: string[] = [];
  const limitOf = (text: string): number => {
    const m = /LIMIT\s+(\d+)/i.exec(text);
    if (m === null) {
      throw new Error(`unbounded read would exceed the 64 MiB response cap: ${text.replace(/\s+/g, " ").trim()}`);
    }
    return Number(m[1]);
  };
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      calls.push(text);
      const limit = limitOf(text);
      // read(key): WHERE log_key = $1 AND position > $2 ORDER BY position ASC
      if (/WHERE\s+log_key\s*=\s*\$1\s+AND\s+position\s*>\s*\$2/i.test(text)) {
        const [key, after] = params as [string, number];
        return rows
          .filter((r) => r.log_key === key && r.position > after)
          .sort((a, b) => a.position - b.position)
          .slice(0, limit)
          .map((r) => ({ position: r.position, record: r.record }));
      }
      // readAll next page: WHERE (log_key, position) > ($1, $2)
      if (/WHERE\s+\(log_key,\s*position\)\s*>\s*\(\$1,\s*\$2\)/i.test(text)) {
        const [key, position] = params as [string, number];
        return rows
          .filter((r) => r.log_key > key || (r.log_key === key && r.position > position))
          .sort((a, b) => (a.log_key === b.log_key ? a.position - b.position : a.log_key < b.log_key ? -1 : 1))
          .slice(0, limit)
          .map((r) => ({ log_key: r.log_key, position: r.position, record: r.record }));
      }
      // readAll first page: ORDER BY log_key ASC, position ASC, no WHERE cursor
      if (/ORDER BY\s+log_key ASC,\s*position ASC/i.test(text) && !/WHERE/i.test(text)) {
        return rows
          .slice()
          .sort((a, b) => (a.log_key === b.log_key ? a.position - b.position : a.log_key < b.log_key ? -1 : 1))
          .slice(0, limit)
          .map((r) => ({ log_key: r.log_key, position: r.position, record: r.record }));
      }
      throw new Error(`fake Sql did not recognize query: ${text.replace(/\s+/g, " ").trim()}`);
    },
  };
  return { sql, calls };
}

test("read() pages a log larger than one response and returns every record in position order", async () => {
  const n = APPEND_ONLY_LOG_READ_PAGE * 2 + 30; // forces at least three pages
  const rows: Row[] = Array.from({ length: n }, (_, i) => ({
    log_key: "owner-digest",
    position: i,
    record: { seq: i },
  }));
  // Noise under other keys must not leak into a single-key read.
  rows.push({ log_key: "other", position: 0, record: { seq: -1 } });

  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");

  const out = await repo.read("owner-digest");
  assert.equal(out.length, n, "read must return every record for the key");
  assert.deepEqual(out.map((r) => r.seq), Array.from({ length: n }, (_, i) => i), "records must be in position order");
  assert.ok(calls.length >= 3, `expected multiple bounded pages, saw ${calls.length}`);
  assert.ok(calls.every((c) => /LIMIT/i.test(c)), "every read statement must carry LIMIT");
});

test("read() of an absent key is one empty bounded page", async () => {
  const { sql, calls } = fakeLogSql([]);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");
  assert.deepEqual(await repo.read("nothing-here"), []);
  assert.equal(calls.length, 1);
});

test("readAll() pages the whole table in (log_key, position) order", async () => {
  const big = APPEND_ONLY_LOG_READ_PAGE * 2 + 5;
  const rows: Row[] = [];
  for (let i = 0; i < 5; i++) rows.push({ log_key: "aaa", position: i, record: { k: "aaa", p: i } });
  for (let i = 0; i < big; i++) rows.push({ log_key: "bbb", position: i, record: { k: "bbb", p: i } });
  for (let i = 0; i < 3; i++) rows.push({ log_key: "ccc", position: i, record: { k: "ccc", p: i } });

  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ k: string; p: number }>(sql, "owner_digests");

  const out = await repo.readAll();
  assert.equal(out.length, rows.length, "readAll must return every record in the table");
  const expected = rows
    .slice()
    .sort((a, b) => (a.log_key === b.log_key ? a.position - b.position : a.log_key < b.log_key ? -1 : 1))
    .map((r) => r.record);
  assert.deepEqual(out, expected, "readAll order must be (log_key, position)");
  assert.ok(calls.length >= 3, `expected multiple bounded pages, saw ${calls.length}`);
  assert.ok(calls.every((c) => /LIMIT/i.test(c)), "every readAll statement must carry LIMIT");
});
