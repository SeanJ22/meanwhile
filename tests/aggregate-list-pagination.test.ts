/**
 * `pgAggregateRepository.list()` pages by key so it never exceeds the Neon HTTP driver's 64 MiB
 * response cap. The fake `Sql` throws on any scan without a `LIMIT`, and the paged concatenation must
 * equal the whole table in id order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGREGATE_LIST_READ_PAGE,
  pgAggregateRepository,
} from "../lib/control-plane/repository/pg-store.ts";
import { jsonTextAtPath } from "../lib/control-plane/repository/types.ts";

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
      // listWhere(): WHERE value #>> '{path}' = $1, next pages add AND id > $2
      const filter = /value #>> '\{([^}]*)\}' = \$1/.exec(text);
      if (filter !== null) {
        const [value, after] = params as [string, string | undefined];
        const path = filter[1].split(",");
        const paged = /AND\s+id\s*>\s*\$2/i.test(text);
        return rows
          .filter((r) => jsonTextAtPath(r.value, path) === value && (!paged || r.id > String(after)))
          .sort(byId)
          .slice(0, limit)
          .map(project);
      }
      // list() next page: WHERE id > $1
      if (/WHERE\s+id\s*>\s*\$1/i.test(text)) {
        const [after] = params as [string];
        return rows.filter((r) => r.id > after).sort(byId).slice(0, limit).map(project);
      }
      // list() first page: ORDER BY id ASC, no WHERE cursor
      if (/ORDER BY\s+id ASC/i.test(text) && !/WHERE\s+id\s*>/i.test(text)) {
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

test("listNarrowed projects every bounded page in the database and keeps row order", async () => {
  const rows = seq(AGGREGATE_LIST_READ_PAGE * 2 + 1);
  const { sql, calls } = fakeAggregateSql(rows);
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  const out = await repo.listNarrowed({ seq: true });
  assert.deepEqual(out.map(row => row.id), rows.map(row => row.id));
  assert.equal(calls.length, 3);
  for (const query of calls) {
    assert.match(query, /jsonb_each\(cp_work_items\.value\) AS t WHERE t\.key IN \('seq'\)/);
    assert.match(query, /END AS value FROM cp_work_items/);
    assert.match(query, /LIMIT 100/);
  }
  assert.match(calls[1], /WHERE id > \$1/);
  await assert.rejects(() => repo.listNarrowed({ "unsafe') --": true }), /unsafe projection key/);
  const empty = fakeAggregateSql([]);
  assert.deepEqual(await pgAggregateRepository(empty.sql, "WorkItem", "cp_work_items").listNarrowed({}), []);
  assert.match(empty.calls[0], /'\{\}'::jsonb AS value/);
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

/* `listWhere()` is `list()` filtered by the database, bounded, with the value as a parameter. */
const tagged = (n: number, wanted: (seq: number) => boolean) =>
  seq(n).map((r) => ({ ...r, value: { seq: r.value.seq, routeTaskId: wanted(r.value.seq) ? "rt-want" : "rt-other" } }));

test("listWhere() pages a large match set and equals list() filtered, row for row in id order", async () => {
  const { sql, calls } = fakeAggregateSql(tagged(AGGREGATE_LIST_READ_PAGE * 3 + 7, (i) => i % 3 === 0));
  const repo = pgAggregateRepository<{ seq: number; routeTaskId: string }>(sql, "Attempt", "cp_attempts");

  const expected = (await repo.list()).filter((r) => r.value.routeTaskId === "rt-want");
  const before = calls.length;
  const out = await repo.listWhere(["routeTaskId"], "rt-want");
  const statements = calls.slice(before);
  assert.ok(expected.length > AGGREGATE_LIST_READ_PAGE, "the match set spans more than one page");
  assert.deepEqual(out, expected);
  assert.equal(statements.length, 2, "two bounded pages for 103 matches");
  assert.ok(
    statements.every((c) => /LIMIT/i.test(c) && /value #>> '\{routeTaskId\}' = \$1/.test(c)),
    "every statement is bounded and filtered in the database",
  );
  assert.ok(statements.every((c) => !c.includes("rt-want")), "the value is a parameter, never SQL text");
});

test("listWhere() of a selective filter is ONE bounded statement where list() pages the whole table", async () => {
  const { sql, calls } = fakeAggregateSql(tagged(AGGREGATE_LIST_READ_PAGE * 4, (i) => i === 7 || i === 391));
  const repo = pgAggregateRepository<{ seq: number; routeTaskId: string }>(sql, "Attempt", "cp_attempts");
  const out = await repo.listWhere(["routeTaskId"], "rt-want");
  assert.deepEqual(out.map((r) => r.value.seq), [7, 391], "a match near the start and one near the end");
  assert.equal(calls.length, 1, "one round trip");
  assert.deepEqual(await repo.listWhere(["routeTaskId"], "rt-absent"), [], "no match is an empty answer");
});

test("listWhere() refuses an unsafe JSON path segment rather than building SQL from it", async () => {
  const { sql, calls } = fakeAggregateSql([]);
  const repo = pgAggregateRepository<{ seq: number }>(sql, "Attempt", "cp_attempts");
  await assert.rejects(() => repo.listWhere(["routeTaskId'); drop table cp_attempts; --"], "x"), /unsafe JSON path/);
  await assert.rejects(() => repo.listWhere([], "x"), /empty JSON path/);
  assert.equal(calls.length, 0, "refused before any statement was sent");
});
