/**
 * **THE SHIPPED TREE IS THE TREE THAT ALREADY PASSED.** (FCP-9C.)
 *
 * ## Why this file is anchored on git and on the workflow, not on the module
 *
 * A test written beside a fix encodes the same reasoning as the fix, so it
 * agrees with it about everything including the mistakes. The load-bearing
 * assertions here therefore read from OUTSIDE the module under test:
 *
 *   - the 2026-09-07 incident's REAL commits, from this repository's own git
 *     objects, so "the merge tree equals the certified tree" is a fact about
 *     the repository rather than a fixture somebody typed;
 *   - the SHIPPED `build-check.yml` text, so a later edit that drops the
 *     attestation condition from an expensive step fails here (RULING 147 — no
 *     reconciliation may compare a parser to itself);
 *   - `lib/ops/deploy-paths.ts` and `lib/ops/required-checks.ts`, the canonical
 *     tables, so the no-chaining argument is checked against the shipped
 *     classifier rather than restated.
 *
 * The fail-closed matrix is the other half: every way the relation can fail to
 * hold is shown failing, because a predicate that only ever says yes in a test
 * has not been shown to be capable of saying no.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { parse } from "yaml";

import {
  EQUIVALENCE_VERDICTS,
  NON_REUSE_REASONS,
  attestationCannotChain,
  judgeTreeEquivalence,
  type EquivalenceFacts,
} from "../lib/control-plane/shipping/tree-equivalence.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";

const ROOT = join(import.meta.dirname, "..");
const BUILD_CHECK = join(ROOT, ".github", "workflows", "build-check.yml");

/** The 2026-09-07 incident, by SHA. These are commits on `main`. */
const INCIDENT = {
  /** The merge that run #807 re-certified. */
  merge: "0251d145e2a068d3bfe90b326d10db78c6d0dfcb",
  /** `main`'s tip when it merged — parent 1. */
  base: "d95765ef47e8ce0b23603ced264deb887f2879d3",
  /** The branch head run #806 certified — parent 2. */
  candidate: "be6e41ff682a172cc15610788d5974b7120a46e1",
  /** The observer commit that caused run #808. */
  observer: "af32db55b58f1e4d24f2ce4462d12e01c0cb1e62",
};

/** git, or null when it could not answer. Never a throw inside an assertion. */
function git(...args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** Are the incident's objects present in this clone? CI runs shallow. */
const objectsPresent =
  git("cat-file", "-e", `${INCIDENT.merge}^{commit}`) !== null &&
  git("cat-file", "-e", `${INCIDENT.candidate}^{commit}`) !== null;
const shallowRepository = git("rev-parse", "--is-shallow-repository") !== "false";

const green = (contexts: readonly string[] = REQUIRED_CONTEXTS) =>
  contexts.map((context) => ({ context, conclusion: "success" }));

/** A facts object that qualifies, so each test can spoil exactly one field. */
function qualifying(over: Partial<EquivalenceFacts> = {}): EquivalenceFacts {
  return {
    event: "push",
    ref: "refs/heads/main",
    integrationRef: "refs/heads/main",
    headSha: INCIDENT.merge,
    parents: [INCIDENT.base, INCIDENT.candidate],
    headTree: "dc3bee394389b13458293a46969a533a38285f22",
    candidateTree: "dc3bee394389b13458293a46969a533a38285f22",
    baseIsAncestorOfCandidate: true,
    requiredContexts: REQUIRED_CONTEXTS,
    readings: green(),
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * THE INCIDENT, AS A FACT ABOUT THIS REPOSITORY (FCP-9F)
 * ═════════════════════════════════════════════════════════════════════════ */

test("the 2026-09-07 merge and the head run #806 certified are the SAME git tree", (t) => {
  if (!objectsPresent) {
    t.skip("the incident's objects are not in this clone (a shallow CI checkout)");
    return;
  }
  const mergeTree = git("rev-parse", `${INCIDENT.merge}^{tree}`);
  const candidateTree = git("rev-parse", `${INCIDENT.candidate}^{tree}`);

  assert.notEqual(mergeTree, null, "git could not read the merge's tree");
  assert.equal(
    mergeTree,
    candidateTree,
    "run #807 spent a full shipping-grade certification on a tree run #806 had already certified; " +
      "if these are no longer equal the incident this repair is anchored on has been rewritten",
  );
  assert.notEqual(
    INCIDENT.merge,
    INCIDENT.candidate,
    "the two SHAs must differ — the whole defect is that a different SHA carried the same tree",
  );
});

test("main's tip was an ancestor of the candidate, which is what collapses the three trees", (t) => {
  if (!objectsPresent) {
    t.skip("the incident's objects are not in this clone");
    return;
  }
  const parents = git("rev-list", "--parents", "-n", "1", INCIDENT.merge);
  assert.equal(
    parents,
    `${INCIDENT.merge} ${INCIDENT.base} ${INCIDENT.candidate}`,
    "the merge's parents are the fact the ancestry argument rests on",
  );
  let isAncestor = false;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", INCIDENT.base, INCIDENT.candidate], {
      cwd: ROOT,
    });
    isAncestor = true;
  } catch {
    isAncestor = false;
  }
  if (!isAncestor && shallowRepository) {
    t.skip("the clone is shallow and git did not find the ancestry path, so it cannot prove a negative");
    return;
  }
  assert.equal(
    isAncestor,
    true,
    "parent 1 must be an ancestor of parent 2; without it the synthetic merge GitHub certified " +
      "could have carried a different tree from the one that shipped",
  );
});

test("the real incident is judged CERTIFIED_TREE_REUSED from real git facts", (t) => {
  if (!objectsPresent) {
    t.skip("the incident's objects are not in this clone");
    return;
  }
  const decision = judgeTreeEquivalence({
    event: "push",
    ref: "refs/heads/main",
    integrationRef: "refs/heads/main",
    headSha: INCIDENT.merge,
    parents: (git("rev-list", "--parents", "-n", "1", INCIDENT.merge) ?? "").split(" ").slice(1),
    headTree: git("rev-parse", `${INCIDENT.merge}^{tree}`),
    candidateTree: git("rev-parse", `${INCIDENT.candidate}^{tree}`),
    baseIsAncestorOfCandidate: true,
    requiredContexts: REQUIRED_CONTEXTS,
    readings: green(),
  });
  assert.equal(decision.verdict, "CERTIFIED_TREE_REUSED");
  assert.equal(decision.certifiedSha, INCIDENT.candidate);
  assert.equal(decision.reliedOn.length, REQUIRED_CONTEXTS.length);
});

test("the observer commit that caused run #808 can never take the reuse path", (t) => {
  if (!objectsPresent) {
    t.skip("the incident's objects are not in this clone");
    return;
  }
  const parents = (git("rev-list", "--parents", "-n", "1", INCIDENT.observer) ?? "")
    .split(" ")
    .slice(1);
  assert.equal(parents.length, 1, "the observer's commit is an ordinary single-parent commit");
  const decision = judgeTreeEquivalence(qualifying({ headSha: INCIDENT.observer, parents }));
  assert.equal(decision.verdict, "FULL_PROOF_REQUIRED");
  assert.equal(decision.reason, "NOT_A_TWO_PARENT_MERGE");
});

/* ══════════════════════════════════════════════════════════════════════════
 * FAIL-CLOSED: EVERY WAY THE RELATION CAN FAIL TO HOLD
 * ═════════════════════════════════════════════════════════════════════════ */

const REFUSALS: ReadonlyArray<{
  what: string;
  facts: Partial<EquivalenceFacts>;
  reason: (typeof NON_REUSE_REASONS)[number];
}> = [
  {
    what: "a pull request — its subject is the merge result, never reused",
    facts: { event: "pull_request" },
    reason: "NOT_AN_INTEGRATION_PUSH",
  },
  {
    what: "a push to a branch that is not the integration ref",
    facts: { ref: "refs/heads/claude/some-branch" },
    reason: "NOT_AN_INTEGRATION_PUSH",
  },
  {
    what: "an ordinary single-parent commit",
    facts: { parents: [INCIDENT.base] },
    reason: "NOT_A_TWO_PARENT_MERGE",
  },
  {
    what: "an octopus merge",
    facts: { parents: [INCIDENT.base, INCIDENT.candidate, INCIDENT.observer] },
    reason: "NOT_A_TWO_PARENT_MERGE",
  },
  {
    what: "git could not read the parents",
    facts: { parents: null },
    reason: "CANNOT_TELL",
  },
  {
    what: "the ancestry could not be answered — a clone too shallow to hold the graph",
    facts: { baseIsAncestorOfCandidate: null },
    reason: "CANNOT_TELL",
  },
  {
    what: "main moved under the candidate while it was in review",
    facts: { baseIsAncestorOfCandidate: false },
    reason: "BASE_ADVANCED_UNDER_CANDIDATE",
  },
  {
    what: "the merge introduced bytes the certified head did not carry",
    facts: { headTree: "0000000000000000000000000000000000000000" },
    reason: "TREE_DIFFERS_FROM_CANDIDATE",
  },
  {
    what: "a tree object could not be read",
    facts: { candidateTree: null },
    reason: "CANNOT_TELL",
  },
  {
    what: "the check runs could not be read — an unread certification is not a green one",
    facts: { readings: null },
    reason: "CANNOT_TELL",
  },
  {
    what: "no required contexts were supplied — an empty requirement is a reading failure",
    facts: { requiredContexts: [] },
    reason: "CANNOT_TELL",
  },
  {
    what: "a required context reported nothing at the candidate",
    facts: { readings: green(REQUIRED_CONTEXTS.slice(1)) },
    reason: "CERTIFICATION_MISSING",
  },
  {
    what: "a required context is red",
    facts: {
      readings: [
        ...green(REQUIRED_CONTEXTS.slice(1)),
        { context: REQUIRED_CONTEXTS[0], conclusion: "failure" },
      ],
    },
    reason: "CERTIFICATION_NOT_GREEN",
  },
  {
    what: "a required context was cancelled — the #804 shape",
    facts: {
      readings: [
        ...green(REQUIRED_CONTEXTS.slice(1)),
        { context: REQUIRED_CONTEXTS[0], conclusion: "cancelled" },
      ],
    },
    reason: "CERTIFICATION_NOT_GREEN",
  },
  {
    what: "a required context was SKIPPED — which is not a pass (RULING 156)",
    facts: {
      readings: [
        ...green(REQUIRED_CONTEXTS.slice(1)),
        { context: REQUIRED_CONTEXTS[0], conclusion: "skipped" },
      ],
    },
    reason: "CERTIFICATION_NOT_GREEN",
  },
  {
    what: "a required context is still in flight (null conclusion)",
    facts: {
      readings: [
        ...green(REQUIRED_CONTEXTS.slice(1)),
        { context: REQUIRED_CONTEXTS[0], conclusion: null },
      ],
    },
    reason: "CERTIFICATION_NOT_GREEN",
  },
];

for (const row of REFUSALS) {
  test(`FULL PROOF REQUIRED — ${row.what}`, () => {
    const decision = judgeTreeEquivalence(qualifying(row.facts));
    assert.equal(
      decision.verdict,
      "FULL_PROOF_REQUIRED",
      `${row.what} must not reuse a certification: ${decision.detail}`,
    );
    assert.equal(decision.reason, row.reason);
    assert.equal(decision.certifiedSha, null, "a refusal names no certified commit");
    assert.deepEqual(decision.reliedOn, [], "a refusal relies on nothing");
  });
}

test("the qualifying facts DO qualify — the matrix above is not vacuous", () => {
  const decision = judgeTreeEquivalence(qualifying());
  assert.equal(
    decision.verdict,
    "CERTIFIED_TREE_REUSED",
    "if the baseline itself refuses, every refusal above proves nothing (RULING 159)",
  );
  assert.equal(decision.reason, null);
});

test("every declared verdict and reason is reachable from the matrix above", () => {
  const reasons = new Set(REFUSALS.map((r) => r.reason));
  for (const reason of NON_REUSE_REASONS) {
    assert.equal(reasons.has(reason), true, `${reason} is declared and never exercised`);
  }
  assert.equal(EQUIVALENCE_VERDICTS.length, 2, "there is no third, probabilistic verdict");
});

test("reuse is unreachable for any event other than a push to the integration ref", () => {
  for (const event of ["pull_request", "workflow_dispatch", "schedule", "merge_group"]) {
    const decision = judgeTreeEquivalence(qualifying({ event }));
    assert.equal(decision.verdict, "FULL_PROOF_REQUIRED", `${event} must never reuse`);
  }
});

/* ══════════════════════════════════════════════════════════════════════════
 * THE SHIPPED WORKFLOW STILL SPENDS NOTHING ON AN ATTESTED HEAD
 * ═════════════════════════════════════════════════════════════════════════ */

const workflow = () => readFileSync(BUILD_CHECK, "utf8");
