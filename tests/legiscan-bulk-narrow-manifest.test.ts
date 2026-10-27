import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { bulkManifestIssue, bulkProjectionIssue, publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import type { BillSession, Dataset } from "../lib/sources/legiscan/bills.ts";

const at="2026-10-12T12:00:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const body=readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8"),native=JSON.parse(body).bill;
const dataset:Dataset={state_id:native.state_id,session_id:native.session_id,session_name:native.session.session_name,dataset_hash:hash(body),dataset_date:"2012-12-30"};
const parent=JSON.stringify({dataset,archiveHash:hash(body),memberHashes:[hash(body)]});
const source={dataset,bodies:[body],people:[],archiveHash:hash(body),capture:{body:parent,requestedUrl:"https://api.legiscan.com/?op=getDataset",finalUrl:"https://api.legiscan.com/?op=getDataset",httpStatus:200,retrievedAt:at,rawHash:hash(parent)}};

test("a session proves its exact native members without reopening held bill bodies",async()=>{
  const store=new MemoryRoutineDataStore(),published=await publishBulkCandidate(store,source,at);
  assert.ok(published.outcome.promoted,JSON.stringify(published.outcome.candidate.receipt));
  const narrow=Object.create(store) as MemoryRoutineDataStore;
  narrow.readCandidate=async()=>{throw Error("whole held bill candidate read");};
  narrow.readPromotion=async()=>{throw Error("whole held bill projection read");};
  assert.equal(await bulkManifestIssue(published.candidate,narrow),null);
  const session=published.candidate.readModel as BillSession;
  const part=await store.readCandidate(session.parts[0].versionId);assert.ok(part);
  const forged=structuredClone(part.candidate),payload=forged.normalizedPayload as {partSourceMembers:{memberHashes:string[]}};
  payload.partSourceMembers.memberHashes[0]=hash("other source bytes");
  assert.match(bulkProjectionIssue(forged,forged.readModel)??"",/source-member summary/);
});

test("an interrupted part keeps its exact scope when only observation time advances",async()=>{
  const store=new MemoryRoutineDataStore(),first=await publishBulkCandidate(store,source,at);
  const later="2026-10-12T12:01:00.000Z";
  const second=await publishBulkCandidate(store,{...source,capture:{...source.capture,retrievedAt:later}},later);
  const parts=(candidate:typeof first.candidate)=>(candidate.readModel as BillSession).parts;
  assert.deepEqual(parts(second.candidate),parts(first.candidate));
});
