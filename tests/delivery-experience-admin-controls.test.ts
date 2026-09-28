import assert from "node:assert/strict";
import test from "node:test";
import { actionSettled, scopeSendKey } from "../app/(admin)/_mw/scope-send-key.ts";

const input = { type: "zcta", geoid: "85635", version: "zcta:2020", priority: 1, budgetUsd: 10,
  huntBudget: true, newHunt: false, note: "Find the council", questions: ["WHO_REPRESENTS_ME"] };

test("a retry keeps one key but changing the budget period or starting a new hunt cannot replay the old action", () => {
  const original = scopeSendKey(input, "retry-nonce");
  assert.equal(scopeSendKey(input, "retry-nonce"), original);
  assert.notEqual(scopeSendKey({ ...input, huntBudget: false }, "retry-nonce"), original);
  assert.notEqual(scopeSendKey({ ...input, newHunt: true }, "retry-nonce"), original);
  assert.notEqual(scopeSendKey({ ...input, version: "zcta:2030" }, "retry-nonce"), original);
  assert.notEqual(scopeSendKey(input, "fresh-intent-nonce"), original);
});

test("only a definitive saved or refused action releases the retry nonce", () => {
  assert.equal(actionSettled("DONE"), true);
  assert.equal(actionSettled("REFUSED"), true);
  assert.equal(actionSettled("QUEUED"), false);
  assert.equal(actionSettled("IN_PROGRESS"), false);
  assert.equal(actionSettled("UNKNOWN"), false);
});
