/**
 * Every whole-table read of a Postgres control-plane table answers from one held copy per table on the runner's
 * disk, shared by every runner process. These tests pin that the held `list()` / `readAll()` return exactly what
 * the whole read returns, that a later read (in any process) moves only changed rows, that a failed changed-since
 * read fails rather than reading the table whole, that a broken copy is filled again, that the copies are keyed by
 * database and schema version, and that the database refuses the rewrites a changed-since read could not see.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, writeFile, mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  CONTROL_PLANE_READS_DIR_ENV,
  INCREMENTAL_READS_SLACK_MS,
  databaseIdentity,
  heldCopiesFromEnv,
  openHeldCopies,
  type HeldCopies,
} from "../lib/control-plane/repository/incremental-reads.ts";
import { projectAggregate, type AggregateRepository, type AppendOnlyRepository, type ChangedRecords, type ChangedRows, type Persisted } from "../lib/control-plane/repository/types.ts";
import {
  APPEND_ONLY_LOGS,
  AGGREGATE_KINDS,
  BOOTSTRAP_DDL,
  BOOTSTRAP_VERSION,
  CHANGED_AT_INDEXES,
  CHANGED_AT_TABLES,
  ONLINE_INDEXES,
  REJECT_REWRITE_FUNCTION_DDL,
  changedAtColumnDdl,
  rejectRewriteDdl,
} from "../lib/control-plane/repository/pg-schema.ts";
import { pgAggregateRepository, pgAppendOnlyRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";

const NOW = "2026-10-06T12:00:00.000Z";

/** A process's view of one copies directory: its own queue, as a separate runner process would have. */
function processCopies(dir: string, log: (line: string) => void = line => assert.fail(`unexpected: ${line}`), slackMs?: number): HeldCopies {
  return openHeldCopies(dir, { log, ...(slackMs === undefined ? {} : { slackMs }) });
}

const heldAggregateList = <T>(table: string, changedSince: (since: string | null) => Promise<ChangedRows<T>>, copies: HeldCopies) =>
  <O>(out: (row: Persisted<T>) => O) => copies.aggregateList(table, changedSince, out);
const heldLogReadAll = <T>(table: string, changedSince: (since: string | null) => Promise<ChangedRecords<T>>, copies: HeldCopies) =>
  () => copies.logReadAll(table, changedSince);

/** Counts the rows each changed-since read hands back. */
function counted<T>(repo: AggregateRepository<T>) {
  const seen = { calls: 0, rows: 0, since: [] as (string | null)[] };
  const changedSince = async (since: string | null) => {
    const out = await repo.listChangedSince!(since);
    seen.calls += 1; seen.rows += out.rows.length; seen.since.push(since);
    return out;
  };
  return { seen, changedSince };
}

function countedLog<T>(repo: AppendOnlyRepository<T>) {
  const seen = { calls: 0, records: 0 };
  const changedSince = async (since: string | null) => {
    const out = await repo.readChangedSince!(since);
    seen.calls += 1; seen.records += out.records.length;
    return out;
  };
  return { seen, changedSince };
}

type Loose = never;
const item = (id: string, note: string) => ({ id, subject: `subject-${id}`, note }) as unknown as Loose;
const artifact = (artifactId: string, workItemId: string) =>
  ({ artifactId, workItemId, canonicalUrl: `https://example.gov/${artifactId}`, recordedAt: NOW }) as unknown as Loose;

const temporaryDir = () => mkdtemp(join(tmpdir(), "held-copies-"));

test("(a) the first read fills the copy; a later read in another process moves only changed rows and equals the whole read", async () => {
  const dir = await temporaryDir();
  const base = createMemoryRepositories();
  for (let i = 0; i < 50; i++) await base.workItems.put(`wi-${String(i).padStart(3, "0")}`, item(`wi-${i}`, "first"), NOW);
  const spy = counted(base.workItems);

  const first = heldAggregateList("cp_work_items", spy.changedSince, processCopies(dir, undefined, 0));
  assert.deepEqual(await first(row => row), await base.workItems.list());
  assert.equal(spy.seen.rows, 50, "the first read is the whole table");
  assert.deepEqual(spy.seen.since, [null]);
  assert.ok((await readdir(dir)).includes("cp_work_items.ndjson"), "the copy is on disk");

  const held = (await base.workItems.read("wi-007"))!;
  await base.workItems.compareAndSet("wi-007", held.revision, item("wi-7", "second"), NOW);
  spy.seen.rows = 0;
  const second = heldAggregateList("cp_work_items", spy.changedSince, processCopies(dir, undefined, 0));
  const after = await second(row => row);
  assert.deepEqual(after, await base.workItems.list());
  assert.ok(spy.seen.rows <= 2, `a new process reads the one changed row, plus at most the boundary row; moved ${spy.seen.rows}`);
  assert.notEqual(spy.seen.since[1], null);

  spy.seen.rows = 0;
  assert.deepEqual(await second(row => row), await base.workItems.list());
  assert.ok(spy.seen.rows <= 1, `an unchanged table moves at most the boundary row; moved ${spy.seen.rows}`);
});

test("(b) a row updated between reads appears with its new revision, a new row in id order, and a caller's mutation never reaches the copy", async () => {
  const dir = await temporaryDir();
  const base = createMemoryRepositories();
  for (const id of ["b", "d", "f"]) await base.attempts.put(id, item(id, "v1"), NOW);
  const list = heldAggregateList("cp_attempts", base.attempts.listChangedSince!, processCopies(dir));
  assert.deepEqual(await list(row => row), await base.attempts.list());

  const d = (await base.attempts.read("d"))!;
  await base.attempts.compareAndSet("d", d.revision, item("d", "v2"), NOW);
  await base.attempts.put("a", item("a", "new"), NOW);
  await base.attempts.put("e", item("e", "new"), NOW);

  const listed = await list(row => row);
  assert.deepEqual(listed, await base.attempts.list(), "exactly the whole list(), default slack and all");
  assert.deepEqual(listed.map(row => row.id), ["a", "b", "d", "e", "f"]);
  assert.equal(listed.find(row => row.id === "d")!.revision, 2);

  (listed[0]!.value as unknown as { note: string }).note = "mutated";
  assert.deepEqual(await list(row => row), await base.attempts.list());

  const projection = { note: true } as const;
  assert.deepEqual(await list(row => ({ ...row, value: projectAggregate(row.value, projection) })),
    await base.attempts.listNarrowed(projection), "a narrowed list is the held rows projected the way the store projects them");
});

test("(c) logs: appended records appear in key then position order, nothing twice across the slack overlap", async () => {
  const dir = await temporaryDir();
  const base = createMemoryRepositories();
  await base.artifacts.append("wi-b", "art-1", artifact("art-1", "wi-b"), NOW);
  await base.artifacts.append("wi-a", "art-2", artifact("art-2", "wi-a"), NOW);
  const spy = countedLog(base.artifacts);
  assert.equal(INCREMENTAL_READS_SLACK_MS, 120_000);
  const readAll = heldLogReadAll("cp_log_artifacts", spy.changedSince, processCopies(dir));
  assert.deepEqual(await readAll(), await base.artifacts.readAll());

  await base.artifacts.append("wi-b", "art-3", artifact("art-3", "wi-b"), NOW);
  await base.artifacts.append("wi-a", "art-4", artifact("art-4", "wi-a"), NOW);
  await base.artifacts.append("wi-c", "art-5", artifact("art-5", "wi-c"), NOW);
  await base.artifacts.append("wi-b", "art-1", artifact("art-1", "wi-b"), NOW);

  const all = await heldLogReadAll("cp_log_artifacts", spy.changedSince, processCopies(dir))();
  assert.deepEqual(all, await base.artifacts.readAll());
  assert.deepEqual(all.map(row => (row as unknown as { artifactId: string }).artifactId), ["art-2", "art-4", "art-1", "art-3", "art-5"]);

  const records = (await readFile(join(dir, "cp_log_artifacts.ndjson"), "utf8")).trim().split("\n");
  assert.equal(records.length, 1 + 5 + 1, "a header, one line per record, an end line");
  assert.deepEqual(JSON.parse(records.at(-1)!), { rows: 5 });
});

test("(d) a changed-since read that fails fails the read: nothing is read whole, and the copy is left as it was", async () => {
  const dir = await temporaryDir();
  const base = createMemoryRepositories();
  for (const id of ["x", "y", "z"]) await base.workItems.put(id, item(id, "v1"), NOW);
  await heldAggregateList("cp_work_items", base.workItems.listChangedSince!, processCopies(dir))(row => row);
  const before = await readFile(join(dir, "cp_work_items.ndjson"), "utf8");
  const failing = async (): Promise<never> => { throw new Error("CONTROL_PLANE_REQUEST_TIMEOUT: cp_work_items.listChangedSince"); };
  await assert.rejects(heldAggregateList("cp_work_items", failing, processCopies(dir))(row => row), /CONTROL_PLANE_REQUEST_TIMEOUT/);
  assert.equal(await readFile(join(dir, "cp_work_items.ndjson"), "utf8"), before);
  await assert.rejects(heldAggregateList("cp_work_items", async () => ({ rows: [], through: null }), processCopies(dir))(row => row),
    /no read clock/);
});

test("(e) a copy that is cut short, out of order or not ours is filled again from the database, and says so once", async () => {
  const dir = await temporaryDir();
  const base = createMemoryRepositories();
  for (const id of ["a", "b", "c"]) await base.routeTasks.put(id, item(id, "v1"), NOW);
  const list = () => heldAggregateList("cp_route_tasks", base.routeTasks.listChangedSince!, processCopies(dir, line => lines.push(line)));
  const lines: string[] = [];
  await list()(row => row);
  const file = join(dir, "cp_route_tasks.ndjson");
  const whole = await readFile(file, "utf8");
  for (const broken of [
    whole.split("\n").slice(0, -2).join("\n") + "\n",
    whole.replace(/\n(\[.*)\n(\[.*)\n/, "\n$2\n$1\n"),
    whole.replace('"table":"cp_route_tasks"', '"table":"cp_attempts"'),
    "not a copy",
  ]) {
    await writeFile(file, broken);
    lines.length = 0;
    assert.deepEqual(await list()(row => row), await base.routeTasks.list());
    assert.equal(lines.length, 1, `one line for ${JSON.stringify(broken.slice(0, 30))}`);
    assert.match(lines[0]!, /cp_route_tasks is unreadable .* filled again/);
    assert.equal(await readFile(file, "utf8").then(text => text.split("\n").length), whole.split("\n").length, "the copy is whole again");
  }
});

test("(f) processes reading and writing one copy at once each get the whole table, and the copy stays whole", async () => {
  const dir = await temporaryDir();
  const base = createMemoryRepositories();
  for (let i = 0; i < 200; i++) await base.leases.put(`l-${String(i).padStart(4, "0")}`, item(`l-${i}`, "v1"), NOW);
  const processes = Array.from({ length: 6 }, () => heldAggregateList("cp_leases", base.leases.listChangedSince!, processCopies(dir)));
  for (let round = 0; round < 5; round++) {
    const reads = processes.map(list => list(row => row));
    const id = `l-${String(round * 7).padStart(4, "0")}`;
    const row = (await base.leases.read(id))!;
    await base.leases.compareAndSet(id, row.revision, item(id, `v${round + 2}`), NOW);
    await base.leases.put(`n-${round}`, item(`n-${round}`, "new"), NOW);
    for (const listed of await Promise.all(reads)) assert.ok(listed.length >= 200 + round);
  }
  const expected = await base.leases.list();
  for (const list of processes) assert.deepEqual(await list(row => row), expected);
  assert.deepEqual((await readdir(dir)).filter(name => name.endsWith(".tmp")), [], "no partial copy is left behind");
});

test("(g) the copies are keyed by database and schema version, never by the credential", async () => {
  const root = await temporaryDir();
  assert.equal(heldCopiesFromEnv("postgres://u:secret@ep-a-pooler.us-east-2.aws.neon.tech/neondb", 26, {}), null);
  const copies = heldCopiesFromEnv("postgres://u:secret@ep-a-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require", 26, { [CONTROL_PLANE_READS_DIR_ENV]: root })!;
  assert.equal(databaseIdentity("postgres://other:pw@ep-a.us-east-2.aws.neon.tech/neondb"),
    databaseIdentity("postgres://u:secret@ep-a-pooler.us-east-2.aws.neon.tech/neondb"), "the pooler and the endpoint are one database; the user and password play no part");
  assert.notEqual(databaseIdentity("postgres://u:pw@ep-a.neon.tech/neondb"), databaseIdentity("postgres://u:pw@ep-b.neon.tech/neondb"));
  assert.notEqual(databaseIdentity("postgres://u:pw@ep-a.neon.tech/neondb"), databaseIdentity("postgres://u:pw@ep-a.neon.tech/other"));
  assert.equal(copies.dir, join(root, `${databaseIdentity("postgres://x@ep-a.us-east-2.aws.neon.tech/neondb")}-schema26`));
  assert.doesNotMatch(copies.dir, /secret|neon\.tech/);

  const older = join(root, `${databaseIdentity("postgres://x@ep-b.neon.tech/neondb")}-schema25`);
  const mine = join(root, `${databaseIdentity("postgres://x@ep-c.neon.tech/neondb")}-schema25`);
  await mkdir(older, { recursive: true });
  await mkdir(mine, { recursive: true });
  heldCopiesFromEnv("postgres://x@ep-c.neon.tech/neondb", 26, { [CONTROL_PLANE_READS_DIR_ENV]: root });
  for (let i = 0; i < 50 && await stat(mine).then(() => true, () => false); i++) await new Promise(resolve => setTimeout(resolve, 10));
  await assert.rejects(stat(mine), "an older schema version of the same database is removed");
  await stat(older);
});

test("(h) every Postgres whole-table read goes through the held copies, and no switch or whole-read path is left", async () => {
  const store = await readFile(new URL("../lib/control-plane/repository/pg-store.ts", import.meta.url), "utf8");
  assert.match(store, /copies: heldCopiesFor\?\.\(connectionString, BOOTSTRAP_VERSION\) \?\? null/);
  assert.match(store, /^import type \{ HeldCopies \} from "\.\/incremental-reads\.ts";$/m, "the writer is never in the store's runtime imports");
  assert.equal(store.split('from "./incremental-reads.ts"').length - 1, 1);
  assert.match(store, /list: \(\) => held\(row => row\)/);
  assert.match(store, /listNarrowed: projection => held\(row => \(\{ \.\.\.row, value: projectAggregate\(row\.value, projection\) \}\)\)/);
  assert.match(store, /readAll: \(\) => heldAll\(\)/);
  assert.doesNotMatch(store, /async readAll\(\)|"readAll",/, "the whole-log read is gone");
  assert.doesNotMatch(store, /operation = projection === undefined \? "list"/, "the whole-table read is gone");
  const runner = await readFile(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  assert.match(runner, /process\.env\[CONTROL_PLANE_READS_DIR_ENV\] = join\(ROOT, "\.runtime", "control-plane", "reads"\);\nreadFromHeldCopies\(\);/);
  for (const entry of ["scripts/freshness-shadow.mts", "scripts/hunter-lane.mts", "scripts/publish-owner-snapshot.mts", "scripts/routine-civic-data-runner.mts",
    "lib/control-plane/workers/lease-worker.ts", "lib/control-plane/workers/route-worker.ts", "lib/control-plane/workers/scout-worker.ts",
    "lib/control-plane/workers/national-worker.ts"]) {
    assert.match(await readFile(new URL(`../${entry}`, import.meta.url), "utf8"), /^readFromHeldCopies\(\);$/m, `${entry} reads whole tables from the held copies`);
  }
  for (const path of ["../scripts/freshness-shadow.mts", "../lib/control-plane/repository/incremental-reads.ts"]) {
    assert.doesNotMatch(await readFile(new URL(path, import.meta.url), "utf8"), /WTP_INCREMENTAL_READS|withIncrementalReads|incrementalReadsEnabled/);
  }
});

test("schema version 26: every aggregate and log carries changed_at; logs refuse UPDATE and DELETE, aggregates refuse DELETE", () => {
  assert.equal(BOOTSTRAP_VERSION, 26);
  assert.deepEqual([...CHANGED_AT_TABLES].sort(),
    [...AGGREGATE_KINDS.map(k => `cp_${k}`), ...APPEND_ONLY_LOGS.map(l => `cp_log_${l}`)].sort());
  for (const table of CHANGED_AT_TABLES) {
    const ddl = changedAtColumnDdl(table);
    assert.ok(BOOTSTRAP_DDL.includes(ddl), `${table} gets the column`);
    assert.match(ddl, new RegExp(`CREATE TRIGGER ${table}_changed_at BEFORE UPDATE ON ${table}`));
    const refuse = rejectRewriteDdl(table);
    assert.ok(BOOTSTRAP_DDL.includes(refuse), `${table} refuses what a changed-since read cannot see`);
    assert.match(refuse, new RegExp(`CREATE TRIGGER ${table}_no_rewrite BEFORE ${table.startsWith("cp_log_") ? "UPDATE OR DELETE" : "DELETE"} ON ${table}\\n`));
    assert.ok(BOOTSTRAP_DDL.indexOf(refuse) > BOOTSTRAP_DDL.indexOf(REJECT_REWRITE_FUNCTION_DDL));
    assert.ok(`${table}_no_rewrite`.length <= 63, "a Postgres identifier");
  }
  assert.match(REJECT_REWRITE_FUNCTION_DDL, /RAISE EXCEPTION/);
  assert.throws(() => rejectRewriteDdl("cp_x; drop table cp_attempts"), /unsafe/);
  assert.ok(BOOTSTRAP_DDL.some(sql => /CREATE OR REPLACE FUNCTION cp_touch_changed_at\(\)[\s\S]*NEW\.changed_at := now\(\)/.test(sql)));

  const indexed = CHANGED_AT_INDEXES.map(index => index.name);
  for (const table of ["cp_work_items", "cp_attempts", "cp_route_tasks", "cp_occurrences", "cp_leases", "cp_obligations", "cp_debts",
    "cp_log_artifacts", "cp_log_scout_results", "cp_log_worker_results", "cp_log_costs", "cp_log_dispositions", "cp_log_promotion_pipeline"]) {
    assert.ok(indexed.includes(`${table}_changed_at`), `${table} is indexed on changed_at`);
  }
  for (const index of CHANGED_AT_INDEXES) {
    assert.match(index.ddl, /^CREATE INDEX CONCURRENTLY IF NOT EXISTS cp_[a-z_]+_changed_at ON cp_[a-z_]+ \(changed_at\);$/);
    assert.equal(ONLINE_INDEXES.get(index.ddl), index, "built online");
    assert.ok(BOOTSTRAP_DDL.indexOf(index.ddl) > BOOTSTRAP_DDL.indexOf(changedAtColumnDdl("cp_work_items")), "after the columns exist");
  }
});

test("Postgres: compareAndSet stamps changed_at; list() asks only for rows changed since its copy, paged by keyset from a read clock", async () => {
  const seen: { text: string; params: readonly unknown[] }[] = [];
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: `id-${String(i).padStart(3, "0")}`, revision: 1, updated_at: NOW, value: { i } }));
  const sql: Sql = { query: async (text, params = []) => {
    seen.push({ text, params });
    if (text.includes("SELECT now() AS read_at")) return [{ read_at: "2026-10-06T12:00:00.123456Z" }];
    if (text.startsWith("UPDATE")) return [{ id: "a", revision: 2, updated_at: NOW }];
    if (text.includes("FROM cp_work_items") && !text.includes("id >") && !text.includes("changed_at >=")) return rows;
    if (text.includes("log_key, record_id, position") && !text.includes("(log_key, position) >")) {
      return Array.from({ length: 100 }, (_, i) => ({ log_key: "k", record_id: `r${i}`, position: i, record: { i } }));
    }
    return [];
  } };
  const dir = await temporaryDir();
  const aggregate = pgAggregateRepository<unknown>(sql, "WorkItem", "cp_work_items", { copies: processCopies(dir) });
  await aggregate.compareAndSet("a", 1, {}, NOW);
  assert.match(seen.at(-1)!.text, /changed_at = now\(\)/);
  assert.match(seen.at(-1)!.text, /updated_at = \$1/, "updated_at keeps the writer's clock");

  seen.length = 0;
  const all = await aggregate.list();
  assert.equal(all.length, 100);
  assert.match(seen[0]!.text, /SELECT now\(\) AS read_at/, "the clock is read before the first page");
  assert.doesNotMatch(seen[1]!.text, /changed_at/, "a first read needs no changed_at");
  assert.match(seen[2]!.text, /WHERE id > \$1/);
  assert.deepEqual(seen[2]!.params, ["id-099"]);

  seen.length = 0;
  const narrowed = await aggregate.listNarrowed({});
  assert.deepEqual(narrowed.map(row => row.value), rows.map(() => ({})));
  assert.equal(seen.length, 2, "the clock and one page of changes");
  assert.match(seen[1]!.text, /WHERE changed_at >= \$1::timestamptz\s+ORDER BY id ASC/);
  assert.deepEqual(seen[1]!.params, ["2026-10-06T11:58:00.123Z"], "the copy's clock less the slack");

  seen.length = 0;
  const plain = pgAggregateRepository<unknown>(sql, "WorkItem", "cp_work_items");
  for (let i = 0; i < 2; i++) assert.equal((await plain.list()).length, 100);
  assert.ok(seen.every(call => !/changed_at >=/.test(call.text)), "a process with no held copies reads each whole table as a first read");

  seen.length = 0;
  const logRepo = pgAppendOnlyRepository<unknown>(sql, "artifacts", { copies: processCopies(dir) });
  const records = await logRepo.readChangedSince!("2026-10-06T11:58:00.000Z");
  assert.equal(records.records.length, 100);
  assert.deepEqual(records.records[5], { key: "k", recordId: "r5", position: 5, record: { i: 5 } });
  assert.match(seen[1]!.text, /FROM cp_log_artifacts\s+WHERE changed_at >= \$1::timestamptz\s+ORDER BY log_key ASC, position ASC/);
  assert.match(seen[2]!.text, /WHERE changed_at >= \$1::timestamptz AND \(log_key, position\) > \(\$2, \$3\)/);
  assert.deepEqual(seen[2]!.params, ["2026-10-06T11:58:00.000Z", "k", 99]);

  seen.length = 0;
  assert.equal((await logRepo.readAll()).length, 100);
  assert.doesNotMatch(seen[1]!.text, /changed_at >=/, "the first read of a log fills its copy");
});

test("Persisted rows survive the copy exactly", async () => {
  const dir = await temporaryDir();
  const rows: Persisted<unknown>[] = [
    { id: "a", revision: 3, updatedAt: NOW, value: { nested: { list: [1, 2.5, null, "x"], empty: {} }, unicode: "é—✓" } },
    { id: "b", revision: 1, updatedAt: NOW, value: [1, 2] },
  ];
  const list = heldAggregateList("cp_doors", async () => ({ rows, through: NOW }), processCopies(dir));
  assert.deepEqual(await list(row => row), rows);
  assert.deepEqual(await heldAggregateList("cp_doors", async () => ({ rows: [], through: NOW }), processCopies(dir))(row => row), rows);
});
