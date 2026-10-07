import assert from "node:assert/strict";
import test from "node:test";
import type { OfficialStateLegislatorReadModel } from "../lib/civic-data/candidate-builders.ts";
import { installPromotedValue, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();

// Arizona's promoted state roster, as the azleg.gov MemberRoster import holds
// it: two representatives and one senator for Legislative District 20.
const AZ_ROSTER = "https://www.azleg.gov/MemberRoster/";
const azLegislator = (id: string, name: string, chamber: "lower" | "upper", ocdId: string) => ({
  officeholder: {
    id: `az-legislature:${id}`,
    name,
    officeTitle: chamber === "lower" ? "State Representative" : "State Senator",
    level: "STATE" as const,
    termStart: "2025-01-13",
    termEnd: "2027-01-11",
    birthDate: null,
    partyLabel: null,
    websiteUrl: AZ_ROSTER,
    contactFormUrl: null,
    phone: null,
    email: null,
    campaignUrl: null,
    photo: null,
    state: "AZ",
    chamber,
    provenance: { sourceUrl: AZ_ROSTER, sourceOrg: "Arizona State Legislature", collectedAt: "2026-09-25T12:00:00.000Z", verifiedAt: null },
  },
  division: { officeholderId: `az-legislature:${id}`, ocdId, bodyId: null },
});
const ld20 = [
  azLegislator("rep-a", "Representative A", "lower", "ocd-division/country:us/state:az/sldl:20"),
  azLegislator("rep-b", "Representative B", "lower", "ocd-division/country:us/state:az/sldl:20"),
  azLegislator("sen-a", "Senator A", "upper", "ocd-division/country:us/state:az/sldu:20"),
];
installPromotedValue<OfficialStateLegislatorReadModel>({
  recordClass: "STATE_LEGISLATOR",
  scope: "US-AZ",
  sourceId: "az-legislature",
  versionId: "test:az-state-legislators",
  value: {
    formatVersion: 1,
    sourceId: "az-legislature",
    jurisdiction: "US-AZ",
    term: "2025-2026",
    generatedAt: "2026-09-25T12:00:00.000Z",
    roster: {
      scope: "AZ",
      generatedAt: "2026-09-25T12:00:00.000Z",
      officeholders: ld20.map(({ officeholder }) => officeholder),
      divisions: ld20.map(({ division }) => division),
      unmatched: [],
    },
  } as OfficialStateLegislatorReadModel,
});

import { coverageAt } from "../lib/registry/server.ts";
import { rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";
import { TOPIC_ROUTES } from "../lib/routing/topics.ts";

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

test("85723: no routed step ever names a body that isn't the division's own government", async () => {
  const coverage = await coverageAt(32.18023, -110.96515, 1);

  // The division's own governments at this point — the only bodies any
  // routed step may name.
  const ownGoverning = new Set(
    coverage.bodies
      .filter(
        (b) =>
          b.ocdId !== null &&
          (b.bodyId === `${b.ocdId}#governing` || b.bodyId === `${b.ocdId}#board`),
      )
      .map((b) => b.name ?? b.divisionLabel),
  );
  // The housing authority is attached to the city and classed GOVERNING — the trap.
  assert.ok(
    coverage.bodies.some((b) => b.name?.includes("Public Housing Authority")),
    "the fixture requires the PHA present at this point — if it moved, re-pin",
  );

  const pothole = resolveRouting("roads-local", coverage);
  assert.equal(pothole.kind, "ROUTED");
  for (const step of pothole.steps) {
    for (const body of step.bodies) {
      assert.ok(
        ownGoverning.has(body.label),
        `pothole step names "${body.label}" — not the division's own government`,
      );
      assert.ok(
        !/housing authority/i.test(body.label),
        "the PHA must never answer for streets",
      );
    }
  }

  for (const route of TOPIC_ROUTES) {
    const answer = resolveRouting(route.id, coverage);
    for (const step of answer.steps) {
      for (const body of step.bodies) {
        assert.ok(
          ownGoverning.has(body.label),
          `${route.id}: step names "${body.label}" — not the division's own government`,
        );
      }
    }
  }
});

test("golden case: the stopped library, at Tucson", async () => {
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
  for (const step of answer.steps) {
    const rostered = step.bodies.some(
      (b) => rosterHoldersForBody(b.body.bodyId).length > 0,
    );
    if (rostered) {
      assert.ok(
        step.gap === null || !step.gap.includes("who sits on this body"),
        `a step naming a rostered body still claims nobody is sourced: ${JSON.stringify(step.bodies.map((b) => b.label))}`,
      );
    } else if (step.bodies.length > 0 && step.people.length === 0) {
      assert.ok(
        step.gap?.includes("who sits on this body"),
        "a step with a real body and no sourced roster must say which half is missing",
      );
    }
  }
  assert.equal(answer.grounding.stepsWithSomeone, 2);
  assert.equal(answer.grounding.totalSteps, 2);
});

test("golden case: a school being run badly, at Tucson", async () => {
  // The model sentence lives on this route: superintendent first
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

const ROCKAWAY: [number, number] = [40.9187, -74.5143];

test("ASK-9: one district names the superintendent and no board member", async () => {
  const coverage = await coverageAt(...TUCSON, 1);
  const answer = resolveRouting("schools-operations", coverage);
  const named = answer.steps.flatMap((s) => s.people.map((p) => p.name));

  // The body is still named — that half never changed.
  const bodies = answer.steps.flatMap((s) => s.bodies.map((b) => b.label));
  assert.ok(bodies.length > 0, "the answer must still name the district");

  // Whoever runs it is named, described as running it rather than governing:
  // an appointed official never carries the govern verb.
  const roster = answer.steps
    .flatMap((s) => s.bodies)
    .flatMap((b) => rosterHoldersForBody(b.body.bodyId));
  const superintendent = roster.find((h) => /superintendent/i.test(h.officeTitle ?? ""));
  assert.ok(superintendent, "the fixture has no superintendent — this guard would pass vacuously");
  assert.ok(
    named.includes(superintendent.name),
    `the superintendent ${superintendent.name} must still be named`,
  );

  // And nobody else from the roster is.
  const others = roster
    .filter((h) => !/superintendent/i.test(h.officeTitle ?? ""))
    .map((h) => h.name)
    .filter((name) => named.includes(name));
  assert.deepEqual(
    others,
    [],
    `Ask still names roster members who are not the superintendent: ${others.join(", ")}`,
  );
});

test("ASK-10: several districts name NO person from any of their rosters", async () => {
  const coverage = await coverageAt(...ROCKAWAY, 1);
  const answer = resolveRouting("schools-operations", coverage);

  const step = answer.steps.find((s) => s.bodies.length > 1);
  assert.ok(
    step,
    "no step at 07866 resolves to more than one district — this guard would pass vacuously",
  );

  const named = new Set(step.people.map((p) => p.name));
  const roster = step.bodies.flatMap((b) => rosterHoldersForBody(b.body.bodyId));
  assert.ok(roster.length > 0, "the districts hold no roster — nothing to over-include");

  const leaked = roster.map((h) => h.name).filter((name) => named.has(name));
  assert.deepEqual(
    leaked,
    [],
    "with more than one body in the step, naming ANY of their people attributes " +
      `one body's person to all of them: ${leaked.join(", ")}`,
  );

  // The bodies themselves are still all named — the fix trims people, not coverage.
  assert.ok(step.bodies.length >= 2, "the districts must still all be named");
});
