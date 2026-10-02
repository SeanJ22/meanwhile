/**
 * The certification tier selected for one GitHub Actions event.
 *
 * Draft pull requests get the deterministic preflight tier. A ready pull
 * request buys the full shipping proof only once it is about to merge: auto-merge
 * is on, or it carries the `run-full-ci` or `engineer-adapter` label. Until then
 * it waits with lint and types, and its final verdict stays red so nothing can
 * merge on that cheap run. Anything unreadable fails closed to the full proof.
 */
export type PullRequestCiTier = "draft" | "waiting" | "full";

export interface PullRequestCiEvent {
  readonly eventName?: string | null;
  readonly action?: string | null;
  readonly draft?: boolean | null;
  readonly autoMerge?: boolean | null;
  readonly labels?: readonly string[] | null;
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
  return {
    tier: "waiting",
    reason: "the pull request is ready but auto-merge is off; the full suite runs when auto-merge is turned on",
  };
}
