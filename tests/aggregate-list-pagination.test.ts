/**
 * `pgAggregateRepository.list()` must not exceed the Neon HTTP driver's 64 MiB
 * response cap. Before this fix `list()` issued ONE unbounded
 * `SELECT ... ORDER BY id`, so once an aggregate table (cp_work_items,
 * cp_attempts, …) crossed 64 MiB the read threw `NeonDbError: response is too
 * large` — and `readAutonomousActivity` lists four of them on every
 * `/admin/fleet` render, so the whole operations report collapsed to
 * STORE_UNREACHABLE. This is the append-only log's 64 MiB failure one layer up;
 * the remedy is the same keyset paging.
 *
 * Deterministic and provider-independent over a fake `Sql`: the fake THROWS on
 * an unbounded scan, so a regression to a single unbounded `SELECT` fails here
 * rather than only against a >64 MiB production aggregate. The paged
 * concatenation must equal the whole table in id order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGREGATE_LIST_READ_PAGE,
  pgAggregateRepository,
} from "../lib/control-plane/repository/pg-store.ts";

interface Row {
  readonly id: string;
  readonly revision: number;
  readonly updated_at: string;
  readonly value: Record<string, unknown>;
}

/** A minimal stand-in that understands the paged `list()` shapes and refuses
 *  any scan without a `LIMIT`, so an unbounded regression is caught here. */
function fakeAggregateSql(rows: readonly Row[]) {
  const calls: string[] = [];
  const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      calls.push(text);
      const litLimit = /LIMIT\s+(\d+)/.exec(text);
      if (litLimit === null) {
        throw new Error(`unbounded scan would risk the 64 MiB cap: ${text.replace(/\s+/g, " ").trim()}`);
      }
      const limit = Number(litLimit[1]);
      const project = (r: Row) => ({ id: r.id, revision: r.revision, updated_at: r.updated_at, value: r.value });
      // list() next page: WHERE id > $1
      if (/WHERE\s+id\s*>\s*\$1/i.test(text)) {
        const [after] = params as [string];
        return rows.filter((r) => r.id > after).sort(byId).slice(0, limit).map(project);
      }
      // list() first page: ORDER BY id ASC, no WHERE cursor
      if (/ORDER BY\s+id ASC/i.test(text) && !/WHERE/i.test(text)) {
        return rows.slice().sort(byId).slice(0, limit).map(project);
      }
      throw new Error(`fake Sql did not recognize query: ${text.replace(/\s+/g, " ").trim()}`);
    },
  };
  return { sql, calls };
}

/** ids zero-padded so lexicographic order matches numeric order. */
const seq = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `wi-${String(i).padStart(6, "0")}`,
    revision: 1,
    updated_at: "2026-09-17T00:00:00.000Z",
    value: { seq: i },
  }));

test("list() pages an aggregate larger than one response and returns every row in id order", async () => {
  const n = AGGREGATE_LIST_READ_PAGE * 2 + 30;
  const { sql, calls } = fakeAggregateSql(seq(n));
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");

  const out = await repo.list();
  assert.equal(out.length, n);
  assert.deepEqual(out.map((r) => r.value.seq), Array.from({ length: n }, (_, i) => i));
  assert.ok(calls.length >= 3, `expected multiple bounded pages, saw ${calls.length}`);
  assert.ok(calls.every((c) => /LIMIT/i.test(c)), "every list statement must carry LIMIT");
});

test("list() of an empty table is one empty bounded page", async () => {
  const { sql, calls } = fakeAggregateSql([]);
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  assert.deepEqual(await repo.list(), []);
  assert.equal(calls.length, 1);
});

test("list() of exactly one full page still terminates on the short second page", async () => {
  const { sql, calls } = fakeAggregateSql(seq(AGGREGATE_LIST_READ_PAGE));
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  const out = await repo.list();
  assert.equal(out.length, AGGREGATE_LIST_READ_PAGE);
  // One full page forces a second (empty) page to confirm the end.
  assert.equal(calls.length, 2);
  assert.ok(calls.every((c) => /LIMIT/i.test(c)));
});
