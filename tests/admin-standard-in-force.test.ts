/**
 * **EVERY ADMIN HEADER NAMES THE READINESS STANDARD IN FORCE.** (2026-09-25.)
 *
 * Every Fleet page's strip said "STANDARD not versioned yet" because the pages
 * passed `standard: null` by hand, while the standard is versioned data
 * (MW-063, `lib/control-plane/readiness/standard.json`) and the Readiness pages
 * already named it. The page base now carries the version in force, read from
 * the manifest (no second copy of its id), and every page hands the strip that
 * — or what its own readings were measured under. "Not versioned yet" is left
 * for the one case it is true: a manifest whose `current` names no version.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { READINESS_STANDARD, standardInForce, type ReadinessStandard } from "@/lib/control-plane/readiness/standard.ts";

test("the standard in force is the manifest's current version, and is absent only when the manifest names none", () => {
  assert.equal(standardInForce(), READINESS_STANDARD.current);
  assert.notEqual(standardInForce(), null, "today's manifest names a version in force");
  const unversioned: ReadinessStandard = { ...READINESS_STANDARD, current: "readiness/no-such-version@9" };
  assert.equal(standardInForce(unversioned), null, "a current id with no version on the list is not versioned");
});
