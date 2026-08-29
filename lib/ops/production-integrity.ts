/**
 * PRODUCTION INTEGRITY, AND THE FREEZE THAT FOLLOWS A RED ONE — NH273.
 *
 * GITHUB GREEN IS NOT PRODUCTION TRUTH. On 2026-08-28 migrations 0021 and 0022
 * merged with every required check green and deployed while production's schema
 * stood at 20. `ask_interactions` did not exist, every insert naming it failed,
 * the route caught the error and served the page, and the only thing that
 * noticed was the daily tripwire the next morning. Three green checks had said
 * nothing false; they had simply never asked production anything.
 *
 * THE OWNER'S DECISION, and it is not re-litigated here: a red post-deploy
 * integrity check does NOT roll production back. It marks integrity DEGRADED in
 * durable machine-readable state, alerts, and mechanically blocks the next
 * production-changing release until a re-check passes. Automatic rollback is
 * refused because the database may already have advanced, and rolling the code
 * back under an advanced schema creates a second incompatibility on top of the
 * first.
 *
 * WHY THIS IS NOT A `deployment_status` WORKFLOW, measured rather than assumed.
 * `gh api repos/:owner/:repo/deployments` returns **0**. Netlify's integration
 * with this repository creates no GitHub Deployment, so no `deployment_status`
 * event has ever fired here and a workflow listening for one would never run.
 * A gate that never executes is worse than no gate: it reports nothing and
 * reads as covered. The trigger is therefore explicit — `pnpm integrity:check`,
 * dispatchable in CI through the schema gate's existing `post-deploy` moment —
 * and the FREEZE is enforced where the repository's shipping truth already
 * lives, in the `gates` job, rather than in a tenth workflow that would be a
 * second shipping verdict.
 *
 * This module is PURE. It reads no clock, no disk, no network and no
 * environment. Everything it needs is passed in, so every state in the model
 * can be constructed in a test rather than waited for in production.
 */

import { classifyDeploy } from "./deploy-paths.ts";

/** ---------------------------------------------------------- the states */

/**
 * What we currently know about whether the deployed application and the
 * production database agree.
 *
 * The two states that do the real work are the two that are NOT green:
 * `CREDENTIAL_MISSING` exists so an absent secret can never print like a pass
 * (RULING 24), and `STALE_HEALTHY` exists so a green answer about an older
 * commit can never be read as an answer about this one.
 */
export const INTEGRITY_STATES = [
  /** Checked against the exact deployed SHA, and it held. */
  "CURRENT",
  /** The last check held, but it was taken against a DIFFERENT SHA than the one now in question. */
  "STALE_HEALTHY",
  /** A check ran and failed. This is the state that freezes releases. */
  "DEGRADED",
  /** Never checked, or the record could not be read. Not a pass. */
  "UNKNOWN",
  /** The check could not run because the read-only production credential is absent. Not a pass. */
  "CREDENTIAL_MISSING",
] as const;
export type IntegrityState = (typeof INTEGRITY_STATES)[number];

/** Exactly why integrity is not green. Named, never "failed". */
export const FAILURE_CLASSES = [
  "MIGRATION_NOT_APPLIED",
  "CONTRACT_APPLIED_EARLY",
  "APPLIED_SQL_REWRITTEN",
  "MIGRATION_IMMUTABILITY_VIOLATION",
  "MIGRATIONS_TABLE_UNREADABLE",
  "UNDECLARED_MIGRATION_PHASE",
  "CREDENTIAL_ABSENT",
  "CHECK_NEVER_RUN",
] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];

/**
 * The durable record. This is what is committed to
 * `data/ops/production-integrity.json` and what the freeze gate reads.
 *
 * `deployedSha` is the application-bearing commit the reading was taken
 * against. It is the field that makes staleness detectable: without it, a green
 * record is a green record forever, which is precisely how a stale status
 * blesses a later deploy.
 */
export interface IntegrityRecord {
  /** Schema version of this file, so a reader can refuse a shape it predates. */
  readonly formatVersion: 1;
  /** The application-bearing SHA this reading was taken against. */
  readonly deployedSha: string | null;
  /** `origin/main` at the moment of the reading, when known. */
  readonly mainSha: string | null;
  /** Result of the reading, before any staleness adjustment. */
  readonly observed: "HELD" | "REFUSED" | "COULD_NOT_TELL";
  readonly failureClass: FailureClass | null;
  /** One sentence a person can act on. */
  readonly detail: string;
  readonly observedAt: string | null;
  /** How the reading was taken — the moment the schema gate was asked from. */
  readonly moment: "pre-deploy" | "post-deploy" | null;
  /** The exit code the gate returned. 0 held, 1 refused, 2 could not tell. */
  readonly gateExit: 0 | 1 | 2 | null;
}

/** The record a repository with no reading yet carries. Deliberately not green. */
export const NEVER_CHECKED: IntegrityRecord = {
  formatVersion: 1,
  deployedSha: null,
  mainSha: null,
  observed: "COULD_NOT_TELL",
  failureClass: "CHECK_NEVER_RUN",
  detail: "No production-integrity reading has been recorded.",
  observedAt: null,
  moment: null,
  gateExit: null,
};

/** ------------------------------------------------------- the evaluator */

export interface IntegrityAssessment {
  readonly state: IntegrityState;
  readonly failureClass: FailureClass | null;
  /** Why this state, in one sentence. */
  readonly reason: string;
  /** The SHA the assessment is ABOUT, which may differ from the one observed. */
  readonly aboutSha: string | null;
  readonly observedSha: string | null;
}

/**
 * Assess a record with respect to a specific candidate commit.
 *
 * `candidateSha` is the commit whose release is being considered. Passing
 * `null` asks the unqualified question "what is the last thing we knew?", which
 * is what a status report wants; passing a SHA asks "does what we know apply
 * HERE?", which is what a release gate wants. They are different questions and
 * conflating them is the stale-status defect.
 */
export function assessIntegrity(
  record: IntegrityRecord,
  candidateSha: string | null,
): IntegrityAssessment {
  const observedSha = record.deployedSha;

  if (record.observed === "REFUSED") {
    return {
      state: "DEGRADED",
      failureClass: record.failureClass,
      reason:
        `Production integrity was REFUSED at ${record.observedAt ?? "an unrecorded time"} ` +
        `against ${observedSha ?? "an unrecorded commit"}: ${record.detail}`,
      aboutSha: candidateSha,
      observedSha,
    };
  }

  if (record.observed === "COULD_NOT_TELL") {
    const credential = record.failureClass === "CREDENTIAL_ABSENT";
    return {
      state: credential ? "CREDENTIAL_MISSING" : "UNKNOWN",
      failureClass: record.failureClass ?? "CHECK_NEVER_RUN",
      reason: credential
        ? "The read-only production credential is absent, so production integrity is UNPROVEN. " +
          "An unset credential is not a passing check."
        : `Production integrity is UNKNOWN: ${record.detail}`,
      aboutSha: candidateSha,
      observedSha,
    };
  }

  // observed === "HELD" from here.
  if (observedSha === null) {
    return {
      state: "UNKNOWN",
      failureClass: "CHECK_NEVER_RUN",
      reason:
        "A reading recorded HELD but named no commit, so there is nothing it can be said to hold FOR.",
      aboutSha: candidateSha,
      observedSha,
    };
  }

  if (candidateSha !== null && candidateSha !== observedSha) {
    return {
      state: "STALE_HEALTHY",
      failureClass: null,
      reason:
        `The last reading held, but it was taken against ${observedSha} and the commit in ` +
        `question is ${candidateSha}. A green answer about another commit is not an answer ` +
        "about this one.",
      aboutSha: candidateSha,
      observedSha,
    };
  }

  return {
    state: "CURRENT",
    failureClass: null,
    reason: `Production integrity held against ${observedSha} at ${record.observedAt}.`,
    aboutSha: candidateSha,
    observedSha,
  };
}

/** ---------------------------------------------------------- the freeze */

export interface FreezeVerdict {
  readonly frozen: boolean;
  /** Why the release is refused, or why it is permitted. Always stated. */
  readonly reason: string;
  readonly state: IntegrityState;
  /** True when this change could alter what production serves. */
  readonly productionChanging: boolean;
  /** True when this change moves the schema contract. */
  readonly touchesSchemaContract: boolean;
  /** What clears it, when frozen. Never a shrug. */
  readonly remedy: string | null;
}

/**
 * The paths whose movement makes a change schema-contract-bearing.
 *
 * Deliberately the same two prefixes `lib/db/shipping-invariant.ts` uses. A
 * second, independently maintained list would be free to disagree with the
 * gate it is supposed to mirror (RULING 103).
 */
export const SCHEMA_CONTRACT_PREFIXES = ["lib/db/migrations/", "lib/db/schema.ts"] as const;

export function touchesSchemaContract(changed: readonly string[] | null): boolean {
  // A changed-path list we could not compute is treated as touching the
  // contract. The alternative is to guess that it did not, and the whole file
  // exists because a guess about production was wrong once already.
  if (changed === null) return true;
  return changed
    .map((p) => p.replace(/\\/g, "/").replace(/^\.\//, ""))
    .some((p) =>
      SCHEMA_CONTRACT_PREFIXES.some((prefix) =>
        prefix.endsWith("/") ? p.startsWith(prefix) : p === prefix,
      ),
    );
}

/**
 * May this release proceed?
 *
 * The rules, in order, and each one is a decision rather than a default:
 *
 *  1. A change that cannot alter what production serves is NEVER frozen. A
 *     docs-only commit is not a production release, and freezing it would
 *     punish the paperwork for the database's condition. `classifyDeploy` is
 *     the authority on that question — the same predicate the Netlify ignore
 *     step already uses, so the freeze and the deploy filter cannot disagree.
 *
 *  2. DEGRADED freezes every production-changing release, schema or not. This
 *     is the owner's instruction. Once production and the deployed code are
 *     known to disagree, shipping more code on top is how one incompatibility
 *     becomes two.
 *
 *  3. CREDENTIAL_MISSING and UNKNOWN freeze a production-changing release only
 *     when it also moves the schema contract. That is the case where shipping
 *     blind is shipping the exact defect of 2026-08-28. A production-changing
 *     release that leaves the schema alone is permitted and reported as
 *     UNPROVEN — loudly, and never as green.
 *
 *  4. STALE_HEALTHY does not freeze. It is a real, honest state: the last thing
 *     we asked held. It simply may not be reported as CURRENT.
 */
export function evaluateReleaseFreeze(input: {
  record: IntegrityRecord;
  candidateSha: string | null;
  changedPaths: readonly string[] | null;
}): FreezeVerdict {
  const assessment = assessIntegrity(input.record, input.candidateSha);
  const deploy = classifyDeploy(input.changedPaths);
  const productionChanging = deploy.verdict !== "cancel";
  const schema = touchesSchemaContract(input.changedPaths);

  const base = {
    state: assessment.state,
    productionChanging,
    touchesSchemaContract: schema,
  };

  if (!productionChanging) {
    return {
      ...base,
      frozen: false,
      reason:
        `This change cannot alter what production serves (${deploy.reason}), so it is not a ` +
        `production release and the freeze does not reach it. Integrity is ${assessment.state}.`,
      remedy: null,
    };
  }

  if (assessment.state === "DEGRADED") {
    return {
      ...base,
      frozen: true,
      reason:
        `PRODUCTION INTEGRITY IS DEGRADED and this change is production-changing. ${assessment.reason}`,
      remedy:
        "Reconcile production with the committed migrations, then re-run `pnpm integrity:check` " +
        "against the deployed commit. A passing re-check clears the freeze. Nothing here rolls " +
        "production back, and nothing should: the database may already have advanced.",
    };
  }

  if ((assessment.state === "CREDENTIAL_MISSING" || assessment.state === "UNKNOWN") && schema) {
    return {
      ...base,
      frozen: true,
      reason:
        `This change moves the schema contract and production integrity is ${assessment.state}. ` +
        `${assessment.reason}`,
      remedy:
        assessment.state === "CREDENTIAL_MISSING"
          ? "Add WTP_PRODUCTION_DATABASE_URL_READONLY as a repository secret (NH272), then run " +
            "`pnpm integrity:check`. Until production can be read, a schema-moving release is " +
            "shipping blind."
          : "Run `pnpm integrity:check` against the deployed commit to establish a reading.",
    };
  }

  const caveat =
    assessment.state === "CURRENT"
      ? ""
      : ` Integrity is ${assessment.state} and is NOT being reported as current: ${assessment.reason}`;

  return {
    ...base,
    frozen: false,
    reason: `Release permitted.${caveat}`,
    remedy: null,
  };
}

/**
 * Render a verdict for a human reading a CI log.
 *
 * States what is known and what is owed. It does not pronounce on the session
 * that ran, and it never prints a bare "OK" for a state that is not CURRENT —
 * the whole failure being guarded against is a non-answer that looked like one.
 */
export function explainFreeze(v: FreezeVerdict): string {
  const head = v.frozen ? "RELEASE FROZEN" : "release permitted";
  const lines = [
    `${head} — production integrity: ${v.state}`,
    `  production-changing: ${v.productionChanging}`,
    `  moves schema contract: ${v.touchesSchemaContract}`,
    `  ${v.reason}`,
  ];
  if (v.remedy) lines.push(`  REMEDY: ${v.remedy}`);
  return lines.join("\n");
}
