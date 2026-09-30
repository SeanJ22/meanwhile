import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";
import type { ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { confirmReceipt } from "@/lib/control-plane/gateway/confirmation.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import type { GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
import { RUNNER_ID } from "@/lib/control-plane/admin-data.ts";
import { OWNER_SURFACE_FORMAT_VERSION, type RunnerHeartbeat } from "@/lib/control-plane/owner-surface.ts";
import { RESEARCH_FORMAT_VERSION, RESEARCH_INTENT_LOG_KEY } from "@/lib/control-plane/scheduler/research-policy.ts";
import { projectV6History, readV6History } from "@/lib/control-plane/admin-view/admin-v6-history.ts";
import { applyConfirmation, applyGatewayReply, startReceipt } from "../app/(admin)/_mw/admin-v6/receipts.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { followUpDelayMs, liveExecutor } from "../app/(admin)/_mw/admin-v6/executor.ts";
import { V6_CAPABILITY_VERSION, RECEIPT_LOOKUP_CONTRACT } from "../app/(admin)/_mw/admin-v6/contract.ts";

/**
 * **A CLICK IS NOT "DONE" UNTIL THE RUNNER SAYS SO.** (S11.)
 *
 * The whole loop, against the real gateway and the in-memory store: a pause is
 * saved (waiting), the runner writes its own honored record exactly as
 * `honorRunnerIntent` does, and only then does the same receipt read done. The
 * plant proves the check would fail on a pause the runner never saw.
 */

const T0 = "2026-09-30T18:00:00.000Z";
const clock = (from = T0) => {
  let ms = Date.parse(from);
  return () => {
    const at = new Date(ms).toISOString();
    ms += 1000;
    return at;
  };
};
const deps = (repos: ControlPlaneRepositories): GatewayDeps => ({ repos, now: clock(), currentStateVersion: null, codeSha: null, recordReview: null });
const ask = (type: string, key: string, input: Record<string, unknown> = {}): ActionRequest => ({
  type,
  subject: "",
  input,
  stateVersion: null,
  idempotencyKey: key,
  caller: "OWNER_SESSION",
  actorRef: "adm_test",
});

/** What the runner writes when it sees an owner intent (scripts/pilot-runner.mts honorRunnerIntent). */
async function runnerHonors(repos: ControlPlaneRepositories, intentId: string, action: "PAUSE_RUNNER" | "RESUME_RUNNER" | "PAUSE", at: string) {
  await repos.researchIntents.append(
    RESEARCH_INTENT_LOG_KEY,
    `${intentId}:honored`,
    {
      formatVersion: RESEARCH_FORMAT_VERSION,
      kind: "HONORED",
      intentId: `${intentId}:honored`,
      honors: intentId,
      action,
      honoredAt: at,
      honoredBy: "pilot-runner@test#1",
      detail: "idling on the owner pause",
    },
    at,
  );
}

test("a pause is waiting until the runner honors it, then done, on the same receipt", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("runner.pause", "pause-key-000001", { note: "testing" }), deps(repos));
  assert.equal(out.ok, true);
  assert.equal(out.receipt.outcome, "QUEUED");
  const before = await confirmReceipt(repos, out.receipt);
  assert.equal(before.state, "waiting");
  assert.match(before.words, /Waiting for the runner/);

  await runnerHonors(repos, out.receipt.subject, "PAUSE_RUNNER", "2026-09-30T18:00:30.000Z");
  const after = await confirmReceipt(repos, out.receipt);
  assert.equal(after.state, "applied");
  assert.equal(after.at, "2026-09-30T18:00:30.000Z");
  assert.match(after.words, /Paused\. The runner confirmed/);
});

test("a record that honors a DIFFERENT intent does not confirm this one (the plant)", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("runner.pause", "pause-key-000002"), deps(repos));
  await runnerHonors(repos, "PAUSE_RUNNER:1999-01-01T00:00:00.000Z", "PAUSE_RUNNER", "2026-09-30T18:00:30.000Z");
  assert.equal((await confirmReceipt(repos, out.receipt)).state, "waiting");
});

test("a refused request and a console-only action need nothing from the runner", async () => {
  const repos = createMemoryRepositories();
  const refused = await submit(ask("runner.pause", "pause-key-000003", { note: "x".repeat(400) }), deps(repos));
  assert.equal(refused.ok, false);
  assert.equal((await confirmReceipt(repos, refused.receipt)).state, "not-needed");
  const readback = await submit(ask("fleet.requestReadback", "readback-key-0001", { subject: "runner" }), deps(repos));
  assert.equal((await confirmReceipt(repos, readback.receipt)).state, "not-needed");
});

test("a setting the runner reads at round start is waiting until a round starts after the save", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-00001", { rollingCeilingUsd: 40 }), deps(repos));
  assert.equal(out.receipt.outcome, "DONE");
  assert.equal((await confirmReceipt(repos, out.receipt)).state, "waiting");
  const beat = (lastCycleStartedAt: string): RunnerHeartbeat => ({
    formatVersion: OWNER_SURFACE_FORMAT_VERSION,
    beatAt: lastCycleStartedAt,
    lastCycleStartedAt,
    lastCycleFinishedAt: lastCycleStartedAt,
    nextCycleDueAt: null,
    lastCycleOk: true,
    testedSha: null,
    host: "test",
  });
  await repos.runnerHeartbeat.put(RUNNER_ID, beat("2026-09-30T17:00:00.000Z"), T0);
  assert.equal((await confirmReceipt(repos, out.receipt)).state, "waiting", "a round that started BEFORE the save proves nothing");
  const held = await repos.runnerHeartbeat.read(RUNNER_ID);
  await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, held!.revision, beat("2026-09-30T19:00:00.000Z"), T0);
  assert.equal((await confirmReceipt(repos, out.receipt)).state, "applied");
});

test("a failing read is unread, never applied", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("runner.pause", "pause-key-000004"), deps(repos));
  const broken = {
    ...repos,
    researchIntents: {
      ...repos.researchIntents,
      readWhere: async () => {
        throw new Error("down");
      },
    },
  } as ControlPlaneRepositories;
  assert.equal((await confirmReceipt(broken, out.receipt)).state, "unread");
});

test("the v6 history shows a pause as done only once the runner honored it", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("runner.pause", "pause-key-000005"), deps(repos));
  const query = { scope: "us", asOf: T0 };
  assert.equal((await readV6History(repos, query)).data[0].status, "queued");
  await runnerHonors(repos, out.receipt.subject, "PAUSE_RUNNER", "2026-09-30T18:00:30.000Z");
  const done = (await readV6History(repos, query)).data[0];
  assert.equal(done.status, "done");
  assert.equal(done.statusWords, "Done");
  assert.equal(done.lifecycle.workersReceived, "2026-09-30T18:00:30.000Z");
  // A receipt read with no confirmation keeps its old honest words.
  assert.equal(projectV6History([out.receipt], query).data[0].status, "queued");
});

test("the screen receipt turns done only on the runner word, and a final state is never overwritten", () => {
  const def = actionDef("global-runner-pause");
  const sent = startReceipt({ key: "v6-k", def, target: "runner", targetName: "the standing runner", label: def.label, scopeKey: "us", scopeName: "United States", level: "global", at: T0, simulated: false });
  const queuedBody = { ok: true, replayed: false, receipt: { receiptId: "runner.pause:v6-k", outcome: "QUEUED", says: "asked", startedAt: T0, completedAt: T0, readBackAt: null } };
  const waiting = applyGatewayReply(sent, def, 200, { ...queuedBody, confirmation: { state: "waiting", at: null, words: "Saved. Waiting for the runner to confirm the pause." } }, T0);
  assert.equal(waiting.status, "queued");
  assert.match(waiting.says, /Waiting for the runner/);
  const done = applyConfirmation(waiting, { state: "applied", at: "2026-09-30T18:00:30.000Z", words: "Paused. The runner confirmed it." }, T0);
  assert.equal(done.status, "done");
  assert.equal(done.statusWords, "Done");
  assert.equal(applyConfirmation(done, { state: "waiting", at: null, words: "x" }, T0), done);
  // A replayed click that the runner already honored arrives done.
  const replay = applyGatewayReply(sent, def, 200, { ...queuedBody, replayed: true, confirmation: { state: "applied", at: T0, words: "Paused." } }, T0);
  assert.equal(replay.status, "done");
});

test("after a send the live executor keeps asking the receipt lookup, never resends, and stops when the runner confirms", async () => {
  const def = actionDef("global-runner-pause");
  const calls: { url: string; method: string }[] = [];
  let lookups = 0;
  const fetch = async (url: string, init: { method: string }) => {
    calls.push({ url, method: init.method });
    if (init.method === "POST") {
      return {
        status: 200,
        json: async () => ({
          ok: true,
          replayed: false,
          receipt: { receiptId: "runner.pause:v6-k", outcome: "QUEUED", says: "asked", startedAt: T0, completedAt: T0, readBackAt: null },
          confirmation: { state: "waiting", at: null, words: "Saved. Waiting." },
        }),
      };
    }
    lookups += 1;
    const applied = lookups >= 3;
    return {
      status: 200,
      json: async () => ({
        contract: RECEIPT_LOOKUP_CONTRACT,
        receipt: {},
        confirmation: applied ? { state: "applied", at: "2026-09-30T18:00:20.000Z", words: "Paused. The runner confirmed it." } : { state: "waiting", at: null, words: "Saved. Waiting." },
      }),
    };
  };
  const executor = liveExecutor({
    capabilities: () => ({ version: V6_CAPABILITY_VERSION, sections: {}, actions: {}, receiptLookup: { contract: RECEIPT_LOOKUP_CONTRACT, href: "/api/admin/v6/receipt" } }),
    fetch,
    now: () => T0,
    wait: async () => undefined,
  });
  const seen: string[] = [];
  const sent = startReceipt({ key: "v6-k", def, target: "runner", targetName: "the standing runner", label: def.label, scopeKey: "us", scopeName: "United States", level: "global", at: T0, simulated: false });
  await executor.send(sent, { def, target: "runner", scopeKey: "us", option: null, words: "", amount: "", selectedItems: [] }, (r) => seen.push(r.status));
  for (let i = 0; i < 40 && seen.at(-1) !== "done"; i += 1) await new Promise((r) => setImmediate(r));
  assert.equal(seen.at(-1), "done");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1, "the action is sent exactly once");
  assert.equal(lookups, 3, "asking stops as soon as it is confirmed");
  executor.dispose?.();
});

test("follow-up asks are quick at first and stop after about fifteen minutes", () => {
  assert.equal(followUpDelayMs(0), 3_000);
  assert.equal(followUpDelayMs(29), 3_000);
  assert.equal(followUpDelayMs(30), 15_000);
  assert.equal(followUpDelayMs(86), null);
});
