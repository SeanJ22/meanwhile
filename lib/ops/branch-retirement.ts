/**
 * **WHICH REMOTE BRANCHES ARE SAFE TO DELETE, AND WHICH ONES IS NOBODY SURE
 * ABOUT?** — the classifier behind `pnpm branches:retire`.
 *
 * At the audit anchor the remote carried 138 heads: `main`, one integration
 * branch, twelve `ws/*` refs that fed PR #215, a long historical population of
 * `claude/*` session branches, and one `sean/*` owner branch. Deleting the
 * disposable ones is ordinary hygiene. Deleting one that still holds work
 * nobody kept is unrecoverable, and this repository's whole posture — RULING
 * 100, RULING 170, RULING 184 — is that a confident wrong answer costs more
 * than an admitted gap.
 *
 * So this module answers a narrower question than "is it merged". It answers
 * **"can I PROVE this branch's content survives in `main`?"**, and when it
 * cannot, it says so and the branch lives.
 *
 * ## `git branch --merged` is the wrong instrument here, and it is wrong in the
 * dangerous direction
 *
 * This repository SQUASH-MERGES. GitHub takes a branch's whole diff, writes it
 * as ONE new commit on `main`, and the branch's own commits are never made
 * ancestors of anything. So `git branch --merged main` reports a fully-shipped
 * branch as UNMERGED.
 *
 * That failure is survivable — it over-reports work as live. The reverse would
 * not be. But it is also useless at this scale: measured at the anchor, all
 * twelve `ws/*` refs of PR #215 are NOT ancestors of `main`, while every one of
 * them is fully represented in it. An instrument that answers "unmerged" for
 * 137 refs has not narrowed anything, and a session that then eyeballs the list
 * is guessing.
 *
 * ## Four independent proofs, any one of which is sufficient
 *
 * Each is a fact a human can re-run, and the manifest records WHICH ONE fired
 * rather than a bare boolean:
 *
 * - `ANCESTRY` — the tip is reachable from `main`. The trivial case, and the
 *   only one `--merged` catches.
 * - `MERGE_IS_NOOP` — `git merge-tree --write-tree main <ref>` yields exactly
 *   `main`'s tree. Merging the branch would change nothing, so it holds nothing
 *   `main` lacks. **This is the instrument that sees through a squash merge**,
 *   because it compares CONTENT and never ancestry.
 * - `PR_SQUASH_MERGE_TIP` — the branch's exact tip commit is the head GitHub
 *   merged (`headRefOid`), and that PR's merge commit is in `main`'s history.
 *   The branch contributed its entire content through that PR. `main` has since
 *   moved on — that is supersession, which is preservation, not loss, and the
 *   pre-supersession state stays readable at the merge commit.
 * - `INTEGRATION_ANCESTRY` — the tip is an ancestor of some OTHER branch's tip
 *   that a merged PR carried into `main`. This is the fan-in shape: ten
 *   workstreams land on one integration branch, one PR merges it. The `ws/*`
 *   refs are invisible to every other proof and completely accounted for by
 *   this one.
 *
 * ## What the tip-vs-merged-head check is really for
 *
 * `PR_SQUASH_MERGE_TIP` deliberately compares the tip to `headRefOid` rather
 * than just asking "did this branch have a merged PR". A branch can be merged
 * and then RECEIVE MORE COMMITS. Those commits were never reviewed and never
 * shipped, and a check that stopped at "has a merged PR" would delete them
 * while reporting success. When the tip has moved past the merged head, this
 * proof does not fire, and the branch falls through to `REVIEW_REQUIRED`.
 *
 * ## Ambiguity is an outcome, not a problem to be resolved
 *
 * `REVIEW_REQUIRED` is the default, not the exception path. No proof fires
 * means no deletion, and the manifest records what the unique content actually
 * IS so the reader can act without re-deriving it. Being unsure is a legitimate
 * verdict; guessing toward deletion is not.
 *
 * ## Owner branches are not this tool's to retire
 *
 * A `sean/*` branch is the author's working space, and no policy in this
 * repository authorises automatically retiring one. Absent that policy,
 * `OWNER_BRANCH` is the answer **even when the content proofs all fire** — the
 * proofs are still recorded so the author can decide with the facts in hand,
 * but the decision stays the author's. `ownerRetirementPolicy` exists so that
 * if such a policy is ever adopted, the citation lands here rather than the
 * rule being quietly relaxed.
 *
 * The classifier is pure and git-free so the four dispositions can be tested
 * against planted facts (RULING 130): the shapes that matter — a squash-merged
 * branch with a non-ancestor tip, a genuinely unique delta — are rare in a real
 * remote and must not be reachable only through a live `gh` call.
 */

/** The one thing a branch may be. Exactly one is assigned. */
export type Disposition =
  /** Content proven present in `main`. Safe for a human to delete. */
  | "SAFE_DELETE"
  /** A live branch of the session doing the classifying. Never a candidate. */
  | "KEEP_ACTIVE"
  /** No proof fired. The branch stays until a human looks. */
  | "REVIEW_REQUIRED"
  /** The author's namespace. Not this tool's to retire. */
  | "OWNER_BRANCH";

/** How the branch's commits sit relative to `main`. Descriptive, never a verdict. */
export type RelationToMain =
  /** The tip IS `main`'s tip. Nothing on either side. */
  | "ANCESTOR_OF_MAIN"
  /** Reachable from `main`, and `main` has moved on. Still ancestry. */
  | "BEHIND_ONLY"
  /** Commits exist here that `main` cannot reach. Says NOTHING about content. */
  | "HAS_UNIQUE_COMMITS";

/** The four sufficient proofs. Recorded by name so a reader can re-run one. */
export type PreservationProof =
  | "ANCESTRY"
  | "MERGE_IS_NOOP"
  | "PR_SQUASH_MERGE_TIP"
  | "INTEGRATION_ANCESTRY";

/** A pull request that named this branch as its head. */
export interface PullRequestLink {
  number: number;
  state: string;
  mergedAt: string | null;
  /** The merge commit GitHub wrote onto `main`. */
  mergeSha: string | null;
  /** The head commit GitHub actually merged. */
  mergedHeadOid: string | null;
  /** Is `mergeSha` reachable from `main` right now? */
  mergeShaInMain: boolean;
  title: string;
}

/**
 * A merged PR whose head this branch is an ancestor of — the fan-in edge.
 *
 * `prHeadOid` is the integration branch's tip, NOT this branch's, and that is
 * the point: this ref reached `main` through someone else's pull request.
 */
export interface IntegrationLink {
  prNumber: number;
  prHeadRef: string;
  prHeadOid: string;
  mergeSha: string | null;
  title: string;
}

/**
 * Everything the classifier is allowed to know. Gathered by the script; no git
 * call happens below this line.
 */
export interface BranchFacts {
  ref: string;
  tipSha: string;
  /** Committer date of the tip, ISO 8601. */
  lastCommitAt: string;
  /** Commits on this ref that `main` cannot reach. */
  aheadOfMain: number;
  /** Commits on `main` that this ref cannot reach. */
  behindMain: number;
  /** `git merge-tree --write-tree main <ref>` produced exactly `main`'s tree. */
  mergeIsNoop: boolean;
  /** The trial merge conflicted. Never a proof, and never on its own a defect. */
  mergeHadConflicts: boolean;
  /** `git cherry main <ref>` '+' lines — commits with no patch-equivalent upstream. */
  cherryUnique: number;
  /** Paths this branch's own patch touches, for the REVIEW_REQUIRED reason line. */
  uniquePaths: readonly string[];
  pullRequests: readonly PullRequestLink[];
  integrationAncestry: readonly IntegrationLink[];
}

/** The standing rules the classification is made under. */
export interface RetirementPolicy {
  /** Refs the running session owns. Live work, never a deletion candidate. */
  activeRefs: readonly string[];
  /** Leading path segments that mark a human's own branch, e.g. `sean`. */
  ownerNamespaces: readonly string[];
  /**
   * A citation to repository law permitting automatic owner-branch retirement.
   * `null` means no such law was found, and `OWNER_BRANCH` is therefore final.
   */
  ownerRetirementPolicy: string | null;
}

export interface ContentFinding {
  value: boolean;
  provenBy: PreservationProof[];
  how: string;
}

export interface UniqueFinding {
  value: boolean;
  what: string;
}

/** One manifest row. Everything a human needs to check the verdict. */
export interface BranchClassification {
  ref: string;
  tipSha: string;
  lastCommitAt: string;
  pullRequests: number[];
  prState: string | null;
  mergeSha: string | null;
  relationToMain: RelationToMain;
  contentRepresentedInMain: ContentFinding;
  uniqueContentNotProvenPreserved: UniqueFinding;
  disposition: Disposition;
  evidence: string;
}

const short = (sha: string): string => sha.slice(0, 7);

/** `sean/captures-0826` is in namespace `sean`. A ref with no `/` has none. */
export function namespaceOf(ref: string): string | null {
  const cut = ref.indexOf("/");
  return cut > 0 ? ref.slice(0, cut) : null;
}

export function relationToMain(facts: BranchFacts): RelationToMain {
  if (facts.aheadOfMain > 0) return "HAS_UNIQUE_COMMITS";
  return facts.behindMain === 0 ? "ANCESTOR_OF_MAIN" : "BEHIND_ONLY";
}

/**
 * Collect every proof that fires, not the first one.
 *
 * Two independent proofs on one branch is worth recording — it is the
 * difference between a verdict resting on a single instrument and one that
 * two unrelated instruments agree on.
 */
export function preservationProofs(facts: BranchFacts): PreservationProof[] {
  const proofs: PreservationProof[] = [];

  if (facts.aheadOfMain === 0) proofs.push("ANCESTRY");
  if (facts.mergeIsNoop) proofs.push("MERGE_IS_NOOP");

  const shipped = facts.pullRequests.find(
    (pr) =>
      pr.state === "MERGED" &&
      pr.mergeShaInMain &&
      pr.mergedHeadOid !== null &&
      pr.mergedHeadOid === facts.tipSha,
  );
  if (shipped) proofs.push("PR_SQUASH_MERGE_TIP");

  if (facts.integrationAncestry.some((link) => link.mergeSha !== null)) {
    proofs.push("INTEGRATION_ANCESTRY");
  }
  return proofs;
}

/** The prose behind each proof, naming the SHAs so the reader can re-run it. */
function proofSentence(proof: PreservationProof, facts: BranchFacts): string {
  switch (proof) {
    case "ANCESTRY":
      return `every commit on this ref is reachable from main (${facts.aheadOfMain} ahead)`;
    case "MERGE_IS_NOOP":
      return "`git merge-tree --write-tree main " + facts.ref + "` yields main's own tree — merging it would change nothing";
    case "PR_SQUASH_MERGE_TIP": {
      const pr = facts.pullRequests.find(
        (p) => p.state === "MERGED" && p.mergeShaInMain && p.mergedHeadOid === facts.tipSha,
      )!;
      return (
        `PR #${pr.number} merged this exact tip (${short(facts.tipSha)}) into main as ` +
        `${pr.mergeSha ? short(pr.mergeSha) : "?"}; main has evolved since, which supersedes rather than loses it`
      );
    }
    case "INTEGRATION_ANCESTRY": {
      const link = facts.integrationAncestry.find((l) => l.mergeSha !== null)!;
      return (
        `tip ${short(facts.tipSha)} is an ancestor of ${link.prHeadRef} @ ${short(link.prHeadOid)}, ` +
        `which PR #${link.prNumber} merged into main as ${short(link.mergeSha!)}`
      );
    }
  }
}

/** What is actually unique here, in words that let a reader go look at it. */
function uniqueDescription(facts: BranchFacts): string {
  const paths = facts.uniquePaths;
  if (paths.length === 0) {
    return `${facts.aheadOfMain} commit(s) main cannot reach, but the branch's own patch touches no paths`;
  }
  const shown = paths.slice(0, 6).join(", ");
  const rest = paths.length > 6 ? `, and ${paths.length - 6} more` : "";
  return (
    `${facts.aheadOfMain} commit(s) main cannot reach (${facts.cherryUnique} with no patch-equivalent upstream), ` +
    `touching ${paths.length} path(s): ${shown}${rest}`
  );
}

export function classifyBranch(facts: BranchFacts, policy: RetirementPolicy): BranchClassification {
  const relation = relationToMain(facts);
  const proofs = preservationProofs(facts);
  const proven = proofs.length > 0;

  const merged = facts.pullRequests.find((pr) => pr.state === "MERGED") ?? facts.pullRequests[0] ?? null;

  const contentRepresentedInMain: ContentFinding = {
    value: proven,
    provenBy: proofs,
    how: proven
      ? proofs.map((p) => `${p}: ${proofSentence(p, facts)}`).join("; ")
      : "no proof fired — neither ancestry, a no-op trial merge, a pull request that merged this exact tip, nor ancestry into a merged integration head",
  };

  const uniqueContentNotProvenPreserved: UniqueFinding = {
    value: !proven,
    what: proven ? "" : uniqueDescription(facts),
  };

  /*
   * Owner namespace is tested FIRST and wins over every proof. The proofs stay
   * in the row — the author should see that the content is safe — but the
   * verdict is not this tool's to make without a policy that says it may.
   */
  const namespace = namespaceOf(facts.ref);
  if (namespace !== null && policy.ownerNamespaces.includes(namespace)) {
    if (policy.ownerRetirementPolicy === null) {
      return {
        ref: facts.ref,
        tipSha: facts.tipSha,
        lastCommitAt: facts.lastCommitAt,
        pullRequests: facts.pullRequests.map((p) => p.number),
        prState: merged?.state ?? null,
        mergeSha: merged?.mergeSha ?? null,
        relationToMain: relation,
        contentRepresentedInMain,
        uniqueContentNotProvenPreserved,
        disposition: "OWNER_BRANCH",
        evidence:
          `\`${facts.ref}\` is in the \`${namespace}/\` owner namespace and no policy in this repository ` +
          `permits retiring an owner branch automatically. ` +
          (proven
            ? `Its content IS proven present in main (${proofs.join(", ")}), so retiring it is likely safe — but that call is the author's.`
            : `Its content is NOT proven present in main: ${uniqueContentNotProvenPreserved.what}.`),
      };
    }
  }

  if (policy.activeRefs.includes(facts.ref)) {
    return {
      ref: facts.ref,
      tipSha: facts.tipSha,
      lastCommitAt: facts.lastCommitAt,
      pullRequests: facts.pullRequests.map((p) => p.number),
      prState: merged?.state ?? null,
      mergeSha: merged?.mergeSha ?? null,
      relationToMain: relation,
      contentRepresentedInMain,
      uniqueContentNotProvenPreserved,
      disposition: "KEEP_ACTIVE",
      evidence: `\`${facts.ref}\` is live work of the session that built this manifest. Re-run after the merge to reclassify it.`,
    };
  }

  if (proven) {
    return {
      ref: facts.ref,
      tipSha: facts.tipSha,
      lastCommitAt: facts.lastCommitAt,
      pullRequests: facts.pullRequests.map((p) => p.number),
      prState: merged?.state ?? null,
      mergeSha: merged?.mergeSha ?? null,
      relationToMain: relation,
      contentRepresentedInMain,
      uniqueContentNotProvenPreserved,
      disposition: "SAFE_DELETE",
      evidence:
        `Content proven present in main by ${proofs.length} independent proof(s). ` +
        proofs.map((p) => proofSentence(p, facts)).join(". ") + ".",
    };
  }

  return {
    ref: facts.ref,
    tipSha: facts.tipSha,
    lastCommitAt: facts.lastCommitAt,
    pullRequests: facts.pullRequests.map((p) => p.number),
    prState: merged?.state ?? null,
    mergeSha: merged?.mergeSha ?? null,
    relationToMain: relation,
    contentRepresentedInMain,
    uniqueContentNotProvenPreserved,
    disposition: "REVIEW_REQUIRED",
    evidence:
      `NOT PROVEN SHIPPED. ${uniqueDescription(facts)}. ` +
      (facts.pullRequests.length === 0
        ? "No pull request ever named this branch as its head"
        : `Pull request(s) ${facts.pullRequests.map((p) => `#${p.number}`).join(", ")} named it, but none merged this exact tip`) +
      `, and it is not an ancestor of any merged integration head. ` +
      `Look at \`git log main..${facts.ref}\` and decide; this tool will not guess.`,
  };
}

export interface DispositionCounts {
  SAFE_DELETE: number;
  KEEP_ACTIVE: number;
  REVIEW_REQUIRED: number;
  OWNER_BRANCH: number;
}

export function countDispositions(rows: readonly BranchClassification[]): DispositionCounts {
  const counts: DispositionCounts = {
    SAFE_DELETE: 0,
    KEEP_ACTIVE: 0,
    REVIEW_REQUIRED: 0,
    OWNER_BRANCH: 0,
  };
  for (const row of rows) counts[row.disposition] += 1;
  return counts;
}

/**
 * Drift between a recorded manifest and the remote as it stands now.
 *
 * A manifest is a photograph. `--verify` exists because acting on a stale one
 * is the failure mode that matters: a ref whose tip MOVED since classification
 * may have gained exactly the unreviewed commits the tip-match proof is there
 * to catch.
 */
export interface ManifestDrift {
  added: string[];
  removed: string[];
  movedTip: { ref: string; was: string; now: string }[];
}

export function driftAgainstRemote(
  recorded: readonly Pick<BranchClassification, "ref" | "tipSha">[],
  current: readonly { ref: string; tipSha: string }[],
): ManifestDrift {
  const was = new Map(recorded.map((r) => [r.ref, r.tipSha]));
  const now = new Map(current.map((r) => [r.ref, r.tipSha]));

  const added = [...now.keys()].filter((ref) => !was.has(ref)).sort();
  const removed = [...was.keys()].filter((ref) => !now.has(ref)).sort();
  const movedTip = [...now.entries()]
    .filter(([ref, sha]) => was.has(ref) && was.get(ref) !== sha)
    .map(([ref, sha]) => ({ ref, was: was.get(ref)!, now: sha }))
    .sort((a, b) => a.ref.localeCompare(b.ref));

  return { added, removed, movedTip };
}
