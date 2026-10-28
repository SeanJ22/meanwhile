import { directFundingTargetPlan, type FundingTargetPlan } from "../lib/funding/target-authorities.ts";
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  settleFundingHoldingAnswer,
} from "../lib/funding/holding-answer.ts";
import type { CivicDataReadMetadata } from "../lib/civic-data/read-model.ts";

type FundingHoldingReaders = NonNullable<Parameters<typeof settleFundingHoldingAnswer>[1]>;

const metadata = (recordClass: "FEC_FUNDING" | "STATE_CAMPAIGN_FINANCE", scope: string): CivicDataReadMetadata => ({
  recordClass,
  scope,
  sourceId: "test-source",
  version: "1",
  versionId: "test-version",
  lastKnownGoodVersionId: "test-version",
  sourceThrough: "2026-09-09",
  retrievedAt: "2026-09-09T00:00:00.000Z",
  promotedAt: "2026-09-09T00:00:00.000Z",
  stale: "CURRENT",
  staleAt: null,
});

function readers(plan: FundingTargetPlan, overrides: Partial<FundingHoldingReaders> = {}) {
  const calls: string[] = [];
  let selection: { federal: boolean; identity: boolean } | null = null;
  const value: FundingHoldingReaders = {
    identityPlan: async () => { calls.push("identity"); return plan; },
    federal: async () => { calls.push("federal"); return { kind: "PROMOTED", metadata: metadata("FEC_FUNDING", "US:2026") }; },
    ballotIdentity: async () => { calls.push("ballot-identity"); },
    answer: (_target, _contest, selected) => { selection = selected; return { kind: "none" }; },
    ...overrides,
  };
  return { calls, value, selected: () => selection };
}

test("direct target planning selects one exact state and never treats a state contest as federal", () => {
  assert.deepEqual(directFundingTargetPlan("ballot-nj-morris:county-commissioner:selen"), {
    contestId: "ballot-nj-morris:county-commissioner",
    federal: false,
    state: "NJ",
    ballotIdentity: false,
  });
  assert.deepEqual(directFundingTargetPlan("ballot-nh-merrimack:us-house-2:goodlander-maggie"), {
    contestId: "ballot-nh-merrimack:us-house-2",
    federal: true,
    state: null,
    ballotIdentity: false,
  });
});

test("a failed FEC holding stays unavailable without opening another financial source", async () => {
  const fixture=readers({contestId:"ballot-az:us-house-1",federal:true,state:null,ballotIdentity:false},{federal:async()=>{throw new Error("FEC unavailable");}});
  assert.equal((await settleFundingHoldingAnswer("congress:B001302",fixture.value)).kind,"HOLDING_UNAVAILABLE");
});

test("an identity failure preserves a direct federal source without attaching another person", async () => {
  const fixture=readers(directFundingTargetPlan("H0AZ01234"),{identityPlan:async()=>{throw new Error("Identity unavailable");}});
  const result=await settleFundingHoldingAnswer("H0AZ01234",fixture.value);
  assert.equal(result.kind,"ANSWER");
  if(result.kind!=="ANSWER")return;
  assert.equal(result.holdingStatus,"PARTIAL");assert.deepEqual(fixture.selected(),{federal:true,identity:false});
});

test("funding cards reuse their acquired source while another independent read checks the current holding",async()=>{
  let version="acquired-before",loads=0;
  const fixture=readers(directFundingTargetPlan("H0AZ01234"),{federal:async()=>{
    loads++;return {kind:"PROMOTED",metadata:{...metadata("FEC_FUNDING","US:2026"),versionId:version}};
  }});
  const acquired=fixture.value.federal();
  assert.equal((await acquired).metadata.versionId,"acquired-before");
  version="published-after";
  for(const target of ["H0AZ01234","H0AZ05678"]){
    const card=await settleFundingHoldingAnswer(target,fixture.value,{federal:acquired});
    assert.equal(card.kind,"ANSWER");
    if(card.kind==="ANSWER")assert.equal(card.dataMetadata?.versionId,"acquired-before");
  }
  assert.equal(loads,1,"cards do not reread an acquired source while composing the same ballot");
  const next=await settleFundingHoldingAnswer("H0AZ01234",fixture.value);
  assert.equal(next.kind,"ANSWER");
  if(next.kind==="ANSWER")assert.equal(next.dataMetadata?.versionId,"published-after");
  assert.equal(loads,2,"an independent read obtains the current source");
});

test("an acquired funding failure stays unavailable and an identity failure stays partial",async()=>{
  const fixture=readers(directFundingTargetPlan("H0AZ01234"),{federal:async()=>{throw new Error("Must use the acquired source");},
    identityPlan:async()=>{throw new Error("Identity unavailable");}});
  const acquired=Promise.resolve({kind:"PROMOTED" as const,metadata:metadata("FEC_FUNDING","US:2026")});
  const partial=await settleFundingHoldingAnswer("H0AZ01234",fixture.value,{federal:acquired});
  assert.equal(partial.kind,"ANSWER");
  if(partial.kind==="ANSWER"){
    assert.equal(partial.holdingStatus,"PARTIAL");assert.deepEqual(partial.unavailableAuthorities,["PERSON_IDENTITY"]);
  }
  const failed=Promise.reject(new Error("Acquired source unavailable"));
  void failed.catch(()=>undefined);
  const unavailable=await settleFundingHoldingAnswer("H0AZ01234",fixture.value,{federal:failed});
  assert.equal(unavailable.kind,"HOLDING_UNAVAILABLE");
  assert.ok(unavailable.unavailableAuthorities.includes("FEC_FUNDING"));
  assert.equal(fixture.calls.includes("federal"),false,"a failed acquired source never starts a replacement financial read");
});
