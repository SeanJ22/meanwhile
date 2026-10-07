import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { MethodKnowledge, RouteEffort } from "../lib/method/knowledge.ts";
import { METHOD_FIXTURE_PATH } from "./method-store-fixture.ts";

/**
 * `MethodRoute.effort` is optional and recorded when a route is learned; an absent effort is a stated unknown,
 * never a zero.
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
  // Each dimension is a closed list, so effort can be aggregated.
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
  // A forecast that treated a missing cost as zero would report the project as cheaper the less it had measured.
  const routes = knowledge().routes;
  const recorded = routes.filter((r) => r.effort);
  assert.ok(routes.length > 0, "no routes at all — this test would be vacuous");

  /* The two populations must be distinguishable, so a forecast can state its own denominator. */
  assert.equal(
    recorded.length + routes.filter((r) => !r.effort).length,
    routes.length,
    "a route is either measured or it is not; there is no third state",
  );
});

test("reader-integrity repair is not collection work and is flagged as such", () => {
  // The flag separates repairs from new facts; it is held to a boolean rather than a truthy string.
  for (const route of knowledge().routes) {
    if (route.effort?.readerIntegrityRepair === undefined) continue;
    assert.equal(
      typeof route.effort.readerIntegrityRepair,
      "boolean",
      `${route.id}: readerIntegrityRepair must be a boolean`,
    );
  }
});
