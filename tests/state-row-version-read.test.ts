import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { neonConfig } from "../lib/db/client.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

test("state bodies survive new stores, update on the next read, and cannot hide a changed candidate proof", async t => {
  const pg = new PGlite();
  const originalFetch = neonConfig.fetchFunction, originalUrl = process.env.DATABASE_URL;
  const originalReport = process.env.WTP_VITAL_SIGNS_REPORT;
  process.env.WTP_VITAL_SIGNS_REPORT = "1";
  process.env.DATABASE_URL = "postgres://readonly:fixture@ep-state-version.invalid/neondb";
  t.after(async () => {
    neonConfig.fetchFunction = originalFetch;
    if (originalUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalUrl;
    if (originalReport === undefined) delete process.env.WTP_VITAL_SIGNS_REPORT; else process.env.WTP_VITAL_SIGNS_REPORT = originalReport;
    await pg.close();
  });
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,source_id text,record_class text,scope text,
    current_version_id text,last_known_good_version_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,candidate jsonb,state text,acquisition_succeeded boolean,
    promoted_version_id text,last_known_good_version_id text,failure_code text,failure_detail text,validation_receipt jsonb);
    CREATE TABLE civic_data_candidate_events(candidate_id text,sequence integer,detail text);
    ALTER TABLE civic_data_candidates ADD COLUMN read_model_fingerprint text,ADD COLUMN normalized_hash text;
    ALTER TABLE civic_data_promotions ADD COLUMN payload_fingerprint text;`);
  const scope = "US-AZ:reader-registry-runtime", key = `REGISTRY_RUNTIME_BINDING:${scope}`;
  const payload = { label: "held-state-body", evidence: "evidence ".repeat(100_000) };
  const receipt = { decision: "GOOD", candidateId: "v1" };
  await pg.query("INSERT INTO civic_data_candidates VALUES('v1',$1,'PROMOTED',true,'v1','v1',null,null,$2)", [
    { id: "v1", sourceId: "state", recordClass: "REGISTRY_RUNTIME_BINDING", scope, readModel: payload, normalization: {} }, receipt,
  ]);
  await pg.query("INSERT INTO civic_data_promotions VALUES($1,'state','REGISTRY_RUNTIME_BINDING',$2,'v1','v1',now(),$3,$4)", [key, scope, payload, receipt]);
  await pg.query("UPDATE civic_data_candidates SET normalized_hash=$1",[canonicalCivicDataHash(payload)]);
  let bodyReads = 0, versionReads = 0;
  neonConfig.fetchFunction = async (_input: RequestInfo | URL, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body));
    assert.ok(!request.queries, "all fixture traffic is read only");
    if (request.query.includes("state_promotion AS MATERIALIZED")) bodyReads++;
    else { assert.ok(request.query.includes("publication-v1/"), "every stored body first asks for its content fingerprint and small proof header"); versionReads++; }
    const result = await pg.query<Record<string, unknown>>(request.query, request.params);
    return new Response(JSON.stringify({ command: "SELECT", rowCount: result.rows.length, rowAsArray: true, fields: result.fields,
      rows: result.rows.map(row => result.fields.map(field => row[field.name] === null ? null : typeof row[field.name] === "object"
        ? JSON.stringify(row[field.name]) : String(row[field.name]))) }));
  };
  const read = () => new PostgresRoutineDataStore().readPromotion<typeof payload>("REGISTRY_RUNTIME_BINDING", scope);
  assert.deepEqual((await read())?.payload, payload);
  assert.deepEqual((await read())?.payload, payload);
  assert.equal(bodyReads, 1, "fresh stores reuse unchanged state bodies");
  assert.ok(versionReads >= 3);
  const changed = { ...payload, label: "new-state-fact" };
  await pg.query("UPDATE civic_data_promotions SET payload=$1 WHERE key=$2", [changed, key]);
  await pg.query("UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{readModel}',$1) WHERE id='v1'", [changed]);
  await pg.query("UPDATE civic_data_candidates SET normalized_hash=$1",[canonicalCivicDataHash(changed)]);
  assert.deepEqual((await read())?.payload, changed, "same application version and timestamp still yield the next committed body");
  assert.equal(bodyReads, 2);
  await pg.query("UPDATE civic_data_candidates SET validation_receipt='{}' WHERE id='v1'");
  await assert.rejects(read, /STATE_PUBLICATION_POINTER_PROOF_INVALID/, "candidate-only changes cannot reuse a formerly valid body");
  await pg.query("DELETE FROM civic_data_promotions WHERE key=$1", [key]);
  assert.equal(await read(), null);
});
