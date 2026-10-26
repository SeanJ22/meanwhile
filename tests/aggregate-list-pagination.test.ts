/**
 * `pgAggregateRepository.list()` and `listWhere()` read through revision reads: a keyset page of
 * `SELECT id,revision ... ORDER BY id LIMIT 100`, then values only for ids whose revision changed or
 * whose held copy is missing, fetched by `id=ANY($n::text[])` with at most 100 ids per statement.
 * No response nears the Neon HTTP driver's 64 MiB cap. The fake `Sql` throws on any scan without a
 * `LIMIT` (an `id=ANY` fetch of at most 100 ids is bounded), and the concatenated pages must equal the
 * whole table, or the filtered table, in id order.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  AGGREGATE_LIST_READ_PAGE,
  pgAggregateRepository,
} from "../lib/control-plane/repository/pg-store.ts";
import { jsonTextAtPath, projectAggregate, type RecordProjection } from "../lib/control-plane/repository/types.ts";

interface Row {
  readonly id: string;
  readonly revision: number;
  readonly updated_at: string;
  readonly value: Record<string, unknown>;
}

interface Call {
  readonly text: string;
  readonly params: readonly unknown[];
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
const REVISIONS = /^SELECT id,revision FROM (\w+)(?: WHERE (.*?))? ORDER BY id LIMIT (\d+)$/;
const VALUE_PAGE = /^SELECT id,revision,updated_at,(.*) AS value FROM (\w+)(?: WHERE (.*?))? ORDER BY id LIMIT (\d+)$/;
const VALUE_FETCH = /^SELECT id,revision,updated_at,(.*) AS value FROM (\w+) WHERE (?:\((.*)\) AND )?id=ANY\(\$(\d+)::text\[\]\) ORDER BY id$/;
const isRevisionScan = (call: Call) => REVISIONS.test(flat(call.text));
const isValueFetch = (call: Call) => VALUE_FETCH.test(flat(call.text));
const shapes = (calls: readonly Call[]) => calls.map(c => isRevisionScan(c) ? "revisions" : isValueFetch(c) ? "values" : flat(c.text));

/** The projection `recordProjectionSql` asked the database for, read back from its SQL. */
function projectionOf(selected: string, table: string): RecordProjection | "whole" | "empty" {
  if (selected === "value") return "whole";
  if (selected === "'{}'::jsonb") return "empty";
  assert.ok(selected.startsWith(`CASE WHEN jsonb_typeof(${table}.value) = 'object' THEN `), `unknown selection: ${selected}`);
  const keys = (list: string) => list === "NULL" ? [] : list.split(", ").map(key => /^'(\w+)'$/.exec(key)![1]!);
  const outer = /WHERE t\.key IN \(([^)]*)\)\) ELSE \w+\.value END$/.exec(selected);
  assert.ok(outer, `no projected keys in: ${selected}`);
  const projection: Record<string, true | string[]> = Object.fromEntries(keys(outer[1]!).map(key => [key, true]));
  for (const nested of selected.matchAll(/WHEN t\.key = '(\w+)' AND jsonb_typeof\(t\.value\) = 'object' THEN .*? WHERE f\.key IN \(([^)]*)\)\)/g)) {
    projection[nested[1]!] = keys(nested[2]!);
  }
  return projection as RecordProjection;
}

/** A stand-in that answers the revision scan, the `id=ANY` value fetch and the Admin value page,
 *  applies their predicates and projections, and refuses any scan without a `LIMIT`. */
function fakeAggregateSql(initial: readonly Row[]) {
  const rows = [...initial];
  const calls: Call[] = [];
  const byId = (a: Row, b: Row) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const matches = (predicate: string | undefined, params: readonly unknown[]) => (row: Row) =>
    (predicate ? predicate.split(" AND ") : []).every(term => {
      const filter = /^value #>> '\{([^}]*)\}'=\$(\d+)$/.exec(term);
      if (filter) return jsonTextAtPath(row.value, filter[1]!.split(",")) === params[Number(filter[2]) - 1];
      const after = /^id > \$(\d+)$/.exec(term);
      if (after) return row.id > String(params[Number(after[1]) - 1]);
      throw new Error(`fake Sql did not recognize predicate: ${term}`);
    });
  const valued = (selected: string, table: string) => (row: Row) => {
    const projection = projectionOf(selected, table);
    const value = projection === "whole" ? row.value : projection === "empty" ? {} : projectAggregate(row.value, projection);
    return { id: row.id, revision: row.revision, updated_at: row.updated_at, value };
  };
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      calls.push({ text, params });
      const statement = flat(text);
      const fetch = VALUE_FETCH.exec(statement);
      if (fetch !== null) {
        const [, selected, table, predicate, slot] = fetch;
        const ids = params[Number(slot) - 1] as string[];
        assert.ok(Array.isArray(ids) && ids.length <= AGGREGATE_LIST_READ_PAGE, `a value fetch is bounded by ${AGGREGATE_LIST_READ_PAGE} ids`);
        return rows.filter(row => ids.includes(row.id)).filter(matches(predicate, params)).sort(byId).map(valued(selected!, table!));
      }
      if (!/LIMIT\s+\d+/.test(statement)) {
        throw new Error(`unbounded scan would risk the 64 MiB cap: ${statement}`);
      }
      const scan = REVISIONS.exec(statement);
      if (scan !== null) {
        const [, , predicate, limit] = scan;
        return rows.filter(matches(predicate, params)).sort(byId).slice(0, Number(limit)).map(row => ({ id: row.id, revision: row.revision }));
      }
      const page = VALUE_PAGE.exec(statement);
      if (page !== null) {
        const [, selected, table, predicate, limit] = page;
        return rows.filter(matches(predicate, params)).sort(byId).slice(0, Number(limit)).map(valued(selected!, table!));
      }
      throw new Error(`fake Sql did not recognize query: ${statement}`);
    },
  };
  return { sql, calls, rows };
}

/** ids zero-padded so lexicographic order matches numeric order. */
const seq = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `wi-${String(i).padStart(6, "0")}`,
    revision: 1,
    updated_at: "2026-09-17T00:00:00.000Z",
    value: { seq: i },
  }));

test("list() pages revisions, fetches values in bounded id batches, and returns every row in id order", async () => {
  const n = AGGREGATE_LIST_READ_PAGE * 2 + 30;
  const { sql, calls } = fakeAggregateSql(seq(n));
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");

  const out = await repo.list();
  assert.equal(out.length, n);
  assert.deepEqual(out.map((r) => r.value.seq), Array.from({ length: n }, (_, i) => i));
  assert.deepEqual(shapes(calls), ["revisions", "values", "revisions", "values", "revisions", "values"],
    "three bounded revision pages, each followed by one value fetch for its uncached ids");
  assert.ok(calls.filter(isRevisionScan).every((c) => /LIMIT 100$/.test(flat(c.text))), "every revision scan carries LIMIT");
  assert.ok(calls.filter(isValueFetch).every((c) => (c.params.at(-1) as string[]).length <= AGGREGATE_LIST_READ_PAGE));
  assert.match(flat(calls[2]!.text), /WHERE id > \$1 ORDER BY id LIMIT 100$/, "the next page is keyed by the last id");
});

test("a second list() of an unchanged table reads revisions only, and fetches just the row that changed", async () => {
  const n = AGGREGATE_LIST_READ_PAGE * 2 + 30;
  const { sql, calls, rows } = fakeAggregateSql(seq(n));
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  const first = await repo.list();

  const before = calls.length;
  assert.deepEqual(await repo.list(), first, "the held values are the table");
  assert.deepEqual(shapes(calls.slice(before)), ["revisions", "revisions", "revisions"],
    "no value crosses the connection for an unchanged revision");

  rows[150] = { ...rows[150]!, revision: 2, value: { seq: -150 } };
  const changedAt = calls.length;
  const changed = await repo.list();
  const fetches = calls.slice(changedAt).filter(isValueFetch);
  assert.equal(fetches.length, 1, "one value fetch");
  assert.deepEqual(fetches[0]!.params, [[rows[150]!.id]], "for the changed id alone");
  assert.equal(changed[150]!.value.seq, -150, "a new revision is never served from the held copy");
  assert.equal(changed[150]!.revision, 2);
});

test("list() of an empty table is one empty bounded revision page", async () => {
  const { sql, calls } = fakeAggregateSql([]);
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  assert.deepEqual(await repo.list(), []);
  assert.deepEqual(shapes(calls), ["revisions"]);
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
  assert.deepEqual(shapes(calls), ["revisions", "values", "revisions", "values", "revisions", "values"],
    "three bounded revision pages and a value fetch for each");
  assert.match(flat(calls[2]!.text), /WHERE id > \$1/);
  const empty = fakeAggregateSql(seq(2));
  assert.deepEqual((await pgAggregateRepository(empty.sql, "WorkItem", "cp_work_items").listNarrowed({})).map(row => row.value), [{}, {}]);
});

test("listWhereNarrowed() pages like listWhere() and has the database project each fetched value instead of sending it whole", async () => {
  const source = tagged(AGGREGATE_LIST_READ_PAGE + 3, () => true);
  const { sql, calls } = fakeAggregateSql(source);
  const repo = pgAggregateRepository<{ seq: number; routeTaskId: string }>(sql, "WorkItem", "cp_work_items");
  const out = await repo.listWhereNarrowed(["routeTaskId"], "rt-want", { seq: true });
  assert.equal(out.length, AGGREGATE_LIST_READ_PAGE + 3);
  assert.deepEqual(out.map(row => row.value), source.map(row => ({ seq: row.value.seq })), "only the projected field arrives");
  assert.deepEqual(shapes(calls), ["revisions", "values", "revisions", "values"], "two bounded revision pages and a value fetch for each");
  for (const statement of calls.filter(isValueFetch)) {
    assert.match(statement.text, /jsonb_each\(cp_work_items\.value\)/, "the projection is computed in the database");
    assert.doesNotMatch(flat(statement.text), /updated_at,value AS value FROM/);
  }
});

test("list() of exactly one full page still terminates on the short second revision page", async () => {
  const { sql, calls } = fakeAggregateSql(seq(AGGREGATE_LIST_READ_PAGE));
  const repo = pgAggregateRepository<{ seq: number }>(sql, "WorkItem", "cp_work_items");
  const out = await repo.list();
  assert.equal(out.length, AGGREGATE_LIST_READ_PAGE);
  // One full page forces a second (empty) revision page to confirm the end; it needs no value fetch.
  assert.deepEqual(shapes(calls), ["revisions", "values", "revisions"]);
  assert.ok(calls.filter(isRevisionScan).every((c) => /LIMIT 100$/.test(flat(c.text))));
});

/* `listWhere()` is `list()` filtered by the database, bounded, with the value as a parameter. */
const tagged = (n: number, wanted: (seq: number) => boolean) =>
  seq(n).map((r) => ({ ...r, value: { seq: r.value.seq, routeTaskId: wanted(r.value.seq) ? "rt-want" : "rt-other" } }));

test("listWhere() pages a large match set and equals list() filtered, row for row in id order", async () => {
  const table = tagged(AGGREGATE_LIST_READ_PAGE * 3 + 7, (i) => i % 3 === 0);
  const whole = fakeAggregateSql(table);
  const expected = (await pgAggregateRepository<{ seq: number; routeTaskId: string }>(whole.sql, "Attempt", "cp_attempts").list())
    .filter((r) => r.value.routeTaskId === "rt-want");

  // A separate connection holds no copies, so every matching value is fetched here.
  const { sql, calls } = fakeAggregateSql(table);
  const repo = pgAggregateRepository<{ seq: number; routeTaskId: string }>(sql, "Attempt", "cp_attempts");
  const out = await repo.listWhere(["routeTaskId"], "rt-want");
  assert.ok(expected.length > AGGREGATE_LIST_READ_PAGE, "the match set spans more than one page");
  assert.deepEqual(out, expected);
  assert.deepEqual(shapes(calls), ["revisions", "values", "revisions", "values"], "two bounded revision pages for 103 matches and a value fetch for each");
  assert.ok(
    calls.filter(isRevisionScan).every((c) =>
      /^SELECT id,revision FROM cp_attempts WHERE value #>> '\{routeTaskId\}'=\$1(?: AND id > \$2)? ORDER BY id LIMIT 100$/.test(flat(c.text))),
    "every revision scan is bounded and filtered in the database",
  );
  assert.ok(
    calls.filter(isValueFetch).every((c) => /WHERE \(value #>> '\{routeTaskId\}'=\$1\) AND id=ANY\(\$2::text\[\]\) ORDER BY id$/.test(flat(c.text))),
    "every value fetch keeps the filter as well",
  );
  assert.ok(calls.every((c) => !c.text.includes("rt-want") && c.params[0] === "rt-want"), "the value is a parameter, never SQL text");
});

test("listWhere() of a selective filter is one bounded revision statement and a fetch of the matches, where list() pages the whole table", async () => {
  const { sql, calls } = fakeAggregateSql(tagged(AGGREGATE_LIST_READ_PAGE * 4, (i) => i === 7 || i === 391));
  const repo = pgAggregateRepository<{ seq: number; routeTaskId: string }>(sql, "Attempt", "cp_attempts");
  const out = await repo.listWhere(["routeTaskId"], "rt-want");
  assert.deepEqual(out.map((r) => r.value.seq), [7, 391], "a match near the start and one near the end");
  assert.deepEqual(shapes(calls), ["revisions", "values"], "two round trips");
  assert.deepEqual(calls[1]!.params, ["rt-want", ["wi-000007", "wi-000391"]], "values for the matching ids only");
  const before = calls.length;
  assert.deepEqual(await repo.listWhere(["routeTaskId"], "rt-absent"), [], "no match is an empty answer");
  assert.deepEqual(shapes(calls.slice(before)), ["revisions"], "and needs no value fetch");
});

test("listWhere() refuses an unsafe JSON path segment rather than building SQL from it", async () => {
  const { sql, calls } = fakeAggregateSql([]);
  const repo = pgAggregateRepository<{ seq: number }>(sql, "Attempt", "cp_attempts");
  await assert.rejects(() => repo.listWhere(["routeTaskId'); drop table cp_attempts; --"], "x"), /unsafe JSON path/);
  await assert.rejects(() => repo.listWhere([], "x"), /empty JSON path/);
  assert.equal(calls.length, 0, "refused before any statement was sent");
});
