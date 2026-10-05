import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_HISTORY_PAGE_SQL, readActionHistoryPage } from "../lib/control-plane/repository/action-history-atomic.ts";
import type { Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { submit } from "../lib/control-plane/gateway/gateway.ts";

test("history uses one bounded newest-first projection/receipt join, without requiring old mapping readiness", async () => {
  const calls: unknown[][] = [];
  const sql = { query: async (query: string, params: unknown[]) => { calls.push([query, params]); return [{ position: "42", record: { type: "fleet.deployHere" } }]; } } as unknown as Sql;
  const result = await readActionHistoryPage(sql, { scope: "st:xx", beforePosition: 50, limit: 20 });
  assert.equal(result[0].position, 42);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ["st:xx", 50, 20]);
  assert.match(ACTION_HISTORY_PAGE_SQL, /JOIN cp_log_admin_receipts/);
  assert.match(ACTION_HISTORY_PAGE_SQL, /ORDER BY p.source_position DESC\s+LIMIT \$3/);
  assert.doesNotMatch(ACTION_HISTORY_PAGE_SQL, /mapping_state\s*=|readiness/);
  await assert.rejects(readActionHistoryPage(sql, { scope: "us", limit: 52 }), /INVALID_HISTORY_QUERY/);
  assert.equal(calls.length, 1);
});
test("a send retains its requested place while its canonical subject still confirms the runner intent", async () => {
  const repos = createMemoryRepositories();
  const deps = { repos, now: () => "2026-10-04T06:00:00Z", currentStateVersion: null, codeSha: null };
  const result = await submit({ type: "fleet.deployHere", subject: "st:xx", input: { note: "Send agents to the selected place" },
    caller: "OWNER_SESSION", actorRef: "test", stateVersion: null, idempotencyKey: "history-place" }, deps);
  assert.equal(result.ok, true);
  assert.equal(result.receipt.requestedSubject, "st:xx");
  assert.notEqual(result.receipt.subject, "st:xx");
  assert.equal(result.receipt.outcome, "QUEUED");
});
