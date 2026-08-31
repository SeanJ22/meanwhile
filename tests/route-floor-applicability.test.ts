/**
 * **IS A SPECULATIVE METHOD HYPOTHESIS THE SAME THING AS A KNOWN ROUTE WHOSE
 * OMISSION MUST BLOCK COMPLETION?**
 *
 * The answer this suite proves is NO — and the proof is mechanical rather than
 * intuitive, because the whole failure mode being guarded against is a plausible
 * intuition applied to a store nobody re-measured.
 *
 * THE MEASUREMENT, from the committed store at version 55: all 116 active routes
 * carry `portability: UNKNOWN`, and 114 of them state ZERO typed dimensions.
 * Narrowed to `meeting`/`agenda`, 20 of them join the Pima County floor having
 * matched NOTHING: not state, not government type, not platform, not publisher.
 * They include a state-education-agency technique, a CMS-hydration technique and
 * several reasoning disciplines with no retrievable surface at all.
 *
 * Before 2026-08-29 every one of those 20 entered
 * `CompletionContract.inheritedRouteFloor`, whose refusal reads "Inherited route
 * X **is applicable to this subject**". `appliesTo` said of the same 20, in its
 * own words, "offered, NOT PROVEN". The evaluator was asserting the premise the
 * projection refuses to assert.
 *
 * So the floor is split — and the split is not an excuse. Both halves are
 * materialised, registered, scheduled and owed dispositions; both still hold the
 * obligation open. What the split forbids is a hypothesis being refused against
 * as though it were a known API, and a known API being demoted to a hypothesis.
 *
 * EVERY TEST HERE CALLS THE REAL `computeRouteFloor`, `materializeFloor`,
 * `auditFloorIntegrity`, `runExplorationQueue` and `evaluateCompletion`. None of
 * them re-implements the rule: a test that reproduces the logic it is checking
 * passes for a system that no longer exists.
 */

import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { beginAttempt, claim, endAttempt } from "../lib/control-plane/attempt.ts";
import { evaluateCompletion, type CompletionSnapshot } from "../lib/control-plane/completion.ts";
import {
  PIMA_ADAPTER_ROUTES,
  PIMA_JURISDICTION,
  pimaFutureMeetingsWorkItem,
} from "../lib/control-plane/fixtures/pima-meetings.ts";
import {
  auditFloorIntegrity,
  computeRouteFloor,
  describeFloor,
  materializeFloor,
  runExplorationQueue,
  type FloorRoute,
  type RouteFloor,
} from "../lib/control-plane/preflight.ts";
import { disposeRoute, type RouteTask } from "../lib/control-plane/route-task.ts";
import { PIMA_MEETING_FIELDS } from "../lib/control-plane/shadow/pima-run.ts";
import { emptyKnowledge, learnRoute, type MethodKnowledge } from "../lib/method/knowledge.ts";
import { gradeApplicability, unknownApplicability } from "../lib/method/portability.ts";
import { FIRST_PARTY_ROUTES } from "../lib/sources/legistar-insite/horizon.ts";
import { loadMethodStore } from "../lib/workstate/load.ts";
import type { WorkItem } from "../lib/control-plane/work-item.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const T0 = "2026-08-29T00:00:00.000Z";
const T1 = "2026-08-29T00:10:00.000Z";
const TTL = 10 * 60 * 1000;

/**
 * The REAL floor, from the REAL committed store.
 *
 * A missing store is a FAILED READ, never an empty floor. Without this throw the
 * assertions below would all pass against a vacuum, which is the exact shape of
 * a guard that reports clean without having looked.
 */
function realFloor(fields: readonly string[] = PIMA_MEETING_FIELDS): {
  knowledge: MethodKnowledge;
  floor: RouteFloor;
} {
  const knowledge = loadMethodStore(ROOT);
  if (knowledge === null) {
    throw new Error(
      `the committed method store could not be read from ${ROOT}; this suite proves the floor ` +
        "is computed from real project knowledge and a pass against nothing would be vacuous",
    );
  }
  return {
    knowledge,
    floor: computeRouteFloor({
      knowledge,
      jurisdiction: PIMA_JURISDICTION,
      fields,
      adapterRoutes: PIMA_ADAPTER_ROUTES,
    }),
  };
}

/** Walk one task to a real terminal disposition through the real primitives. */
function walk(task: RouteTask, disposition: "INGESTED" | "WALKED_NO_YIELD", rows = 0): RouteTask {
  const artifactIds = [`art-${task.routeId}`];
  const lease = claim(task.id, `w-${task.routeId}`, T0, TTL, null);
  const attempt = endAttempt(
    beginAttempt({
      routeTaskId: task.id,
      workItemId: task.workItemId,
      worker: { role: "ACQUIRER", provider: "test", version: "v1", instance: `w-${task.routeId}` },
      lease,
      now: T0,
      methodVersion: 55,
      policyVersion: "p1",
    }),
    "COMPLETED",
    T1,
    { artifactIds },
  );
  return disposeRoute(task, attempt, {
    disposition,
    attemptId: attempt.id,
    at: T1,
    artifactIds,
    observation: {
      rawCount: rows,
      normalizedCount: rows,
      routeOnlyCount: null,
      earliest: null,
      latest: null,
    },
    permission: "ALLOWED",
    transport: "REACHABLE",
    note: "walked in tests/route-floor-applicability.test.ts",
  });
}

function snapshotFor(item: WorkItem, tasks: readonly RouteTask[]): CompletionSnapshot {
  return {
    item,
    routeTasks: tasks,
    validations: [
      { workItemId: item.id, passed: true, at: T1, by: "validator", checked: ["identity"], detail: "ok" },
    ],
    audits: [
      {
        id: "af-applicability",
        workItemId: item.id,
        mode: "SOURCE_UNIVERSE",
        severity: "LOW",
        survived: true,
        startedFrom: ["PUBLISHER_SOURCE_UNIVERSE", "EVIDENCE_VAULT"],
        detail: "independently enumerated the publisher surfaces",
        at: T1,
        resolvedAt: null,
      },
    ],
    contradictions: [],
    upstreamStates: new Map(),
    denominatorComplete: true,
    /* No instrument-evidence contract here; the empty set is the refusing default. */
    instrumentGreens: new Set<string>(),
    now: T1,
  };
}

/* ======================================================================== (a)
 * THE AUDIT: why was each route considered applicable?
 * ====================================================================== */

test("AUDIT: typed dimensions now DO WORK on the real Pima floor, and matching one is still not proof", () => {
  /*
   * HISTORY, KEPT BECAUSE THE NUMBER MOVED AND THIS IS WHERE IT SAYS SO. At
   * method version 55 every speculative route on this floor matched ZERO typed
   * dimensions — 114 of 116 routes stated none, so there was nothing to match
   * and nothing to fail, and this test asserted that measurement so it could
   * not quietly rot. On 2026-08-30 (NH287) the dimensions were populated from
   * each route's own recorded evidence: outcome jurisdictions became `states`,
   * recorded vendor hosts became `platforms`, recorded first-party hosts
   * became `publishers`. So the floor now shows typed evidence doing real
   * work in BOTH directions — routes matching `state`, and routes DEMOTED
   * where their recorded evidence disagrees with this jurisdiction — while
   * the load-bearing invariant is unchanged: nothing speculative is PROVEN,
   * and matching a dimension under UNKNOWN portability is still not proof.
   */
  const { knowledge, floor } = realFloor();

  assert.ok(knowledge.routes.length > 100, "the committed store was not loaded; the floor is vacuous");
  assert.equal(floor.methodVersion, knowledge.version, "the floor pins the method version");
  assert.ok(floor.exploratory.length > 0, "no speculative route — this suite would prove nothing");

  let matchedSomething = 0;
  let demotedOnEvidence = 0;
  for (const r of floor.exploratory) {
    assert.notEqual(r.grade, "PROVEN", `${r.routeId} graded PROVEN and is filed as an experiment`);
    assert.equal(r.grade, "OFFERED_UNPROVEN");
    assert.equal(r.proof, "APPLICABILITY_UNPROVEN");
    /*
     * THE AUDIT TRAIL IS TOTAL: every one of the four dimensions is accounted
     * for as matched, mismatched or unstated — a dimension that silently fell
     * out of all three buckets would be the old collapse back again.
     */
    assert.equal(
      r.matchedDimensions.length + r.mismatchedDimensions.length + r.unstatedDimensions.length,
      4,
      `${r.routeId}: matched ${r.matchedDimensions.join("+")}, mismatched ${r.mismatchedDimensions.join("+")}, unstated ${r.unstatedDimensions.join("+")} do not account for all four dimensions`,
    );
    if (r.matchedDimensions.length > 0) matchedSomething += 1;
    if (r.mismatchedDimensions.length > 0) demotedOnEvidence += 1;
    assert.ok(
      r.matchedFields.length > 0,
      `${r.routeId} is on a field-narrowed floor and must name the field that put it in scope`,
    );
  }

  // The population is observable on the floor, in both directions. If either
  // number returns to zero the typed dimensions have stopped doing work and
  // somebody needs to read `pnpm method:type-applicability`'s report.
  assert.ok(matchedSomething > 0, "no speculative route matched a typed dimension — the store has lost its typed evidence");
  assert.ok(
    demotedOnEvidence > 0,
    "no route was demoted on disagreeing evidence — the government-type-aware demotion found nothing to do",
  );

  // And the counterpart: the audit table is printable, so the finding is not
  // reachable only through a debugger.
  const described = describeFloor(floor);
  assert.match(described, /MANDATORY —/);
  assert.match(described, /SPECULATIVE EXPERIMENTS —/);
  assert.match(described, /evidence DISAGREES on /);
});

test("AUDIT: the typed dimensions excluded almost nothing, and the report says the number", () => {
  const { knowledge, floor } = realFloor();

  // This is the root-cause measurement, asserted so it cannot quietly rot: if
  // applicability typing starts doing real work, this number moves and somebody
  // reads this test. `excluded` is reported by id and reason, never as a silent
  // omission from the projection.
  for (const e of floor.excluded) {
    assert.ok(e.reason.length > 0, `${e.routeId} was excluded with no stated reason`);
  }
  assert.ok(
    floor.excluded.length < knowledge.routes.length / 2,
    "if typed applicability now excludes half the store, the floor semantics need re-reading",
  );
});

/* ======================================================================== (b)
 * THE CLASSIFICATION
 * ====================================================================== */

test("the floor separates PROVEN adapter surfaces from unproven method hypotheses", () => {
  const { floor } = realFloor();

  const requiredIds = new Set(floor.required.map((r) => r.routeId));
  const exploratoryIds = new Set(floor.exploratory.map((r) => r.routeId));

  // Disjoint by construction. A route cannot be both, or "did omitting it
  // matter?" would have two answers.
  for (const id of requiredIds) {
    assert.ok(!exploratoryIds.has(id), `${id} is in both halves of the floor`);
  }
  assert.equal(floor.required.length + floor.exploratory.length, floor.routes.length);
  assert.deepEqual([...floor.routeIds].sort(), [...requiredIds].sort());
  assert.deepEqual(
    [...floor.allRouteIds].sort(),
    [...requiredIds, ...exploratoryIds].sort(),
    "allRouteIds is the union; nothing may be dropped between the halves and the whole",
  );

  // Every adapter-declared first-party surface is REQUIRED, with the proof named.
  for (const routeId of FIRST_PARTY_ROUTES) {
    const route = floor.routes.find((r) => r.routeId === routeId);
    assert.ok(route, `${routeId} is a declared first-party surface and is missing from the floor`);
    assert.equal(route.obligation, "REQUIRED", `${routeId} must be mandatory`);
    assert.equal(route.proof, "ADAPTER_DECLARED");
    assert.equal(route.speculative, false);
  }
});

test("a method route whose typed dimension MATCHES is required, not exploratory", () => {
  /*
   * The promotion path, proven on a synthetic store rather than waiting for the
   * committed one to acquire a typed route. This is the case the committed store
   * has zero examples of, and a rule with no example is a rule nobody has run.
   */
  let k = emptyKnowledge();
  k = learnRoute(
    k,
    {
      id: "legistar-tenant-calendar-postback",
      title: "a proven Legistar-platform route",
      tier: "A1",
      fields: ["meeting"],
      applicability: {
        ...unknownApplicability("proven on the legistar platform"),
        portability: "PLATFORM_SPECIFIC",
        platforms: ["legistar"],
      },
      outcomes: [],
      subBranches: [],
      origin: "test",
      learnedOn: T0,
    },
    T0,
  ).knowledge;
  k = learnRoute(
    k,
    {
      id: "some-unproven-technique",
      title: "an unconstrained hypothesis",
      tier: "B",
      fields: ["meeting"],
      applicability: unknownApplicability("nobody classified this"),
      outcomes: [],
      subBranches: [],
      origin: "test",
      learnedOn: T0,
    },
    T0,
  ).knowledge;

  const floor = computeRouteFloor({
    knowledge: k,
    jurisdiction: PIMA_JURISDICTION,
    fields: ["meeting"],
    adapterRoutes: [],
  });

  const proven = floor.routes.find((r) => r.routeId === "legistar-tenant-calendar-postback");
  const unproven = floor.routes.find((r) => r.routeId === "some-unproven-technique");
  assert.ok(proven && unproven);
  assert.equal(proven.obligation, "REQUIRED", "a matched platform dimension IS proof");
  assert.equal(proven.proof, "PORTABILITY_PROVEN");
  assert.deepEqual(proven.matchedDimensions, ["platform"]);
  assert.equal(unproven.obligation, "EXPLORATORY");
});

/* ======================================================================== (c)
 * INVARIANT 1 — a speculative success may NOT satisfy a REQUIRED route
 * ====================================================================== */

test("INVARIANT: every experiment succeeding does not discharge one omitted REQUIRED route", () => {
  const { floor } = realFloor();
  const { item, routeTasks, explorationTasks } = materializeFloor(
    pimaFutureMeetingsWorkItem(T0),
    floor,
    T0,
  );

  const omitted = "LEGISTAR_WEBAPI_EVENTDATES";
  assert.ok(
    floor.routeIds.includes(omitted),
    "the route MTG-13 forgot must be in the completion contract or this proves nothing",
  );

  // EVERY speculative experiment succeeds, loudly, with rows.
  const experiments = explorationTasks.map((t) => walk(t, "INGESTED", 14));
  assert.ok(experiments.length > 0, "no experiments walked — the invariant would be untested");
  assert.ok(
    experiments.every((t) => t.disposition?.disposition === "INGESTED"),
    "the experiments must actually be disposed for this to be a real test of the invariant",
  );

  // And the required floor is walked EXCEPT for the one route.
  const required = routeTasks
    .filter((t) => t.routeId !== omitted)
    .map((t) => walk(t, "INGESTED", 14));

  const verdict = evaluateCompletion(
    snapshotFor(item, [...required, ...experiments]),
    "VERIFIED_COMPLETE",
  );

  assert.equal(verdict.mayComplete, false, "20 speculative successes cannot cover one known route");
  const named = verdict.refusals
    .filter((r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION")
    .map((r) => r.subject);
  assert.deepEqual(
    named,
    [omitted],
    "the refusal must name the forgotten first-party route, and name ONLY it",
  );
});

test("INVARIANT: no speculative route id ever reaches the completion contract", () => {
  const { floor } = realFloor();
  const { item } = materializeFloor(pimaFutureMeetingsWorkItem(T0), floor, T0);
  const contract = new Set(item.contract.inheritedRouteFloor);

  for (const r of floor.exploratory) {
    assert.ok(
      !contract.has(r.routeId),
      `${r.routeId} is offered on unproven applicability and is in the contract, whose refusal ` +
        "asserts the route IS applicable to this subject",
    );
  }
  // The contract is not empty either — an empty floor would satisfy the loop
  // above and prove the opposite of what this suite is for.
  assert.equal(contract.size, FIRST_PARTY_ROUTES.length);
});

/* ======================================================================== (d)
 * INVARIANT 2 — "speculative" may NOT excuse a known applicable route
 * ====================================================================== */

test("INVARIANT: the store's UNKNOWN portability cannot demote an adapter-declared surface", () => {
  const { knowledge } = realFloor();

  /*
   * The adapter's route ids are ALSO planted in the method store, every one of
   * them on UNKNOWN portability with no dimensions — the worst case. If
   * "speculative" could ever win over "the adapter declares this for this
   * publisher", this is where it would happen.
   */
  let k: MethodKnowledge = { ...knowledge, routes: [...knowledge.routes] };
  for (const routeId of FIRST_PARTY_ROUTES) {
    k = learnRoute(
      k,
      {
        id: routeId,
        title: `${routeId} as an unclassified store entry`,
        tier: "B",
        fields: ["meeting"],
        applicability: unknownApplicability("nobody classified this"),
        outcomes: [],
        subBranches: [],
        origin: "test",
        learnedOn: T0,
      },
      T0,
    ).knowledge;
  }

  const floor = computeRouteFloor({
    knowledge: k,
    jurisdiction: PIMA_JURISDICTION,
    fields: PIMA_MEETING_FIELDS,
    adapterRoutes: PIMA_ADAPTER_ROUTES,
  });

  for (const routeId of FIRST_PARTY_ROUTES) {
    const route = floor.routes.find((r) => r.routeId === routeId);
    assert.ok(route, `${routeId} vanished from the floor`);
    assert.equal(
      route.obligation,
      "REQUIRED",
      `${routeId} was demoted to an experiment by the store's UNKNOWN portability`,
    );
    assert.ok(route.origins.includes("ADAPTER_DECLARED"));
    assert.ok(floor.routeIds.includes(routeId), `${routeId} left the completion contract`);
  }
});

test("INVARIANT: exploratory routes are NOT excused — an unwalked experiment still refuses", () => {
  /*
   * THE DECISION, PROVEN IN BOTH DIRECTIONS. Splitting the floor is not a way of
   * closing an obligation with twenty avenues untested. RULING 184: a finite
   * attempt count never earns an absence. So the experiments are materialised as
   * real RouteTasks bound to the item, and leaving one undisposed refuses the
   * close — under `ROUTE_TASK_STILL_OUTSTANDING`, which claims only that a task
   * has not been walked, rather than under a code that asserts applicability
   * nobody proved.
   */
  const { floor } = realFloor();
  const { item, routeTasks, explorationTasks } = materializeFloor(
    pimaFutureMeetingsWorkItem(T0),
    floor,
    T0,
  );

  assert.ok(explorationTasks.length > 0);
  for (const t of explorationTasks) {
    assert.ok(
      item.routeTaskIds.includes(t.id),
      `${t.routeId} is an experiment that was never bound to the WorkItem — dropped work`,
    );
  }

  // Every required route walked clean; every experiment left alone.
  const required = routeTasks.map((t) => walk(t, "INGESTED", 14));
  const verdict = evaluateCompletion(
    snapshotFor(item, [...required, ...explorationTasks]),
    "VERIFIED_COMPLETE",
  );

  assert.equal(verdict.mayComplete, false, "untested experiments do not close silently");
  assert.equal(
    verdict.refusals.filter((r) => r.code === "INHERITED_ROUTE_WITHOUT_DISPOSITION").length,
    0,
    "an untested hypothesis must not be reported as a known applicable route we forgot",
  );
  assert.equal(
    verdict.refusals.filter((r) => r.code === "ROUTE_TASK_STILL_OUTSTANDING").length,
    explorationTasks.length,
    "every unwalked experiment must be refused on, by task, and none may be skipped",
  );
  assert.ok(
    verdict.satisfied.some((s) => /inherited route floor/.test(s)),
    "the mandatory floor was fully disposed and the report must be able to say so",
  );
});

/* ======================================================================== (e)
 * INVARIANT 3 — a dropped required route is a FAILURE the guard catches
 * ====================================================================== */

test("GUARD: a required adapter route dropped from the floor is caught and named", () => {
  const { floor } = realFloor();
  const dropped = "CLERK_SCHEDULE_PAGE";

  // The exact defect: a speculative route succeeded, somebody trimmed the floor,
  // and a first-party surface the county actually serves stopped being owed.
  const trimmed: RouteFloor = {
    ...floor,
    routes: floor.routes.filter((r) => r.routeId !== dropped),
    required: floor.required.filter((r) => r.routeId !== dropped),
    routeIds: floor.routeIds.filter((id) => id !== dropped),
    allRouteIds: floor.allRouteIds.filter((id) => id !== dropped),
  };
  const { item, routeTasks, explorationTasks } = materializeFloor(
    pimaFutureMeetingsWorkItem(T0),
    trimmed,
    T0,
  );

  const findings = auditFloorIntegrity({
    floor: trimmed,
    adapterRoutes: PIMA_ADAPTER_ROUTES,
    item,
    routeTasks: [...routeTasks, ...explorationTasks],
  });

  assert.ok(findings.length > 0, "the guard did not notice a first-party surface disappearing");
  assert.deepEqual(
    findings.map((f) => f.failure),
    ["ADAPTER_ROUTE_MISSING_FROM_FLOOR"],
    "the guard must name WHICH way the route was lost",
  );
  assert.equal(findings[0].subject, dropped);
});

test("GUARD: a required adapter route DEMOTED to an experiment is caught and named", () => {
  const { floor } = realFloor();
  const demoted = "LEGISTAR_WEBAPI_EVENTDATES";

  const moved: FloorRoute = {
    ...floor.required.find((r) => r.routeId === demoted)!,
    obligation: "EXPLORATORY",
    proof: "APPLICABILITY_UNPROVEN",
    speculative: true,
  };
  const rigged: RouteFloor = {
    ...floor,
    routes: floor.routes.map((r) => (r.routeId === demoted ? moved : r)),
    required: floor.required.filter((r) => r.routeId !== demoted),
    exploratory: [...floor.exploratory, moved],
    routeIds: floor.routeIds.filter((id) => id !== demoted),
    exploratoryRouteIds: [...floor.exploratoryRouteIds, demoted],
  };
  const { item, routeTasks, explorationTasks } = materializeFloor(
    pimaFutureMeetingsWorkItem(T0),
    rigged,
    T0,
  );

  const findings = auditFloorIntegrity({
    floor: rigged,
    adapterRoutes: PIMA_ADAPTER_ROUTES,
    item,
    routeTasks: [...routeTasks, ...explorationTasks],
  });

  const failures = findings.filter((f) => f.subject === demoted).map((f) => f.failure);
  assert.ok(
    failures.includes("ADAPTER_ROUTE_DEMOTED_TO_EXPLORATORY"),
    `the demotion was not caught; got ${failures.join(", ") || "nothing"}`,
  );
  assert.ok(
    failures.includes("ADAPTER_ROUTE_NOT_IN_CONTRACT"),
    "a demoted route also left the contract, and that must be reported as its own failure",
  );
});

test("GUARD: the real materialised Pima floor is CLEAN", () => {
  const { floor } = realFloor();
  const { item, routeTasks, explorationTasks } = materializeFloor(
    pimaFutureMeetingsWorkItem(T0),
    floor,
    T0,
  );
  const findings = auditFloorIntegrity({
    floor,
    adapterRoutes: PIMA_ADAPTER_ROUTES,
    item,
    routeTasks: [...routeTasks, ...explorationTasks],
  });
  assert.deepEqual(
    findings.map((f) => `${f.failure}:${f.subject}`),
    [],
    "the shipped floor must pass its own guard",
  );
});

/* ======================================================================== (f)
 * THE EXPLORATION QUEUE ACTUALLY RUNS
 * ====================================================================== */

test("the exploration queue is EXECUTED — every experiment is offered to the executor", async () => {
  const { floor } = realFloor();
  const { explorationTasks } = materializeFloor(pimaFutureMeetingsWorkItem(T0), floor, T0);

  const offered: string[] = [];
  const outcomes = await runExplorationQueue(floor, explorationTasks, async (route) => {
    offered.push(route.routeId);
    return { disposition: null, reason: "no executor is wired for this technique against this target" };
  });

  assert.deepEqual(
    offered.sort(),
    floor.exploratory.map((r) => r.routeId).sort(),
    "an exploration queue that skips entries is a way of dropping work quietly",
  );
  assert.equal(outcomes.length, floor.exploratory.length);
  for (const o of outcomes) {
    assert.equal(o.state, "UNTESTED");
    assert.equal(o.disposition, null, "UNTESTED must never be written as a disposition");
    assert.ok(o.reason.length > 0, `${o.routeId} came back untested with no stated reason`);
  }
});

test("an experiment the executor CAN walk reaches a disposition, and is reported as walked", async () => {
  const { floor } = realFloor();
  const { explorationTasks } = materializeFloor(pimaFutureMeetingsWorkItem(T0), floor, T0);
  const target = floor.exploratory[0].routeId;

  const outcomes = await runExplorationQueue(floor, explorationTasks, async (route) =>
    route.routeId === target
      ? { disposition: "WALKED_NO_YIELD", reason: "the technique ran and the route published nothing" }
      : { disposition: null, reason: "not executable here yet" },
  );

  const hit = outcomes.find((o) => o.routeId === target);
  assert.ok(hit);
  assert.equal(hit.state, "WALKED");
  assert.equal(hit.disposition, "WALKED_NO_YIELD");
  assert.equal(
    outcomes.filter((o) => o.state === "UNTESTED").length,
    floor.exploratory.length - 1,
  );
});

/* ======================================================================== (g)
 * THE APPLICABILITY TYPING FIX
 * ====================================================================== */

test("TYPING: an underspecified constraint is an ABSENT constraint and proves nothing", () => {
  /*
   * The leak this fixes. `PUBLISHER_SPECIFIC` with `publishers: []` used to
   * return "publisher_specific match not excluded" with `speculative: false` —
   * proven status granted because there was nothing to fail. That is how a
   * technique learned against a school district becomes a proven county route.
   */
  const underspecified = {
    ...unknownApplicability("a publisher-specific route that names no publisher"),
    portability: "PUBLISHER_SPECIFIC" as const,
  };
  const v = gradeApplicability(underspecified, PIMA_JURISDICTION);
  assert.equal(v.applies, true, "it is still OFFERED — RULING 178's bias is untouched");
  assert.equal(v.grade, "OFFERED_UNPROVEN", "but nothing about its fit here was proven");
  assert.deepEqual(v.matchedDimensions, []);
  assert.ok(v.unstatedDimensions.includes("publisher"));

  const stated = gradeApplicability(
    { ...underspecified, publishers: ["pima.legistar.com"] },
    PIMA_JURISDICTION,
  );
  assert.equal(stated.grade, "PROVEN", "a stated constraint that MATCHES is proof");
  assert.deepEqual(stated.matchedDimensions, ["publisher"]);
});

test("TYPING: a jurisdiction may not prove a state-family route applies to itself", () => {
  /*
   * The old predicate unioned the route's proven states with the jurisdiction's
   * OWN declared family and asked whether the jurisdiction's state was in the
   * result — so a jurisdiction listing itself in its family proved every
   * state-family route. The subject supplied the evidence for the claim about
   * the subject.
   */
  const newEngland = {
    ...unknownApplicability("proven across New England towns"),
    portability: "STATE_FAMILY" as const,
    states: ["nh", "vt"],
  };

  const selfProving = gradeApplicability(newEngland, { state: "az", family: ["az"] });
  assert.equal(selfProving.grade, "EXCLUDED", "az cannot make a NH/VT route apply to az");

  const genuineKin = gradeApplicability(newEngland, { state: "me", family: ["nh", "vt"] });
  assert.equal(genuineKin.grade, "PROVEN");
  assert.match(genuineKin.reason, /proven in nh, vt, kin to me/);
});

test("TYPING: a route with recorded states elsewhere is still OFFERED, never withheld", () => {
  // The expensive direction is withholding. A route walked once in New Hampshire
  // that claims no reach is an UNKNOWN route with one data point, and it must
  // still be offered in Arizona — graded honestly, never dropped.
  const walkedInNh = {
    ...unknownApplicability("one data point, no claimed reach"),
    states: ["nh"],
  };
  const v = gradeApplicability(walkedInNh, PIMA_JURISDICTION);
  assert.equal(v.applies, true);
  assert.equal(v.grade, "OFFERED_UNPROVEN");
});
