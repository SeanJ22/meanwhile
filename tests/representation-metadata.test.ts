import assert from "node:assert/strict";
import test from "node:test";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readRegistrationDivision } from "../lib/registration/reader.ts";
import { representationDivisionMetadata } from "../lib/registry/server.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import labels from "../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";
import { migratedReaderDb } from "./helpers/migrated-reader-db.ts";

test("every held jurisdiction root has metadata without searching registration or loading geometry", async () => {
  installReaderDatabaseQuery(async () => { throw new Error("A state root has no registration division to search"); });
  try {
    for (const row of labels.jurisdictions.filter(row => FIPS_TO_STATE[row.fips]?.postal === row.postal)) {
      const prefix = FIPS_TO_STATE[row.fips].prefix;
      const ocdId = `ocd-division/country:us/${prefix}:${row.postal.toLowerCase()}`;
      assert.deepEqual(await representationDivisionMetadata(ocdId), { ocdId, label: row.name, divisionType: prefix, tier: "state" });
    }
  } finally { installReaderDatabaseQuery(undefined); }
});

test("exact registration metadata reads plain and partitioned divisions, ignores unrelated governments and refuses invalid publication", async () => {
  const {pg,publish:publishVersion} = await migratedReaderDb();
  const scope = "US-AL:registration:v1";
  const publish = (id:string,value:unknown,at:string) => publishVersion({id,value,at,scope,recordClass:"REGISTRATION",sourceId:"source"});
  const ocdId = "ocd-division/country:us/state:al/county:autauga";
  const expected = { ocdId, label: "Autauga", divisionType: "county", tier: "local" };
  try {
    let invalidPublication = false;
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement => {
      const {rows} = await pg.query<Record<string,unknown>>(statement.text,[...statement.params]);
      return invalidPublication ? rows.map(row=>({...row,published:false})) : rows;
    })));
    // Missing government bytes deliberately explode if a metadata read traverses that unrelated branch.
    const payload = {divisions:[{ocdId:"other",label:"Other"},expected],governments:{$civicPayloadPart:"unavailable-government-part"}};
    await publish("plain",payload,"2026-10-19T12:00:00.000Z");
    assert.deepEqual(await readRegistrationDivision("al",ocdId),expected);
    assert.equal(await readRegistrationDivision("al",`${ocdId}/place:unknown`),undefined);
    const partitioned = partitionCivicPayload({...payload,divisions:[{...payload.divisions[0],description:"x".repeat(40_000)},expected]});
    assert.ok(partitioned.parts.length > 0);
    for (const part of partitioned.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await publish("partitioned",partitioned.value,"2026-10-19T12:00:01.000Z");
    assert.deepEqual(await readRegistrationDivision("al",ocdId),expected);
    await assert.rejects(pg.exec("UPDATE civic_data_candidates SET state='REJECTED'"),/immutable|known|forbidden/i);
    invalidPublication = true;
    await assert.rejects(readRegistrationDivision("al",ocdId),/READER_PUBLISHED_POINTER_INVALID/);
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
