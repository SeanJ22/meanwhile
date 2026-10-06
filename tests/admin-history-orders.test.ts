/**
 * BR-01: every order keeps its row after a reload. A hunt, a ceiling change and a send-agents order sent through
 * the real gateway are listed by a fresh history read, with their current state, at the country and at their own place.
 * BR-08 returned hook: the gateway takes a whole-state mission through the same scope validation as every other kind.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";
import { readV6History } from "../lib/control-plane/admin-view/admin-v6-history.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { expansionScopesOf } from "../lib/control-plane/expansion/scopes.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import type { ActionKind } from "../app/(admin)/_mw/admin-v6/model.ts";

const PLACE = "geo:xx.zcta.00001";
const at = "2026-10-04T06:00:00Z";

async function send(repos: ControlPlaneRepositories, kind: ActionKind, target: string, extra: { amount?: string; words?: string; payload?: Record<string, string> }, key: string, now: string) {
  const input = actionInput(kind, { target, scopeKey: target, option: null, words: extra.words ?? "", amount: extra.amount ?? "", selected: [], payload: extra.payload });
  return submit({ type: actionDef(kind).gateway!.type, subject: target, input, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "owner-session" },
    { repos, now: () => now, currentStateVersion: null, codeSha: null });
}

test("a hunt, a ceiling change and a send-agents order are listed after a reload, at the country and at their own place", async () => {
  const repos = createMemoryRepositories();
  assert.equal((await send(repos, "hunt-start", PLACE, { amount: "5" }, "order-hunt-0001", "2026-10-04T06:00:00Z")).ok, true);
  assert.equal((await send(repos, "global-ceiling", "us", { amount: "30" }, "order-ceiling-01", "2026-10-04T06:01:00Z")).ok, true);
  assert.equal((await send(repos, "send-agents", PLACE, { payload: { words: "Fill the school board" } }, "order-send-00001", "2026-10-04T06:02:00Z")).ok, true);
  // A reload is a fresh read of the store: nothing from the page that sent the orders survives it.
  const country = await readV6History(repos, { scope: "us", asOf: at });
  assert.deepEqual(country.data.map((r) => r.kind), ["send-agents", "global-ceiling", "hunt-start"]);
  assert.deepEqual(country.missingParts, [], "no history MISSING strings");
  const ceiling = country.data.find((r) => r.kind === "global-ceiling")!;
  assert.equal(ceiling.status, "queued", "a saved ceiling awaits the runner, rather than claiming its round has used it");
  assert.equal(ceiling.notPickedUp,true,"a silent runner is named after a reload");
  assert.equal(ceiling.scopeKey, "us");
  assert.equal(ceiling.targetName, "the daily budget");
  const sendRow = country.data.find((r) => r.kind === "send-agents")!;
  assert.equal(sendRow.scopeKey, PLACE, "the original place is kept even though the gateway subject is a derived intent");
  assert.equal(sendRow.status, "queued", "a saved send stays queued until the runner's own record confirms it");
  const local = await readV6History(repos, { scope: PLACE, asOf: at });
  assert.deepEqual(local.data.map((r) => r.kind), ["send-agents", "hunt-start"]);
  assert.ok(local.data.every((r) => r.scopeKey === PLACE && r.level === "local"));
  assert.equal((await readV6History(repos, { scope: "geo:xx.zcta.00002", asOf: at })).data.length, 0, "another place lists none of them");
});

test("history pages newest first with a stable cursor, and a store without a page read still answers", async () => {
  const repos = createMemoryRepositories();
  for (let n = 0; n < 5; n++) assert.equal((await send(repos, "global-ceiling", "us", { amount: String(10 + n) }, `order-ceiling-${n}0`, `2026-10-04T06:0${n}:00Z`)).ok, true);
  const first = await readV6History(repos, { scope: "us", asOf: at, limit: 2 });
  assert.equal(first.data.length, 2);
  assert.ok(first.page.nextCursor);
  const second = await readV6History(repos, { scope: "us", asOf: at, limit: 2, cursor: first.page.nextCursor });
  assert.ok(Date.parse(second.data[0].sentAt) < Date.parse(first.data[1].sentAt));
  const { adminActionHistoryPage: _omitted, ...withoutPage } = repos;
  const fallback = await readV6History(withoutPage as ControlPlaneRepositories, { scope: "us", asOf: at, limit: 3 });
  assert.deepEqual(fallback.data.map((r) => r.sentAt), first.data.concat(second.data).slice(0, 3).map((r) => r.sentAt));
});

test("BR-08 hook: a whole-state mission is accepted by the gateway and saved as one scope", async () => {
  const repos = createMemoryRepositories();
  const result = await submit({ type: "expansion.scope.set", subject: "state:xx",
    input: { geography: { type: "state", geoid: "99", version: "state:2020", label: "Test state", stateAbbr: "XX" }, priority: 1, budgetUsd: 5 },
    stateVersion: null, idempotencyKey: "mission-state-01", caller: "OWNER_SESSION", actorRef: "owner-session" },
    { repos, now: () => at, currentStateVersion: null, codeSha: null });
  assert.equal(result.ok, true, result.receipt.says);
  const scopes = expansionScopesOf((await repos.adminConfig.mustRead(ADMIN_CONFIG_ID)).value).scopes;
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].geography.type, "state");
});
