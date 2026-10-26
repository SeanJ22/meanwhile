import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {PGlite} from "@electric-sql/pglite";
import {partitionCivicPayload} from "../lib/civic-data/payload-codec.ts";
import {canonicalCivicDataHash} from "../lib/civic-data/canonical-hash.ts";
import {readRegistryPlaceRows,selectRegistryPlaceView} from "../lib/civic-data/keyed-registry-place.ts";
import {readPlaceRegistry} from "../lib/civic-data/place-registry-read.ts";
import {projectHeldPlaceCapture} from "../lib/civic-data/held-place-projection.ts";
import {readRegistryPlanningRows} from "../lib/civic-data/keyed-registry-planning.ts";
import {readOwnershipLookup,readOwnershipWiring,readStateWiringRows} from "../lib/civic-data/keyed-government-lookup.ts";
import {heldSubjectDetails} from "../lib/control-plane/scheduler/providers/held-subject-enrichment.ts";
import {readHeldCommitteeIdentities} from "../lib/control-plane/scheduler/providers/held-subject-loader.ts";
import type {RegistryRuntimeReadModel} from "../lib/registry/runtime-data-plane.ts";
import {installFederalMoneyRows} from "./helpers/federal-money-rows.ts";

const AT="2026-10-20T07:00:00.000Z",STATE="ocd-division/country:us/state:az",DIVISION=`${STATE}/place:sample`,BODY=`${DIVISION}#governing`,SOURCE="https://sample.example.gov/council";

test("keyed planning preserves held facts, source aliases and state routes through updates, removals and rollback",async t=>{
  const pg=new PGlite();t.after(()=>pg.close());
  await pg.exec(`CREATE TABLE civic_data_promotions(key text PRIMARY KEY,record_class text,scope text,current_version_id text,last_known_good_version_id text,source_id text,promoted_at timestamptz,payload jsonb,validation_receipt jsonb);
    CREATE TABLE civic_data_candidates(id text PRIMARY KEY,record_class text,scope text,source_id text,state text,acquisition_succeeded boolean,promoted_version_id text,last_known_good_version_id text,normalized_hash text,candidate jsonb,validation_receipt jsonb);`);
  const runtime={registry:{generatedAt:AT,divisions:[{ocdId:STATE,label:"Arizona"},{ocdId:DIVISION,label:"Sample"}],bodies:[{
    id:BODY,ocdId:DIVISION,name:"Sample Council",bodyClass:"GOVERNING",homepageUrl:SOURCE,officePhone:"520-555-0100",provenance:{sourceUrl:SOURCE,collectedAt:AT}},
    {id:`${DIVISION}#committee`,ocdId:DIVISION,name:"Parks & Recreation Committee",bodyClass:"COMMITTEE",provenance:{sourceUrl:SOURCE,collectedAt:AT}}]},
    bodyRosters:[{bodyId:BODY,bodyName:"Sample Council",sourceUrl:SOURCE,sourceOrg:"Sample",collectedAt:AT,members:[{
      id:"sample-member",personId:"ocd-person/sample",name:"Ada Sample",officeTitle:"Council Member",email:"ada@example.gov",phone:"520-555-0111",membershipSource:{sourceUrl:`${SOURCE}/ada`,collectedAt:AT}}]}],
    rosterReaderDispositions:[{sourceId:"old-member",canonicalId:"sample-member",reason:"DUPLICATE"}],
    statewideExecutives:[{stateOcdId:STATE,sourceUrl:"https://az.gov/governor",sourceOrg:"Arizona",collectedAt:AT,holder:{id:"az-governor",name:"Held Governor",officeTitle:"Governor",phone:"520-555-0122"}}],
    officialCandidacies:{formatVersion:1,rule:"exact",rows:[{status:"NOT_CHECKED",holder:{id:"az-delegate",name:"Held Delegate",officeTitle:"Delegate",sourceUrl:"https://az.gov/delegate",divisions:[STATE],authority:"STATE_PEOPLE"}}]},
    officialPhotos:{photos:[{officeholderId:"sample-member",unused:"portrait".repeat(40_000)}]},rosterPhotos:{"sample-member":"unused"}} as unknown as RegistryRuntimeReadModel;
  let serial=0;
  const put=async(recordClass:string,scope:string,payload:unknown)=>{
    const id=`version-${++serial}`,hash=canonicalCivicDataHash(payload),encoded=partitionCivicPayload(payload),sourceId=`fixture:${recordClass}`;
    const receipt={decision:"GOOD",candidateId:id,recordClass,scope,sourceId};
    await pg.transaction(async tx=>{
      for(const part of encoded.parts)await tx.query("INSERT INTO civic_data_payload_parts VALUES($1,$2) ON CONFLICT DO NOTHING",[part.hash,JSON.stringify(part.payload)]);
      await tx.query("INSERT INTO civic_data_candidates VALUES($1,$2,$3,$4,'PROMOTED',true,$1,$1,$5,$6::jsonb,$7::jsonb)",[id,recordClass,scope,sourceId,hash,JSON.stringify({readModel:encoded.value,normalization:{normalizedHash:hash}}),JSON.stringify(receipt)]);
      await tx.query(`INSERT INTO civic_data_promotions VALUES($1,$2,$3,$4,$4,$5,$6,$7::jsonb,$8::jsonb)
        ON CONFLICT(key) DO UPDATE SET current_version_id=excluded.current_version_id,last_known_good_version_id=excluded.last_known_good_version_id,payload=excluded.payload,validation_receipt=excluded.validation_receipt`,
      [`${recordClass}:${scope}`,recordClass,scope,id,sourceId,AT,JSON.stringify(encoded.value),JSON.stringify(receipt)]);
    });
    return id;
  };
  await pg.exec("CREATE TABLE civic_data_payload_parts(hash text PRIMARY KEY,payload jsonb)");
  await put("REGISTRY_RUNTIME_BINDING","US-AZ:reader-registry-runtime",runtime);
  await installFederalMoneyRows(pg);
  await pg.exec(readFileSync(new URL("../lib/db/migrations/DB-05_lookup_rows.sql",import.meta.url),"utf8"));
  let bytes=0;let lastRows:Record<string,unknown>[]=[];
  const query=async(text:string,params:readonly unknown[]=[])=>{const rows=(await pg.query<Record<string,unknown>>(text,[...params])).rows;bytes+=JSON.stringify(rows).length;lastRows=rows;return rows;};
  const selected=await readRegistryPlanningRows(query,"AZ");
  assert.deepEqual(heldSubjectDetails(selected!,"AZ",AT),heldSubjectDetails(runtime,"AZ",AT),"every held body, contact and official keeps its enrichment result");
  assert.deepEqual(selected,{registry:runtime.registry,bodyRosters:runtime.bodyRosters,rosterReaderDispositions:runtime.rosterReaderDispositions,statewideExecutives:runtime.statewideExecutives,officialCandidacies:runtime.officialCandidacies});
  assert.ok(bytes<10_000,"reader portraits and the remaining carton do not leave the database");
  const oldRows=lastRows.filter(row=>row.kind!=="metadata");
  await put("REGISTRY_RUNTIME_BINDING","US-AZ:reader-registry-runtime",{...runtime,officialPhotos:{photos:[]}});
  assert.deepEqual(await readRegistryPlanningRows(query,"AZ"),selected);
  assert.deepEqual(lastRows.filter(row=>row.kind!=="metadata"),oldRows,"unchanged body rows have no changing pointer metadata, so the checked driver can reuse them");
  assert.deepEqual(await readHeldCommitteeIdentities(query,"AZ",["Parks & Recreation Committee"],[DIVISION],null),[{committeeId:`${DIVISION}#committee`,name:"Parks & Recreation Committee",url:SOURCE}]);
  assert.deepEqual((await pg.query("SELECT row_id,body_id,aliases FROM civic_data_rows WHERE collection='registry.rosterMembers'")).rows,[{row_id:"sample-member",body_id:BODY,aliases:["sample-member","ocd-person/sample"]}]);
  await put("REGISTRATION","US-AZ:registration:v1",{state:"AZ",vintage:{referenceSha256:"held-vintage"},bodies:[{id:BODY,jurisdictionId:"az:city:sample",geometry:"ignored".repeat(20_000)}],governments:[],divisions:[]});
  assert.deepEqual(await readOwnershipLookup(query,"AZ"),{registration:{bodies:[{id:BODY,jurisdictionId:"az:city:sample"}],vintage:{referenceSha256:"held-vintage"}},reviewedIds:[BODY,`${DIVISION}#committee`]});
  const own={id:"az-route",status:"SUSPENDED",suspension:{reason:"same held route"},row:{state:"US-AZ",bodyId:BODY,jurisdictionId:"az:city:sample",route:SOURCE,config:{nameTerms:"Council"}}};
  const wiring={kind:"meeting-source-wiring",formatVersion:1,records:[own,{id:"other-state",status:"ACTIVE",row:{state:"US-NH",bodyId:"nh-body",jurisdictionId:"nh:city:one",unused:"x".repeat(200_000)}}]};
  await put("CURATED_READER_RECORD","US:meeting-source-wiring",wiring);
  bytes=0;const routes=await readStateWiringRows(query,"US-AZ");
  assert.deepEqual(routes?.value,{kind:"meeting-source-wiring",formatVersion:1,records:[own]});
  assert.equal(routes?.input.readModelSha256,canonicalCivicDataHash(wiring),"a selected state still cites the complete immutable wiring source");
  assert.ok(bytes<2_000);
  assert.deepEqual((await readOwnershipWiring(query)).value?.records,[{row:{state:"US-AZ",bodyId:BODY,jurisdictionId:"az:city:sample"}},{row:{state:"US-NH",bodyId:"nh-body",jurisdictionId:"nh:city:one"}}]);
  const elsewhere=`${STATE}/place:elsewhere`;
  const placeRuntime={...runtime,registry:{...runtime.registry,divisions:[...runtime.registry.divisions,{...runtime.registry.divisions[0],ocdId:elsewhere,label:"Elsewhere",unusedGeometry:"q".repeat(200_000)}],
    bodies:[...runtime.registry.bodies,{...runtime.registry.bodies[0],id:`${elsewhere}#governing`,ocdId:elsewhere,evidence:"z".repeat(200_000)}]},
    bodyRosters:[...runtime.bodyRosters,{...runtime.bodyRosters[0],bodyId:`${elsewhere}#governing`,members:[{...runtime.bodyRosters[0].members[0],id:"foreign-member",biography:"b".repeat(200_000)}]}]};
  await put("REGISTRY_RUNTIME_BINDING","US-AZ:reader-registry-runtime",placeRuntime);
  bytes=0;const place=await readRegistryPlaceRows(query,"AZ",[DIVISION]);
  assert.deepEqual(place?.payload,selectRegistryPlaceView(placeRuntime,[DIVISION]));
  const keyedStore={readPromotion:async()=>{throw new Error("WHOLE_POINTER_FORBIDDEN");},readCandidate:async()=>{throw new Error("WHOLE_CANDIDATE_FORBIDDEN");},
    readRegistryPlaceView:async(state:string,ids:readonly string[])=>{assert.equal(state,"AZ");assert.deepEqual(ids,[DIVISION]);return place;}};
  const placeRead=await readPlaceRegistry("AZ",[DIVISION],{store:keyedStore});
  assert.equal(placeRead.metadata.versionId,place?.versionId);
  assert.deepEqual(placeRead.value,place?.payload,"the normal place reader uses the keyed adapter without any whole pointer/candidate callback");
  const metadata={recordClass:"REGISTRY_RUNTIME_BINDING" as const,scope:"US-AZ:reader-registry-runtime"};
  assert.deepEqual(projectHeldPlaceCapture([DIVISION],{kind:"PROMOTED",metadata,value:place!.payload},[],AT),
    projectHeldPlaceCapture([DIVISION],{kind:"PROMOTED",metadata,value:placeRuntime},[],AT),"selected-place subjects, held values and source clocks match the original complete registry");
  assert.ok(bytes<10_000,"other held governments, geometry and members never leave the store for this place");
  const before=(await pg.query("SELECT collection,row_id,value FROM civic_data_rows ORDER BY promotion_key,collection,ordinal")).rows;
  await assert.rejects(pg.transaction(async tx=>{await tx.query("UPDATE civic_data_promotions SET payload='{}'::jsonb WHERE record_class='REGISTRY_RUNTIME_BINDING'");throw new Error("ROLLBACK_LOOKUP_UPDATE");}),/ROLLBACK_LOOKUP_UPDATE/);
  assert.deepEqual((await pg.query("SELECT collection,row_id,value FROM civic_data_rows ORDER BY promotion_key,collection,ordinal")).rows,before,"pointer and keyed values roll back together");
  await put("REGISTRY_RUNTIME_BINDING","US-AZ:reader-registry-runtime",{...runtime,bodyRosters:[],statewideExecutives:[],officialCandidacies:{...runtime.officialCandidacies,rows:[]}});
  assert.equal((await pg.query<{n:number}>("SELECT count(*)::int AS n FROM civic_data_rows WHERE collection IN ('registry.rosterMembers','registry.executives','registry.candidacies')")).rows[0].n,0,"replacement removes only old collection members");
  await pg.query("DELETE FROM civic_data_promotions WHERE record_class='CURATED_READER_RECORD'");
  assert.equal(await readStateWiringRows(query,"AZ"),null,"deleted pointer leaves no routes");
});
