import test from "node:test";
import assert from "node:assert/strict";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationSourceContentHash,registrationSourceProbe,registrationSourcesCover } from "../lib/registration/source-hash.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";
import type { RegistrationReadModel } from "../lib/registration/candidate.ts";

const at="2026-10-25T00:00:00.000Z",later="2026-10-26T00:00:00.000Z";
const release=(kind:string,sha256:string):KnownRelease=>({sourceId:"nces-ccd",releaseId:kind,requestedUrl:`https://nces.ed.gov/ccd/${kind}.zip`,
  finalUrl:`https://nces.ed.gov/ccd/${kind}.zip`,sha256,bytes:new Uint8Array([1]),httpStatus:200,retrievedAt:at,sourceObservedAt:at,
  checkedAt:at,lastCheckStatus:200,etag:null,lastModified:null,contentType:"application/zip",reused:false});
test("registration compares all independent source bytes and the local geography inputs before a held inventory",()=>{
  const receipt=heldRegistrationReceipt(),lea=release("lea-directory","a".repeat(64)),f33=release("f33","b".repeat(64));
  const input={referenceSha256:"c".repeat(64),receipt,schools:new Map([["lea-directory",lea],["f33",f33]]),complete:true};
  const first=registrationSourceContentHash(registrationSourceProbe(input));
  assert.equal(first,registrationSourceContentHash(registrationSourceProbe({...input,
    receipt:{...receipt,checkedAt:later,sourceCheck:{...receipt.sourceCheck!,checkedAt:later}},
    schools:new Map([["f33",{...f33,retrievedAt:later,checkedAt:later}],["lea-directory",{...lea,retrievedAt:later,checkedAt:later}]])})),
    "observation dates and acquisition ordering cannot move the source digest");
  assert.notEqual(first,registrationSourceContentHash(registrationSourceProbe({...input,schools:new Map([["lea-directory",{...lea,sha256:"d".repeat(64)}],["f33",f33]])})));
  assert.notEqual(first,registrationSourceContentHash(registrationSourceProbe({...input,referenceSha256:"e".repeat(64)})));
});
test("retained older and independently held registration evidence cannot refresh with a selected source set",()=>{
  const lea=release("lea-directory","a".repeat(64));
  const probe=registrationSourceProbe({referenceSha256:"c".repeat(64),receipt:heldRegistrationReceipt(),schools:new Map([["lea-directory",lea]]),complete:true});
  const provenance={sourceUrl:lea.requestedUrl,sourceOrg:"NCES",collectedAt:at,verifiedAt:null,rawHash:lea.sha256};
  const government={id:"government:US-AZ:nces:0400001",provenance};
  const model=(row:unknown)=>({governments:[row]}) as unknown as RegistrationReadModel;
  assert.equal(registrationSourcesCover(model(government),probe),true);
  assert.equal(registrationSourcesCover(model({...government,provenance:{...provenance,rawHash:"f".repeat(64)}}),probe),false,
    "a missing government carried from an older release keeps its original body and date");
  assert.equal(registrationSourcesCover(model({...government,additionalSources:[{...provenance,sourceUrl:"https://other.example.gov/directory"}]}),probe),false);
  assert.equal(registrationSourcesCover(model({...government,contactProvenance:{officePhone:{...provenance,rawHash:"f".repeat(64)}}}),probe),false);
  assert.equal(registrationSourcesCover(model({...government,govDomains:[{domain:"county.gov",website:"https://county.gov",sourceUrl:"https://get.gov/",checkedAt:at}]}),probe),false);
});
