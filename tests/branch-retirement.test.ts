/**
 * **THE SQUASH-MERGE TRAP** — the shape that makes `git branch --merged` unsafe
 * to reason from, proved against planted facts.
 *
 * This repository squash-merges, so a branch can be entirely shipped while none
 * of its commits is an ancestor of `main`. Measured on the real remote at the
 * audit anchor: all twelve `ws/*` refs of PR #215 are non-ancestors of `main`
 * and all twelve are fully represented in it. An instrument reading ancestry
 * alone reports every one of them as unmerged.
 *
 * The facts are PLANTED rather than read from git, and that is the point of the
 * classifier being a pure function (RULING 130). A live remote holds whichever
 * shapes it happens to hold on the day; the shapes that decide whether a
 * deletion is safe — a squash-merged branch, a branch that gained commits AFTER
 * its merge, a genuinely unique delta — must be reachable by a test rather than
 * by luck.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  classifyBranch,
  countDispositions,
  driftAgainstRemote,
  namespaceOf,
  preservationProofs,
  relationToMain,
  type BranchFacts,
  type PullRequestLink,
  type RetirementPolicy,
} from "../lib/ops/branch-retirement.ts";

const TIP = "aaaaaaaabbbbbbbbccccccccdddddddd11111111";
const OTHER_TIP = "9999999988888888777777776666666655555555";
const MERGE_SHA = "ffffffffeeeeeeeeddddddddcccccccc22222222";
const INTEGRATION_HEAD = "c01f4a61adfa838e1fb6e335a119f6331ccb9327";

/** No repository law permits automatic owner-branch retirement. */
const POLICY: RetirementPolicy = {
  activeRefs: ["ws/branchhy"],
  ownerNamespaces: ["sean"],
  ownerRetirementPolicy: null,
};

const mergedPr = (over: Partial<PullRequestLink> = {}): PullRequestLink => ({
  number: 215,
  state: "MERGED",
  mergedAt: "2026-08-29T01:03:46Z",
  mergeSha: MERGE_SHA,
  mergedHeadOid: TIP,
  mergeShaInMain: true,
  title: "Ten workstreams run as a team",
  ...over,
});

const facts = (over: Partial<BranchFacts> = {}): BranchFacts => ({
  ref: "claude/some-session-0820",
  tipSha: TIP,
  lastCommitAt: "2026-08-20T12:00:00-07:00",
  aheadOfMain: 3,
  behindMain: 120,
  mergeIsNoop: false,
  mergeHadConflicts: false,
  cherryUnique: 3,
  uniquePaths: [],
  pullRequests: [],
  integrationAncestry: [],
  ...over,
});

describe("branch retirement — a squash-merged branch is not an ancestor and is still shipped", () => {
  it("SAFE_DELETE: non-ancestor tip, but merging it into main changes nothing", () => {
    const row = classifyBranch(
      facts({ aheadOfMain: 40, mergeIsNoop: true, pullRequests: [mergedPr()] }),
      POLICY,
    );

    // The trap: ancestry says unmerged, content says shipped.
    assert.equal(row.relationToMain, "HAS_UNIQUE_COMMITS");
    assert.equal(row.disposition, "SAFE_DELETE");
    assert.equal(row.contentRepresentedInMain.value, true);
    assert.ok(row.contentRepresentedInMain.provenBy.includes("MERGE_IS_NOOP"));
    assert.equal(row.uniqueContentNotProvenPreserved.value, false);
    assert.match(row.evidence, /merge-tree/);
  });

  it("SAFE_DELETE: the exact tip was the head a merged PR carried into main", () => {
    // Main has moved on, so the trial merge conflicts and proves nothing. The
    // PR record still proves the branch's whole content reached main.
    const row = classifyBranch(
      facts({ aheadOfMain: 14, mergeHadConflicts: true, pullRequests: [mergedPr({ number: 174 })] }),
      POLICY,
    );
    assert.equal(row.disposition, "SAFE_DELETE");
    assert.deepEqual(row.contentRepresentedInMain.provenBy, ["PR_SQUASH_MERGE_TIP"]);
    assert.match(row.evidence, /PR #174 merged this exact tip/);
  });

  it("SAFE_DELETE: a fan-in ref reaches main through another branch's pull request", () => {
    // The ws/* shape — no PR of its own, not an ancestor of main, and entirely
    // accounted for by the integration branch that PR #215 merged.
    const row = classifyBranch(
      facts({
        ref: "ws/mtg13union",
        aheadOfMain: 33,
        mergeHadConflicts: true,
        integrationAncestry: [
          {
            prNumber: 215,
            prHeadRef: "claude/finish-aug28-integration",
            prHeadOid: INTEGRATION_HEAD,
            mergeSha: MERGE_SHA,
            title: "Ten workstreams run as a team",
          },
        ],
      }),
      POLICY,
    );
    assert.equal(row.disposition, "SAFE_DELETE");
    assert.deepEqual(row.contentRepresentedInMain.provenBy, ["INTEGRATION_ANCESTRY"]);
    assert.equal(row.pullRequests.length, 0);
    assert.match(row.evidence, /ancestor of claude\/finish-aug28-integration/);
  });

  it("REVIEW_REQUIRED: a genuine unique diff nothing proves shipped", () => {
    const row = classifyBranch(
      facts({
        ref: "claude/g17-aud03-measure",
        aheadOfMain: 1,
        cherryUnique: 1,
        uniquePaths: ["components/map/map-entry.tsx"],
      }),
      POLICY,
    );
    assert.equal(row.disposition, "REVIEW_REQUIRED");
    assert.equal(row.contentRepresentedInMain.value, false);
    assert.deepEqual(row.contentRepresentedInMain.provenBy, []);
    assert.equal(row.uniqueContentNotProvenPreserved.value, true);
    assert.match(row.uniqueContentNotProvenPreserved.what, /components\/map\/map-entry\.tsx/);
    assert.match(row.evidence, /No pull request ever named this branch/);
    assert.match(row.evidence, /will not guess/);
  });

  it("REVIEW_REQUIRED: merged once, then given commits nobody reviewed", () => {
    /*
     * The failure a bare "has a merged PR" check would cause. The PR merged
     * OTHER_TIP; the branch now points somewhere else, and those commits never
     * shipped. Deleting it here would lose them while reporting success.
     */
    const row = classifyBranch(
      facts({
        tipSha: TIP,
        aheadOfMain: 2,
        pullRequests: [mergedPr({ number: 41, mergedHeadOid: OTHER_TIP })],
        uniquePaths: ["lib/db/queries.ts", "tests/queries.test.ts"],
      }),
      POLICY,
    );
    assert.equal(row.disposition, "REVIEW_REQUIRED");
    assert.equal(row.prState, "MERGED");
    assert.match(row.evidence, /none merged this exact tip/);
  });

  it("OWNER_BRANCH: sean/* is not this tool's to retire, even when the proofs fire", () => {
    const row = classifyBranch(
      facts({ ref: "sean/captures-0826", aheadOfMain: 1, mergeIsNoop: true, pullRequests: [mergedPr({ number: 199 })] }),
      POLICY,
    );
    assert.equal(row.disposition, "OWNER_BRANCH");
    // The proofs are still recorded — the author decides WITH the facts.
    assert.equal(row.contentRepresentedInMain.value, true);
    assert.match(row.evidence, /no policy in this repository permits retiring an owner branch/);
    assert.match(row.evidence, /that call is the author's/);
  });

  it("OWNER_BRANCH survives an unproven owner branch too", () => {
    const row = classifyBranch(facts({ ref: "sean/scratch", uniquePaths: ["docs/notes.md"] }), POLICY);
    assert.equal(row.disposition, "OWNER_BRANCH");
    assert.equal(row.contentRepresentedInMain.value, false);
    assert.match(row.evidence, /NOT proven present in main/);
  });

  it("an adopted owner-retirement policy lets an owner branch be classified on its evidence", () => {
    const withPolicy: RetirementPolicy = { ...POLICY, ownerRetirementPolicy: "RULING 999" };
    const proven = classifyBranch(facts({ ref: "sean/captures-0826", mergeIsNoop: true }), withPolicy);
    assert.equal(proven.disposition, "SAFE_DELETE");
    const unproven = classifyBranch(facts({ ref: "sean/scratch", uniquePaths: ["a.ts"] }), withPolicy);
    assert.equal(unproven.disposition, "REVIEW_REQUIRED");
  });

  it("KEEP_ACTIVE: a live session branch is never a deletion candidate", () => {
    const row = classifyBranch(facts({ ref: "ws/branchhy", aheadOfMain: 1, uniquePaths: ["scripts/x.mts"] }), POLICY);
    assert.equal(row.disposition, "KEEP_ACTIVE");
    assert.match(row.evidence, /live work of the session/);
  });

  it("KEEP_ACTIVE wins over a firing proof, so a re-run after the merge is what reclassifies it", () => {
    const row = classifyBranch(facts({ ref: "ws/branchhy", mergeIsNoop: true }), POLICY);
    assert.equal(row.disposition, "KEEP_ACTIVE");
    assert.equal(row.contentRepresentedInMain.value, true);
  });
});

describe("branch retirement — the underlying readings", () => {
  it("ancestry is reported by commit counts, never by content", () => {
    assert.equal(relationToMain(facts({ aheadOfMain: 0, behindMain: 0 })), "ANCESTOR_OF_MAIN");
    assert.equal(relationToMain(facts({ aheadOfMain: 0, behindMain: 40 })), "BEHIND_ONLY");
    assert.equal(relationToMain(facts({ aheadOfMain: 1, behindMain: 40 })), "HAS_UNIQUE_COMMITS");
  });

  it("every proof that fires is collected, not just the first", () => {
    const both = preservationProofs(
      facts({ aheadOfMain: 0, mergeIsNoop: true, pullRequests: [mergedPr()] }),
    );
    assert.deepEqual(both, ["ANCESTRY", "MERGE_IS_NOOP", "PR_SQUASH_MERGE_TIP"]);
  });

  it("a merged PR whose merge commit is NOT in main proves nothing", () => {
    // A merge into some other branch, or a merge commit later dropped from main.
    const proofs = preservationProofs(facts({ pullRequests: [mergedPr({ mergeShaInMain: false })] }));
    assert.deepEqual(proofs, []);
  });

  it("an integration link with no merge commit proves nothing", () => {
    const proofs = preservationProofs(
      facts({
        integrationAncestry: [
          { prNumber: 7, prHeadRef: "claude/x", prHeadOid: INTEGRATION_HEAD, mergeSha: null, title: "x" },
        ],
      }),
    );
    assert.deepEqual(proofs, []);
  });

  it("a namespace needs a slash", () => {
    assert.equal(namespaceOf("sean/captures-0826"), "sean");
    assert.equal(namespaceOf("ws/mtg13"), "ws");
    assert.equal(namespaceOf("main"), null);
    assert.equal(namespaceOf("/leading"), null);
  });

  it("the dispositions are counted, and they sum to the row count", () => {
    const rows = [
      classifyBranch(facts({ ref: "a/one", mergeIsNoop: true }), POLICY),
      classifyBranch(facts({ ref: "sean/two" }), POLICY),
      classifyBranch(facts({ ref: "ws/branchhy" }), POLICY),
      classifyBranch(facts({ ref: "b/four", uniquePaths: ["x"] }), POLICY),
    ];
    const counts = countDispositions(rows);
    assert.deepEqual(counts, { SAFE_DELETE: 1, OWNER_BRANCH: 1, KEEP_ACTIVE: 1, REVIEW_REQUIRED: 1 });
    assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), rows.length);
  });
});

describe("branch retirement — a manifest is a photograph, and --verify says when it aged", () => {
  const recorded = [
    { ref: "claude/old", tipSha: TIP },
    { ref: "ws/gone", tipSha: OTHER_TIP },
  ];

  it("no drift when the remote still matches", () => {
    const drift = driftAgainstRemote(recorded, recorded);
    assert.deepEqual(drift, { added: [], removed: [], movedTip: [] });
  });

  it("a moved tip is named, because it may be exactly the unreviewed commits", () => {
    const drift = driftAgainstRemote(recorded, [
      { ref: "claude/old", tipSha: MERGE_SHA },
      { ref: "ws/gone", tipSha: OTHER_TIP },
      { ref: "ws/new", tipSha: INTEGRATION_HEAD },
    ]);
    assert.deepEqual(drift.added, ["ws/new"]);
    assert.deepEqual(drift.removed, []);
    assert.deepEqual(drift.movedTip, [{ ref: "claude/old", was: TIP, now: MERGE_SHA }]);
  });

  it("a ref deleted between runs is reported rather than silently dropped", () => {
    const drift = driftAgainstRemote(recorded, [{ ref: "claude/old", tipSha: TIP }]);
    assert.deepEqual(drift.removed, ["ws/gone"]);
    assert.deepEqual(drift.added, []);
  });
});
