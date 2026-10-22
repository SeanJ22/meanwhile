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
