import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { partitionCivicPayload } from "../lib/civic-data/payload-codec.ts";
import type { ReadOnlyQuery } from "../lib/control-plane/admin-view/promoted-slices.ts";
import { readRegistryPlaceProjection } from "../lib/registry/place-read.ts";
import { insertPublishedSliceFixture,PUBLISHED_SLICE_FIXTURE_SCHEMA } from "./helpers/published-slice-fixture.ts";

test("a ZIP's registry read transfers only its selected governments and shared districts with original publication identity",async()=>{
  const pg=new PGlite(),state="ocd-division/country:us/state:az",own=`${state}/place:example_a`,outside=`${state}/place:outside`,shared="shared-district";
  const payload={formatVersion:1,registry:{generatedAt:"2026-10-20T10:00:00Z",divisions:[{ocdId:own,label:"Own place"},{ocdId:outside,label:"OUTSIDE_DIVISION"}],
    bodies:[{id:"own-body",ocdId:own,name:"Own body"},{id:shared,ocdId:outside,alsoServesOcdIds:[own],name:"Shared body"},{id:"outside-body",ocdId:outside,name:"OUTSIDE_BODY"}]},
    bodyRosters:[{bodyId:"own-body",members:[{id:"own-member",name:"Own member"}]},{bodyId:shared,members:[{id:"shared-member",name:"Shared member"}]},{bodyId:"outside-body",members:[{id:"outside-member",name:"OUTSIDE_MEMBER"}]}],
    rosterReaderDispositions:[{sourceId:"OUTSIDE_DISPOSITION"}],statewideExecutives:[{stateOcdId:state,holder:{id:"state-holder",name:"OUTSIDE_STATE_HOLDER"}}],
    officialCandidacies:{formatVersion:1,rule:"EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE",rows:[{holder:{id:"own-member",divisions:[own]},status:"NOT_CHECKED"},{holder:{id:"outside-member",divisions:[outside]},reason:"OUTSIDE_BRIDGE"}]},
    officialPhotos:{photos:[{officeholderId:"own-member",url:"UNNEEDED_PHOTO"}]},rosterPhotos:{"own-member":"UNNEEDED_ROSTER_PHOTO"}};
  const encoded=partitionCivicPayload(payload),transferred:unknown[]=[];
  const query:ReadOnlyQuery=async statements=>{const results=[];for(const statement of statements){const rows=(await pg.query<Record<string,unknown>>(statement.text,[...statement.params])).rows;transferred.push(rows);results.push(rows);}return results;};
  try{
    await pg.exec(PUBLISHED_SLICE_FIXTURE_SCHEMA);
    for(const part of encoded.parts)await pg.query("INSERT INTO civic_data_payload_parts VALUES($1,$2)",[part.hash,JSON.stringify(part.payload)]);
    await insertPublishedSliceFixture(pg,{id:"registry-v1",sourceId:"registry-reviewed-bindings",recordClass:"REGISTRY_RUNTIME_BINDING",scope:"US-AZ:reader-registry-runtime",readModel:payload,storedReadModel:encoded.value,at:"2026-10-20T11:00:00Z"});
    const read=await readRegistryPlaceProjection("AZ",[own],{},query);
    assert.equal(read.kind,"PROMOTED");assert.equal(read.metadata.versionId,"registry-v1");
    assert.deepEqual(read.value?.registry.bodies.map(body=>body.id),["own-body",shared]);
    assert.deepEqual(read.value?.bodyRosters.map(roster=>roster.bodyId),["own-body",shared]);
    assert.deepEqual(read.value?.registry.divisions.map(division=>division.ocdId),[own]);
    assert.equal(read.value?.officialCandidacies.rows.length,1);assert.equal(read.value?.statewideExecutives.length,0);
    assert.ok(!JSON.stringify(transferred).includes("OUTSIDE_"),"unselected state records never cross the database connection");
    assert.ok(!JSON.stringify(transferred).includes("UNNEEDED_"),"fields the ZIP plan never reads remain in the canonical state payload");
    await pg.query("UPDATE civic_data_promotions SET payload='{}'::jsonb");
    await assert.rejects(readRegistryPlaceProjection("AZ",[own],{},query),/POINTER_INVALID/);
    await assert.rejects(readRegistryPlaceProjection("AZ",["ocd-division/country:us/state:nh"],{},query),/STATE_MISMATCH/);
  }finally{await pg.close();}
});
