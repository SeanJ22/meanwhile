import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { installKeyedRows } from "./helpers/keyed-rows.ts";
import { readKeyedRegistry } from "../lib/civic-data/keyed-rows.ts";
import { PostgresRoutineDataStore } from "../lib/civic-data/store.ts";

const scope = "US-AZ:reader-registry-runtime", key = `REGISTRY_RUNTIME_BINDING:${scope}`;
const division = "ocd-division/country:us/state:az/place:tucson", bodyId = `${division}#governing`;
const source = { sourceUrl: "https://tucsonaz.gov/directory", collectedAt: "2026-10-26T00:00:00Z", sourceOrg: "Tucson" };

async function fixture() {
  const pg = new PGlite();
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,
    last_known_good_version_id text,source_id text,promoted_at timestamptz DEFAULT now(),payload jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,candidate jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
  const bodies = [{ id: bodyId, name: "Mayor and Council", ocdId: division, provenance: source },
    { id: "unrelated", name: "Another government", ocdId: "another-division", privateToOtherJob: "x".repeat(200_000) }];
  const divisions = [{ ocdId: division, state: "AZ", label: "Tucson", provenance: source, sourceDataset: "GOV_DIRECTORY" },
    { ocdId: "another-division", state: "AZ", label: "Another place" }];
  const payload = { registry: { $civicPayloadPart: "registry" } };
  for (const [hash, value] of [
    ["registry", { kind: "object", value: { bodies: { $civicPayloadPart: "bodies" }, divisions } }],
    ["bodies", { kind: "array", groups: [[bodies[0]], [bodies[1]]], order: "[1,0]" }],
  ]) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [hash, JSON.stringify(value)]);
  await pg.query("INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,last_known_good_version_id,source_id,payload,validation_receipt) VALUES($1,'REGISTRY_RUNTIME_BINDING',$2,'v1','v1','registry-reviewed-bindings',$3,$4)",
    [key, scope, JSON.stringify(payload), JSON.stringify({ decision: "GOOD" })]);
  await pg.query("INSERT INTO civic_data_candidates VALUES('v1','REGISTRY_RUNTIME_BINDING',$1,'registry-reviewed-bindings','PROMOTED',$2,$3)",
    [scope, JSON.stringify({ readModel: payload }), JSON.stringify({ decision: "GOOD" })]);
  return { pg, bodies, divisions, query: async (text: string, params: readonly unknown[] = []) =>
    (await pg.query<Record<string, unknown>>(text, [...params])).rows };
}

test("migration backfills compressed registry rows and a one-body read returns only its divisions and exact evidence", async () => {
  const { pg, bodies, divisions, query } = await fixture();
  try {
    await installKeyedRows(pg);
    const read = await readKeyedRegistry(query, "AZ", [bodyId], []);
    assert.deepEqual(read, { versionId: "v1", payload: { registry: { bodies: [bodies[0]], divisions: [divisions[0]] } } });
    assert.ok(Buffer.byteLength(JSON.stringify(read)) < 1000, "the other government's 200KB is never returned");
    assert.equal(await readKeyedRegistry(query, "NH", [bodyId], []), null);
    const reader = { readerRows: query } as unknown as PostgresRoutineDataStore;
    assert.deepEqual(await PostgresRoutineDataStore.prototype.readRegistryDivisions.call(reader, "AZ", ["TUCSON"]),
      [{ ocdId: division, state: "AZ", label: "Tucson", sourceDataset: "GOV_DIRECTORY" }]);
    await pg.query("UPDATE civic_data_candidates SET candidate='{}'");
    await assert.rejects(readKeyedRegistry(query, "AZ", [bodyId], []), /INVALID_PUBLISHED_POINTER/);
    await assert.rejects(PostgresRoutineDataStore.prototype.readRegistryDivisions.call(reader, "AZ", ["Tucson"]), /INVALID_PUBLISHED_POINTER/);
  } finally { await pg.close(); }
});

test("pointer updates replace and remove keyed rows atomically while identical content keeps its change position", async () => {
  const { pg, bodies, divisions, query } = await fixture();
  try {
    await installKeyedRows(pg);
    const before = await query("SELECT row_id,change_id,content_hash FROM civic_data_rows WHERE collection='registry.bodies' ORDER BY ordinal");
    await pg.query("UPDATE civic_data_promotions SET current_version_id='v2',last_known_good_version_id='v2'");
    assert.deepEqual(await query("SELECT row_id,change_id,content_hash FROM civic_data_rows WHERE collection='registry.bodies' ORDER BY ordinal"), before,
      "a new promotion of identical source rows is not a source change");
    const changed = { registry: { bodies: [{ ...bodies[0], name: "Mayor and Council — updated" }], divisions: [divisions[0]] } };
    await assert.rejects(pg.transaction(async tx => {
      await tx.query("UPDATE civic_data_promotions SET payload=$1", [JSON.stringify(changed)]);
      assert.deepEqual((await tx.query("SELECT value->>'name' AS name FROM civic_data_rows WHERE collection='registry.bodies'")).rows,
        [{ name: "Mayor and Council — updated" }]);
      throw new Error("rollback the complete publication");
    }), /rollback/);
    assert.deepEqual(await query("SELECT row_id,change_id,content_hash FROM civic_data_rows WHERE collection='registry.bodies' ORDER BY ordinal"), before);
    await pg.query("UPDATE civic_data_promotions SET payload=$1", [JSON.stringify(changed)]);
    const rows = await query("SELECT row_id,value,change_id FROM civic_data_rows WHERE collection='registry.bodies'");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].row_id, bodyId);
    assert.deepEqual(rows[0].value, changed.registry.bodies[0]);
    assert.ok(Number(rows[0].change_id) > Math.max(...before.map(row => Number(row.change_id))));
    await pg.query("DELETE FROM civic_data_promotions");
    assert.deepEqual(await query("SELECT row_id FROM civic_data_rows"), []);
  } finally { await pg.close(); }
});

test("meeting and agenda rows retain complete text, native IDs and body bindings across compressed members", async () => {
  const { pg, query } = await fixture();
  try {
    const meeting = { id: "meeting:one", bodyId, ocdId: division, startsAt: "2026-11-01T18:00:00Z", provenance: source };
    const text = "A complete agenda. ".repeat(5000);
    await pg.query("INSERT INTO civic_data_payload_parts VALUES('agenda',$1)", [JSON.stringify({ kind: "string", chunks: [text.slice(0, 40000), text.slice(40000)] })]);
    const doc = { meetingId: meeting.id, ocdId: division, documentUrl: "https://tucsonaz.gov/agenda", extraction: "pdf", text: { $civicPayloadPart: "agenda" }, collectedAt: source.collectedAt };
    await pg.query("INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,payload) VALUES('MEETING:one','MEETING','source:one','m1',$1)",
      [JSON.stringify({ meetings: [meeting], agendaDocuments: [doc] })]);
    await installKeyedRows(pg);
    const rows = await query("SELECT collection,body_id,reader_payload_value(value) AS value FROM civic_data_rows WHERE promotion_key='MEETING:one' ORDER BY collection");
    assert.deepEqual(await query("SELECT value #>> '{text,$civicPayloadPart}' AS part FROM civic_data_rows WHERE collection='agendaDocuments'"), [{ part: "agenda" }],
      "keyed rows keep the shared text part rather than copying the whole agenda again");
    assert.deepEqual(rows, [{ collection: "agendaDocuments", body_id: bodyId, value: { ...doc, text } }, { collection: "meetings", body_id: bodyId, value: meeting }]);
    await pg.query("UPDATE civic_data_promotions SET payload=$1 WHERE key='MEETING:one'", [JSON.stringify({ meetings: [meeting], agendaDocuments: [] })]);
    assert.deepEqual(await query("SELECT collection FROM civic_data_rows WHERE promotion_key='MEETING:one'"), [{ collection: "meetings" }]);
  } finally { await pg.close(); }
});
