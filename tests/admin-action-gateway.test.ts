import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { NextRequest } from "next/server";

import { middleware } from "@/middleware.ts";
import { ADMIN_ORIGIN, PUBLIC_SITE_ORIGIN } from "@/lib/ops/origins.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";
import {
  ADMIN_RECEIPT_LOG_KEY,
  ALLOWED_BY_CALLER,
  AUTHORITY_CLASSES,
  authorityPermits,
  receiptIdFor,
  type ActionReceipt,
  type ActionRequest,
} from "@/lib/control-plane/gateway/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import {
  ACTION_TYPES,
  actionDefinitions,
  lookupAction,
  type GatewayDeps,
} from "@/lib/control-plane/gateway/registry.ts";
import { findReceipt, inputDigest, readReceipts } from "@/lib/control-plane/gateway/receipts.ts";
import {
  ADMIN_CONFIG_ID,
  defaultAdminConfig,
  type AdminConfig,
} from "@/lib/control-plane/gateway/admin-config.ts";
import { FLEET_SAFETY_BOUNDS, FLEET_SPEND_CEILING_MAX_USD } from "@/lib/control-plane/fleet-safety.ts";
import { AGENT_JOB_LOG_KEY, liveJobCount, type AgentJobRecord } from "@/lib/control-plane/gateway/agent-job.ts";
import { readPulse } from "@/lib/control-plane/gateway/pulse-read.ts";
import { DECISION_LOG_KEY, RUNNER_ID, SNAPSHOT_ID } from "@/lib/control-plane/admin-data.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY } from "@/lib/control-plane/owner-surface.ts";
import { RESEARCH_INTENT_LOG_KEY, readIntents } from "@/lib/control-plane/scheduler/research-policy.ts";
import { modelLaneClosure, pendingResearchLaneAcknowledgment } from "@/lib/control-plane/scheduler/model-lane.ts";
import { fixSubjectId } from "@/lib/control-plane/fix-queue.ts";
import { POST } from "@/app/api/admin/action/route.ts";
import { GET } from "@/app/api/admin/live/route.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

/** The typed Admin action gateway, run against `createMemoryRepositories()` with an injected clock. */

const NOW = "2026-09-06T12:00:00.000Z";

/** A clock that moves one second per call, so `startedAt` and `completedAt` differ. */
function tickingClock(from = NOW): () => string {
  let ms = Date.parse(from);
  return () => {
    const at = new Date(ms).toISOString();
    ms += 1000;
    return at;
  };
}

function deps(
  repos: ControlPlaneRepositories,
  over: Partial<GatewayDeps> = {},
): GatewayDeps {
  return {
    repos,
    now: tickingClock(),
    currentStateVersion: "world-1",
    codeSha: null,
    ...over,
  };
}

function ask(over: Partial<ActionRequest> = {}): ActionRequest {
  return {
    type: "queue.add",
    subject: "",
    input: { where: "the control centre", says: "Spend by day is not measured" },
    stateVersion: "world-1",
    idempotencyKey: "test-key-000001",
    caller: "OWNER_SESSION",
    actorRef: "adm_test-session",
    ...over,
  };
}

/* ==========================================================================
 * THE REGISTRY — every entry describes its behavior
 * ======================================================================= */

test("ADM-C6: every registry entry carries a full definition", () => {
  const definitions = actionDefinitions();
  assert.deepEqual([...ACTION_TYPES].sort(), ACTION_TYPES.slice().sort(), "types are listed once each");
  assert.equal(new Set(ACTION_TYPES).size, ACTION_TYPES.length, "no action type is declared twice");

  for (const definition of definitions) {
    assert.ok(
      (AUTHORITY_CLASSES as readonly string[]).includes(definition.authority),
      `${definition.type} resolves to no authority class, so it cannot fail closed`,
    );
    for (const field of ["label", "does", "doesNot", "subjectKind"] as const) {
      assert.ok(definition[field].trim().length > 0, `${definition.type} has no ${field}`);
    }
    assert.ok(
      definition.doesNot.length > 10,
      `${definition.type} does not say what it will NOT do, which is the sentence the owner needs`,
    );
    assert.ok(definition.refusals.length > 0, `${definition.type} claims it can never refuse`);
    // These strings are rendered.
    for (const field of ["label", "does", "doesNot"] as const) {
      assert.doesNotMatch(
        definition[field],
        /\b[A-Z][A-Z0-9]{2,}(_[A-Z0-9]+)+\b/,
        `${definition.type}'s ${field} carries a machine constant`,
      );
    }
    assert.equal(lookupAction(definition.type)?.definition.type, definition.type);
  }
});

test("ADM-C6: an action type that is not registered resolves to nothing, inherited members included", () => {
  // A registry backed by a plain object would answer `toString` with a function.
  for (const nonsense of ["toString", "constructor", "__proto__", "hasOwnProperty", "queue.remove", ""]) {
    assert.equal(lookupAction(nonsense), null, `${nonsense} resolved to something`);
  }
});

/* ==========================================================================
 * 1 · A PERMITTED ACTION SUCCEEDS, AND THE RECEIPT SAYS WHAT HAPPENED
 * ======================================================================= */

test("ADM-C6 acceptance 1: a permitted action succeeds and leaves a receipt that answers §3.7", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(ask(), deps(repos));

  assert.equal(outcome.ok, true, outcome.receipt.says);
  assert.equal(outcome.replayed, false);
  assert.equal(outcome.receipt.outcome, "QUEUED");
  assert.equal(outcome.receipt.refusal, null);

  const r = outcome.receipt;
  assert.equal(r.type, "queue.add", "what was done");
  assert.equal(r.authority, "REVERSIBLE_NONPRODUCTION", "under what authority");
  assert.equal(r.caller, "OWNER_SESSION", "who initiated it");
  assert.equal(r.actorRef, "adm_test-session", "and through which session");
  assert.equal(r.stateVersion, "world-1", "against which version of the world");
  assert.equal(r.inputDigest, inputDigest(ask().input), "the input, provably");
  assert.equal(r.startedAt, NOW);
  assert.ok(r.completedAt !== null && r.completedAt > r.startedAt, "started and completed are two instants");
  assert.equal(r.readBackAt, "/admin", "where the result can be read back");
  assert.ok((r.undo ?? "").length > 0, "and what would undo it");

  assert.equal(
    r.subject,
    fixSubjectId("the control centre", "Spend by day is not measured"),
    "the receipt names what was actually acted on",
  );

  assert.equal((await repos.ownerDecisions.read(DECISION_LOG_KEY)).length, 0, "the fix list no longer waits on a local script");
  const held = (await repos.adminConfig.mustRead("current")).value;
  assert.equal(held.fixList?.length, 1, "the queue add did not reach the fix list");
  assert.equal(held.fixList?.[0].state, "OPEN");

  const stored = await findReceipt(repos, receiptIdFor("queue.add", "test-key-000001"));
  assert.deepEqual(stored, r, "the receipt in the store is not the receipt that was returned");
});

test("ADM-C6: the receipt log holds no field the aggregate-only boundary refuses", async () => {
  const repos = createMemoryRepositories();
  await submit(ask(), deps(repos));
  const rows = await repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY);
  assert.equal(rows.length, 1);
  const keys = new Set(Object.keys(rows[0] as unknown as Record<string, unknown>));
  for (const forbidden of ["email", "sessionId", "session", "answerText", "freeText", "comment", "token"]) {
    assert.equal(keys.has(forbidden), false, `the receipt carries ${forbidden}`);
  }
  assert.ok(keys.has("actorRef"), "the session reference is carried under a name the boundary allows");
});

/* ==========================================================================
 * 2 · STALE REFUSAL
 * ======================================================================= */

test("ADM-C6 acceptance 2: an action rendered against a world that has moved is refused as stale", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(
    ask({ type: "decision.record", subject: "row-88", stateVersion: "world-1", input: { subjectId: "row-88", chosenOption: "Do it" } }),
    deps(repos, { currentStateVersion: "world-2" }),
  );

  assert.equal(outcome.ok, false);
  assert.equal(outcome.receipt.refusal, "STALE_STATE");
  assert.match(outcome.receipt.says, /out of date/i);
  assert.doesNotMatch(outcome.receipt.says, /STALE_STATE/, "the machine code does not lead the sentence");

  assert.deepEqual(await repos.ownerDecisions.read(DECISION_LOG_KEY), [], "a stale decision reached the log");
  assert.equal((await readReceipts(repos)).length, 1, "the refusal is the only record");
});

test("ADM-C6: an action that must quote a version and quotes none is INVALID, not stale", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(
    ask({ type: "decision.record", subject: "row-88", stateVersion: null, input: { subjectId: "row-88", chosenOption: "Do it" } }),
    deps(repos, { currentStateVersion: "world-2" }),
  );
  assert.equal(outcome.receipt.refusal, "INVALID_INPUT");
  assert.match(outcome.receipt.says, /which version of the page/i);

  const relaxed = await submit(
    ask({ stateVersion: null, idempotencyKey: "test-key-000002" }),
    deps(repos, { currentStateVersion: "world-2" }),
  );
  assert.equal(relaxed.ok, true, relaxed.receipt.says);
});

/* ==========================================================================
 * 3 · DUPLICATE SUBMISSION — one receipt, one state change
 * ======================================================================= */

test("ADM-C6 acceptance 3: a duplicate submission returns the same receipt and does not act twice", async () => {
  const repos = createMemoryRepositories();
  const request = ask({
    type: "runner.pause",
    subject: "pilot-runner",
    input: { note: "going to bed" },
    idempotencyKey: "pause-key-0001",
  });

  const first = await submit(request, deps(repos));
  assert.equal(first.ok, true, first.receipt.says);
  assert.equal(first.replayed, false);

  const second = await submit(request, deps(repos, { now: tickingClock("2026-09-06T18:00:00.000Z") }));
  assert.equal(second.replayed, true, "the second submission was not recognised as a replay");
  assert.deepEqual(second.receipt, first.receipt, "the replay returned a different receipt");
  assert.equal(second.receipt.startedAt, NOW, "the replay re-stamped the receipt with a later clock");

  // Asserted on the delegated log, not the gateway's own answer.
  const intents = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
  assert.equal(intents.length, 1, "the runner was told to pause twice");
  assert.equal((await readReceipts(repos)).length, 1, "the log holds two receipts for one action");
});

test("fleet.cancelDispatch takes back one sent instruction: the intent is saved, the send is no longer pending, and a bad id is refused", async () => {
  const repos = createMemoryRepositories();
  const sent = await submit(ask({ type: "fleet.deployHere", subject: "fleet", input: { note: "Deploy fleet to Arizona" }, idempotencyKey: "send-key-000001" }), deps(repos));
  assert.equal(sent.ok, true, sent.receipt.says);
  const dispatchId = sent.receipt.subject;
  assert.match(dispatchId, /^DISPATCH:/);
  assert.equal(readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).pendingDispatch.length, 1);
  const refused = await submit(ask({ type: "fleet.cancelDispatch", subject: "fleet", input: { intentId: "Deploy fleet to Arizona" }, idempotencyKey: "cancel-bad-0001" }), deps(repos));
  assert.equal(refused.ok, false);
  const cancelled = await submit(ask({ type: "fleet.cancelDispatch", subject: dispatchId, input: { intentId: dispatchId }, idempotencyKey: "cancel-key-00001" }), deps(repos));
  assert.equal(cancelled.ok, true, cancelled.receipt.says);
  assert.equal(cancelled.receipt.outcome, "QUEUED", "a request until the runner records that it stopped carrying it");
  const saved = readIntents(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY));
  assert.deepEqual([...saved.cancelledDispatch], [dispatchId]);
  assert.equal(saved.pendingDispatch.length, 0, "a cancelled send that no cycle has read yet is never read");
  assert.equal(saved.pendingCancel.length, 1);
});

test("research.pause records one versioned paid-lane intent and idempotent receipt without pausing the runner", async () => {
  const repos = createMemoryRepositories();
  const request = ask({ type: "research.pause", subject: "system", input: {}, idempotencyKey: "paid-pause-0001" });
  const first = await submit(request, deps(repos));
  assert.equal(first.ok, true, first.receipt.says);
  assert.equal(first.receipt.outcome, "QUEUED");
  assert.match(first.receipt.says, /paid research lane/i);
  const saved = await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY);
  assert.equal(saved.length, 1);
  assert.equal(saved[0]?.action, "PAUSE");
  assert.equal(saved[0]?.formatVersion, 1);
  assert.equal(readIntents(saved).paused, true);
  assert.equal(readIntents(saved).runnerPause.paused, false);
  const applied = readIntents(saved);
  const lane = modelLaneClosure({ dry: false, noModel: false,
    credentialConfigured: true, credentialVar: "ANTHROPIC_API_KEY",
    paused: applied.paused, pauseIntentId: applied.pauseIntentId,
    runnerPaused: applied.runnerPause.paused, runnerPauseIntentId: applied.runnerPause.intent?.intentId ?? null,
    unreadableControls: [] });
  assert.deepEqual(lane, { code: "PAUSED", reason: `paused by owner intent ${saved[0]?.intentId}` });
  const pending = pendingResearchLaneAcknowledgment(saved, lane);
  assert.equal(pending?.intent.intentId, saved[0]?.intentId);
  assert.equal(pending?.detail, "model lane closed for this cycle");
  const acknowledged = [...saved, { formatVersion: 1, kind: "HONORED" as const,
    intentId: `${pending?.intent.intentId}:honored`, honors: pending!.intent.intentId,
    action: "PAUSE" as const, honoredAt: NOW, honoredBy: "offline-test-cycle", detail: pending!.detail }];
  assert.equal(pendingResearchLaneAcknowledgment(acknowledged, lane), null, "the same pause is acknowledged once");
  const resumed = { ...pending!.intent, action: "RESUME" as const,
    intentId: "RESUME:2026-09-06T13:00:00.000Z", requestedAt: "2026-09-06T13:00:00.000Z" };
  assert.equal(pendingResearchLaneAcknowledgment([...acknowledged, resumed], null)?.detail, "model lane reopened");
  assert.match(pendingResearchLaneAcknowledgment([...acknowledged, resumed],
    { code: "LANE_DISABLED", reason: "no credential" })?.detail ?? "", /stays closed this cycle: no credential/);
  // The ordinary cycle, not the gateway, consumes this reading and acknowledges the intent once.
  const cycle = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(cycle, /const intents = readIntents\(intentLog\);/);
  assert.match(cycle, /const laneClosure = modelLaneClosure\(\{[\s\S]*?paused: intents\.paused,/);
  assert.match(cycle, /const modelLaneEnabled = laneClosure === null;/);
  assert.match(cycle, /if \(!modelLaneEnabled\) return \{ admit: false, code: laneDisabledCode/);
  assert.match(cycle, /pendingResearchLaneAcknowledgment\(intentLog, laneClosure\)/);
  assert.match(cycle, /honorIntent\(pendingAcknowledgment\.intent, pendingAcknowledgment\.detail\)/);

  const replay = await submit(request, deps(repos, { now: tickingClock("2026-09-06T18:00:00.000Z") }));
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.equal((await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).length, 1);
});

test("ADM-C6: two DIFFERENT actions sharing an idempotency key are two actions", async () => {
  // The receipt id is `<type>:<key>`, so the key is scoped to the action.
  const repos = createMemoryRepositories();
  const a = await submit(ask({ type: "runner.pause", input: {}, idempotencyKey: "shared-key-01" }), deps(repos));
  const b = await submit(ask({ type: "runner.resume", input: {}, idempotencyKey: "shared-key-01" }), deps(repos));
  assert.equal(a.ok, true, a.receipt.says);
  assert.equal(b.ok, true, b.receipt.says);
  assert.equal(b.replayed, false);
  assert.notEqual(a.receipt.receiptId, b.receipt.receiptId);
  assert.equal((await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).length, 2);
});

/* ==========================================================================
 * 5 · OWNER-GATED — an agent cannot decide for the owner
 * ======================================================================= */

test("ADM-C6 acceptance 5: an owner-gated action is refused for an AGENT caller", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(
    ask({
      type: "decision.record",
      subject: "row-42",
      input: { subjectId: "row-42", chosenOption: "Do it", consequenceShown: "the row closes" },
      idempotencyKey: "agent-key-0001",
      caller: "AGENT",
    }),
    deps(repos),
  );
  assert.equal(outcome.ok, false);
  assert.equal(outcome.receipt.refusal, "AUTHORITY_MISMATCH");
  assert.deepEqual(await repos.ownerDecisions.read(DECISION_LOG_KEY), [], "an agent recorded an owner decision");

  const owned = await submit(
    ask({
      type: "decision.record",
      subject: "row-42",
      input: { subjectId: "row-42", chosenOption: "Do it", consequenceShown: "the row closes" },
      idempotencyKey: "owner-key-0001",
      caller: "OWNER_SESSION",
    }),
    deps(repos),
  );
  assert.equal(owned.ok, true, owned.receipt.says);
  assert.equal((await repos.ownerDecisions.read(DECISION_LOG_KEY)).length, 1);
});

test("ADM-C6: the operator chat carries a button's authority for everything but an owner decision", async () => {
  const repos = createMemoryRepositories();
  const control = await submit(
    ask({ type: "runner.resume", subject: "pilot-runner", input: {}, idempotencyKey: "chat-key-00001", caller: "OPERATOR_CHAT" }),
    deps(repos),
  );
  assert.equal(control.ok, true, control.receipt.says);

  const decision = await submit(
    ask({ type: "decision.record", subject: "row-9", input: { subjectId: "row-9", chosenOption: "Do it" }, idempotencyKey: "chat-key-00002", caller: "OPERATOR_CHAT" }),
    deps(repos),
  );
  assert.equal(decision.receipt.refusal, "AUTHORITY_MISMATCH");
  assert.equal(authorityPermits("ANONYMOUS", "READ_ONLY"), false, "an unauthenticated caller holds nothing");
  assert.deepEqual(ALLOWED_BY_CALLER.ANONYMOUS, [], "and the ladder says so");
});

/* ==========================================================================
 * 6 · A REFUSAL WRITES A RECEIPT   ·   7 · UNKNOWN FAILS CLOSED
 * ======================================================================= */

test("ADM-C6 acceptance 6: a refusal is a first-class outcome with a durable receipt", async () => {
  const repos = createMemoryRepositories();
  await submit(ask({ type: "nothing.here", idempotencyKey: "refusal-key-01" }), deps(repos));
  await submit(ask({ type: "queue.add", input: { says: "" }, idempotencyKey: "refusal-key-03" }), deps(repos));
  await submit(ask({ stateVersion: "old", idempotencyKey: "refusal-key-04" }), deps(repos));
  await submit(
    ask({ type: "decision.record", input: { subjectId: "r", chosenOption: "x" }, idempotencyKey: "refusal-key-05", caller: "AGENT" }),
    deps(repos),
  );

  const rows = await readReceipts(repos);
  assert.equal(rows.length, 4, "a refusal went unrecorded");
  assert.deepEqual(
    rows.map((r) => r.refusal),
    ["UNKNOWN_ACTION", "INVALID_INPUT", "STALE_STATE", "AUTHORITY_MISMATCH"],
    "the refusals recorded are not the refusals produced",
  );
  for (const row of rows) {
    assert.equal(row.outcome, "REFUSED");
    assert.ok(row.says.trim().length > 0, `${row.type} refused without saying anything`);
    assert.doesNotMatch(row.says, /undefined|\[object/, `${row.type} refused with a broken sentence`);
  }
});

test("ADM-C6 acceptance 7: an unknown action fails closed and is recorded as one nobody may run", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(ask({ type: "shell.exec", subject: "rm -rf /", input: { cmd: "x" }, idempotencyKey: "unknown-key-01" }), deps(repos));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.receipt.refusal, "UNKNOWN_ACTION");
  assert.equal(outcome.receipt.authority, "PROHIBITED", "an unclassified action must not record itself as harmless");
  assert.match(outcome.receipt.says, /does not know this action/i);
  assert.equal((await readReceipts(repos)).length, 1);
});

test("ADM-C6: a request that is not shaped like an action writes nothing at all, and says so", async () => {
  // A malformed type/key pair cannot produce an addressable receipt id, so nothing is written.
  const repos = createMemoryRepositories();
  for (const bad of [
    ask({ type: "", idempotencyKey: "envelope-key-1" }),
    ask({ type: "a".repeat(200), idempotencyKey: "envelope-key-2" }),
    ask({ type: "queue.add", idempotencyKey: "" }),
    ask({ type: "queue.add", idempotencyKey: "short" }),
    ask({ type: "queue.add", idempotencyKey: "has a space in it" }),
  ]) {
    const outcome = await submit(bad, deps(repos));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.receipt.refusal, "INVALID_INPUT");
  }
  assert.deepEqual(await readReceipts(repos), [], "a record was written under an id nobody can address");
});

/* ==========================================================================
 * POSITIVE CONTROL
 * ======================================================================= */

test("ADM-C6 PLANT: a gateway that skipped the idempotency read would be caught here", async () => {
  // Blinding the idempotency read must make the delegated log move twice.
  const repos = createMemoryRepositories();
  const request = ask({ type: "runner.resume", subject: "pilot-runner", input: {}, idempotencyKey: "plant-key-0001" });
  await submit(request, deps(repos));
  assert.equal((await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).length, 1);

  const blind: ControlPlaneRepositories = {
    ...repos,
    adminReceipts: { ...repos.adminReceipts, read: async () => [] },
  };
  await submit(request, deps(blind, { now: tickingClock("2026-09-06T13:00:00.000Z") }));
  assert.equal(
    (await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)).length,
    2,
    "with the idempotency read blinded the work did NOT happen twice — the duplicate guard above is " +
      "therefore measuring the gateway's own answer rather than the delegated effect",
  );
});

test("ADM-C6: an unreadable receipt log stops the gateway rather than risking a double action", async () => {
  const repos = createMemoryRepositories();
  const broken: ControlPlaneRepositories = {
    ...repos,
    adminReceipts: {
      ...repos.adminReceipts,
      read: async () => {
        throw new Error("the store is not answering");
      },
    },
  };
  const outcome = await submit(ask({ type: "runner.pause", input: {}, idempotencyKey: "broken-key-001" }), deps(broken));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.receipt.refusal, "DOWNSTREAM_REFUSED");
  assert.match(outcome.receipt.says, /already happened/i);
  assert.deepEqual(await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY), [], "it acted without being able to check");
});

/* ==========================================================================
 * THE API FALLBACK TOGGLE
 * ======================================================================= */

test("§9A.22: paid API fallback defaults OFF, and reads OFF from a store nothing has written", async () => {
  const repos = createMemoryRepositories();
  assert.equal(defaultAdminConfig().apiFallback.enabled, false);
  assert.equal(defaultAdminConfig().apiFallback.decidedAt, null, "a default is not a decision");
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null, "a fresh store holds no policy");
});

test("§9A.22: turning paid API fallback on needs an explicit confirmation, and is recorded durably", async () => {
  const repos = createMemoryRepositories();

  const unconfirmed = await submit(
    ask({ type: "config.setApiFallback", subject: "paid API fallback", input: { enabled: "true" }, idempotencyKey: "fallback-key-01" }),
    deps(repos),
  );
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.receipt.refusal, "INVALID_INPUT");
  assert.match(unconfirmed.receipt.says, /explicit confirmation/i);
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null, "an unconfirmed request still wrote the policy");

  const on = await submit(
    ask({
      type: "config.setApiFallback",
      subject: "paid API fallback",
      input: { enabled: "true", confirmed: "true" },
      idempotencyKey: "fallback-key-02",
    }),
    deps(repos),
  );
  assert.equal(on.ok, true, on.receipt.says);
  const stored = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(stored?.value.apiFallback.enabled, true);
  assert.equal(stored?.value.apiFallback.decidedBy, "adm_test-session");
  assert.equal(
    stored?.value.apiFallback.receiptId,
    receiptIdFor("config.setApiFallback", "fallback-key-02"),
    "the policy does not point at the receipt that changed it",
  );
  assert.match(on.receipt.says, /does not switch anything on by itself/i);

  const off = await submit(
    ask({ type: "config.setApiFallback", subject: "paid API fallback", input: { enabled: "false" }, idempotencyKey: "fallback-key-03" }),
    deps(repos),
  );
  assert.equal(off.ok, true, off.receipt.says);
  const after = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(after?.value.apiFallback.enabled, false);
  assert.equal(after?.revision, 2, "the policy was replaced rather than updated in place");
});

test("§9A.22: a corrupt policy row reads as the default, which is OFF", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { nonsense: true } as unknown as AdminConfig, NOW);
  const outcome = await submit(
    ask({ type: "config.setApiFallback", subject: "paid API fallback", input: { enabled: "false" }, idempotencyKey: "fallback-key-04" }),
    deps(repos),
  );
  assert.equal(outcome.ok, true, outcome.receipt.says);
  const stored = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(stored?.value.apiFallback.enabled, false);
});

/* ==========================================================================
 * THE FLEET SPEND CEILING — the console dial for the rolling-24h model spend
 * ======================================================================= */

test("the Fleet spend ceiling is recorded durably, names who/when/previous, and its absence reads as the fallback", async () => {
  const repos = createMemoryRepositories();
  const fallback = FLEET_SAFETY_BOUNDS.rolling24HourModelUsd;
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null, "a fresh store carries no override");

  const first = await submit(
    ask({ type: "config.setFleetSpendCeiling", subject: "fleet spend ceiling", input: { rollingCeilingUsd: "250" }, idempotencyKey: "ceiling-key-01" }),
    deps(repos),
  );
  assert.equal(first.ok, true, first.receipt.says);
  const afterFirst = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(afterFirst?.value.fleetSpendCeiling?.rollingCeilingUsd, 250);
  assert.equal(afterFirst?.value.fleetSpendCeiling?.previousUsd, fallback, "the previous value with no prior override is the fallback");
  assert.equal(afterFirst?.value.fleetSpendCeiling?.decidedBy, "adm_test-session", "the record names who changed it");
  assert.equal(
    afterFirst?.value.fleetSpendCeiling?.receiptId,
    receiptIdFor("config.setFleetSpendCeiling", "ceiling-key-01"),
    "the override points at the receipt that changed it",
  );
  assert.equal(afterFirst?.value.apiFallback.enabled, false, "the ceiling write preserves the untouched apiFallback default");

  const second = await submit(
    ask({ type: "config.setFleetSpendCeiling", subject: "fleet spend ceiling", input: { rollingCeilingUsd: "400" }, idempotencyKey: "ceiling-key-02" }),
    deps(repos),
  );
  assert.equal(second.ok, true, second.receipt.says);
  assert.match(second.receipt.says, /was \$250\.00/, "the receipt names the previous ceiling");
  const afterSecond = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(afterSecond?.value.fleetSpendCeiling?.rollingCeilingUsd, 400);
  assert.equal(afterSecond?.value.fleetSpendCeiling?.previousUsd, 250, "the previous value is the prior override, not the fallback");
  assert.equal(afterSecond?.revision, 2, "the row was compare-and-set, not duplicated");
});

test("the Fleet spend ceiling refuses a non-number, a non-positive amount, and anything above the max, and writes nothing", async () => {
  const repos = createMemoryRepositories();
  for (const [raw, key] of [["abc", "ceiling-bad-01"], ["0", "ceiling-bad-02"], ["-5", "ceiling-bad-03"], [String(FLEET_SPEND_CEILING_MAX_USD + 1), "ceiling-bad-04"]] as const) {
    const outcome = await submit(
      ask({ type: "config.setFleetSpendCeiling", subject: "fleet spend ceiling", input: { rollingCeilingUsd: raw }, idempotencyKey: key }),
      deps(repos),
    );
    assert.equal(outcome.ok, false, `"${raw}" should be refused`);
    assert.equal(outcome.receipt.refusal, "INVALID_INPUT");
  }
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null, "no refused request wrote a policy row");
});

test("the Fleet spend ceiling rounds to whole cents and a corrupt policy row reads as the fallback previous", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { nonsense: true } as unknown as AdminConfig, NOW);
  const outcome = await submit(
    ask({ type: "config.setFleetSpendCeiling", subject: "fleet spend ceiling", input: { rollingCeilingUsd: "123.456" }, idempotencyKey: "ceiling-round-01" }),
    deps(repos),
  );
  assert.equal(outcome.ok, true, outcome.receipt.says);
  const stored = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(stored?.value.fleetSpendCeiling?.rollingCeilingUsd, 123.46, "a fraction of a cent is rounded away");
  assert.equal(stored?.value.fleetSpendCeiling?.previousUsd, FLEET_SAFETY_BOUNDS.rolling24HourModelUsd, "a corrupt prior row reads as the fallback, never as no ceiling");
});

/* ==========================================================================
 * THE PULSE
 * ======================================================================= */

test("ADM-34: the pulse names every read it could not make and renders none of them as zero", async () => {
  const repos = createMemoryRepositories();
  const pulse = await readPulse(repos, NOW);
  assert.equal(pulse.at, NOW);
  for (const [name, value] of Object.entries(pulse.counts)) {
    if (name === "agentJobsRunning") continue;
    assert.equal(value, null, `${name} reported a number from a store that holds nothing`);
  }
  assert.equal(pulse.counts.agentJobsRunning, 0, "an empty job log is a real answer: nothing is running");
  // The four snapshot-fed counts are named once, by the snapshot.
  assert.equal(pulse.unread.length, 3, `${pulse.unread.length} unread reading(s) were named, not three`);
  assert.ok(
    pulse.unread.some((name) => /control centre snapshot/.test(name)),
    "the snapshot the four counts come from is not named as unread",
  );
  assert.ok(pulse.unread.some((name) => /heartbeat/.test(name)));
  assert.ok(pulse.unread.some((name) => /research/.test(name)));
  for (const name of pulse.unread) {
    assert.doesNotMatch(name, /[A-Z][A-Z0-9_]{3,}/, `${name} is a machine constant on the face`);
  }
  assert.equal(pulse.runner.state, "NEVER_BEAT", "a store that answered is not an unread store");
});

test("ADM-34: the revision moves when the console's own record moves, and not otherwise", async () => {
  const repos = createMemoryRepositories();
  const before = await readPulse(repos, NOW);
  const again = await readPulse(repos, "2026-09-06T12:00:45.000Z");
  assert.equal(again.revision, before.revision, "the revision moved on the clock alone");

  await submit(ask({ idempotencyKey: "pulse-key-00001" }), deps(repos));
  const after = await readPulse(repos, NOW);
  assert.notEqual(after.revision, before.revision, "an action left the revision unchanged");

  await repos.researchIntents.append(RESEARCH_INTENT_LOG_KEY, "resume-pulse", {
    formatVersion: 1, kind: "INTENT", intentId: "resume-pulse", action: "RESUME",
    requestedAt: NOW, actor: "owner", adminSessionRef: "session", note: null,
  }, NOW);
  const afterResume = await readPulse(repos, NOW);
  assert.notEqual(afterResume.revision, after.revision, "a research request left the live page unchanged");
  await repos.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, "source-pulse-1", {
    formatVersion: 1, digestId: "source-pulse-1", writtenAt: NOW,
    headline: "Shared source progress", lines: [], cycleOk: null, testedSha: null,
  }, NOW);
  assert.notEqual((await readPulse(repos, NOW)).revision, afterResume.revision, "a source worker receipt left the live page unchanged");
});

test("ADM-34: the pulse makes no list() call — the reads it may not make are refused loudly", async () => {
  // Listing these would be a full table scan per open tab on every pulse.
  const repos = createMemoryRepositories();
  const refuse = (which: string) => async () => {
    throw new Error(`${which}.list() must not be called from the pulse`);
  };
  const guarded: ControlPlaneRepositories = {
    ...repos,
    attempts: { ...repos.attempts, list: refuse("attempts") },
    workItems: { ...repos.workItems, list: refuse("workItems") },
    routeTasks: { ...repos.routeTasks, list: refuse("routeTasks") },
    adminReceipts: {
      ...repos.adminReceipts,
      readAll: refuse("adminReceipts"),
    },
  };
  const pulse = await readPulse(guarded, NOW);
  assert.ok(pulse.revision.length > 0);
});

/* ==========================================================================
 * THE AGENT-JOB RECORD — reserved storage, minimal and honest
 * ======================================================================= */

test("ADM-C6: the agent-job log holds a job's progression without ever editing a record", async () => {
  const repos = createMemoryRepositories();
  const base: AgentJobRecord = {
    formatVersion: 1,
    jobId: "job-1",
    provider: "a delegated coding agent",
    mode: "review",
    status: "REQUESTED",
    subject: "wi-77",
    requestedAt: NOW,
    startedAt: null,
    completedAt: null,
    resultDigest: null,
    receiptId: "queue.add:test-key-000001",
    extra: {},
  };
  await repos.agentJobs.append(AGENT_JOB_LOG_KEY, "job-1:requested", base, NOW);
  await repos.agentJobs.append(AGENT_JOB_LOG_KEY, "job-1:running", { ...base, status: "RUNNING", startedAt: NOW }, NOW);
  const rows = await repos.agentJobs.read(AGENT_JOB_LOG_KEY);
  assert.equal(rows.length, 2, "the progression is a sequence, not a row that moved");
  assert.deepEqual(liveJobCount(rows), { running: 1, unreadable: 0 }, "one job is live");
  assert.deepEqual(
    liveJobCount([...rows, { ...base, status: "DONE", completedAt: NOW }]),
    { running: 0, unreadable: 0 },
    "a finished job is still counted as running",
  );
});

test("ADM-34: a delegated-job row this strip cannot read makes the count unknown, never zero", async () => {
  const repos = createMemoryRepositories();
  await repos.agentJobs.append(
    AGENT_JOB_LOG_KEY,
    "foreign-1",
    { jobId: "foreign-1", state: "RUNNING" } as unknown as AgentJobRecord,
    NOW,
  );
  assert.deepEqual(liveJobCount([{ jobId: "foreign-1", state: "RUNNING" }]), { running: 0, unreadable: 1 });
  const pulse = await readPulse(repos, NOW);
  assert.equal(pulse.counts.agentJobsRunning, null, "an unreadable row was counted as nothing running");
  assert.ok(
    pulse.unread.some((name) => /jobs are running for you/.test(name)),
    "the count the strip cannot make is not named",
  );
});

/* ==========================================================================
 * THE ROUTES — the security sequence, and one door for both shapes of caller
 * ======================================================================= */

function request(host: string, path: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): NextRequest {
  return new NextRequest(`https://${host}${path}`, {
    method: init.method ?? "GET",
    headers: { host, ...(init.headers ?? {}) },
    body: init.body,
  });
}

test("ADM-C6: both gateway routes are invisible on the public host and unreachable without a session", async () => {
  for (const path of ["/api/admin/action", "/api/admin/live"]) {
    const refused = await middleware(request(PUBLIC_HOST, path));
    assert.equal(refused.status, 404, `${path} answered on the public host`);
    const unauthenticated = await middleware(request(ADMIN_HOST, path));
    assert.equal(unauthenticated.status, 401, `${path} is reachable unauthenticated on the admin host`);
  }

  await withAdminSessionKey(async () => {
    const form = { "content-type": "application/x-www-form-urlencoded" };
    const body = "type=runner.pause";
    assert.equal(
      (await POST(request(PUBLIC_HOST, "/api/admin/action", { method: "POST", headers: { ...form, origin: ADMIN_ORIGIN, cookie: await adminSessionCookie() }, body }))).status,
      404,
      "the handler itself answers on the public host",
    );
    assert.equal(
      (await POST(request(ADMIN_HOST, "/api/admin/action", { method: "POST", headers: { ...form, origin: PUBLIC_SITE_ORIGIN, cookie: await adminSessionCookie() }, body }))).status,
      403,
      "a foreign origin is not refused",
    );
    assert.equal(
      (await POST(request(ADMIN_HOST, "/api/admin/action", { method: "POST", headers: { ...form, origin: ADMIN_ORIGIN }, body }))).status,
      401,
      "the handler does not re-verify the session",
    );
    assert.equal((await GET(request(PUBLIC_HOST, "/api/admin/live"))).status, 404);
    assert.equal((await GET(request(ADMIN_HOST, "/api/admin/live"))).status, 401);
  });
});

test("ADM-C6: neither route ever puts a connection string or a variable name in its body", async () => {
  // `openControlPlane` names the variable in its detail sentence; that must not reach a browser.
  await withAdminSessionKey(async () => {
    const before = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    try {
      const posted = await POST(
        request(ADMIN_HOST, "/api/admin/action", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            origin: ADMIN_ORIGIN,
            cookie: await adminSessionCookie(),
          },
          body: JSON.stringify({ type: "runner.pause", subject: "pilot-runner", input: {} }),
        }),
      );
      assert.equal(posted.status, 503, "a console with no store must not report success");
      const postedBody = await posted.text();
      assert.doesNotMatch(postedBody, /WTP_|postgres:|postgresql:/, "the response named the variable or the connection");
      assert.match(postedBody, /Nothing was recorded/);

      const pulsed = await GET(request(ADMIN_HOST, "/api/admin/live", { headers: { cookie: await adminSessionCookie() } }));
      assert.equal(pulsed.status, 200, "the pulse still answers when the store is unreachable");
      const pulse = (await pulsed.json()) as { revision: string; unread: string[]; counts: Record<string, number | null> };
      assert.equal(pulse.revision, "unread");
      assert.ok(pulse.unread.length > 0, "an unread pulse names nothing");
      for (const [name, value] of Object.entries(pulse.counts)) {
        assert.equal(value, null, `${name} reported a number from a store that was never opened`);
      }
      assert.doesNotMatch(JSON.stringify(pulse), /WTP_|postgres:/);
    } finally {
      if (before === undefined) delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
      else process.env.WTP_CONTROL_PLANE_DATABASE_URL = before;
    }
  });
});

test("ADM-C6: the route is one door — a no-JS form and a JSON fetch build the same request", async () => {
  const fromForm = inputDigest({ note: "deep dive on Illinois" });
  const fromJson = inputDigest({ note: "deep dive on Illinois" });
  assert.equal(fromForm, fromJson);
  assert.notEqual(fromForm, inputDigest({ note: "deep dive on Iowa" }));
  assert.match(fromForm, /^sha256-[0-9a-f]{64}$/, "the digest is not a content address");
  // Key order must not change the digest.
  assert.equal(inputDigest({ a: 1, b: 2 }), inputDigest({ b: 2, a: 1 }));
});

/* ==========================================================================
 * THE SNAPSHOT-FED COUNTS
 * ======================================================================= */

test("ADM-34: the counts come from the published snapshot, so the strip and the page agree", async () => {
  const repos = createMemoryRepositories();
  await repos.runnerHeartbeat.put(
    RUNNER_ID,
    {
      formatVersion: 1,
      beatAt: NOW,
      lastCycleStartedAt: NOW,
      lastCycleFinishedAt: NOW,
      nextCycleDueAt: "2026-09-06T12:20:00.000Z",
      lastCycleOk: true,
      testedSha: null,
      host: "a runner",
    },
    NOW,
  );
  await repos.ownerSnapshots.put(
    SNAPSHOT_ID,
    {
      formatVersion: 1,
      publishedAt: NOW,
      publishedFromSha: null,
      publisher: "the test",
      pilotGreen: true,
      contracts: [],
      decisionCards: [
        { rowId: "row-1" } as never,
        { rowId: "row-2" } as never,
      ],
      obligationsByState: [
        { state: "NJ", count: { value: 7, denominator: 7, contract: "obligations", denominatorSource: "the test" } },
        { state: "AZ", count: { value: 3, denominator: 3, contract: "obligations", denominatorSource: "the test" } },
      ],
      obligationsByProvider: [],
      freshnessDebtRows: { held: true, value: { value: 2, denominator: 10, contract: "debt", denominatorSource: "the test" } },
      incidents: [{ cause: "x", target: "y", obligationsAffected: 1, oldestHours: 2 }],
      costByRole: [],
      costByModel: [],
      cacheHitRateByCaller: [],
      deterministicShare: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
      costPerVerifiedRecord: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
      zipRows: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
      intakeFolder: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
      intakeItemsFound: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
      intakeItemsProcessed: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
      intakeUnidentifiable: { held: false, gap: { whose: "OURS", says: "not measured in this fixture" } },
    },
    NOW,
  );

  const pulse = await readPulse(repos, NOW);
  assert.equal(pulse.counts.obligations, 10, "obligations were not summed from the snapshot");
  assert.equal(pulse.counts.freshnessDebtRows, 2);
  assert.equal(pulse.counts.incidents, 1);
  assert.equal(pulse.counts.decisionsWaiting, null, "the old tracker's decision cards are not counted any more");
  assert.ok(!pulse.unread.some((w) => /decision/.test(w)), "and their absence is not reported as an unread count");
  assert.equal(pulse.runner.state, "ALIVE");
  assert.equal(pulse.runner.nextCycleDueAt, "2026-09-06T12:20:00.000Z");

  const decided = await submit(
    ask({
      type: "decision.record",
      subject: "row-1",
      input: { subjectId: "row-1", chosenOption: "Do it", consequenceShown: "the row closes" },
      idempotencyKey: "waiting-key-0001",
      stateVersion: null,
    }),
    deps(repos, { currentStateVersion: null }),
  );
  assert.equal(decided.ok, true, decided.receipt.says);
  assert.equal((await readPulse(repos, NOW)).counts.decisionsWaiting, null);
});

/* ==========================================================================
 * THE RECEIPT LOG IS ADDRESSED BY ONE KEY
 * ======================================================================= */

test("ADM-C6: every receipt lands under the one declared log key", async () => {
  const repos = createMemoryRepositories();
  await submit(ask({ idempotencyKey: "keyed-key-00001" }), deps(repos));
  await submit(ask({ type: "nope.nope", idempotencyKey: "keyed-key-00002" }), deps(repos));
  assert.deepEqual(await repos.adminReceipts.keys(), [ADMIN_RECEIPT_LOG_KEY], "receipts are spread across keys");
  const rows: readonly ActionReceipt[] = await repos.adminReceipts.read(ADMIN_RECEIPT_LOG_KEY);
  assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(row.formatVersion, 1);
});

test("a place target is recorded with its receipt, changed in place, refused when it is not 1 to 100, and cleared; the ceiling stays", async () => {
  const repos = createMemoryRepositories();
  const send = (key: string, goalPercent: unknown, placeKey = "geo:az.zcta.85635") =>
    submit(ask({ type: "config.setPlaceTarget", subject: placeKey, input: { placeKey, goalPercent }, idempotencyKey: key }), deps(repos));
  await submit(ask({ type: "config.setFleetSpendCeiling", subject: "fleet spend ceiling", input: { rollingCeilingUsd: "250" }, idempotencyKey: "ceiling-key-pt" }), deps(repos));

  const first = await send("target-key-01", "95");
  assert.equal(first.ok, true, first.receipt.says);
  const after = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.deepEqual(after?.value.placeTargets?.map((t) => [t.key, t.goalPercent, t.decidedBy, t.receiptId]),
    [["geo:az.zcta.85635", 95, "adm_test-session", receiptIdFor("config.setPlaceTarget", "target-key-01")]], "the target names who set it and the receipt");
  assert.equal(after?.value.fleetSpendCeiling?.rollingCeilingUsd, 250, "setting a target keeps the ceiling");
  assert.match(first.receipt.says, /now 95%/);

  const changed = await send("target-key-02", 90);
  assert.equal(changed.ok, true);
  assert.match(changed.receipt.says, /it was 95%/);
  assert.equal((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value.placeTargets?.length, 1, "one target per place");

  for (const [i, raw] of ["0", "101", "abc", -5].entries()) {
    const refused = await send(`target-bad-${i}`, raw);
    assert.equal(refused.ok, false, `${String(raw)} is not a target`);
  }
  const badKey = await send("target-bad-key", 90, "geo:az.zcta");
  assert.equal(badKey.ok, false, "only a real place can carry a target");

  const cleared = await send("target-key-03", null);
  assert.equal(cleared.ok, true);
  assert.deepEqual((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value.placeTargets, []);
});

test("a data switch is recorded with its receipt, changed in place, refused for an unknown number or audience, and keeps every other decision", async () => {
  const repos = createMemoryRepositories();
  const send = (key: string, input: Record<string, unknown>) =>
    submit(ask({ type: "config.setDataSwitch", subject: `${String(input.recipe)}@${String(input.audience)}`, input, idempotencyKey: key }), deps(repos));
  await submit(ask({ type: "config.setPlaceTarget", subject: "st:az", input: { placeKey: "st:az", goalPercent: 80 }, idempotencyKey: "target-key-ds" }), deps(repos));

  const on = await send("switch-key-001", { recipe: "word-cloud", audience: "customer:acme", on: true });
  assert.equal(on.ok, true, on.receipt.says);
  assert.match(on.receipt.says, /now on for customer acme \(it was off\)/);
  const after = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.deepEqual(after?.value.dataSwitches?.map((d) => [d.recipe, d.audience, d.on, d.decidedBy, d.receiptId]),
    [["word-cloud", "customer:acme", true, "adm_test-session", receiptIdFor("config.setDataSwitch", "switch-key-001")]], "the switch names who set it and the receipt");
  assert.equal(after?.value.placeTargets?.[0]?.goalPercent, 80, "a switch keeps the place target");

  const off = await send("switch-key-002", { recipe: "word-cloud", audience: "customer:acme", on: "off" });
  assert.equal(off.ok, true);
  assert.match(off.receipt.says, /now off for customer acme \(it was on\)/);
  assert.equal((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value.dataSwitches?.length, 1, "one entry per number and audience");

  const admin = await send("switch-key-003", { recipe: "topic-share", audience: "admin", on: false });
  assert.match(admin.receipt.says, /now off for Admin \(it was on\)/, "Admin defaults on, so turning it off says it was on");

  for (const [i, input] of [{ recipe: "nope", audience: "dashboard", on: true }, { recipe: "word-cloud", audience: "everyone", on: true }, { recipe: "word-cloud", audience: "dashboard" },
    { recipe: "word-cloud", audience: "customer:", on: true }, { recipe: "word-cloud", audience: "dashboard", on: "maybe" }].entries()) {
    assert.equal((await send(`switch-bad-${i}`, input)).ok, false, JSON.stringify(input));
  }
});
