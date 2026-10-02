import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DEMAND_SIGNALS, DEMAND_SUBJECT_TYPES, writeDemandSignal } from "../lib/db/demand-signal.ts";
import { POST } from "../app/api/demand-signal/route.ts";

const input = {
  subjectType: "BODY" as const, subjectId: "body:water-board", signal: "WANT_THIS_SOONER" as const,
  ocdIds: ["ocd-division/country:us", "ocd-division/country:us/state:az"],
  marker: {runClass:"SYNTHETIC" as const,runId:"s6-demand-test"},
  batchId:"demand-batch",eventId:"demand-event",continuityKey:"browser-random",occurredAt:"2026-10-01T08:00:00Z",
  zip:"85701",question:"Email jane@example.com about the water board.",durationMs:950,residencyRelation:"HOME" as const,
};
test("body and candidate demand taps retain full scrubbed event context and all divisions without duplicate global counts", async()=>{
  assert.deepEqual([...DEMAND_SIGNALS],["WANT_THIS_SOONER"]);
  assert.deepEqual([...DEMAND_SUBJECT_TYPES],["BODY","CANDIDATE"]);
  const before=process.env.WTP_DB_ROLE;process.env.WTP_DB_ROLE="local";
  try {
    for(const subjectType of DEMAND_SUBJECT_TYPES){
      let history: Record<string, unknown> = {};
      let rows: {zip:string;district:string;topic:string;type:string;events:number;period:string;runClass:string}[]=[];
      const options={archive:{put:async(_key:string,bytes:Uint8Array)=>{history=JSON.parse(gunzipSync(bytes).toString());}},
        query:async(_sql:string,params:readonly unknown[])=>{rows=JSON.parse(String(params[4]));return [{recorded:true}];}};
      assert.equal(await writeDemandSignal({...input,subjectType},options),true);
      const event=(history.events as Record<string, unknown>[])[0]!;
      assert.equal(event.cardId,input.subjectId);assert.equal(event.cardKind,subjectType);
      assert.equal(event.reaction,"WANT_THIS_SOONER");assert.equal(event.durationMs,950);
      assert.equal(event.residencyRelation,"HOME");assert.equal(event.runClass,"SYNTHETIC");
      assert.equal(event.tester,true);assert.equal(event.occurredAt,"2026-10-01T08:00:00.000Z");
      assert.deepEqual(event.districtIds,input.ocdIds);
      assert.ok(!JSON.stringify(history).includes("jane@example.com"));
      assert.ok(!JSON.stringify(history).includes("browser-random"));
      const scoped=rows.filter(row=>row.period==="DAY"&&row.zip===""&&row.topic==="*"&&row.type==="*");
      assert.equal(scoped.find(row=>row.district==="")?.events,1);
      for(const id of input.ocdIds)assert.equal(scoped.find(row=>row.district===id)?.events,1);
    }
  }finally{if(before===undefined)delete process.env.WTP_DB_ROLE;else process.env.WTP_DB_ROLE=before;}
});
test("archive failure stops demand totals, and an undeclared demand cannot silently become organic",async()=>{
  const before=process.env.WTP_DB_ROLE;process.env.WTP_DB_ROLE="local";
  try{
    let queried=false;
    await assert.rejects(()=>writeDemandSignal(input,{archive:{put:async()=>{throw new Error("archive down");}},query:async()=>{queried=true;return [];}}),/archive down/);
    assert.equal(queried,false);
    await assert.rejects(()=>writeDemandSignal({...input,occurredAt:undefined}),/retry ids require occurredAt/);
    // @ts-expect-error Exercise the runtime declaration boundary.
    await assert.rejects(()=>writeDemandSignal({...input,marker:undefined}),/no run marker/);
  }finally{if(before===undefined)delete process.env.WTP_DB_ROLE;else process.env.WTP_DB_ROLE=before;}
});
test("malformed demand context refuses before source lookup or capture",async()=>{
  for(const context of [{zip:"8570"},{occurredAt:"yesterday"},{durationMs:-1},{question:17},{continuityKey:"contains spaces"}]){
    const response=await POST(new Request("https://localhost/api/demand-signal",{method:"POST",body:JSON.stringify({subjectType:"BODY",subjectId:"x",signal:"WANT_THIS_SOONER",...context})}));
    assert.equal(response.status,400);
  }
});
test("the confirmation follows successful capture and reports no total",()=>{
  const route=readFileSync("app/api/demand-signal/route.ts","utf8");
  assert.ok(!/export async function GET/.test(route));
  assert.ok(!/status: stored \? 204 : 202/.test(route));
  const pill=readFileSync("components/demand/demand-pill.tsx","utf8");
  assert.match(pill,/we&apos;ve noted it|we've noted it/);
});
