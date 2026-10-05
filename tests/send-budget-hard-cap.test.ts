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
  areaGuardedTransport,
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
import { scoutAttemptWorstCaseUsd, scoutJobWorstCaseUsd, type ModelRequest, type ModelResponse, type ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { RESEARCH_BOUNDS, type ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";
import { FleetPreSendRefusal, FleetSafetyController, FleetSafetyRefusal, modelRequestWorstCaseUsd, modelResponseUsd } from "../lib/control-plane/fleet-safety.ts";
import { ScopeBudgetGate, type BudgetScope } from "../lib/control-plane/expansion/membership.ts";
import { modelAuditReasoner } from "../lib/control-plane/workers/model-audit.ts";
import type { IndependentAuditContext } from "../lib/control-plane/workers/types.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { MODELS } from "../lib/models.ts";

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

const request = (maxTokens = 8_192): ModelRequest => ({ model: MODELS.sonnet.model, max_tokens: maxTokens, system: [], tools: [], messages: [{ role: "user", content: "x" }] }) as unknown as ModelRequest;

test("the initial hold uses the response allowance at the starting tier; requests extend it before sending", () => {
  assert.equal(WORST, scoutAttemptWorstCaseUsd(MODELS.haiku.model, RESEARCH_BOUNDS.perDispatch));
  /* One maximum response initially held at each execution tier. */
  assert.ok(Math.abs(WORST - 0.04096) < 1e-9, `worst case ${WORST}`);
  assert.ok(Math.abs(scoutAttemptWorstCaseUsd(MODELS.opus.model, RESEARCH_BOUNDS.perDispatch)! - 0.16384) < 1e-9, "the escalation's worst case at Opus 5.5");
});

test("a job that would exceed the Send's budget is refused before any spend", async () => {
  const { spend } = holds();
  const job = new JobSpend(spend, "job-1", "ob-1", lines([send(0.05, 0.04)]));
  const { sent, transport } = fakeTransport();
  const admitted = await job.admit(WORST, "one Scout job");
  assert.equal(admitted.admit, false);
  assert.equal(!admitted.admit && admitted.code, "ASSIGNMENT_BUDGET");
  assert.match(!admitted.admit ? admitted.why : "", /\$0\.01 left.*\$0\.04\) does not fit/);
  assert.equal(sent.length, 0, "no request was ever sent");
  /* The area's own cap refuses the same way, even with the Send's room. */
  const other = new JobSpend(spend, "job-2", "ob-2", lines([send(100)], [area(0.04, 0.035)]));
  const byArea = await other.admit(WORST, "one Scout job");
  assert.equal(!byArea.admit && byArea.code, "SCOPE_BUDGET");
  void transport;
});

test("a follow-up that would exceed is refused before it is sent: an escalation, and a request past the job's hold", async () => {
  const { spend } = holds();
  /* The first tier fits; adding the frontier response hold would exceed $0.15. */
  const job = new JobSpend(spend, "job-esc", "ob-1", lines([send(0.15)]));
  assert.equal((await job.admit(WORST, "one Scout job")).admit, true);
  const escalation = await job.extend(scoutAttemptWorstCaseUsd(MODELS.opus.model, RESEARCH_BOUNDS.perDispatch)!, "the escalation to claude-opus-5-5");
  assert.equal(escalation.admit, false);
  assert.match(!escalation.admit ? escalation.why : "", /the escalation to claude-opus-5-5's worst case/);
  assert.equal(job.heldUsd, WORST, "a refused escalation holds nothing");

  /* Each request reserves $3: one fits the $5 budget, a second cannot. */
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
  /* Job a spends half its hold; two further full holds cannot fit. */
  now = "2026-09-26T05:05:00.000Z";
  assert.equal(await spend.settle("job-a", WORST / 2, now), null);
  const retry = new JobSpend(spend, "job-c-retry", "ob-3", lines([line]));
  assert.equal((await retry.admit(WORST, "the retry")).admit, false, "settled spend plus two full holds exceeds the original two-hold budget");
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
    { id: "ob-marked", subjectId: "az-pima", assignments: [{ assignmentKey: "dispatch:ri-budgeted", ref: "ri-budgeted", relation: "REORDERED", at: NOW }] as never },
    { id: "ob-bad", subjectId: "az-maricopa", assignments: [{ assignmentKey: "dispatch:ri-bad", ref: "ri-bad", relation: "REORDERED", at: NOW }] as never },
    { id: "ob-free", subjectId: "az-yuma", assignments: [{ assignmentKey: "dispatch:ri-free", ref: "ri-free", relation: "REORDERED", at: NOW }] as never },
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

/* ------------------------------------------------------------ autonomous work (no Send) */

const PIMA = "az:county:county-of-pima";
const MORRIS = "nj:county:county-of-morris";
const azScope = (budgetUsd: number, historicalUsd: number, resolved = true): BudgetScope => ({
  key: "zip-85701", label: "ZIP 85701", budgetUsd, resolved, members: new Set(resolved ? [PIMA] : []), states: ["AZ"], historicalUsd,
});
const areaGate = (scopes: BudgetScope[], malformedScopes = 0) => new ScopeBudgetGate({ scopes, worstCaseUsd: WORST, malformedScopes, historyReadAt: NOW });

/** The runner's wiring, with a fake transport: the area covering the job's jurisdiction, by the Scouts' own matching rule. */
function autonomous(spend: DurableSpendHolds, gate: ScopeBudgetGate | null, jurisdiction: { subjectId: string; state: string | null }, transport: ModelTransport, refusedBeforeSending?: (e: unknown) => boolean) {
  let seq = 0;
  return areaGuardedTransport({
    transport, holds: spend, jurisdiction,
    areasFor: (j) => {
      if (gate === null) return { areas: [] };
      const found = gate.linesFor(j.subjectId, j.state);
      return "refusal" in found ? { code: found.refusal.code, why: found.refusal.why } : { areas: found.lines };
    },
    worstCaseOf: modelRequestWorstCaseUsd, priceOf: modelResponseUsd, nextHoldId: () => `autonomous:${(seq += 1)}`, now: () => NOW,
    ...(refusedBeforeSending ? { refusedBeforeSending } : {}),
  });
}

test("an exhausted Send in NJ does not block an autonomous AZ job: autonomous work is never checked against a Send's budget", async () => {
  const { repos, spend } = holds();
  /* The NJ Send is spent out: a Scout it reached is refused. */
  const njSend = send(WORST, 0, "send:dispatch:ri-nj");
  assert.equal((await new JobSpend(spend, "nj-scout", "ob-nj", lines([njSend])).admit(WORST, "one Scout job")).admit, true);
  assert.equal((await new JobSpend(spend, "nj-scout-2", "ob-nj-2", lines([njSend])).admit(WORST, "one Scout job")).admit, false, "the NJ Send has nothing left");
  /* An autonomous job researching Pima County, AZ, inside an AZ area with room: it runs, held on the AZ area only. */
  const { sent, transport } = fakeTransport();
  await autonomous(spend, areaGate([azScope(50, 1)]), { subjectId: PIMA, state: "AZ" }, transport)(request());
  assert.equal(sent.length, 1);
  const held = Object.values((await repos.budget.read()).value.spendHolds ?? {}).filter((h) => h.jobId.startsWith("autonomous:"));
  assert.deepEqual(held.map((h) => h.keys), [["area:zip-85701"]], "held on the area it researches, on no Send");
  assert.ok(held[0].settled !== null && held[0].settled.usd > 0 && held[0].settled.usd < held[0].usd, "settled to its measured cost");
  /* Autonomous work in NJ, where no area budget stands, passes straight to the Fleet guard — the spent NJ Send does not bind it either. */
  await autonomous(spend, areaGate([azScope(50, 1)]), { subjectId: MORRIS, state: "NJ" }, transport)(request());
  assert.equal(sent.length, 2);
});

test("an exhausted AZ area budget blocks an autonomous AZ job before it sends, whether the area is matched by member or by state", async () => {
  const { spend } = holds();
  const { sent, transport } = fakeTransport();
  /* A resolved area with Pima as a member, $0.01 left. */
  await assert.rejects(
    autonomous(spend, areaGate([azScope(5, 4.99)]), { subjectId: PIMA, state: "AZ" }, transport)(request()),
    (error: unknown) => error instanceof SendBudgetRefusal && error.code === "SCOPE_BUDGET" && /ZIP 85701 has \$0\.01 of its \$5\.00/.test(error.why),
  );
  /* An area not yet resolved binds by state: a subject whose id says no state is matched by the job's own state. */
  const unresolved = areaGate([azScope(5, 0, false)]);
  await assert.rejects(autonomous(spend, unresolved, { subjectId: "pima-legistar", state: "AZ" }, transport)(request()), SendBudgetRefusal);
  assert.equal(sent.length, 0, "no request was sent");
  /* A job in another state is not bound by the AZ area. */
  await autonomous(spend, areaGate([azScope(5, 4.99)]), { subjectId: MORRIS, state: "NJ" }, transport)(request());
  assert.equal(sent.length, 1);
});

test("autonomous work fails closed: an unreadable area budget or ledger refuses; a Fleet refusal before sending releases its hold", async () => {
  const { sent, transport } = fakeTransport();
  const { repos, spend } = holds();
  /* The scope list could not be read: whether an area covers the job cannot be known. */
  await assert.rejects(autonomous(spend, areaGate([], 1), { subjectId: PIMA, state: "AZ" }, transport)(request()), (e: unknown) => e instanceof SendBudgetRefusal && e.code === "SCOPE_BUDGET");
  /* The area's spend is unmeasured. */
  await assert.rejects(autonomous(spend, areaGate([azScope(50, null as unknown as number)]), { subjectId: PIMA, state: "AZ" }, transport)(request()), SendBudgetRefusal);
  /* The ledger cannot be read or written. */
  const broken = { read: async () => { throw new Error("connection refused"); }, install: async () => { throw new Error("connection refused"); }, mutate: async () => { throw new Error("connection refused"); } };
  const deadLedger = new DurableSpendHolds({ budget: broken as never, now: () => NOW, sleep: async () => undefined });
  await assert.rejects(autonomous(deadLedger, areaGate([azScope(50, 1)]), { subjectId: PIMA, state: "AZ" }, transport)(request()), /shared budget ledger could not be read or written/);
  assert.equal(sent.length, 0, "nothing was sent unbudgeted");
  /* The Fleet guard refuses before sending: the area hold is released, not left counting. */
  class Refused extends Error {}
  const refusing: ModelTransport = async () => { throw new Refused("ceiling"); };
  await assert.rejects(autonomous(spend, areaGate([azScope(50, 1)]), { subjectId: PIMA, state: "AZ" }, refusing, (e) => e instanceof Refused)(request()), Refused);
  assert.equal(Object.keys((await repos.budget.read()).value.spendHolds ?? {}).length, 0);
  /* A failure after it may have been sent keeps the whole hold: what it was billed is unknown. */
  const failing: ModelTransport = async () => { throw new Error("socket hang up"); };
  await assert.rejects(autonomous(spend, areaGate([azScope(50, 1)]), { subjectId: PIMA, state: "AZ" }, failing, (e) => e instanceof Refused)(request()), /socket hang up/);
  const kept = Object.values((await repos.budget.read()).value.spendHolds ?? {});
  assert.equal(kept.length, 1);
  assert.equal(kept[0].settled, null);
});

test("a provider response with incomplete usage keeps the durable autonomous area hold, while a typed pre-send refusal releases it", async () => {
  const scope = areaGate([azScope(50, 0)]);
  const { repos, spend } = holds();
  let providerCalls = 0;
  const incomplete: ModelTransport = async (asked) => {
    providerCalls += 1;
    return { id: "msg-unpriced", model: asked.model, role: "assistant", content: [{ type: "text", text: "done" }],
      stop_reason: "end_turn", usage: { input_tokens: 100 } } as unknown as ModelResponse;
  };
  const controller = new FleetSafetyController({ now: NOW, costs: [], rollingCeilingUsd: 100, clock: () => Date.parse(NOW) });
  const afterResponse = autonomous(spend, scope, { subjectId: PIMA, state: "AZ" },
    controller.guardedModelTransport("anthropic", PIMA, incomplete), (error) => error instanceof FleetPreSendRefusal);
  await assert.rejects(afterResponse(request()), (error: unknown) =>
    error instanceof FleetSafetyRefusal && error.code === "UNMEASURED_MODEL_SPEND" && !(error instanceof FleetPreSendRefusal));
  assert.equal(providerCalls, 1, "the model provider actually returned a response");
  let held = Object.values((await repos.budget.read()).value.spendHolds ?? {});
  assert.equal(held.length, 1);
  assert.equal(held[0].settled, null, "unknown-cost provider processing cannot release its durable area hold");

  const { repos: preRepos, spend: preSpend } = holds();
  const preController = new FleetSafetyController({ now: NOW, costs: [], modelHold: "owner held this lane", clock: () => Date.parse(NOW) });
  const beforeRequest = autonomous(preSpend, scope, { subjectId: PIMA, state: "AZ" },
    preController.guardedModelTransport("anthropic", PIMA, incomplete), (error) => error instanceof FleetPreSendRefusal);
  await assert.rejects(beforeRequest(request()), FleetPreSendRefusal);
  assert.equal(providerCalls, 1, "the typed pre-send refusal never called the provider");
  held = Object.values((await preRepos.budget.read()).value.spendHolds ?? {});
  assert.equal(held.length, 0, "a proven local pre-send refusal releases only its unused hold");
});

test("the auditor's review goes through the jurisdiction's transport, and a budget refusal is a policy denial, not a provider failure", async () => {
  const asked: { subjectId: string; state: string | null }[] = [];
  const reasoner = modelAuditReasoner(createMemoryRepositories(), async () => { throw new Error("the shared transport must not be used"); }, () => NOW, {
    ceilingUsd: 100,
    transportFor: (j) => {
      asked.push(j);
      return async () => { throw new SendBudgetRefusal("SCOPE_BUDGET", "ZIP 85701 has $0.00 left"); };
    },
  });
  const context = {
    subjectId: PIMA, contract: { recordClass: "CIVICCLERK_EVENTS", schemaVersion: 1, subjectId: PIMA, sourceBodyId: null, sourceBodyName: null, publisherSlug: "pima", requiredFields: ["id"], completenessScope: "captured", expectedSourceDate: null },
    publisherSurfaces: ["https://pima.gov/"], methodVersion: 1, routes: [], evidence: [], surfaceEvidence: [], startedFrom: [], scope: "CAPTURED_ARTIFACT",
  } as unknown as IndependentAuditContext;
  await assert.rejects(reasoner.review(context, "auditor-attempt"), /DENIED_BY_POLICY:SCOPE_BUDGET; ZIP 85701 has \$0\.00 left/);
  assert.deepEqual(asked, [{ subjectId: PIMA, state: null }]);
});

test("the runner wires autonomous work to its jurisdiction's area only, never to a Send's budget", () => {
  const runner = readFileSync(join(process.cwd(), "scripts", "freshness-shadow.mts"), "utf8");
  /* CH-24: the guards are built in paid-work-guards.ts, which the round calls. */
  const guards = readFileSync(join(process.cwd(), "lib", "control-plane", "workers", "paid-work-guards.ts"), "utf8");
  assert.match(runner, /const \{ budgetLinesFor, guardedMessagesFor, autonomousTransportFor, paidWorkerCapacity \} = guards;/);
  const start = guards.indexOf("const autonomousTransportFor =");
  const end = guards.indexOf("});", start);
  const block = guards.slice(start, end);
  assert.ok(start > 0 && end > start);
  assert.match(block, /expansionBudget\.gate\.linesFor\(j\.subjectId, j\.state\)/);
  assert.doesNotMatch(block, /assignmentBudget|sends:/, "no Send budget is consulted for autonomous work");
  assert.match(runner, /transportFor: autonomousTransportFor\(fleetTransport\)/);
  assert.match(runner, /const fleetTransport = modelLaneEnabled \? workerMessages : null/, "the autonomous transport exists only while the paid lane is open");
  assert.doesNotMatch(runner, /unattributedBudgetGuard|allLines\(/);
});
