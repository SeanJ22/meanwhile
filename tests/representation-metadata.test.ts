import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { installReaderDatabaseQuery } from "../lib/reader/database.ts";
import { readRegistrationDivision } from "../lib/registration/reader.ts";
import { representationDivisionMetadata } from "../lib/registry/server.ts";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import labels from "../data/reference/us-jurisdiction-labels.json" with { type: "json" };
import { FIPS_TO_STATE } from "../lib/ocd/fips.ts";

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
  const pg = new PGlite();
  const scope = "US-AL:registration:v1", key = `REGISTRATION:${scope}`;
  const ocdId = "ocd-division/country:us/state:al/county:autauga";
  const expected = { ocdId, label: "Autauga", divisionType: "county", tier: "local" };
  try {
    await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,source_id text,payload jsonb,
      current_version_id text,last_known_good_version_id text,validation_receipt jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,
      acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    const functions = readFileSync(new URL("../lib/db/migrations/0036_ne01.sql",import.meta.url),"utf8").split("--> statement-breakpoint")
      .filter(sql => /^\s*CREATE FUNCTION reader_payload_(?:value|node|members)\(/.test(sql));
    for (const sql of functions) await pg.exec(sql);
    await pg.query("INSERT INTO civic_data_candidates VALUES('version','REGISTRATION',$1,'source','PROMOTED',true,'version','version')",[scope]);
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,'REGISTRATION',$2,'source','{}','version','version',$3)",
      [key,scope,JSON.stringify({decision:"GOOD",candidateId:"version",sourceId:"source",recordClass:"REGISTRATION",scope})]);
    installReaderDatabaseQuery(async statements => Promise.all(statements.map(async statement =>
      (await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows)));
    // Missing government bytes deliberately explode if a metadata read traverses that unrelated branch.
    const payload = {divisions:[{ocdId:"other",label:"Other"},expected],governments:{$civicPayloadPart:"unavailable-government-part"}};
    await pg.query("UPDATE civic_data_promotions SET payload=$1",[JSON.stringify(payload)]);
    assert.deepEqual(await readRegistrationDivision("al",ocdId),expected);
    assert.equal(await readRegistrationDivision("al",`${ocdId}/place:unknown`),undefined);
    const partitioned = partitionCivicPayload({...payload,divisions:[{...payload.divisions[0],description:"x".repeat(40_000)},expected]});
    assert.ok(partitioned.parts.length > 0);
    for (const part of partitioned.parts) await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
    await pg.query("UPDATE civic_data_promotions SET payload=$1",[JSON.stringify(partitioned.value)]);
    assert.deepEqual(await readRegistrationDivision("al",ocdId),expected);
    await pg.exec("UPDATE civic_data_candidates SET state='REJECTED'");
    await assert.rejects(readRegistrationDivision("al",ocdId),/READER_PUBLISHED_POINTER_INVALID/);
  } finally { installReaderDatabaseQuery(undefined); await pg.close(); }
});
