import { applyHuntOrders } from "../lib/control-plane/hunt-orders.ts";
import assert from "node:assert/strict";
import test from "node:test";

import { receiptIdFor, type ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { lookupAction, type GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withFleetSpendCeiling, type AdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { expansionScopesOf } from "@/lib/control-plane/expansion/scopes.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";

const NOW = "2026-09-23T04:00:00.000Z";

function tickingClock(from = NOW): () => string {
  let ms = Date.parse(from);
  return () => {
    const at = new Date(ms).toISOString();
    ms += 1000;
    return at;
  };
}

function deps(repos: ControlPlaneRepositories): GatewayDeps {
  return { repos, now: tickingClock(), currentStateVersion: "world-1", codeSha: null };
}

const PIMA = { type: "county", geoid: "04019", version: "county:2020", label: "Pima County, Arizona", stateAbbr: "AZ" };

function setScope(input: Record<string, unknown>, key: string, over: Partial<ActionRequest> = {}): ActionRequest {
  return {
    type: "expansion.scope.set",
    subject: "Pima County, Arizona",
    input,
    stateVersion: null,
    idempotencyKey: key,
    caller: "OWNER_SESSION",
    actorRef: "adm_test-session",
    ...over,
  };
}

test("selecting a geography records it with priority, budget and provenance, and leaves every other decision alone", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(
    ADMIN_CONFIG_ID,
    withFleetSpendCeiling(defaultAdminConfig(NOW), { rollingCeilingUsd: 105, previousUsd: 100, decidedAt: NOW, decidedBy: "adm_x", receiptId: "r0" }),
    NOW,
  );
  const outcome = await submit(setScope({ geography: PIMA, priority: "1", budgetUsd: "5", note: "start here" }, "scope-key-0001"), deps(repos));
  assert.equal(outcome.ok, true, outcome.receipt.says);
  assert.equal(outcome.receipt.outcome, "DONE");
  assert.equal(outcome.receipt.subject, "county:2020/04019");
  assert.match(outcome.receipt.says, /priority 1 with a \$5\.00 rolling 24-hour budget/);
  assert.match(outcome.receipt.says, /Recording it makes no model call itself/);
  assert.match(outcome.receipt.says, /standing runner wakes promptly for this Send/);
  assert.match(outcome.receipt.says, /Fleet ceiling of \$105\.00 still binds first/);
  assert.equal(outcome.receipt.readBackAt, "/admin/work");

  const row = await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true});
  const scopes = expansionScopesOf(row?.value ?? null);
  assert.equal(scopes.malformed, 0);
  assert.equal(scopes.scopes.length, 1);
  const [scope] = scopes.scopes;
  assert.deepEqual(scope.geography, PIMA);
  assert.equal(scope.priority, 1);
  assert.equal(scope.budgetUsd, 5);
  assert.equal(scope.note, "start here");
  assert.equal(scope.decidedBy, "adm_test-session", "who, as a session reference, never a name");
  assert.equal(scope.receiptId, receiptIdFor("expansion.scope.set", "scope-key-0001"));
  assert.equal(scope.previous, null);
  assert.equal(row?.value.fleetSpendCeiling?.rollingCeilingUsd, 105, "the spend-ceiling dial is untouched");
  assert.equal(row?.value.apiFallback.enabled, false, "paid API fallback stays off");
  assert.equal(row?.revision, 1, "a place order does not rewrite current settings");

  const changed = await submit(setScope({ geography: PIMA, priority: 2, budgetUsd: 0 }, "scope-key-0002"), deps(repos));
  assert.equal(changed.ok, true, changed.receipt.says);
  assert.match(changed.receipt.says, /was priority 1 with \$5\.00/);
  assert.equal(changed.receipt.undo, "Set it back to priority 1 with $5.00.");
  const after = expansionScopesOf((await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}))?.value ?? null).scopes;
  assert.equal(after.length, 1, "an upsert on the same geography, never a second entry");
  assert.equal(after[0].budgetUsd, 0, "$0 is a real budget: no paid work there");
  assert.deepEqual(after[0].previous, { priority: 1, budgetUsd: 5 });
});

test("a budget above the Fleet ceiling is recorded and the receipt says the Fleet ceiling is the one that holds", async () => {
  const repos = createMemoryRepositories();
  const outcome = await submit(setScope({ ...PIMA, priority: 3, budgetUsd: 500 }, "scope-key-0003"), deps(repos));
  assert.equal(outcome.ok, true, outcome.receipt.says);
  assert.match(outcome.receipt.says, /above it, so the Fleet ceiling is the one that holds/);
  const [scope] = expansionScopesOf((await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}))?.value ?? null).scopes;
  assert.equal(scope.geography.geoid, "04019", "the flat form fields are accepted too");
});

test("a malformed selection is refused with the reason and writes nothing", async () => {
  const repos = createMemoryRepositories();
  const cases: [Record<string, unknown>, RegExp][] = [
    [{ geography: { ...PIMA, type: "place" }, priority: 1, budgetUsd: 1 }, /county, congressional district/],
    [{ geography: { ...PIMA, version: "cd:119" }, priority: 1, budgetUsd: 1 }, /plan version/],
    [{ geography: PIMA, priority: 0, budgetUsd: 1 }, /priority/],
    [{ geography: PIMA, priority: 1, budgetUsd: -1 }, /below \$0/],
    [{ geography: PIMA, priority: 1, budgetUsd: "" }, /dollar amount/],
    [{ geography: PIMA, priority: 1, budgetUsd: 1, note: "x".repeat(501) }, /note/],
  ];
  let n = 0;
  for (const [input, why] of cases) {
    n += 1;
    const outcome = await submit(setScope(input, `scope-bad-${String(n).padStart(4, "0")}`), deps(repos));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.receipt.refusal, "INVALID_INPUT");
    assert.match(outcome.receipt.says, why);
  }
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}), null, "no refused request wrote a policy row");
});

test("only the owner's own session may select or remove a scope; a chat or an agent is refused", async () => {
  const repos = createMemoryRepositories();
  for (const caller of ["AGENT", "OPERATOR_CHAT", "ANONYMOUS"] as const) {
    const outcome = await submit(setScope({ geography: PIMA, priority: 1, budgetUsd: 1 }, `scope-auth-${caller}`, { caller }), deps(repos));
    assert.equal(outcome.ok, false, `${caller} must not set a scope`);
    assert.equal(outcome.receipt.refusal, "AUTHORITY_MISMATCH");
  }
  assert.equal(lookupAction("expansion.scope.set")?.definition.authority, "OWNER_DECISION_REQUIRED");
  assert.equal(lookupAction("expansion.scope.remove")?.definition.authority, "OWNER_DECISION_REQUIRED");
  assert.equal(lookupAction("expansion.scope.set")?.definition.requiresStateVersion, false, "the row's compare-and-set is the version check");
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}), null);
});

test("removing a scope takes it off the list, and removing one that is not there changes nothing", async () => {
  const repos = createMemoryRepositories();
  await submit(setScope({ geography: PIMA, priority: 1, budgetUsd: 2 }, "scope-rm-0001"), deps(repos));
  await submit(
    setScope({ geography: { type: "congressional_district", geoid: "0406", version: "cd:119", label: "AZ-6", stateAbbr: "AZ" }, priority: 2, budgetUsd: 1 }, "scope-rm-0002"),
    deps(repos),
  );
  const remove = (key: string, idem: string) =>
    submit({ type: "expansion.scope.remove", subject: key, input: { key }, stateVersion: null, idempotencyKey: idem, caller: "OWNER_SESSION", actorRef: "adm_test-session" }, deps(repos));

  const removed = await remove("county:2020/04019", "scope-rm-0003");
  assert.equal(removed.ok, true, removed.receipt.says);
  assert.match(removed.receipt.says, /Stop requested/);
  assert.equal((await repos.huntOrders.pending("az")).length,1);
  await applyHuntOrders(repos,"az",NOW);
  assert.deepEqual(expansionScopesOf((await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}))?.value ?? null).scopes.map((s) => s.key), ["cd:119/0406"]);

  const again = await remove("county:2020/04019", "scope-rm-0004");
  assert.equal(again.ok, false);
  assert.match(again.receipt.says, /could not be found/);

  const bad = await remove("county:2020/04019;x", "scope-rm-0005");
  assert.equal(bad.receipt.refusal, "INVALID_INPUT");
});

test("an unplaced malformed scope is preserved while a state order changes only its own rows", async () => {
  const repos = createMemoryRepositories();
  const corrupt = { ...defaultAdminConfig(NOW), expansionScopes: [{ key: "junk" }] } as unknown as AdminConfig;
  await repos.adminConfig.put(ADMIN_CONFIG_ID, corrupt, NOW);
  const set = await submit(setScope({ geography: PIMA, priority: 1, budgetUsd: 1 }, "scope-corrupt-0001"), deps(repos));
  assert.equal(set.ok, true);
  assert.ok((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID,{expansionScopes:true})).value.expansionScopes?.some(scope=>scope.key==="junk"));
  const remove = await submit(
    { type: "expansion.scope.remove", subject: "k", input: { key: "county:2020/04019" }, stateVersion: null, idempotencyKey: "scope-corrupt-0002", caller: "OWNER_SESSION", actorRef: "adm_test-session" },
    deps(repos),
  );
  assert.equal(remove.ok, true);
  assert.equal((await repos.adminConfig.read(ADMIN_CONFIG_ID,{expansionScopes:true}))?.revision, 1, "nothing was written over the unreadable entry");
});
