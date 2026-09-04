import assert from "node:assert/strict";
import test from "node:test";
import { beginAttempt, claim, endAttempt, ZERO_COST, type Attempt, type AttemptCost } from "../lib/control-plane/attempt.ts";
import { defaultGrant } from "../lib/control-plane/capability.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { createRouteTask, type RouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { auditWorkerFleetView, readWorkerFleet, workerFleetCountClaims, workerFleetRenderedNumbers, type WorkerFleetReadback } from "../lib/control-plane/workers/readback.ts";
import type { CivicExtractionContract, FleetResult, ComputationRole, WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

const NOW = "2026-09-03T10:00:00.000Z";
const START = "2026-09-03T09:00:00.000Z";
const CONTRACT: CivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1, subjectId: "pima-captured-events", sourceBodyId: 1,
  sourceBodyName: "Board of Supervisors", publisherSlug: "pima", requiredFields: ["EventId"],
  completenessScope: "Captured fixture rows", expectedSourceDate: null,
};

async function stored(repos: ControlPlaneRepositories, role: ComputationRole, suffix = "one", options: {
  at?: string; outcome?: Attempt["outcome"]; cost?: AttemptCost; withResult?: boolean; reopened?: boolean;
} = {}) {
  const at = options.at ?? START;
  const worker = { role, provider: role === "ADVERSARIAL_AUDITOR" ? "anthropic" : "deterministic", version: "worker/version", instance: `${role}:${suffix}` };
  const item = createWorkItem({ project: "readback-test", subject: CONTRACT.subjectId, obligation: `${role}:${suffix}`, why: "Test canonical worker visibility", now: at });
  const base = createRouteTask({ workItemId: item.id, routeId: `worker:${role}:${suffix}`, routeLabel: role, target: "held-artifact", inherited: false, now: at });
  const task: RouteTask = { ...base, workerTask: { schemaVersion: 1, role, artifactId: "held-artifact", contract: CONTRACT,
    producerResultId: null, validatorResultId: null, auditScope: "CAPTURED_ARTIFACT", implementationVersion: "worker/version" } };
  const open = beginAttempt({ routeTaskId: task.id, workItemId: item.id, worker,
    lease: claim(task.id, worker.instance, at, 60_000, null), now: at, methodVersion: 72, policyVersion: "worker-policy" });
  const outcome = options.outcome === undefined ? "COMPLETED" : options.outcome;
  const cost = options.cost ?? { ...ZERO_COST, durationMs: 125, usd: null };
  const attempt = outcome === null ? { ...open, artifactIds: ["held-artifact"], cost } : endAttempt(open, outcome, NOW, { artifactIds: ["held-artifact"], cost, ...(outcome !== "COMPLETED" ? { abortReason: "named execution failure" } : {}) });
  const completedTask: RouteTask = { ...task, state: outcome === "COMPLETED" ? "RESULT_RECORDED" : outcome === null ? "CLAIMED" : "RECLAIMABLE", attemptIds: [attempt.id] };
  const resultId = `result:${role}:${suffix}`;
  const result: FleetResult = role === "PARSER" ? {
    role, attemptId: attempt.id, implementation: "parser", version: "1", schemaVersion: 1,
    recordClass: "LEGISTAR_EVENTS", artifactId: "held-artifact", contentHash: "hash", acquiredByAttemptId: "acquired",
    subjectId: CONTRACT.subjectId, verdict: "EXTRACTED", records: [], spans: [], warnings: [], declaredRowCount: null, sourceRowCount: 0, actualRowCount: 0,
  } : role === "VALIDATOR" ? {
    role, attemptId: attempt.id, producerAttemptId: "producer", verdict: "PASS", checked: ["IDENTITY"], findings: [], artifactIds: ["held-artifact"], validatedRecordCount: 1,
  } : {
    role, attemptId: attempt.id, producerAttemptId: "producer", validatorAttemptId: "validator", verdict: options.reopened ? "BROKE" : "SURVIVED",
    startedFrom: ["EVIDENCE_VAULT"], attacks: [], findings: options.reopened ? [{ code: "AUDIT_DENOMINATOR_INCOMPLETE", detail: "Official evidence establishes another event.", severity: "BLOCKING" }] : [], artifactIds: ["held-artifact"], survivingRecordCount: options.reopened ? 0 : 1, reopenRequired: options.reopened ?? false,
  };
  const record: WorkerResultRecord = {
    id: resultId, schemaVersion: 1, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id, worker,
    grant: defaultGrant({ role, project: "readback-test", policyVersion: "worker-policy", grantedAt: at }),
    methodVersion: 72, policyVersion: "worker-policy", startedAt: at, endedAt: NOW,
    executionMode: role === "ADVERSARIAL_AUDITOR" ? "MODEL_ASSISTED" : "DETERMINISTIC", cost,
    usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null },
    inputArtifactIds: ["held-artifact"], inputResultIds: [], semanticHash: "semantic-hash", result,
    completion: { closedAttempt: attempt, completedTask, taskRevision: 1, attemptRevision: 1 },
  };
  await repos.attempts.put(attempt.id, attempt, NOW);
  await repos.routeTasks.put(task.id, completedTask, NOW);
  await repos.workItems.put(item.id, options.reopened ? { ...item, state: "REOPENED", transitions: [...item.transitions, { from: item.state, to: "REOPENED", at: NOW, by: `worker-result:${resultId}`, why: "Auditor broke the candidate" }] } : item, NOW);
  if (options.withResult !== false) await repos.workerResults.append(item.id, record.id, record, NOW);
  return { attempt, task: completedTask, item, record };
}

function held(view: WorkerFleetReadback): asserts view is Extract<WorkerFleetReadback, { status: "HELD" }> {
  assert.equal(view.status, "HELD", JSON.stringify(view));
}

test("canonical worker readback shows each role, measured costs, matched verdicts and current reopened findings", async () => {
  const repos = createMemoryRepositories();
  await stored(repos, "PARSER");
  await stored(repos, "VALIDATOR", "one", { cost: { ...ZERO_COST, durationMs: null, usd: 0 } });
  const auditor = await stored(repos, "ADVERSARIAL_AUDITOR", "one", { reopened: true, cost: { ...ZERO_COST, durationMs: 1500, usd: 0.01234 } });
  const view = await readWorkerFleet(repos, NOW);
  held(view);
  assert.deepEqual(view.roles.map((role) => role.role), ["PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR", "ACQUIRER", "DETECTIVE", "ENGINEERING"]);
  assert.equal(view.roles[0].attempts[0].cost, null, "Missing USD is never replaced with zero.");
  assert.equal(view.roles[1].attempts[0].cost?.value, 0, "An actually recorded zero remains distinct from null.");
  assert.equal(view.roles[1].attempts[0].duration, null, "Missing duration is never calculated from unrelated timestamps.");
  const row = view.roles[2].attempts[0];
  assert.equal(row.attemptId, auditor.attempt.id);
  assert.equal(row.outcome, "COMPLETED");
  assert.equal(row.verdict, "BROKE");
  assert.equal(row.resultStatus, "MATCHED");
  assert.equal(row.cost?.value, 0.01234);
  assert.equal(row.duration?.value, 1500);
  assert.equal(row.artifacts.value, 1);
  assert.equal(row.workItemState, "REOPENED");
  assert.equal(row.reopenedByResult, true);
  assert.equal(row.findings[0].code, "AUDIT_DENOMINATOR_INCOMPLETE");
  assert.equal(auditWorkerFleetView(view).ok, true);
  assert.ok(workerFleetRenderedNumbers(view).every((number) => number.source && number.contract && number.observedAt === NOW && number.denominator !== null));
});

test("crashed and running Attempts cannot borrow a successful typed verdict", async () => {
  const repos = createMemoryRepositories();
  await stored(repos, "PARSER", "crashed", { outcome: "CRASHED" });
  await stored(repos, "VALIDATOR", "running", { outcome: null });
  const view = await readWorkerFleet(repos, NOW);
  held(view);
  for (const role of view.roles.slice(0, 2)) {
    assert.equal(role.attempts[0].resultStatus, "REFUSED");
    assert.equal(role.attempts[0].verdict, null);
    assert.match(role.attempts[0].resultDetail, /UNCOMMITTED_OR_MISMATCHED/);
  }
  assert.equal(view.roles[0].attempts[0].outcome, "CRASHED");
  assert.equal(view.roles[1].attempts[0].outcome, "RUNNING");
});

test("stale worker identity and missing result references refuse certification instead of hiding the Attempt", async () => {
  const repos = createMemoryRepositories();
  const entry = await stored(repos, "PARSER", "stale", { withResult: false });
  await repos.workerResults.append(entry.item.id, entry.record.id, { ...entry.record, worker: { ...entry.record.worker, instance: "other-process" } }, NOW);
  await stored(repos, "VALIDATOR", "missing", { withResult: false });
  const view = await readWorkerFleet(repos, NOW);
  held(view);
  assert.equal(view.roles[0].attempts[0].resultStatus, "REFUSED");
  assert.equal(view.roles[0].attempts[0].verdict, null);
  assert.equal(view.roles[1].attempts[0].resultStatus, "NOT_RECORDED");
  assert.equal(view.roles[1].attempts[0].outcome, "COMPLETED");
});

test("latest rows are bounded independently per role and stated counts equal the rendered row population", async () => {
  const repos = createMemoryRepositories();
  for (let index = 0; index < 7; index += 1) await stored(repos, "PARSER", String(index), { at: `2026-09-03T09:0${index}:00.000Z` });
  await stored(repos, "VALIDATOR");
  const view = await readWorkerFleet(repos, NOW);
  held(view);
  assert.equal(view.roles[0].attempts.length, 5);
  assert.equal(view.roles[0].shown.value, 5);
  assert.equal(view.roles[0].shown.denominator, 7);
  assert.equal(view.roles[0].attempts[0].worker.instance, "PARSER:6");
  assert.equal(view.roles[1].shown.value, 1);
  assert.ok(workerFleetCountClaims(view).every((claim) => claim.stated === claim.rendered));
  const inconsistent = { ...view, roles: view.roles.map((role, index) => index ? role : { ...role, shown: { ...role.shown, value: 6 } }) };
  assert.equal(auditWorkerFleetView(inconsistent).ok, false);
});

test("queue due counts come from worker RouteTasks and preserve future and non-queued states", async () => {
  const repos = createMemoryRepositories();
  const base = await stored(repos, "PARSER");
  const states = ["PENDING", "RECLAIMABLE", "PENDING", "CLAIMED", "POLICY_DENIED"] as const;
  for (const [index, state] of states.entries()) {
    const task: RouteTask = { ...base.task, id: `extra-task-${index}`, state, attemptIds: [], createdAt: index === 2 ? "2026-09-04T00:00:00.000Z" : START };
    await repos.routeTasks.put(task.id, task, NOW);
  }
  const view = await readWorkerFleet(repos, NOW);
  held(view);
  assert.equal(view.roles[0].pending.value, 3);
  assert.equal(view.roles[0].pending.denominator, 6);
  assert.equal(view.roles[0].due.value, 2);
  assert.equal(view.roles[0].due.denominator, 3);
  assert.match(view.roles[0].due.contract, /lease, policy and budget/);
});

test("failed canonical reads are named, never rendered as empty queues, and never expose error payloads", async () => {
  const repos = createMemoryRepositories();
  const unavailable: ControlPlaneRepositories = { ...repos, attempts: { ...repos.attempts, list: async () => { throw new Error("private connection details must not be displayed"); } } };
  const view = await readWorkerFleet(unavailable, NOW);
  assert.equal(view.status, "UNAVAILABLE");
  assert.match(JSON.stringify(view), /canonical Attempts failed/);
  assert.doesNotMatch(JSON.stringify(view), /private connection details/);
  assert.equal(workerFleetRenderedNumbers(view).length, 0);
  assert.ok(!("roles" in view), "No phantom empty role rows accompany a failed read.");
});

test("every displayed metric requires a source, timestamp, denominator and interpretation", async () => {
  const view = await readWorkerFleet(createMemoryRepositories(), NOW);
  held(view);
  assert.equal(auditWorkerFleetView(view).ok, true, "A reachable empty store is an observed zero, with explicit denominators.");
  const unknown = { ...view, roles: view.roles.map((role, index) => index ? role : { ...role, pending: { ...role.pending, source: "", contract: "" } }) };
  assert.equal(auditWorkerFleetView(unknown).ok, false);
  const invalidDate = await readWorkerFleet(createMemoryRepositories(), "not a timestamp");
  assert.equal(invalidDate.status, "UNAVAILABLE");
});

test("orphan worker results are named and cannot fabricate an Attempt row", async () => {
  const sourceRepos = createMemoryRepositories();
  const entry = await stored(sourceRepos, "ADVERSARIAL_AUDITOR");
  const repos = createMemoryRepositories();
  await repos.workerResults.append(entry.item.id, entry.record.id, entry.record, NOW);
  const view = await readWorkerFleet(repos, NOW);
  held(view);
  assert.ok(view.notices[0].includes("WORKER_RESULT_ATTEMPT_MISSING"));
  assert.equal(view.roles[2].shown.value, 0);
  assert.equal(view.roles[2].attempts.length, 0);
});
