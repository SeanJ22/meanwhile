import assert from "node:assert/strict";
import test from "node:test";
import { applyManualSourceGaps } from "../lib/control-plane/expansion/dispatch-work.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const now = "2026-09-28T14:00:00.000Z";
const scope = { kind: "RESOLVED", decision: {
  key: ORIGINAL_LIFETIME_HUNT.key, receiptId: ORIGINAL_LIFETIME_HUNT.receiptId,
  budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt,
  budgetUsd: ORIGINAL_LIFETIME_HUNT.budgetUsd, sourceWorkVersion: 1,
  decidedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt,
}, zctas: new Set(["85635"]), whole: new Set(["85635"]), fractions: new Map(), states: ["AZ"] };

test("missing source capabilities persist as idempotent, non-executable work under the exact Send", async () => {
  const repos = createMemoryRepositories();
  const first = await applyManualSourceGaps(repos, [scope] as never, { now });
  assert.ok(first.created > 0);
  const rows = (await repos.workItems.list()).map(row => row.value);
  assert.equal(rows.length, first.created);
  assert.ok(rows.every(row => row.state === "OPEN" && row.routeTaskIds.length === 0 &&
    !row.autonomousPlan && row.manualSourceGap?.instructionReceipt === ORIGINAL_LIFETIME_HUNT.receiptId &&
    row.manualSourceGap.assignmentKey === ORIGINAL_LIFETIME_HUNT.key));
  assert.ok(rows.some(row => row.manualSourceGap?.contractId === "jurisdiction-operational-reference"));
  assert.ok(rows.some(row => row.manualSourceGap?.contractId === "voting-sites"));
  assert.ok(!rows.some(row => row.manualSourceGap?.contractId === "az-pima-local-finance"),
    "Arizona state membership alone does not prove Pima applicability");
  const second = await applyManualSourceGaps(repos, [scope] as never, { now });
  assert.equal(second.created, 0);
  assert.equal(second.carried, first.created);
});

test("a different receipt cannot inherit the original hunt's source gaps", async () => {
  const repos = createMemoryRepositories();
  const other = { ...scope, decision: { ...scope.decision, receiptId: "later-send" } };
  const result = await applyManualSourceGaps(repos, [other] as never, { now });
  assert.equal((await repos.workItems.list()).filter(row => row.value.manualSourceGap?.contractId === "jurisdiction-operational-reference").length, 0);
  assert.ok(result.created > 0, "ordinary reviewed-input gaps still carry their own receipt");
});
