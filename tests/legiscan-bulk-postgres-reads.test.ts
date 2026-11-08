import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { neonConfig } from "@neondatabase/serverless";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";
import { bulkProjectionIssue,publishBulkCandidate } from "../lib/sources/legiscan/publication.ts";
import type { BillSession,Dataset } from "../lib/sources/legiscan/bills.ts";
import type { RoutineCandidate } from "../lib/civic-data/types.ts";
import { hydrateCandidateFacts } from "../lib/civic-data/candidate-vault.ts";

const at="2026-10-12T12:00:00.000Z",later="2026-10-12T12:01:00.000Z",revisedAt="2026-10-12T12:02:00.000Z";
const hash=(body:string)=>createHash("sha256").update(body).digest("hex");
const native=readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8"),bill=JSON.parse(native).bill;
const other=JSON.parse(native);other.bill.bill_id+=1000;
const nativeBodies=[native,JSON.stringify(other)];
const dataset:Dataset={state_id:bill.state_id,session_id:bill.session_id,session_name:bill.session.session_name,dataset_hash:hash(nativeBodies.join("")),dataset_date:"2012-12-30"};
function sourceFor(dataset:Dataset,bodies:string[],retrievedAt:string){
  const archiveHash=hash(bodies.join("")),body=JSON.stringify({dataset,archiveHash,memberHashes:bodies.map(hash)});
  return{dataset,bodies,people:[],archiveHash,capture:{body,requestedUrl:"https://api.legiscan.com/?op=getDataset",finalUrl:"https://api.legiscan.com/?op=getDataset",httpStatus:200,retrievedAt,rawHash:hash(body)}};
}
const source=sourceFor(dataset,nativeBodies,at);
function carriesNativeBill(value:unknown):boolean{
  if(typeof value==="string"){
    try{const parsed=JSON.parse(value);if(parsed&&typeof parsed==="object"&&parsed.bill?.bill_id)return true;
      return parsed!==value&&carriesNativeBill(parsed);}catch{return false;}
  }
  if(Array.isArray(value))return value.some(carriesNativeBill);
  return value!==null&&typeof value==="object"&&Object.values(value).some(carriesNativeBill);
}

test("Postgres publishes and reuses exact bill parts without downloading native source bytes to their writer",async context=>{
  await withMigratedRoutineStore("legiscan-bulk",async(store,vault,pg)=>{
    const transport=neonConfig.fetchFunction;assert.ok(transport);
    const statements:string[]=[],responses:{bytes:number;nativeBodies:boolean}[]=[];
    neonConfig.fetchFunction=(async(...args:Parameters<typeof transport>)=>{
      const request=JSON.parse(String((args[1] as RequestInit).body));
      statements.push(...(request.queries??[request]).map((statement:{query:string})=>statement.query));
      const response=await transport(...args),wire=await response.clone().text();
      responses.push({bytes:Buffer.byteLength(wire),nativeBodies:carriesNativeBill(JSON.parse(wire))});
      return response;
    }) as typeof transport;
    store.listPromotionScopes=async()=>{throw Error("legacy whole STATE_BILL family scope lookup");};
    let first:Awaited<ReturnType<typeof publishBulkCandidate>>,second:Awaited<ReturnType<typeof publishBulkCandidate>>,changed:Awaited<ReturnType<typeof publishBulkCandidate>>;
    try{
      first=await publishBulkCandidate(store,source,at);
      assert.ok(first.outcome.promoted,JSON.stringify(first.outcome.candidate.receipt));
      assert.equal(first.outcome.readerReadback?.status,"PASS");
      second=await publishBulkCandidate(store,{...source,capture:{...source.capture,retrievedAt:later}},later);
      assert.ok(second.outcome.promoted,JSON.stringify(second.outcome.candidate.receipt));
      assert.deepEqual((second.candidate.readModel as BillSession).parts,(first.candidate.readModel as BillSession).parts);
      const revision=JSON.parse(native);revision.bill.title="Publisher revised this native bill";
      const bodies=[JSON.stringify(revision),nativeBodies[1]],edition={...dataset,dataset_hash:hash(bodies.join("")),dataset_date:"2013-01-06"};
      changed=await publishBulkCandidate(store,sourceFor(edition,bodies,revisedAt),revisedAt);
      assert.ok(changed.outcome.promoted,JSON.stringify(changed.outcome.candidate.receipt));
      const oldParts=(first.candidate.readModel as BillSession).parts,nextParts=(changed.candidate.readModel as BillSession).parts;
      assert.notEqual(nextParts[0].versionId,oldParts[0].versionId,"actual changed native bytes publish a new group");
      assert.deepEqual(nextParts[1],oldParts[1],"the new archive attests the untouched group without republishing it");
    }finally{neonConfig.fetchFunction=transport;}
    assert.ok(statements.some(statement=>statement.includes("AS coupled")),"the changed session uses the exact same-snapshot publicationBase selector");
    assert.ok(statements.some(statement=>statement.includes("proof_coupled")),"the session consumes existing pointer/source proof equality as scalar metadata");
    assert.equal(responses.filter(response=>response.nativeBodies).length,0,"no native source bill body returns during publication, exact resume, or reuse in a changed archive");
    const bytes=responses.reduce((total,response)=>total+response.bytes,0);assert.ok(bytes>0);
    context.diagnostic(JSON.stringify({neonReadBytes:bytes,statements:statements.length,nativeBodyResponses:0}));
    // Inspect the local fixture directly after measuring transport. Original native source bytes
    // must still be held, and their ordinary source normalizer must reproduce the exact part.
    const pointer=(first!.candidate.readModel as BillSession).parts[0];
    const stored=(await pg.query<{candidate:RoutineCandidate}>("SELECT candidate FROM civic_data_candidates WHERE id=$1",[pointer.versionId])).rows[0].candidate;
    assert.equal(Object.hasOwn(stored.normalizedPayload as object,"capture"),false,"native bill evidence is held in the vault");
    const held=await hydrateCandidateFacts(vault,stored) as RoutineCandidate;
    assert.deepEqual(JSON.parse((held.normalizedPayload as {capture:{body:string}}).capture.body).bodies,[native]);
    assert.equal(bulkProjectionIssue(held,held.readModel),null);
    const partCount=(await pg.query<{parts:number}>("SELECT count(*)::integer AS parts FROM civic_data_candidates WHERE candidate#>>'{readModel,kind}'='PART'")).rows[0].parts;
    assert.equal(partCount,3,"two original groups plus the one changed native group are the only source parts created");
    const changedPointer=(changed!.candidate.readModel as BillSession).parts[0];
    const changedHeld=await hydrateCandidateFacts(vault,(await pg.query<{candidate:RoutineCandidate}>("SELECT candidate FROM civic_data_candidates WHERE id=$1",[changedPointer.versionId])).rows[0].candidate) as RoutineCandidate;
    assert.equal(bulkProjectionIssue(changedHeld,changedHeld.readModel),null);
    await assert.rejects(pg.query("UPDATE civic_data_candidates SET candidate=jsonb_set(candidate,'{vault,normalizedPayload,root}','\"rewritten source\"'::jsonb)WHERE id=$1",[pointer.versionId]),
      (error:unknown)=>(error as {code?:string}).code==="55000","the existing source evidence immutability trigger remains active");
  });
});
