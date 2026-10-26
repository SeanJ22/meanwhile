import test from "node:test";
import assert from "node:assert/strict";
import { heldRegistrationReceipt } from "../lib/registration/acquire.ts";
import { registrationSourceContentHash,registrationSourceProbe } from "../lib/registration/source-hash.ts";
import type { KnownRelease } from "../lib/sources/known-release.ts";

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
