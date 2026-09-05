import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { GET } from "../app/api/funding/[target]/route.ts";
import { campaignMoneyApiAnswer } from "../lib/funding/campaign-money.ts";
import { stateMoneySources } from "../lib/funding/state-snapshot.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";

test("every canonical state-finance target survives the real route, including long school-seat IDs", async () => {
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
    assert.deepEqual(await response.json(), campaignMoneyApiAnswer(target), target);
  }
});

test("funding route refuses malformed or excessive identifiers without guessing another person", async () => {
  for (const target of ["", "%XX", "x".repeat(513)]) {
    const response = await GET(new Request("http://localhost/api/funding/control"), { params: Promise.resolve({ target }) });
    assert.equal(response.status, 400);
  }
});
