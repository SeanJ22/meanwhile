/**
 * **CAN A SCHOOL-DISTRICT TECHNIQUE READ AS A PROVEN COUNTY ROUTE BECAUSE BOTH
 * ARE ARIZONA?** (2026-08-30. NH287.)
 *
 * The answer this suite proves is NO — and the other half of the answer is
 * that fixing it may not cost the county the EXPERIMENT. Outcome jurisdiction
 * is recorded at state granularity (`az`, `az-pima-85641`), so a route proven
 * only on school districts earns `states: ["az"]` and, once its portability is
 * ever promoted to a state-bound class, `gradeApplicability` reaches
 * `proven("proven in az")` for an Arizona COUNTY. The typed `governmentTypes`
 * evidence knows the difference; a matcher that does not read it is the leak.
 *
 * The rule under test, from `lib/method/portability.ts` (2026-08-30):
 *
 *   - a mismatch on the dimension a portability CLASS claims as its bound
 *     still EXCLUDES (`GOVERNMENT_TYPE`/`town` does not travel to a parish);
 *   - a mismatch on an EVIDENCE dimension demotes PROVEN to OFFERED_UNPROVEN
 *     and never excludes — the route stays available as an experiment and can
 *     never be REQUIRED;
 *   - empty stays empty, UNKNOWN stays offered-everywhere, and the reopening
 *     machinery still fires for routes that DO apply.
 *
 * The derivation half (`lib/method/type-applicability.ts`) is proven here too:
 * every typed value is written from evidence in the route's own record, empty
 * stays empty, portability is never touched, and the plan is idempotent.
 *
 * EVERY TEST CALLS THE REAL `gradeApplicability`, `computeRouteFloor`,
 * `findReopenings` and `planTypedApplicability`. None re-implements the rule.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { computeRouteFloor } from "../lib/control-plane/preflight.ts";
import {
  emptyKnowledge,
  findReopenings,
  learnRoute,
  validateKnowledge,
  type MethodKnowledge,
  type MethodRoute,
  type PriorConclusion,
} from "../lib/method/knowledge.ts";
import {
  gradeApplicability,
  unknownApplicability,
  type Jurisdiction,
} from "../lib/method/portability.ts";
import {
  deriveRouteEvidence,
  planTypedApplicability,
  stateOfJurisdiction,
} from "../lib/method/type-applicability.ts";
import { FIXTURE_ON, testRoute } from "./method-fixtures.ts";

const AZ_COUNTY: Jurisdiction = { state: "az", governmentType: "county" };
const AZ_SCHOOL_DISTRICT: Jurisdiction = { state: "az", governmentType: "school_district" };
const NH_SCHOOL_DISTRICT: Jurisdiction = { state: "nh", governmentType: "school_district" };

/** The seeded leak: proven ONLY on Arizona school districts, state-bound class. */
const SCHOOL_DISTRICT_EVIDENCE = {
  ...unknownApplicability("proven on AZ school districts only"),
  portability: "STATE_SPECIFIC" as const,
  states: ["az"],
  governmentTypes: ["school_district"],
};

function storeOf(...routes: Array<Omit<MethodRoute, "learnedAtVersion">>): MethodKnowledge {
  let k = emptyKnowledge();
  for (const r of routes) k = learnRoute(k, r, FIXTURE_ON).knowledge;
  return k;
}

/* ==================================================================== (a)
 * THE LEAK, SEEDED AND REFUSED
 * ================================================================== */

test("LEAK: school-district-only evidence in AZ is NOT proven for an AZ county", () => {
  const v = gradeApplicability(SCHOOL_DISTRICT_EVIDENCE, AZ_COUNTY);

  // Not PROVEN: "both are Arizona" is exactly the sentence the typed
  // governmentTypes evidence contradicts, and the verdict must read it.
  assert.notEqual(v.grade, "PROVEN", "the state match may not outvote the government-type evidence");
  assert.equal(v.grade, "OFFERED_UNPROVEN");
  assert.equal(v.speculative, true);
  assert.deepEqual(v.mismatchedDimensions, ["governmentType"]);
  assert.match(v.reason, /offered, not proven/);

  // And not EXCLUDED either: the county keeps the experiment. A route wrongly
  // withheld costs a fact nobody finds (RULING 178).
  assert.equal(v.applies, true, "the technique stays available to the county as an experiment");
});

test("LEAK, on the floor: the route is EXPLORATORY for the county, never REQUIRED", () => {
  const k = storeOf(
    testRoute("sd-only-technique", { applicability: SCHOOL_DISTRICT_EVIDENCE }),
  );
  const floor = computeRouteFloor({
    knowledge: k,
    jurisdiction: AZ_COUNTY,
    fields: ["meeting"],
    adapterRoutes: [],
  });

  const route = floor.routes.find((r) => r.routeId === "sd-only-technique");
  assert.ok(route, "the route must still reach the county floor");
  assert.equal(route.obligation, "EXPLORATORY");
  assert.equal(route.proof, "APPLICABILITY_UNPROVEN");
  assert.deepEqual(route.mismatchedDimensions, ["governmentType"], "the audit trail names the disagreement");
  assert.ok(
    !floor.routeIds.includes("sd-only-technique"),
    "an unproven fit may not enter the completion contract as a known route",
  );
  assert.deepEqual(floor.excluded, [], "demotion is not exclusion — nothing was withheld");
});

/* ==================================================================== (b)
 * THE POSITIVE CONTROL
 * ================================================================== */

test("CONTROL: the same route IS proven, and REQUIRED, for another AZ school district", () => {
  const v = gradeApplicability(SCHOOL_DISTRICT_EVIDENCE, AZ_SCHOOL_DISTRICT);
  assert.equal(v.grade, "PROVEN");
  assert.equal(v.speculative, false);
  assert.ok(v.matchedDimensions.includes("state"));
  assert.ok(v.matchedDimensions.includes("governmentType"));
  assert.deepEqual(v.mismatchedDimensions, []);

  const k = storeOf(testRoute("sd-only-technique", { applicability: SCHOOL_DISTRICT_EVIDENCE }));
  const floor = computeRouteFloor({
    knowledge: k,
    jurisdiction: AZ_SCHOOL_DISTRICT,
    fields: ["meeting"],
    adapterRoutes: [],
  });
  const route = floor.routes.find((r) => r.routeId === "sd-only-technique");
  assert.ok(route);
  assert.equal(route.obligation, "REQUIRED", "matched typed dimensions ARE proof here");
  assert.ok(floor.routeIds.includes("sd-only-technique"));
});

test("the class-claimed bound still EXCLUDES: the state-bound route does not reach NH", () => {
  const v = gradeApplicability(SCHOOL_DISTRICT_EVIDENCE, NH_SCHOOL_DISTRICT);
  assert.equal(v.grade, "EXCLUDED", "STATE_SPECIFIC claims the state bound and fails it in nh");
  assert.equal(v.applies, false);
});

/* ==================================================================== (c)
 * EVIDENCE DIMENSIONS NEVER WITHHOLD; CLAIMED DIMENSIONS STILL DO
 * ================================================================== */

test("an UNKNOWN route with evidence dimensions is demoted where they disagree, excluded nowhere", () => {
  const unknownWithEvidence = {
    ...unknownApplicability("walked on apptegy school-district sites"),
    states: ["az"],
    governmentTypes: ["school_district"],
    platforms: ["apptegy"],
  };

  const atCounty = gradeApplicability(unknownWithEvidence, {
    ...AZ_COUNTY,
    platform: "legistar",
  });
  assert.equal(atCounty.applies, true, "evidence records are where the route was PROVEN, not where it is confined");
  assert.equal(atCounty.grade, "OFFERED_UNPROVEN");
  assert.deepEqual([...atCounty.mismatchedDimensions].sort(), ["governmentType", "platform"]);

  // The claimed bound is different in kind: a class that names its dimension
  // and fails it is excluded (the RULING 60 case, unchanged).
  const townMeeting = {
    ...unknownApplicability("New England town meeting"),
    portability: "GOVERNMENT_TYPE" as const,
    governmentTypes: ["town"],
  };
  assert.equal(gradeApplicability(townMeeting, { state: "la", governmentType: "parish" }).applies, false);
  assert.equal(gradeApplicability(townMeeting, { state: "nh", governmentType: "town" }).grade, "PROVEN");
});

test("empty dimensions stay UNKNOWN-portability offers: never PROVEN, never REQUIRED, anywhere", () => {
  const bare = testRoute("bare-unclassified-route");
  const k = storeOf(bare);
  for (const j of [AZ_COUNTY, AZ_SCHOOL_DISTRICT, NH_SCHOOL_DISTRICT]) {
    const v = gradeApplicability(bare.applicability, j);
    assert.equal(v.applies, true);
    assert.equal(v.grade, "OFFERED_UNPROVEN", "zero dimensions matched is not proof");

    const floor = computeRouteFloor({ knowledge: k, jurisdiction: j, fields: ["meeting"], adapterRoutes: [] });
    const route = floor.routes.find((r) => r.routeId === "bare-unclassified-route");
    assert.ok(route);
    assert.equal(route.obligation, "EXPLORATORY");
    assert.ok(!floor.routeIds.includes("bare-unclassified-route"));
  }
});

/* ==================================================================== (d)
 * REOPENING STILL FIRES
 * ================================================================== */

test("REOPENING: a demoted-but-applicable route still reopens a prior conclusion", () => {
  let k = storeOf(testRoute("first-route"));
  const conclusion: PriorConclusion = {
    id: "absence-1",
    kind: "ABSENCE",
    field: "meeting",
    jurisdiction: AZ_COUNTY,
    earnedAtVersion: k.version,
    earnedOn: FIXTURE_ON,
  };

  // Learned AFTER the conclusion, applicable to the county only as a demoted
  // offer. A speculative match reopens too: reopening costs a re-walk, and not
  // reopening costs a fact nobody finds.
  k = learnRoute(
    k,
    testRoute("sd-only-technique", { applicability: SCHOOL_DISTRICT_EVIDENCE }),
    FIXTURE_ON,
  ).knowledge;

  const reopenings = findReopenings(k, [conclusion]);
  assert.equal(reopenings.length, 1, "the government-type demotion must not silence the reopening sweep");
  assert.equal(reopenings[0].route.id, "sd-only-technique");
  assert.equal(reopenings[0].conclusion.id, "absence-1");

  // The contrast: a route the class-claimed bound EXCLUDES reopens nothing.
  let k2 = storeOf(testRoute("first-route"));
  k2 = learnRoute(
    k2,
    testRoute("nh-only-technique", {
      applicability: {
        ...unknownApplicability("nh only"),
        portability: "STATE_SPECIFIC" as const,
        states: ["nh"],
      },
    }),
    FIXTURE_ON,
  ).knowledge;
  assert.equal(findReopenings(k2, [conclusion]).length, 0, "an excluded route cannot reopen");
});

/* ==================================================================== (e)
 * THE DERIVATION: EVIDENCE IN, TYPED DIMENSIONS OUT, NOTHING GUESSED
 * ================================================================== */

test("DERIVE: outcome jurisdictions populate states — YIELDED only, and unmappable strings prove nothing", () => {
  assert.equal(stateOfJurisdiction("az"), "az");
  assert.equal(stateOfJurisdiction("az-pima-85641"), "az");
  assert.equal(stateOfJurisdiction("nh"), "nh");
  assert.equal(stateOfJurisdiction("pilot-counties"), null, "not a state, and never guessed into one");

  const r = {
    ...testRoute("walked-route"),
    learnedAtVersion: 1,
    outcomes: [
      { jurisdiction: "az-pima-85641", walkedOn: FIXTURE_ON, rows: 5, outcome: "YIELDED" as const },
      { jurisdiction: "nh", walkedOn: FIXTURE_ON, rows: 0, outcome: "ZERO" as const },
      { jurisdiction: "pilot-counties", walkedOn: FIXTURE_ON, rows: 9, outcome: "YIELDED" as const },
      { jurisdiction: "vt", walkedOn: FIXTURE_ON, rows: 0, outcome: "BLOCKED" as const },
    ],
  };
  const e = deriveRouteEvidence(r);
  assert.deepEqual(
    e.states.map((s) => s.value),
    ["az"],
    "a ZERO walk and a BLOCKED wall are facts about attempts, never proof the route applies (RULING 88/182)",
  );
  assert.ok(e.states[0].because.includes("az-pima-85641"), "the report names the evidence line");
});

test("DERIVE: recorded hosts split into platform evidence and publisher evidence", () => {
  const r = {
    ...testRoute("host-route"),
    learnedAtVersion: 1,
    applicability: {
      ...unknownApplicability(
        "walk https://pima.legistar.com/Calendar.aspx and cross-check www.pima.gov",
      ),
    },
  };
  const e = deriveRouteEvidence(r);
  assert.deepEqual(e.platforms.map((p) => p.value), ["legistar"], "a vendor host proves the PLATFORM");
  assert.deepEqual(
    e.publishers.map((p) => p.value),
    ["www.pima.gov"],
    "a vendor host is never a publisher; a first-party host is",
  );
  assert.equal(e.kind?.value, "RETRIEVAL", "a record naming a surface proves a retrieval route");
});

test("DERIVE: an OCD id in the record's evidence proves the government type", () => {
  const r = {
    ...testRoute("ocd-route"),
    learnedAtVersion: 1,
    claims: [
      {
        id: "ocd-route#exists",
        class: "ROUTE_EXISTENCE" as const,
        statement:
          "proven against ocd-division/country:us/state:az/school_district:vail on the district portal",
        restsOn: [],
      },
    ],
  };
  const e = deriveRouteEvidence(r);
  assert.deepEqual(e.governmentTypes.map((g) => g.value), ["school_district"]);
});

test("DERIVE: a discipline-shaped record proves nothing and is NOT asserted to be a discipline", () => {
  const r = {
    ...testRoute("reconciled-is-not-complete-lookalike", {
      applicability: unknownApplicability(
        "reconciling proves nothing was dropped and never proves enough was asked for",
      ),
      subBranches: [
        // A host in a FAILURE record is not a surface the route was proven
        // against, and must not become one.
        { jurisdiction: "az", failedOn: FIXTURE_ON, reason: "failed against www.pima.gov" },
      ],
    }),
    learnedAtVersion: 1,
  };
  const e = deriveRouteEvidence(r);
  assert.deepEqual(e.states, []);
  assert.deepEqual(e.platforms, []);
  assert.deepEqual(e.publishers, [], "a sub-branch reason is a failure record, never publisher evidence");
  assert.equal(e.kind, null, "no retrieval mechanism proven — which is NOT proof of a discipline");
});

test("PLAN: additive, portability-preserving, version-preserving, and idempotent", () => {
  const k = storeOf(
    testRoute("apptegy-route", {
      applicability: {
        ...unknownApplicability("vailschooldistrict.org hydration payload"),
        platforms: ["apptegy"], // already typed — must be preserved, not duplicated
      },
      outcomes: [{ jurisdiction: "az-pima-85641", walkedOn: FIXTURE_ON, rows: 20, outcome: "YIELDED" }],
    }),
    testRoute("bare-discipline"),
  );

  const plan = planTypedApplicability(k);
  const typed = plan.knowledge.routes.find((r) => r.id === "apptegy-route")!;
  assert.deepEqual(typed.applicability.platforms, ["apptegy"], "existing values survive, once");
  assert.deepEqual(typed.applicability.states, ["az"]);
  assert.deepEqual(typed.applicability.publishers, ["vailschooldistrict.org"]);
  assert.equal(typed.applicability.portability, "UNKNOWN", "population NEVER promotes portability");
  assert.equal(typed.kind, "RETRIEVAL");
  assert.equal(plan.knowledge.version, k.version, "an amendment adds no avenue and bumps nothing");

  const bare = plan.knowledge.routes.find((r) => r.id === "bare-discipline")!;
  assert.deepEqual(bare.applicability.states, [], "empty stays empty when evidence proves nothing");
  assert.equal(bare.kind, undefined);
  assert.ok(plan.kindUnclassified.includes("bare-discipline"), "the gap is named, not papered over");

  // Every addition carries the evidence line that proved it.
  for (const p of plan.routePlans) {
    for (const a of p.additions) {
      assert.ok(a.because.length > 0, `${p.routeId} ${a.dimension}+=${a.value} written with no stated evidence`);
    }
  }

  // Idempotent: a second plan over the first plan's output adds nothing.
  const again = planTypedApplicability(plan.knowledge);
  assert.equal(
    again.routePlans.reduce((n, p) => n + p.additions.length, 0),
    0,
    "re-processing the same evidence must not deepen it",
  );

  // And the populated store introduces no validator issue.
  assert.deepEqual(validateKnowledge(plan.knowledge).map((i) => `${i.id} ${i.rule}`), []);
});

test("VALIDATOR: a kind off the closed set is refused; absent and valid kinds pass", () => {
  const k = storeOf(testRoute("kinded", { kind: "RETRIEVAL" }), testRoute("kindless"));
  assert.deepEqual(validateKnowledge(k), []);

  const bad = structuredClone(k) as MethodKnowledge;
  (bad.routes[0] as { kind: string }).kind = "FETCHER";
  assert.ok(
    validateKnowledge(bad).some((i) => i.rule === "kind-value-off-the-closed-set"),
    "a declared type is not a write path — the closed set is checked",
  );
});
