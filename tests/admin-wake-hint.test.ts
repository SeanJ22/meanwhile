/**
 * The "controls changed" wake hint never changes what an action did. After an
 * action is durably applied the shared writer overwrites one hint object; a hint
 * that fails or hangs leaves the action's result exactly as it was, a refusal
 * writes none, and replaying an applied action writes it again.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { WAKE_HINT_FORMAT, WAKE_HINT_KEY, wakeHintWriterFromEnv, type WakeHint } from "../lib/control-plane/gateway/wake-hint.ts";
import type { ActionRequest } from "../lib/control-plane/gateway/contract.ts";

const NOW = "2026-10-01T01:00:00.000Z";
const request = (key: string): ActionRequest => ({
  type: "runner.pause",
  subject: "runner",
  stateVersion: null,
  idempotencyKey: key,
  caller: "OWNER_SESSION",
  actorRef: "adm_test",
  input: {},
});
const deps = (wake: ((hint: WakeHint) => Promise<void>) | null) => ({
  repos: createMemoryRepositories(),
  now: () => NOW,
  currentStateVersion: null,
  codeSha: null,
  wake,
});

test("an applied action writes one hint carrying its receipt id and type", async () => {
  const seen: WakeHint[] = [];
  const outcome = await submit(request("wake-key-0001"), deps(async (h) => void seen.push(h)));
  assert.equal(outcome.ok, true, outcome.receipt.says);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].format, WAKE_HINT_FORMAT);
  assert.equal(seen[0].receiptId, outcome.receipt.receiptId);
  assert.equal(seen[0].actionType, "runner.pause");
});

test("a hint that throws leaves the action done, with the same receipt", async () => {
  const outcome = await submit(request("wake-key-0002"), deps(async () => {
    throw new Error("blobs down");
  }));
  assert.equal(outcome.ok, true, "the action must not turn into a refusal");
  assert.equal(outcome.receipt.refusal, null);
});

test("a hint that never answers does not hold the action past its timeout", async () => {
  const started = Date.now();
  const outcome = await submit(request("wake-key-0003"), deps(() => new Promise(() => {})));
  assert.equal(outcome.ok, true);
  assert.ok(Date.now() - started < 4_000, "the action waited on a hint that never answered");
});

test("a refusal writes no hint, and replaying an applied action writes it again", async () => {
  const seen: WakeHint[] = [];
  const d = deps(async (h) => void seen.push(h));
  const refused = await submit({ ...request("wake-key-0004"), type: "no.such.action" }, d);
  assert.equal(refused.ok, false);
  assert.equal(seen.length, 0);
  const first = await submit(request("wake-key-0005"), d);
  const again = await submit(request("wake-key-0005"), d);
  assert.equal(again.replayed, true);
  assert.equal(first.receipt.receiptId, again.receipt.receiptId);
  assert.equal(seen.length, 2, "a retry is how a missed hint is made up");
});

test("a host with no Blobs destination configured has no writer, and the key is the documented one", () => {
  assert.equal(wakeHintWriterFromEnv({}), null);
  assert.equal(wakeHintWriterFromEnv({ WTP_VAULT_PROVIDER: "netlify", WTP_BLOBS_SITE_ID: "site" }), null);
  assert.notEqual(wakeHintWriterFromEnv({ WTP_VAULT_PROVIDER: "netlify", WTP_BLOBS_SITE_ID: "site", WTP_BLOBS_TOKEN: "t" }), null);
  assert.equal(WAKE_HINT_KEY, "control/wake-hint.json");
});
