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

import {
  EQUIVALENCE_VERDICTS,
  NON_REUSE_REASONS,
  attestationCannotChain,
  judgeTreeEquivalence,
  type EquivalenceFacts,
} from "../lib/control-plane/shipping/tree-equivalence.ts";
import { REQUIRED_CONTEXTS } from "../lib/ops/required-checks.ts";
import { classifyCommitCost } from "../lib/ops/deploy-paths.ts";

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

/* ══════════════════════════════════════════════════════════════════════════
 * AN ATTESTATION MAY NEVER REST ON AN ATTESTATION
 * ═════════════════════════════════════════════════════════════════════════ */

test("a pull request is FULL by construction, so a candidate's green was earned fully", () => {
  /*
   * The adapter passes `null` for a pull request, and null is UNKNOWN -> FULL.
   * Asserted against the SHIPPED classifier, which is what makes the
   * no-chaining argument a fact rather than a paragraph in a header.
   */
  const decision = classifyCommitCost(null);
  assert.equal(decision.cost, "FULL");
  assert.equal(decision.klass, "UNKNOWN");
  assert.equal(attestationCannotChain.legs.length, 3);
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

test("the tier decision has a no-certified branch, and it reads the certified step", () => {
  const text = workflow();
  assert.match(
    text,
    /expensive=no-certified/,
    "the tier step must be able to answer no-certified, or the attestation can never take effect",
  );
  assert.match(
    text,
    /steps\.certified\.outputs\.certified.*=.*'yes'/,
    "the tier must read the certified step's own output rather than re-deriving the decision",
  );
});

test("no expensive step in either job runs on an attested head", () => {
  const text = workflow();
  /*
   * Every step that installs, downloads a browser, builds or runs the suite is
   * named here BY ITS COMMAND, read from the shipped workflow. A new expensive
   * step added without a guard fails this — which is the point: the guard is on
   * the workflow, not on a promise about it.
   */
  const expensive = [
    "corepack pnpm install --frozen-lockfile",
    "playwright install --with-deps chromium",
    "corepack pnpm test",
    "corepack pnpm lint",
    "corepack pnpm run build",
  ];
  const lines = text.split("\n");
  for (const command of expensive) {
    const hits = lines
      .map((line, i) => ({ line, i }))
      .filter(({ line }) => line.includes(command));
    assert.ok(hits.length > 0, `${command} is no longer in the workflow — has it been renamed?`);
    for (const { i } of hits) {
      /*
       * Walk back to this step's own `if:`. A step is guarded when its `if:`
       * requires `expensive == 'yes'` — which excludes no-certified, no-cheap
       * and no-preflight together — or when it explicitly excludes
       * no-certified.
       */
      let guarded = false;
      for (let j = i; j >= 0 && j > i - 25; j -= 1) {
        const line = lines[j];
        if (/^\s{6}- (name|uses):/.test(line) && j !== i) {
          // reached the start of this step without finding a guard
          break;
        }
        if (/^\s{8}if:/.test(line)) {
          guarded =
            line.includes("expensive == 'yes'") || line.includes("!= 'no-certified'");
          break;
        }
      }
      assert.equal(
        guarded,
        true,
        `line ${i + 1} runs ${command} without a guard that excludes an attested head; an ` +
          "attestation that still installs and builds has saved nothing",
      );
    }
  }
});

test("both required jobs still report on the attested path", () => {
  const text = workflow();
  for (const job of ["build", "gates"]) {
    assert.match(
      text,
      new RegExp(`certified-tree\\.mjs --attest=${job}`),
      `the ${job} job must state what it reused; a required check that does not report disarms ` +
        "branch protection rather than blocking it (RULING 156)",
    );
  }
});

test("the workflow grants checks:read, without which the attestation can never fire", () => {
  /*
   * Declaring `permissions:` at all makes every unlisted scope `none`, so
   * `contents: read` alone would 403 the check-runs endpoint. The predicate
   * would read that as CANNOT_TELL and take the full proof — safe, and
   * permanently useless, because a token that cannot see the certification
   * looks exactly like a head that did not qualify. This is the guard that
   * makes dropping it loud instead.
   */
  const text = workflow();
  const block = text.slice(text.indexOf("\npermissions:"), text.indexOf("\nconcurrency:"));
  assert.match(block, /^\s*checks:\s*read\s*$/m, "build-check.yml must grant checks: read");
  assert.equal(
    /^\s*checks:\s*write\s*$/m.test(block),
    false,
    "read is the minimum this needs; nothing here writes a check",
  );
  assert.match(
    text,
    /GH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/,
    "the certified step must be handed a token, or gh cannot authenticate at all",
  );
});

test("the certified step costs nothing on a pull request — it short-circuits before git", () => {
  /*
   * A PR is the common case and it must not pay for this. The predicate refuses
   * on the event alone, before any parent walk, deepen or API call, which the
   * adapter relies on: `scripts/certified-tree.mjs` returns at that verdict.
   */
  const decision = judgeTreeEquivalence({
    event: "pull_request",
    ref: "refs/pull/298/merge",
    integrationRef: "refs/heads/main",
    headSha: null,
    parents: null,
    headTree: null,
    candidateTree: null,
    baseIsAncestorOfCandidate: null,
    requiredContexts: REQUIRED_CONTEXTS,
    readings: null,
  });
  assert.equal(decision.reason, "NOT_AN_INTEGRATION_PUSH");
  const adapter = readFileSync(join(ROOT, "scripts", "certified-tree.mjs"), "utf8");
  assert.match(
    adapter,
    /cheapVerdict\.reason === "NOT_AN_INTEGRATION_PUSH"/,
    "the adapter must return on that verdict before it fetches or calls the API",
  );
});

test("the workflow keeps no path list of its own for this decision either", () => {
  const text = workflow();
  assert.equal(
    /paths-ignore:/.test(text),
    false,
    "a paths-ignore filter is a second truth table wearing GitHub's syntax (RULING 278)",
  );
  const certifiedBlock = text.slice(
    text.indexOf("Is this the tree that already passed?"),
    text.indexOf("Is this the tree that already passed?") + 900,
  );
  assert.match(
    certifiedBlock,
    /node scripts\/certified-tree\.mjs/,
    "the workflow calls the adapter and holds no relation of its own",
  );
});
