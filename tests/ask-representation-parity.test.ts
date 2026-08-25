import assert from "node:assert/strict";
import test from "node:test";

import { coverageAt } from "../lib/registry/server.ts";
import { rosterHoldersForBody } from "../lib/registry/body-rosters.ts";
import { resolveRouting } from "../lib/routing/resolve.ts";

/**
 * **ASK-5 (2026-08-24) — ASK AND REPRESENTATION MAY NOT DISAGREE ABOUT WHO
 * SITS ON A BODY.**
 *
 * The author's two captures, side by side. `12-04-06`: Ask, asked "when does
 * school start", answering *Tucson Unified District … We haven't sourced who
 * sits on this body yet.* `12-05-31`: the same district's battlecard, listing
 * six people, five of them with photographs.
 *
 * Both surfaces were honest about their own store, and that is exactly the
 * collection-versus-rendering pair the two-numbers rule names: Ask read the
 * LEGISLATIVE seats resolved from the reader's districts, the battlecard read
 * the BODY ROSTER store. A school board lives only in the second.
 *
 * This guard is deliberately a PARITY assertion rather than a fixed expected
 * list. Pinning "six people" would go red the day somebody sources a seventh —
 * the frozen-gap failure RULING 116 names. What must hold at any coverage is
 * that the two surfaces answer the same question with the same store.
 */

const TUCSON: [number, number] = [32.21696, -110.971];

test("ASK-5: every body a routed step names carries the roster the battlecard renders", async () => {
  const coverage = await coverageAt(...TUCSON, 1);

  // The school-operations route is the one the author asked. Its own step
  // targets the school district's governing board.
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

  /*
   * **AMENDED 2026-08-25 BY ASK-9 / ASK-10, and the amendment is narrow.**
   *
   * This asserted that Ask names EVERY member of the roster the battlecard
   * renders. That was the right claim while Ask printed rosters, and the
   * author has since ruled it does not: *"Ask names bodies, not people"*, with
   * the person who RUNS the body as the one exception he asked for by name.
   * Six names under one sentence at Tucson is what he boxed in red.
   *
   * So the parity claim moves from PEOPLE to the BODY, which is where the
   * defect ASK-5 was opened over actually lived: Ask was reading
   * `coverage.seats` — the legislative store — and a school board has never
   * been in it, so Ask printed a sourced-sounding absence about a body whose
   * members were one click away. **That failure is still impossible**, and
   * these three assertions are what make it so: the body is named, its roster
   * is reachable by the same id the battlecard uses, and whoever runs it is
   * named. Nothing about the amendment weakens the store-parity claim; what it
   * drops is a claim about how many of the store's rows are PRINTED.
   */
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

  // Every topic, not only the one photographed — the author's standing frame
  // is that a named instance is an example of the class.
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
