import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { plannerStateReads } from "../lib/civic-data/planner-state-read.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

test("planner reads state registration identities without geometry on the real schema", async t => {
  const pg = new PGlite();
  t.after(() => pg.close());
  for (const name of ["0025_typical_fixer", "0030_database_transfer_daily", "0031_civic_payload_parts", "0036_ne01"]) {
    await pg.exec(readFileSync(`lib/db/migrations/${name}.sql`, "utf8"));
  }
  const put = async (recordClass: string, scope: string, version: string, payload: unknown) => {
    const encoded = partitionCivicPayload(payload);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    const receipt = { contractVersion: 2, decision: "GOOD", candidateId: version, sourceId: "test", recordClass, scope,
      validatedAt: "2026-10-21T00:00:00Z", excludedFacts: [], checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "OK", detail: "verified" })) };
    await pg.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,identity,candidate,promoted_version_id,last_known_good_version_id)
      VALUES($1,'test',$2,$3,'PROMOTED',true,now(),'2026','v1','{}','{}',$1,$1)`, [version, recordClass, scope]);
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,'test',$2,$3,$4,$4,now(),$5,$6)",
      [`${recordClass}:${scope}`, recordClass, scope, version, JSON.stringify(encoded.value), JSON.stringify(receipt)]);
  };
  const bodies = Array.from({ length: 1150 }, (_, n) => ({ id: `il-body-${n}`, jurisdictionId: `il:city:${n}`, censusId: `${n}`, ocdId: `il-${n}` }));
  const registration = { formatVersion: 1, state: "IL", scope: "US-IL:registration:v1", vintage: { referenceSha256: "held-reference" },
    reviewedRegistryVersionId: null, counts: { governments: 1150 }, bodies,
    governments: [{ id: "il-government", jurisdictionId: null, name: "Held government", governmentClass: "MUNICIPAL",
      nativeIds: { census_pid6: "1" }, website: null, countyFips: null, associations: [] }],
    divisions: [{ ocdId: "il-division", geometry: "geometry".repeat(100_000) }] };
  await put("REGISTRATION", "US-IL:registration:v1", "il-version", registration);
  let calls = 0;
  const query: ReadOnlyQuery = async statements => {
    calls++;
    return Promise.all(statements.map(async statement => (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows));
  };
  const observations: { bytes: number; ok: boolean }[] = [];
  const reads = plannerStateReads("il", query, read => observations.push(read));
  const first = await reads.registration("IL");
  assert.equal(first.kind, "PROMOTED");
  if (first.kind !== "PROMOTED") throw new Error("registration not read");
  assert.deepEqual(first.value.bodies, bodies);
  assert.deepEqual(first.value.governments, registration.governments);
  assert.deepEqual(first.value.vintage, registration.vintage);
  assert.deepEqual(first.value.divisions, []);
  assert.equal(first.metadata.versionId, "il-version");
  assert.ok(observations[0].bytes < JSON.stringify(registration).length / 10);
  assert.equal(await reads.registration("il"), first, "identity and ownership share one state read");
  assert.equal(calls, 4, "one publication header and three ordered bounded identity pages");
  assert.throws(() => reads.registration("nh"), /PLANNER_STATE_BOUNDARY/);
  assert.throws(() => plannerStateReads("all", query), /PLANNER_STATE_INVALID/);
  assert.equal((await plannerStateReads("nh", query).registration("nh")).kind, "NOT_RECORDED");

  // The other state's large records must never cross the transport.
  const wiring = { kind: "meeting-source-wiring", formatVersion: 1, records: [
    { id: "il-held", status: "SUSPENDED", row: { state: "US-IL", bodyId: "il-body", jurisdictionId: "il:city:1" } },
    ...Array.from({ length: 100 }, (_, n) => ({ id: `nh-${n}`, status: "ACTIVE", row: { state: "US-NH", bodyId: `nh-${n}`, unused: "x".repeat(1000) } })),
  ] };
  await put("CURATED_READER_RECORD", "US:meeting-source-wiring", "wiring-version", wiring);
  const own = await reads.wiring();
  assert.equal(own.kind, "PROMOTED");
  if (own.kind === "PROMOTED") assert.deepEqual(own.value.records, [wiring.records[0]]);
  await pg.exec("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id='il-version'");
  await assert.rejects(plannerStateReads("il", query).registration("il"), /PLANNER_PUBLICATION_INVALID/);
  await assert.rejects(plannerStateReads("il", async () => { throw new Error("transport failed"); }).registration("il"), /transport failed/);
  await pg.exec("DELETE FROM civic_data_payload_parts");
  await assert.rejects(plannerStateReads("il", query).registration("il"), /CIVIC_PAYLOAD_PART_MISSING/);
});

test("planner retries Neon's upstream connection termination, preserving SQL and HTTP refusals", async () => {
  let calls = 0;
  const reset = new Error("Server error (HTTP status 503): upstream connect error or disconnect/reset before headers. reset reason: connection termination");
  reset.name = "NeonDbError";
  const reads = plannerStateReads("me", async () => { if (++calls === 1) throw reset; return [[{ held: true }]]; });
  assert.deepEqual(await reads.query([{ text: "SELECT 1", params: [] }]), [[{ held: true }]]);
  assert.equal(calls, 2);
  for (const message of ["HTTP status 403: permission denied", "HTTP status 503: quota refused", "syntax error at or near SELECT",
    "PROVIDER_CIRCUIT_BROKEN: " + reset.message]) {
    calls = 0;
    const error = Object.assign(new Error(message), { name: "NeonDbError" });
    await assert.rejects(plannerStateReads("me", async () => { calls++; throw error; }).query([{ text: "SELECT 1", params: [] }]), value => value === error);
    assert.equal(calls, 1);
  }
});
