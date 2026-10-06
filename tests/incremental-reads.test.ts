/**
 * The research round keeps one in-memory copy of the tables every wave
 * re-reads, and each later read fetches only the rows changed since (schema
 * v22). These tests pin that the wrapped `list()` / `readAll()` return exactly
 * what the plain reads return, that later reads move only changed rows, that a
 * store without the read (or whose read throws) falls back to the whole read
 * and says so, and that the round is wired to it behind its switch.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  INCREMENTAL_READS_SLACK_MS,
  incrementalReadsEnabled,
  withIncrementalReads,
} from "../lib/control-plane/repository/incremental-reads.ts";
import type { AggregateRepository, AppendOnlyRepository, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import {
  APPEND_ONLY_LOGS,
  AGGREGATE_KINDS,
  BOOTSTRAP_DDL,
  BOOTSTRAP_VERSION,
  CHANGED_AT_INDEXES,
  CHANGED_AT_TABLES,
  ONLINE_INDEXES,
  changedAtColumnDdl,
} from "../lib/control-plane/repository/pg-schema.ts";
import { pgAggregateRepository, pgAppendOnlyRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";

const NOW = "2026-10-06T12:00:00.000Z";

/** Counts the rows each changed-since read hands back, without changing what it returns. */
function spied(repos: ControlPlaneRepositories) {
  const returned = { rows: 0, records: 0, calls: 0 };
  const aggregate = <T>(repo: AggregateRepository<T>): AggregateRepository<T> => ({
    ...repo,
    listChangedSince: async (since) => {
      const out = await repo.listChangedSince!(since);
      returned.calls += 1; returned.rows += out.rows.length;
      return out;
    },
  });
  const log = <T>(repo: AppendOnlyRepository<T>): AppendOnlyRepository<T> => ({
    ...repo,
    readChangedSince: async (since) => {
      const out = await repo.readChangedSince!(since);
      returned.calls += 1; returned.records += out.records.length;
      return out;
    },
  });
  return {
    returned,
    reset: () => { returned.rows = 0; returned.records = 0; returned.calls = 0; },
    repos: { ...repos, workItems: aggregate(repos.workItems), artifacts: log(repos.artifacts) },
  };
}

// Records are opaque to the wrapper; a minimal shape keeps the fixtures readable.
type Loose = never;
const item = (id: string, note: string) => ({ id, subject: `subject-${id}`, note }) as unknown as Loose;
const artifact = (artifactId: string, workItemId: string) =>
  ({ artifactId, workItemId, canonicalUrl: `https://example.gov/${artifactId}`, recordedAt: NOW }) as unknown as Loose;

test("(a) after the first full read, a later list() fetches only changed rows and equals the plain list()", async () => {
  const base = createMemoryRepositories();
  for (let i = 0; i < 50; i++) await base.workItems.put(`wi-${String(i).padStart(3, "0")}`, item(`wi-${i}`, "first"), NOW);
  const spy = spied(base);
  const repos = withIncrementalReads(spy.repos, { slackMs: 0, log: () => assert.fail("no fallback expected") });

  assert.deepEqual(await repos.workItems.list(), await base.workItems.list());
  assert.equal(spy.returned.rows, 50, "the first read is the whole table");

  spy.reset();
  assert.deepEqual(await repos.workItems.list(), await base.workItems.list());
  assert.ok(spy.returned.rows <= 1, `an unchanged table moves at most the boundary row, moved ${spy.returned.rows}`);

  const held = (await base.workItems.read("wi-007"))!;
  await base.workItems.compareAndSet("wi-007", held.revision, item("wi-7", "second"), NOW);
  spy.reset();
  const after = await repos.workItems.list();
  assert.deepEqual(after, await base.workItems.list());
  assert.ok(spy.returned.rows <= 2, `one changed row moves, plus at most the boundary row; moved ${spy.returned.rows}`);
});

test("(b) a row updated between calls appears with its new revision, and a new row appears in id order", async () => {
  const base = createMemoryRepositories();
  for (const id of ["b", "d", "f"]) await base.attempts.put(id, item(id, "v1"), NOW);
  const repos = withIncrementalReads(base, { log: () => assert.fail("no fallback expected") });
  assert.deepEqual(await repos.attempts.list(), await base.attempts.list());

  const d = (await base.attempts.read("d"))!;
  await base.attempts.compareAndSet("d", d.revision, item("d", "v2"), NOW);
  await base.attempts.put("a", item("a", "new"), NOW);
  await base.attempts.put("e", item("e", "new"), NOW);

  const listed = await repos.attempts.list();
  assert.deepEqual(listed, await base.attempts.list(), "exactly the plain list(), default slack and all");
  assert.deepEqual(listed.map(row => row.id), ["a", "b", "d", "e", "f"]);
  assert.equal(listed.find(row => row.id === "d")!.revision, 2);
  assert.equal((listed.find(row => row.id === "d")!.value as unknown as { note: string }).note, "v2");

  // A caller mutating what it was handed cannot reach the held copy.
  (listed[0]!.value as unknown as { note: string }).note = "mutated";
  assert.deepEqual(await repos.attempts.list(), await base.attempts.list());
});

test("(c) logs: appended records appear in key then position order, nothing duplicated across the slack overlap", async () => {
  const base = createMemoryRepositories();
  await base.artifacts.append("wi-b", "art-1", artifact("art-1", "wi-b"), NOW);
  await base.artifacts.append("wi-a", "art-2", artifact("art-2", "wi-a"), NOW);
  const spy = spied(base);
  // The default 120 s slack overlaps every earlier change of the double's clock, so the overlap is exercised in full.
  const repos = withIncrementalReads(spy.repos, { log: () => assert.fail("no fallback expected") });
  assert.equal(INCREMENTAL_READS_SLACK_MS, 120_000);
  assert.deepEqual(await repos.artifacts.readAll(), await base.artifacts.readAll());

  await base.artifacts.append("wi-b", "art-3", artifact("art-3", "wi-b"), NOW);
  await base.artifacts.append("wi-a", "art-4", artifact("art-4", "wi-a"), NOW);
  await base.artifacts.append("wi-c", "art-5", artifact("art-5", "wi-c"), NOW);
  // An idempotent re-append changes nothing.
  await base.artifacts.append("wi-b", "art-1", artifact("art-1", "wi-b"), NOW);

  const all = await repos.artifacts.readAll();
  assert.deepEqual(all, await base.artifacts.readAll());
  assert.deepEqual(all.map(row => (row as unknown as { artifactId: string }).artifactId), ["art-2", "art-4", "art-1", "art-3", "art-5"]);
  assert.equal(new Set(all.map(row => (row as unknown as { artifactId: string }).artifactId)).size, all.length, "no record twice");

  // Other log methods pass through untouched.
  assert.deepEqual(await repos.artifacts.read("wi-b"), await base.artifacts.read("wi-b"));
  assert.deepEqual(await repos.artifacts.readSince(NOW), await base.artifacts.readSince(NOW));
});

test("(d) a store whose changed-since read throws gives the whole list and logs one line naming the table", async () => {
  const base = createMemoryRepositories();
  for (const id of ["x", "y", "z"]) await base.workItems.put(id, item(id, "v1"), NOW);
  let plainReads = 0;
  const broken: ControlPlaneRepositories = {
    ...base,
    workItems: {
      ...base.workItems,
      list: async () => { plainReads += 1; return base.workItems.list(); },
      listChangedSince: async () => { throw Object.assign(new Error('column "changed_at" does not exist'), { code: "42703" }); },
    },
  };
  const lines: string[] = [];
  const repos = withIncrementalReads(broken, { log: line => lines.push(line) });
  assert.deepEqual(await repos.workItems.list(), await base.workItems.list());
  assert.equal(plainReads, 1);
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /cp_work_items/);
  assert.match(lines[0]!, /reading it whole/);
  // The missing column is permanent until the bootstrap runs: later reads are whole, without another failed round trip or line.
  await base.workItems.put("w", item("w", "v1"), NOW);
  assert.deepEqual(await repos.workItems.list(), await base.workItems.list());
  assert.equal(plainReads, 2);
  assert.equal(lines.length, 1);

  // A store without the method reads plainly too, and says so once.
  const { listChangedSince: _dropped, ...withoutMethod } = base.routeTasks;
  void _dropped;
  const quiet: string[] = [];
  const plain = withIncrementalReads({ ...base, routeTasks: withoutMethod }, { log: line => quiet.push(line) });
  await base.routeTasks.put("rt", item("rt", "v1"), NOW);
  assert.deepEqual(await plain.routeTasks.list(), await base.routeTasks.list());
  assert.deepEqual(await plain.routeTasks.list(), await base.routeTasks.list());
  assert.equal(quiet.length, 1);
  assert.match(quiet[0]!, /cp_route_tasks/);
});

test("(d2) a batch out of code-point order turns the table back to plain reads rather than reorder rows", async () => {
  const base = createMemoryRepositories();
  for (const id of ["a", "b"]) await base.leases.put(id, item(id, "v1"), NOW);
  const lines: string[] = [];
  const repos = withIncrementalReads({
    ...base,
    leases: { ...base.leases, listChangedSince: async () => ({ rows: [...(await base.leases.list())].reverse(), through: NOW }) },
  }, { log: line => lines.push(line) });
  assert.deepEqual(await repos.leases.list(), await base.leases.list());
  assert.match(lines.join("\n"), /cp_leases.*out of code-point id order/);
});

test("(e) the round wraps its repositories once, behind WTP_INCREMENTAL_READS", async () => {
  const round = await readFile(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /if \(incrementalReadsEnabled\(\)\) \{\s*repos = withIncrementalReads\(repos,/);
  const opened = round.indexOf('createPgRepositories(url, NOW)');
  const wrapped = round.indexOf("withIncrementalReads(repos");
  assert.ok(opened > 0 && wrapped > opened, "wrapped where the Postgres repositories are opened");
  assert.ok(wrapped < round.indexOf("observeCyclePhases(repos)"), "before the observers, so every in-round reader sees it");
  assert.equal(round.split("withIncrementalReads(").length - 1, 1, "wrapped once");
  const worker = await readFile(new URL("../lib/control-plane/workers/lease-worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /withIncrementalReads/, "lease-worker children are not wrapped in this change");

  assert.equal(incrementalReadsEnabled({}), true, "on by default");
  assert.equal(incrementalReadsEnabled({ WTP_INCREMENTAL_READS: "1" }), true);
  assert.equal(incrementalReadsEnabled({ WTP_INCREMENTAL_READS: "0" }), false, "0 is the way back");
});

test("schema version 22: every aggregate and log carries changed_at, stamped by the database, with online indexes", () => {
  assert.ok(BOOTSTRAP_VERSION >= 22);
  assert.deepEqual([...CHANGED_AT_TABLES].sort(),
    [...AGGREGATE_KINDS.map(k => `cp_${k}`), ...APPEND_ONLY_LOGS.map(l => `cp_log_${l}`)].sort());
  for (const table of CHANGED_AT_TABLES) {
    const ddl = changedAtColumnDdl(table);
    assert.ok(BOOTSTRAP_DDL.includes(ddl), `${table} gets the column`);
    assert.match(ddl, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now\\(\\);`));
    assert.match(ddl, /information_schema\.columns/, "asks the catalog first, so a current database takes no lock");
    assert.match(ddl, new RegExp(`CREATE TRIGGER ${table}_changed_at BEFORE UPDATE ON ${table}`));
  }
  assert.ok(BOOTSTRAP_DDL.some(sql => /CREATE OR REPLACE FUNCTION cp_touch_changed_at\(\)[\s\S]*NEW\.changed_at := now\(\)/.test(sql)));
  assert.ok(BOOTSTRAP_DDL.indexOf(BOOTSTRAP_DDL.find(sql => sql.includes("FUNCTION cp_touch_changed_at"))!) <
    BOOTSTRAP_DDL.indexOf(changedAtColumnDdl("cp_work_items")), "the trigger function exists before a trigger names it");
  // New tables carry the column from the start.
  assert.ok(BOOTSTRAP_DDL.some(sql => /CREATE TABLE IF NOT EXISTS cp_work_items \([\s\S]*changed_at  timestamptz NOT NULL DEFAULT now\(\)/.test(sql)));
  assert.ok(BOOTSTRAP_DDL.some(sql => /CREATE TABLE IF NOT EXISTS cp_log_artifacts \([\s\S]*changed_at  timestamptz NOT NULL DEFAULT now\(\)/.test(sql)));

  const indexed = CHANGED_AT_INDEXES.map(index => index.name);
  for (const table of ["cp_work_items", "cp_attempts", "cp_route_tasks", "cp_occurrences", "cp_leases",
    "cp_log_artifacts", "cp_log_scout_results", "cp_log_worker_results", "cp_log_costs"]) {
    assert.ok(indexed.includes(`${table}_changed_at`), `${table} is indexed on changed_at`);
  }
  for (const index of CHANGED_AT_INDEXES) {
    assert.match(index.ddl, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS cp_[a-z_]+_changed_at ON cp_[a-z_]+ \(changed_at\);$/);
    assert.ok(BOOTSTRAP_DDL.includes(index.ddl));
    assert.equal(ONLINE_INDEXES.get(index.ddl), index, "built online, like versions 18 and 20");
    assert.ok(BOOTSTRAP_DDL.indexOf(index.ddl) > BOOTSTRAP_DDL.indexOf(changedAtColumnDdl("cp_work_items")), "after the columns exist");
  }
});

test("Postgres: compareAndSet stamps changed_at with the database clock; the changed-since reads page by keyset from a read clock", async () => {
  const seen: { text: string; params: readonly unknown[] }[] = [];
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `id-${String(i).padStart(3, "0")}`, revision: 1, updated_at: NOW, value: {} }));
  const sql: Sql = { query: async (text, params = []) => {
    seen.push({ text, params });
    if (text.includes("SELECT now() AS read_at")) return [{ read_at: "2026-10-06T12:00:00.123456Z" }];
    if (text.startsWith("UPDATE")) return [{ id: "a", revision: 2, updated_at: NOW }];
    if (text.includes("FROM cp_work_items") && !text.includes("id >")) return rows;
    if (text.includes("log_key, record_id, position") && !text.includes("(log_key, position) >")) {
      return Array.from({ length: 100 }, (_, i) => ({ log_key: "k", record_id: `r${i}`, position: i, record: { i } }));
    }
    return [];
  } };
  const aggregate = pgAggregateRepository<unknown>(sql, "WorkItem", "cp_work_items");
  await aggregate.compareAndSet("a", 1, {}, NOW);
  assert.match(seen.at(-1)!.text, /changed_at = now\(\)/);
  assert.match(seen.at(-1)!.text, /updated_at = \$1/, "updated_at keeps the writer's clock");

  seen.length = 0;
  const all = await aggregate.listChangedSince!(null);
  assert.equal(all.rows.length, 100);
  assert.equal(all.through, "2026-10-06T12:00:00.123Z");
  assert.match(seen[0]!.text, /SELECT now\(\) AS read_at/, "the clock is read before the first page");
  assert.doesNotMatch(seen[1]!.text, /changed_at/, "a first read needs no changed_at, so it works on any schema");
  assert.match(seen[2]!.text, /WHERE id > \$1/);
  assert.deepEqual(seen[2]!.params, ["id-099"]);

  seen.length = 0;
  await aggregate.listChangedSince!("2026-10-06T11:58:00.000Z");
  assert.match(seen[1]!.text, /WHERE changed_at >= \$1::timestamptz\s+ORDER BY id ASC/);
  assert.match(seen[2]!.text, /WHERE changed_at >= \$1::timestamptz AND id > \$2/);
  assert.deepEqual(seen[2]!.params, ["2026-10-06T11:58:00.000Z", "id-099"]);

  seen.length = 0;
  const logRepo = pgAppendOnlyRepository<unknown>(sql, "artifacts");
  const records = await logRepo.readChangedSince!("2026-10-06T11:58:00.000Z");
  assert.equal(records.records.length, 100);
  assert.deepEqual(records.records[5], { key: "k", recordId: "r5", position: 5, record: { i: 5 } });
  assert.match(seen[1]!.text, /FROM cp_log_artifacts\s+WHERE changed_at >= \$1::timestamptz\s+ORDER BY log_key ASC, position ASC/);
  assert.match(seen[2]!.text, /WHERE changed_at >= \$1::timestamptz AND \(log_key, position\) > \(\$2, \$3\)/);
  assert.deepEqual(seen[2]!.params, ["2026-10-06T11:58:00.000Z", "k", 99]);
});
