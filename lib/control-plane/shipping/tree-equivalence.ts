/**
 * **THE SHIPPED TREE IS THE TREE THAT ALREADY PASSED — OR THE FULL PROOF RUNS.**
 * (FCP-9C, 2026-09-07.)
 *
 * ## The run this file exists because of
 *
 * On 2026-09-07 one logical engineering change — MapTiler quota isolation —
 * bought four full hosted certifications and one cheap attestation:
 *
 * ```
 *   #804  PR Build Check   superseded / cancelled
 *   #805  PR Build Check   full green on an earlier head
 *   #806  PR Build Check   full green on be6e41ff after a late review edit
 *   #807  main Build Check FULL AGAIN, on merge commit 0251d145
 *   #808  main Build Check cheap, on the observer's own bookkeeping commit
 * ```
 *
 * Run #807 is the one this module refuses to repeat, and the reason is a fact
 * anybody can check with two `git rev-parse` calls:
 *
 * ```
 *   be6e41ff  (certified by #806)   tree dc3bee394389b13458293a46969a533a38285f22
 *   0251d145  (re-certified by #807) tree dc3bee394389b13458293a46969a533a38285f22
 * ```
 *
 * **The same tree.** Not a similar tree, not a tree whose diff looked
 * uninteresting — the identical git object. Run #807 spent a full
 * shipping-grade certification re-proving bytes that run #806 had proved
 * minutes earlier, because Git had created a merge commit with a different
 * SHA and the workflow's subject was the SHA.
 *
 * RULING 278 already says cost follows the canonical classification of *what
 * changed*. This says the same thing one level up: **a commit SHA is not the
 * subject of a correctness proof; a tree is.**
 *
 * ## Why tree equality ALONE is not enough, and what is added
 *
 * Several checks in this repository read git history, not only the working
 * tree — `tests/source-stamp.test.ts` verifies stamps against `git log`, the
 * `gates` job walks the Reader closure proof's ancestry, and `doc-dates` reads
 * committed text against a clock. A rule that said "same tree, therefore same
 * verdict" would be asserting something about those checks that nobody
 * measured.
 *
 * So the relation this module proves is stronger than tree equality, and it is
 * exactly the relation that makes the certified subject and the shipped
 * subject **the same object**:
 *
 * ```
 *   1  the pushed head is a merge commit with exactly two parents
 *   2  ANCESTRY: parent 1 (main's tip) is an ancestor of parent 2 (the branch
 *      head). Main did not move underneath the branch.
 *   3  TREE: tree(merge) === tree(branch head)
 *   4  CERTIFIED: every required context was GREEN at the branch head
 * ```
 *
 * Conditions 2 and 3 together are the load-bearing pair, and 2 is the one that
 * closes the hole 3 leaves open on its own. A pull request's checks do not run
 * on the branch head: they run on GitHub's synthetic merge commit,
 * `refs/pull/N/merge`, which is `merge(branch head, base at that moment)`. So
 * the tree that was certified is the SYNTHETIC merge's tree, and comparing the
 * shipped tree to the branch head's tree would compare it to the wrong thing
 * whenever the base moved.
 *
 * When parent 1 is an ancestor of parent 2, all three trees collapse into one:
 * merging an ancestor into its descendant contributes nothing, so
 *
 * ```
 *   tree(synthetic merge) === tree(branch head) === tree(pushed merge)
 * ```
 *
 * and the subject GitHub certified is byte-for-byte the subject now on `main`.
 * That is a machine-verifiable tree relationship, which is what FCP-9C
 * requires before any check may be reused.
 *
 * ## Every unanswerable question is FULL
 *
 * `git` could not answer, the clone is too shallow to see the ancestry, the
 * head has one parent or three, the required contexts could not be read, one
 * of them is missing, one of them is not green, the head is not a push to the
 * integration branch — every one of those returns `FULL_PROOF_REQUIRED` with
 * the reason named. RULING 24: an instrument that cannot reach its subject
 * must never print like a passing one. A wasted certification is the cheap
 * failure here and it is the only one this can produce.
 *
 * ## What it may never become
 *
 * **An attestation may never rest on an attestation.** If the branch head's
 * own green came from this path rather than from a full run, reusing it would
 * chain a proof to a proof to nothing. The structural reason it cannot is
 * recorded in `attestationCannotChain` below and asserted by the test: this
 * path exists ONLY for a push to the integration branch, and a pull request is
 * never cheap and never attested — `classifyCommitCost` answers FULL for every
 * pull request by construction. So a required context that is green on a
 * branch head was earned by a full run, always.
 *
 * PURE. `judgeTreeEquivalence` takes facts and returns a verdict; nothing here
 * runs git, reads an environment or makes a request. `scripts/certified-tree.mjs`
 * is the adapter that gathers the facts, exactly as `scripts/ci-cost.mjs` is
 * the adapter for RULING 278's predicate.
 */

export const TREE_EQUIVALENCE_FORMAT_VERSION = 1;

/**
 * The verdict. Two values, and the second is every other case — there is no
 * "probably", because a proof reused on a probability is not a proof.
 */
export const EQUIVALENCE_VERDICTS = [
  /** The shipped tree IS the certified tree. The prior certification stands. */
  "CERTIFIED_TREE_REUSED",
  /** Anything else at all. The full proof runs on this head. */
  "FULL_PROOF_REQUIRED",
] as const;
export type EquivalenceVerdict = (typeof EQUIVALENCE_VERDICTS)[number];

/**
 * Why a head did not qualify. A machine-readable code so the amplification
 * ledger can count reasons rather than parse sentences, and so a session
 * reading a receipt can tell "the relation does not hold" apart from "the
 * relation could not be evaluated".
 */
export const NON_REUSE_REASONS = [
  /** Not a push, or not to the integration branch. */
  "NOT_AN_INTEGRATION_PUSH",
  /** One parent (an ordinary commit) or more than two (an octopus merge). */
  "NOT_A_TWO_PARENT_MERGE",
  /** Main moved under the branch: parent 1 is not an ancestor of parent 2. */
  "BASE_ADVANCED_UNDER_CANDIDATE",
  /** The merge introduced bytes the branch head did not carry. */
  "TREE_DIFFERS_FROM_CANDIDATE",
  /** A required context is absent at the candidate head. */
  "CERTIFICATION_MISSING",
  /** A required context is present and is not green. */
  "CERTIFICATION_NOT_GREEN",
  /** Git, the API or the clone could not answer. Never read as equivalence. */
  "CANNOT_TELL",
] as const;
export type NonReuseReason = (typeof NON_REUSE_REASONS)[number];

/** One required context's state at the candidate head, as read from the API. */
export interface ContextReading {
  readonly context: string;
  /**
   * The conclusion GitHub reported, verbatim and lower-cased — `success`,
   * `failure`, `cancelled`, `skipped`, `neutral`… — or null when the context
   * produced no completed run at that head at all.
   */
  readonly conclusion: string | null;
}

/**
 * The facts the adapter gathers. Every optional-looking field is nullable
 * rather than absent, so "we did not look" and "we looked and there is none"
 * cannot arrive as the same value.
 */
export interface EquivalenceFacts {
  /** The GitHub event. Only `push` can qualify. */
  readonly event: string;
  /** The ref that was pushed, e.g. `refs/heads/main`. */
  readonly ref: string | null;
  /** The integration branch this repository ships through. */
  readonly integrationRef: string;
  /** The pushed commit. */
  readonly headSha: string | null;
  /** Its parents, in order. Null when git could not read them. */
  readonly parents: readonly string[] | null;
  /** `tree(head)`. Null when git could not read it. */
  readonly headTree: string | null;
  /** `tree(parent 2)` — the certified candidate. Null when unreadable. */
  readonly candidateTree: string | null;
  /**
   * Is parent 1 an ancestor of parent 2? Null when the question could not be
   * answered — a clone too shallow to hold the graph answers null, and null is
   * never read as yes.
   */
  readonly baseIsAncestorOfCandidate: boolean | null;
  /** Every context branch protection requires, by exact name. */
  readonly requiredContexts: readonly string[];
  /**
   * What each of those reported at parent 2. Null when the API could not be
   * reached — which is CANNOT_TELL, never "none were green".
   */
  readonly readings: readonly ContextReading[] | null;
}

export interface EquivalenceDecision {
  readonly formatVersion: typeof TREE_EQUIVALENCE_FORMAT_VERSION;
  readonly verdict: EquivalenceVerdict;
  /** Null exactly when the verdict is CERTIFIED_TREE_REUSED. */
  readonly reason: NonReuseReason | null;
  /** One sentence for the receipt. Always populated, both ways. */
  readonly detail: string;
  /** The already-certified commit whose proof is reused. Null otherwise. */
  readonly certifiedSha: string | null;
  /** The tree object both commits share. Null when they do not share one. */
  readonly certifiedTree: string | null;
  /** The contexts whose green is being relied on. Empty unless reused. */
  readonly reliedOn: readonly string[];
}

function refuse(
  reason: NonReuseReason,
  detail: string,
): EquivalenceDecision {
  return {
    formatVersion: TREE_EQUIVALENCE_FORMAT_VERSION,
    verdict: "FULL_PROOF_REQUIRED",
    reason,
    detail,
    certifiedSha: null,
    certifiedTree: null,
    reliedOn: [],
  };
}

/**
 * The whole judgement, and it is deliberately a straight line of refusals with
 * one way out at the bottom. Written this way so that adding a condition means
 * adding a refusal — the direction a safety predicate should be easy to edit
 * in — and so that no branch can reach the reuse without passing every one.
 */
export function judgeTreeEquivalence(facts: EquivalenceFacts): EquivalenceDecision {
  if (facts.event !== "push") {
    return refuse(
      "NOT_AN_INTEGRATION_PUSH",
      `the event is ${JSON.stringify(facts.event)}, not a push; a pull request's subject is the ` +
        "merge result and is never reused from anywhere",
    );
  }
  if (facts.ref !== facts.integrationRef) {
    return refuse(
      "NOT_AN_INTEGRATION_PUSH",
      `the push is to ${facts.ref ?? "an unreadable ref"} and reuse is defined only for ` +
        `${facts.integrationRef}`,
    );
  }
  if (facts.headSha === null || facts.parents === null) {
    return refuse(
      "CANNOT_TELL",
      "git could not report the pushed commit or its parents, so no relation between the shipped " +
        "tree and any certified tree can be established",
    );
  }
  if (facts.parents.length !== 2) {
    return refuse(
      "NOT_A_TWO_PARENT_MERGE",
      `the pushed commit has ${facts.parents.length} parent(s); reuse is defined for a merge of a ` +
        "certified candidate into the integration branch and for nothing else",
    );
  }

  const [base, candidate] = facts.parents;

  if (facts.baseIsAncestorOfCandidate === null) {
    return refuse(
      "CANNOT_TELL",
      `whether ${base.slice(0, 7)} is an ancestor of ${candidate.slice(0, 7)} could not be ` +
        "answered — a clone too shallow to hold the graph answers this way, and an unanswered " +
        "ancestry is never read as a satisfied one",
    );
  }
  if (facts.baseIsAncestorOfCandidate === false) {
    return refuse(
      "BASE_ADVANCED_UNDER_CANDIDATE",
      `${base.slice(0, 7)} is not an ancestor of ${candidate.slice(0, 7)}: the integration branch ` +
        "moved while the candidate was in review, so the tree GitHub certified on the synthetic " +
        "merge is not the tree being shipped",
    );
  }

  if (facts.headTree === null || facts.candidateTree === null) {
    return refuse(
      "CANNOT_TELL",
      "git could not read one of the two tree objects, so they cannot be compared",
    );
  }
  if (facts.headTree !== facts.candidateTree) {
    return refuse(
      "TREE_DIFFERS_FROM_CANDIDATE",
      `the merge's tree ${facts.headTree.slice(0, 12)} is not the candidate's tree ` +
        `${facts.candidateTree.slice(0, 12)}: the merge introduced bytes the certified head did ` +
        "not carry, and those bytes have never been proved",
    );
  }

  if (facts.requiredContexts.length === 0) {
    return refuse(
      "CANNOT_TELL",
      "no required contexts were supplied, so there is no certification to reuse — an empty " +
        "requirement set is a reading failure, never a satisfied one",
    );
  }
  if (facts.readings === null) {
    return refuse(
      "CANNOT_TELL",
      `the check runs at ${candidate.slice(0, 7)} could not be read, and an unread certification ` +
        "is not a green one",
    );
  }

  const byContext = new Map(facts.readings.map((r) => [r.context, r.conclusion]));
  const missing = facts.requiredContexts.filter((c) => !byContext.has(c));
  if (missing.length > 0) {
    return refuse(
      "CERTIFICATION_MISSING",
      `${missing.length} required context(s) reported nothing at ${candidate.slice(0, 7)} — ` +
        `${missing.join(", ")}. A context that never arrived did not pass`,
    );
  }
  const notGreen = facts.requiredContexts.filter((c) => byContext.get(c) !== "success");
  if (notGreen.length > 0) {
    return refuse(
      "CERTIFICATION_NOT_GREEN",
      `${notGreen.map((c) => `${c}=${byContext.get(c) ?? "null"}`).join(", ")} at ` +
        `${candidate.slice(0, 7)}`,
    );
  }

  return {
    formatVersion: TREE_EQUIVALENCE_FORMAT_VERSION,
    verdict: "CERTIFIED_TREE_REUSED",
    reason: null,
    detail:
      `this shipped tree is the tree that already passed the required certification: ` +
      `${facts.headSha.slice(0, 7)} and ${candidate.slice(0, 7)} are both tree ` +
      `${facts.headTree.slice(0, 12)}, ${base.slice(0, 7)} is an ancestor of ` +
      `${candidate.slice(0, 7)} so the synthetic merge GitHub certified carried that same tree, ` +
      `and ${facts.requiredContexts.length} required context(s) are green there`,
    certifiedSha: candidate,
    certifiedTree: facts.headTree,
    reliedOn: facts.requiredContexts,
  };
}

/**
 * **WHY AN ATTESTATION CAN NEVER REST ON ANOTHER ATTESTATION.**
 *
 * Not a comment, because a comment is not checked. This states the structural
 * argument as data so `tests/tree-equivalence.test.ts` can assert each leg
 * against the shipped classifier and the shipped workflow, and so a future
 * edit that breaks one of them breaks a test rather than a paragraph.
 */
export const attestationCannotChain = {
  claim:
    "a required context that is green at a candidate head was earned by a FULL certification, " +
    "never by this reuse path",
  legs: [
    "reuse is evaluated only for event=push to the integration ref (judgeTreeEquivalence refuses " +
      "everything else with NOT_AN_INTEGRATION_PUSH)",
    "a candidate head is a pull-request head, and classifyCommitCost answers FULL for every pull " +
      "request by construction — the adapter passes null rather than a path list",
    "so the green being relied on came from a run that installed, built and ran the suite",
  ],
} as const;
