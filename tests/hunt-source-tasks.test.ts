import assert from "node:assert/strict";
import test from "node:test";
import { admittedHuntSourceScopes, huntSourceTasks } from "../lib/civic-data/hunt-source-tasks.ts";
import { manualProducerInvocationMatrix } from "../lib/civic-data/manual-producer-invocation.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { routineTaskDue, ROUTINE_SOURCE_TASKS } from "../lib/civic-data/runner.ts";
import type { ResolvedScope } from "../lib/control-plane/expansion/membership.ts";
import { DEFAULT_CONTRACT, type WorkItem } from "../lib/control-plane/work-item.ts";
import { runtimeAuthorityIssue, type RuntimeAuthorityEnvelope } from "../lib/civic-data/runtime-authority.ts";
import { votingSitesReceiptSource } from "../lib/civic-data/voting-sites-source-task.ts";
import { parseRoutineRunnerReceipt, printSourceRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import type { PromotionOutcome } from "../lib/civic-data/promotion.ts";

const NOW = "2026-09-27T02:00:00.000Z";
function scope(state: string, id = "owner-send-1"): ResolvedScope {
  return { kind: "RESOLVED", zctas: new Set(["85635"]), whole: new Set(["85635"]), fractions: new Map(), states: [state],
    decision: { key: "zcta:2020/85635", geography: { type: "zcta", geoid: "85635", version: "zcta:2020", label: "85635", stateAbbr: state },
      priority: 1, budgetUsd: 50, budgetStartedAt: NOW, sourceWorkVersion: 1, note: null, decidedAt: NOW, decidedBy: "owner-session", receiptId: id, previous: null } };
}

test("an actual resolved Send selects shared producers once, without expanding the standing portfolio", () => {
  assert.deepEqual(huntSourceTasks([], NOW), []);
  const legacy = scope("AZ");
  assert.deepEqual(huntSourceTasks([{ ...legacy, decision: { ...legacy.decision, sourceWorkVersion: undefined } }], NOW), [], "deployment alone cannot launch the paused hunt or expand old Sends");
  const unresolved: ResolvedScope = { kind: "UNRESOLVED", decision: scope("AZ").decision, states: ["AZ"], why: "vintage absent" };
  assert.deepEqual(huntSourceTasks([unresolved], NOW), []);
  assert.equal(huntSourceTasks([scope("NH")], NOW).length, 3);
  const tasks = huntSourceTasks([scope("AZ"), scope("AZ", "owner-send-2")], NOW);
  assert.equal(tasks.length, 4);
  for (const task of tasks) {
    assert.deepEqual(task.ownerInvocation?.instructions, ["owner-send-1", "owner-send-2"]);
    assert.ok(!ROUTINE_SOURCE_TASKS.some(standing => standing.id === task.id));
    assert.ok(task.contract.readerProjection);
    assert.ok(task.command.includes("--promote"));
  }
});

test("all registered manual contracts have an invocation disposition; only exact original 85635 adds scoped AZ reference and PRL", () => {
  const ordinary = scope("AZ");
  const matrix = manualProducerInvocationMatrix([ordinary], NOW);
  assert.deepEqual(matrix.map(row => row.id), MANUAL_PRODUCTION_SOURCE_CONTRACTS.map(contract => contract.id));
  assert.equal(new Set(matrix.map(row => row.id)).size, matrix.length);
  assert.equal(matrix.filter(row => row.id === "jurisdiction-operational-reference-az").length, 1);
  assert.equal(matrix.find(row => row.id === "az-sos-ballot")?.commandReady, false,
    "a manual projection is not source acquisition");
  assert.equal(matrix.find(row => row.id === "az-pima-local-finance")?.instructionIds.length, 0,
    "state membership does not establish Pima applicability");
  assert.equal(matrix.find(row => row.id === "campaign-sites")?.mode, "EXISTING_DERIVED");
  assert.equal(matrix.find(row => row.id === "meeting-body-crosswalk")?.mode, "EXISTING_DERIVED");
  const original = { ...ordinary, decision: { ...ordinary.decision,
    key: ORIGINAL_LIFETIME_HUNT.key, receiptId: ORIGINAL_LIFETIME_HUNT.receiptId,
    budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, budgetUsd: ORIGINAL_LIFETIME_HUNT.budgetUsd,
    decidedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt } };
  const tasks = huntSourceTasks([original], "2026-09-28T08:00:00.000Z");
  assert.deepEqual(tasks.filter(task => ["prl", "jurisdiction-operational-reference", "jurisdiction-operational-reference-az"].includes(task.id)).map(task => task.id), ["jurisdiction-operational-reference-az", "prl"]);
  assert.equal(tasks.length, 6);
  const wrongReceipt = { ...original, decision: { ...original.decision, receiptId: "another-send" } };
  assert.equal(huntSourceTasks([wrongReceipt], "2026-09-28T08:00:00.000Z").length, 4);
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

test("only the exact original Cochise work binding admits the source-scoped voting-site task", () => {
  const base = scope("AZ");
  const original = { ...base, decision: { ...base.decision,
    key: ORIGINAL_LIFETIME_HUNT.key, receiptId: ORIGINAL_LIFETIME_HUNT.receiptId,
    budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, budgetUsd: ORIGINAL_LIFETIME_HUNT.budgetUsd,
    decidedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt } };
  const work: WorkItem = { id: "wi-cochise", project: "original-85635", subject: "az:county:county-of-cochise",
    obligation: "Acquire Cochise County 2026 voting sites", why: "Exact original Send county source remains owed",
    priority: "P1", state: "OPEN", contract: DEFAULT_CONTRACT, dependencies: [], routeTaskIds: [],
    escalations: [], createdAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, transitions: [],
    autonomousPlan: { version: 1, ownerInstructions: [ORIGINAL_LIFETIME_HUNT.receiptId], capability: "VOTER_ACCESS",
      jurisdiction: "AZ", sourceRegistryReferences: ["az:county:county-of-cochise"], seedUrls: [],
      sources: [], acquisition: [], engineering: [], auditScope: "SOURCE_UNIVERSE",
      contract: { schemaVersion: 2, recordClass: "VOTER_ACCESS_ROUTE", subjectId: "az:county:county-of-cochise",
        requiredFields: ["bodyName", "state", "kind", "url", "coverage", "coverageEvidence"],
        identity: { namespace: "az:county:county-of-cochise:VOTER_ACCESS", keyFields: ["url"] },
        jurisdiction: { country: "US", state: "AZ", canonicalId: "az:county:county-of-cochise" },
        completenessScope: "Official Cochise County voter-access routes remain owed.", expectedSourceDate: null,
        methodVersion: 0, sourceScope: { sourceId: "unobserved:cochise", publisher: "Cochise County",
          routeIds: [], canonicalUrls: [], observationArtifactIds: [] },
        extraction: { format: "UNSUPPORTED", mediaType: "unobserved", fields: {}, reason: "Await official capture" },
        verification: { required: true, authorities: [] } } } };
  const now = "2026-09-28T12:00:00.000Z";
  const tasks = huntSourceTasks([original], now, [work]);
  const vote = tasks.find(task => task.id === "voting-sites:cochise-2026");
  assert.ok(vote);
  assert.deepEqual(vote.command.slice(-2), ["--promote", "--cochise-only"]);
  assert.equal(vote.registeredContractId, "voting-sites");
  assert.equal(votingSitesReceiptSource(true), vote.id);
  assert.equal(votingSitesReceiptSource(false), vote.registeredContractId);
  const cwd = process.cwd();
  const envelope: RuntimeAuthorityEnvelope = { repo: cwd, sha: "a".repeat(40),
    capability: "MANUAL_CONTRACT", contract: vote.registeredContractId, parentPid: 42, nonce: "b".repeat(64) };
  const checkout = { repositoryRoot: cwd, headSha: envelope.sha, clean: true,
    detached: true, headOnOriginMain: true, readable: true };
  assert.equal(runtimeAuthorityIssue({ envelope, expectation: { capabilities: ["MANUAL_CONTRACT"],
    contract: "voting-sites", immediateParentPid: 42 }, checkout, cwd }), null);
  assert.match(runtimeAuthorityIssue({ envelope: { ...envelope, contract: vote.id },
    expectation: { capabilities: ["MANUAL_CONTRACT"], contract: "voting-sites", immediateParentPid: 42 },
    checkout, cwd }) ?? "", /not voting-sites/);
  assert.deepEqual(vote.ownerInvocation?.instructions, [ORIGINAL_LIFETIME_HUNT.receiptId]);
  assert.equal(huntSourceTasks([original], now, [{ ...work, subject: "az:county:county-of-pima" }]).some(task => task.id === vote.id), false);
  assert.equal(huntSourceTasks([original], now, [{ ...work, state: "VERIFIED_COMPLETE" }]).some(task => task.id === vote.id), false);
  assert.equal(huntSourceTasks([{ ...original, decision: { ...original.decision, receiptId: "different" } }], now, [work]).some(task => task.id === vote.id), false);
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

test("Cochise candidate outcome emits the one source-task receipt expected by the supervisor", () => {
  const captured: string[] = [];
  const log = console.log;
  const candidate = { id: "cv-cochise" };
  const outcome = { candidate: { candidate, acquisitionSucceeded: true, state: "PROMOTED",
    receipt: { decision: "GOOD" }, lastKnownGoodVersion: candidate.id },
    promoted: { versionId: candidate.id }, confirmed: null } as unknown as PromotionOutcome;
  try {
    console.log = (...parts: unknown[]) => { captured.push(String(parts[0])); };
    printSourceRunnerReceipt(votingSitesReceiptSource(true), candidate, outcome);
  } finally { console.log = log; }
  const parsed = parseRoutineRunnerReceipt(captured.join("\n"));
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.receipt.source, "voting-sites:cochise-2026");
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
