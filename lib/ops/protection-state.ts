/** Whether `main`'s protection is still the permanent software-only boundary: a fail-closed judgement over a live reading. */

export interface ProtectionReading {
  /** `repos/{o}/{r}/branches/main/protection`, or null when absent. */
  readonly classic: ClassicProtection | null;
  /** Expanded repository rulesets, before filtering to active `main` rules. */
  readonly rulesets: readonly Ruleset[];
  /** `repos/{o}/{r}/keys`, or null when the endpoint could not be read. */
  readonly deployKeys: readonly DeployKeyRow[] | null;
  /** True only when every API call needed by this reading answered. */
  readonly complete: boolean;
  /** Why the reading is incomplete. Empty when complete. */
  readonly unreachable: readonly string[];
}

export interface DeployKeyRow {
  readonly id?: number;
  readonly title?: string;
  /** GitHub's field: false means the key can write. */
  readonly read_only?: boolean;
  readonly created_at?: string;
  readonly last_used?: string | null;
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

export type ProtectionVerdict = "intact" | "drifted" | "cannot-tell";

export interface ProtectionAssertion {
  readonly name: string;
  readonly ok: boolean | null;
  readonly detail: string;
}

export interface ProtectionReport {
  readonly verdict: ProtectionVerdict;
  readonly shape: "classic" | "ruleset" | "both" | "none" | "unknown";
  readonly assertions: readonly ProtectionAssertion[];
  readonly summary: string;
}

function rulesetsForMain(rulesets: readonly Ruleset[]): Ruleset[] {
  return rulesets.filter((ruleset) => {
    if (ruleset.target !== "branch" || ruleset.enforcement !== "active") return false;
    const include = ruleset.conditions?.ref_name?.include ?? [];
    const exclude = ruleset.conditions?.ref_name?.exclude ?? [];
    const namesMain = include.some((entry) =>
      entry === "~DEFAULT_BRANCH" || entry === "refs/heads/main" || entry === "main"
    );
    const excludesMain = exclude.some((entry) =>
      entry === "~DEFAULT_BRANCH" || entry === "refs/heads/main" || entry === "main"
    );
    return namesMain && !excludesMain;
  });
}

function actorLabel(actor: RulesetBypassActor): string {
  return `${actor.actor_type ?? "?"}${actor.actor_id != null ? ` #${actor.actor_id}` : ""}` +
    ` (${actor.bypass_mode ?? "?"})`;
}

/**
 * Judge a complete live reading against the terminal PDC protection state.
 * `requiredContexts` is supplied by the workflow-derived required-checks
 * module; this verifier never maintains a second list.
 */
export function judgeProtection(
  reading: ProtectionReading,
  requiredContexts: readonly string[],
): ProtectionReport {
  if (!reading.complete) {
    return {
      verdict: "cannot-tell",
      shape: "unknown",
      assertions: [{
        name: "read the protection configuration",
        ok: null,
        detail: `could not reach: ${reading.unreachable.join("; ")}`,
      }],
      summary: "COULD NOT TELL — the protection configuration was not readable. This is not a pass.",
    };
  }

  const active = rulesetsForMain(reading.rulesets);
  const hasClassic = reading.classic !== null;
  const shape: ProtectionReport["shape"] =
    hasClassic && active.length > 0 ? "both" :
      hasClassic ? "classic" :
        active.length > 0 ? "ruleset" : "none";

  if (shape === "none") {
    return {
      verdict: "drifted",
      shape,
      assertions: [{
        name: "main is protected at all",
        ok: false,
        detail: "no classic protection and no active ruleset targets main",
      }],
      summary: "DRIFTED — `main` is not protected by anything.",
    };
  }

  const assertions: ProtectionAssertion[] = [];

  const permanentShape = !hasClassic && active.length === 1;
  assertions.push({
    name: "exactly one active ruleset and no classic rule protect main",
    ok: permanentShape,
    detail: permanentShape
      ? `ruleset "${active[0].name ?? active[0].id ?? "(unnamed)"}" only`
      : `${active.length} active main ruleset(s); classic protection ${hasClassic ? "present" : "absent"}`,
  });

  const prRequired =
    (hasClassic && reading.classic?.required_pull_request_reviews != null) ||
    active.some((ruleset) => ruleset.rules?.some((rule) => rule.type === "pull_request"));
  assertions.push({
    name: "a pull request is required",
    ok: prRequired,
    detail: prRequired ? "yes" : "NO — a direct software push to main would be accepted",
  });

  const strict =
    (hasClassic && reading.classic?.required_status_checks?.strict === true) ||
    active.some((ruleset) => ruleset.rules?.some((rule) =>
      rule.type === "required_status_checks" &&
      rule.parameters?.strict_required_status_checks_policy === true
    ));
  assertions.push({
    name: "branches must be up to date before merging",
    ok: strict,
    detail: strict ? "yes" : "NO — a stale branch could merge without re-running checks",
  });

  const reportedContexts: string[] = [
    ...(reading.classic?.required_status_checks?.contexts ?? []),
  ];
  for (const ruleset of active) {
    for (const rule of ruleset.rules ?? []) {
      if (rule.type !== "required_status_checks") continue;
      for (const row of rule.parameters?.required_status_checks ?? []) {
        if (row.context) reportedContexts.push(row.context);
      }
    }
  }
  const required = [...requiredContexts].sort();
  const reported = [...reportedContexts].sort();
  const missing = required.filter((context) => !reported.includes(context));
  const unexpected = reported.filter((context) => !required.includes(context));
  const contextsExact =
    missing.length === 0 && unexpected.length === 0 && reported.length === required.length;
  assertions.push({
    name: `exactly the ${required.length} required contexts are registered by name`,
    ok: contextsExact,
    detail: contextsExact
      ? `exactly: ${requiredContexts.join(", ")}`
      : [
          missing.length > 0 ? `MISSING: ${missing.join(", ")}` : "",
          unexpected.length > 0 ? `UNEXPECTED: ${unexpected.join(", ")}` : "",
          reported.length !== required.length
            ? `expected ${required.length} row(s), read ${reported.length}`
            : "",
        ].filter(Boolean).join("; "),
  });

  const bypasses: string[] = [];
  if (hasClassic && reading.classic?.enforce_admins?.enabled !== true) {
    bypasses.push("classic protection has enforce_admins OFF");
  }
  for (const ruleset of active) {
    if (!Array.isArray(ruleset.bypass_actors)) {
      bypasses.push(`ruleset "${ruleset.name ?? ruleset.id ?? "(unnamed)"}" omitted bypass_actors`);
      continue;
    }
    for (const actor of ruleset.bypass_actors) {
      bypasses.push(`ruleset "${ruleset.name ?? ruleset.id ?? "(unnamed)"}" grants ${actorLabel(actor)}`);
    }
  }
  assertions.push({
    name: "no actor, role, team, app, admin, or deploy-key category can bypass",
    ok: bypasses.length === 0,
    detail: bypasses.length === 0
      ? "the bypass list is empty and no classic admin bypass exists"
      : bypasses.join("; "),
  });

  const deletionBarred =
    (hasClassic && reading.classic?.allow_deletions?.enabled !== true) ||
    active.some((ruleset) => ruleset.rules?.some((rule) => rule.type === "deletion"));
  assertions.push({
    name: "the branch cannot be deleted",
    ok: deletionBarred,
    detail: deletionBarred ? "yes" : "NO — main could be deleted outright",
  });

  const forceBarred =
    (hasClassic && reading.classic?.allow_force_pushes?.enabled !== true) ||
    active.some((ruleset) => ruleset.rules?.some((rule) => rule.type === "non_fast_forward"));
  assertions.push({
    name: "force pushes are blocked",
    ok: forceBarred,
    detail: forceBarred ? "yes" : "NO — history on main could be rewritten",
  });

  if (reading.deployKeys === null) {
    assertions.push({
      name: "zero write-enabled deploy keys exist",
      ok: null,
      detail: "the deploy-key list could not be read; an unread privilege inventory is not a pass",
    });
  } else {
    const indeterminate = reading.deployKeys.filter((key) => typeof key.read_only !== "boolean");
    const writable = reading.deployKeys.filter((key) => key.read_only === false);
    assertions.push({
      name: "zero write-enabled deploy keys exist",
      ok: indeterminate.length > 0 ? null : writable.length === 0,
      detail: indeterminate.length > 0
        ? `${indeterminate.length} deploy key row(s) omitted the read_only privilege bit: ${indeterminate
            .map((key) => `"${key.title ?? "(untitled)"}"`)
            .join(", ")}`
        : writable.length === 0
        ? `0 of ${reading.deployKeys.length} deploy key(s) can write`
        : `${writable.length} write-enabled deploy key(s): ${writable
            .map((key) => `"${key.title ?? "(untitled)"}"`)
            .join(", ")}`,
    });
  }

  const failed = assertions.filter((assertion) => assertion.ok === false);
  const unknown = assertions.filter((assertion) => assertion.ok === null);
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
    summary: failed.length === 0
      ? `INTACT — ${assertions.length} of ${assertions.length} assertions hold (${shape}).`
      : `DRIFTED — ${failed.length} of ${assertions.length} assertions FAIL: ${failed
          .map((assertion) => assertion.name)
          .join("; ")}.`,
  };
}
