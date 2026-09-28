import assert from "node:assert/strict";
import test from "node:test";
import { shellScope, scopeOfDecision } from "../app/(admin)/_mw/load-shell.ts";
import { parseScope, scopeParam, withScope } from "../app/(admin)/_mw/scope.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";

test("a saved ZIP instruction survives the shared Admin scope URL and header", () => {
  const decision: ExpansionScopeDecision = {
    key: "zcta:2020/85635", geography: { type: "zcta", geoid: "85635", version: "zcta:2020", label: "ZIP 85635 (Census ZCTA)", stateAbbr: "AZ" },
    priority: 1, budgetUsd: 10, note: null, decidedAt: "2026-09-28T08:00:00.000Z", decidedBy: "fixture", receiptId: "receipt-85635", previous: null,
  };
  const scoped = scopeOfDecision(decision);
  assert.deepEqual(scoped, { kind: "geo", type: "zcta", geoid: "85635", state: "az" });
  assert.equal(scopeParam(scoped!), "az.zcta.85635");
  assert.deepEqual(parseScope("az.zcta.85635"), scoped);
  assert.deepEqual(parseScope("az.zcta.8563"), { kind: "all" });
  assert.equal(withScope("/readiness/done", scoped!), "/readiness/done?scope=az.zcta.85635");
  const shell = shellScope(scoped!, [decision], { kind: "UNREAD", detail: "fixture" });
  assert.equal(shell.label, "Arizona · ZIP 85635 (Census ZCTA)");
  assert.equal(shell.decision?.receiptId, "receipt-85635");
  assert.ok(shell.groups.some(group => group.options.some(option => option.value === "az.zcta.85635")));
});
