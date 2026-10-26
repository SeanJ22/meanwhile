import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MemoryRoutineDataStore,type SlimRoster } from "../lib/civic-data/store.ts";
import { readBillSponsorPeople } from "../lib/sources/legiscan/people.ts";
import { bulkCandidate } from "../lib/sources/legiscan/publication.ts";
import { sessionSponsorEvidence,type Dataset } from "../lib/sources/legiscan/bills.ts";

const at="2026-10-12T12:00:00.000Z",scope="US-AK:openstates-people:v1";
const source=readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8"),native=JSON.parse(source).bill;
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const person={id:"held:ak:6033",name:"Carl Gatto",personId:"held:ak:6033",nativeIds:{legiscan:["6033"]},state:"AK",level:"STATE" as const,chamber:"lower",
  officeTitle:"State Representative",profileUrls:["https://www.akleg.gov/basis/Member/Detail/27?code=gat"],
  provenance:{sourceUrl:"https://www.akleg.gov/",sourceOrg:"Alaska Legislature",collectedAt:at,verifiedAt:at},
  memberships:[{id:"current",personId:"held:ak:6033",officeId:"US-AK:lower:13",jurisdiction:"US-AK",chamber:"lower",district:"13",current:true,sourceUrl:"https://www.akleg.gov/"}]};

test("bulk sponsor inputs use current slim source identities without opening held whole records",async()=>{
  const store=new MemoryRoutineDataStore(),selected:string[]=[];
  store.readPromotion=async()=>{throw Error("whole held projection");};
  store.readCandidate=async()=>{throw Error("whole held candidate");};
  store.readSlimRosters=async(recordClass,scopes)=>{
    selected.push(...scopes);
    return recordClass==="STATE_LEGISLATOR"&&scopes.includes(scope)?[{recordClass,scope,versionId:"native-roster",promotedAt:at,readModelSha256:hash("native-roster"),
      roster:{scope:"02",generatedAt:at,officeholders:[person],divisions:[],unmatched:[]}} as unknown as SlimRoster]:[];
  };
  const held=await readBillSponsorPeople(store,"AK");assert.equal(held.length,1);
  assert.equal(held[0].id,person.id);assert.deepEqual(held[0].nativeIds,person.nativeIds);
  assert.deepEqual(held[0].memberships,person.memberships);assert.deepEqual(held[0].profileUrls,person.profileUrls);
  assert.equal(held[0].provenance?.sourceUrl,person.provenance.sourceUrl);assert.ok(selected.includes(scope));
});

test("a bill part keeps sponsor authority without copying unrelated people fields",()=>{
  const dataset:Dataset={state_id:native.state_id,session_id:native.session_id,session_name:native.session.session_name,dataset_hash:hash(source),dataset_date:"2012-12-30"};
  const sessionSponsors=sessionSponsorEvidence([source]);
  const body=JSON.stringify({dataset,archiveHash:hash(source),parentRawHash:hash("parent"),partIndex:0,memberOffset:0,bodies:[source],sessionSponsors});
  const candidate=bulkCandidate({dataset,bodies:[source],people:[{...person,biography:"unrelated held biography",offices:[{address:"unrelated office book"}]} as typeof person],sessionSponsors,partIndex:0,archiveHash:hash(source),
    capture:{body,requestedUrl:"https://api.legiscan.com/?op=getDataset",finalUrl:"https://api.legiscan.com/?op=getDataset",httpStatus:200,retrievedAt:at,rawHash:hash(body)}});
  const held=(candidate.normalizedPayload as {people:Record<string,unknown>[]}).people[0];
  assert.equal(held.id,person.id);assert.deepEqual(held.nativeIds,person.nativeIds);
  assert.deepEqual(held.memberships,person.memberships);assert.deepEqual(held.profileUrls,person.profileUrls);
  assert.ok(!("biography"in held)&&!("offices"in held));
});
