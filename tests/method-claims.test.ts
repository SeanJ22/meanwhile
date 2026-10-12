/**
 * Claim classes: a valid route survives the correction of a false completeness claim built on it; a superseded or
 * reopened conclusion flags its dependent assertions by name; a consumer receives the corrected truth and never the
 * retracted one; provenance is required for classes C and D.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { beginAttempt, claim as claimLease } from "../lib/control-plane/attempt.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  CLAIM_CLASSES,
  CLAIM_CLASS_LETTER,
  allClaims,
  attachClaims,
  classificationCoverage,
  currentTruthFor,
  findDependencyFlags,
  readCurrentMethod,
  requiresProvenance,
  retractClaim,
  auditCoverage,
  auditTrailFor,
  staleDependents,
  validateClaims,
  type ClaimProvenance,
  type MethodClaim,
} from "../lib/method/claims.ts";
import {
  emptyKnowledge,
  applicableRoutesUnprojected,
  learnRoute,
  validateKnowledge,
  type MethodKnowledge,
  type MethodRoute,
} from "../lib/method/knowledge.ts";
import { testRoute } from "./method-fixtures.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";

const ON = "2026-08-28";

// The route factory is shared with `tests/method-projection.test.ts`.
const route = testRoute;

function storeWith(...routes: Array<Omit<MethodRoute, "learnedAtVersion">>): MethodKnowledge {
  let k = emptyKnowledge();
  for (const r of routes) k = learnRoute(k, r, ON).knowledge;
  return k;
}

function provenance(over: Partial<ClaimProvenance> = {}): ClaimProvenance {
  return {
    artifact: "https://example.gov/records/1",
    observedVia: "the-route",
    disposition: "YIELDED",
    jurisdictions: ["az"],
    vendors: ["legistar"],
    observedOn: ON,
    ...over,
  };
}

test("the four claim classes are named, not lettered — `tier` already owns A0/A1/B/C", () => {
  // The letters survive as a derived label and never as the stored value, so a class never reads as a route tier.
  assert.deepEqual([...CLAIM_CLASSES], [
    "ROUTE_EXISTENCE",
    "ROUTE_OUTCOME",
    "COVERAGE_CLAIM",
    "DERIVED_CONCLUSION",
  ]);
  assert.equal(CLAIM_CLASS_LETTER.COVERAGE_CLAIM, "C");
  assert.equal(CLAIM_CLASS_LETTER.DERIVED_CONCLUSION, "D");

  // Only the two propagating classes carry the provenance requirement.
  assert.equal(requiresProvenance("ROUTE_EXISTENCE"), false);
  assert.equal(requiresProvenance("ROUTE_OUTCOME"), false);
  assert.equal(requiresProvenance("COVERAGE_CLAIM"), true);
  assert.equal(requiresProvenance("DERIVED_CONCLUSION"), true);
});

test("CONTROL (a): a valid route SURVIVES the correction of a false completeness claim built on it", () => {
  // The route and its true claims stay; only the false completeness claim is withdrawn. A deleted route is rediscovered as new.
  let k = storeWith(route("the-route", { fields: ["meeting"] }), route("the-better-route"));

  const claims: MethodClaim[] = [
    {
      id: "the-route#exists",
      class: "ROUTE_EXISTENCE",
      statement: "this public route exists and can be walked",
      restsOn: [],
    },
    {
      id: "the-route#walked",
      class: "ROUTE_OUTCOME",
      statement: "walked in az on 2026-08-28, returned 7 rows",
      restsOn: ["the-route"],
    },
    {
      id: "the-route#complete",
      class: "COVERAGE_CLAIM",
      statement: "those 7 rows are the complete set for the window",
      restsOn: ["the-route#walked"],
      provenance: provenance(),
      validation: { state: "UNVALIDATED", on: ON, by: "one route's answer" },
    },
  ];
  k = { ...k, routes: attachClaims(k.routes, "the-route", claims).routes };

  const before = applicableRoutesUnprojected(k, { state: "az" }).length;

  // The completeness claim is withdrawn. Nothing else may move.
  const res = retractClaim(k.routes, "the-route#complete", {
    kind: "SUPERSEDED",
    on: ON,
    why: "a second route returned three rows this one could not see",
    supersededBy: "the-better-route",
    survives: "the route and its outcome — seven rows is still exactly what it returned",
  });
  assert.equal(res.retracted, true);
  k = { ...k, routes: res.routes };

  // The route is still present...
  const still = k.routes.find((r) => r.id === "the-route");
  assert.ok(still, "the route must still be in project knowledge after its conclusion is retracted");
  // ...not retired...
  assert.equal(still!.retiredOn, undefined, "withdrawing a claim may never retire the route under it");
  // ...and still usable: it is still offered to a jurisdiction.
  assert.equal(
    applicableRoutesUnprojected(k, { state: "az" }).length,
    before,
    "the route is still inherited — a false C never removes an A from the offer",
  );
  assert.ok(readCurrentMethod(k).find((v) => v.routeId === "the-route")!.routeUsable);

  // The true claims under it are untouched and still current.
  const current = readCurrentMethod(k).find((v) => v.routeId === "the-route")!;
  assert.deepEqual(
    current.current.map((c) => c.id).sort(),
    ["the-route#exists", "the-route#walked"],
    "the existence claim and the outcome claim survive the coverage claim being wrong",
  );
  assert.deepEqual(current.retracted.map((r) => r.claim.id), ["the-route#complete"]);

  // The retracted claim is kept, never erased.
  assert.equal(allClaims(k).length, 3, "nothing is deleted; the withdrawn claim stays on the record");
});

test("CONTROL (a), the other half: retracting every claim on a route still does not remove the route", () => {
  /* Otherwise the property above would hold only while one claim survived. */
  let k = storeWith(route("solo"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "solo", [
      {
        id: "solo#conclusion",
        class: "DERIVED_CONCLUSION",
        statement: "the record contains nothing here",
        restsOn: ["solo"],
        provenance: provenance({ observedVia: "solo" }),
        validation: { state: "CONTRADICTED", on: ON, by: "a second route" },
      },
    ]).routes,
  };
  k = {
    ...k,
    routes: retractClaim(k.routes, "solo#conclusion", {
      kind: "CORRECTED",
      on: ON,
      why: "the record contained it after all",
      supersededBy: null,
      survives: "the route, entirely",
    }).routes,
  };
  assert.equal(k.routes.length, 1);
  assert.equal(applicableRoutesUnprojected(k, { state: "az" }).length, 1, "a route with zero current claims still inherits");
});

test("CONTROL (b): a superseded conclusion MECHANICALLY flags its dependent assertions, named", () => {
  let k = storeWith(route("r1"), route("r2"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "r1", [
      {
        id: "r1#coverage",
        class: "COVERAGE_CLAIM",
        statement: "this route is complete for meetings here",
        restsOn: ["r1"],
        provenance: provenance({ observedVia: "r1" }),
        validation: { state: "UNVALIDATED", on: ON, by: "one route" },
      },
    ]).routes,
  };
  k = {
    ...k,
    routes: attachClaims(k.routes, "r2", [
      {
        id: "r2#conclusion",
        class: "DERIVED_CONCLUSION",
        statement: "the body therefore publishes no September sittings",
        restsOn: ["r1#coverage"],
        provenance: provenance({ observedVia: "r2" }),
        validation: { state: "UNVALIDATED", on: ON, by: "the coverage claim above" },
      },
      {
        // Same subject, same words, and it does not declare the dependency: dependence is declared, never inferred.
        id: "r2#unrelated",
        class: "ROUTE_OUTCOME",
        statement: "this route is complete for meetings here, September sittings included",
        restsOn: ["r2"],
      },
    ]).routes,
  };

  assert.equal(findDependencyFlags(k).length, 0, "nothing is flagged while nothing is withdrawn");

  k = {
    ...k,
    routes: retractClaim(k.routes, "r1#coverage", {
      kind: "SUPERSEDED",
      on: ON,
      why: "a second route saw rows this one could not",
      supersededBy: null,
      survives: "the route and its outcome",
    }).routes,
  };

  const flags = findDependencyFlags(k);
  assert.equal(flags.length, 1, "exactly the assertion that NAMED the withdrawn claim is flagged");
  assert.equal(flags[0].dependent, "r2#conclusion", "and it is flagged BY NAME");
  assert.equal(flags[0].upstream, "r1#coverage");
  assert.equal(flags[0].status, "STALE", "it is still teaching, and nothing has dispositioned it");
  assert.match(flags[0].why, /still teaching/);

  // The validator refuses.
  const issues = validateKnowledge(k);
  const hit = issues.find((i) => i.rule === "stale-dependent-assertion");
  assert.ok(hit, "a withdrawn assertion whose dependents still teach must FAIL the validator");
  assert.equal(hit!.id, "r2#conclusion");

  /* CONTROL: dispositioning the dependent clears it — so the test above is
     measuring disposition rather than the mere existence of a `restsOn` edge. */
  const dispositioned = {
    ...k,
    routes: retractClaim(k.routes, "r2#conclusion", {
      kind: "CORRECTED",
      on: ON,
      why: "it rested on a claim that was withdrawn",
      supersededBy: null,
      survives: "the route",
    }).routes,
  };
  assert.equal(staleDependents(dispositioned).length, 0);
  assert.equal(findDependencyFlags(dispositioned)[0].status, "DISPOSITIONED");
  assert.equal(validateKnowledge(dispositioned).filter((i) => i.rule === "stale-dependent-assertion").length, 0);
});

test("a revalidation dated BEFORE the retraction does not disposition anything", () => {
  // The revalidation date has to be on or after the retraction's own date.
  const build = (revalidatedOn: string) => {
    let k = storeWith(route("up"), route("down"));
    k = {
      ...k,
      routes: attachClaims(k.routes, "up", [
        {
          id: "up#c",
          class: "COVERAGE_CLAIM",
          statement: "complete",
          restsOn: ["up"],
          provenance: provenance({ observedVia: "up" }),
          validation: { state: "UNVALIDATED", on: ON, by: "one route" },
        },
      ]).routes,
    };
    k = {
      ...k,
      routes: attachClaims(k.routes, "down", [
        {
          id: "down#c",
          class: "COVERAGE_CLAIM",
          statement: "rests on the above",
          restsOn: ["up#c"],
          provenance: provenance({ observedVia: "down" }),
          validation: {
            state: "REVALIDATED_AFTER_UPSTREAM_RETRACTION",
            on: revalidatedOn,
            by: "a second route",
          },
        },
      ]).routes,
    };
    return {
      ...k,
      routes: retractClaim(k.routes, "up#c", {
        kind: "SUPERSEDED",
        on: "2026-08-28",
        why: "wrong",
        supersededBy: null,
        survives: "the route",
      }).routes,
    };
  };

  assert.equal(staleDependents(build("2026-08-20")).length, 1, "a stale revalidation disposition nothing");
  assert.equal(staleDependents(build("2026-08-28")).length, 0, "one dated on the retraction does");
});

test("a RETIRED ROUTE flags the claims resting on it, for the same reason", () => {
  let k = storeWith(route("ground"), route("built-on-it"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "built-on-it", [
      {
        id: "built-on-it#c",
        class: "DERIVED_CONCLUSION",
        statement: "the record contains X",
        restsOn: ["ground"],
        provenance: provenance({ observedVia: "ground" }),
        validation: { state: "VALIDATED", on: ON, by: "the ground route" },
      },
    ]).routes,
  };
  const retired = {
    ...k,
    routes: k.routes.map((r) =>
      r.id === "ground" ? { ...r, retiredOn: ON, retiredReason: "the publisher removed the endpoint" } : r,
    ),
  };
  const flags = findDependencyFlags(retired);
  assert.equal(flags.length, 1);
  assert.equal(flags[0].upstreamKind, "ROUTE_RETIRED");
  assert.equal(flags[0].dependent, "built-on-it#c");
  assert.equal(flags[0].status, "STALE");
});

test("CONTROL (c): a consumer asking about a retracted conclusion is handed the CORRECTED one", () => {
  let k = storeWith(route("old"), route("new"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "old", [
      {
        id: "old#no-september",
        class: "DERIVED_CONCLUSION",
        statement: "the body publishes no September sittings",
        restsOn: ["old"],
        provenance: provenance({ observedVia: "old" }),
        validation: { state: "CONTRADICTED", on: ON, by: "new#september-published" },
      },
    ]).routes,
  };
  k = {
    ...k,
    routes: attachClaims(k.routes, "new", [
      {
        id: "new#september-published",
        class: "DERIVED_CONCLUSION",
        statement: "all three September sittings are individually published on the body's portal",
        restsOn: ["new"],
        provenance: provenance({ observedVia: "new" }),
        validation: { state: "VALIDATED", on: ON, by: "the portal's own rows" },
      },
    ]).routes,
  };
  k = {
    ...k,
    routes: retractClaim(k.routes, "old#no-september", {
      kind: "CORRECTED",
      on: ON,
      why: "the sittings were published all along, on a record this route never asked",
      supersededBy: "new#september-published",
      survives: "the route, and the observation that the two records run on different clocks",
    }).routes,
  };

  // Asked by the old id, a consumer receives the new claim.
  const t = currentTruthFor(k, "old#no-september");
  assert.equal(t.status, "SUPERSEDED");
  assert.equal(t.claim?.id, "new#september-published");
  assert.match(t.claim!.statement, /individually published/);
  // ...and the retracted text is retained beside it, labelled.
  assert.equal(t.superseded?.id, "old#no-september");
  assert.match(t.why, /is NOT current/);

  // And the retracted claim never appears in the current set.
  const views = readCurrentMethod(k);
  const currentIds = views.flatMap((v) => v.current.map((c) => c.id));
  assert.ok(!currentIds.includes("old#no-september"), "a superseded conclusion is never surfaced as current");
  assert.ok(currentIds.includes("new#september-published"));
  assert.equal(
    views.find((v) => v.routeId === "old")!.retracted[0].correctedBy?.id,
    "new#september-published",
    "the history points at what corrected it",
  );

  // A chain resolves to the end, and a cycle cannot hang a consumer.
  const cyclic = {
    ...k,
    routes: retractClaim(k.routes, "new#september-published", {
      kind: "SUPERSEDED",
      on: ON,
      why: "planted cycle",
      supersededBy: "old#no-september",
      survives: "nothing — this is a planted data defect",
    }).routes,
  };
  const looped = currentTruthFor(cyclic, "old#no-september");
  assert.equal(looped.status, "WITHDRAWN", "a supersession cycle resolves to WITHDRAWN, never to a hang");
  assert.match(looped.why, /WHAT SURVIVES/);
});

test("an unclassified legacy entry is reported as UNCLASSIFIED, never as a declared class A", () => {
  // Entries that predate claim classes declared nothing; silence is not a declaration that the entry is merely a route.
  const k = storeWith(route("legacy"));
  const view = readCurrentMethod(k)[0];
  assert.equal(view.classification, "UNCLASSIFIED_LEGACY");
  assert.equal(view.current.length, 0);
  assert.equal(classificationCoverage(k).unclassified, 1);
  assert.equal(classificationCoverage(k).classified, 0);
});

test("PLANTED CONTROL (d): a COVERAGE_CLAIM or DERIVED_CONCLUSION with no provenance is REFUSED", () => {
  // Classes C and D propagate, so each must be auditable back to the artifact, route disposition, coverage and date.
  for (const cls of ["COVERAGE_CLAIM", "DERIVED_CONCLUSION"] as const) {
    let k = storeWith(route("the-route"));
    k = {
      ...k,
      routes: attachClaims(k.routes, "the-route", [
        {
          id: `the-route#${cls}`,
          class: cls,
          statement: "something a later session would inherit as a reason to stop looking",
          restsOn: ["the-route"],
        },
      ]).routes,
    };
    const issues = validateKnowledge(k);
    const hit = issues.find((i) => i.rule === "claim-provenance-required");
    assert.ok(hit, `${cls} without provenance must be REFUSED by the validator`);
    assert.match(hit!.detail, /provenance/);
    assert.ok(
      issues.some((i) => i.rule === "claim-validation-state-required"),
      `${cls} must also state whether it has been validated — silence reads as checked`,
    );
  }

  /* CONTROL 1: the SAME claim with full provenance passes, so the test is
     measuring provenance rather than the class existing at all. */
  let good = storeWith(route("the-route"));
  good = {
    ...good,
    routes: attachClaims(good.routes, "the-route", [
      {
        id: "the-route#c",
        class: "COVERAGE_CLAIM",
        statement: "this route is incomplete for meetings in az",
        restsOn: ["the-route"],
        provenance: provenance(),
        validation: { state: "VALIDATED", on: ON, by: "a second independent route" },
      },
    ]).routes,
  };
  assert.deepEqual(validateKnowledge(good).map((i) => i.rule), []);

  /* CONTROL 2: A and B do NOT require it — the requirement is targeted at the
     classes that propagate, not applied everywhere to look thorough. */
  let ab = storeWith(route("the-route"));
  ab = {
    ...ab,
    routes: attachClaims(ab.routes, "the-route", [
      { id: "the-route#a", class: "ROUTE_EXISTENCE", statement: "it exists", restsOn: [] },
      { id: "the-route#b", class: "ROUTE_OUTCOME", statement: "walked az, 7 rows", restsOn: ["the-route"] },
    ]).routes,
  };
  assert.deepEqual(validateKnowledge(ab).map((i) => i.rule), []);
});

test("PLANTED: each individual provenance field is required, one at a time", () => {
  // One field at a time, so a passing run cannot be one required field doing all the work.
  const fields: Array<[keyof ClaimProvenance, unknown]> = [
    ["artifact", ""],
    ["observedVia", ""],
    ["disposition", "WORKED"],
    ["jurisdictions", []],
    ["observedOn", "yesterday"],
  ];
  for (const [field, broken] of fields) {
    let k = storeWith(route("the-route"));
    k = {
      ...k,
      routes: attachClaims(k.routes, "the-route", [
        {
          id: "the-route#c",
          class: "COVERAGE_CLAIM",
          statement: "complete",
          restsOn: ["the-route"],
          provenance: { ...provenance(), [field]: broken } as ClaimProvenance,
          validation: { state: "UNVALIDATED", on: ON, by: "one route" },
        },
      ]).routes,
    };
    const hit = validateKnowledge(k).find((i) => i.rule === "claim-provenance-required");
    assert.ok(hit, `provenance.${field} must be required`);
    assert.match(hit!.detail, new RegExp(String(field)));
  }
});

test("PLANTED: a C or D that rests on nothing is refused — the dependency edge is declared", () => {
  // Flagging is derived from a declared edge, so an assertion that declares no edge can never be flagged.
  let k = storeWith(route("the-route"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "the-route", [
      {
        id: "the-route#c",
        class: "COVERAGE_CLAIM",
        statement: "complete",
        restsOn: [],
        provenance: provenance(),
        validation: { state: "UNVALIDATED", on: ON, by: "one route" },
      },
    ]).routes,
  };
  assert.ok(validateKnowledge(k).some((i) => i.rule === "claim-rests-on-nothing"));
});

test("PLANTED: a restsOn naming an id project knowledge does not hold is refused", () => {
  let k = storeWith(route("the-route"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "the-route", [
      { id: "the-route#a", class: "ROUTE_EXISTENCE", statement: "exists", restsOn: ["a-route-nobody-learned"] },
    ]).routes,
  };
  const hit = validateKnowledge(k).find((i) => i.rule === "claim-rests-on-unknown-id");
  assert.ok(hit, "a dangling dependency edge is a flag that will never fire");
  assert.match(hit!.detail, /a-route-nobody-learned/);
});

test("PLANTED: a claim class off the closed set is refused, and a retraction without WHAT SURVIVES is too", () => {
  let k = storeWith(route("the-route"));
  k = {
    ...k,
    routes: attachClaims(k.routes, "the-route", [
      {
        id: "the-route#x",
        class: "CONCLUSION" as unknown as "DERIVED_CONCLUSION",
        statement: "off the set",
        restsOn: [],
      },
      {
        id: "the-route#y",
        class: "ROUTE_EXISTENCE",
        statement: "exists",
        restsOn: [],
        retraction: { kind: "SUPERSEDED", on: ON, why: "", supersededBy: null, survives: "" },
      },
    ]).routes,
  };
  const rules = validateClaims(k).map((i) => i.rule);
  assert.ok(rules.includes("claim-class-off-the-closed-set"));
  assert.ok(rules.includes("retraction-incomplete"), "a retraction that cannot name what survives is not thought through");
});

test("a NEW route learned after the floor version must declare a claim class", () => {
  // The requirement is forward: legacy entries are not backfilled, and it bites on the next route learned.
  const legacy = { ...storeWith(route("old")), version: 55 };
  legacy.routes[0].learnedAtVersion = 55;
  assert.deepEqual(validateKnowledge(legacy).map((i) => i.rule), [], "the legacy floor is not retroactive");

  const next = learnRoute(legacy, route("brand-new"), ON).knowledge;
  assert.equal(next.version, 56);
  assert.ok(
    validateKnowledge(next).some((i) => i.rule === "claim-class-required-for-new-route"),
    "a route entering after the floor must say what it is asserting",
  );

  const classified = learnRoute(
    legacy,
    route("brand-new-classified", {
      claims: [{ id: "brand-new-classified#a", class: "ROUTE_EXISTENCE", statement: "it exists", restsOn: [] }],
    }),
    ON,
  ).knowledge;
  assert.deepEqual(validateKnowledge(classified).map((i) => i.rule), []);
});

test("a route AMENDED after adoption must declare a claim class", () => {
  const amended = { ...storeWith(route("old", {
    subBranches: [{ jurisdiction: "az", failedOn: "2026-09-01", reason: "stopped working here" }],
  })), version: 55 };
  amended.routes[0].learnedAtVersion = 55;
  assert.ok(
    validateKnowledge(amended).some((i) => i.rule === "claim-class-required-for-amendment"),
    "an amendment is the moment a reader has to know WHAT changed",
  );

  /* CONTROL: a sub-branch whose `failedOn` is prose rather than a date does not trigger it. */
  const prose = { ...storeWith(route("legacy-prose", {
    subBranches: [{ jurisdiction: "Morris County, 2026-08-25", failedOn: "It publishes no directory this walk could find.", reason: "inherited route failed here" }],
  })), version: 55 };
  prose.routes[0].learnedAtVersion = 55;
  assert.deepEqual(validateKnowledge(prose).map((i) => i.rule), []);
});

/**
 * An audit walks identifiers, not a typed URL: a claim with `provenance.attemptId` reaches the real control-plane
 * `Attempt` and `RouteTask`, and a claim without one reports the gap by name instead of falling back to the prose.
 */

test("a claim is auditable claim -> assertion -> Attempt -> RouteTask -> artifacts, on identifiers", () => {
  const workItem = createWorkItem({
    project: "wtp",
    subject: "ocd-division/country:us/state:az/county:pima",
    obligation: "meetings for the county board",
    why: "an audit-chain control",
    now: "2026-08-29T00:00:00.000Z",
  });
  const task = createRouteTask({
    workItemId: workItem.id,
    routeId: "audit-chain-route",
    routeLabel: "Legistar /Events",
    target: "webapi.legistar.com",
    inherited: true,
    now: "2026-08-29T00:00:00.000Z",
  });
  const lease = claimLease(task.id, "worker-1", "2026-08-29T00:00:00.000Z", 60_000, null);
  const attempt = {
    ...beginAttempt({
      routeTaskId: task.id,
      workItemId: workItem.id,
      worker: { role: "ACQUIRER" as const, provider: "anthropic", version: "test", instance: "i-1" },
      lease,
      now: "2026-08-29T00:00:00.000Z",
      methodVersion: 55,
      policyVersion: "test",
    }),
    artifactIds: ["sha256-deadbeef"],
  };

  const store = {
    routes: [
      {
        id: "audit-chain-route",
        claims: [
          {
            id: "audit-chain-route#coverage",
            class: "COVERAGE_CLAIM" as const,
            statement: "the vendor API returns every sitting in this window",
            restsOn: ["audit-chain-route"],
            provenance: {
              artifact: "https://webapi.legistar.com/v1/pima/events",
              observedVia: "audit-chain-route",
              disposition: "YIELDED" as const,
              jurisdictions: ["az"],
              vendors: ["legistar"],
              observedOn: "2026-08-29",
              attemptId: attempt.id,
            },
            validation: { state: "VALIDATED" as const, on: "2026-08-29", by: "audit-chain-route" },
          },
        ],
      },
    ],
  };

  const trail = auditTrailFor(store, "audit-chain-route#coverage", [attempt], [task]);
  assert.equal(trail.complete, true, `the chain broke: ${trail.gaps.join("; ")}`);
  assert.deepEqual(trail.resolved, [
    "CLAIM",
    "METHOD_ASSERTION_ROUTE",
    "ATTEMPT",
    "ROUTE_TASK",
    "ARTIFACTS",
  ]);
  assert.equal(trail.attemptId, attempt.id);
  assert.equal(trail.routeTaskId, task.id);
  assert.deepEqual(trail.artifactIds, ["sha256-deadbeef"]);
  assert.match(trail.why, /every hop joined on an identifier and none on the prose reference/);

  // Remove the Attempt id and the chain must stop, not fall back to the URL in the same record.
  const proseOnly = {
    routes: [
      {
        id: "audit-chain-route",
        claims: [
          {
            ...store.routes[0].claims[0],
            id: "audit-chain-route#legacy",
            provenance: { ...store.routes[0].claims[0].provenance, attemptId: undefined },
          },
        ],
      },
    ],
  };
  const legacy = auditTrailFor(proseOnly, "audit-chain-route#legacy", [attempt], [task]);
  assert.equal(legacy.complete, false);
  assert.equal(legacy.attemptId, null);
  assert.deepEqual(legacy.artifactIds, []);
  assert.equal(legacy.proseArtifactNotAJoin, "https://webapi.legistar.com/v1/pima/events");
  assert.ok(
    legacy.gaps.some((g) => /a prose reference is not a join/.test(g)),
    "the gap must be NAMED, never silently bridged by the artifact string",
  );
});

test("a chain that resolves to the WRONG route is a gap, not a pass", () => {
  const attempt = { id: "at-1", routeTaskId: "rt-1", artifactIds: ["sha256-1"] };
  const task = { id: "rt-1", routeId: "a-different-route", disposition: null };
  const store = {
    routes: [
      {
        id: "audit-mismatch",
        claims: [
          {
            id: "audit-mismatch#c",
            class: "COVERAGE_CLAIM" as const,
            statement: "something",
            restsOn: ["audit-mismatch"],
            provenance: {
              artifact: "https://example.gov/x",
              observedVia: "audit-mismatch",
              disposition: "YIELDED" as const,
              jurisdictions: ["az"],
              vendors: [],
              observedOn: "2026-08-29",
              attemptId: "at-1",
            },
            validation: { state: "VALIDATED" as const, on: "2026-08-29", by: "x" },
          },
        ],
      },
    ],
  };
  const trail = auditTrailFor(store, "audit-mismatch#c", [attempt], [task]);
  assert.equal(trail.complete, false);
  assert.ok(trail.gaps.some((g) => /both resolve and disagree/.test(g)));

  // An Attempt or RouteTask nobody holds stops at its own hop.
  assert.deepEqual(auditTrailFor(store, "audit-mismatch#c", [], [task]).resolved, [
    "CLAIM",
    "METHOD_ASSERTION_ROUTE",
  ]);
  assert.deepEqual(auditTrailFor(store, "audit-mismatch#c", [attempt], []).resolved, [
    "CLAIM",
    "METHOD_ASSERTION_ROUTE",
    "ATTEMPT",
  ]);

  // A claim reaching an Attempt and a RouteTask with no artifact arrives at a report of a fetch, not the fetch.
  const noArtifacts = auditTrailFor(
    store,
    "audit-mismatch#c",
    [{ ...attempt, artifactIds: [] }],
    [{ ...task, routeId: "audit-mismatch" }],
  );
  assert.equal(noArtifacts.complete, false);
  assert.ok(noArtifacts.gaps.some((g) => /nothing to re-read/.test(g)));
});

test("attemptId is ADDITIVE — the committed store still validates, and a blank one does not", () => {
  // Committed routes carry no Attempt ids, and back-filling one would invent provenance.
  const k = JSON.parse(readFileSync(METHOD_FIXTURE_PATH, "utf8")) as MethodKnowledge;
  assert.deepEqual(validateClaims(k), []);

  const coverage = auditCoverage(k, [], []);
  assert.ok(coverage.total > 0, "this control is vacuous if the store declares no C or D claims");
  assert.equal(
    coverage.auditable,
    0,
    "no committed claim is attempt-bound yet, and reporting otherwise would be the lie",
  );
  for (const t of coverage.trails) {
    assert.ok(t.gaps.some((g) => /predates attempt-bound provenance/.test(g)));
  }

  // PLANTED: a present but blank attemptId is refused; omitting the field is not.
  const planted = {
    routes: [
      {
        id: "blank-attempt",
        claims: [
          {
            id: "blank-attempt#c",
            class: "COVERAGE_CLAIM" as const,
            statement: "something",
            restsOn: ["blank-attempt"],
            provenance: {
              artifact: "https://example.gov/x",
              observedVia: "blank-attempt",
              disposition: "YIELDED" as const,
              jurisdictions: ["az"],
              vendors: [],
              observedOn: "2026-08-29",
              attemptId: "   ",
            },
            validation: { state: "VALIDATED" as const, on: "2026-08-29", by: "x" },
          },
        ],
      },
    ],
  };
  assert.ok(validateClaims(planted).some((i) => i.rule === "claim-provenance-attempt-blank"));
});
