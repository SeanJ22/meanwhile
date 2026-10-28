import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {neonConfig} from "@neondatabase/serverless";
import {withMigratedRoutineStore} from "./helpers/migrated-routine-store.ts";
import {publishBulkCandidate} from "../lib/sources/legiscan/publication.ts";
import {hydrateBillPart,normalizeSession,type BillSession,type Dataset,type HeldPerson} from "../lib/sources/legiscan/bills.ts";
import type {RoutineRecordClass} from "../lib/civic-data/types.ts";
import {readBillsForState} from "../lib/sources/legiscan/reader.ts";

const at="2026-10-26T12:00:00.000Z",hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const native=readFileSync(new URL("./fixtures/legiscan/bill/HB1.json",import.meta.url),"utf8"),raw=JSON.parse(native).bill;
const marker="UNRELATED_BILL_DESCRIPTION_",unrelated=JSON.parse(native);
unrelated.bill.bill_id++;unrelated.bill.bill_number="HB999";
unrelated.bill.title=marker;unrelated.bill.description=marker.repeat(8192);
unrelated.bill.sponsors=unrelated.bill.sponsors.filter((sponsor:{people_id:number})=>sponsor.people_id!==6033);
const bodies=[native,JSON.stringify(unrelated)],dataset:Dataset={state_id:raw.state_id,session_id:raw.session_id,
  session_name:raw.session.session_name,dataset_hash:hash(bodies.join("")),dataset_date:"2012-12-30"};
const person:HeldPerson={id:"held:ak:gatto",nativeIds:{legiscan:["6033"]}};
const archiveHash=hash(bodies.join("")),body=JSON.stringify({dataset,archiveHash,memberHashes:bodies.map(hash)});
const capture={body,requestedUrl:"https://api.legiscan.com/?op=getDataset",finalUrl:"https://api.legiscan.com/?op=getDataset",
  retrievedAt:at,httpStatus:200,rawHash:hash(body)};

test("a real Postgres person bill read selects exact native bills and complete co-sponsors before transfer",async context=>{
  await withMigratedRoutineStore("legiscan-bulk",async(store,_vault,pg)=>{
    await publishBulkCandidate(store,{capture:{...capture,requestedUrl:"https://api.legiscan.com/?op=getDatasetList",finalUrl:"https://api.legiscan.com/?op=getDatasetList",body:JSON.stringify({status:"OK",datasetlist:[dataset]}),
      rawHash:hash(JSON.stringify({status:"OK",datasetlist:[dataset]}))},datasets:[dataset]},at);
    const published=await publishBulkCandidate(store,{capture,dataset,bodies,people:[person],archiveHash},at);
    assert.ok(published.outcome.promoted);
    const part=normalizeSession(dataset,bodies,at,[person]),expected=hydrateBillPart(part,person);
    assert.equal(expected.length,1);assert.equal(expected[0].sponsors.length,raw.sponsors.length);
    const originalPromotion=store.readPromotion.bind(store),originalCandidate=store.readCandidate.bind(store);
    store.readPromotion=async<T,>(recordClass:RoutineRecordClass,scope:string)=>{assert.ok(!scope.includes(":part:"),"person reads do not fetch whole bill parts");return originalPromotion<T>(recordClass,scope);};
    store.readCandidate=async id=>{assert.ok(!((published.candidate.readModel as BillSession).parts.some(pointer=>pointer.versionId===id)),"person reads do not fetch source candidates");return originalCandidate(id);};
    const transport=neonConfig.fetchFunction;assert.ok(transport);const responses:string[]=[];
    neonConfig.fetchFunction=(async(...args:Parameters<typeof transport>)=>{
      const response=await transport(...args);responses.push(await response.clone().text());return response;
    }) as typeof transport;
    try{
      const read=await readBillsForState("AK",{store,now:at,person});
      assert.equal(read.complete,true,"coverage counts use full source cardinality, not the selected member's bill count");
      assert.deepEqual(read.bills,expected,"all bill fields, co-sponsors, source links and text provenance remain identical");
      const alias:HeldPerson={id:"held:alias",nativeIds:{"LegiScan API":["6033"]}};
      assert.deepEqual((await readBillsForState("AK",{store,now:at,person:alias})).bills,hydrateBillPart(part,alias));
      const seat:HeldPerson={id:"held:seat",name:"Carl Gatto",state:"AK",level:"STATE",chamber:"lower",
        memberships:[{id:"held:seat:membership",personId:"held:seat",officeId:"ak:lower:13",jurisdiction:"US-AK",sourceUrl:"https://legiscan.com/AK/people/carl-gatto/id/6033",current:true,district:"13",chamber:"lower"}]};
      assert.deepEqual((await readBillsForState("AK",{store,now:at,person:seat})).bills,hydrateBillPart(part,seat),"name/seat fallback retains the existing exact join");
      assert.deepEqual((await readBillsForState("AK",{store,now:at,person:{id:"held:unknown",nativeIds:{legiscan:["999999999"]}}})).bills,[]);
    }finally{neonConfig.fetchFunction=transport;}
    assert.equal(responses.some(response=>response.includes(marker)),false,"no unrelated public bill description crosses the connection");
    context.diagnostic(JSON.stringify({personReadBytes:responses.reduce((total,response)=>total+Buffer.byteLength(response),0),requests:responses.length,
      unrelatedDescriptionBytes:Buffer.byteLength(unrelated.bill.description)}));
    const pointer=(published.candidate.readModel as BillSession).parts[0];
    const detach="UPDATE civic_data_promotions SET payload=jsonb_set(payload,'{state}','\"WA\"'::jsonb) WHERE record_class='STATE_BILL' AND scope=$1";
    await assert.rejects(pg.query(detach,[pointer.scope]),(error:unknown)=>{
      const refusal=error as {code?:string;message?:string};
      return refusal.code==="23514" && refusal.message==="civic_data_promotions may only advance to a distinct, non-backdated version";
    },"the production trigger forbids detaching a published payload");
    // Flushing deferred events proves the independent exact-payload guard also
    // rejects this corruption. Transaction rollback restores the temporary DDL.
    await assert.rejects(pg.transaction(async tx=>{
      await tx.exec("ALTER TABLE civic_data_promotions DISABLE TRIGGER civic_data_promotions_no_delete_or_rewrite");
      await tx.query(detach,[pointer.scope]);
      await tx.exec("SET CONSTRAINTS ALL IMMEDIATE");
    }),(error:unknown)=>{
      const refusal=error as {code?:string;message?:string};
      return refusal.code==="23514" && refusal.message===`promotion STATE_BILL:${pointer.scope} is not the exact proof-consistent candidate payload, receipt, clock, and LKG`;
    },"the deferred exact-source guard independently rejects detached bytes");
    const enabled=await pg.query<{tgenabled:string}>("SELECT tgenabled FROM pg_trigger WHERE tgrelid='civic_data_promotions'::regclass AND tgname='civic_data_promotions_no_delete_or_rewrite'");
    assert.equal(enabled.rows[0]?.tgenabled,"O","rollback restores the immutable pointer guard before the reader runs");
    // Inject one detached SELECT snapshot in the private transport. The real SQL
    // still evaluates pointer/source coupling; no table or proof flag is changed.
    type Statement={query:string;params?:unknown[]};
    let injected=0;
    neonConfig.fetchFunction=(async(...args:Parameters<typeof transport>)=>{
      const init=args[1] as RequestInit,request=JSON.parse(String(init.body)) as Statement&{queries?:Statement[]};
      for(const statement of request.queries??[request])if(statement.query.includes("AS full_rows")){
        const parameter=`$${(statement.params?.length??0)+1}`;
        const source="FROM civic_data_rows r CROSS JOIN LATERAL";
        assert.ok(statement.query.includes(source));
        statement.query=statement.query.replace(source,`FROM (
          SELECT promotion_key,collection,content_hash,CASE WHEN promotion_key='STATE_BILL:'||${parameter}
            THEN jsonb_set(value,'{payload,state}','"WA"'::jsonb) ELSE value END AS value FROM civic_data_rows
        ) r CROSS JOIN LATERAL`);
        statement.params=[...statement.params??[],pointer.scope];injected++;
      }
      return transport(args[0],{...init,body:JSON.stringify(request)});
    }) as typeof transport;
    try{
      const faultPerson={...person,id:"held:fault-injection"};
      await assert.rejects(readBillsForState("AK",{store,now:at,person:faultPerson}),/READER_PUBLISHED_POINTER_INVALID/,
        "a selected view cannot attest a payload detached from its immutable source");
      assert.equal(injected,1,"only the exact person-part SELECT receives the local fault");
    }finally{neonConfig.fetchFunction=transport;}
  });
});
