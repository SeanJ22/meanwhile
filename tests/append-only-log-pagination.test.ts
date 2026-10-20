/**
 * Append-only log reads never exceed the Neon HTTP driver's 64 MiB response cap: `read`/`readAll`
 * page, `readWhere` filters by content (`record #>> path = value`), and `readRecent` is a bounded
 * newest-first tail. The fake `Sql` throws on any scan without a `LIMIT`; concatenated pages must
 * equal the whole selection in order, and a content filter returns every match regardless of position.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  APPEND_ONLY_LOG_READ_PAGE,
  pgAppendOnlyRepository,
} from "../lib/control-plane/repository/pg-store.ts";
import { projectRecord } from "../lib/control-plane/repository/types.ts";
import { aggregateModelSpend } from "../lib/control-plane/fleet-safety.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";

test("rolling cost reads exclude old rows before transfer, page every recent charge, and count unknown spend at worst case", async () => {
  const since = "2026-10-01T01:00:00.000Z";
  const rows = Array.from({ length: APPEND_ONLY_LOG_READ_PAGE + 1 }, (_, position) => ({
    log_key: "costs", position, record: { attemptId: `scout-${position}`, role: "SCOUT", recordedAt: since, cost: { usd: position === APPEND_ONLY_LOG_READ_PAGE ? null : 0.01 } },
  }));
  let pages = 0;
  const sql = { async query(text: string, params: readonly unknown[]) {
    assert.match(text, /WHERE recorded_at >= \$1::timestamptz/);
    assert.match(text, new RegExp(`LIMIT ${APPEND_ONLY_LOG_READ_PAGE}`));
    assert.equal(params[0], since);
    pages++;
    return rows.filter((row) => params.length === 1 || row.position > Number(params[2])).slice(0, APPEND_ONLY_LOG_READ_PAGE);
  } };
  const read = await pgAppendOnlyRepository<CostEntry>(sql as never, "costs").readSince(since);
  assert.equal(pages, 2);
  assert.equal(read.length, rows.length, "no recent charge is dropped at a page boundary");
  const spend = aggregateModelSpend(read, since, "2026-10-02T01:00:00.000Z");
  assert.equal(spend.worstCaseCharges, 1, "an unmeasured recent charge is counted at its worst case, not dropped");
  assert.ok(spend.usd > 0.01 * (APPEND_ONLY_LOG_READ_PAGE), "the worst case adds to the measured charges");
});

interface Row {
  readonly log_key: string;
  readonly position: number;
  readonly recorded_at?: string;
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

/** The `RecordProjection` a narrowed read's statement names, read back from the statement itself. */
function projectionIn(text: string, read: string): Record<string, true | string[]> {
  const keys = (list: string) => [...list.matchAll(/'([A-Za-z0-9_]+)'/g)].map((m) => m[1]!);
  const top = /WHERE t\.key IN \(([^)]*)\)\) ELSE record END AS record/.exec(text);
  if (top === null) throw new Error(`${read} must narrow the record in the SELECT list: ${text}`);
  const projection: Record<string, true | string[]> = Object.fromEntries(keys(top[1]).map((k) => [k, true]));
  for (const nested of text.matchAll(/WHEN t\.key = '([A-Za-z0-9_]+)' AND jsonb_typeof\(t\.value\) = 'object' THEN \(SELECT coalesce\(jsonb_object_agg\(f\.key, f\.value\), '\{\}'::jsonb\) FROM jsonb_each\(t\.value\) AS f WHERE f\.key IN \(([^)]*)\)\)/g)) {
    projection[nested[1]!] = keys(nested[2]!);
  }
  return projection;
}

/**
 * A minimal stand-in for the one method the repository calls. It understands the
 * paged read shapes and refuses anything without a `LIMIT`, so a regression to
 * an unbounded scan is caught here.
 */
function fakeLogSql(rows: readonly Row[]) {
  const calls: string[] = [];
  const byKeyPos = (a: Row, b: Row) => (a.log_key === b.log_key ? a.position - b.position : a.log_key < b.log_key ? -1 : 1);
  const changedRow = (r: Row) => ({ log_key: r.log_key, record_id: `${r.log_key}-${r.position}`, position: r.position, record: r.record,
    changed_at: "2026-09-16T00:00:00.000Z", recorded_at: r.recorded_at ?? "2026-09-16T00:00:00.000Z" });
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      calls.push(text);
      if (/^SELECT now\(\) AS read_at$/.test(text)) return [{ read_at: "2026-09-17T00:00:00.000Z" }];
      const litLimit = /LIMIT\s+(\d+)/.exec(text);
      // readRecentWhere: a content filter, newest first, LIMIT a parameter, and
      // the record narrowed in the SELECT list. The fake reads the kept keys
      // from the statement itself, so a statement naming the wrong keys fails.
      const recentWhere = /record #>> '\{([^}]*)\}' = \$2/.exec(text);
      if (recentWhere !== null && /ORDER BY\s+position DESC/i.test(text)) {
        const [key, value, limit, since] = params as [string, string, number, string | undefined];
        const path = recentWhere[1].split(",");
        const projection = projectionIn(text, "readRecentWhere");
        return rows.filter((r) => r.log_key === key && textAt(r.record, path) === value &&
          (!/recorded_at >= \$4::timestamptz/.test(text) || Date.parse(r.recorded_at ?? "") >= Date.parse(since!)))
          .sort((a, b) => b.position - a.position).slice(0, Number(limit))
          .map((r) => ({ record: projectRecord(r.record, projection) }));
      }
      // readRecent: newest first, LIMIT is a parameter.
      if (/ORDER BY\s+position DESC/i.test(text)) {
        const [key, limit] = params as [string, number];
        return rows.filter((r) => r.log_key === key).sort((a, b) => b.position - a.position).slice(0, Number(limit))
          .map((r) => ({ record: r.record }));
      }
      // readLatest: DISTINCT ON (log_key) over WHERE log_key = ANY($1), bounded by the page of keys it names; only
      // the rows it chose are narrowed, by the projection the statement itself names.
      if (/SELECT DISTINCT ON \(log_key\)/i.test(text)) {
        const [keys] = params as [string[]];
        if (keys.length > APPEND_ONLY_LOG_READ_PAGE) throw new Error(`one readLatest statement named ${keys.length} keys, over a page`);
        const projection = projectionIn(text, "readLatest");
        /* DISTINCT ON keeps each key's FIRST row in the statement's own order, as Postgres does. */
        const order = /ORDER BY log_key ASC, position (ASC|DESC)/i.exec(text)?.[1]?.toUpperCase();
        if (order === undefined) throw new Error(`a readLatest statement must order each key by position: ${text.replace(/\s+/g, " ").trim()}`);
        return keys.flatMap((key) => {
          const first = rows.filter((r) => r.log_key === key).sort((a, b) => (order === "DESC" ? b.position - a.position : a.position - b.position))[0];
          return first === undefined ? [] : [{ log_key: key, record: projectRecord(first.record, projection) }];
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
      // readKeys: WHERE log_key = ANY($1) AND (log_key, position) > ($2, $3), keyset-paged in (key, position) order
      if (/WHERE\s+log_key = ANY\(\$1::text\[\]\) AND \(log_key, position\) > \(\$2, \$3\)/i.test(text)) {
        const [keys, key, position] = params as [string[], string, number];
        return rows.filter((r) => keys.includes(r.log_key) && (r.log_key > key || (r.log_key === key && r.position > position)))
          .sort(byKeyPos).slice(0, limit).map((r) => ({ log_key: r.log_key, position: r.position, record: r.record }));
      }
      // readAll (its changed-since read) next page: WHERE (log_key, position) > ($1, $2)
      if (/WHERE\s+\(log_key,\s*position\)\s*>\s*\(\$1,\s*\$2\)/i.test(text)) {
        const [key, position] = params as [string, number];
        return rows.filter((r) => r.log_key > key || (r.log_key === key && r.position > position))
          .sort(byKeyPos).slice(0, limit).map(changedRow);
      }
      // readAll first page: ORDER BY log_key ASC, position ASC (no WHERE cursor)
      if (/ORDER BY\s+log_key ASC,\s*position ASC/i.test(text) && !/WHERE/i.test(text)) {
        return rows.slice().sort(byKeyPos).slice(0, limit).map(changedRow);
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

test("recent cycle projection retains the complete time window with late finishes and more than a fixed tail", async () => {
  const since = "2026-10-02T08:00:00.000Z";
  const old = "2026-10-01T08:00:00.000Z";
  const recent = "2026-10-02T09:00:00.000Z";
  const rows: Row[] = Array.from({ length: 4601 }, (_, position) => ({
    log_key: "owner-digest", position, recorded_at: position < 4000 ? old : recent,
    record: { lines: ["unused history payload".repeat(50)], runtimeOutcome: {
      kind: "FRESHNESS_CYCLE", startedAt: position === 4600 || position < 4000 ? old : recent,
      research: { lanes: { deterministic: { dispatched: 1 }, model: { dispatched: 2 } } },
      risk: { unused: "unchanged history".repeat(50) },
    } },
  }));
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<Record<string, unknown>>(sql, "owner_digests");
  const projected = await repo.readRecentWhere("owner-digest", ["runtimeOutcome", "kind"], "FRESHNESS_CYCLE",
    Number.MAX_SAFE_INTEGER, { runtimeOutcome: ["kind", "startedAt", "research"] }, since);
  const inWindow = (records: readonly unknown[]) => records.flatMap(row => {
    const outcome = (row as typeof rows[number]["record"]).runtimeOutcome as { startedAt: string; research: unknown };
    return Date.parse(outcome.startedAt) >= Date.parse(since) ? [{ startedAt: outcome.startedAt, research: outcome.research }] : [];
  });
  const expected = inWindow(rows.map(row => row.record));
  assert.deepEqual(inWindow([...projected].reverse()), expected);
  assert.equal(expected.length, 600, "all current-window cycles survive beyond a 128/512-record tail");
  assert.equal(projected.length, 601, "a late-finished old cycle is returned and removed by the caller's existing start-clock filter");
  assert.equal(calls.length, 1);
  assert.match(calls[0], /recorded_at >= \$4::timestamptz/);
  assert.ok(JSON.stringify(projected).length < JSON.stringify(rows.map(row => row.record)).length / 50);
  console.log(`CYCLE_HISTORY archived=4000 current=600 lateOld=1 selected=${projected.length} fields=kind,startedAt,research`);
});

test("readKeys() answers read() for every named key in a few bounded pages, never one statement per key", async () => {
  const keys = Array.from({ length: 300 }, (_, i) => `item-${String(i).padStart(3, "0")}`);
  const rows: Row[] = [...keys.flatMap((key, i) => seq(i % 7 + 1, key)), ...seq(APPEND_ONLY_LOG_READ_PAGE, "unnamed")];
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "promotion_pipeline");
  const out = await repo.readKeys!([...keys, keys[0]!, "absent"]);
  assert.deepEqual([...out.keys()], keys, "every named key with records, in key order; an absent key is left out");
  for (const key of keys) assert.deepEqual(out.get(key), await repo.read(key), `${key} is exactly read(${key})`);
  const batched = calls.filter((c) => /ANY\(\$1::text\[\]\)/.test(c)).length;
  const records = keys.reduce((n, _, i) => n + i % 7 + 1, 0);
  assert.equal(batched, Math.floor(records / APPEND_ONLY_LOG_READ_PAGE) + 1, "one statement per page of records");
  assert.ok(batched < keys.length / 10);
});

test("read() of an absent key is one empty bounded page", async () => {
  const { sql, calls } = fakeLogSql([]);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");
  assert.deepEqual(await repo.read("nothing-here"), []);
  assert.equal(calls.length, 1);
});

test("readAll() pages the whole table in (log_key, position) order after its read clock", async () => {
  const big = APPEND_ONLY_LOG_READ_PAGE * 2 + 5;
  const rows: Row[] = [...seq(5, "ccc"), ...seq(big, "bbb"), ...seq(3, "aaa")];
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<{ seq: number }>(sql, "owner_digests");

  const out = await repo.readAll();
  assert.deepEqual(out, [...seq(3, "aaa"), ...seq(big, "bbb"), ...seq(5, "ccc")].map(row => row.record));
  assert.ok(calls.length >= 4);
  assert.match(calls[0]!, /SELECT now\(\) AS read_at/);
  assert.ok(calls.slice(1).every((c) => /LIMIT/i.test(c)));
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

test("readRecentWhere() is one bounded query: the newest matches, newest first, narrowed by the database", async () => {
  const rows: Row[] = seq(40, "owner-digest", (i) => ({
    digestId: `d${i}`,
    lines: ["a long rendered line"],
    runtimeOutcome: {
      kind: i % 3 === 0 ? "OTHER" : "WANT",
      finishedAt: `t${i}`,
      readerReadbacks: [{ big: "x".repeat(100) }],
    },
  }));
  const { sql, calls } = fakeLogSql(rows);
  const repo = pgAppendOnlyRepository<Record<string, unknown>>(sql, "owner_digests");

  const out = await repo.readRecentWhere(
    "owner-digest",
    ["runtimeOutcome", "kind"],
    "WANT",
    3,
    { digestId: true, runtimeOutcome: ["kind", "finishedAt"] },
  );
  assert.deepEqual(out, [38, 37, 35].map((i) => ({
    digestId: `d${i}`,
    runtimeOutcome: { kind: "WANT", finishedAt: `t${i}` },
  })), "only matches, newest first, and nothing the projection drops");
  assert.equal(calls.length, 1, "a bounded tail is one query, not a scan");
  assert.match(calls[0]!, /LIMIT \$3/, "the limit is a parameter");
  assert.doesNotMatch(calls[0]!, /SELECT\s+(position,\s*)?record\s+FROM/i, "the whole record is never selected");
});

test("readRecentWhere() refuses an unsafe projection key or path rather than building SQL from it", async () => {
  const { sql } = fakeLogSql([]);
  const repo = pgAppendOnlyRepository<Record<string, unknown>>(sql, "owner_digests");
  await assert.rejects(
    () => repo.readRecentWhere("owner-digest", ["runtimeOutcome", "kind"], "x", 1, { "digestId'); drop": true }),
    /unsafe projection key/,
  );
  await assert.rejects(
    () => repo.readRecentWhere("owner-digest", ["runtimeOutcome", "kind"], "x", 1, { runtimeOutcome: ["kind'); drop"] }),
    /unsafe projection key/,
  );
  await assert.rejects(
    () => repo.readRecentWhere("owner-digest", ["runtimeOutcome", "kind'); drop"], "x", 1, { digestId: true }),
    /unsafe JSON path/,
  );
});

test("readLatest() answers each key's newest record, narrowed by the database, in one statement per page of keys", async () => {
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

  const latest = await repo.readLatest([...keys, "j1"], { outcome: true, seq: true });
  assert.equal(calls.length, 2, "one statement per page of keys, never one per key");
  assert.ok(calls.every((c) => /^SELECT latest\.log_key, CASE WHEN jsonb_typeof\(record\) = 'object'/.test(c.trim())), "only the narrowed record leaves the database");
  assert.ok(calls.every((c) => /\) AS latest$/.test(c.trim())), "each key's newest row is chosen inside the database, before it is narrowed");
  assert.equal(latest.size, keys.filter((_, i) => i % 3 !== 0).length, "a key with no record is absent");
  assert.deepEqual(latest.get("j1"), { seq: 1, outcome: "BLOCKED" }, "the newest record by position, and nothing the projection drops");
  assert.deepEqual(latest.get("j2"), { seq: 1, outcome: "FOUND" });
  assert.equal(latest.has("j0"), false);
  assert.equal((await repo.readLatest([], { outcome: true })).size, 0);
  assert.equal(calls.length, 2, "no keys, no statement");
});

test("readLatest() refuses an unsafe projection key rather than building SQL from it", async () => {
  const { sql, calls } = fakeLogSql([]);
  const repo = pgAppendOnlyRepository<Record<string, unknown>>(sql, "discovery_attempts");
  await assert.rejects(() => repo.readLatest(["j"], { "outcome'); drop": true }), /unsafe projection key/);
  assert.equal(calls.length, 0);
});
