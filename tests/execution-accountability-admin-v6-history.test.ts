import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";

import { GET } from "../app/api/admin/v6/history/route.ts";
import { projectV6History, readV6History } from "../lib/control-plane/admin-view/admin-v6-history.ts";
import type { ActionReceipt } from "../lib/control-plane/gateway/contract.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const scope = "us";
const asOf = "2026-09-28T21:00:00.000Z";
function receipt(key: string, type = "runner.pause", outcome: ActionReceipt["outcome"] = "QUEUED"): ActionReceipt {
  return { formatVersion: 1, receiptId: `${type}:${key}`, idempotencyKey: key, type,
    label: type === "runner.pause" ? "Pause the runner" : "Resume the runner",
    authority: "REVERSIBLE_NONPRODUCTION", subjectKind: "the standing runner", subject: `intent-${key}`,
    inputDigest: "sha256-test", caller: "OWNER_SESSION", actorRef: "test-owner", stateVersion: null,
    codeSha: null, startedAt: `2026-09-28T20:00:0${key.slice(-1)}.000Z`,
    completedAt: `2026-09-28T20:01:0${key.slice(-1)}.000Z`, outcome,
    says: `The runner has been asked to ${type === "runner.pause" ? "pause" : "resume"}.`,
    refusal: outcome === "REFUSED" ? "DOWNSTREAM_REFUSED" : null,
    openedWork: [], readBackAt: "/admin/work", undo: null };
}

test("registered orders are mapped while saved requests retain their actual state", () => {
  const unrelated = { ...receipt("k3"), type: "decision.record", subjectKind: "a row waiting on you" };
  const view = projectV6History([receipt("k1"), receipt("k2", "runner.resume"), unrelated], { scope, asOf });
  assert.equal(view.contract, "admin-v6/history@1");
  assert.equal(view.page.total, null);
  assert.deepEqual(view.data.map(row => row.kind), ["global-runner-resume", "global-runner-pause"]);
  assert(view.data.every(row => row.level === "global" && row.scopeKey === "us" && row.target === "runner"));
  assert(view.data.every(row => row.status === "queued" && row.lifecycle.saved !== null && row.lifecycle.workersReceived === null));
  assert(view.data.every(row => row.lifecycle.published === null && row.lifecycle.checkedOnPublicPage === null));
  assert.deepEqual(view.missingParts, []);
  assert.equal(projectV6History([receipt("k1")], { scope: "zcta:2020/85635", asOf }).data.length, 0);
});

test("mixed-type pages are bounded and reject a stale revision after a new receipt", () => {
  const rows = [receipt("k1"), receipt("k2", "runner.resume"), receipt("k3"), receipt("k4", "runner.resume")];
  const first = projectV6History(rows, { scope, asOf, limit: 2 });
  assert.deepEqual(first.data.map(row => row.key), ["k4", "k3"]);
  assert(first.page.nextCursor);
  const second = projectV6History(rows, { scope, asOf, limit: 2, cursor: first.page.nextCursor });
  assert.deepEqual(second.data.map(row => row.key), ["k2", "k1"]);
  assert(second.page.prevCursor);
  assert.throws(() => projectV6History([...rows, receipt("k5")], { scope, asOf, cursor: first.page.nextCursor }), /STALE_HISTORY_CURSOR/);
  assert.throws(() => projectV6History(rows, { scope: "other", asOf, cursor: first.page.nextCursor }), /INVALID_HISTORY_CURSOR/);
});

test("status and search apply after exact mapping without inventing a total", () => {
  const rows = [receipt("k1"), receipt("k2", "runner.resume", "REFUSED"), receipt("k3")];
  const filtered = projectV6History(rows, { scope, asOf, limit: 1, status: "refused", q: "resume" });
  assert.deepEqual(filtered.data.map(row => row.key), ["k2"]);
  assert.equal(filtered.data[0]?.lifecycle.saved, null);
  assert.equal(filtered.page.total, null);
});

test("repository reads one bounded projection page for each place, with stable keyset continuation", async () => {
  const place = "geo:xx.zcta.00000";
  const samples = [
    { position: 8, receipt: { ...receipt("k1", "fleet.deployHere"), subject: "intent-one", requestedSubject: place, subjectKind: "where you want the fleet to work" } },
    { position: 7, receipt: { ...receipt("k2", "config.setFleetSpendCeiling", "DONE"), subject: "fleet spend ceiling", subjectKind: "the Fleet's rolling ceiling" } },
    { position: 6, receipt: { ...receipt("k3", "expansion.scope.setMany", "DONE"), subject: place, subjectKind: "the places to hunt" } },
  ];
  const calls: unknown[] = [];
  const repos = { adminActionHistoryPage: async (query: { scope: string; limit: number; beforePosition?: number }) => {
    calls.push(query);
    return samples.filter(row => (query.beforePosition == null || row.position < query.beforePosition) &&
      (query.scope === "us" || row.receipt.subject === query.scope || row.receipt.requestedSubject === query.scope)).slice(0, query.limit);
  }, adminReceipts: { read() { throw new Error("whole log read"); }, readWhere() { throw new Error("unbounded type read"); } } } as unknown as ControlPlaneRepositories;
  const first = await readV6History(repos, { scope, asOf, limit: 2 });
  assert.deepEqual(first.data.map(row => row.kind), ["global-ceiling", "send-agents"]);
  assert(first.page.nextCursor);
  assert.equal(calls.length, 1);
  samples.unshift({ position: 9, receipt: receipt("k4") } as typeof samples[number]);
  const second = await readV6History(repos, { scope, asOf, limit: 2, cursor: first.page.nextCursor });
  assert.deepEqual(second.data.map(row => row.kind), ["hunt-start"]);
  assert.equal(second.page.nextCursor, null);
  const local = await readV6History(repos, { scope: place, asOf });
  assert.deepEqual(local.data.map(row => row.kind), ["hunt-start", "send-agents"]);
  assert(local.data.every(row => row.scopeKey === place));
  await assert.rejects(readV6History(repos, { scope: "st:xx", asOf, cursor: first.page.nextCursor }), /INVALID_HISTORY_CURSOR/);
});

test("route enforces Admin host/session and bounded query before touching the store", async () => {
  const publicResponse = await GET(new NextRequest(`https://${PUBLIC_HOST}/api/admin/v6/history?scope=${scope}`,
    { headers: { host: PUBLIC_HOST } }));
  assert.equal(publicResponse.status, 404);
  const noSession = await GET(new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/history?scope=${scope}`,
    { headers: { host: ADMIN_HOST } }));
  assert.equal(noSession.status, 401);
  await withAdminSessionKey(async () => {
    const badLimit = await GET(new NextRequest(`https://${ADMIN_HOST}/api/admin/v6/history?scope=${scope}&limit=51`,
      { headers: { host: ADMIN_HOST, cookie: await adminSessionCookie() } }));
    assert.equal(badLimit.status, 400);
  });
});
