import assert from "node:assert/strict";
import test from "node:test";
import { admittedHuntSourceScopes, huntSourceTasks } from "../lib/civic-data/hunt-source-tasks.ts";
import { manualProducerInvocationMatrix } from "../lib/civic-data/manual-producer-invocation.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { routineTaskDue, ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import type { ResolvedScope } from "../lib/control-plane/expansion/membership.ts";
import { runtimeAuthorityIssue, type RuntimeAuthorityEnvelope } from "../lib/civic-data/runtime-authority.ts";
import { parseRoutineRunnerReceipt, printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import type { PromotionOutcome } from "../lib/civic-data/promotion.ts";

const NOW = "2026-09-27T02:00:00.000Z";
function scope(state: string, id = "owner-send-1"): ResolvedScope {
  return { kind: "RESOLVED", zctas: new Set(["85635"]), whole: new Set(["85635"]), fractions: new Map(), states: [state],
    decision: { key: "zcta:2020/85635", geography: { type: "zcta", geoid: "85635", version: "zcta:2020", label: "85635", stateAbbr: state },
      priority: 1, budgetUsd: 50, budgetStartedAt: NOW, sourceWorkVersion: 1, note: null, decidedAt: NOW, decidedBy: "owner-session", receiptId: id, previous: null } };
}

test("an actual resolved Send selects each shared native source producer once", () => {
  assert.deepEqual(huntSourceTasks([], NOW), []);
  const legacy = scope("AZ");
  assert.deepEqual(huntSourceTasks([{ ...legacy, decision: { ...legacy.decision, sourceWorkVersion: undefined } }], NOW), [], "deployment alone cannot launch the paused hunt or expand old Sends");
  const unresolved: ResolvedScope = { kind: "UNRESOLVED", decision: scope("AZ").decision, states: ["AZ"], why: "vintage absent" };
  assert.deepEqual(huntSourceTasks([unresolved], NOW), []);
  assert.equal(huntSourceTasks([scope("NH")], NOW).length, 7, "national sources, known PRL datasets, voting sites and native New Hampshire finance");
  const tasks = huntSourceTasks([scope("AZ"), scope("AZ", "owner-send-2")], NOW);
  assert.equal(tasks.length, 8);
  assert.equal(new Set(tasks.map(task => task.id)).size, tasks.length);
  for (const task of tasks) {
    assert.deepEqual(task.ownerInvocation?.instructions, ["owner-send-1", "owner-send-2"]);
    assert.ok(!ROUTINE_SOURCE_TASKS.some(standing => standing.id === task.id));
    assert.ok(task.contract.readerProjection);
    assert.ok(task.command.includes("--promote"));
  }
});

test("all registered manual contracts have an invocation disposition; PRL, voting sites and the AZ reference apply by the Send's geography, never one receipt (CH-11)", () => {
  const ordinary = scope("AZ");
  const matrix = manualProducerInvocationMatrix([ordinary], NOW);
  assert.deepEqual(matrix.map(row => row.id), MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(contract => contract.id));
  assert.equal(new Set(matrix.map(row => row.id)).size, matrix.length);
  assert.equal(matrix.find(row => row.id === "az-pima-local-finance")?.commandReady, false,
    "state membership does not establish Pima applicability");
  for (const id of ["candidate-profiles:AZ", "candidate-corpus:AZ", "officeholder-statements", "az-official-actions"]) {
    assert.equal(matrix.find(row => row.id === id)?.mode, "SCOPED_ADAPTER_OWED", `${id} waits on owed plain code, never on a person's review`);
  }
  assert.equal(matrix.find(row => row.id === "campaign-sites")?.mode, "EXISTING_DERIVED");
  assert.equal(matrix.find(row => row.id === "meeting-body-crosswalk")?.mode, "EXISTING_DERIVED");
  const ids = (sends: ResolvedScope[]) => huntSourceTasks(sends, "2026-09-28T08:00:00.000Z").map(task => task.id);
  assert.deepEqual(matrix.find(row => row.id === "candidate-profiles:AZ")?.instructionIds, ["owner-send-1"]);
  assert.deepEqual(matrix.find(row => row.id === "candidate-profiles:OH")?.instructionIds, []);
  const selected = (id: string) => id === "prl" || id.startsWith("voting-sites:") || id === "jurisdiction-operational-reference-az";
  assert.deepEqual(ids([scope("AZ", "any-send")]).filter(selected).sort(),
    ["jurisdiction-operational-reference-az", "prl", "voting-sites:AZ"]);
  assert.deepEqual(ids([scope("OH", "ohio-send")]).filter(selected).sort(), ["prl", "voting-sites:OH"]);
});

test("source admission resumes from durable failure/success clocks rather than rerunning each pass or restart", () => {
  const task = huntSourceTasks([scope("AZ")], NOW)[0]!;
  const now = Date.parse(NOW);
  assert.equal(routineTaskDue(task, undefined, now), true);
  assert.equal(routineTaskDue(task, { lastSucceededObservedAt: "2026-09-26T02:00:00.000Z" }, now), true);
  assert.equal(routineTaskDue(task, { lastAttemptedAt: NOW }, now + 60_000), false);
  assert.equal(routineTaskDue(task, { lastAttemptedAt: NOW }, now + task.retryMs), true);
  assert.equal(routineTaskDue(task, { lastAttemptedAt: NOW, lastSucceededObservedAt: NOW }, now + 2 * 86400_000), false);
  const base = scope("AZ", "next-send");
  const next = { ...base, decision: { ...base.decision, decidedAt: "2026-09-28T02:00:00.000Z" } };
  const nextTask = huntSourceTasks([next], "2026-09-28T02:00:00.000Z")[0]!;
  assert.equal(routineTaskDue(nextTask, { lastAttemptedAt: NOW, lastSucceededObservedAt: NOW }, now + 86400_000), true);
});

test("voting-site Sends invoke one registered child per state with exact state authority", () => {
  const votes = huntSourceTasks([scope("OH", "ohio-send"), scope("AZ", "arizona-send")], "2026-09-28T08:00:00.000Z")
    .filter(task => task.registeredContractId?.startsWith("voting-sites:"));
  assert.deepEqual(votes.map(task => task.id).sort(), ["voting-sites:AZ", "voting-sites:OH"]);
  const vote = votes.find(task => task.registeredContractId === "voting-sites:OH");
  assert.ok(vote);
  assert.equal(vote.scope, "US-OH:voting-sites");
  assert.deepEqual(vote.command, ["scripts/fetch-voting-sites.mts", "--state=OH", "--promote"]);
  assert.equal(vote.requestedUrl, "");
  const arizona = votes.find(task => task.id === "voting-sites:AZ")!;
  assert.deepEqual(arizona.ownerInvocation?.instructions, ["arizona-send"]);
  assert.equal(arizona.scope, "US-AZ:voting-sites");
  assert.ok(arizona.command.includes("--state=AZ"));
  const cwd = process.cwd();
  const envelope: RuntimeAuthorityEnvelope = { repo: cwd, sha: "a".repeat(40),
    capability: "MANUAL_CONTRACT", contract: vote.registeredContractId ?? null, parentPid: 42, nonce: "b".repeat(64) };
  const checkout = { repositoryRoot: cwd, headSha: envelope.sha, clean: true,
    detached: true, headOnOriginMain: true, readable: true };
  assert.equal(runtimeAuthorityIssue({ envelope, expectation: { capabilities: ["MANUAL_CONTRACT"],
    contract: "voting-sites:OH", immediateParentPid: 42 }, checkout, cwd }), null);
  assert.deepEqual(vote.ownerInvocation?.instructions, ["ohio-send"]);
});

test("all funded source Sends are admitted regardless of the former blackout", () => {
  const base = scope("AZ");
  const original = { ...base, decision: { ...base.decision,
    key: ORIGINAL_LIFETIME_HUNT.key, receiptId: ORIGINAL_LIFETIME_HUNT.receiptId,
    budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, budgetUsd: ORIGINAL_LIFETIME_HUNT.budgetUsd,
    decidedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt } };
  const other = { ...base, decision: { ...base.decision, receiptId: "another-send" } };
  const blackout = "2026-10-04T02:00:00.000Z";
  assert.deepEqual(admittedHuntSourceScopes([original, other], blackout), [original, other]);
  const changedBudget = { ...original, decision: { ...original.decision, budgetUsd: 51 } };
  assert.deepEqual(admittedHuntSourceScopes([changedBudget], blackout), [changedBudget]);
  assert.deepEqual(admittedHuntSourceScopes([original, other], "2026-10-05T12:00:00.000Z"), [original, other]);
});

test("a voting-sites candidate outcome emits the one source-task receipt expected by the supervisor", () => {
  const captured: string[] = [];
  const log = console.log;
  const candidate = { id: "cv-voting-sites" };
  const outcome = { candidate: { candidate, acquisitionSucceeded: true, state: "PROMOTED",
    receipt: { decision: "GOOD" }, lastKnownGoodVersion: candidate.id },
    promoted: { versionId: candidate.id }, confirmed: null } as unknown as PromotionOutcome;
  try {
    console.log = (...parts: unknown[]) => { captured.push(String(parts[0])); };
    printSourceRunnerReceipt("voting-sites:OH", candidate, outcome);
  } finally { console.log = log; }
  const parsed = parseRoutineRunnerReceipt(captured.join("\n"));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.receipt.source, "voting-sites:OH");
    assert.equal(parsed.receipt.candidateId, candidate.id);
  }
});

test("a pending publication is not hidden by another body's later success and keeps failure backoff", () => {
  const source = huntSourceTasks([scope("AZ")], NOW)[0]!;
  const task = { ...source, ownerInvocation: { ...source.ownerInvocation!, publicationPending: true as const } };
  const later = new Date(Date.parse(NOW) + 60_000).toISOString();
  assert.equal(routineTaskDue(task, { lastAttemptedAt: later, lastSucceededObservedAt: later }, Date.parse(later)), true);
  assert.equal(routineTaskDue(task, { lastAttemptedAt: later }, Date.parse(later) + 1), false);
  assert.equal(routineTaskDue(task, { lastAttemptedAt: later }, Date.parse(later) + task.retryMs), true);
});
