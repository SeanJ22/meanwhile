import { openFixturePgRepositories } from "./helpers/pg-repositories.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION } from "../lib/control-plane/repository/pg-schema.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { pgArtifactsByCanonicalUrl, pgEnsureArtifactSourceIndex, type Sql } from "../lib/control-plane/repository/pg-store.ts";

test("source capture reuse uses one bounded exact URL query across job keys", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const records = [{ artifactId: "older-job-capture", canonicalUrl: "https://www.fec.gov/directory", workItemId: "other-job" }];
  const sql: Sql = { query: async (text, params = []) => { calls.push({ text, params }); return records.map(record => ({ record })); } };
  assert.deepEqual(await pgArtifactsByCanonicalUrl(sql, "https://www.fec.gov/directory", 2), records);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ["https://www.fec.gov/directory", 2]);
  assert.match(calls[0].text, /WHERE md5\(record->>'canonicalUrl'\) = md5\(\$1\) AND record->>'canonicalUrl' = \$1/);
  assert.match(calls[0].text, /ORDER BY record->>'recordedAt' DESC NULLS LAST, record->>'artifactId' ASC LIMIT \$2/);
  assert.doesNotMatch(calls[0].text, /LIKE|OFFSET/);
});

test("source capture query failure remains a failure instead of an empty holdings claim", async () => {
  const sql: Sql = { query: async () => { throw new Error("capture metadata unavailable"); } };
  await assert.rejects(pgArtifactsByCanonicalUrl(sql, "https://www.fec.gov/directory", 1), /capture metadata unavailable/);
});

for (const provider of ["memory", "file"] as const) test(provider + ": exact source lookup reuses other jobs, newest acquisition first", async () => {
  const root = await mkdtemp(join(tmpdir(), "s16-artifact-reuse-"));
  try {
    const repos: ControlPlaneRepositories = provider === "memory" ? createMemoryRepositories() : await createFileRepositories(root);
    const source = "https://www.fec.gov/directory";
    const rows = [
      { artifactId: "fresh", workItemId: "unrelated-job", canonicalUrl: source, recordedAt: "2026-10-01T00:00:00Z" },
      { artifactId: "older", workItemId: "same-state-job", canonicalUrl: source, recordedAt: "2026-09-30T00:00:00Z" },
      { artifactId: "other", workItemId: "other-job", canonicalUrl: source + "?other", recordedAt: "2026-10-02T00:00:00Z" },
    ] as ArtifactRecord[];
    for (const row of rows) await repos.artifacts.append(row.workItemId, row.artifactId, row, "2026-10-02T00:00:00Z");
    assert.deepEqual((await repos.artifactsByCanonicalUrl!(source, 1)).map(row => row.artifactId), ["fresh"]);
    assert.deepEqual((await repos.artifactsByCanonicalUrl!(source, 10)).map(row => row.artifactId), ["fresh", "older"]);
    assert.deepEqual(await repos.artifactsByCanonicalUrl!(source, 0), []);
    assert.deepEqual(await repos.artifacts.read("same-state-job"), [rows[1]], "existing scoped reads keep their semantics");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source lookup index builds online outside a transaction and covers its exact ordering", () => {
  assert.ok(BOOTSTRAP_VERSION >= 18);
  const ddl = BOOTSTRAP_DDL.find(sql => sql.includes("cp_log_artifacts_source_url"))!;
  assert.match(ddl, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/);
  assert.match(ddl, /canonicalUrl/);
  assert.match(ddl, /recordedAt.*DESC NULLS LAST/);
  assert.match(ddl, /artifactId.*ASC/);
});

function indexSql(status: { valid: boolean; building: boolean }[], failure?: RegExp, locked = true) {
  const calls: string[] = [];
  const sql: Sql = { query: async text => {
    calls.push(text);
    if (failure?.test(text)) throw new Error("source index build interrupted");
    if (text.includes("pg_try_advisory_lock")) return [{ locked }];
    if (text.includes("FROM pg_index i")) return status;
    return [];
  } };
  return { sql, calls };
}

test("bootstrap preserves a valid source index without dropping or rebuilding it", async () => {
  const { sql, calls } = indexSql([{ valid: true, building: false }]);
  await pgEnsureArtifactSourceIndex(sql);
  assert.equal(calls.filter(text => /CREATE INDEX|DROP INDEX/.test(text)).length, 0);
  assert.ok(!calls.some(text => text.includes("pg_try_advisory_lock")), "an already valid index needs no pinned connection");
});

test("bootstrap creates a missing source index with standalone concurrent DDL", async () => {
  const { sql, calls } = indexSql([]);
  await pgEnsureArtifactSourceIndex(sql);
  assert.equal(calls.filter(text => text.startsWith("CREATE INDEX CONCURRENTLY IF NOT EXISTS")).length, 1);
  assert.ok(!calls.some(text => /DROP INDEX|\bBEGIN\b|\bCOMMIT\b|\bDO\b/.test(text)));
});

test("bootstrap drops only an interrupted invalid source index and recreates it concurrently", async () => {
  const { sql, calls } = indexSql([{ valid: false, building: false }]);
  await pgEnsureArtifactSourceIndex(sql);
  const dropped = calls.indexOf("DROP INDEX CONCURRENTLY IF EXISTS cp_log_artifacts_source_url");
  const created = calls.findIndex(text => text.startsWith("CREATE INDEX CONCURRENTLY IF NOT EXISTS"));
  assert.ok(dropped > calls.findIndex(text => text.includes("FROM pg_index i")));
  assert.ok(created > dropped);
  assert.ok(!calls.some(text => /\bBEGIN\b|\bCOMMIT\b|\bDO\b/.test(text)));
});

test("bootstrap leaves another active concurrent builder intact", async () => {
  const { sql, calls } = indexSql([{ valid: false, building: true }]);
  await assert.rejects(pgEnsureArtifactSourceIndex(sql), /CONTROL_PLANE_SOURCE_INDEX_BUILD_IN_PROGRESS/);
  assert.ok(!calls.some(text => /CREATE INDEX|DROP INDEX/.test(text)));
  assert.ok(calls.some(text => text.includes("pg_advisory_unlock")));
});

test("overlapping bootstraps cannot use a stale INVALID observation to drop a valid replacement", async () => {
  const { sql, calls } = indexSql([{ valid: false, building: false }], undefined, false);
  await assert.rejects(pgEnsureArtifactSourceIndex(sql), /CONTROL_PLANE_SOURCE_INDEX_BUILD_IN_PROGRESS/);
  assert.equal(calls.length, 2, "after preflight, the losing bootstrap never runs DDL or reads an unlocked replacement status");
});

test("HTTP bootstrap opens a pinned connection only when index DDL is owed", async () => {
  const pinned = indexSql([]), http = indexSql([]);
  let opened = 0;
  http.sql.withPinnedConnection = async operation => { opened++; return operation(pinned.sql); };
  await pgEnsureArtifactSourceIndex(http.sql);
  assert.equal(opened, 1);
  assert.equal(http.calls.length, 1, "HTTP reads catalog status and never holds a session lock or runs concurrent DDL");
  assert.ok(pinned.calls.some(text => text.startsWith("CREATE INDEX CONCURRENTLY")));
  const ready = indexSql([{ valid: true, building: false }]);
  ready.sql.withPinnedConnection = async () => { throw new Error("valid index unexpectedly opened a socket"); };
  await pgEnsureArtifactSourceIndex(ready.sql);
});

test("a replacement that became valid before the session lock is never dropped", async () => {
  const mock = indexSql([]);
  let statusReads = 0;
  const original = mock.sql.query;
  mock.sql.query = async (text, params, options) => {
    if (text.includes("FROM pg_index i")) {
      statusReads++;
      mock.calls.push(text);
      return [{ valid: statusReads > 1, building: false }];
    }
    return original(text, params, options);
  };
  await pgEnsureArtifactSourceIndex(mock.sql);
  assert.equal(statusReads, 2);
  assert.ok(!mock.calls.some(text => /CREATE INDEX|DROP INDEX/.test(text)));
});

test("an interrupted source index build fails bootstrap before its version is recorded", async () => {
  const { sql, calls } = indexSql([{ valid: false, building: false }], /^CREATE INDEX CONCURRENTLY/);
  await assert.rejects(openFixturePgRepositories(sql, "2026-10-02T03:00:00Z"), /source index build interrupted/);
  assert.ok(calls.some(text => text.includes("pg_advisory_unlock")));
  assert.ok(!calls.some(text => text.includes("INSERT INTO cp_schema_version")));
});
