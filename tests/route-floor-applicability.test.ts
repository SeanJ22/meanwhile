/**
 * A speculative method hypothesis is not a known route whose omission must block completion. These call the
 * real `computeRouteFloor` and `gradeApplicability`; none re-implements the rule.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { computeRouteFloor } from "../lib/control-plane/preflight.ts";
import { emptyKnowledge, learnRoute } from "../lib/method/knowledge.ts";
import { gradeApplicability, unknownApplicability } from "../lib/method/portability.ts";

const T0 = "2026-08-29T00:00:00.000Z";
const COUNTY = { state: "az", governmentType: "county", platform: "legistar", publisher: "county.legistar.com" } as const;

test("a method route whose typed dimension MATCHES is required, not exploratory", () => {
  // The promotion path, on a synthetic store.
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
    jurisdiction: COUNTY,
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

test("an underspecified constraint is an ABSENT constraint and proves nothing", () => {
  // `PUBLISHER_SPECIFIC` with no publishers named must not grade as proven.
  const underspecified = {
    ...unknownApplicability("a publisher-specific route that names no publisher"),
    portability: "PUBLISHER_SPECIFIC" as const,
  };
  const v = gradeApplicability(underspecified, COUNTY);
  assert.equal(v.applies, true, "it is still OFFERED");
  assert.equal(v.grade, "OFFERED_UNPROVEN", "but nothing about its fit here was proven");
  assert.deepEqual(v.matchedDimensions, []);
  assert.ok(v.unstatedDimensions.includes("publisher"));

  const stated = gradeApplicability(
    { ...underspecified, publishers: ["county.legistar.com"] },
    COUNTY,
  );
  assert.equal(stated.grade, "PROVEN", "a stated constraint that MATCHES is proof");
  assert.deepEqual(stated.matchedDimensions, ["publisher"]);
});

test("a jurisdiction may not prove a state-family route applies to itself", () => {
  // A jurisdiction listing itself in its own family must not prove a state-family route.
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

test("a route with recorded states elsewhere is still OFFERED, never withheld", () => {
  // A route walked once in one state that claims no reach is still offered elsewhere, graded honestly.
  const walkedInNh = {
    ...unknownApplicability("one data point, no claimed reach"),
    states: ["nh"],
  };
  const v = gradeApplicability(walkedInNh, COUNTY);
  assert.equal(v.applies, true);
  assert.equal(v.grade, "OFFERED_UNPROVEN");
});
