/**
 * `main` requires status checks by name, and GitHub matches the reported check-run name literally: a renamed
 * job or matrix leg leaves the required check never arriving, and the merge button turns green. These
 * assertions are anchored on `.github/workflows/build-check.yml`, the file that would be edited.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parse } from "yaml";

import {
  REQUIRED_CONTEXTS,
  REQUIRED_CHECKS_WORKFLOW,
  contextsProducedByWorkflow,
} from "../lib/ops/required-checks.ts";

const source = () => readFileSync(REQUIRED_CHECKS_WORKFLOW, "utf8");

test("every required context is a check the workflow actually produces", () => {
  const produced = contextsProducedByWorkflow(source());
  const missing = REQUIRED_CONTEXTS.filter((c) => !produced.includes(c));
  assert.deepEqual(
    missing,
    [],
    `Branch protection on main requires ${JSON.stringify(missing)}, and ` +
      `${REQUIRED_CHECKS_WORKFLOW} no longer produces ${missing.length === 1 ? "it" : "them"}. ` +
      `It produces ${JSON.stringify(produced)}. A required check that never ` +
      `arrives does not block a merge — it disarms protection. Either restore ` +
      `the job name, or rename it on the branch too and update REQUIRED_CONTEXTS ` +
      `in lib/ops/required-checks.ts in this same diff.`,
  );
});

test("every auxiliary context feeds the fail-closed required final status", () => {
  const parsed = parse(source());
  const produced = contextsProducedByWorkflow(source());
  const extra = produced.filter((c) => !REQUIRED_CONTEXTS.includes(c));
  assert.deepEqual(extra.sort(), [
    "admission (preflight and integrity)", "verify (lint · types · governance)",
    "test (affected)", "test (1/4)", "test (2/4)", "test (3/4)", "test (4/4)",
  ].sort(), "unrecognized auxiliary checks require an explicit aggregation contract");
  assert.deepEqual(parsed.jobs.gates.needs, ["admission", "verify", "test", "build"]);
  assert.equal(parsed.jobs.gates.if, "always() && (github.event_name != 'pull_request' || github.event.pull_request.draft == false)");
  const reducer = parsed.jobs.gates.steps.find((s: { run?: string }) => s.run === "node scripts/ci-verdict.mjs");
  assert.ok(reducer);
  assert.equal(reducer.if, undefined);
  assert.equal(reducer.env.CI_NEEDS, "${{ toJSON(needs) }}");
  assert.notEqual(reducer["continue-on-error"], true);
  for (const name of ["admission", "verify", "test", "build", "gates"]) {
    assert.notEqual(parsed.jobs[name]["continue-on-error"], true);
  }
});

/**
 * Planted renames (a tidied display name, a renamed matrix leg) against the shipped workflow text must move the
 * produced set out from under the branch protection.
 */
test("a renamed gates job is caught", () => {
  const renamed = source().replace(
    "}}gates (test · lint · tsc)",
    "}}gates (test, lint, tsc)",
  );
  assert.notEqual(renamed, source(), "the plant did not apply — the job name has moved");
  const produced = contextsProducedByWorkflow(renamed);
  assert.ok(
    !produced.includes("gates (test · lint · tsc)"),
    "renaming the gates job must drop the required context",
  );
  assert.ok(produced.includes("gates (test, lint, tsc)"), "the reader must see the new name");
});

test("a renamed matrix leg is caught", () => {
  const renamed = source().replace(/(mode:\s*\n\s*- standalone\s*\n\s*- )default/, "$1plain");
  assert.notEqual(renamed, source(), "the plant did not apply — the matrix has moved");
  const produced = contextsProducedByWorkflow(renamed);
  assert.ok(
    !produced.includes("build (default)"),
    "renaming a matrix leg must drop the required context it reported under",
  );
  assert.ok(produced.includes("build (plain)"), "the reader must expand the new leg");
});

test("an unresolvable job name is refused rather than dropped", () => {
  const opaque = source().replace(
    "build (${{ matrix.mode }})",
    "build (${{ inputs.mode }})",
  );
  assert.throws(
    () => contextsProducedByWorkflow(opaque),
    /cannot resolve/,
    "a name this reader cannot expand must throw, never silently shrink the produced set",
  );
});

test("a matrix computed at run time expands to every leg it can produce, and an unknown one is refused", () => {
  const produced = contextsProducedByWorkflow(source());
  for (const leg of ["affected", "1/4", "2/4", "3/4", "4/4"]) assert.ok(produced.includes(`test (${leg})`), leg);
  const unknown = source().replace(
    "shard: ${{ fromJSON(needs.admission.outputs.test_legs) }}",
    "shard: ${{ fromJSON(needs.admission.outputs.other_legs) }}",
  );
  assert.notEqual(unknown, source(), "the plant did not apply — the test matrix has moved");
  assert.throws(() => contextsProducedByWorkflow(unknown), /DYNAMIC_MATRIX_LEGS/);
});

test("a scheduled run reports NONE of the required contexts, so it never overwrites main's tip", () => {
  // The runtime adopts a main commit by its required contexts' latest check
  // runs (filter=latest, by name). A scheduled run on that commit must not
  // become the latest run of any required name.
  const scheduled = contextsProducedByWorkflow(source(), "schedule");
  assert.deepEqual(scheduled.filter((name) => REQUIRED_CONTEXTS.includes(name)), []);
  for (const name of REQUIRED_CONTEXTS) assert.ok(scheduled.includes(`scheduled ${name}`), name);
  for (const event of ["pull_request", "push", "workflow_dispatch"]) {
    const produced = contextsProducedByWorkflow(source(), event);
    assert.deepEqual(REQUIRED_CONTEXTS.filter((name) => !produced.includes(name)), [], event);
    assert.ok(!produced.some((name) => name.startsWith("scheduled ")), event);
  }
});
