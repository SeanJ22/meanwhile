/** Replay the registry-prior reads of the same pass in fresh processes on an explicit production copy. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { neon } from "@neondatabase/serverless";

const [mode, codeRootArgument, copyFileArgument, directoryArgument] = process.argv.slice(2);
if (mode === "compare") {
  const directory = resolve(codeRootArgument!);
  const results = await Promise.all(["before/warm", "before/next", "after/warm", "after/next"].map(async name =>
    JSON.parse(await readFile(join(directory, name + ".json"), "utf8"))));
  const clean = (rows: Record<string, unknown>[]) => rows.map(({ responseBytes: _bytes, ...row }) => row);
  for (const result of results) {
    assert.equal(result.stateCount, 56);
    assert.equal(result.branchId, results[0].branchId);
    assert.equal(result.scheduledAt, results[0].scheduledAt);
    assert.equal(result.versionsHash, results[0].versionsHash);
    assert.deepEqual(clean(result.states), clean(results[0].states), "every state's complete result, count and IDs must match");
  }
  const [before, after] = [results[1], results[3]];
  console.log(JSON.stringify({ statesUnchanged: 56, records: after.states.reduce((sum: number, row: {records: number}) => sum + row.records, 0),
    readerResponseBytes: { before: before.readerResponseBytes, after: after.readerResponseBytes },
    callersBefore: before.byCaller, callersAfter: after.byCaller }));
  process.exit(0);
}
assert.ok(mode === "warm" || mode === "next");
const codeRoot = resolve(codeRootArgument!), directory = resolve(directoryArgument!);
const copy = JSON.parse(await readFile(resolve(copyFileArgument!), "utf8"));
assert.equal(copy.branchId, "br-summer-paper-ax3y1xri");
assert.equal(copy.parentId, "br-delicate-lab-ax02xuo5");
assert.notEqual(new URL(copy.url).hostname, new URL(process.env.DATABASE_URL!).hostname);
assert.equal(new URL(copy.url).searchParams.has("options"), false);
process.env.DATABASE_URL = copy.url;
process.env.WTP_VITAL_SIGNS_REPORT = "1";
delete process.env.WTP_CIVIC_READ_CACHE_URL;
delete process.env.WTP_CIVIC_READ_CACHE_TOKEN;
const imported = (path: string) => import(pathToFileURL(join(codeRoot, path)).href);
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
await mkdir(directory, { recursive: true });
const { startCivicReadCacheHost } = await imported("lib/db/civic-read-cache-host.ts");
// Use the actual bounded runner host and the actual runtime cache client.
const originalDirectory = process.cwd();
process.chdir(directory);
const host = await startCivicReadCacheHost();
process.chdir(originalDirectory);
try {
  const { PostgresRoutineDataStore } = await imported("lib/civic-data/store.ts");
  const { readRegistryRuntimePrior } = await imported("lib/registry/runtime-data-plane.ts");
  const { REGISTRY_STATES } = await imported("lib/civic-data/state-scopes.ts");
  const { civicRecordsFor } = await imported("lib/civic-data/changes.ts");
  const { canonicalCivicDataHash } = await imported("lib/civic-data/canonical-hash.ts");
  const { processNeonBytes, keepNeonBytesInProcess } = await imported("lib/db/transfer-by-caller.ts");
  keepNeonBytesInProcess();
  const store = new PostgresRoutineDataStore();
  const sql = neon(copy.url);
  const versions = await sql.transaction([sql.query(`SELECT record_class, scope, version::text FROM civic_data_clock_versions
    WHERE record_class='REGISTRY_RUNTIME_BINDING' ORDER BY scope`)], { readOnly: true });
  const started = performance.now();
  const scheduledAt = "2026-10-24T23:30:00.000Z";
  const states: Record<string, unknown>[] = [];
  const bytes = () => processNeonBytes().reduce((sum: number, hour: {bytes: {reader: number}}) => sum + hour.bytes.reader, 0);
  for (const state of REGISTRY_STATES) {
    const before = bytes(), prior = await readRegistryRuntimePrior(store, scheduledAt, state);
    const responseBytes = bytes() - before;
    if (!prior) { states.push({ state, versionId: null, responseBytes, records: 0 }); continue; }
    const payload = prior.payload;
    const records = civicRecordsFor("REGISTRY_RUNTIME_BINDING", payload);
    const payloadHash = canonicalCivicDataHash(payload);
    assert.equal(payloadHash, prior.readModelSha256);
    const row = { state, responseBytes, versionId: prior.versionId, payloadHash,
      resultHash: canonicalCivicDataHash(prior), idsHash: digest(records.map((row: {key: string}) => row.key).sort()),
      records: records.length, divisions: payload.registry.divisions.length, bodies: payload.registry.bodies.length,
      rosters: payload.bodyRosters?.length ?? 0,
      rosterMembers: (payload.bodyRosters ?? []).reduce((sum: number, row: {members: readonly unknown[]}) => sum + row.members.length, 0),
      executives: payload.statewideExecutives.length, candidacies: payload.officialCandidacies.rows.length,
      officialPhotos: payload.officialPhotos.photos.length, rosterPhotos: Object.keys(payload.rosterPhotos).length,
      dispositions: payload.rosterReaderDispositions?.length ?? 0 };
    states.push(row);
    console.log(JSON.stringify({ phase: mode, state, records: row.records, responseBytes }));
  }
  const afterVersions = await sql.transaction([sql.query(`SELECT record_class, scope, version::text FROM civic_data_clock_versions
    WHERE record_class='REGISTRY_RUNTIME_BINDING' ORDER BY scope`)], { readOnly: true });
  assert.deepEqual(afterVersions, versions, "both runs must use a stable production copy");
  const callers = Object.fromEntries(processNeonBytes().flatMap((hour: {byCaller: Record<string, number>}) => Object.entries(hour.byCaller)));
  const callerBytes = Object.entries(callers).filter(([caller]) => /runtime-data-plane\.ts/.test(caller))
    .reduce((sum, [, value]) => sum + Number(value), 0);
  const result = { mode, codeRoot, branchId: copy.branchId, parentId: copy.parentId, parentLsn: copy.parentLsn,
    scheduledAt, stateCount: states.length, versionsHash: digest(versions), readerResponseBytes: bytes(),
    callerBytes, byCaller: callers, requests: processNeonBytes().reduce((sum: number, hour: {requests: number}) => sum + hour.requests, 0),
    elapsedMs: Math.round(performance.now() - started), peakRssBytes: process.resourceUsage().maxRSS * 1024, states };
  await writeFile(join(directory, mode + ".json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ mode, stateCount: states.length, callerBytes, readerResponseBytes: result.readerResponseBytes,
    elapsedMs: result.elapsedMs, peakRssBytes: result.peakRssBytes }));
} finally { await host.close(); }
