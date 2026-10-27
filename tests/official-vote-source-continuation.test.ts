import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { continueOfficialVoteDocument, oldestOfficialVoteObservation } from "../lib/state-rollcalls/source-continuation.ts";

const at="2026-10-26T12:00:00.000Z",later="2026-10-26T12:10:00.000Z",url="https://www.njleg.state.nj.us/api/votingRecords/member/1";
function harness(){
  const memory=new Map<string,string>(),cache=new CivicReadCache({read:async key=>memory.get(key)??null,write:async(key,value)=>{memory.set(key,value);}});
  const vault=new MemoryEvidenceStore();let reads=0;
  return{cache,vault,reads:()=>reads,read:async()=>{reads++;return{requestedUrl:url,finalUrl:url,httpStatus:200,bytes:new TextEncoder().encode("exact official response"),retrievedAt:at};}};
}
test("completed source bytes survive a deadline without inheriting the resumed run's date",async()=>{
  const h=harness(),controller=new AbortController();
  const input={...h,sourceId:"nj-legislature",parserVersion:"nj-legislature/2",context:"exact-index-and-roster",url,now:()=>later};
  await assert.rejects(continueOfficialVoteDocument({...input,signal:controller.signal,read:async()=>{
    const document=await h.read();controller.abort(Error("pass deadline"));return document;
  }}),/pass deadline/);
  const resumed=await continueOfficialVoteDocument({...input,signal:new AbortController().signal});
  assert.equal(h.reads(),1);assert.equal(resumed.retrievedAt,at);
  assert.equal(new TextDecoder().decode(resumed.bytes),"exact official response");
  assert.equal(oldestOfficialVoteObservation([resumed,{retrievedAt:later}]),at);
});
test("source index, parser and dependency changes invalidate only the saved input's context",async()=>{
  const h=harness(),input={...h,sourceId:"nh-general-court",parserVersion:"nh-general-court/3",context:"summary-a:roster-a",url,now:()=>later,signal:new AbortController().signal};
  await continueOfficialVoteDocument(input);await continueOfficialVoteDocument(input);assert.equal(h.reads(),1);
  await continueOfficialVoteDocument({...input,context:"summary-b:roster-a"});assert.equal(h.reads(),2);
  await continueOfficialVoteDocument({...input,context:"summary-b:roster-b"});assert.equal(h.reads(),3);
  await continueOfficialVoteDocument({...input,context:"summary-b:roster-b",parserVersion:"nh-general-court/4"});assert.equal(h.reads(),4);
});
test("expired or missing immutable bytes remain due, while a small index always checks the publisher",async()=>{
  const h=harness(),input={...h,sourceId:"nj-legislature",parserVersion:"nj-legislature/2",context:"index",url,now:()=>later,signal:new AbortController().signal};
  await continueOfficialVoteDocument(input);
  await continueOfficialVoteDocument({...input,now:()=>"2026-10-26T14:00:00.000Z"});assert.equal(h.reads(),2);
  await continueOfficialVoteDocument({...input,reuse:false});assert.equal(h.reads(),3);
  const damaged={...input,vault:{...h.vault,get:async()=>null,head:h.vault.head.bind(h.vault),put:h.vault.put.bind(h.vault),list:h.vault.list.bind(h.vault)}};
  await continueOfficialVoteDocument(damaged);assert.equal(h.reads(),4,"a missing capture is fetched instead of being trusted");
});
