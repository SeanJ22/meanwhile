import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { PUBLISHED_ARRAY_SLICE_SQL, readPublishedArraySlice } from "../lib/civic-data/published-array-slice.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { insertPublishedSliceFixture, PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";

test("a legacy national publication sends only one state's records and recursive evidence parts", async () => {
  const pg = new PGlite();
  const record = (state: string, index: number) => ({ id: `${state}:${index}`, row: { state: `US-${state}`, bodyId: `${state}-body-${index}` },
    evidence: `${state} retained official evidence ` + "published text ".repeat(3000) });
  const own = Array.from({ length: 3 }, (_, index) => record("AZ", index));
  const payload = { positions: { "own-roll": { "congress:A000001": "YES", "congress:B000002": "NO" } }, kind: "meeting-source-wiring", formatVersion: 1,
    datasets: { profiles: { source: "a published source", profiles: Array.from({ length: 1000 }, (_, index) => ({ id: `person-${index}`, name: `Other person's profile ${index}` })), rowsSeen: 1000 } },
    records: [record("NJ", 0), own[0], record("NH", 0), own[1], own[2], ...Array.from({ length: 50 }, (_, index) => record("CA", index))] };
  const encoded = partitionCivicPayload(payload);
  const returned: unknown[][] = [];
  const query: ReadOnlyQuery = async statements => {
    const out = [];
    for (const statement of statements) {
      const rows = (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows;
      returned.push(rows); out.push(rows);
    }
    return out;
  };
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for (const part of encoded.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)", [part.hash, JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg, {id: "v1", sourceId: "meeting-source-wiring", recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      readModel: payload, storedReadModel: encoded.value, at: "2026-10-19T00:00:00Z", sourceVersion: "source-v1"});
    const read = await readPublishedArraySlice<typeof own[number]>({ recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      path: ["records"], statePath: ["row", "state"], statePattern: "^US-AZ$", query });
    assert.deepEqual(read?.records, own);
    assert.equal(read?.sourceVersion, "source-v1");
    assert.equal(read?.finalUrl, "https://example.gov/source");
    const either = await readPublishedArraySlice<typeof own[number]>({ recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      path: ["records"], statePath: [], statePattern: ".*", selectors: [{ path: ["row", "state"], pattern: "^US-AZ$" }, { path: ["id"], pattern: "^NH:0$" }], query });
    assert.deepEqual(either?.records.map(row => row.id), ["AZ:0", "NH:0", "AZ:1", "AZ:2"]);
    assert.equal(read?.input.readModelSha256, canonicalCivicDataHash(payload), "the retained provenance names the original whole publication hash");
    assert.ok(!JSON.stringify(returned).includes("NJ retained") && !JSON.stringify(returned).includes("CA retained"), "other states' facts and text never cross the connection");
    returned.length = 0;
    const descriptor = await readPublishedArraySlice<{ source: string; rowsSeen: number }>({ recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      path: ["datasets", "profiles"], statePath: [], statePattern: ".*", objectRecord: true, omitKeys: ["profiles"], query });
    assert.deepEqual(descriptor?.records, [{ source: "a published source", rowsSeen: 1000 }]);
    assert.ok(!JSON.stringify(returned).includes("Other person's profile"), "unneeded object fields and their references never cross the connection");
    returned.length = 0;
    const keys = await readPublishedArraySlice<readonly string[]>({ recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring",
      path: ["datasets"], statePath: [], statePattern: ".*", objectRecord: true, objectKeys: true, query });
    assert.deepEqual(keys?.records, [["profiles"]]);
    assert.ok(!JSON.stringify(returned).includes("Other person's profile"), "object names cross without their country's native fact records");
    returned.length=0;
    const scalar=await readPublishedArraySlice<string>({recordClass:"CURATED_READER_RECORD",scope:"US:meeting-source-wiring",path:["positions","own-roll","congress:A000001"],statePath:[],statePattern:".*",valueRecord:true,query});
    assert.deepEqual(scalar?.records,["YES"]);
    const oneKey=await readPublishedArraySlice<Record<string,string>>({recordClass:"CURATED_READER_RECORD",scope:"US:meeting-source-wiring",path:["positions","own-roll"],statePath:[],statePattern:".*",objectRecord:true,keepKeys:["congress:A000001"],query});
    assert.deepEqual(oneKey?.records,[{"congress:A000001":"YES"}]);
    assert.ok(!JSON.stringify(returned).includes('"NO"'),"a different member's exact value never crosses the connection");
    assert.equal(await readPublishedArraySlice({ recordClass: "CURATED_READER_RECORD", scope: "missing", path: ["records"], statePath: ["state"], statePattern: "^AZ$", query }), null);
    await pg.query("UPDATE civic_data_candidates SET state='REFUSED' WHERE id='v1'");
    await assert.rejects(readPublishedArraySlice({ recordClass: "CURATED_READER_RECORD", scope: "US:meeting-source-wiring", path: ["records"], statePath: ["row", "state"], statePattern: "^US-AZ$", query }), /POINTER_INVALID/);
  } finally { await pg.close(); }
});

test("a native slice rejects uncoupled evidence or invalid canonical publication metadata before transferring facts", async () => {
  const pg = new PGlite(), readModel = {records: [{id: "AZ:1", state: "AZ", evidence: "Saved official source"}]};
  const query: ReadOnlyQuery = async statements => Promise.all(statements.map(async statement =>
    (await pg.query<Record<string, unknown>>(statement.text, [...statement.params])).rows));
  const input = {recordClass: "CURATED_READER_RECORD" as const, scope: "US:proof-fixture", path: ["records"], statePath: ["state"], statePattern: "^AZ$", query};
  const tampering = [
    "UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{records,0,evidence}','\"Unvalidated replacement\"')",
    "UPDATE civic_data_promotions SET validation_receipt=jsonb_set(validation_receipt,'{validatedAt}','\"2026-10-19T01:00:00Z\"')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{id}','\"another-version\"')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{sourceId}','\"another-source\"')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{recordClass}','\"PRL_PROFILE\"')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{scope}','\"US:other-place\"')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{retrieval,succeeded}','false')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{normalization,succeeded}','false')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{normalization,normalizedHash}',to_jsonb(repeat('a',64)))",
    "UPDATE civic_data_candidates SET candidate=candidate #- '{normalization,normalizedPayloadHash}'",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{temporal,version}','null')",
    "UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{retrieval,retrievedAt}','\"2026-10-19T01:00:00Z\"')",
    "UPDATE civic_data_promotions SET promoted_at='2026-10-18T23:59:59Z'",
    "UPDATE civic_data_promotions SET last_known_good_version_id='another-version'",
    "UPDATE civic_data_promotions SET key='different-pointer'",
    "UPDATE civic_data_candidates SET state='REFUSED'",
    `WITH changed AS (UPDATE civic_data_promotions SET validation_receipt=jsonb_set(validation_receipt,'{checks,0,verdict}','"FAIL"') RETURNING validation_receipt)
      UPDATE civic_data_candidates SET validation_receipt=(SELECT validation_receipt FROM changed)`,
    `WITH changed AS (UPDATE civic_data_promotions SET validation_receipt=jsonb_set(validation_receipt,'{excludedFacts}','null') RETURNING validation_receipt)
      UPDATE civic_data_candidates SET validation_receipt=(SELECT validation_receipt FROM changed)`,
  ];
  try {
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    await insertPublishedSliceFixture(pg, {id: "v1", sourceId: "fixture", recordClass: input.recordClass, scope: input.scope,
      readModel, at: "2026-10-19T00:00:00Z"});
    assert.deepEqual((await readPublishedArraySlice(input))?.records, readModel.records);
    for (const change of tampering) {
      await pg.exec("BEGIN");
      try {
        await pg.exec(change);
        const rows = (await pg.query<{row_kind: string}>(PUBLISHED_ARRAY_SLICE_SQL,
          [input.recordClass, input.scope, input.path, input.statePath, input.statePattern, false, [], null, false, false, null])).rows;
        assert.ok(rows.every(row => row.row_kind !== "record"), change);
        await assert.rejects(readPublishedArraySlice(input), /POINTER_INVALID/, change);
      } finally { await pg.exec("ROLLBACK"); }
    }
  } finally { await pg.close(); }
});
