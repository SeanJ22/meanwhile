import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { readOperationalReferenceState } from "../lib/civic-data/operational-reference-state-read.ts";
import { preloadOperationalReferenceState, installedOperationalReferenceRegistries, clearOperationalReferenceBundle } from "../lib/civic-data/operational-references.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { VALIDATION_CHECKS } from "../lib/civic-data/types.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

test("one state's startup reads partitioned reviewed data on the real migration schema", async t => {
  const pg = new PGlite();
  t.after(async () => { clearOperationalReferenceBundle(); await pg.close(); });
  for (const name of ["0025_typical_fixer", "0030_database_transfer_daily", "0031_civic_payload_parts", "0036_ne01"]) {
    await pg.exec(readFileSync(`lib/db/migrations/${name}.sql`, "utf8"));
  }
  const registries = JSON.parse(readFileSync("tests/fixtures/jurisdiction-registries.json", "utf8"));
  const payload = { formatVersion: 1, sourceVersion: "census-2022+reviewed-routing-v1", registries };
  const put = async (scope: string, version: string, value: unknown) => {
    const encoded = partitionCivicPayload(value);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING", [part.hash, JSON.stringify(part.payload)]);
    const receipt = { contractVersion: 2, decision: "GOOD", candidateId: version, sourceId: "reviewed", recordClass: "OPERATIONAL_REFERENCE", scope,
      validatedAt: "2026-10-20T00:00:00Z", excludedFacts: [], checks: VALIDATION_CHECKS.map(check => ({ check, verdict: "PASS", code: "OK", detail: "verified" })) };
    await pg.query(`INSERT INTO civic_data_candidates(id,source_id,record_class,scope,state,acquisition_succeeded,retrieved_at,source_through,parser_version,identity,candidate,promoted_version_id,last_known_good_version_id)
      VALUES($1,'reviewed','OPERATIONAL_REFERENCE',$2,'PROMOTED',true,now(),'2026','v1','{}','{}',$1,$1)`, [version, scope]);
    await pg.query(`INSERT INTO civic_data_promotions VALUES($1,'reviewed','OPERATIONAL_REFERENCE',$2,$3,$3,now(),$4,$5)`,
      [`OPERATIONAL_REFERENCE:${scope}`, scope, version, JSON.stringify(encoded.value), JSON.stringify(receipt)]);
  };
  await put("US:covered-jurisdiction-routing:v1", "legacy", payload);
  let bytes = 0, calls = 0;
  const query: ReadOnlyQuery = async statements => {
    calls++;
    const rows = (await pg.query<Record<string, unknown>>(statements[0].text, [...statements[0].params])).rows;
    bytes += Buffer.byteLength(JSON.stringify(rows));
    return [rows];
  };
  const nh = await preloadOperationalReferenceState("nh", query);
  assert.deepEqual(nh.registry, registries.nh);
  assert.deepEqual(Object.keys(installedOperationalReferenceRegistries()), ["nh"]);
  assert.equal(calls, 1);
  const nationalBytes = Buffer.byteLength(JSON.stringify(payload));
  assert.ok(bytes < nationalBytes / 2, `${bytes} scoped bytes vs ${nationalBytes} whole-bundle bytes`);
  console.log(`RN-01 operational reference: ${bytes} scoped bytes; ${nationalBytes} whole-bundle bytes; ${calls} request`);
  assert.deepEqual(await readOperationalReferenceState("al", query), { registry: null, versionId: null });
  await assert.rejects(preloadOperationalReferenceState("invalid", query), /STATE_INVALID/);
  await put("US-AZ:covered-jurisdiction-routing:v1", "az-scoped", { ...payload, registries: { az: registries.az } });
  assert.equal((await readOperationalReferenceState("az", query)).versionId, "az-scoped");
  await pg.exec("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE id='az-scoped'");
  await assert.rejects(readOperationalReferenceState("az", query), /STATE_PROOF_INVALID/);
  await assert.rejects(readOperationalReferenceState("az", async () => { throw new Error("transport failed"); }), /transport failed/);
  await pg.exec("DELETE FROM civic_data_payload_parts");
  await assert.rejects(readOperationalReferenceState("nh", query), /CIVIC_PAYLOAD_PART_MISSING/);
});
