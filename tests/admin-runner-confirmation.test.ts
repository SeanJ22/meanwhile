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
 * A click is not "done" until the runner says so: a pause is saved (waiting), the runner writes its
 * own honored record as `honorRunnerIntent` does, and only then does the same receipt read done.
 */

const T0 = "2026-09-30T18:00:00.000Z";
/** A minute after the saves below: an order that has just been saved is waiting, not overdue. */
const SOON = Date.parse(T0) + 60_000;
const clock = (from = T0) => {
  let ms = Date.parse(from);
  return () => {
    const at = new Date(ms).toISOString();
    ms += 1000;
    return at;
  };
};
const deps = (repos: ControlPlaneRepositories): GatewayDeps => ({ repos, now: clock(), currentStateVersion: null, codeSha: null });
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
  const before = await confirmReceipt(repos, out.receipt, SOON);
  assert.equal(before.state, "waiting");
  assert.match(before.words, /Waiting for the runner/);

  await runnerHonors(repos, out.receipt.subject, "PAUSE_RUNNER", "2026-09-30T18:00:30.000Z");
  const after = await confirmReceipt(repos, out.receipt, SOON);
  assert.equal(after.state, "applied");
  assert.equal(after.at, "2026-09-30T18:00:30.000Z");
  assert.match(after.words, /^Paused\./);
});

test("a record that honors a DIFFERENT intent does not confirm this one (the plant)", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("runner.pause", "pause-key-000002"), deps(repos));
  await runnerHonors(repos, "PAUSE_RUNNER:1999-01-01T00:00:00.000Z", "PAUSE_RUNNER", "2026-09-30T18:00:30.000Z");
  assert.equal((await confirmReceipt(repos, out.receipt, SOON)).state, "waiting");
});

test("a refused request and a console-only action need nothing from the runner", async () => {
  const repos = createMemoryRepositories();
  const refused = await submit(ask("runner.pause", "pause-key-000003", { note: "x".repeat(400) }), deps(repos));
  assert.equal(refused.ok, false);
  assert.equal((await confirmReceipt(repos, refused.receipt, SOON)).state, "not-needed");
  const readback = await submit(ask("fleet.requestReadback", "readback-key-0001", { subject: "runner" }), deps(repos));
  assert.equal((await confirmReceipt(repos, readback.receipt, SOON)).state, "not-needed");
});

test("a setting the runner reads at round start is waiting until a round starts after the save", async () => {
  const repos = createMemoryRepositories();
  const out = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-00001", { rollingCeilingUsd: 40 }), deps(repos));
  assert.equal(out.receipt.outcome, "DONE");
  assert.equal((await confirmReceipt(repos, out.receipt, SOON)).state, "waiting");
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
  await repos.runnerHeartbeat.put(RUNNER_ID, beat("2026-09-30T17:59:00.000Z"), T0);
  assert.equal((await confirmReceipt(repos, out.receipt, SOON)).state, "waiting", "a round that started BEFORE the save proves nothing");
  const held = await repos.runnerHeartbeat.read(RUNNER_ID);
  await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, held!.revision, beat("2026-09-30T19:00:00.000Z"), T0);
  assert.equal((await confirmReceipt(repos, out.receipt, SOON)).state, "applied");
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
  assert.equal((await confirmReceipt(broken, out.receipt, SOON)).state, "unread");
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
  assert.equal(followUpDelayMs(86), 60_000, "BR-02: no cutoff, the order keeps asking");
});

/* ------------------------------------------------------------------ a timed-out write is read back */

import { ControlPlaneRequestTimeout } from "@/lib/control-plane/repository/request-bounds.ts";
import { ADMIN_CONFIG_ID } from "@/lib/control-plane/gateway/admin-config.ts";

const timeout = () => new ControlPlaneRequestTimeout({ operation: "cp_admin_config.compare_and_set", callClass: "POINT", timeoutMs: 1000, kind: "REQUEST", budget: null });

/** A config store whose next compare-and-set times out: after applying it (landed) or before (not landed). */
function timingOut(repos: ControlPlaneRepositories, landed: boolean, readbackWorks = true): ControlPlaneRepositories {
  const real = repos.adminConfig;
  let armed = true;
  return {
    ...repos,
    adminConfig: {
      ...real,
      async compareAndSet(id, rev, next, now) {
        if (!armed) return real.compareAndSet(id, rev, next, now);
        armed = false;
        if (landed) await real.compareAndSet(id, rev, next, now);
        throw timeout();
      },
      async read(id) {
        if (!armed && !readbackWorks) throw new Error("read failed");
        return real.read(id);
      },
    },
  };
}

async function withCeiling(repos: ControlPlaneRepositories) {
  await submit(ask("config.setFleetSpendCeiling", "ceiling-key-seed01", { rollingCeilingUsd: 30 }), deps(repos));
}

test("a write that timed out AFTER it landed is reported as saved, because it was read back", async () => {
  const repos = createMemoryRepositories();
  await withCeiling(repos);
  const out = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-land01", { rollingCeilingUsd: 55 }), deps(timingOut(repos, true)));
  assert.equal(out.ok, true, out.receipt.says);
  assert.match(out.receipt.says, /Recorded: the Fleet spend ceiling is now \$55\.00/);
  assert.equal(((await repos.adminConfig.read(ADMIN_CONFIG_ID))!.value as { fleetSpendCeiling?: { rollingCeilingUsd?: number } }).fleetSpendCeiling?.rollingCeilingUsd, 55);
});

test("a write that timed out BEFORE it landed says it was not saved and is safe to send again", async () => {
  const repos = createMemoryRepositories();
  await withCeiling(repos);
  const out = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-lost01", { rollingCeilingUsd: 55 }), deps(timingOut(repos, false)));
  assert.equal(out.ok, false);
  assert.match(out.receipt.says, /was not saved: the store timed out, and reading it back shows the change is not there/);
  assert.match(out.receipt.says, /safe to send again/);
});

test("a timeout whose read-back also fails says it MAY have saved, never 'nothing was recorded'", async () => {
  const repos = createMemoryRepositories();
  await withCeiling(repos);
  const out = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-maybe1", { rollingCeilingUsd: 55 }), deps(timingOut(repos, true, false)));
  assert.equal(out.ok, false);
  assert.match(out.receipt.says, /may have been saved/);
  assert.doesNotMatch(out.receipt.says, /nothing was recorded/);
});

test("an intent append that timed out after landing is reported as queued, not as lost", async () => {
  const repos = createMemoryRepositories();
  const real = repos.researchIntents;
  const flaky: ControlPlaneRepositories = {
    ...repos,
    researchIntents: {
      ...real,
      async append(key, id, record, now) {
        await real.append(key, id, record, now);
        throw timeout();
      },
    },
  };
  const out = await submit(ask("runner.pause", "pause-key-timeout1"), deps(flaky));
  assert.equal(out.ok, true, out.receipt.says);
  assert.equal(out.receipt.outcome, "QUEUED");
  assert.equal((await real.read(RESEARCH_INTENT_LOG_KEY)).length, 1, "exactly one intent, not two");
});

test("paid research can be paused and resumed, and each is Done only when the runner honors it", async () => {
  const repos = createMemoryRepositories();
  const paused = await submit(ask("research.pause", "paid-pause-key-001"), deps(repos));
  const resumed = await submit(ask("research.resume", "paid-resume-key-01"), deps(repos));
  assert.equal(paused.ok && resumed.ok, true, resumed.receipt.says);
  assert.equal((await confirmReceipt(repos, resumed.receipt, SOON)).state, "waiting");
  await runnerHonors(repos, resumed.receipt.subject, "PAUSE", "2026-09-30T18:05:00.000Z");
  const done = await confirmReceipt(repos, resumed.receipt, SOON);
  assert.equal(done.state, "applied");
  assert.match(done.words, /Paid research resumed/);
  assert.equal((await confirmReceipt(repos, paused.receipt, SOON)).state, "waiting", "the pause is a different intent and is still waiting");
});

import { acceptedLine, orderStepsReached } from "../app/(admin)/_mw/admin-v6/receipts.ts";
import { orderPlan, orderProgress } from "../lib/control-plane/gateway/confirmation.ts";

test("BR-12: an order is Accepted with a plan, then a progress bar; the five steps and the one line", () => {
  const receipt = { type: "fleet.deployHere", label: "Send agents here", openedWork: [{ kind: "work", id: "a", title: "t" }, { kind: "work", id: "b", title: "t" }] };
  const plan = orderPlan(receipt, "2026-10-05T18:00:00Z");
  assert.deepEqual(plan, { who: "Runner", change: "Send agents here", affects: "Send agents here", creates: 2, resultsBy: "2026-10-05T18:00:00Z" });
  const line = acceptedLine({ plan, scopeName: "Sierra Vista", level: "local" }, () => "2:00 PM ET");
  assert.equal(line, "Accepted · Runner · creates 2 items in Sierra Vista · first results by 2:00 PM ET");
  const lifecycle = { saved: "x", workersReceived: null, workStarted: null, workFinished: null, factsChecked: null, published: null, checkedOnPublicPage: null };
  assert.equal(orderStepsReached({ status: "queued", plan: undefined, lifecycle }), 1, "received only");
  assert.equal(orderStepsReached({ status: "queued", plan: { ...plan, resultsBy: null }, lifecycle }), 2, "accepted with a plan");
  assert.equal(orderStepsReached({ status: "queued", plan, lifecycle }), 3, "scheduled for a round");
  assert.equal(orderStepsReached({ status: "running", plan, lifecycle }), 4);
  assert.equal(orderStepsReached({ status: "done", plan, lifecycle }), 5);
  assert.deepEqual(orderProgress(receipt, { state: "waiting" }), { done: 0, of: 2 });
  assert.deepEqual(orderProgress(receipt, { state: "applied" }), { done: 2, of: 2 });
  assert.deepEqual(orderProgress({ type: "config.setSetting", openedWork: [] }, { state: "applied" }), { done: 1, of: 1 });
  assert.deepEqual(orderProgress({ type: "expansion.scope.set", openedWork: [] }, { state: "applied" }), { done: null, of: null }, "no score held: shown as —");
});

import { notPickedUp } from "../lib/control-plane/gateway/confirmation.ts";
test("BR-02: a waiting order turns red with the reason when the runner is silent or a due round passed; fresh stays waiting", () => {
  const waiting = { state: "waiting" as const, at: null, words: "Saved. Waiting for the runner." };
  const receipt = { startedAt: "2026-10-05T10:00:00Z", completedAt: "2026-10-05T10:00:01Z" };
  const now = Date.parse("2026-10-05T12:00:00Z");
  const silent = notPickedUp(waiting, { beatAt: "2026-10-05T10:30:00Z", nextCycleDueAt: null }, receipt, now);
  assert.equal(silent.state, "not-picked-up");
  assert.match(silent.words, /The runner hasn't checked in since .*ET|The runner hasn't checked in since /);
  const passed = notPickedUp(waiting, { beatAt: "2026-10-05T11:59:00Z", nextCycleDueAt: "2026-10-05T11:30:00Z" }, receipt, now);
  assert.equal(passed.state, "not-picked-up");
  const fresh = notPickedUp(waiting, { beatAt: "2026-10-05T11:59:00Z", nextCycleDueAt: "2026-10-05T12:30:00Z" }, receipt, now);
  assert.equal(fresh.state, "waiting");
  assert.equal(notPickedUp(waiting, null, receipt, now).words, "The runner hasn't checked in yet.");
  assert.equal(notPickedUp(waiting, null, receipt, Date.parse("2026-10-05T10:05:00Z")).state, "waiting", "just saved, no beat yet");
});

import { doneWithChange } from "../app/(admin)/_mw/admin-v6/receipts.ts";
test("BR-13: a ceiling change finishes as Done with the before and after, kept on the saved receipt", async () => {
  const repos = createMemoryRepositories();
  const first = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-br13a", { rollingCeilingUsd: 50 }), deps(repos));
  assert.equal(first.ok, true);
  const out = await submit(ask("config.setFleetSpendCeiling", "ceiling-key-br13b", { rollingCeilingUsd: 80 }), deps(repos));
  assert.deepEqual(out.receipt.change, { before: "$50.00", after: "$80.00" });
  assert.equal(doneWithChange({ status: "done", change: out.receipt.change }), "Done · $50.00 → $80.00");
  assert.equal(doneWithChange({ status: "queued", change: out.receipt.change }), null);
});

import { oneSentence } from "../app/(admin)/_mw/admin-v6/receipts.ts";
test("BR-10: a receipt face is one plain sentence; the long words stay for Show details", () => {
  assert.equal(oneSentence("Paused. The runner stops at the end of its round. Nothing else changes."), "Paused.");
  assert.equal(oneSentence("Saved   with no stop"), "Saved with no stop");
  assert.ok(oneSentence(`${"word ".repeat(60)}.`).length <= 140);
});
