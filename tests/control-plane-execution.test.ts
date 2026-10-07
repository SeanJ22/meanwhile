import assert from "node:assert/strict";
import test from "node:test";

import {
  AttemptContract,
  LeaseConflict,
  beginAttempt,
  claim,
  endAttempt,
  heartbeat,
  isExpired,
  leavesReclaimable,
  mayWriteDisposition,
  release,
  type WorkerRef,
} from "../lib/control-plane/attempt.ts";
import {
  DispositionRefused,
  createRouteTask,
  disposeRoute,
  isOutstanding,
  isTerminal,
  reclaim,
  type RouteDisposition,
} from "../lib/control-plane/route-task.ts";
import { evaluateCompletion } from "../lib/control-plane/completion.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import { routeTaskId, workItemId } from "../lib/control-plane/ids.ts";
import { completionSnapshot, T0, T1, T2 } from "./control-plane-fixtures.ts";

const TTL = 10 * 60 * 1000;

const WORKER: WorkerRef = {
  role: "ACQUIRER",
  provider: "test",
  version: "v1",
  instance: "worker-a",
};

function pimaItem(floor: readonly string[]) {
  return createWorkItem({
    project: "meanwhile",
    subject: "ocd-division/country:us/state:az/county:pima",
    obligation: "Enumerate every explicit future Board of Supervisors meeting instance",
    why: "Readers are shown a future meeting universe; an incomplete one is a false claim.",
    priority: "P0",
    contract: { inheritedRouteFloor: floor, requiresValidation: false },
    now: T0,
  });
}


test("ids are pure functions of their inputs, so duplicate work collides", () => {
  const a = workItemId("meanwhile", "pima", "future meetings");
  const b = workItemId("meanwhile", "pima", "future meetings");
  assert.equal(a, b, "the same obligation must produce the same id in two processes");

  const c = workItemId("meanwhile", "pima", "future agendas");
  assert.notEqual(a, c);

  // The delimiter matters: without it these two collapse into one obligation.
  assert.notEqual(
    workItemId("meanwhile", "ab", "c"),
    workItemId("meanwhile", "a", "bc"),
    "field boundaries must survive hashing",
  );

  assert.equal(routeTaskId("wi-1", "legistar-eventdates", "pima"), routeTaskId("wi-1", "legistar-eventdates", "pima"));
});

test("SEEDED: two workers claim the same RouteTask -> exactly one lease wins", () => {
  const lease = claim("rt-1", "worker-a", T0, TTL, null);
  assert.equal(lease.holder, "worker-a");

  assert.throws(
    () => claim("rt-1", "worker-b", T1, TTL, lease),
    (err: unknown) => err instanceof LeaseConflict,
    "a live lease held by another worker must refuse the second claim",
  );

  // The same holder re-claiming is idempotent, not a conflict: a worker that
  // retries its own claim has not duplicated a side effect.
  assert.doesNotThrow(() => claim("rt-1", "worker-a", T1, TTL, lease));
});

test("an expired lease is reclaimable by anyone; a released one likewise", () => {
  const lease = claim("rt-1", "worker-a", T0, TTL, null);
  assert.equal(isExpired(lease, T1), false, "still live five minutes in");
  assert.equal(isExpired(lease, T2), true, "expired thirty minutes in");

  assert.doesNotThrow(() => claim("rt-1", "worker-b", T2, TTL, lease));
  assert.doesNotThrow(() => claim("rt-1", "worker-b", T1, TTL, release(lease)));
});

test("an expired lease cannot be heartbeat back to life", () => {
  const lease = claim("rt-1", "worker-a", T0, TTL, null);
  assert.doesNotThrow(() => heartbeat(lease, T1, TTL));
  assert.throws(() => heartbeat(lease, T2, TTL), /expired/);
});

test("SEEDED: worker crashes mid-route -> ABORTED, artifacts kept, no disposition, task reclaimable", () => {
  const item = pimaItem([]);
  const task = createRouteTask({
    workItemId: item.id,
    routeId: "legistar-calendar-aspx",
    routeLabel: "Legistar Calendar.aspx",
    target: "pima.legistar.com",
    inherited: true,
    now: T0,
  });
  const lease = claim(task.id, "worker-a", T0, TTL, null);
  const attempt = beginAttempt({
    routeTaskId: task.id,
    workItemId: item.id,
    worker: WORKER,
    lease,
    now: T0,
    methodVersion: 55,
    policyVersion: "p1",
  });

  const crashed = endAttempt(attempt, "CRASHED", T1, {
    abortReason: "worker process exited during pagination at page 3 of an unknown total",
    artifactIds: ["art-page1", "art-page2"],
  });

  assert.equal(mayWriteDisposition(crashed), false, "a crash may not dispose of a route");
  assert.equal(leavesReclaimable(crashed), true);
  assert.deepEqual(crashed.artifactIds, ["art-page1", "art-page2"], "partial evidence survives");

  assert.throws(
    () =>
      disposeRoute(task, crashed, {
        disposition: "WALKED_NO_YIELD",
        attemptId: crashed.id,
        at: T1,
        artifactIds: [],
        observation: null,
        permission: "ALLOWED",
        transport: "REACHABLE",
        note: "nothing found",
      }),
    (err: unknown) => err instanceof DispositionRefused && /interrupted walk/.test((err as Error).message),
  );

  const reclaimed = reclaim(task, crashed);
  assert.equal(reclaimed.state, "RECLAIMABLE");
  assert.equal(reclaimed.disposition, null);
  assert.deepEqual(reclaimed.attemptIds, [crashed.id], "the dead Attempt is still on the record");
});

test("a non-COMPLETED attempt must name its reason, and no attempt ends twice", () => {
  const lease = claim("rt-1", "w", T0, TTL, null);
  const attempt = beginAttempt({
    routeTaskId: "rt-1",
    workItemId: "wi-1",
    worker: WORKER,
    lease,
    now: T0,
    methodVersion: 55,
    policyVersion: "p1",
  });

  assert.throws(
    () => endAttempt(attempt, "TIMED_OUT", T1),
    (err: unknown) => err instanceof AttemptContract && /abortReason/.test((err as Error).message),
  );

  const done = endAttempt(attempt, "COMPLETED", T1);
  assert.throws(
    () => endAttempt(done, "CRASHED", T2, { abortReason: "late crash" }),
    (err: unknown) => err instanceof AttemptContract && /already ended/.test((err as Error).message),
  );
});

function completedAttempt(taskId: string, instance = "worker-a", artifactIds: readonly string[] = ["art-1"]) {
  const lease = claim(taskId, instance, T0, TTL, null);
  return endAttempt(
    beginAttempt({
      routeTaskId: taskId,
      workItemId: "wi-x",
      worker: { ...WORKER, instance },
      lease,
      now: T0,
      methodVersion: 55,
      policyVersion: "p1",
    }),
    "COMPLETED",
    T1,
    { artifactIds },
  );
}

const OK_DISPOSITION = (over: Partial<RouteDisposition> = {}): RouteDisposition => ({
  disposition: "INGESTED",
  attemptId: "",
  at: T1,
  artifactIds: ["art-1"],
  observation: { rawCount: 16, normalizedCount: 16, routeOnlyCount: 0, earliest: null, latest: null },
  permission: "ALLOWED",
  transport: "REACHABLE",
  note: "walked",
  ...over,
});

test("INGESTED with no vault artifact is refused — a yield we cannot replay is not evidence", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "R",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = completedAttempt(task.id);
  assert.throws(
    () => disposeRoute(task, a, OK_DISPOSITION({ attemptId: a.id, artifactIds: [] })),
    /cannot be replayed/,
  );
});

test("SEEDED: a route that never answered cannot be recorded as a zero", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "Granicus ViewPublisher",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = completedAttempt(task.id, "worker-a", ["art-empty-response"]);

  assert.throws(
    () =>
      disposeRoute(
        task,
        a,
        OK_DISPOSITION({
          attemptId: a.id,
          disposition: "WALKED_NO_YIELD",
          artifactIds: [],
          transport: "TIMEOUT",
        }),
      ),
    /nothing ABOUT US/,
    "a timeout is a fact about our transport, never about the government",
  );

  // Reachable-and-empty is a legitimate zero.
  const ok = disposeRoute(
    task,
    a,
    OK_DISPOSITION({
      attemptId: a.id,
      disposition: "WALKED_NO_YIELD",
      artifactIds: ["art-empty-response"],
      transport: "REACHABLE",
    }),
  );
  assert.equal(ok.state, "DISPOSED");
  assert.equal(isTerminal(ok), true);
});

test("a route is disposed once; a settled route is not reopened by a dead attempt", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "R",
    target: "t",
    inherited: true,
    now: T0,
  });
  const a = completedAttempt(task.id);
  const disposed = disposeRoute(task, a, OK_DISPOSITION({ attemptId: a.id }));

  const b = completedAttempt(task.id, "worker-b");
  assert.throws(() => disposeRoute(disposed, b, OK_DISPOSITION({ attemptId: b.id })), /already disposed/);
  assert.throws(() => reclaim(disposed, b), /settled route/);
});

test("an attempt cannot dispose of a route it does not belong to", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "R",
    target: "t",
    inherited: true,
    now: T0,
  });
  const foreign = completedAttempt("rt-somewhere-else");
  assert.throws(() => disposeRoute(task, foreign, OK_DISPOSITION({ attemptId: foreign.id })), /belongs to RouteTask/);
});

test("SEEDED: one host blocked -> BLOCKED_CURRENTLY stays OUTSTANDING, never terminal", () => {
  const task = createRouteTask({
    workItemId: "wi-x",
    routeId: "r",
    routeLabel: "County clerk portal",
    target: "clerk.example.gov",
    inherited: true,
    now: T0,
  });
  const a = completedAttempt(task.id, "worker-a", ["art-challenge-page"]);
  const blocked = disposeRoute(
    task,
    a,
    OK_DISPOSITION({
      attemptId: a.id,
      disposition: "BLOCKED_CURRENTLY",
      artifactIds: ["art-challenge-page"],
      permission: "CANNOT_TELL",
      transport: "CHALLENGED",
      note: "interactive challenge; no residential-proxy route is permitted",
    }),
  );

  assert.equal(isTerminal(blocked), false, "a wall is not a completed route");
  assert.equal(isOutstanding(blocked), true, "the route remains owed");
});

test("SEEDED: an inherited route with no disposition refuses completion by name", () => {
  const floor = [
    "legistar-events",
    "legistar-eventdates",
    "legistar-calendar-aspx",
    "legistar-meetingdetail",
    "granicus-viewpublisher",
    "county-schedule-page",
  ];
  const item = pimaItem(floor);

  const walked = floor
    .filter((r) => r !== "legistar-eventdates")
    .map((routeId) => {
      const t = createRouteTask({
        workItemId: item.id,
        routeId,
        routeLabel: routeId,
        target: "pima.legistar.com",
        inherited: true,
        now: T0,
      });
      const a = completedAttempt(t.id);
      return disposeRoute(t, a, OK_DISPOSITION({ attemptId: a.id }));
    });

  const verdict = evaluateCompletion(
    completionSnapshot({ item, routeTasks: walked }),
    "VERIFIED_COMPLETE",
  );

  assert.equal(verdict.mayComplete, false);
  const codes = verdict.refusals.map((r) => r.code);
  assert.ok(codes.includes("INHERITED_ROUTE_WITHOUT_DISPOSITION"));
  assert.deepEqual(
    verdict.refusals.filter((r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION").map((r) => r.subject),
    ["legistar-eventdates"],
    "the refusal must name the exact forgotten route, not merely report a count",
  );
});

test("SEEDED: endpoint returns zero while another route remains -> item stays open", () => {
  const floor = ["legistar-events", "legistar-eventdates"];
  const item = pimaItem(floor);

  const zeroTask = createRouteTask({
    workItemId: item.id,
    routeId: "legistar-events",
    routeLabel: "Legistar /Events",
    target: "pima.legistar.com",
    inherited: true,
    now: T0,
  });
  const a = completedAttempt(zeroTask.id, "worker-a", ["art-empty"]);
  const zero = disposeRoute(
    zeroTask,
    a,
    OK_DISPOSITION({
      attemptId: a.id,
      disposition: "WALKED_NO_YIELD",
      artifactIds: ["art-empty"],
      transport: "REACHABLE",
    }),
  );

  const verdict = evaluateCompletion(completionSnapshot({ item, routeTasks: [zero] }), "VERIFIED_COMPLETE");
  assert.equal(verdict.mayComplete, false, "a zero from one endpoint does not close the obligation");
  assert.ok(
    verdict.refusals.some(
      (r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION" && r.subject === "legistar-eventdates",
    ),
  );
});

test("a reclaimable route task refuses completion even when every route id is present", () => {
  const item = pimaItem(["r1"]);
  const t = createRouteTask({
    workItemId: item.id,
    routeId: "r1",
    routeLabel: "R1",
    target: "t",
    inherited: true,
    now: T0,
  });
  const lease = claim(t.id, "w", T0, TTL, null);
  const dead = endAttempt(
    beginAttempt({
      routeTaskId: t.id,
      workItemId: item.id,
      worker: WORKER,
      lease,
      now: T0,
      methodVersion: 55,
      policyVersion: "p1",
    }),
    "LEASE_EXPIRED",
    T2,
    { abortReason: "heartbeat stopped" },
  );

  const verdict = evaluateCompletion(
    completionSnapshot({ item, routeTasks: [reclaim(t, dead)] }),
    "VERIFIED_COMPLETE",
  );
  assert.equal(verdict.mayComplete, false);
  assert.ok(verdict.refusals.some((r) => r.code === "ROUTE_TASK_RECLAIMABLE"));
});

test("validation, audit independence, denominator and escalation each refuse by name", () => {
  const base = createWorkItem({
    project: "meanwhile",
    subject: "s",
    obligation: "o",
    why: "w",
    contract: {
      inheritedRouteFloor: [],
      requiresValidation: true,
      requiresAudit: true,
      requiresCompleteDenominator: true,
    },
    now: T0,
  });

  const bare = evaluateCompletion(completionSnapshot({ item: base }), "VERIFIED_COMPLETE");
  const codes = bare.refusals.map((r) => r.code);
  assert.ok(codes.includes("VALIDATION_MISSING"));
  assert.ok(codes.includes("AUDIT_MISSING"));
  assert.ok(codes.includes("DENOMINATOR_INCOMPLETE"));

  const selfAudited = evaluateCompletion(
    completionSnapshot({
      item: base,
      validations: [
        { workItemId: base.id, passed: true, at: T1, by: "v", checked: ["identity"], detail: "ok" },
      ],
      audits: [
        {
          id: "af-1",
          workItemId: base.id,
          mode: "SOURCE_UNIVERSE",
          severity: "LOW",
          survived: true,
          startedFrom: ["OUR_SUMMARY"],
          detail: "read the worker report and agreed",
          at: T1,
          resolvedAt: null,
        },
      ],
      denominatorComplete: true,
    }),
    "VERIFIED_COMPLETE",
  );
  assert.ok(selfAudited.refusals.some((r) => r.code === "AUDIT_NOT_INDEPENDENT"));

  const clean = evaluateCompletion(
    completionSnapshot({
      item: base,
      validations: [
        { workItemId: base.id, passed: true, at: T1, by: "v", checked: ["identity"], detail: "ok" },
      ],
      audits: [
        {
          id: "af-2",
          workItemId: base.id,
          mode: "SOURCE_UNIVERSE",
          severity: "LOW",
          survived: true,
          startedFrom: ["PUBLISHER_SOURCE_UNIVERSE", "EVIDENCE_VAULT"],
          detail: "independently enumerated the publisher surfaces",
          at: T1,
          resolvedAt: null,
        },
      ],
      denominatorComplete: true,
    }),
    "VERIFIED_COMPLETE",
  );
  assert.equal(clean.mayComplete, true, clean.refusals.map((r) => r.detail).join(" | "));
  assert.equal(clean.proposedState, "VERIFIED_COMPLETE");
});

test("a dependency absent from the snapshot is UNRESOLVED, never assumed satisfied", () => {
  const item = createWorkItem({
    project: "meanwhile",
    subject: "s",
    obligation: "o",
    why: "w",
    contract: { requiresValidation: false },
    dependencies: [
      {
        upstreamId: "wi-upstream",
        kind: "PRODUCES_CONSUMES",
        reason: "needs the filing authority resolved first",
        evidence: ["data/x.json"],
      },
    ],
    now: T0,
  });
  const verdict = evaluateCompletion(completionSnapshot({ item }), "VERIFIED_COMPLETE");
  assert.ok(verdict.refusals.some((r) => r.code === "DEPENDENCY_UNRESOLVED"));
});

test("a non-terminal proposed state is refused outright", () => {
  const item = pimaItem([]);
  const v = evaluateCompletion(completionSnapshot({ item }), "OPEN");
  assert.equal(v.mayComplete, false);
  assert.deepEqual(v.refusals.map((r) => r.code), ["NOT_A_TERMINAL_STATE"]);
});
