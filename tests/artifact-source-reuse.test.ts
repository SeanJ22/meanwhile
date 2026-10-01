import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { BOOTSTRAP_DDL, BOOTSTRAP_VERSION } from "../lib/control-plane/repository/pg-schema.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { pgArtifactsByCanonicalUrl, type Sql } from "../lib/control-plane/repository/pg-store.ts";

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
