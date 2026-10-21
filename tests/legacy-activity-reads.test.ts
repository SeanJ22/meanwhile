import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { BOOTSTRAP_DDL } from "../lib/control-plane/repository/pg-schema.ts";
import { pgAggregateRepository, pgAppendOnlyRepository, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { legacyArtifactActivityRepositories, readLegacyActivityCaptures } from "../lib/control-plane/workers/activity.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import type { ArtifactRecord } from "../lib/control-plane/repository/types.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";
import type { Attempt } from "../lib/control-plane/attempt.ts";

test("legacy catch-up keeps archived source work while leaving unrelated and modern plans in Postgres", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const ddl of BOOTSTRAP_DDL) await pg.exec(ddl.replaceAll("CREATE INDEX CONCURRENTLY", "CREATE INDEX"));
  const now = "2026-10-20T00:00:00Z";
  const legacy = { ...createWorkItem({ project: "rn01", subject: "ocd-division/country:us/state:az/place:fixture", obligation: "Saved meeting page", why: "Catch-up", now }), id: "legacy", padding: "kept".repeat(1000) };
  await pg.query("INSERT INTO cp_work_items_archive(id,revision,updated_at,value) VALUES($1,1,$2,$3)", [legacy.id, now, JSON.stringify(legacy)]);
  await pg.query(`INSERT INTO cp_work_items_archive(id,revision,updated_at,value)
    SELECT 'modern-'||n,1,$1::timestamptz,jsonb_build_object('id','modern-'||n,'subject',$2::text,
      'autonomousPlan',jsonb_build_object('contract',jsonb_build_object('schemaVersion',2)),'padding',repeat('x',10000)) FROM generate_series(1,200) n`, [now, legacy.subject]);
  const capture = { artifactId: "saved-legacy", workItemId: "legacy", partial: false, canonicalUrl: "https://example.gov/Events", sourceEvidence: "evidence".repeat(10000) };
  await pg.query("INSERT INTO cp_log_artifacts(log_key,record_id,position,recorded_at,record) VALUES('legacy','saved',1,$1,$2)", [now, JSON.stringify(capture)]);
  await pg.query(`INSERT INTO cp_log_artifacts(log_key,record_id,position,recorded_at,record)
    SELECT 'modern-'||n,'saved',1,$1::timestamptz,jsonb_build_object('artifactId','saved-modern-'||n,'workItemId','modern-'||n,
      'partial',false,'canonicalUrl','https://example.gov/Events','sourceEvidence',repeat('x',10000)) FROM generate_series(1,200) n`, [now]);
  await pg.query("INSERT INTO cp_log_worker_results(log_key,record_id,position,recorded_at,record) VALUES('legacy','parser',1,$1,$2)", [now, JSON.stringify({ id: "parser", workItemId: "legacy", evidence: "preserved" })]);
  await pg.query("INSERT INTO cp_attempts(id,revision,updated_at,value) VALUES('attempt',1,$1,$2)", [now, JSON.stringify({ id: "attempt", workItemId: "legacy" })]);
  let bytes = 0;
  const statements: string[] = [];
  const sql: Sql = { query: async (text, params = []) => {
    statements.push(text);
    const rows = (await pg.query<Record<string, unknown>>(text, [...params])).rows;
    bytes += Buffer.byteLength(JSON.stringify(rows));
    return rows;
  } };
  const repos = { ...createMemoryRepositories(),
    workItems: pgAggregateRepository<typeof legacy>(sql, "work_items", "cp_work_items_history"),
    artifacts: pgAppendOnlyRepository<ArtifactRecord>(sql, "artifacts"),
    workerResults: pgAppendOnlyRepository<WorkerResultRecord>(sql, "worker_results"),
    attempts: pgAggregateRepository<Attempt>(sql, "attempts", "cp_attempts"),
  };
  await repos.workItems.list(); await repos.artifacts.readAll();
  const before = bytes; bytes = 0; statements.length = 0;
  const selected = await legacyArtifactActivityRepositories(repos, artifact => !artifact.partial && artifact.canonicalUrl.endsWith("/Events"),
    () => readLegacyActivityCaptures("az", sql));
  assert.ok(selected);
  assert.deepEqual((await selected.workItems.list()).map(row => row.value), [legacy]);
  assert.deepEqual(await selected.artifacts.readAll(), [capture]);
  assert.equal((await selected.workerResults.readAll())[0].id, "parser");
  assert.deepEqual((await selected.attempts.list()).map(row => row.id), ["attempt"]);
  assert.ok(bytes < before / 10, `${bytes} scoped bytes vs ${before} history bytes`);
  assert.ok(!statements.some(text => /FROM cp_work_items_history\s+ORDER BY/.test(text)), "no archive inventory read");
  assert.equal(selected.workItems.compareAndSet, repos.workItems.compareAndSet, "mutations still use the canonical repository");
  console.log(`RN-01 legacy activity: ${bytes} scoped response bytes vs ${before} full-history bytes`);
  assert.equal(await legacyArtifactActivityRepositories(repos, () => false, () => readLegacyActivityCaptures("az", sql)), null);
});
