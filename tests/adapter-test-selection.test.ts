import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { discoverTests } from "../scripts/ci-tests.mjs";
import { adapterTestSelection } from "../lib/ops/adapter-test-selection.ts";

test("a Legistar-only change selects its fixture tests and the composite contract under five percent", () => {
  const tests = discoverTests(process.cwd());
  const plan = adapterTestSelection({ changed: ["lib/sources/legistar/index.ts"], tests, readText: path => readFileSync(path, "utf8") });
  assert.ok(plan);
  assert.ok(plan.files.includes("tests/legistar.test.ts"));
  assert.ok(plan.files.includes("tests/composite.test.ts"));
  assert.ok(plan.files.length / tests.length < 0.05);
});

test("cross-kind, shared, unknown and untested changes keep the normal planner", () => {
  const tests = ["tests/ical-source.test.ts", "tests/composite.test.ts"];
  const readText = () => 'import "../lib/sources/ical/index.ts"';
  for (const changed of [["lib/sources/ical/index.ts", "lib/sources/legistar/index.ts"], ["lib/sources/composite/index.ts"], ["lib/sources/ical/index.ts", "lib/types.ts"], ["lib/sources/new-kind/index.ts"]]) {
    assert.equal(adapterTestSelection({ changed, tests, readText }), null);
  }
});
