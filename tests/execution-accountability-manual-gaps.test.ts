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
  assert.ok(!rows.some(row => row.manualSourceGap?.contractId === "voting-sites"), "the voting-site pass runs for the Send (CH-11); it is no owed capability");
  assert.ok(rows.some(row => row.manualSourceGap?.contractId === "az-pima-local-finance" &&
    row.manualSourceGap.mode === "SCOPED_ADAPTER_OWED" && row.manualSourceGap.reason.includes("alone")),
    "A county adapter gap stays non-executable until its place is bound");
  const second = await applyManualSourceGaps(repos, [scope] as never, { now });
  assert.equal(second.created, 0);
  assert.equal(second.carried, first.created);
});

test("a different receipt gets its own source gaps without inheriting the original receipt", async () => {
  const repos = createMemoryRepositories();
  const other = { ...scope, decision: { ...scope.decision, receiptId: "later-send" } };
  const result = await applyManualSourceGaps(repos, [other] as never, { now });
  const gaps = (await repos.workItems.list()).map(row => row.value.manualSourceGap);
  assert.ok(gaps.some(gap => gap?.contractId === "jurisdiction-operational-reference"));
  assert.ok(gaps.every(gap => gap?.instructionReceipt === "later-send"));
  assert.ok(result.created > 0, "owed-capability gaps carry their own receipt");
});

test("an owed state adapter is owed only by Sends that reach its state, and never waits on a person's review", async () => {
  const repos = createMemoryRepositories();
  const nj = { ...scope, decision: { ...scope.decision, receiptId: "nj-send", key: "nj-send" }, states: ["NJ"] };
  await applyManualSourceGaps(repos, [scope, nj] as never, { now });
  const gaps = (await repos.workItems.list()).map(row => row.value.manualSourceGap!);
  const ballot = gaps.filter(gap => gap.contractId === "az-official-actions");
  assert.deepEqual(ballot.map(gap => [gap.instructionReceipt, gap.mode]), [[ORIGINAL_LIFETIME_HUNT.receiptId, "SCOPED_ADAPTER_OWED"]]);
  assert.ok(gaps.every(gap => gap.mode === "SCOPED_ADAPTER_OWED"));
  assert.ok(gaps.some(gap => gap.contractId === "jurisdiction-operational-reference" && gap.instructionReceipt === "nj-send"),
    "a contract with no state is owed by every Send");
});
