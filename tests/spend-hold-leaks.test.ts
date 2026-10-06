/**
 * MW-021 follow-up (2026-10-06): no budget hold outlives the round that took it.
 *
 * Before this, a Scout job's worst-case hold on a hunt's lifetime budget was
 * released only when its dispatch settled. A research round killed for no
 * progress never settled its open jobs, and lifetime holds never left the
 * window, so 15,025 holds ($615) stood on the one ledger row. Admin counted
 * them as Set aside, the paid lane read "Left today $0.00", and the row grew to
 * 38 MB, read on every admission.
 *
 * Now: a round that ends or fails releases every job it never settled; an
 * unsettled hold older than SPEND_HOLD_STALE_MS (a killed round's) stops
 * counting and leaves the row on the next write; a settled hold leaves once
 * its cost is older than any history a reader starts from.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  DurableSpendHolds,
  JobSpend,
  SETTLED_HOLD_RETENTION_MS,
  SPEND_HOLD_STALE_MS,
  liveSpendHolds,
  releaseOpenJobs,
  type BudgetLine,
} from "../lib/control-plane/expansion/spend-holds.ts";

const NOW = "2026-10-05T23:14:00.000Z";
const at = (ms: number): string => new Date(Date.parse(NOW) + ms).toISOString();
const hunt = (budgetUsd: number): BudgetLine => ({
  key: "send:hunt-az@2026-10-04T00:00:00.000Z", label: "the Arizona hunt", budgetUsd, historicalUsd: 0, historyReadAt: NOW, lifetime: true,
});

function ledger(now: () => string) {
  const repos = createMemoryRepositories();
  return { repos, spend: new DurableSpendHolds({ budget: repos.budget, now, sleep: async () => undefined }) };
}

test("a round that fails mid-cycle leaves no hold behind: unsent jobs release, a job that sent books what it committed", async () => {
  let now = NOW;
  const { repos, spend } = ledger(() => now);
  const line = hunt(1);
  const unsent = new JobSpend(spend, "scout:round-1:1:ob-a", "ob-a", { sends: [line], areas: [] });
  const sent = new JobSpend(spend, "scout:round-1:2:ob-b", "ob-b", { sends: [line], areas: [] });
  assert.equal((await unsent.admit(0.04, "job a")).admit, true);
  assert.equal((await sent.admit(0.04, "job b")).admit, true);
  /* Job b's request went out and was priced at $0.01 before the round failed. */
  sent.committedUsd = 0.01;

  now = at(60_000);
  assert.deepEqual(await releaseOpenJobs(spend, [unsent, sent], now), []);

  const holds = (await repos.budget.read()).value.spendHolds ?? {};
  assert.equal(Object.values(holds).filter((h) => h.settled === null).length, 0, "no hold is left standing");
  assert.equal(holds["scout:round-1:1:ob-a#0"]?.settled?.usd, 0, "the job that never sent releases its whole hold");
  assert.equal(holds["scout:round-1:2:ob-b#0"]?.settled?.usd, 0.01, "the job that sent books its committed spend");
  const left = await spend.left([line]);
  assert.equal(left?.[0].leftUsd, 0.99, "only the spend that happened is counted against the hunt");
});

test("a killed round's holds stop counting after the stale window and leave the ledger row on the next write", async () => {
  let now = NOW;
  const { repos, spend } = ledger(() => now);
  const line = hunt(0.1);
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await new JobSpend(spend, `scout:killed:${i}:ob-${i}`, `ob-${i}`, { sends: [line], areas: [] }).admit(0.04, "a job")).admit, true);
  }
  /* The round is killed (SIGKILL): nothing settles. While its jobs could still be running, the holds count. */
  now = at(SPEND_HOLD_STALE_MS - 60_000);
  assert.equal((await spend.left([line]))?.[0].leftUsd, 0.02, "within the stale window the holds still count");
  assert.equal((await new JobSpend(spend, "scout:next:0:ob-x", "ob-x", { sends: [line], areas: [] }).admit(0.04, "a job")).admit, false);

  /* Past it, no job from that round can be running: the holds stop counting and the next write drops them. */
  now = at(SPEND_HOLD_STALE_MS + 60_000);
  assert.equal((await spend.left([line]))?.[0].leftUsd, 0.1, "Set aside counts only live holds");
  assert.equal((await new JobSpend(spend, "scout:next:1:ob-y", "ob-y", { sends: [line], areas: [] }).admit(0.04, "a job")).admit, true);
  const ids = Object.keys((await repos.budget.read()).value.spendHolds ?? {});
  assert.deepEqual(ids, ["scout:next:1:ob-y#0"], "the killed round's holds are gone from the row");
});

test("a settled hold leaves the row once its cost is older than any history a reader starts from", async () => {
  let now = NOW;
  const { repos, spend } = ledger(() => now);
  const line = hunt(1);
  const job = new JobSpend(spend, "scout:r:0:ob", "ob", { sends: [line], areas: [] });
  await job.admit(0.04, "a job");
  await spend.settle(job.jobId, 0.02, at(1_000));
  now = at(SETTLED_HOLD_RETENTION_MS - 60_000);
  assert.equal(Object.keys(liveSpendHolds((await repos.budget.read()).value.spendHolds, now)).length, 1, "kept while a reader's history may predate its cost");
  now = at(SETTLED_HOLD_RETENTION_MS + 60_000);
  await new JobSpend(spend, "scout:r2:0:ob", "ob", { sends: [line], areas: [] }).admit(0.04, "a job");
  assert.deepEqual(Object.keys((await repos.budget.read()).value.spendHolds ?? {}), ["scout:r2:0:ob#0"]);
});

test("the round wires the release on its normal end and on its crash path, and readers use live holds", async () => {
  const { readFileSync } = await import("node:fs");
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /releaseRoundHolds = \(\) =>/);
  assert.match(round, /async function recordCrash[\s\S]*?releaseRoundHolds[\s\S]*?crash:record/);
  assert.match(round, /const notReleased = await releaseRoundHolds!\(\);[\s\S]*?const runRecord = \{/);
  assert.match(round, /liveSpendHolds\(heldBudget\.value\.spendHolds/);
  const snapshot = readFileSync(new URL("../scripts/publish-owner-snapshot.mts", import.meta.url), "utf8");
  assert.match(snapshot, /liveSpendHolds\(r\.value\.spendHolds/);
});
