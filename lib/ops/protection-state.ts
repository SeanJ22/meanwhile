/**
 * IS THE PROTECTION ON `main` STILL WHAT WE THINK IT IS?
 * (2026-08-26, the unblock-pushers session. RULING 163.)
 *
 * **The answer to that question is a command, never a memory or a screenshot.**
 *
 * `main` was hardened by hand on 2026-08-25 and the settings were read back
 * once, into a ruling, as a table. A table in a document is a claim about a
 * server on the day somebody looked. Protection is edited in a web UI by a
 * person, under no diff and no review, and nothing in this repo would notice if
 * a checkbox came off — which is exactly how the 8/25 incident chain started.
 *
 * This file holds the JUDGEMENT, with no network in it, so the intended end
 * state is a thing that can be tested. `scripts/protection-verify.mjs` does the
 * I/O and hands the payloads here.
 *
 * **FOUR VERDICTS, AND `cannot-tell` IS NOT A PASS** (RULING 24, and RULING
 * 125's reason for asking the server rather than the tree). A check that could
 * not reach its subject must never print like one that did, so an unreachable
 * API exits non-zero rather than reporting healthy.
 *
 * **WHY IT UNDERSTANDS BOTH SHAPES.** Classic branch protection has no
 * per-actor bypass list — only rulesets do — so the scoped bypass Sean ruled
 * for moves `main` from classic protection to a repository ruleset. During that
 * move both shapes exist in the world, and a verifier that understood only the
 * one it was written against would report `cannot-tell` on the very day it is
 * most wanted.
 */

/** Everything this judgement needs, whichever shape the branch is protected by. */
export interface ProtectionReading {
  /** `repos/{o}/{r}/branches/main/protection`, or null when the branch has no classic protection. */
  readonly classic: ClassicProtection | null;
  /** `repos/{o}/{r}/rulesets` expanded, filtered to those targeting the default branch. */
  readonly rulesets: readonly Ruleset[];
  /** True only when every API call this reading needed actually answered. */
  readonly complete: boolean;
  /** Why the reading is incomplete. Empty when it is complete. */
  readonly unreachable: readonly string[];
}

export interface ClassicProtection {
  readonly required_status_checks?: { strict?: boolean; contexts?: string[] } | null;
  readonly required_pull_request_reviews?: object | null;
  readonly enforce_admins?: { enabled?: boolean } | null;
  readonly allow_force_pushes?: { enabled?: boolean } | null;
  readonly allow_deletions?: { enabled?: boolean } | null;
}

export interface RulesetBypassActor {
  readonly actor_type?: string;
  readonly actor_id?: number | null;
  readonly bypass_mode?: string;
}

export interface Ruleset {
  readonly id?: number;
  readonly name?: string;
  readonly enforcement?: string;
  readonly target?: string;
  readonly bypass_actors?: readonly RulesetBypassActor[];
  readonly conditions?: { ref_name?: { include?: string[]; exclude?: string[] } };
  readonly rules?: readonly {
    type?: string;
    parameters?: {
      strict_required_status_checks_policy?: boolean;
      required_status_checks?: readonly { context?: string }[];
      required_approving_review_count?: number;
    };
  }[];
}

/** The GitHub Actions app. Its bypass is the ONE grant the scheduled pushers get. */
export const ACTIONS_APP_ID = 15368;

/**
 * The two actors that are MACHINES rather than people, and are therefore the
 * only acceptable holders of the scheduled-push bypass.
 *
 * TWO, because exactly one step of the click-list cannot be settled by a
 * read-only session: whether GitHub offers the GitHub Actions app in a
 * repository ruleset's "Add bypass" suggestions. The docs say GitHub Apps are
 * eligible and the Actions app is app #15368 — it is the app that posts this
 * repo's own required checks — but community reports disagree about whether it
 * is selectable, and settling it would mean creating a ruleset, which this
 * session is forbidden to do.
 *
 * So the verifier accepts EITHER machine path and NAMES which one is in force.
 * A deploy key is the documented fallback: repository-scoped, no account, no
 * person behind it, and narrower than a personal access token. Neither is a
 * human, which is the property that actually matters.
 */
export function isMachineActor(actor: RulesetBypassActor): boolean {
  if (actor.actor_type === "DeployKey") return true;
  return actor.actor_type === "Integration" && actor.actor_id === ACTIONS_APP_ID;
}

export type ProtectionVerdict = "intact" | "drifted" | "cannot-tell";

export interface ProtectionAssertion {
  readonly name: string;
  readonly ok: boolean | null; // null === could not tell
  readonly detail: string;
}

export interface ProtectionReport {
  readonly verdict: ProtectionVerdict;
  readonly shape: "classic" | "ruleset" | "both" | "none" | "unknown";
  readonly assertions: readonly ProtectionAssertion[];
  readonly summary: string;
}

function rulesetsForMain(rulesets: readonly Ruleset[]): Ruleset[] {
  return rulesets.filter((r) => {
    if (r.target && r.target !== "branch") return false;
    if (r.enforcement && r.enforcement !== "active") return false;
    const include = r.conditions?.ref_name?.include ?? [];
    return include.some((i) => i === "~DEFAULT_BRANCH" || i === "refs/heads/main" || i === "main");
  });
}

/**
 * The judgement.
 *
 * `requiredContexts` is passed in rather than imported so this stays a pure
 * comparison against the list `lib/ops/required-checks.ts` already anchors on
 * the workflow file (RULING 156). Re-deriving it here would give this reader a
 * second opinion about what the contexts are, and two lists that can disagree
 * is the defect, not the fix.
 */
export function judgeProtection(
  reading: ProtectionReading,
  requiredContexts: readonly string[],
): ProtectionReport {
  const assertions: ProtectionAssertion[] = [];

  if (!reading.complete) {
    return {
      verdict: "cannot-tell",
      shape: "unknown",
      assertions: [
        {
          name: "read the protection configuration",
          ok: null,
          detail: `could not reach: ${reading.unreachable.join("; ")}`,
        },
      ],
      summary:
        "COULD NOT TELL — the protection configuration was not readable, so nothing about it is " +
        "asserted here. This is not a pass.",
    };
  }

  const active = rulesetsForMain(reading.rulesets);
  const hasClassic = reading.classic !== null;
  const shape: ProtectionReport["shape"] =
    hasClassic && active.length > 0 ? "both" : hasClassic ? "classic" : active.length > 0 ? "ruleset" : "none";

  if (shape === "none") {
    return {
      verdict: "drifted",
      shape,
      assertions: [{ name: "main is protected at all", ok: false, detail: "no classic protection and no active ruleset targets main" }],
      summary: "DRIFTED — `main` is not protected by anything. Every gate this repo has is bypassable right now.",
    };
  }

  /* --- the four properties that must hold for humans and for Claude Code --- */

  const prRequired =
    (hasClassic && reading.classic?.required_pull_request_reviews != null) ||
    active.some((r) => r.rules?.some((rule) => rule.type === "pull_request"));
  assertions.push({
    name: "a pull request is required",
    ok: prRequired,
    detail: prRequired ? "yes" : "NO — a direct push to main would be accepted",
  });

  const strict =
    (hasClassic && reading.classic?.required_status_checks?.strict === true) ||
    active.some((r) =>
      r.rules?.some(
        (rule) => rule.type === "required_status_checks" && rule.parameters?.strict_required_status_checks_policy === true,
      ),
    );
  assertions.push({
    name: "branches must be up to date before merging",
    ok: strict,
    detail: strict ? "yes" : "NO — a stale branch could merge without re-running the checks",
  });

  const present = new Set<string>();
  for (const c of reading.classic?.required_status_checks?.contexts ?? []) present.add(c);
  for (const r of active) {
    for (const rule of r.rules ?? []) {
      if (rule.type !== "required_status_checks") continue;
      for (const c of rule.parameters?.required_status_checks ?? []) if (c.context) present.add(c.context);
    }
  }
  const missing = requiredContexts.filter((c) => !present.has(c));
  assertions.push({
    name: `the ${requiredContexts.length} required contexts are registered by name`,
    ok: missing.length === 0,
    detail:
      missing.length === 0
        ? `all present: ${requiredContexts.join(", ")}`
        : `MISSING: ${missing.join(", ")}. A required context that never arrives is not a blocked ` +
          "merge — GitHub has nothing to wait for and the merge button turns green (RULING 156).",
  });

  /* --- no human or admin bypass --- */

  const humanBypass: string[] = [];
  if (hasClassic && reading.classic?.enforce_admins?.enabled !== true) {
    humanBypass.push("classic protection has enforce_admins OFF, so admins bypass everything");
  }
  for (const r of active) {
    for (const actor of r.bypass_actors ?? []) {
      if (!isMachineActor(actor)) {
        humanBypass.push(
          `ruleset "${r.name ?? r.id}" grants bypass to ${actor.actor_type ?? "?"}` +
            `${actor.actor_id != null ? ` #${actor.actor_id}` : ""} (${actor.bypass_mode ?? "?"})`,
        );
      }
    }
  }
  assertions.push({
    name: "no human or admin can bypass",
    ok: humanBypass.length === 0,
    detail: humanBypass.length === 0 ? "nobody but the Actions app" : humanBypass.join("; "),
  });

  /* --- the bot's bypass, present and scoped to exactly the Actions app --- */

  const botGrants = active.flatMap((r) =>
    (r.bypass_actors ?? [])
      .filter(isMachineActor)
      .map((a) => ({
        ruleset: r.name ?? String(r.id),
        mode: a.bypass_mode ?? "?",
        via: a.actor_type === "DeployKey" ? "a deploy key" : "the GitHub Actions app",
      })),
  );
  const botOk = botGrants.length === 1;
  assertions.push({
    name: "the Actions app has exactly one scoped bypass",
    ok: botOk,
    detail: botOk
      ? `granted via ${botGrants[0].via} on ruleset "${botGrants[0].ruleset}" (${botGrants[0].mode}); the hard path allowlist ` +
        "in lib/ops/push-allowlist.ts is what keeps it unable to carry code"
      : botGrants.length === 0
        ? "ABSENT — the scheduled pushers cannot push, and every refresh goes red at the push. " +
          "This is the pre-change state; see docs/branch-protection-clicklist.md."
        : `${botGrants.length} separate grants; expected exactly one`,
  });

  const failed = assertions.filter((a) => a.ok === false);
  const unknown = assertions.filter((a) => a.ok === null);

  if (unknown.length > 0) {
    return {
      verdict: "cannot-tell",
      shape,
      assertions,
      summary: `COULD NOT TELL — ${unknown.length} assertion(s) unanswered. Not a pass.`,
    };
  }

  return {
    verdict: failed.length === 0 ? "intact" : "drifted",
    shape,
    assertions,
    summary:
      failed.length === 0
        ? `INTACT — ${assertions.length} of ${assertions.length} assertions hold (${shape}).`
        : `DRIFTED — ${failed.length} of ${assertions.length} assertions FAIL: ${failed.map((f) => f.name).join("; ")}.`,
  };
}
