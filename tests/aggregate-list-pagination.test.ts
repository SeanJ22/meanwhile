/**
 * `pgAggregateRepository.list()` reads through its changed-since read, which pages by key so it never
 * exceeds the Neon HTTP driver's 64 MiB response cap. The fake `Sql` throws on any scan without a
 * `LIMIT` (the one-row read clock aside), and the paged concatenation must equal the whole table in id order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGREGATE_LIST_READ_PAGE,
  pgAggregateRepository,
} from "../lib/control-plane/repository/pg-store.ts";
import { jsonTextAtPath, projectAggregate } from "../lib/control-plane/repository/types.ts";

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
      if (/^SELECT now\(\) AS read_at$/.test(text)) return [{ read_at: "2026-09-17T00:00:00.000Z" }];
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
  assert.ok(calls.length >= 4, `expected the read clock and multiple bounded pages, saw ${calls.length}`);
  assert.match(calls[0]!, /SELECT now\(\) AS read_at/);
  assert.ok(calls.slice(1).every((c) => /LIMIT/i.test(c)), "every list statement must carry LIMIT");
});

test("list() of an empty table is the read clock and one empty bounded page", async () => {
  const { sql, calls } = fakeAggregateSql([]);
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  assert.deepEqual(await repo.list(), []);
  assert.equal(calls.length, 2);
});

test("identity-only door pages count every row without loading door values", async () => {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE cp_doors(id text PRIMARY KEY, revision bigint NOT NULL,
      updated_at timestamptz NOT NULL, changed_at timestamptz NOT NULL DEFAULT now(), value jsonb NOT NULL);
      INSERT INTO cp_doors SELECT 'door-' || lpad(n::text, 6, '0'), 1, now(), now(),
        jsonb_build_object('publisherBody', repeat('source record', 4000)) FROM generate_series(1, 201) n`);
    let pages = 0, counted = 0;
    const repo = pgAggregateRepository({ query: async (text, params = []) => (await db.query(text, [...params])).rows }, "Door", "cp_doors");
    const result = await repo.listChangedSince!(null, undefined, { projection: {}, page: rows => {
      pages++;
      assert.ok(rows.length <= AGGREGATE_LIST_READ_PAGE);
      for (const row of rows) {
        assert.deepEqual(row.value, {}, "the database must return metadata without the source body");
        assert.equal(row.id, `door-${String(++counted).padStart(6, "0")}`);
        assert.equal(row.revision, 1);
      }
    } });
    assert.equal(counted, 201);
    assert.equal(pages, 3);
    assert.deepEqual(result.rows, [], "the page visitor must not accumulate the country inventory");
    assert.ok(result.through !== null && Number.isFinite(Date.parse(result.through)));
  } finally { await db.close(); }
});

test("listNarrowed reads the same bounded pages and projects each row exactly as the database projection would", async () => {
  const rows = seq(AGGREGATE_LIST_READ_PAGE * 2 + 1).map(row => ({ ...row, value: { ...row.value, dropped: "x".repeat(20), nested: { kept: 1, gone: 2 } } }));
  const { sql, calls } = fakeAggregateSql(rows);
  const repo = pgAggregateRepository<Record<string, unknown>>(sql, "WorkItem", "cp_work_items");
  const projection = { seq: true, nested: ["kept"] } as const;
  const out = await repo.listNarrowed(projection);
  assert.deepEqual(out.map(row => row.id), rows.map(row => row.id));
  assert.deepEqual(out.map(row => row.value), rows.map(row => projectAggregate(row.value, projection)));
  assert.deepEqual(out[0]!.value, { seq: 0, nested: { kept: 1 } });
  assert.equal(calls.length, 4, "the read clock and three bounded pages");
  assert.match(calls[2]!, /WHERE id > \$1/);
  const empty = fakeAggregateSql(seq(2));
  assert.deepEqual((await pgAggregateRepository(empty.sql, "WorkItem", "cp_work_items").listNarrowed({})).map(row => row.value), [{}, {}]);
});

test("listWhereNarrowed() pages like listWhere() and has the database project each row instead of sending its value", async () => {
  const { sql, calls } = fakeAggregateSql(tagged(AGGREGATE_LIST_READ_PAGE + 3, () => true));
  const repo = pgAggregateRepository<{ seq: number; routeTaskId: string }>(sql, "WorkItem", "cp_work_items");
  const out = await repo.listWhereNarrowed(["routeTaskId"], "rt-want", { seq: true });
  assert.equal(out.length, AGGREGATE_LIST_READ_PAGE + 3);
  assert.equal(calls.length, 2, "two bounded pages");
  for (const statement of calls) {
    assert.match(statement, /jsonb_each\(cp_work_items\.value\)/, "the projection is computed in the database");
    assert.doesNotMatch(statement, /updated_at, value AS value FROM/);
  }
});

test("list() of exactly one full page still terminates on the short second page", async () => {
  const { sql, calls } = fakeAggregateSql(seq(AGGREGATE_LIST_READ_PAGE));
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  const out = await repo.list();
  assert.equal(out.length, AGGREGATE_LIST_READ_PAGE);
  // One full page forces a second (empty) page to confirm the end.
  assert.equal(calls.length, 3);
  assert.ok(calls.slice(1).every((c) => /LIMIT/i.test(c)));
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
