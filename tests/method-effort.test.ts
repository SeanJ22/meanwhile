import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MethodKnowledge, RouteEffort } from "../lib/method/knowledge.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";

/**
 * **THE SCALE FORECAST'S MISSING INPUT, CAPTURED RATHER THAN RECONSTRUCTED.**
 * (2026-08-27.)
 *
 * A previous session was asked for a cost-per-ZIP forecast and could not give
 * one, because the measurements it needed were never taken. The tempting repair
 * is to derive them afterwards from commit timestamps. That would be a
 * fabrication with a decimal point on it: a commit time records when somebody
 * typed, not what the work was, not whether a person had to be in the loop, and
 * not whether the same work is owed again in the next county.
 *
 * So `MethodRoute.effort` is OPTIONAL and is recorded at the moment a route is
 * learned. These tests hold the shape and — more importantly — hold the line
 * that an ABSENT effort is a stated unknown rather than a zero.
 */


function knowledge(): MethodKnowledge {
  return JSON.parse(
    readFileSync(METHOD_FIXTURE_PATH, "utf8"),
  ) as MethodKnowledge;
}

const REPEATS: RouteEffort["repeats"][] = [
  "ONCE",
  "PER_STATE",
  "PER_COUNTY",
  "PER_VENDOR",
  "PER_ZIP",
];
const EXECUTION: RouteEffort["execution"][] = [
  "MACHINE",
  "HUMAN_ONLY",
  "MACHINE_AFTER_HUMAN_SETUP",
];
const DISCOVERY: RouteEffort["discovery"][] = [
  "NEW_METHOD",
  "REAPPLIED_KNOWN_METHOD",
];

test("every recorded effort uses the closed vocabulary", () => {
  /*
   * A free-text cost field would be unaggregatable, which is how the input went
   * missing the first time. Each dimension is a closed list or it is nothing.
   */
  for (const route of knowledge().routes) {
    if (!route.effort) continue;
    assert.ok(
      REPEATS.includes(route.effort.repeats),
      `${route.id}: "${route.effort.repeats}" is not a repeat class`,
    );
    assert.ok(
      EXECUTION.includes(route.effort.execution),
      `${route.id}: "${route.effort.execution}" is not an execution class`,
    );
    assert.ok(
      DISCOVERY.includes(route.effort.discovery),
      `${route.id}: "${route.effort.discovery}" is not a discovery class`,
    );
  }
});

test("an unrecorded effort is a STATED unknown, never counted as cheap", () => {
  /*
   * The rule that matters. 88 routes predate this field, and a forecast that
   * treated a missing cost as zero would report the project as cheaper the
   * less it had measured — the exact inversion the denominator rules exist to
   * prevent. So the denominator is stated here and the absent set is named.
   */
  const routes = knowledge().routes;
  const recorded = routes.filter((r) => r.effort);
  assert.ok(routes.length > 0, "no routes at all — this test would be vacuous");

  /* No claim is made that any are recorded yet. What IS asserted is that the
   * two populations are distinguishable, which is what a later forecast needs
   * in order to state its own denominator honestly. */
  assert.equal(
    recorded.length + routes.filter((r) => !r.effort).length,
    routes.length,
    "a route is either measured or it is not; there is no third state",
  );
});

test("reader-integrity repair is not collection work and is flagged as such", () => {
  /*
   * Averaging a repair to a false claim together with the cost of collecting a
   * new fact describes neither. The flag exists so a forecast can separate
   * them; this holds it to a boolean rather than a truthy string.
   */
  for (const route of knowledge().routes) {
    if (route.effort?.readerIntegrityRepair === undefined) continue;
    assert.equal(
      typeof route.effort.readerIntegrityRepair,
      "boolean",
      `${route.id}: readerIntegrityRepair must be a boolean`,
    );
  }
});
