/**
 * MW-021 (2026-09-25): a Send's budget and an area's budget are HARD caps.
 * Sean, 10:00 PM MST: "Fix and verify hard Send budgets, including concurrent
 * work, retries and escalations."
 *
 * Every case runs the real holds on the one shared budget ledger
 * (`BudgetRepository.mutate`, in memory) with fake model transports that
 * count what they were asked to send: a job that would exceed is refused
 * before any request; a follow-up (escalation, pre-warm, a request past the
 * hold) that would exceed is refused before it is sent; N jobs racing for a
 * budget that fits N−1 admit exactly N−1; a failed job keeps its hold, a
 * retry re-reserves, and a crash's hold counts until its window ends; a
 * missing or unreadable budget refuses; and nothing changes with no budget.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import {
  DurableSpendHolds,
  JobSpend,
  SendBudgetRefusal,
  budgetGuardedTransport,
  committedUsd,
  type BudgetLine,
  type BudgetLines,
} from "../lib/control-plane/expansion/spend-holds.ts";
import {
  armAssignmentBudget,
  assignmentBudgetsOf,
  assignmentMembership,
  malformedAssignmentBudgetsOf,
} from "../lib/control-plane/expansion/assignment-budget.ts";
import { scoutAttemptWorstCaseUsd, scoutJobWorstCaseUsd, type ModelRequest, type ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { RESEARCH_BOUNDS, type ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";
import { modelRequestWorstCaseUsd } from "../lib/control-plane/fleet-safety.ts";

const NOW = "2026-09-26T05:00:00.000Z";
const WORST = scoutJobWorstCaseUsd(RESEARCH_BOUNDS.perDispatch)!;

function holds(now = () => NOW) {
  const repos = createMemoryRepositories();
  return { repos, spend: new DurableSpendHolds({ budget: repos.budget, now, sleep: async () => undefined }) };
}

const send = (budgetUsd: number, historicalUsd = 0, key = "send:dispatch:ri-1"): BudgetLine => ({ key, label: `assignment "Pima County" (${key.slice(5)})`, budgetUsd, historicalUsd, historyReadAt: NOW });
const area = (budgetUsd: number, historicalUsd = 0): BudgetLine => ({ key: "area:zip-85701", label: "ZIP 85701", budgetUsd, historicalUsd, historyReadAt: NOW });
const lines = (sends: BudgetLine[], areas: BudgetLine[] = []): BudgetLines => ({ sends, areas });

/** A fake model transport: counts requests, answers with metered usage priced at `usdPerCall` on Sonnet 5 rates. */
function fakeTransport(outputTokens = 1_000) {
  const sent: ModelRequest[] = [];
  const transport = async (request: ModelRequest): Promise<ModelResponse> => {
    sent.push(request);
    return { id: `msg-${sent.length}`, model: request.model, role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1_000, output_tokens: outputTokens, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as ModelResponse;
  };
  return { sent, transport };
}

const request = (maxTokens = 8_192): ModelRequest => ({ model: "claude-sonnet-5", max_tokens: maxTokens, system: [], tools: [], messages: [{ role: "user", content: "x" }] }) as unknown as ModelRequest;

test("the job's worst case is derived from the loop's own bound and the start model's rate, not a flat $0.60", () => {
  assert.equal(WORST, scoutAttemptWorstCaseUsd("claude-sonnet-5", RESEARCH_BOUNDS.perDispatch));
  /* (400,000 tokens + one 8,192-token turn) at Sonnet 5's dearest per-token rate, $10/MTok output. */
  assert.ok(Math.abs(WORST - 4.08192) < 1e-9, `worst case ${WORST}`);
  assert.ok(Math.abs(scoutAttemptWorstCaseUsd("claude-opus-5-5", RESEARCH_BOUNDS.perDispatch)! - 8.16384) < 1e-9, "the escalation's worst case at Opus 5.5");
});

test("a job that would exceed the Send's budget is refused before any spend", async () => {
  const { spend } = holds();
  const job = new JobSpend(spend, "job-1", "ob-1", lines([send(5, 2)]));
  const { sent, transport } = fakeTransport();
  const admitted = await job.admit(WORST, "one Scout job");
  assert.equal(admitted.admit, false);
  assert.equal(!admitted.admit && admitted.code, "ASSIGNMENT_BUDGET");
  assert.match(!admitted.admit ? admitted.why : "", /\$3\.00 left.*\$4\.08\) does not fit/);
  assert.equal(sent.length, 0, "no request was ever sent");
  /* The area's own cap refuses the same way, even with the Send's room. */
  const other = new JobSpend(spend, "job-2", "ob-2", lines([send(100)], [area(4, 0.5)]));
  const byArea = await other.admit(WORST, "one Scout job");
  assert.equal(!byArea.admit && byArea.code, "SCOPE_BUDGET");
  void transport;
});

test("a follow-up that would exceed is refused before it is sent: an escalation, and a request past the job's hold", async () => {
  const { spend } = holds();
  /* $10: the job's $4.08 fits; the escalation's $8.16 on top does not. */
  const job = new JobSpend(spend, "job-esc", "ob-1", lines([send(10)]));
  assert.equal((await job.admit(WORST, "one Scout job")).admit, true);
  const escalation = await job.extend(scoutAttemptWorstCaseUsd("claude-opus-5-5", RESEARCH_BOUNDS.perDispatch)!, "the escalation to claude-opus-5-5");
  assert.equal(escalation.admit, false);
  assert.match(!escalation.admit ? escalation.why : "", /the escalation to claude-opus-5-5's worst case/);
  assert.equal(job.heldUsd, WORST, "a refused escalation holds nothing");

  /* A request past the hold: each worst case is $3 (a fake rate); the second would pass the $4.08 hold, and the $5 budget has $0.92 left. */
  const { spend: spend2 } = holds();
  const tight = new JobSpend(spend2, "job-req", "ob-2", lines([send(5)]));
  assert.equal((await tight.admit(WORST, "one Scout job")).admit, true);
  const { sent, transport } = fakeTransport();
  const guarded = budgetGuardedTransport({ transport, job: () => tight, worstCaseOf: () => 3, priceOf: () => 3 });
  await guarded(request());
  await assert.rejects(guarded(request()), (error: unknown) => error instanceof SendBudgetRefusal && error.code === "ASSIGNMENT_BUDGET");
  assert.equal(sent.length, 1, "the request past the hold was never sent");
});

test("a pre-warm holds its own worst case on the budget of the work it serves, and is refused when that does not fit", async () => {
  const worst = modelRequestWorstCaseUsd(request(0))!;
  assert.ok(worst > 0);
  const { spend } = holds();
  /* Room for the job and half a pre-warm. */
  const job = new JobSpend(spend, "job-pw", "ob-1", lines([send(WORST + worst / 2)]));
  assert.equal((await job.admit(WORST, "one Scout job")).admit, true);
  const prewarm = new JobSpend(spend, "prewarm:cycle", "ob-1", job.lines);
  const held = await prewarm.admit(worst, "the cycle's pre-warm");
  assert.equal(held.admit, false, "the pre-warm's worst case does not fit what the Send has left");
  assert.match(!held.admit ? held.why : "", /the cycle's pre-warm's worst case/);
  /* With room, it is held — and its measured cost is charged there. */
  const { spend: roomy } = holds();
  const job2 = new JobSpend(roomy, "job-pw2", "ob-1", lines([send(WORST + worst)]));
  assert.equal((await job2.admit(WORST, "one Scout job")).admit, true);
  assert.equal((await new JobSpend(roomy, "prewarm:cycle2", "ob-1", job2.lines).admit(worst, "the cycle's pre-warm")).admit, true);
});

test("N jobs racing for a budget that fits N−1 admit exactly N−1, on one ledger, whatever the interleaving", async () => {
  const N = 6;
  const { repos, spend } = holds();
  const budget = (N - 1) * WORST + 0.01;
  const jobs = Array.from({ length: N }, (_, i) => new JobSpend(spend, `job-${i}`, `ob-${i}`, lines([send(budget)])));
  const verdicts = await Promise.all(jobs.map((j) => j.admit(WORST, "one Scout job")));
  assert.equal(verdicts.filter((v) => v.admit).length, N - 1);
  assert.equal(verdicts.filter((v) => !v.admit).length, 1);
  const ledger = (await repos.budget.read()).value;
  assert.equal(Object.keys(ledger.spendHolds ?? {}).length, N - 1);
  assert.ok(committedUsd(ledger.spendHolds ?? {}, send(budget), NOW) <= budget, "never more held than the budget");
  /* A second cycle (a second ledger reader, same store) sees the first cycle's holds: no room for one more. */
  const other = new DurableSpendHolds({ budget: repos.budget, now: () => NOW, sleep: async () => undefined });
  const late = await new JobSpend(other, "job-next-cycle", "ob-x", lines([send(budget)])).admit(WORST, "one Scout job");
  assert.equal(late.admit, false, "an overlapping cycle decides against the same remaining budget");
});

test("settling releases the unused hold; a failed or unmeasured job keeps its hold; a retry re-reserves; a crash's hold counts until its window ends", async () => {
  let now = NOW;
  const { repos, spend } = holds(() => now);
  const line = send(2 * WORST);
  const first = new JobSpend(spend, "job-a", "ob-1", lines([line]));
  const second = new JobSpend(spend, "job-b", "ob-2", lines([line]));
  assert.equal((await first.admit(WORST, "job a")).admit, true);
  assert.equal((await second.admit(WORST, "job b")).admit, true);
  /* Full: a third waits. */
  assert.equal((await new JobSpend(spend, "job-c", "ob-3", lines([line])).admit(WORST, "job c")).admit, false);
  /* Job a finishes having spent $0.50: the rest of its hold is released, and the retry fits. */
  now = "2026-09-26T05:05:00.000Z";
  assert.equal(await spend.settle("job-a", 0.5, now), null);
  const retry = new JobSpend(spend, "job-c-retry", "ob-3", lines([line]));
  assert.equal((await retry.admit(WORST, "the retry")).admit, false, "0.50 spent + 4.08 held + 4.08 more exceeds 8.16");
  /* Job b fails with its spend unknown (settled unmeasured): its whole hold stands. */
  assert.equal(await spend.settle("job-b", null, now), null);
  const ledger = (await repos.budget.read()).value;
  assert.equal(ledger.spendHolds?.["job-b#0"]?.settled, null, "unmeasured: the hold keeps counting");
  /* A crash: job b never settles. Its hold counts for the rolling 24 hours, then the window drops it. */
  now = "2026-09-27T05:00:01.000Z";
  const afterWindow = new JobSpend(spend, "job-d", "ob-4", lines([{ ...line, historyReadAt: now }]));
  assert.equal((await afterWindow.admit(WORST, "job d")).admit, true, "outside the window the crashed hold no longer counts");
});

test("a settled job's measured spend counts until the cost history carries it, never twice", async () => {
  const { repos, spend } = holds();
  const job = new JobSpend(spend, "job-s", "ob-1", lines([send(10)]));
  await job.admit(WORST, "job");
  await spend.settle("job-s", 1.25, "2026-09-26T05:10:00.000Z");
  const held = (await repos.budget.read()).value.spendHolds ?? {};
  assert.equal(committedUsd(held, send(10, 0), "2026-09-26T05:20:00.000Z"), 1.25, "history read before the cost row: the settled spend counts from the hold");
  assert.equal(committedUsd(held, { ...send(10, 1.25), historyReadAt: "2026-09-26T05:15:00.000Z" }, "2026-09-26T05:20:00.000Z"), 1.25, "history read after: it counts once, from the history");
});

test("a missing Send record or an unreadable budget refuses; with no Send budget nothing changes", async () => {
  const intents: ResearchIntent[] = [
    { formatVersion: 1, kind: "INTENT", intentId: "ri-budgeted", action: "DISPATCH", requestedAt: NOW, actor: "owner", adminSessionRef: "s", note: "Pima County", budgetUsd: 20 },
    { formatVersion: 1, kind: "INTENT", intentId: "ri-bad", action: "DISPATCH", requestedAt: NOW, actor: "owner", adminSessionRef: "s", note: "Maricopa County", budgetUsd: "ten" as unknown as number },
    { formatVersion: 1, kind: "INTENT", intentId: "ri-free", action: "DISPATCH", requestedAt: NOW, actor: "owner", adminSessionRef: "s", note: "Yuma County" },
  ];
  const membership = assignmentMembership([
    { id: "ob-marked", subjectId: "az-pima", assignments: [{ assignmentKey: "dispatch:ri-budgeted", relation: "REORDERED", at: NOW }] as never },
    { id: "ob-bad", subjectId: "az-maricopa", assignments: [{ assignmentKey: "dispatch:ri-bad", relation: "REORDERED", at: NOW }] as never },
    { id: "ob-free", subjectId: "az-yuma", assignments: [{ assignmentKey: "dispatch:ri-free", relation: "REORDERED", at: NOW }] as never },
    { id: "ob-unmarked", subjectId: "az-pima" },
    { id: "ob-plain", subjectId: "nj-morris" },
  ]);
  const malformed = malformedAssignmentBudgetsOf(intents);
  assert.deepEqual(malformed.map((m) => m.key), ["dispatch:ri-bad"]);
  const gate = armAssignmentBudget({
    now: NOW,
    specs: assignmentBudgetsOf({ scopes: [], intents }),
    membership,
    costs: [],
    worstCaseUsd: WORST,
    intentsReadable: true,
    malformed,
    reachedThisCycle: new Map([["ob-unmarked", ["dispatch:ri-budgeted"]]]),
  });
  /* The record that ob-unmarked belongs to the budgeted Send was not written: it waits, by name. */
  const missing = gate.check("ob-unmarked");
  assert.equal(missing.admit, false);
  assert.match(!missing.admit ? missing.why : "", /record that it belongs to that Send was not written/);
  assert.ok("refusal" in gate.linesFor("ob-unmarked"));
  /* An unreadable budget: never run as if it had none. */
  const bad = gate.check("ob-bad");
  assert.equal(bad.admit, false);
  assert.match(!bad.admit ? bad.why : "", /not a readable amount \("ten"\)/);
  /* The marked row runs under its Send's budget. */
  const marked = gate.linesFor("ob-marked");
  assert.ok("lines" in marked && marked.lines.length === 1 && marked.lines[0].budgetUsd === 20);
  /* No Send budget: a Send without one, and plain work, pass unchanged — no lines, no ledger write, the transport untouched. */
  for (const id of ["ob-free", "ob-plain"]) {
    assert.deepEqual(gate.check(id), { admit: true, runsUnder: null, keys: id === "ob-free" ? ["dispatch:ri-free"] : [] });
    const l = gate.linesFor(id);
    assert.ok("lines" in l && l.lines.length === 0);
  }
  const { repos, spend } = holds();
  const free = await spend.hold({ holdId: "h", jobId: "j", obligationId: "ob-plain", lines: lines([]), usd: WORST, what: "job" });
  assert.deepEqual(free, { admit: true, hold: null });
  await assert.rejects(repos.budget.read(), "no hold was written, so the ledger was never touched");
  const { sent, transport } = fakeTransport();
  const passthrough = budgetGuardedTransport({ transport, job: () => null, worstCaseOf: () => 1_000, priceOf: () => 1_000 });
  await passthrough(request());
  assert.equal(sent.length, 1);
});

test("a ledger the store cannot read or write refuses the hold, by name: nothing runs unbudgeted", async () => {
  const broken = {
    read: async () => { throw new Error("connection refused"); },
    install: async () => { throw new Error("connection refused"); },
    mutate: async () => { throw new Error("connection refused"); },
  };
  const spend = new DurableSpendHolds({ budget: broken as never, now: () => NOW, sleep: async () => undefined });
  const verdict = await new JobSpend(spend, "job", "ob-1", lines([send(100)])).admit(WORST, "one Scout job");
  assert.equal(verdict.admit, false);
  assert.match(!verdict.admit ? verdict.why : "", /shared budget ledger could not be read or written \(connection refused\)/);
});
