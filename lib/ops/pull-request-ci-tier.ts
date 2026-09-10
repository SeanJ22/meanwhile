/**
 * The certification tier selected for one GitHub Actions event.
 *
 * Draft pull requests get the deterministic preflight tier. Everything else
 * fails closed to the full shipping proof. In particular, `ready_for_review`
 * is full even if a malformed payload were to retain `draft: true`.
 */
export type PullRequestCiTier = "draft" | "full";

export interface PullRequestCiEvent {
  readonly eventName?: string | null;
  readonly action?: string | null;
  readonly draft?: boolean | null;
}

export interface PullRequestCiDecision {
  readonly tier: PullRequestCiTier;
  readonly reason: string;
}

const DRAFT_ACTIONS = new Set(["opened", "synchronize", "reopened"]);

export function classifyPullRequestCiTier(event: PullRequestCiEvent): PullRequestCiDecision {
  if (event.eventName !== "pull_request") {
    return { tier: "full", reason: "the event is not a pull request" };
  }

  if (event.action === "ready_for_review") {
    return { tier: "full", reason: "ready_for_review requires the full certification" };
  }

  if (event.draft === true && event.action && DRAFT_ACTIONS.has(event.action)) {
    return { tier: "draft", reason: `the pull request is draft on ${event.action}` };
  }

  return {
    tier: "full",
    reason: "the pull-request state was ready, missing, or not a supported draft event",
  };
}
