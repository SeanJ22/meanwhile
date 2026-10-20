import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createPlannerSpool } from "../lib/control-plane/scheduler/planner-spool.ts";
import { duePackets,readAskedGaps,shutDoorsOf } from "../lib/hunt/runtime.ts";
import type { AskedGap,AskGapObservation } from "../lib/control-plane/ask-gap-observations.ts";

const NOW="2026-10-20T12:00:00Z",GOVERNMENT="ocd-division/country:us/state:nh/place:example";

test("a hunter reads only its government's own Ask gaps, including each body's suffix",async()=>{
  const repos=createMemoryRepositories();
  const values:AskGapObservation[]=[GOVERNMENT,`${GOVERNMENT}#board`,`${GOVERNMENT}neighbor#board`,"ocd-division/country:us/state:ca#board"].map(bodyId=>
    ({bodyId,code:"CALENDAR_STALE",recordClass:"MEETING",day:"2026-10-20",count:3}));
  for(const [n,value]of values.entries())await repos.askGapObservations.put(String(n),value,NOW);
  const noScan=async():Promise<never>=>{throw new Error("COUNTRY_SCAN");};
  const scoped={...repos,askGapObservations:{...repos.askGapObservations,list:noScan,listChangedSince:noScan},doors:{...repos.doors,list:noScan,listChangedSince:noScan}};
  assert.deepEqual((await readAskedGaps(scoped,NOW,GOVERNMENT)).map(gap=>gap.bodyId),[GOVERNMENT,`${GOVERNMENT}#board`]);
  await repos.doors.put("door",{doorId:"door",status:"SHUT",ocdId:GOVERNMENT,shutSince:NOW,shutReason:"source unavailable",hosts:["example.gov"]}as never,NOW);
  await repos.doors.put("unrelated",{doorId:"unrelated",status:"SHUT",ocdId:`${GOVERNMENT}neighbor`,shutSince:NOW,shutReason:"other",hosts:[]}as never,NOW);
  assert.deepEqual(await shutDoorsOf(scoped,GOVERNMENT),[{doorId:"door",shutSince:NOW,evidence:"source unavailable; it reads example.gov"}]);
});

test("country packet planning reads one government at a time and keeps every due decision on disk",async()=>{
  const repos=createMemoryRepositories(),planner=await createPlannerSpool();
  try{
    const count=300;let readCount=0,askedCount=0;
    const rows={*[Symbol.iterator](){for(let n=0;n<count;n++)yield{governmentId:`${GOVERNMENT}${n}`};}};
    const result=await duePackets(repos,rows,NOW,async(ids,_now,asked)=>{
      assert.equal(ids.length,1);assert.equal(asked?.length,1);assert.equal(asked![0]!.bodyId,ids[0]);readCount++;
      const governmentId=ids[0]!;
      return new Map([[governmentId,{governmentId,label:governmentId,held:[],blanks:[]}]]);
    },planner,async governmentId=>{askedCount++;return[{bodyId:governmentId,code:"CALENDAR_STALE",recordClass:"MEETING",asks:1,days:1,firstDay:"2026-10-20",lastDay:"2026-10-20"}]satisfies AskedGap[];});
    assert.equal(readCount,count);assert.equal(askedCount,count);assert.equal(result.size,count);
    assert.ok(result.get(`${GOVERNMENT}299`));assert.equal([...result.values()].length,count);
    assert.equal(result instanceof Map,false,"the production planner owns a repeatable disk-backed map");
  }finally{await planner.close();}
});
