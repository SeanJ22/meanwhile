import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

// An explicit throwaway-copy identity is required; no production URL or connection setting is used.
const [mode, codeRootArgument, copyFileArgument, directoryArgument] = process.argv.slice(2);
const codeRoot = resolve(codeRootArgument ?? "."), directory = resolve(directoryArgument ?? ".scratch/db01-copy-replay");
const copy = JSON.parse(await readFile(resolve(copyFileArgument ?? ".scratch/db01-copy.json"), "utf8"));
assert.equal(copy.branchId, "br-wandering-wildflower-ax90nnik");
assert.equal(new URL(copy.url).username, "neondb_owner");
assert.equal(new URL(copy.url).searchParams.has("options"), false);
process.env.DATABASE_URL = copy.url;
process.env.WTP_VITAL_SIGNS_REPORT = "1";
delete process.env.WTP_CIVIC_READ_CACHE_URL;
delete process.env.WTP_CIVIC_READ_CACHE_TOKEN;
await mkdir(directory, { recursive: true });
const sql = neon(copy.url);
const imported = (path: string) => import(pathToFileURL(join(codeRoot, path)).href);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

if (mode === "migrate") {
  const statements = (await readFile(join(codeRoot, "lib/db/migrations/DB-01_read_versions.sql"), "utf8")).split("--> statement-breakpoint").filter(part => part.trim());
  await sql.transaction(statements.map(statement => sql.query(statement)));
  console.log(JSON.stringify({ branchId: copy.branchId, migrationStatements: statements.length }));
} else {
  const { PostgresRoutineDataStore } = await imported("lib/civic-data/store.ts");
  const { CivicReadCache } = await imported("lib/db/civic-read-cache.ts");
  const { ROUTINE_SOURCE_TASKS, routineTaskDue, readRoutineTaskClocks } = await imported("lib/civic-data/runner.ts");
  const { processNeonBytes, keepNeonBytesInProcess } = await imported("lib/db/transfer-by-caller.ts");
  keepNeonBytesInProcess();
  const cacheDirectory = join(directory, "copies");
  await mkdir(cacheDirectory, { recursive: true });
  const cache = new CivicReadCache({ read: (key: string) => readFile(join(cacheDirectory, key), "utf8"),
    write: (key: string, value: string) => writeFile(join(cacheDirectory, key), value) });
  const store = new PostgresRoutineDataStore();
  Object.defineProperty(store, "readCache", { value: cache });
  const started = performance.now();
  const tasks = [...ROUTINE_SOURCE_TASKS];
  let clockCount = 0;
  const clocks = await readRoutineTaskClocks(tasks, async (task: {sourceId: string; recordClass: string; scope: string; parserVersion: string}) => {
    const clock = await store.clock(task.sourceId, task.recordClass, task.scope, task.parserVersion);
    if (++clockCount % 200 === 0) console.log(JSON.stringify({ phase: "clocks", done: clockCount, total: tasks.length }));
    return clock;
  });
  const failed = clocks.filter((row: {ok: boolean}) => !row.ok);
  assert.equal(failed.length, 0, JSON.stringify(failed));
  const manifestFile = join(resolve(directory, ".."), "manifest.json");
  if (mode === "manifest") {
    const scheduledAt = new Date(Date.now() + 5 * 60_000).toISOString();
    const dueIds = clocks.filter((row: {task: unknown; clock: unknown}) => routineTaskDue(row.task, row.clock, Date.parse(scheduledAt)))
      .map((row: {task: {id: string}}) => row.task.id);
    const manifest = { branchId: copy.branchId, scheduledAt, taskIds: tasks.map(task => task.id), dueIds,
      clocksHash: digest(clocks.map((row: {task: {id: string}; clock: unknown}) => [row.task.id, row.clock])) };
    await writeFile(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({ mode, scheduledAt, taskCount: tasks.length, dueCount: dueIds.length, clocksHash: manifest.clocksHash }));
  } else {
    assert.ok(mode === "warm" || mode === "next");
    const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
    assert.equal(manifest.branchId, copy.branchId);
    assert.deepEqual(tasks.map(task => task.id), manifest.taskIds);
    const dueIds = clocks.filter((row: {task: unknown; clock: unknown}) => routineTaskDue(row.task, row.clock, Date.parse(manifest.scheduledAt)))
      .map((row: {task: {id: string}}) => row.task.id);
    assert.deepEqual(dueIds, manifest.dueIds, "the scheduled work must be identical");
    const clocksHash = digest(clocks.map((row: {task: {id: string}; clock: unknown}) => [row.task.id, row.clock]));
    assert.equal(clocksHash, manifest.clocksHash, "cached clocks must equal the production-copy clocks");
    const models: unknown[] = [];
    for (const task of tasks.filter(task => dueIds.includes(task.id))) {
      const pointer = await store.readPromotion(task.recordClass, task.scope);
      models.push([task.id, pointer?.versionId ?? null, pointer ? digest(pointer.payload) : null]);
      if (models.length % 100 === 0) console.log(JSON.stringify({ phase: "due read models", done: models.length, total: dueIds.length }));
    }
    const hours = processNeonBytes();
    const result = { mode, branchId: copy.branchId, scheduledAt: manifest.scheduledAt, taskCount: tasks.length, dueCount: dueIds.length,
      heldModels: models.filter((row: unknown) => (row as unknown[])[1] !== null).length,
      readerResponseBytes: hours.reduce((sum: number, hour: {bytes: {reader: number}}) => sum + hour.bytes.reader, 0),
      requests: hours.reduce((sum: number, hour: {requests: number}) => sum + hour.requests, 0),
      elapsedMs: Math.round(performance.now() - started), clocksHash, workHash: digest(models) };
    await writeFile(join(directory, mode + ".json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  }
}
