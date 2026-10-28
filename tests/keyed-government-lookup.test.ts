import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { canonicalCivicDataHash } from "../lib/civic-data/canonical-hash.ts";
import { readKeyedGovernmentLookup } from "../lib/civic-data/keyed-government-lookup.ts";
import { registrationTarget } from "../lib/registration/publication.ts";
import { installFederalMoneyRows } from "./helpers/federal-money-rows.ts";

test("known-government rows retain source fields, exact whole-source references and ambiguous reviewed matches",async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,source_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,candidate jsonb,validation_receipt jsonb);`);
  const division="ocd-division/country:us/state:az/place:one",bodyId=`${division}#governing`,government="az:city:one",pid="040000001";
  const provenance={sourceUrl:"https://www2.census.gov/source.zip",sourceOrg:"U.S. Census Bureau",collectedAt:"2026-10-01T00:00:00Z"};
  const body={id:bodyId,ocdId:division,jurisdictionId:government,censusId:pid,bodyClass:"GOVERNING",provenance};
  const listing={id:"government:US-AZ:cog:one",jurisdictionId:government,aliases:["old-work-id"],state:"AZ",nativeIds:{census_pid6:pid},bodyIds:[bodyId],associations:[{divisionId:division}],countyFips:"04001",officePhone:"555-1000",additionalSources:[provenance]};
  const registration={state:"AZ",vintage:{referenceSha256:"a".repeat(64),sourceSha256:"b".repeat(64)},bodies:[body,{id:"other",unrelated:"x".repeat(200_000)}],
    governments:[listing,{id:"unrelated",state:"AZ",unrelated:"y".repeat(200_000)}],divisions:[{ocdId:division,label:"Exact place",state:"AZ",provenance},{ocdId:"other",state:"AZ",unrelated:"z".repeat(200_000)}]};
  const reviewed={registry:{bodies:[{...body,name:"One Council"},{...body,id:`${division}#another`,name:"Conflicting exact Census pairing"},{id:"elsewhere",unrelated:"q".repeat(200_000)}],divisions:[]}};
  const insert=async(recordClass:string,scope:string,sourceId:string,payload:unknown)=>{
    const id=`version:${recordClass}`,hash=canonicalCivicDataHash(payload),receipt={decision:"GOOD"};
    await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,'PROMOTED',true,$1,$1,$5,$6::jsonb,$7::jsonb)",[id,recordClass,scope,sourceId,hash,JSON.stringify({readModel:payload,normalization:{normalizedHash:hash}}),JSON.stringify(receipt)]);
    await pg.query("INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$4,$5,'2026-10-01T00:00:00Z',$6::jsonb,$7::jsonb)",[`${recordClass}:${scope}`,recordClass,scope,id,sourceId,JSON.stringify(payload),JSON.stringify(receipt)]);
  };
  await insert("REGISTRATION",registrationTarget("AZ").scope,"census-governments-registration",registration);
  await insert("REGISTRY_RUNTIME_BINDING","US-AZ:reader-registry-runtime","registry-reviewed-bindings",reviewed);
  await installFederalMoneyRows(pg);
  let bytes=0;
  const query=async(text:string,params:readonly unknown[]=[])=>{const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;bytes+=JSON.stringify(rows).length;return rows;};
  const read=await readKeyedGovernmentLookup(query,"AZ",[government],[pid]);
  assert.deepEqual(read.registration?.value.bodies,[body]);
  assert.deepEqual(read.registration?.value.governments,[listing]);
  assert.deepEqual(read.registration?.value.divisions,[registration.divisions[0]]);
  assert.equal(read.registration?.input.readModelSha256,canonicalCivicDataHash(registration),"provenance binds the complete source version, not the selected subset");
  assert.deepEqual(read.reviewed?.bodies,reviewed.registry.bodies.slice(0,2),"the caller still sees every ambiguous exact match");
  assert.ok(bytes<8_000,`${bytes} bytes excludes the unrelated state inventories`);
  await pg.query("UPDATE civic_data_candidates SET candidate='{}'::jsonb WHERE record_class='REGISTRATION'");
  await assert.rejects(readKeyedGovernmentLookup(query,"AZ",[government],[pid]),/KEYED_SOURCE_POINTER_INVALID/);
});
