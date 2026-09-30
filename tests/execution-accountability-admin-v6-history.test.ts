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

test("only globally scoped runner control receipts are mapped; saved request is not application", () => {
  const unrelated = { ...receipt("k3"), type: "decision.record", subjectKind: "a row waiting on you" };
  const view = projectV6History([receipt("k1"), receipt("k2", "runner.resume"), unrelated], { scope, asOf });
  assert.equal(view.contract, "admin-v6/history@1");
  assert.equal(view.page.total, null);
  assert.deepEqual(view.data.map(row => row.kind), ["global-runner-resume", "global-runner-pause"]);
  assert(view.data.every(row => row.level === "global" && row.scopeKey === "us" && row.target === "runner"));
  assert(view.data.every(row => row.status === "queued" && row.lifecycle.saved !== null && row.lifecycle.workersReceived === null));
  assert(view.data.every(row => row.lifecycle.published === null && row.lifecycle.checkedOnPublicPage === null));
  assert(view.missingParts.some(part => part.includes("total is unknown")));
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

test("repository reads only exact action-type partitions; a place scope reads no log", async () => {
  const calls: string[] = [];
  const repos = { adminReceipts: { readWhere: async (key: string, path: readonly string[], value: string) => {
    calls.push(`${key}:${path.join(".")}:${value}`); return [receipt(value === "runner.pause" ? "k1" : "k2", value)];
  }, read: () => { throw new Error("whole log read"); } } } as unknown as ControlPlaneRepositories;
  const section = await readV6History(repos, { scope, asOf });
  assert.equal(section.data.length, 2);
  assert.deepEqual(calls, ["admin-action:type:runner.pause", "admin-action:type:runner.resume"]);
  const local = await readV6History(repos, { scope: "zcta:2020/85635", asOf });
  assert.equal(local.data.length, 0);
  assert.equal(calls.length, 2);
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
