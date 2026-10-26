import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { installKeyedRows } from "./helpers/keyed-rows.ts";
import { readCountyCivicContactInputs } from "../lib/sources/google-civic/county-inputs.ts";
import { countyCivicProbeTargets } from "../lib/sources/google-civic/refresh.ts";
import { registrationTarget } from "../lib/registration/publication.ts";
import { stateBallotScope,stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";

test("Google Civic reads only county-office contact fields from encoded and keyed published rows",async()=>{
  const pg=new PGlite(),county="ocd-division/country:us/state:az/county:pima",other="ocd-division/country:us/state:az/county:maricopa";
  try {
    await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,
      source_id text,promoted_at timestamptz DEFAULT now(),payload jsonb,validation_receipt jsonb);
      CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,candidate jsonb,validation_receipt jsonb,
      raw_hash text,normalized_hash text,parser_version text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text);
      CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)`);
    await installKeyedRows(pg);
    const save=async(recordClass:string,scope:string,payload:unknown)=>{
      const id=recordClass,sourceId=recordClass==="REGISTRATION"?"census-governments-registration":recordClass==="VOTING_SITE"?"voting-sites":"registry-reviewed-bindings",
        receipt={decision:"GOOD",candidateId:id,sourceId,recordClass,scope};
      await pg.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,'PROMOTED',$5,$6,$7,$7,'parser',true,$1,$1)",
        [id,recordClass,scope,sourceId,JSON.stringify({normalization:{succeeded:true,normalizedHash:"a".repeat(64)},readModel:payload}),JSON.stringify(receipt),"a".repeat(64)]);
      await pg.query("INSERT INTO civic_data_promotions(key,record_class,scope,current_version_id,last_known_good_version_id,source_id,payload,validation_receipt) VALUES($1,$2,$3,$4,$4,$5,$6,$7)",
        [`${recordClass}:${scope}`,recordClass,scope,id,sourceId,JSON.stringify(payload),JSON.stringify(receipt)]);
    };
    const registration={divisions:[{ocdId:county,divisionType:"county",geoid:"04019"},{ocdId:other,divisionType:"county",geoid:"04013"}],
      bodies:[{ocdId:county,name:"Board of Elections",officeAddress:"Public election office A"},
        {ocdId:other,name:"County Commission",officeAddress:"unrelated-address",unrelated:"x".repeat(200_000)}],
      governments:[{id:"g1",name:"Public office",contactTitle:"Supervisor of elections",officeAddress:"Public election office B",
        associations:[{divisionId:other,ignored:"unneeded-association-value"}]}]};
    await pg.query("INSERT INTO civic_data_payload_parts VALUES('registration',$1)",[JSON.stringify({kind:"object",value:registration})]);
    await save("REGISTRATION",registrationTarget("AZ").scope,{$civicPayloadPart:"registration"});
    await save("REGISTRY_RUNTIME_BINDING",stateRegistryRuntimeScope("AZ"),{registry:{bodies:[{id:"b1",ocdId:other,name:"Elections Commission",officeAddress:"Public election office C"}],divisions:[]}});
    await save("VOTING_SITE",stateBallotScope("voting-sites","AZ"),{jurisdictions:[{ocdId:county,office:{address:"Public voting office"},sites:[{neverReturn:"y".repeat(200_000)}]}]});
    const query:ReadOnlyQuery=async statements=>Promise.all(statements.map(async statement=>(await pg.query<Record<string,unknown>>(statement.text,[...statement.params??[]])).rows));
    const read=await readCountyCivicContactInputs(query,"AZ");
    assert.ok(read.registration);assert.equal(read.registration.divisions.length,2);assert.equal(read.registration.bodies.length,1);
    const inventory=countyCivicProbeTargets(read.registration,read.votingSites,read.reviewedBodies);
    assert.deepEqual(inventory,{counties:2,targets:[{countyFips:"04013",address:"Public election office C"},{countyFips:"04019",address:"Public voting office"}]});
    assert.ok(Buffer.byteLength(JSON.stringify(read))<4000);assert.ok(!JSON.stringify(read).includes("unneeded-association-value"));
    await pg.query("UPDATE civic_data_candidates SET acquisition_succeeded=false WHERE record_class='REGISTRATION'");
    await assert.rejects(readCountyCivicContactInputs(query,"AZ"),/usable published pointer/);
  } finally {await pg.close();}
});
