import assert from "node:assert/strict";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";
import { TOPIC_ROUTES } from "../lib/routing/topics.ts";

/**
 * The routing knowledge base (6) — the refusals as tests, then the golden
 * cases against the real Tucson registry. Built before any UI, on purpose.
 */

const TUCSON: [number, number] = [32.21696, -110.971];

test("every route is cited and party appears nowhere in the map", () => {
  assert.ok(TOPIC_ROUTES.length > 0);
  for (const route of TOPIC_ROUTES) {
    assert.ok(route.basis.length > 0, `${route.id}: a route must name its basis`);
    assert.ok(route.steps.length > 0, `${route.id}: a route with no steps routes nothing`);
    const serialized = JSON.stringify(route).toLowerCase();
    for (const banned of ["party", "democrat", "republican", "partisan"]) {
      assert.ok(
        !serialized.includes(banned),
        `${route.id}: party can never enter routing`,
      );
    }
  }
});

test("an unmapped topic returns the honest refusal, never a guess", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const answer = resolveRouting("something-nobody-mapped", coverage);
  assert.equal(answer.kind, "NO_ROUTE");
  assert.ok(answer.statement && answer.statement.includes("Rather than guess"));
  assert.equal(answer.steps.length, 0);
});

test("golden case: the stopped library, at Tucson", async () => {
  // The author's example: "they stopped building the library down the road
  // — who should I talk to?" The route must land on the city council's body
  // (Tucson) and the county board (Pima — which sits as the Library
  // District board, D19), each with its denominator.
  const coverage = await coverageAt(...TUCSON, 1);
  const answer = resolveRouting("libraries", coverage);
  assert.equal(answer.kind, "ROUTED");
  assert.equal(answer.steps.length, 2);

  const [cityStep, countyStep] = answer.steps;
  assert.ok(
    cityStep.bodies.some((b) => b.label === "Tucson"),
    `city step must name Tucson, got ${JSON.stringify(cityStep.bodies)}`,
  );
  assert.ok(
    countyStep.bodies.some((b) => b.label === "Pima"),
    `county step must name Pima, got ${JSON.stringify(countyStep.bodies)}`,
  );
  // Local rosters don't exist yet, so the honest half-gap must be stated —
  // the body is real, who sits on it is unsourced.
  assert.ok(cityStep.gap?.includes("who sits on this body"));
  assert.equal(answer.grounding.stepsWithSomeone, 2);
  assert.equal(answer.grounding.totalSteps, 2);
});

test("golden case: a school being run badly, at Tucson", async () => {
  // The author's model sentence lives on this route: superintendent first
  // (runs the district), board second (bound by it).
  const coverage = await coverageAt(...TUCSON, 1);
  const answer = resolveRouting("schools-operations", coverage);
  assert.equal(answer.kind, "ROUTED");
  const [superStep, boardStep] = answer.steps;
  assert.ok(
    superStep.bodies.some((b) => b.label.includes("Tucson Unified")),
    "the superintendent step grounds on TUSD",
  );
  assert.ok(boardStep.bodies.some((b) => b.label.includes("Tucson Unified")));
});

test("a state-law topic grounds on the actual state legislators", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const answer = resolveRouting("state-law", coverage);
  assert.equal(answer.kind, "ROUTED");
  const [repStep, senStep] = answer.steps;
  // 85701 sits in LD-20: two representatives, one senator, all sourced.
  assert.ok(repStep.people.length >= 2, `expected the LD-20 reps, got ${repStep.people.length}`);
  assert.ok(senStep.people.length >= 1);
  for (const person of [...repStep.people, ...senStep.people]) {
    assert.ok(person.sourceUrl, `${person.name} must carry their source`);
  }
});

test("party labels cannot change what routing returns", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const scrambled: typeof coverage = JSON.parse(JSON.stringify(coverage));
  for (const seat of scrambled.seats) {
    for (const holder of seat.representatives) holder.partyLabel = "Scrambled";
  }
  for (const holder of scrambled.senators) holder.partyLabel = "Scrambled";

  const a = resolveRouting("federal", coverage);
  const b = resolveRouting("federal", scrambled);
  // Identical people in identical order — labels ride along for display but
  // can never reorder, include, or exclude anyone.
  assert.deepEqual(
    a.steps.map((s) => s.people.map((p) => p.id)),
    b.steps.map((s) => s.people.map((p) => p.id)),
  );
});

test("a thin area routes honestly: gaps stated, nothing guessed", async () => {
  // Hutchinson KS — outside every clip. The registry knows nothing local
  // here; every body-target step must carry the honest gap.
  const coverage = await coverageAt(38.0608, -97.9298, 0);
  const answer = resolveRouting("libraries", coverage);
  assert.equal(answer.kind, "ROUTED");
  for (const step of answer.steps) {
    assert.equal(step.bodies.length, 0);
    assert.ok(step.gap, "an ungroundable step must say so");
  }
  assert.equal(answer.grounding.stepsWithSomeone, 0);
});
