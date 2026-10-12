import assert from "node:assert/strict";
import { test } from "node:test";

import {
  settleFundingHoldingAnswer,
  type FundingHoldingReaders,
} from "../app/api/funding/[target]/holdings.ts";
import { directFundingTargetPlan, type FundingTargetPlan } from "../lib/funding/target-authorities.ts";
import type { CivicDataReadMetadata } from "../lib/civic-data/read-model.ts";

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
  let selection: { federal: boolean; state: boolean; identity: boolean } | null = null;
  const value: FundingHoldingReaders = {
    identityPlan: async () => { calls.push("identity"); return plan; },
    federal: async () => { calls.push("federal"); return { kind: "PROMOTED", metadata: metadata("FEC_FUNDING", "US:2026") }; },
    state: async (state) => { calls.push(`state:${state}`); return { kind: "PROMOTED", metadata: metadata("STATE_CAMPAIGN_FINANCE", `${state}:2026`) }; },
    azIdentity: async () => { calls.push("az-identity"); },
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
    azIdentity: false,
  });
  assert.deepEqual(directFundingTargetPlan("ballot-nh-merrimack:us-house-2:goodlander-maggie"), {
    contestId: "ballot-nh-merrimack:us-house-2",
    federal: true,
    state: null,
    azIdentity: false,
  });
});

test("a failed federal holding cannot erase an independently held state answer", async () => {
  const fixture = readers({ contestId: "ballot-az-pima:governor", federal: true, state: "AZ", azIdentity: true }, {
    federal: async () => { throw new Error("planted FEC failure"); },
  });
  const result = await settleFundingHoldingAnswer("congress:B001302", fixture.value);
  assert.equal(result.kind, "ANSWER");
  if (result.kind !== "ANSWER") return;
  assert.equal(result.holdingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["FEC_FUNDING"]);
  assert.deepEqual(fixture.selected(), { federal: false, state: true, identity: true });
});

test("a failed state holding cannot erase an independently held federal answer", async () => {
  const fixture = readers({ contestId: "ballot-az-pima:governor", federal: true, state: "AZ", azIdentity: true }, {
    state: async () => { throw new Error("planted AZ finance failure"); },
  });
  const result = await settleFundingHoldingAnswer("congress:B001302", fixture.value);
  assert.equal(result.kind, "ANSWER");
  if (result.kind !== "ANSWER") return;
  assert.equal(result.holdingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["STATE_CAMPAIGN_FINANCE:AZ"]);
  assert.deepEqual(fixture.selected(), { federal: true, state: false, identity: true });
});

test("an NH target opens NH only and never touches AZ identity or another state", async () => {
  const fixture = readers({ contestId: "ballot-nh-merrimack:governor", federal: false, state: "NH", azIdentity: false });
  const result = await settleFundingHoldingAnswer("ballot-nh-merrimack:governor:ayotte-kelly", fixture.value);
  assert.equal(result.kind, "ANSWER");
  assert.deepEqual(fixture.calls, ["identity", "state:NH"]);
});

test("identity-store failure preserves a direct exact state holding but cannot attach another identity", async () => {
  const direct = directFundingTargetPlan("ballot-nj-morris:county-commissioner:selen");
  const fixture = readers(direct, {
    identityPlan: async () => { throw new Error("planted identity failure"); },
  });
  const result = await settleFundingHoldingAnswer("ballot-nj-morris:county-commissioner:selen", fixture.value);
  assert.equal(result.kind, "ANSWER");
  if (result.kind !== "ANSWER") return;
  assert.equal(result.holdingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["PERSON_IDENTITY"]);
  assert.deepEqual(fixture.selected(), { federal: false, state: true, identity: false });
});

test("all applicable finance authorities unavailable is explicit, never kind none", async () => {
  const fixture = readers({ contestId: "ballot-az-pima:governor", federal: true, state: "AZ", azIdentity: true }, {
    federal: async () => { throw new Error("planted FEC failure"); },
    state: async () => { throw new Error("planted state failure"); },
  });
  const result = await settleFundingHoldingAnswer("congress:B001302", fixture.value);
  assert.equal(result.kind, "HOLDING_UNAVAILABLE");
});
