import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryRepositories, memoryAggregateRepository } from "../lib/control-plane/repository/memory.ts";
import { budgetRepositoryFrom } from "../lib/control-plane/repository/shared.ts";
import type { BudgetLedger } from "../lib/control-plane/budget.ts";
import { DurableSpendHolds, JobSpend, committedUsd, type BudgetLine } from "../lib/control-plane/expansion/spend-holds.ts";
import { withScopeSet } from "../lib/control-plane/expansion/scopes.ts";
import { aggregateModelSpend } from "../lib/control-plane/fleet-safety.ts";

test("atomic CAS reservations retry revision conflicts without relying on HTTP session locks", async () => {
  const budget = budgetRepositoryFrom(memoryAggregateRepository<BudgetLedger>("BudgetLedger"), { withLock: async () => { throw new Error("session affinity is unavailable"); } }, "ATOMIC_COMPARE_AND_SET");
  const now = "2026-09-26T08:00:00.000Z";
  const holds = new DurableSpendHolds({ budget, now: () => now, sleep: async () => undefined });
  const line: BudgetLine = { key: "hunt", label: "85635", budgetUsd: 50, historicalUsd: 0, historyReadAt: now, lifetime: true };
  const outcomes = await Promise.all(Array.from({ length: 12 }, (_,i) => new JobSpend(holds, `cas-${i}`, "ob", { sends: [line], areas: [] }).admit(10, "request")));
  assert.equal(outcomes.filter(o => o.admit).length, 5);
  assert.equal(committedUsd((await budget.read()).value.spendHolds!, line, now), 50);
  assert.ok(outcomes.filter(o => !o.admit).every(o => !o.admit && o.why.includes("does not fit")));
});

test("$50 is shared across concurrent work in one hunt and cannot reset after a day or restart", async () => {
  let now = "2026-09-26T08:00:00.000Z";
  const repos = createMemoryRepositories();
  const spend = new DurableSpendHolds({ budget: repos.budget, now: () => now, sleep: async () => undefined });
  const line: BudgetLine = { key: "area:zcta:2020/85635@hunt1", label: "85635 test hunt", budgetUsd: 50, historicalUsd: 0, historyReadAt: now, lifetime: true };
  const admitted = await Promise.all(Array.from({ length: 12 }, (_,i) => new JobSpend(spend, `job-${i}`, `ob-${i}`, { sends: [], areas: [line] }).admit(10, "bounded request")));
  assert.equal(admitted.filter(a => a.admit).length, 5);
  now = "2026-09-28T08:00:00.000Z";
  const restarted = new DurableSpendHolds({ budget: repos.budget, now: () => now, sleep: async () => undefined });
  const refusal = await new JobSpend(restarted, "retry-next-day", "ob-1", { sends: [], areas: [line] }).admit(0.01, "retry or escalation");
  assert.equal(refusal.admit, false);
  assert.equal(committedUsd((await repos.budget.read()).value.spendHolds!, line, now), 50);
  const separate = { ...line, key: "area:zcta:2020/85635@hunt2" };
  assert.equal((await new JobSpend(restarted, "separate-hunt", "ob-1", { sends: [], areas: [separate] }).admit(1, "separately authorized future hunt")).admit, true);
});

test("an overlapping Send cannot override this hunt's remaining token budget", async () => {
  const repos = createMemoryRepositories(), now = "2026-09-26T08:00:00.000Z";
  const spend = new DurableSpendHolds({ budget: repos.budget, now: () => now });
  const hunt: BudgetLine = { key: "hunt", label: "85635", budgetUsd: 50, historicalUsd: 49, historyReadAt: now, lifetime: true };
  const unrelated = { ...hunt, key: "other", budgetUsd: 100, historicalUsd: 0, lifetime: false };
  assert.equal((await new JobSpend(spend, "job", "ob", { sends: [hunt, unrelated], areas: [] }).admit(2, "escalation")).admit, false);
});

test("editing the current hunt preserves its accounting start; an explicit separate hunt gets a new start", () => {
  const change = { geography: { type: "zcta" as const, geoid: "85635", version: "zcta:2020", label: "85635", stateAbbr: "AZ" }, priority: 1, budgetUsd: 50, huntBudget: true, note: null, decidedAt: "2026-09-26T08:00:00.000Z", decidedBy: "owner", receiptId: "first" };
  const first = withScopeSet([],change).scopes;
  const edit = withScopeSet(first,{ ...change, budgetUsd: 60, decidedAt: "2026-09-27T08:00:00.000Z", receiptId: "edit" }).scopes;
  assert.equal(edit[0].budgetStartedAt, change.decidedAt);
  const next = withScopeSet(edit,{ ...change, newHunt: true, decidedAt: "2026-10-01T08:00:00.000Z", receiptId: "new" }).scopes;
  assert.equal(next[0].budgetStartedAt, "2026-10-01T08:00:00.000Z");
});

test("Brave and Exa costs do not consume the Anthropic token-only cap", () => {
  const since = "2026-09-01T00:00:00.000Z", until = "2026-09-26T08:00:00.000Z";
  const row = (role: string, source: string, usd: number) => ({ role, source, recordedAt: until, cost: { usd, inputTokens: null, outputTokens: null } });
  const out = aggregateModelSpend([row("SCOUT","api.anthropic.com",12), row("DISCOVERY_SEARCH","api.search.brave.com",5), row("DISCOVERY_SEARCH","api.exa.ai",8), row("FETCH","neon.tech",20), row("FETCH","api.github.com",10), row("FETCH","api.netlify.com",15)] as never, since, until);
  assert.equal(out.usd, 12);
  assert.equal(out.measured, 1);
});
