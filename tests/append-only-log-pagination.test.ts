/**
 * The append-only log reads must not exceed the Neon HTTP driver's 64 MiB
 * response cap, and callers that want a subset must get it by CONTENT, not by
 * position. Before 2026-09-17 `pgAppendOnlyRepository.read`/`readAll` issued ONE
 * unbounded `SELECT ... ORDER BY position`, so when the owner-digest log crossed
 * 64 MiB every read threw `NeonDbError: response is too large` — and that read
 * is how the standing runner verifies its adoption receipt at startup, so it
 * crash-looped. `read`/`readAll` now page; `readWhere` is a paged content filter
 * (`record #>> path = value`) that finds a record by what it is rather than
 * where it sits; `readRecent` is a bounded newest-first tail.
 *
 * These are deterministic, provider-independent tests over a fake `Sql` that
 * enforces the contract the reads depend on: every scan is bounded by `LIMIT`,
 * the concatenation across pages equals the whole selection in order, and a
 * content filter returns EVERY match regardless of position. The fake THROWS on
 * an unbounded scan, so a regression to a single unbounded `SELECT` fails here
 * rather than only against a >64 MiB production log.
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
  readonly record: Record<string, unknown>;
}

/** The scalar text at a `{a,b}` path, mirroring Postgres `record #>> '{a,b}'`. */
function textAt(record: unknown, path: readonly string[]): string | null {
  let cursor: unknown = record;
  for (const seg of path) {
    if (cursor === null || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[seg];
  }
  return cursor === null || cursor === undefined || typeof cursor === "object" ? null : String(cursor);
}

/**
 * A minimal stand-in for the one method the repository calls. It understands the
 * paged read shapes and refuses anything without a `LIMIT`, so a regression to
 * an unbounded scan is caught here.
 */
function fakeLogSql(rows: readonly Row[]) {
  const calls: string[] = [];
  const byKeyPos = (a: Row, b: Row) => (a.log_key === b.log_key ? a.position - b.position : a.log_key < b.log_key ? -1 : 1);
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      calls.push(text);
      const litLimit = /LIMIT\s+(\d+)/.exec(text);
      // readRecent: newest first, LIMIT is a parameter.
      if (/ORDER BY\s+position DESC/i.test(text)) {
        const [key, limit] = params as [string, number];
        return rows.filter((r) => r.log_key === key).sort((a, b) => b.position - a.position).slice(0, Number(limit))
          .map((r) => ({ record: r.record }));
      }
      // readLatest: DISTINCT ON (log_key) over WHERE log_key = ANY($1): bounded by the page of keys it names.
      if (/SELECT DISTINCT ON \(log_key\)/i.test(text)) {
        const [keys] = params as [string[]];
        if (keys.length > APPEND_ONLY_LOG_READ_PAGE) throw new Error(`one readLatest statement named ${keys.length} keys, over a page`);
        const fields = [...text.matchAll(/'(\w+)', record #> '\{(\w+)\}'/g)].map((m) => m[1]);
        /* DISTINCT ON keeps each key's FIRST row in the statement's own order, as Postgres does. */
        const order = /ORDER BY log_key ASC, position (ASC|DESC)/i.exec(text)?.[1]?.toUpperCase();
        if (order === undefined) throw new Error(`a readLatest statement must order each key by position: ${text.replace(/\s+/g, " ").trim()}`);
        return keys.flatMap((key) => {
          const first = rows.filter((r) => r.log_key === key).sort((a, b) => (order === "DESC" ? b.position - a.position : a.position - b.position))[0];
          return first === undefined ? [] : [{ log_key: key, picked: Object.fromEntries(fields.map((f) => [f, first.record[f] ?? null])) }];
        });
      }
      if (litLimit === null) {
        throw new Error(`unbounded scan would risk the 64 MiB cap: ${text.replace(/\s+/g, " ").trim()}`);
      }
      const limit = Number(litLimit[1]);
      // readWhere: WHERE log_key=$1 AND position > $2 AND record #>> '{path}' = $3
      const where = /record #>> '\{([^}]*)\}' = \$3/.exec(text);
      if (where !== null) {
        const [key, after, value] = params as [string, number, string];
        const path = where[1].split(",");
        return rows.filter((r) => r.log_key === key && r.position > after && textAt(r.record, path) === value)
          .sort((a, b) => a.position - b.position).slice(0, limit)
          .map((r) => ({ position: r.position, record: r.record }));
      }
      // read: WHERE log_key=$1 AND position > $2
      if (/WHERE\s+log_key\s*=\s*\$1\s+AND\s+position\s*>\s*\$2/i.test(text)) {
        const [key, after] = params as [string, number];
        return rows.filter((r) => r.log_key === key && r.position > after)
          .sort((a, b) => a.position - b.position).slice(0, limit)
          .map((r) => ({ position: r.position, record: r.record }));
      }
      // readAll next page: WHERE (log_key, position) > ($1, $2)
      if (/WHERE\s+\(log_key,\s*position\)\s*>\s*\(\$1,\s*\$2\)/i.test(text)) {
        const [key, position] = params as [string, number];
        return rows.filter((r) => r.log_key > key || (r.log_key === key && r.position > position))
          .sort(byKeyPos).slice(0, limit).map((r) => ({ log_key: r.log_key, position: r.position, record: r.record }));
      }
      // readAll first page: ORDER BY log_key ASC, position ASC (no WHERE cursor)
      if (/ORDER BY\s+log_key ASC,\s*position ASC/i.test(text) && !/WHERE/i.test(text)) {
        return rows.slice().sort(byKeyPos).slice(0, limit).map((r) => ({ log_key: r.log_key, position: r.position, record: r.record }));
      }
      throw new Error(`fake Sql did not recognize query: ${text.replace(/\s+/g, " ").trim()}`);
    },
  };
  return { sql, calls };
}

const seq = (n: number, log_key: string, extra: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ log_key, position: i, record: { seq: i, ...extra(i) } }));

test("read() pages a log larger than one response and returns every record in position order", async () => {
  const n = APPEND_ONLY_LOG_READ_PAGE * 2 + 30;
  const rows: Row[] = [...seq(n, "owner-digest"), { log_key: "other", position: 0, record: { seq: -1 } }];
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");

  const out = await repo.read("owner-digest");
  assert.equal(out.length, n);
  assert.deepEqual(out.map((r) => r.seq), Array.from({ length: n }, (_, i) => i));
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
  const rows: Row[] = [...seq(5, "aaa"), ...seq(big, "bbb"), ...seq(3, "ccc")];
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");

  const out = await repo.readAll();
  assert.equal(out.length, rows.length);
  assert.ok(calls.length >= 3);
  assert.ok(calls.every((c) => /LIMIT/i.test(c)));
});

test("readWhere() returns EVERY match by content, paged, regardless of position", async () => {
  // A large log where the wanted records are sparse and scattered — the record
  // at position 3 and the record at the very end both match, positions apart.
  const n = APPEND_ONLY_LOG_READ_PAGE * 2 + 40;
  const rows: Row[] = seq(n, "owner-digest", (i) => ({
    runtimeOutcome: { kind: i === 3 || i === n - 1 || i % 97 === 0 ? "WANT" : "OTHER" },
  }));
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number; runtimeOutcome: { kind: string } }>(sql, "owner_digests");

  const out = await repo.readWhere("owner-digest", ["runtimeOutcome", "kind"], "WANT");
  const expected = rows.filter((r) => (r.record as { runtimeOutcome: { kind: string } }).runtimeOutcome.kind === "WANT").map((r) => r.record.seq);
  assert.deepEqual(out.map((r) => r.seq), expected, "must find every WANT record in position order");
  assert.ok(out.some((r) => r.seq === 3) && out.some((r) => r.seq === n - 1), "a match near the start and one at the very end both come back");
  assert.ok(calls.every((c) => /LIMIT/i.test(c)), "every readWhere statement must carry LIMIT");
});

test("readWhere() of a value with no match is an empty result, not an error", async () => {
  const rows: Row[] = seq(10, "owner-digest", () => ({ runtimeOutcome: { kind: "OTHER" } }));
  const { sql } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");
  assert.deepEqual(await repo.readWhere("owner-digest", ["runtimeOutcome", "kind"], "ABSENT"), []);
});

test("readWhere() refuses an unsafe JSON path segment rather than building SQL from it", async () => {
  const { sql } = fakeLogSql([]);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");
  await assert.rejects(() => repo.readWhere("owner-digest", ["runtimeOutcome", "kind'); drop"], "x"), /unsafe JSON path/);
});

test("readRecent() returns the newest N, newest first, bounded", async () => {
  const rows: Row[] = seq(50, "owner-digest");
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");

  const out = await repo.readRecent("owner-digest", 5);
  assert.deepEqual(out.map((r) => r.seq), [49, 48, 47, 46, 45], "newest first, exactly the tail");
  assert.equal(calls.length, 1, "a bounded tail is one query, not a scan");
});

test("readLatest() answers each key's newest record, only the named fields, in one statement per page of keys", async () => {
  const keys = Array.from({ length: APPEND_ONLY_LOG_READ_PAGE + 20 }, (_, i) => `j${i}`);
  const rows: Row[] = keys.flatMap((key, i) =>
    i % 3 === 0
      ? []
      : [
          { log_key: key, position: 0, record: { seq: 0, outcome: "LEAD", steps: "x".repeat(40) } },
          { log_key: key, position: 1, record: { seq: 1, outcome: i % 2 === 0 ? "FOUND" : "BLOCKED", steps: "y".repeat(40) } },
        ],
  );
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number; outcome: string; steps: string }>(sql, "discovery_attempts");

  const latest = await repo.readLatest([...keys, "j1"], ["outcome", "seq"]);
  assert.equal(calls.length, 2, "one statement per page of keys, never one per key");
  assert.ok(
    calls.every((c) => /SELECT DISTINCT ON \(log_key\) log_key, jsonb_build_object\('outcome', record #> '\{outcome\}', 'seq', record #> '\{seq\}'\) AS picked/.test(c)),
    "only the named fields travel, never the record",
  );
  assert.equal(latest.size, keys.filter((_, i) => i % 3 !== 0).length, "a key with no record is absent");
  assert.deepEqual(latest.get("j1"), { outcome: "BLOCKED", seq: 1 }, "the newest record by position");
  assert.deepEqual(latest.get("j2"), { outcome: "FOUND", seq: 1 });
  assert.equal(latest.has("j0"), false);
  assert.equal((await repo.readLatest([], ["outcome"])).size, 0);
  assert.equal(calls.length, 2, "no keys, no statement");
});

test("readLatest() refuses an unsafe field name rather than building SQL from it", async () => {
  const { sql, calls } = fakeLogSql([]);
  const repo = pgAppendOnlyRepository<Record<string, unknown>>(sql, "discovery_attempts");
  await assert.rejects(() => repo.readLatest(["j"], ["outcome'); drop" as never]), /unsafe JSON path/);
  assert.equal(calls.length, 0);
});
