/**
 * WHY THE PUSH WAS REFUSED, AND WHETHER RETRYING COULD EVER HELP.
 * (2026-08-26, the sources-and-incumbency session. Item 8a(c) of that brief.)
 *
 * **A retry loop that retries a deterministic refusal is not resilience. It is
 * the same error printed five times.** `job-watch` run 32989362288 spent
 * attempts two through five re-pushing into `GH013: Repository rule violations`
 * — a policy decision on the server that could not change between attempts —
 * rebasing onto `origin/main` before each one, and burned the minutes to say
 * the identical sentence four more times.
 *
 * The retry exists for exactly ONE situation, named in `scripts/push-main.mjs`
 * when it was built: two scheduled workflows landing in the same window, the
 * second one's push rejected as non-fast-forward. That is a RACE. Rebase and
 * try again and it succeeds.
 *
 * Everything else falls into two other kinds:
 *
 *   RACE       somebody else moved the branch. Rebasing changes the input, so
 *              the next attempt is a genuinely different question.
 *   POLICY     the server refused on a rule. Nothing this run can do changes
 *              the answer, and the correct response is to fail ONCE, loudly,
 *              naming the rule.
 *   UNKNOWN    a rejection this reader does not recognise. It RETRIES — that
 *              is the safe direction, because treating an unrecognised
 *              transient as permanent would turn a recoverable run red, and
 *              the cost of the other direction is four wasted seconds.
 *
 * **The classification reads git's own stderr, which is the authority.** It is
 * not derived from anything this repo wrote about branch protection, so a
 * ruleset change cannot make the classifier agree with a stale expectation
 * (RULING 147).
 */

export type RejectionKind = "RACE" | "POLICY" | "UNKNOWN";

export interface RejectionVerdict {
  readonly kind: RejectionKind;
  readonly retryable: boolean;
  /** Written to be read in a workflow log by somebody not looking for it. */
  readonly reason: string;
}

/**
 * Shapes GitHub and git use for a POLICY refusal — a decision on the server
 * that this run cannot influence.
 *
 * Shapes, not strings (RULING 110): each is the pattern the refusal takes,
 * and each is proved against a real captured rejection in
 * `tests/push-rejection.test.ts`.
 */
const POLICY_SHAPES: readonly { re: RegExp; reason: string }[] = [
  {
    re: /\bGH013\b|repository rule violations/i,
    reason:
      "the branch ruleset refused this push (GH013). That is a decision on the server: " +
      "rebasing and pushing again asks the identical question and gets the identical answer. " +
      "Check that this run is on the deploy-key path — the bypass is granted to Deploy keys, " +
      "which means SSH, and an HTTPS push authenticates as the Actions app instead.",
  },
  {
    re: /\bGH006\b|protected branch (update failed|hook declined)/i,
    reason:
      "classic branch protection refused this push (GH006). A policy decision, not a race — " +
      "the retry cannot change it.",
  },
  {
    re: /permission to .+ denied|403 forbidden|authentication failed|publickey\)/i,
    reason:
      "the push was not authenticated or not authorised. A credential problem is deterministic: " +
      "every retry presents the same credential.",
  },
  {
    re: /pre-receive hook declined|push declined due to (repository rule|email privacy)/i,
    reason: "a server-side hook refused this push. Retrying re-runs the same hook on the same commit.",
  },
];

/** Shapes that mean somebody else moved the branch while we were pushing. */
const RACE_SHAPES: readonly RegExp[] = [
  /\bnon-fast-forward\b/i,
  /\bfetch first\b/i,
  /updates were rejected because the (remote contains work|tip of your current branch is behind)/i,
  /\[rejected\][^\n]*\(fetch first\)/i,
  /cannot lock ref|failed to lock/i,
];

export function classifyRejection(stderr: string): RejectionVerdict {
  const text = stderr ?? "";

  for (const { re, reason } of POLICY_SHAPES) {
    if (re.test(text)) return { kind: "POLICY", retryable: false, reason };
  }
  for (const re of RACE_SHAPES) {
    if (re.test(text)) {
      return {
        kind: "RACE",
        retryable: true,
        reason:
          "the branch moved while this run was pushing — another scheduled workflow landed first. " +
          "This is the one case the retry exists for: rebase onto what landed and push again.",
      };
    }
  }

  return {
    kind: "UNKNOWN",
    retryable: true,
    reason:
      "this rejection is not one this reader recognises, so it is being RETRIED — an unrecognised " +
      "transient treated as permanent would turn a recoverable run red. The full text is above, and " +
      "an unrecognised failure is the one most worth a person's attention: if this repeats, add its " +
      "shape to lib/ops/push-rejection.ts.",
  };
}
