import assert from "node:assert/strict";
import test from "node:test";
import { CivicReadCache } from "../lib/db/civic-read-cache.ts";
import { planCampaignReadbacks } from "../lib/control-plane/campaign-readback-heads.ts";
import { SERVED_READER_MAX_AGE_MS, type ServedReaderReadback, type ServedReaderWitness } from "../lib/control-plane/served-reader.ts";

const now="2026-10-28T17:00:00.000Z";
const witness={itemId:"item",approvalId:"approval",versionId:"version-one",readerKey:"candidate",url:"https://example.org/ballot?zip=85635",checkedAt:now,
  responseSha256:"a".repeat(64),state:"CONFIRMED",reason:"Observed"} as ServedReaderWitness;
const memory=()=>{const rows=new Map<string,string>();return new CivicReadCache({read:async key=>rows.get(key)??null,write:async(key,value)=>{rows.set(key,value);}});};

test("unchanged empty campaign sources skip payload reads; a new fingerprint reopens the read",async()=>{
  const cache=memory();let fingerprint="one",queries=0;
  const query=async()=>{queries++;return [{state:"AZ",version:"version-one",fingerprint,valid:true}];};
  const first=await planCampaignReadbacks(["AZ"],now,null,{cache,query});
  assert.equal(first.carried("AZ"),null);
  first.record("AZ",{checkedAt:now,witnesses:[],errors:[]});await first.finish();
  const second=await planCampaignReadbacks(["AZ"],now,null,{cache,query});
  assert.deepEqual(second.carried("AZ")?.witnesses,[]);
  const before=queries;second.record("AZ",second.carried("AZ")!);await second.finish();
  assert.equal(queries,before,"unchanged sources need no confirmation read or rewritten checkpoint");
  fingerprint="two";
  assert.equal((await planCampaignReadbacks(["AZ"],now,null,{cache,query})).carried("AZ"),null);
});

test("unchanged confirmed witnesses retain the observation clock and expire at the existing deadline",async()=>{
  const cache=memory(),query=async()=>[{state:"AZ",version:"version-one",fingerprint:"one",valid:true}];
  const previous:ServedReaderReadback={checkedAt:now,witnesses:[witness],errors:[]};
  const first=await planCampaignReadbacks(["AZ"],now,null,{cache,query});first.record("AZ",previous);await first.finish();
  const later=new Date(Date.parse(now)+60_000).toISOString();
  const carried=(await planCampaignReadbacks(["AZ"],later,previous,{cache,query})).carried("AZ");
  assert.equal(carried?.witnesses[0].checkedAt,now);
  assert.equal((await planCampaignReadbacks(["AZ"],new Date(Date.parse(now)+SERVED_READER_MAX_AGE_MS+1).toISOString(),previous,{cache,query})).carried("AZ"),null);
  assert.equal((await planCampaignReadbacks(["AZ"],later,{...previous,witnesses:[{...witness,state:"NOT_OBSERVED"}]},{cache,query})).carried("AZ"),null);
});

test("a pointer moving during an empty read cannot label that result with the earlier fingerprint",async()=>{
  const cache=memory();let fingerprint="one";
  const query=async()=>[{state:"AZ",version:"version-one",fingerprint,valid:true}];
  const first=await planCampaignReadbacks(["AZ"],now,null,{cache,query});first.record("AZ",{checkedAt:now,witnesses:[],errors:[]});
  fingerprint="two";await first.finish();fingerprint="one";
  assert.equal((await planCampaignReadbacks(["AZ"],now,null,{cache,query})).carried("AZ"),null);
});
