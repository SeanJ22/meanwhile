import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "../app/api/funding/[target]/route.ts";
import { campaignMoneyApiAnswer } from "../lib/funding/campaign-money.ts";
import { readFundingSnapshot } from "../lib/funding/snapshot.ts";
import { stateMoneySources } from "../lib/funding/state-snapshot.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";

test("every canonical state-finance target survives the real route, including long school-seat IDs", async () => {
  // The parity helper's default intentionally asks both finance families.
  // Seed its explicit test fixture separately; the route below remains
  // target-scoped, as the planted-failure suite proves.
  await readFundingSnapshot();
  const ids = [...new Set(stateMoneySources().flatMap((file) => {
    const state = /^state-money-([a-z]{2})-/.exec(file)![1];
    const snapshot = JSON.parse(readFileSync(`data/states/${state}/funding/${file}`, "utf8")) as StateMoneySnapshot;
    return snapshot.records.flatMap((record) => record.targetKeys);
  }))];
  assert.ok(ids.length > 250);
  assert.ok(ids.some((id) => id.length > 128), "long canonical identity control disappeared");
  for (const target of ids) {
    const response = await GET(new Request("http://localhost/api/funding/control"), { params: Promise.resolve({ target: encodeURIComponent(target) }) });
    assert.equal(response.status, 200, target);
    const body = await response.json() as Record<string, unknown>;
    const { dataState, dataMetadata, holdingStatus, unavailableAuthorities, ...answer } = body;
    assert.deepEqual(answer, campaignMoneyApiAnswer(target), target);
    assert.equal(holdingStatus, "HELD", target);
    assert.deepEqual(unavailableAuthorities, [], target);
    assert.equal(dataState, "BOOTSTRAP", target);
    if (dataMetadata !== null) {
      assert.ok(["fec-open-api", "az-sos-campaign-finance", "nh-sos-campaign-finance", "nj-elec-campaign-finance"].includes((dataMetadata as { sourceId?: string }).sourceId ?? ""), target);
    }
    assert.equal(response.headers.get("cache-control"), "private, no-store", target);
  }
});

test("funding route refuses malformed or excessive identifiers without guessing another person", async () => {
  for (const target of ["", "%XX", "x".repeat(513)]) {
    const response = await GET(new Request("http://localhost/api/funding/control"), { params: Promise.resolve({ target }) });
    assert.equal(response.status, 400);
  }
});
