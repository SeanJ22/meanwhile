import assert from "node:assert/strict";
import test from "node:test";

import {
  beginAttempt,
  claim,
  endAttempt,
  type Attempt,
  type AttemptOutcome,
  type WorkerRef,
} from "../lib/control-plane/attempt.ts";
import {
  DispositionRefused,
  createRouteTask,
  denyByPolicy,
  disposeRoute,
  isOutstanding,
  isTerminal,
  reclaim,
  type RouteDisposition,
  type RouteTask,
} from "../lib/control-plane/route-task.ts";
import { evaluateCompletion } from "../lib/control-plane/completion.ts";
import {
  completionBlockingEscalations,
  createEscalation,
  createWorkItem,
  escalationAgeHours,
  openEscalations,
  type Escalation,
  type WorkItem,
} from "../lib/control-plane/work-item.ts";
import { completionSnapshot, T0, T1, T2 } from "./control-plane-fixtures.ts";

const T_FAR = "2026-12-01T00:00:00.000Z";
const TTL = 10 * 60 * 1000;

const WORKER: WorkerRef = {
  role: "ACQUIRER",
  provider: "test",
  version: "v1",
  instance: "worker-a",
};

function openAttempt(taskId: string, workItemId = "wi-x", instance = "worker-a"): Attempt {
  const lease = claim(taskId, instance, T0, TTL, null);
  return beginAttempt({
    routeTaskId: taskId,
    workItemId,
    worker: { ...WORKER, instance },
    lease,
    now: T0,
    methodVersion: 55,
    policyVersion: "p1",
  });
}

function endedAttempt(
  taskId: string,
  outcome: AttemptOutcome,
  opts: { workItemId?: string; instance?: string; artifactIds?: readonly string[]; abortReason?: string } = {},
): Attempt {
  return endAttempt(openAttempt(taskId, opts.workItemId ?? "wi-x", opts.instance ?? "worker-a"), outcome, T1, {
    artifactIds: opts.artifactIds ?? (outcome === "COMPLETED" ? ["art-1"] : []),
    abortReason: outcome === "COMPLETED" ? undefined : (opts.abortReason ?? `ended as ${outcome}`),
  });
}

const OK_DISPOSITION = (over: Partial<RouteDisposition> = {}): RouteDisposition => ({
  disposition: "INGESTED",
  attemptId: "",
  at: T1,
  artifactIds: ["art-1"],
  observation: { rawCount: 4, normalizedCount: 4, routeOnlyCount: 0, earliest: null, latest: null },
  permission: "ALLOWED",
  transport: "REACHABLE",
  note: "walked",
  ...over,
});

function walked(
  item: WorkItem,
  routeId: string,
  disposition: RouteDisposition["disposition"],
  opts: { inherited?: boolean; artifactIds?: readonly string[] } = {},
): RouteTask {
  const artifactIds = opts.artifactIds ?? [`art-${routeId}`];
  const task = createRouteTask({
    workItemId: item.id,
    routeId,
    routeLabel: routeId,
    target: "example.gov",
    inherited: opts.inherited ?? true,
    now: T0,
  });
  const a = endedAttempt(task.id, "COMPLETED", { workItemId: item.id, instance: `w-${routeId}`, artifactIds });
  return disposeRoute(
    task,
    a,
    OK_DISPOSITION({
      attemptId: a.id,
      disposition,
      artifactIds,
      // A zero is only admissible from a route that answered; keep the fixture
      // honest rather than exercising a shape disposeRoute already refuses.
      transport: "REACHABLE",
    }),
  );
}


function contractItem(over: {
  floor: readonly string[];
  acceptableDispositions?: readonly RouteDisposition["disposition"][] | null;
  escalations?: readonly Escalation[];
}): WorkItem {
  const item = createWorkItem({
    project: "meanwhile",
    subject: "ocd-division/country:us/state:az/county:pima",
    obligation: "Enumerate every explicit future Board of Supervisors meeting instance",
    why: "Readers are shown a future meeting universe; an incomplete one is a false claim.",
    priority: "P0",
    contract: {
      inheritedRouteFloor: over.floor,
      requiresValidation: false,
      acceptableDispositions: over.acceptableDispositions ?? null,
    },
    now: T0,
  });
  return over.escalations ? { ...item, escalations: over.escalations } : item;
}

test("SEEDED: a contract narrows the acceptable dispositions and an inherited route lands outside it", () => {
  const item = contractItem({
    floor: ["legistar-events", "legistar-eventdates"],
    acceptableDispositions: ["INGESTED"],
  });
  const tasks = [
    walked(item, "legistar-events", "INGESTED"),
    walked(item, "legistar-eventdates", "WALKED_NO_YIELD"),
  ];

  const verdict = evaluateCompletion(completionSnapshot({ item, routeTasks: tasks }), "VERIFIED_COMPLETE");

  assert.equal(verdict.mayComplete, false, "a declared contract clause must be enforced, not decorative");
  const outside = verdict.refusals.filter((r) => r.code === "DISPOSITION_OUTSIDE_CONTRACT");
  assert.equal(outside.length, 1, "exactly the offending route refuses");
  assert.equal(outside[0].subject, tasks[1].id, "the subject is the RouteTask id, not a count");
  assert.match(outside[0].detail, /WALKED_NO_YIELD/, "the detail names the actual disposition");
  assert.match(outside[0].detail, /legistar-eventdates/, "the detail names the route label");
  assert.match(outside[0].detail, /permitted: INGESTED/, "the detail names the permitted set");
});

test("POSITIVE CONTROL: the same WorkItem completes once the offending route is INGESTED", () => {
  const item = contractItem({
    floor: ["legistar-events", "legistar-eventdates"],
    acceptableDispositions: ["INGESTED"],
  });
  const tasks = [
    walked(item, "legistar-events", "INGESTED"),
    walked(item, "legistar-eventdates", "INGESTED"),
  ];

  const verdict = evaluateCompletion(completionSnapshot({ item, routeTasks: tasks }), "VERIFIED_COMPLETE");
  assert.equal(verdict.mayComplete, true, verdict.refusals.map((r) => r.detail).join(" | "));
  assert.ok(
    verdict.satisfied.some((s) => /contract disposition set: 2 inherited route/.test(s)),
    "a PASS on a non-null clause must be recorded in `satisfied`, so an audit can see it was checked",
  );
});

test("acceptableDispositions null preserves the governed default exactly", () => {
  const item = contractItem({ floor: ["legistar-events"], acceptableDispositions: null });
  const verdict = evaluateCompletion(
    completionSnapshot({ item, routeTasks: [walked(item, "legistar-events", "WALKED_NO_YIELD")] }),
    "VERIFIED_COMPLETE",
  );
  assert.equal(verdict.mayComplete, true, verdict.refusals.map((r) => r.detail).join(" | "));
  assert.ok(
    !verdict.satisfied.some((s) => /contract disposition set/.test(s)),
    "a null clause is not reported as checked; it was never a clause",
  );
});

test("the narrow reading: a mid-walk DISCOVERED route is not governed by the contract's set", () => {
  const item = contractItem({ floor: ["legistar-events"], acceptableDispositions: ["INGESTED"] });
  const discovered = walked(item, "some-bonus-portal", "NOT_APPLICABLE", { inherited: false });

  const verdict = evaluateCompletion(
    completionSnapshot({ item, routeTasks: [walked(item, "legistar-events", "INGESTED"), discovered] }),
    "VERIFIED_COMPLETE",
  );

  assert.deepEqual(
    verdict.refusals.filter((r) => r.code === "DISPOSITION_OUTSIDE_CONTRACT").map((r) => r.subject),
    [],
    "the contract's set governs the inherited floor it narrows, never every route ever discovered",
  );
  assert.equal(verdict.mayComplete, true, verdict.refusals.map((r) => r.detail).join(" | "));
});

test("acceptableDispositions only TIGHTENS: naming an open disposition does not make it terminal", () => {
  const item = contractItem({
    floor: ["clerk-portal"],
    acceptableDispositions: ["INGESTED", "BLOCKED_CURRENTLY"],
  });
  const blocked = walked(item, "clerk-portal", "BLOCKED_CURRENTLY");

  const verdict = evaluateCompletion(completionSnapshot({ item, routeTasks: [blocked] }), "VERIFIED_COMPLETE");
  assert.equal(verdict.mayComplete, false, "a wall a contract tolerates is still a wall");
  assert.ok(
    verdict.refusals.some((r) => r.code === "ROUTE_TASK_STILL_OUTSTANDING" && r.subject === blocked.id),
    "clause 2 still refuses an OPEN disposition; the contract cannot widen what closes an obligation",
  );
});

test("SEEDED: a COMPLETED Attempt launders another Attempt's id into a disposition", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "Legistar /Events",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = endedAttempt(task.id, "COMPLETED", { instance: "worker-a" });
  const b = endedAttempt(task.id, "COMPLETED", { instance: "worker-b" });
  assert.notEqual(a.id, b.id, "the fixture is only meaningful if the two Attempts differ");

  assert.throws(
    () => disposeRoute(task, a, OK_DISPOSITION({ attemptId: b.id })),
    (err: unknown) =>
      err instanceof DispositionRefused &&
      /names Attempt/.test((err as Error).message) &&
      (err as Error).message.includes(b.id) &&
      (err as Error).message.includes(a.id),
    "the refusal must name both the claimed Attempt and the presenting one",
  );

  assert.throws(
    () => disposeRoute(task, a, OK_DISPOSITION({ attemptId: "" })),
    /names Attempt \(none\)/,
  );
});

test("POSITIVE CONTROL: the Attempt that earned it may write it", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "Legistar /Events",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = endedAttempt(task.id, "COMPLETED");
  const disposed = disposeRoute(task, a, OK_DISPOSITION({ attemptId: a.id }));
  assert.equal(disposed.state, "DISPOSED");
  assert.equal(disposed.disposition?.attemptId, a.id);
});

test("SEEDED: a disposition cites an artifact its own Attempt never recorded", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "Granicus ViewPublisher",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = endedAttempt(task.id, "COMPLETED", { artifactIds: ["art-mine"] });

  assert.throws(
    () =>
      disposeRoute(
        task,
        a,
        OK_DISPOSITION({ attemptId: a.id, artifactIds: ["art-mine", "art-someone-elses"] }),
      ),
    (err: unknown) =>
      err instanceof DispositionRefused &&
      /art-someone-elses/.test((err as Error).message) &&
      /never recorded/.test((err as Error).message),
    "evidence borrowed from another execution is evidence for another claim",
  );

  const empty = endedAttempt(task.id, "COMPLETED", { instance: "worker-b", artifactIds: [] });
  assert.throws(
    () => disposeRoute(task, empty, OK_DISPOSITION({ attemptId: empty.id, artifactIds: ["art-1"] })),
    /it holds none/,
  );
});

test("POSITIVE CONTROL: a disposition citing a SUBSET of its Attempt's artifacts is accepted", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "R",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = endedAttempt(task.id, "COMPLETED", { artifactIds: ["art-p1", "art-p2", "art-p3"] });
  const disposed = disposeRoute(
    task,
    a,
    OK_DISPOSITION({ attemptId: a.id, artifactIds: ["art-p1", "art-p3"] }),
  );
  assert.deepEqual(disposed.disposition?.artifactIds, ["art-p1", "art-p3"]);
  assert.equal(isTerminal(disposed), true);
});

function pendingTask(routeId = "r"): RouteTask {
  return createRouteTask({
    workItemId: "wi-x",
    routeId,
    routeLabel: routeId,
    target: "t",
    inherited: true,
    now: T0,
  });
}

test("SEEDED: a foreign Attempt reclaims a RouteTask it never walked", () => {
  const task = pendingTask();
  const foreign = endedAttempt("rt-somewhere-else", "CRASHED", { abortReason: "died elsewhere" });
  assert.throws(
    () => reclaim(task, foreign),
    (err: unknown) =>
      err instanceof DispositionRefused &&
      /may not reclaim/.test((err as Error).message) &&
      (err as Error).message.includes(task.id),
  );
});

test("SEEDED: a still-open Attempt is not dead and cannot be reclaimed against", () => {
  const task = pendingTask();
  const live = openAttempt(task.id);
  assert.equal(live.outcome, null, "the fixture must actually still be running");
  assert.throws(
    () => reclaim(task, live),
    (err: unknown) =>
      err instanceof DispositionRefused && /has not ended/.test((err as Error).message),
    "reclaiming underneath a live worker duplicates its side effect against the publisher",
  );
});

test("SEEDED: a COMPLETED Attempt is a lost disposition, never a crash", () => {
  const task = pendingTask();
  const done = endedAttempt(task.id, "COMPLETED");
  assert.throws(
    () => reclaim(task, done),
    (err: unknown) =>
      err instanceof DispositionRefused && /LOST DISPOSITION/.test((err as Error).message),
    "recycling a completed-but-undisposed Attempt as debris deletes the evidence of our own bug",
  );
});

test("POSITIVE CONTROL: every genuinely dead outcome reclaims its own task", () => {
  for (const outcome of ["TIMED_OUT", "LEASE_EXPIRED", "CRASHED", "ABORTED"] as const) {
    const task = pendingTask(`r-${outcome}`);
    const dead = endedAttempt(task.id, outcome, {
      artifactIds: ["art-partial"],
      abortReason: `worker ${outcome} during pagination`,
    });
    const reclaimed = reclaim(task, dead);
    assert.equal(reclaimed.state, "RECLAIMABLE", `${outcome} must return the task to the pool`);
    assert.equal(reclaimed.disposition, null, `${outcome} must leave no conclusion behind`);
    assert.deepEqual(reclaimed.attemptIds, [dead.id], `${outcome} stays on the record`);
    assert.deepEqual(dead.artifactIds, ["art-partial"], "partial evidence survives the death");
  }
});

test("SEEDED: DENIED_BY_POLICY is not swept into the generic reclaim path", () => {
  const task = pendingTask("clerk-portal");
  const denied = endedAttempt(task.id, "DENIED_BY_POLICY", {
    abortReason: "the ACQUIRER grant does not carry THIRD_PARTY_CONTACT and this route needs it",
  });

  assert.throws(
    () => reclaim(task, denied),
    (err: unknown) =>
      err instanceof DispositionRefused &&
      /DENIED_BY_POLICY/.test((err as Error).message) &&
      /denyByPolicy\(\)/.test((err as Error).message),
    "a plain RECLAIMABLE would invite an identical retry of a decision we made about ourselves",
  );

  const parked = denyByPolicy(task, denied, "widen the ACQUIRER grant, or route this through a records request");
  assert.equal(parked.state, "POLICY_DENIED");
  assert.equal(parked.disposition, null, "a policy refusal is a fact about us, never about the government");
  assert.equal(isOutstanding(parked), true, "a route WE refused is still owed");
  assert.equal(isTerminal(parked), false);
  assert.equal(parked.policyDenial?.policyVersion, "p1", "the grant version in force is pinned for replay");
  assert.equal(parked.policyDenial?.at, T1, "the timestamp comes from the Attempt, never from a clock");
  assert.match(parked.policyDenial?.requiredChange ?? "", /widen the ACQUIRER grant/);

  const item = contractItem({ floor: [] });
  const verdict = evaluateCompletion(
    completionSnapshot({ item, routeTasks: [parked] }),
    "VERIFIED_COMPLETE",
  );
  assert.equal(verdict.mayComplete, false);
  const refusal = verdict.refusals.find((r) => r.code === "ROUTE_TASK_POLICY_DENIED");
  assert.ok(refusal, "a policy-denied route must refuse completion under its own code");
  assert.equal(refusal.subject, parked.id);
  assert.match(refusal.detail, /widen the ACQUIRER grant/, "the refusal states what must change");
});

test("denyByPolicy refuses an unnamed change, a wrong outcome and a foreign task", () => {
  const task = pendingTask("clerk-portal");
  const denied = endedAttempt(task.id, "DENIED_BY_POLICY", { abortReason: "no grant" });

  assert.throws(() => denyByPolicy(task, denied, "   "), /WHAT MUST CHANGE/);
  assert.throws(
    () => denyByPolicy(task, endedAttempt(task.id, "CRASHED", { abortReason: "died" }), "x"),
    /not DENIED_BY_POLICY/,
  );
  assert.throws(
    () =>
      denyByPolicy(
        task,
        endedAttempt("rt-elsewhere", "DENIED_BY_POLICY", { abortReason: "no grant" }),
        "x",
      ),
    /belongs to RouteTask/,
  );
});

const BLOCKING: Escalation = createEscalation({
  id: "esc-records-officer",
  reason: "the county records officer requires a signed request before releasing the agenda packet",
  requestedAction: "sign and send the records request",
  alreadyTried: ["the public portal", "the clerk's published calendar"],
  openedAt: T0,
  responseTargetHours: 48,
});

const NON_BLOCKING: Escalation = createEscalation({
  id: "esc-vendor-account",
  reason: "the Legistar vendor wants a paid API tier",
  requestedAction: "decide whether to buy the tier",
  openedAt: T0,
  responseTargetHours: 168,
  blocksCompletion: false,
});

test("createEscalation defaults to BLOCKING — a field nobody set never closes an obligation", () => {
  const e = createEscalation({
    id: "esc-1",
    reason: "r",
    requestedAction: "a",
    openedAt: T0,
    responseTargetHours: 24,
  });
  assert.equal(e.blocksCompletion, true, "the value you get for free must be the value that refuses");
  assert.equal(e.resolvedAt, null);
  assert.equal(e.snoozedUntil, null);
  assert.deepEqual(e.alreadyTried, []);
});

test("SEEDED: a blocking escalation snoozed past `now` must not let the obligation complete", () => {
  const snoozed: Escalation = { ...BLOCKING, snoozedUntil: T_FAR };
  const item = contractItem({ floor: [], escalations: [snoozed] });

  assert.deepEqual(
    openEscalations(item, T2).map((e) => e.id),
    [],
    "the Needs Sean queue still honours the snooze; snoozing is a notification decision",
  );
  assert.deepEqual(
    completionBlockingEscalations(item).map((e) => e.id),
    ["esc-records-officer"],
    "no moment exists that the evaluation can be moved to in order to clear this",
  );

  const verdict = evaluateCompletion(completionSnapshot({ item }), "VERIFIED_COMPLETE");
  assert.equal(verdict.mayComplete, false, "dismissing a notification is not answering the question");
  const refusal = verdict.refusals.find((r) => r.code === "OWNER_ESCALATION_UNRESOLVED");
  assert.ok(refusal, "the refusal must be the named escalation code");
  assert.equal(refusal.subject, "esc-records-officer");
});

test("POSITIVE CONTROL: resolving the escalation lets the same item complete", () => {
  const resolved: Escalation = { ...BLOCKING, snoozedUntil: T_FAR, resolvedAt: T2 };
  const item = contractItem({ floor: [], escalations: [resolved] });
  const verdict = evaluateCompletion(completionSnapshot({ item }), "VERIFIED_COMPLETE");
  assert.equal(verdict.mayComplete, true, verdict.refusals.map((r) => r.detail).join(" | "));
  assert.deepEqual(completionBlockingEscalations(item), []);
});

test("POSITIVE CONTROL: a snoozed NON-blocking owner decision does not freeze unrelated truth", () => {
  const item = contractItem({
    floor: [],
    escalations: [{ ...NON_BLOCKING, snoozedUntil: T_FAR }],
  });
  const verdict = evaluateCompletion(completionSnapshot({ item }), "VERIFIED_COMPLETE");
  assert.equal(
    verdict.mayComplete,
    true,
    "a vendor account decision cannot make a public record any less true",
  );
});

test("an unsnoozed blocking escalation refuses too — the snooze was never what mattered", () => {
  const item = contractItem({ floor: [], escalations: [BLOCKING] });
  const verdict = evaluateCompletion(completionSnapshot({ item }), "VERIFIED_COMPLETE");
  assert.ok(
    verdict.refusals.some(
      (r) => r.code === "OWNER_ESCALATION_UNRESOLVED" && r.subject === "esc-records-officer",
    ),
  );
});

test("the AUTHOR_DECISION_REQUIRED / HUMAN_INTERACTION_REQUIRED carve-out survives the change", () => {
  // These two terminal states ARE the escalation. Refusing them because an
  // escalation is open would make the state unreachable, so the carve-out is
  // kept — and it now applies to snoozed blocking escalations as well.
  const item = contractItem({ floor: [], escalations: [{ ...BLOCKING, snoozedUntil: T_FAR }] });

  for (const state of ["AUTHOR_DECISION_REQUIRED", "HUMAN_INTERACTION_REQUIRED"] as const) {
    const verdict = evaluateCompletion(completionSnapshot({ item }), state);
    assert.equal(verdict.mayComplete, true, `${state}: ${verdict.refusals.map((r) => r.detail).join(" | ")}`);
    assert.equal(verdict.proposedState, state);
  }
});

test("escalation ageing stays deterministic and clock-free", () => {
  assert.equal(escalationAgeHours(BLOCKING, T2), 0.5);
  assert.equal(escalationAgeHours(BLOCKING, T1), 1 / 12);
  assert.equal(escalationAgeHours(BLOCKING, T2), escalationAgeHours(BLOCKING, T2));
  assert.equal(BLOCKING.responseTargetHours, 48);
  assert.equal(escalationAgeHours(BLOCKING, T2) > BLOCKING.responseTargetHours, false);
});
