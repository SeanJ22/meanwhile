import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { HELD_WORK_INPUT_IDS_SQL } from "../lib/control-plane/workers/held-worker-inputs.ts";

test("held worker inputs select only an acquired source with a missing next computation", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`CREATE TABLE cp_work_items(id text,value jsonb); CREATE TABLE cp_log_artifacts(record jsonb);
      CREATE TABLE cp_log_worker_results(log_key text,record jsonb); CREATE TABLE cp_route_tasks(id text,value jsonb);
      CREATE FUNCTION cp_control_state(jsonb) RETURNS text LANGUAGE sql IMMUTABLE AS $$SELECT 'az'::text$$`);
    const item = "work:one", artifactId = "artifact:one", url = "https://example.gov/calendar", implementation = "workers/2";
    const contract = { schemaVersion: 2, recordClass: "ROSTER", subjectId: "body:one", sourceScope: { canonicalUrls: [url] } };
    const acquisition = { id: "acquired", workItemId: item, attemptId: "attempt:one", result: { role: "ACQUIRER", verdict: "ACQUIRED",
      source: { subjectId: contract.subjectId }, artifacts: [{ artifactId, completeness: "COMPLETE", byteCount: 10,
        contentHash: "sha256-a", canonicalUrl: url, acquisitionAttemptId: "attempt:one" }] },
      completion: { closedAttempt: { id: "attempt:one", outcome: "COMPLETED" } } };
    await pg.query("INSERT INTO cp_work_items VALUES($1,$2::jsonb)", [item, JSON.stringify({ id: item, subject: contract.subjectId, autonomousPlan: { contract } })]);
    await pg.query("INSERT INTO cp_log_artifacts VALUES($1::jsonb)", [JSON.stringify({ workItemId: item, artifactId, byteLength: 10,
      contentHash: "sha256-a", canonicalUrl: url, attemptId: "attempt:one", partial: false })]);
    const selected = async (version = implementation, state: string | null = "az") =>
      (await pg.query<{ id: string }>(HELD_WORK_INPUT_IDS_SQL, [version, state])).rows.map(row => row.id);
    const result = async (record: unknown) => pg.query("INSERT INTO cp_log_worker_results VALUES($1,$2::jsonb)", [item, JSON.stringify(record)]);
    const task = async (id: string, role: string, producerResultId: string | null = null, validatorResultId: string | null = null) =>
      pg.query("INSERT INTO cp_route_tasks VALUES($1,$2::jsonb)", [id, JSON.stringify({ workItemId: item, workerTask: {
        schemaVersion: 1, role, artifactId, contract, implementationVersion: implementation, producerResultId, validatorResultId, auditScope: "CAPTURED_ARTIFACT" } })]);
    assert.deepEqual(await selected(), [], "vaulted bytes alone confer no acquisition authority");
    await result(acquisition);
    assert.deepEqual(await selected(), [item]);
    assert.deepEqual(await selected(implementation, "nh"), [], "one state's planner never loads another state's work");
    await task("parse", "PARSER");
    assert.deepEqual(await selected(), [], "an existing computation keeps its own retry state");
    await result({ id: "parsed", routeTaskId: "parse", result: { role: "PARSER", verdict: "EXTRACTED", records: "large values stay held" } });
    assert.deepEqual(await selected(), [item]);
    await task("validate", "VALIDATOR", "parsed");
    assert.deepEqual(await selected(), []);
    await result({ id: "validated", routeTaskId: "validate", result: { role: "VALIDATOR", verdict: "FAIL", extractionVerdict: "PASS" } });
    assert.deepEqual(await selected(), [item], "independent verified fields proceed even when other fields remain blank");
    await task("audit", "ADVERSARIAL_AUDITOR", "parsed", "validated");
    assert.deepEqual(await selected(), []);
    assert.deepEqual(await selected("workers/3"), [item], "a changed implementation reopens its actual source input");
    await pg.query("UPDATE cp_work_items SET value=jsonb_set(value,'{autonomousPlan,contract,methodVersion}','3'::jsonb)");
    assert.deepEqual(await selected(), [item], "a changed contract creates its own computation identity");
  } finally { await pg.close(); }
});
