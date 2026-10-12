/**
 * The certification tier selected for one GitHub Actions event.
 *
 * Draft pull requests get the deterministic preflight tier. A ready pull
 * request buys the full shipping proof only once it is about to merge: auto-merge
 * is on, or it carries the `run-full-ci` or `engineer-adapter` label. A ready
 * pull request that changes only documents is certified at once: its proof is
 * the few tests that read those documents, with no build. Until then a ready
 * pull request waits with lint and types, and its final verdict stays red so
 * nothing can merge on that cheap run. Anything unreadable fails closed to the
 * full proof.
 */
export type PullRequestCiTier = "draft" | "waiting" | "full";

export interface PullRequestCiEvent {
  readonly eventName?: string | null;
  readonly action?: string | null;
  readonly draft?: boolean | null;
  readonly autoMerge?: boolean | null;
  readonly labels?: readonly string[] | null;
  /** Every changed file is a document (`isDocumentPath`); null when the diff could not be read. */
  readonly documentsOnly?: boolean | null;
}

export interface PullRequestCiDecision {
  readonly tier: PullRequestCiTier;
  readonly reason: string;
}

const PR_ACTIONS = new Set(["opened", "synchronize", "reopened", "ready_for_review", "labeled", "auto_merge_enabled"]);
const FULL_LABELS = new Set(["run-full-ci", "engineer-adapter"]);

export function classifyPullRequestCiTier(event: PullRequestCiEvent): PullRequestCiDecision {
  if (event.eventName !== "pull_request") {
    return { tier: "full", reason: "the event is not a pull request" };
  }
  if (!event.action || !PR_ACTIONS.has(event.action) || typeof event.draft !== "boolean") {
    return { tier: "full", reason: "the pull-request state or action was missing or unsupported" };
  }

  if (event.draft && event.action !== "ready_for_review") {
    return { tier: "draft", reason: `the pull request is draft on ${event.action}` };
  }

  const label = (event.labels ?? []).find((name) => FULL_LABELS.has(name));
  if (event.autoMerge === true) {
    return { tier: "full", reason: "auto-merge is on, so this run certifies the merge" };
  }
  if (label) {
    return { tier: "full", reason: `the ${label} label asks for the full certification` };
  }
  if (event.documentsOnly === true) {
    return { tier: "full", reason: "the change is documents only, so its certification is the tests that read them" };
  }
  return {
    tier: "waiting",
    reason: "the pull request is ready but auto-merge is off; the full suite runs when auto-merge is turned on",
  };
}
