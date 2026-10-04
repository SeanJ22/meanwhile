import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { installOperationalReferenceBundle, operationalReferenceBundle } from "@/lib/civic-data/operational-references.ts";
import { ZERO_COST, type AttemptCost } from "@/lib/control-plane/attempt.ts";
import { AUTONOMOUS_FLEET_PROOF_PROJECT, isNonProductionCost, type CostEntry } from "@/lib/control-plane/cost.ts";
import {
  ASSIGNMENT_BUDGET_CODE,
  AssignmentBudgetGate,
  armAssignmentBudget,
  assignmentBudgetsOf,
  assignmentCycleReading,
  assignmentMembership,
  assignmentSpend,
  isAssignmentCycleReading,
  type AssignmentBudgetSpec,
} from "@/lib/control-plane/expansion/assignment-budget.ts";
import {
  applyDispatchWork,
  assignmentEntry,
  dispatchWorkReading,
  dispatchWorkTarget,
  planDispatchWork,
  type DispatchWorkTarget,
  type DispatchWorkWorld,
  type DurableRowFacts,
} from "@/lib/control-plane/expansion/dispatch-work.ts";
import { SCOPE_BUDGET_CODE, armExpansionBudget } from "@/lib/control-plane/expansion/membership.ts";
import { loadExpansionPlan } from "@/lib/control-plane/expansion/runner-load.ts";
import { expansionScopesOf, isExpansionScopeDecision, withScopeSet, type ExpansionScopeDecision } from "@/lib/control-plane/expansion/scopes.ts";
import { isProofRecord } from "@/lib/control-plane/assignment-view.ts";
import { receiptIdFor, type ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import type { GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "@/lib/control-plane/gateway/admin-config.ts";
import { registerRouteTask, registerWorkItem } from "@/lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";
import { createRouteTask } from "@/lib/control-plane/route-task.ts";
import { chargePurposeOf, dispatchOne, proofChargeOf, type DeclaredExecutor, type RunWork } from "@/lib/control-plane/scheduler/dispatch.ts";
import { openOccurrence, standing, syncObligations, type StandingObligation } from "@/lib/control-plane/scheduler/durable.ts";
import { OWNER_DISPATCH, isScheduled, scheduleObligation, withAssignment, type FreshnessObligation, type ObligationAssignment } from "@/lib/control-plane/scheduler/obligation.ts";
import { UNREAD_MEETING_PARTITIONS, trackedStatesFromOperationalReference } from "@/lib/control-plane/scheduler/provider-inputs.ts";
import { localJurisdictionsProvider } from "@/lib/control-plane/scheduler/providers/local-jurisdictions.ts";
import { MEETINGS_DISCOVERY_RECORD_CLASS, meetingsDiscoveryProvider } from "@/lib/control-plane/scheduler/providers/meetings-discovery.ts";
import { buildRegistry } from "@/lib/control-plane/scheduler/registry.ts";
import { RESEARCH_INTENT_LOG_KEY, type ResearchIntent } from "@/lib/control-plane/scheduler/research-policy.ts";
import { createWorkItem } from "@/lib/control-plane/work-item.ts";
import { questionOfObligation, validateWorkQuestions } from "@/lib/control-plane/work-question.ts";
import type { JurisdictionRegistry } from "@/lib/hunt/jurisdiction-universe.ts";

/**
 * **AN ASSIGNMENT IS A THING THE SYSTEM KNOWS ABOUT.** (2026-09-25.)
 *
 * MW-001 — a Send records itself on every obligation it creates or finds on a
 * clock, appended, and every charge names its obligation and its Sends.
 * MW-021 — each Send's own budget, spent / held / left, honoured by name.
 * MW-002 — every round names its question; the owner's questions travel typed.
 * MW-013 — every charge says what it was for; Money splits by it.
 * MW-024 — proof runs are their own project and marked; real money, apart.
 * And the malformed policy row fails closed.
 *
 * In-memory repositories, committed registries, fixed clocks. No network, no
 * database, no model.
 */

const ROOT = join(import.meta.dirname, "..");
const T0 = "2026-09-25T15:00:00.000Z";
const T1 = "2026-09-25T16:00:00.000Z";
const T2 = "2026-09-25T17:00:00.000Z";

const REGISTRIES: Record<"az" | "nh" | "nj", JurisdictionRegistry> = {
  az: JSON.parse(readFileSync(join(ROOT, "data/states/az/jurisdictions/az.json"), "utf8")),
  nh: JSON.parse(readFileSync(join(ROOT, "data/states/nh/jurisdictions/nh.json"), "utf8")),
  nj: JSON.parse(readFileSync(join(ROOT, "data/states/nj/jurisdictions/nj.json"), "utf8")),
};
installOperationalReferenceBundle(operationalReferenceBundle(REGISTRIES));

/** One runner cycle up to the dispatch-work step, exactly as the runner builds it. */
async function cycleWorld(repos: ControlPlaneRepositories, now: string): Promise<DispatchWorkWorld> {
  const rows = await repos.obligations.listWhere(["materializedBy"], OWNER_DISPATCH);
  const materialized = { ids: new Set(rows.map((r) => r.id)) };
  const registry = buildRegistry(
    [
      localJurisdictionsProvider({ trackedStates: trackedStatesFromOperationalReference(), materialized: () => materialized, meetingPartitions: UNREAD_MEETING_PARTITIONS }),
      meetingsDiscoveryProvider({ materialized: () => materialized }),
    ],
    { root: ROOT, nowIso: now },
  );
  const sync = await syncObligations(repos, registry.obligations, now);
  const durable = new Map<string, DurableRowFacts>();
  for (const row of [...sync.all, ...(sync.outside ?? [])]) durable.set(row.id, { active: row.active, materializedBy: row.materializedBy, assignments: row.assignments });
  return {
    registries: new Map(Object.entries(REGISTRIES)),
    territory: null,
    territoryDetail: null,
    corpus: registry.units.map((u) => ({ id: u.obligation.id, subjectId: u.obligation.subjectId })),
    durable,
    meetingPartitions: UNREAD_MEETING_PARTITIONS,
  };
}

const CONTEXT = { at: T0, modelLaneClosed: null, ceilingUsd: 105, ceilingSource: "OVERRIDE" as const, writes: "APPLIED" as const, planOnlyWhy: null };

/* ======================================================================= *
 * MW-001 — the Send is recorded on the work it reached
 * ======================================================================= */

test("a Send records itself on what it created and on what it found already on a clock — appended, never overwritten", async () => {
  const repos = createMemoryRepositories();
  const first = dispatchWorkTarget({ intentId: "i-1", note: "Pima Arizona", requestedAt: T0 });
  const plan1 = planDispatchWork({ targets: [first], world: await cycleWorld(repos, T0) });
  const carried = plan1.targets[0].instances.filter((p) => p.state === "CARRIED" && p.instance.carriage === "OWED").map((p) => p.instance.obligation.id);
  assert.ok(carried.length > 0, "Pima's standing custodian clocks are carried: the Send reaches them without creating them");
  const a1 = await applyDispatchWork(repos, plan1, { now: T0 });
  assert.ok(a1.written.length > 0);
  assert.equal(a1.marksDeferred?.length, 0);

  for (const id of a1.written) {
    assert.deepEqual((await repos.obligations.mustRead(id)).value.assignments, [{ assignmentKey: "dispatch:i-1", ref: "i-1", relation: "CREATED", at: T0 }], `${id} records the Send that created it`);
  }
  for (const id of carried) {
    assert.deepEqual(
      (await repos.obligations.mustRead(id)).value.assignments,
      [{ assignmentKey: "dispatch:i-1", ref: "i-1", relation: "REORDERED", at: T0 }],
      `${id} was already on a clock: the Send put it first, and says so on the row`,
    );
  }
  assert.equal(a1.marked?.length, carried.length);
  assert.equal(a1.recorded?.length, a1.written.length + carried.length, "everything recorded this cycle is handed to the budgets");
  const r1 = dispatchWorkReading(plan1, a1, CONTEXT).targets[0];
  assert.equal(r1.assignment?.recordedThisCycle, a1.written.length + carried.length);

  /* A second Send reaching the same rows appends; the first Send's record is untouched. */
  const second = dispatchWorkTarget({ intentId: "i-2", note: "Pima Arizona again", requestedAt: T1 });
  const a2 = await applyDispatchWork(repos, planDispatchWork({ targets: [second], world: await cycleWorld(repos, T1) }), { now: T1 });
  assert.equal(a2.written.length, 0, "nothing is created twice");
  const created = (await repos.obligations.mustRead(a1.written[0])).value.assignments!;
  assert.deepEqual(created[0], { assignmentKey: "dispatch:i-1", ref: "i-1", relation: "CREATED", at: T0 }, "never overwritten");
  assert.deepEqual(created[1], { assignmentKey: "dispatch:i-2", ref: "i-2", relation: "REORDERED", at: T1 }, "another Send created it: this one found it on a clock");
  assert.equal((await repos.obligations.mustRead(carried[0])).value.assignments?.length, 2, "one obligation serves both Sends");

  /* The same Send again records nothing new. */
  const again = planDispatchWork({ targets: [first], world: await cycleWorld(repos, T2) });
  assert.equal(again.marks.length, 0);
  const a3 = await applyDispatchWork(repos, again, { now: T2 });
  assert.equal(a3.written.length + (a3.marked?.length ?? 0), 0);
});

test("a new Send to the same key appends a new receipt and does not erase the old hunt", () => {
  const key = "zcta:2020/85635";
  const original = { assignmentKey:key, ref:"original-receipt", relation:"CREATED" as const, at:T0 };
  const next = { assignmentKey:key, ref:"new-receipt", relation:"REORDERED" as const, at:T1 };
  const marks = withAssignment([original], next);
  assert.deepEqual(marks, [original,next]);
  assert.equal(withAssignment(marks,next),marks,"the same receipt remains idempotent");
  const members=assignmentMembership([{id:"ob-1",subjectId:"az:sierra-vista",assignments:marks}]);
  assert.equal(members.byInstruction.get(JSON.stringify([key,"original-receipt"]))?.created.size,1);
  assert.equal(members.byInstruction.get(JSON.stringify([key,"new-receipt"]))?.reordered.size,1);
});

test("all REORDERED records persist alongside all creations in one pass", async () => {
  const repos = createMemoryRepositories();
  const target = dispatchWorkTarget({ intentId: "i-9", note: "Pima Arizona", requestedAt: T0 });
  const plan = planDispatchWork({ targets: [target], world: await cycleWorld(repos, T0) });
  const applied = await applyDispatchWork(repos, plan, { now: T0 });
  assert.equal(applied.written.length, plan.writes.length, "creations go first");
  assert.equal(applied.marked?.length, plan.marks.length);
  assert.equal(applied.marksDeferred?.length, 0);
  const reading = dispatchWorkReading(plan, applied, CONTEXT);
  assert.equal(reading.targets[0].assignment?.marksDeferred, 0);
  assert.doesNotMatch(reading.targets[0].says.join(" "), /do not record it yet|write budget/);
});

function plan0Writes(world: DispatchWorkWorld, target: DispatchWorkTarget): number {
  return planDispatchWork({ targets: [target], world }).writes.length;
}

test("a created row whose creator is not on record is never guessed into a Send", () => {
  const world: DispatchWorkWorld = {
    registries: new Map(Object.entries(REGISTRIES)),
    territory: null,
    territoryDetail: null,
    corpus: [],
    durable: new Map(),
    meetingPartitions: UNREAD_MEETING_PARTITIONS,
  };
  const target = dispatchWorkTarget({ intentId: "i-3", note: "Pima Arizona", requestedAt: T0 });
  const plan = planDispatchWork({ targets: [target], world });
  const id = plan.writes[0].instance.obligation.id;
  /* The same row, created by a Send before Sends were kept on the row: materialized, no record. */
  const legacy = planDispatchWork({
    targets: [target],
    world: { ...world, durable: new Map([[id, { active: true, materializedBy: OWNER_DISPATCH }]]) },
  });
  assert.equal(legacy.marks.filter((m) => m.obligationId === id).length, 0, "no REORDERED is written over an unknown creator");
  const known = planDispatchWork({
    targets: [target],
    world: { ...world, durable: new Map([[id, { active: true, materializedBy: OWNER_DISPATCH, assignments: [{ assignmentKey: "county:2020/04019", ref: "r", relation: "CREATED", at: T0 }] }]]) },
  });
  assert.equal(known.marks.filter((m) => m.obligationId === id).length, 1, "a row another Send created is recorded REORDERED for this one");
});

test("syncObligations keeps the Sends a row records when a provider's signals move, and withAssignment only appends", async () => {
  const repos = createMemoryRepositories();
  const entry: ObligationAssignment = { assignmentKey: "county:2020/04019", ref: "r-1", relation: "CREATED", at: T0 };
  const o = { id: "freshness:jurisdiction:az:city:city-of-tucson#x", recordClass: "local-jurisdiction", subjectId: "az:city:city-of-tucson", routeId: "x", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null };
  await repos.obligations.put(o.id, standing({ ...o, assignments: [entry] }, T0), T0);
  const sync = await syncObligations(repos, [{ ...o, observedChangeRateHours: 48 }], T1);
  assert.deepEqual(sync.refreshed.map((r) => r.id), [o.id]);
  assert.deepEqual((await repos.obligations.mustRead(o.id)).value.assignments, [entry], "a registration pass never drops the owner's Sends");

  const held = [entry];
  assert.equal(withAssignment(held, { ...entry, at: T2 }), held, "the same Send and relation is recorded once");
  assert.equal(withAssignment(held, { ...entry, relation: "REORDERED" }).length, 2);
});

/* ======================================================================= *
 * MW-001 / MW-013 / MW-024 — every charge says what it was for
 * ======================================================================= */

const COST: AttemptCost = { ...ZERO_COST, usd: 0.25, inputTokens: 1000, outputTokens: 100, requestCount: 1, durationMs: 10 };

function walker(kind: "DISPOSED" | "ABORTED"): DeclaredExecutor {
  const run: RunWork = async () =>
    kind === "DISPOSED"
      ? {
          ranAs: "DETERMINISTIC",
          kind: "DISPOSED",
          disposition: {
            disposition: "WALKED_NO_YIELD",
            observation: { rawCount: 0, normalizedCount: 0, routeOnlyCount: 0, earliest: null, latest: null },
            permission: "ALLOWED",
            transport: "REACHABLE",
            note: "reached, nothing there",
          },
          cost: COST,
          detail: "walked",
        }
      : { ranAs: "DETERMINISTIC", kind: "ABORTED", cost: COST, detail: "reached no boundary" };
  return { lane: "DETERMINISTIC", workerFor: ({ holder }) => ({ role: "ACQUIRER", provider: "we-the-people", version: "http-executor/1.0", instance: holder }), run };
}

async function dispatchFixture(obligation: FreshnessObligation, executor: DeclaredExecutor, extra: { costProject?: string; nonProduction?: true } = {}) {
  const repos = createMemoryRepositories();
  const item = createWorkItem({ project: "freshness", subject: obligation.subjectId, obligation: `${obligation.id}#1`, why: "test", now: T0 });
  const task = createRouteTask({ workItemId: item.id, routeId: obligation.routeId ?? "r", routeLabel: "r", target: "t", inherited: true, now: T0 });
  await registerWorkItem(repos, item, T0);
  await registerRouteTask(repos, task, T0);
  const scheduled = scheduleObligation(obligation, Date.parse(T0));
  assert.ok(isScheduled(scheduled));
  await dispatchOne(repos, { obligation: scheduled, routeTaskId: task.id, holder: "w", now: T0, leaseTtlMs: 60_000, maturity: () => "GRADUATED", executor, ...extra });
  return (await repos.costs.readAll())[0];
}

const SENT: ObligationAssignment = { assignmentKey: "county:2020/04019", ref: "r-9", relation: "REORDERED", at: T0 };
const ROW: StandingObligation = standing(
  { id: "ob-1", recordClass: "local-jurisdiction", subjectId: "az:city:city-of-tucson", routeId: "ROUTE", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: "2026-09-20T00:00:00.000Z", assignments: [SENT] },
  T0,
);

test("every charge the dispatcher writes names its obligation, its Sends, its record class, its question and what it came to", async () => {
  const disposed = await dispatchFixture(ROW, walker("DISPOSED"));
  assert.equal(disposed.obligationId, "ob-1");
  assert.deepEqual(disposed.assignmentKeys, ["county:2020/04019"]);
  assert.equal(disposed.recordClass, "local-jurisdiction");
  assert.equal(disposed.question, "HAS_CHANGED", "a standing clock read before asks whether it changed — the round's own question");
  assert.equal(disposed.resultKind, "WALKED_NO_YIELD");
  assert.equal(disposed.jurisdiction, "az:city:city-of-tucson", "the body, as before");
  assert.equal(disposed.project, "freshness");
  assert.equal(disposed.nonProduction, undefined, "production is not marked");

  const aborted = await dispatchFixture({ ...ROW, assignments: undefined }, walker("ABORTED"));
  assert.equal(aborted.resultKind, "NO_DISPOSITION");
  assert.deepEqual(aborted.assignmentKeys, [], "no Send reached it: an empty list is a fact, not a gap");

  /* A hand-built obligation (a worker task, a proof) is not a standing round: no question is guessed for it. */
  const { occurrenceCount: _o, openOccurrenceId: _p, nextDueAt: _n, updatedAt: _u, ...handBuilt } = ROW;
  assert.equal(chargePurposeOf(handBuilt as FreshnessObligation).question, undefined);
});

test("a proof run charges under its own project, marked non-production — real money, kept apart", async () => {
  assert.deepEqual(proofChargeOf("freshness"), {}, "production is written exactly as before");
  assert.deepEqual(proofChargeOf(AUTONOMOUS_FLEET_PROOF_PROJECT), { costProject: AUTONOMOUS_FLEET_PROOF_PROJECT, nonProduction: true });
  const charge = await dispatchFixture(ROW, walker("DISPOSED"), proofChargeOf(AUTONOMOUS_FLEET_PROOF_PROJECT));
  assert.equal(charge.project, AUTONOMOUS_FLEET_PROOF_PROJECT);
  assert.equal(charge.nonProduction, true);
  assert.equal(charge.cost.usd, 0.25, "the dollars are the dollars");
  assert.equal(isNonProductionCost(charge), true);
  assert.equal(isNonProductionCost({ project: "freshness" }), false);
  assert.equal(isProofRecord({ project: AUTONOMOUS_FLEET_PROOF_PROJECT }), true, "its assignments sit in the proof lane");
});

/* ======================================================================= *
 * MW-002 — every round names its question
 * ======================================================================= */

test("a round names its question from the obligation's own state, never from the job type, and none when that state is missing", async () => {
  const base = { recordClass: "local-jurisdiction" };
  assert.equal(questionOfObligation({ ...base, lastWorkedAt: null }), "HAVE_IT");
  assert.equal(questionOfObligation({ ...base, lastWorkedAt: T0 }), "HAS_CHANGED");
  assert.equal(questionOfObligation({ ...base, lastWorkedAt: T0, absentUntil: T1 }), "STILL_CORRECT");
  assert.equal(questionOfObligation({ recordClass: MEETINGS_DISCOVERY_RECORD_CLASS, lastWorkedAt: T0 }), "ANYTHING_MISSING");
  assert.equal(questionOfObligation({ recordClass: MEETINGS_DISCOVERY_RECORD_CLASS, lastWorkedAt: null }), "HAVE_IT");
  assert.equal(questionOfObligation(base), null, "not recorded, never a default");

  const repos = createMemoryRepositories();
  const fresh = standing({ id: "ob-q", recordClass: MEETINGS_DISCOVERY_RECORD_CLASS, subjectId: "az:city:city-of-tucson", routeId: "own-site", active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null, materializedBy: OWNER_DISPATCH }, T0);
  await repos.obligations.put(fresh.id, fresh, T0);
  const opened = await openOccurrence(repos, { obligation: fresh, dueAt: T0, now: T0 });
  assert.equal(opened?.workItem.question, "HAVE_IT", "created for missing coverage: do we have it at all");
  assert.equal((await repos.workItems.mustRead(opened!.workItem.id)).value.question, "HAVE_IT", "persisted on the work item");

  assert.equal(createWorkItem({ project: "p", subject: "s", obligation: "o", why: "w", now: T0 }).question, undefined);
  assert.equal(
    createWorkItem({ project: "p", subject: "s", obligation: "o", why: "w", now: T0, question: "CONSISTENT" }).id,
    createWorkItem({ project: "p", subject: "s", obligation: "o", why: "w", now: T0 }).id,
    "the question is not part of the id",
  );
});

const NOW = "2026-09-25T04:00:00.000Z";
function gatewayDeps(repos: ControlPlaneRepositories): GatewayDeps {
  let ms = Date.parse(NOW);
  return { repos, now: () => new Date((ms += 1000)).toISOString(), currentStateVersion: "world-1", codeSha: null };
}
const PIMA = { type: "county", geoid: "04019", version: "county:2020", label: "Pima County, Arizona", stateAbbr: "AZ" };
function request(type: string, input: Record<string, unknown>, key: string): ActionRequest {
  return { type, subject: "x", input, stateVersion: null, idempotencyKey: key, caller: "OWNER_SESSION", actorRef: "adm_test-session" };
}

test("the owner's questions travel typed through expansion.scope.set onto the decision, and onto every obligation the Send reaches", async () => {
  const repos = createMemoryRepositories();
  const deps = gatewayDeps(repos);
  const out = await submit(request("expansion.scope.set", { geography: PIMA, priority: 1, budgetUsd: 5, note: "start here", questions: ["HAS_CHANGED", "HAVE_IT", "HAVE_IT"] }, "question-0001"), deps);
  assert.equal(out.ok, true, out.receipt.says);
  assert.match(out.receipt.says, /Your questions are kept on it and on every piece of work it reaches: Do we have this record at all\? Has it changed since we last looked\?/);
  const [scope] = expansionScopesOf((await repos.adminConfig.read(ADMIN_CONFIG_ID))?.value ?? null).scopes;
  assert.deepEqual(scope.questions, ["HAVE_IT", "HAS_CHANGED"], "typed, once each, in the canonical order");
  assert.equal(scope.note, "start here", "and never folded into the words");

  const refused = await submit(request("expansion.scope.set", { geography: PIMA, priority: 1, budgetUsd: 5, questions: ["IS_IT_NICE"] }, "question-0002"), deps);
  assert.equal(refused.ok, false);
  assert.match(refused.receipt.says, /IS_IT_NICE is not one of the six questions/);
  assert.equal(validateWorkQuestions(undefined).ok, true);
  assert.equal(isExpansionScopeDecision({ ...scope, questions: ["NOPE"] }), false, "a stored question list outside the six is a malformed decision");

  const target: DispatchWorkTarget = { kind: "SCOPE", key: scope.key, label: "Pima", requestedAt: T0, ref: scope.receiptId, budgetUsd: 5, scope: {} as never, questions: scope.questions };
  assert.deepEqual(assignmentEntry(target, "CREATED", T0), { assignmentKey: scope.key, ref: receiptIdFor("expansion.scope.set", "question-0001"), relation: "CREATED", at: T0, questions: ["HAVE_IT", "HAS_CHANGED"] });
});

test("a deployment may carry its own budget, kept on the DISPATCH intent", async () => {
  const repos = createMemoryRepositories();
  const deps = gatewayDeps(repos);
  const withBudget = await submit(request("fleet.deployHere", { note: "Pima Arizona", budgetUsd: "2.5" }, "deploy-0001"), deps);
  assert.equal(withBudget.ok, true, withBudget.receipt.says);
  assert.match(withBudget.receipt.says, /may spend \$2\.50 in any rolling 24 hours/);
  const without = await submit(request("fleet.deployHere", { note: "Maricopa Arizona" }, "deploy-0002"), deps);
  assert.match(without.receipt.says, /carries no budget of its own/);
  const bad = await submit(request("fleet.deployHere", { note: "x", budgetUsd: -1 }, "deploy-0003"), deps);
  assert.equal(bad.ok, false);
  const log = (await repos.researchIntents.read(RESEARCH_INTENT_LOG_KEY)) as readonly ResearchIntent[];
  const intents = log.filter((r) => r.kind === "INTENT" && r.action === "DISPATCH");
  assert.equal(intents.length, 2);
  assert.equal(intents.find((i) => i.kind === "INTENT" && i.note === "Pima Arizona" && i.budgetUsd === 2.5) !== undefined, true);
  assert.equal(intents.find((i) => i.kind === "INTENT" && i.note === "Maricopa Arizona" && i.budgetUsd === undefined) !== undefined, true);
  const specs = assignmentBudgetsOf({ scopes: [], intents: log });
  assert.equal(specs.length, 1, "only the deployment sent with a budget has one");
  assert.equal(specs[0].budgetUsd, 2.5);
  assert.match(specs[0].key, /^dispatch:DISPATCH:/);
});

/* ======================================================================= *
 * MW-021 — each Send's own budget, honoured by name
 * ======================================================================= */

const A: AssignmentBudgetSpec = { key: "county:2020/04019", kind: "SCOPE", label: "Pima County, Arizona", ref: "r-a", budgetUsd: 5, sentAt: "2026-09-24T00:00:00.000Z" };
const B: AssignmentBudgetSpec = { key: "dispatch:i-b", kind: "DISPATCH", label: "Tucson meetings", ref: "i-b", budgetUsd: 3, sentAt: "2026-09-25T00:00:00.000Z" };
const JOINED = "2026-09-25T00:00:00.000Z";

function row(id: string, subjectId: string, keys: readonly string[], at = JOINED) {
  return { id, subjectId, assignments: keys.map((k): ObligationAssignment => ({ assignmentKey: k, ref: k === A.key ? A.ref : k === B.key ? B.ref : "r", relation: "REORDERED", at })) };
}
function charge(over: Partial<CostEntry> & { readonly usd: number | null; readonly at?: string }): CostEntry {
  return {
    attemptId: `a-${Math.random()}`,
    workItemId: "w",
    routeTaskId: null,
    routeId: null,
    source: null,
    jurisdiction: over.jurisdiction ?? null,
    project: "freshness",
    role: "SCOUT",
    cost: { ...ZERO_COST, usd: over.usd },
    recordedAt: over.at ?? T0,
    ...(over.obligationId !== undefined ? { obligationId: over.obligationId } : {}),
  };
}
function gate(specs: readonly AssignmentBudgetSpec[], rows: ReturnType<typeof row>[], costs: CostEntry[] | null, over: { intentsReadable?: boolean } = {}): AssignmentBudgetGate {
  return armAssignmentBudget({ now: T0, specs, membership: assignmentMembership(rows), costs, worstCaseUsd: 0.6, intentsReadable: over.intentsReadable ?? true });
}

test("a Scout on a spent assignment is refused by the assignment's own name, with spent and held", () => {
  const g = gate([A], [row("ob-a", "az:city:city-of-tucson", [A.key])], [charge({ obligationId: "ob-a", usd: 4.6 })]);
  const v = g.admit("ob-a");
  assert.equal(v.admit, false);
  if (!v.admit) {
    assert.equal(v.code, ASSIGNMENT_BUDGET_CODE);
    assert.notEqual(v.code, "CEILING", "never the shared ceiling");
    assert.match(v.why, /^assignment "Pima County, Arizona" \(county:2020\/04019\)'s \$5\.00 budget is spent: \$4\.60 spent, \$0\.00 held in the rolling 24 hours/);
  }
  assert.equal(g.state(A.key)?.refused, 1);
});

test("an admitted Scout holds its worst case until it settles, and the next is refused on spent plus held", () => {
  const g = gate([A], [row("ob-1", "s1", [A.key]), row("ob-2", "s2", [A.key]), row("ob-3", "s3", [A.key])], [charge({ obligationId: "ob-1", usd: 3.5 })]);
  assert.deepEqual(g.admit("ob-1"), { admit: true, runsUnder: A.key, keys: [A.key] });
  assert.equal(g.admit("ob-2").admit, true);
  assert.equal(g.state(A.key)?.heldUsd, 1.2);
  const third = g.admit("ob-3");
  assert.equal(third.admit, false);
  if (!third.admit) assert.match(third.why, /\$3\.50 spent, \$1\.20 held/);
  g.settle("ob-1", 0.4);
  const s = g.state(A.key)!;
  assert.equal(Number(s.heldUsd.toFixed(2)), 0.6);
  assert.equal(Number(s.spentUsd!.toFixed(2)), 3.9);
  assert.equal(Number(s.leftUsd!.toFixed(2)), 0.5);
  g.settle("ob-2", null);
  assert.equal(g.state(A.key)?.spentUsd, null, "a Scout that reported no dollars leaves the budget unmeasured");
  assert.equal(g.check("ob-3").admit, false, "and an unmeasured budget holds its work");
});

test("an assignment's spend is its members' charges since they joined; a charge naming no obligation counts by its body", () => {
  const members = assignmentMembership([row("ob-a", "az:city:city-of-tucson", [A.key])]).byKey.get(A.key)!;
  const spend = assignmentSpend(
    [
      charge({ obligationId: "ob-a", usd: 1, at: "2026-09-25T01:00:00.000Z" }),
      charge({ obligationId: "ob-a", usd: 7, at: "2026-09-24T23:00:00.000Z" }), // before it joined
      charge({ obligationId: "ob-other", usd: 9, jurisdiction: "az:city:city-of-tucson" }), // another obligation, same body
      charge({ usd: 0.5, jurisdiction: "az:city:city-of-tucson", at: "2026-09-25T02:00:00.000Z" }), // names no obligation
      charge({ usd: 2, jurisdiction: "az:city:city-of-phoenix" }),
    ],
    members,
    "2026-09-24T15:00:00.000Z",
    T0,
  );
  assert.equal(spend.usd, 1.5);
  assert.equal(spend.bySubject, 1);
});

test("work several Sends reached runs while any budgeted one has room — under the most recent — and is refused only when none does", () => {
  const both = [row("ob-x", "s", [A.key, B.key])];
  /* A spent, B (more recent) has room: runs under B, held against both. */
  const g1 = gate([A, B], both, [charge({ obligationId: "ob-x", usd: 2 })].concat([charge({ obligationId: "ob-x", usd: 2.9 })]));
  // ob-x spent 4.9: A (5.00) has no room for 0.6; B (3.00) has none either.
  const refused = g1.admit("ob-x");
  assert.equal(refused.admit, false);
  if (!refused.admit) {
    assert.match(refused.why, /^assignment "Tucson meetings" \(dispatch:i-b\)'s \$3\.00 budget is spent/, "named by the most recent Send");
    assert.match(refused.why, /the 1 other Send\(s\) this work belongs to have no room either/);
  }
  assert.equal(g1.state(A.key)?.refused, 1);
  assert.equal(g1.state(B.key)?.refused, 1);

  const bigA = { ...A, budgetUsd: 50 };
  const g2 = gate([bigA, B], both, [charge({ obligationId: "ob-x", usd: 2.9 })]);
  const v = g2.admit("ob-x");
  assert.deepEqual(v, { admit: true, runsUnder: bigA.key, keys: [A.key, B.key] }, "B is spent; the older A still has room, so it runs under A");
  assert.equal(g2.state(bigA.key)?.heldUsd, 0.6);
  assert.equal(g2.state(B.key)?.heldUsd, 0.6, "its worst case is held against every Send it belongs to");
  g2.settle("ob-x", 0.3);
  assert.equal(Number(g2.state(B.key)!.spentUsd!.toFixed(2)), 3.2, "a charge counts toward every Send it belongs to");

  const bigB = { ...B, budgetUsd: 50 };
  assert.equal((gate([A, bigB], both, [charge({ obligationId: "ob-x", usd: 4.9 })]).check("ob-x") as { runsUnder: string }).runsUnder, bigB.key, "the most recent with room");
});

test("a Send with no budget of its own adds no limit; work no Send reached passes", () => {
  const g = gate([], [row("ob-u", "s", ["dispatch:no-budget"])], []);
  assert.deepEqual(g.admit("ob-u"), { admit: true, runsUnder: null, keys: ["dispatch:no-budget"] });
  assert.deepEqual(g.admit("ob-none"), { admit: true, runsUnder: null, keys: [] });
});

test("an assignment budget that cannot be checked holds the work, by name", () => {
  const unread = gate([A], [row("ob-a", "s", [A.key])], null);
  const v1 = unread.admit("ob-a");
  assert.equal(v1.admit, false);
  if (!v1.admit) assert.match(v1.why, /the cost ledger could not be read, so assignment "Pima County, Arizona" \(county:2020\/04019\)'s \$5\.00 budget cannot be checked/);

  const blind = gate([], [row("ob-d", "s", ["dispatch:i-z"])], [], { intentsReadable: false });
  const v2 = blind.admit("ob-d");
  assert.equal(v2.admit, false, "an unread instruction log cannot say whether a deployment carries a budget");
  if (!v2.admit) assert.match(v2.why, /the owner's instructions could not be read, so the budget of assignment dispatch:i-z cannot be known/);

  const unmeasured = gate([A], [row("ob-a", "s", [A.key])], [charge({ obligationId: "ob-a", usd: null })]);
  const v3 = unmeasured.admit("ob-a");
  assert.equal(v3.admit, false, "an unpriced charge is counted at its worst case, so the $5 budget is spent");
  if (!v3.admit) assert.match(v3.why, /budget is spent: \$10\.56 spent/);
});

test("the runner's reading names what each Send reached and its budget — spent, held, left — with the window", () => {
  const rows = [row("ob-c", "s1", []), row("ob-r", "s2", [A.key])];
  rows[0] = { id: "ob-c", subjectId: "s1", assignments: [{ assignmentKey: A.key, ref: A.ref, relation: "CREATED", at: JOINED }] };
  const membership = assignmentMembership(rows, [{ obligationId: "ob-new", subjectId: "s3", entry: { assignmentKey: "dispatch:i-q", ref: "i-q", relation: "CREATED", at: T0 } }]);
  const costs = [charge({ obligationId: "ob-c", usd: 1.25 })];
  const g = armAssignmentBudget({ now: T0, specs: [A], membership, costs, worstCaseUsd: 0.6, intentsReadable: true });
  g.admit("ob-r");
  const reading = assignmentCycleReading({ at: T0, now: T0, gate: g, specs: [A], membership, costs, intentsReadable: true, labels: new Map([["dispatch:i-q", "Tucson"]]) });
  assert.equal(isAssignmentCycleReading(reading), true);
  const a = reading.assignments.find((x) => x.key === A.key)!;
  assert.deepEqual(a.members, { created: 1, reordered: 1, createdSample: ["ob-c"], reorderedSample: ["ob-r"] });
  assert.equal(a.budget?.spentUsd, 1.25);
  assert.equal(a.budget?.heldUsd, 0.6);
  assert.equal(Number(a.budget?.leftUsd?.toFixed(2)), 3.15);
  assert.equal(a.budget?.windowHours, 24);
  assert.equal(a.budget?.until, T0);
  const q = reading.assignments.find((x) => x.key === "dispatch:i-q")!;
  assert.equal(q.label, "Tucson");
  assert.equal(q.budget, null);
  assert.match(q.budgetWhyNot ?? "", /sent without a budget of its own/);
});

/* ======================================================================= *
 * Admin — Fleet · Work reads the stored record; Money splits by purpose
 * ======================================================================= */

function decision(): ExpansionScopeDecision {
  return withScopeSet([], { geography: { type: "county", geoid: "04019", version: "county:2020", label: "Pima County, Arizona", stateAbbr: "AZ" }, priority: 1, budgetUsd: 5, note: null, questions: ["HAVE_IT"], decidedAt: JOINED, decidedBy: "adm", receiptId: "r-a" }).scopes[0];
}

test("a Send's completion uses the same created and reordered members as its linked work list", async () => {
  const { evaluateAssignmentFromRecords, memberRecordsForSend } = await import("../lib/control-plane/assignment-completion.ts");
  const membership = assignmentMembership([], [
    { obligationId: "created", subjectId: "s1", entry: { assignmentKey: A.key, ref: "r-a", relation: "CREATED", at: JOINED } },
    { obligationId: "reordered", subjectId: "s2", entry: { assignmentKey: A.key, ref: "r-a", relation: "REORDERED", at: JOINED } },
  ]);
  const members = memberRecordsForSend(A.key, membership, [{ id: "reordered", lastWorkedAt: JOINED }]);
  const completion = evaluateAssignmentFromRecords({ assignmentKey: A.key, obligations: members, debtFor: () => null, now: T0 });
  assert.equal(completion.kind, "NOT_COMPLETE");
  if (completion.kind !== "NOT_COMPLETE") return;
  assert.equal(completion.members, 2);
  assert.equal(completion.settled, 1);
  assert.deepEqual(completion.exceptions.map((e) => e.obligationId), ["created"]);
});

/* ======================================================================= *
 * A malformed policy row fails closed
 * ======================================================================= */

test("a policy row that is not a policy holds paid work, by name, instead of reading as no scope", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { nonsense: true } as unknown as AdminConfig, T0);
  const load = await loadExpansionPlan({ repos, root: ROOT, now: T0, obligations: [] });
  assert.notEqual(load.plan, null, "the owner's budgets did not silently disappear");
  assert.equal(load.plan?.malformedScopes, 1);
  assert.match(load.conditions.join(" "), /the owner's policy row is on record and is not a readable policy/);
  const { gate: g } = armExpansionBudget(load.plan!, { now: T0, costs: [], worstCaseUsd: 0.6 });
  const v = g.admit("ob-1", "az:city:city-of-tucson");
  assert.equal(v.admit, false);
  if (!v.admit) {
    assert.equal(v.code, SCOPE_BUDGET_CODE);
    assert.match(v.why, /could not be read, so no scope budget can be checked; paid work is held/);
  }

  /* Scopes the broken row still carries readably are kept and placed; the row itself still holds paid work. */
  const salvaged = createMemoryRepositories();
  await salvaged.adminConfig.put(ADMIN_CONFIG_ID, { expansionScopes: [decision()] } as unknown as AdminConfig, T0);
  const kept = await loadExpansionPlan({
    repos: salvaged,
    root: ROOT,
    now: T0,
    obligations: [],
    loadLookup: async () => {
      throw new Error("no lookup in this test");
    },
    loadTerritory: () => {
      throw new Error("no territory in this test");
    },
  });
  assert.equal(kept.plan?.scopes.length, 1);
  assert.equal(kept.plan?.malformedScopes, 1);
  assert.match(kept.conditions.join(" "), /1 scope\(s\) on it were still readable/);
});

test("MW-015: a Send is complete only when every member is settled, and the instruction says which are not", async () => {
  const { evaluateAssignmentFromRecords, COMPLETION_EXCEPTION_CAP } = await import("../lib/control-plane/assignment-completion.ts");
  const member = (id: string, extra: Record<string, unknown> = {}) => ({ id, assignments: [{ assignmentKey: A.key, relation: "CREATED", at: JOINED }], lastWorkedAt: JOINED, openOccurrenceId: null, absentUntil: null, ...extra });
  const debts = new Map([["ob-failing", { consecutiveFailures: 2, detail: "HTTP 503 from the county", retryAt: T0 }]]);
  const evaluate = (obligations: readonly ReturnType<typeof member>[]) =>
    evaluateAssignmentFromRecords({ assignmentKey: A.key, obligations, debtFor: (id) => debts.get(id) ?? null, now: T0 });

  assert.equal(evaluate([]).kind, "NO_MEMBERS", "no members is never complete");
  assert.equal(evaluate([member("ob-a"), member("ob-b")]).kind, "COMPLETE");

  const open = evaluate([
    member("ob-a"),
    member("ob-failing"),
    member("ob-never", { lastWorkedAt: null }),
    member("ob-absent", { absentUntil: "2099-01-01T00:00:00.000Z" }),
    member("ob-running", { openOccurrenceId: "occ-9" }),
    member("ob-other", { assignments: [{ assignmentKey: "dispatch:elsewhere", relation: "CREATED", at: JOINED }] }),
  ]);
  assert.equal(open.kind, "NOT_COMPLETE", "visited is not finished");
  if (open.kind !== "NOT_COMPLETE") return;
  assert.equal(open.members, 5, "only this Send's members count");
  assert.equal(open.settled, 1);
  assert.deepEqual(open.exceptions.map((e) => [e.obligationId, e.kind]), [
    ["ob-absent", "UNSETTLED"], ["ob-failing", "REFUSED"], ["ob-never", "UNSETTLED"], ["ob-running", "UNSETTLED"],
  ]);
  assert.match(open.exceptions.find((e) => e.obligationId === "ob-failing")!.says, /last 2 attempts failed \(HTTP 503/);

  // Capped list, whole counts.
  const many = evaluate(Array.from({ length: COMPLETION_EXCEPTION_CAP + 5 }, (_, i) => member(`ob-n${String(i).padStart(2, "0")}`, { lastWorkedAt: null })));
  assert.equal(many.kind === "NOT_COMPLETE" ? many.exceptions.length : -1, COMPLETION_EXCEPTION_CAP);
  assert.equal(many.kind === "NOT_COMPLETE" ? many.unsettledCount : -1, COMPLETION_EXCEPTION_CAP + 5);
});
