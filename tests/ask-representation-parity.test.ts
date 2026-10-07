import assert from "node:assert/strict";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";

const TUCSON: [number, number] = [32.21696, -110.971];

test("ASK-5: every body a routed step names carries the roster the battlecard renders", async () => {
  const coverage = await coverageAt(...TUCSON, 1);

  // The school-operations route's own step targets the school district's governing board.
  const answer = resolveRouting("schools-operations", coverage);
  assert.equal(answer.kind, "ROUTED");

  const school = coverage.bodies.find(
    (b) =>
      b.divisionType === "school_district" &&
      b.ocdId !== null &&
      (b.bodyId === `${b.ocdId}#board` || b.bodyId === `${b.ocdId}#governing`),
  );
  assert.ok(
    school,
    "the fixture requires a school district's own board at this point — if the registry moved, re-pin",
  );

  // What the BATTLECARD renders for that body, from the store it reads.
  const roster = rosterHoldersForBody(school.bodyId);
  assert.ok(
    roster.length > 0,
    `the fixture requires a sourced roster for ${school.bodyId} — this test cannot prove parity against an empty store`,
  );

  // What ASK now names.
  const named = new Set(
    answer.steps.flatMap((s) => s.people.map((p) => p.id)),
  );

  const bodyIds = new Set(answer.steps.flatMap((s) => s.bodies.map((b) => b.body.bodyId)));
  assert.ok(
    bodyIds.has(school.bodyId),
    `Ask does not name ${school.bodyId}, whose roster the battlecard renders`,
  );

  const executive = roster.find((m) => /superintendent/i.test(m.officeTitle ?? ""));
  assert.ok(
    executive,
    "the fixture requires a superintendent — the one roster member Ask still names",
  );
  assert.ok(
    named.has(executive.id),
    `Ask does not name ${executive.name}, who runs ${school.bodyId} day to day`,
  );

  const alsoNamed = roster.filter((m) => m.id !== executive.id && named.has(m.id));
  assert.deepEqual(
    alsoNamed.map((m) => m.name),
    [],
    `Ask names roster members who do not run the body: ${alsoNamed.map((m) => m.name).join(", ")}`,
  );
});

test("ASK-5: no step claims the roster is unsourced while a roster exists for its body", async () => {
  const coverage = await coverageAt(...TUCSON, 1);

  // Every topic, not only the one photographed — a named instance is an
  // example of the class.
  const topics = [
    "schools-operations",
    "schools-policy",
    "libraries",
    "zoning-development",
    "roads-local",
    "trash-recycling",
    "water-sewer",
    "parks",
    "property-taxes",
  ];

  let stepsChecked = 0;
  for (const topic of topics) {
    const answer = resolveRouting(topic, coverage);
    if (answer.kind !== "ROUTED") continue;
    for (const step of answer.steps) {
      stepsChecked += 1;
      if (step.gap !== "We haven't sourced who sits on this body yet.") continue;
      // The gap fired. It is only honest if NO body on this step has a roster.
      for (const label of step.bodies.map((b) => b.label)) {
        const body = coverage.bodies.find(
          (b) => (b.name ?? b.divisionLabel) === label,
        );
        if (!body) continue;
        assert.equal(
          rosterHoldersForBody(body.bodyId).length,
          0,
          `${topic}: Ask says the roster is unsourced for "${label}" while ${body.bodyId} holds one`,
        );
      }
    }
  }

  // A sweep that examined nothing is a sweep reporting green without looking.
  assert.ok(stepsChecked > 5, `only ${stepsChecked} routed steps were examined`);
});
