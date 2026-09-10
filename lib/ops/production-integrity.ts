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
 *
 * ## THE HOLE THIS FILE CARRIED UNTIL 2026-08-29, AND HOW IT IS CLOSED
 *
 * Rule 4 used to read, in full: *"STALE_HEALTHY does not freeze."* So a
 * production-changing release could rely on a green reading about a DIFFERENT
 * commit **forever**. The state was honest and the consequence was not: nothing
 * in the mechanism ever expired a healthy answer, and an answer that never
 * expires is an answer that stops being about anything.
 *
 * **THE QUESTION THAT WAS WRONG.** The first repair drafted here keyed the
 * freeze on the CANDIDATE sha — freeze whenever the reading was taken against
 * something other than the commit being released. That is unsatisfiable by
 * construction: a POST-deploy reading against a candidate cannot exist until
 * that candidate has deployed, and this gate runs BEFORE the deploy. Every
 * production-changing release would be frozen, always, and an unsatisfiable
 * gate is the strongest argument anyone will ever have for the skip flag this
 * repository refuses to have. Recorded here so it is not re-proposed.
 *
 * **THE QUESTION THAT IS RIGHT, and it is a different one.** Before shipping
 * more code on top of production: *do we know that production AS IT STANDS NOW
 * is healthy, and did we learn it recently enough for it still to be true?*
 * Both halves are answerable today. What production serves is OBSERVABLE with
 * no credential — `GET /api/build` returns the deployed commit — and the
 * reading carries its own `observedAt`. So the freeze is keyed on the SERVED
 * sha and on the reading's AGE, and `STALE_HEALTHY` keeps its exact meaning:
 * "held, but about a different commit than the one in question". All that
 * changed is WHICH commit is in question, and that was the whole defect.
 *
 * The observation and the clock are INPUTS. This module still touches neither.
 */

import { classifyDeploy } from "./deploy-paths.ts";

import { PUBLIC_SITE_ORIGIN } from "./origins.ts";

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
 * The durable record appended to the production control plane's existing
 * software-release outcome log and read by both Admin and the freeze gate.
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

/**
 * Are these two strings the same commit?
 *
 * **PREFIX-TOLERANT, AND THAT IS NOT A CONVENIENCE.** Historical records have
 * carried an ABBREVIATED sha since 2026-08-28 (`"71325247"`), and
 * `GET /api/build` returns the full forty characters. Strict equality would
 * therefore have reported PRODUCTION_MOVED for a commit that had not moved at
 * all — a false freeze on the mechanism's first real use, which is the failure
 * direction that gets a gate switched off rather than fixed.
 *
 * Seven characters is the floor because that is git's own default abbreviation
 * and the shortest thing anyone here writes down. Below it, two unrelated
 * commits genuinely can share a prefix, so a shorter string is refused as a
 * match rather than guessed at.
 */
export function sameCommit(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  if (a.length < 7 || b.length < 7) return false;
  return a.startsWith(b) || b.startsWith(a);
}

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

  if (candidateSha !== null && !sameCommit(candidateSha, observedSha)) {
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

/**
 * THE MAXIMUM AGE A HEALTHY READING MAY CARRY, and the reason for the number.
 *
 * Twenty-four hours is the deliberately conservative maximum between software
 * release-integrity observations. It is also the MEASURED width of the window
 * the 2026-08-28 schema drift hid in: migrations 0021 and 0022 deployed against
 * a schema that stood at 20, and the then-daily tripwire did not ask until the
 * next morning. The legacy refresh cadence and tripwire clocks are retired;
 * routine civic-data cadence is unrelated to this software-release reading.
 *
 * It is an EXPLICIT PARAMETER of the observation and nothing else. There is no
 * environment variable, no flag, and no skip: an escape hatch on this bound
 * would restore the exact hole it closes, because "stale forever" and "stale
 * with a way to say it is fine" are the same gate.
 */
export const MAX_READING_AGE_HOURS = 24;

/**
 * WHETHER TWO COMMITS CARRY THE SAME APPLICATION — NH289.
 *
 * The served COMMIT and the application-bearing RELEASE are different
 * identities, and conflating them froze a release on 2026-08-30. The retired
 * observer Git writer exposed the case, but any later human-authored
 * non-shipping descendant can still make production report a newer commit
 * while serving the measured release's application byte for byte.
 *
 * This type is the caller's PROOF about that difference, and it is evidence,
 * not leniency:
 *
 *   - `EQUIVALENT` may be claimed only when the caller mechanically verified
 *     BOTH halves — the served commit DESCENDS from the measured release, and
 *     every path changed across that range is non-shipping under
 *     `classifyDeploy`, the same predicate the deploy filter runs. A schema or
 *     migration file anywhere in the range is a shipping path, so it destroys
 *     equivalence by construction.
 *   - `NOT_EQUIVALENT` is a real measurement the other way: something in the
 *     range ships. The freeze treats it exactly as a moved production.
 *   - `CANNOT_TELL` is the absence of a measurement — an unreachable commit, a
 *     history too shallow to prove descent, a diff that would not read — and
 *     it NEVER counts as equivalent. An unprovable range freezes.
 *
 * There is no input that STATES equivalence: no flag, no allowlisted sha, no
 * "trust this commit". The proof is recomputed from git evidence on every
 * evaluation, so it works for every future non-shipping descendant rather
 * than for the one that exposed the defect.
 */
export const EQUIVALENCE_VERDICTS = ["EQUIVALENT", "NOT_EQUIVALENT", "CANNOT_TELL"] as const;
export type EquivalenceVerdict = (typeof EQUIVALENCE_VERDICTS)[number];

export interface ApplicationEquivalence {
  readonly verdict: EquivalenceVerdict;
  /** The evidence, in one sentence. Printed with the freeze verdict. */
  readonly how: string;
}

/**
 * The pure half of the equivalence proof. The caller takes the two git
 * measurements — whether the recorded release is an ancestor of the served
 * commit, and which paths changed across the range — and this classifies
 * them, so every branch is constructible in a test while the gate script
 * stays a thin plumbing shell.
 *
 * Every uncertain input fails toward CANNOT_TELL, never toward EQUIVALENT:
 * unknown ancestry, an unreadable range, each on its own is enough to refuse.
 * The shipping predicate is `classifyDeploy` — the deploy filter's own — so a
 * schema file, a migration, or any app path in the range is shipping and
 * destroys equivalence with no separate list to drift.
 */
export function classifyEquivalenceRange(input: {
  readonly recordedSha: string;
  readonly servedSha: string;
  /** Is the recorded release an ancestor of the served commit? `unknown` means git could not say. */
  readonly ancestry: "ancestor" | "not-ancestor" | "unknown";
  /** Paths changed across recorded..served, or `null` when the diff could not be read. */
  readonly rangePaths: readonly string[] | null;
}): ApplicationEquivalence {
  const recorded = input.recordedSha.slice(0, 7);
  const served = input.servedSha.slice(0, 7);

  if (input.ancestry === "not-ancestor") {
    return {
      verdict: "NOT_EQUIVALENT",
      how: `${served} does not descend from the recorded release ${recorded} — a different history, whatever its tree holds`,
    };
  }
  if (input.ancestry === "unknown") {
    return {
      verdict: "CANNOT_TELL",
      how: `whether ${recorded} is an ancestor of ${served} could not be established — descent unproven is descent unclaimed`,
    };
  }
  if (input.rangePaths === null) {
    return {
      verdict: "CANNOT_TELL",
      how: `the range ${recorded}..${served} could not be diffed, and an unreadable range is never equivalent`,
    };
  }
  if (input.rangePaths.length === 0) {
    return { verdict: "EQUIVALENT", how: `${recorded} and ${served} have identical trees` };
  }
  const split = classifyDeploy(input.rangePaths);
  if (split.shipping.length > 0) {
    return {
      verdict: "NOT_EQUIVALENT",
      how:
        `${split.shipping.length} of ${input.rangePaths.length} path(s) in ${recorded}..${served} ` +
        `are production-bearing — first is ${split.shipping[0]}`,
    };
  }
  return {
    verdict: "EQUIVALENT",
    how:
      `${served} descends from ${recorded} and all ${input.rangePaths.length} changed path(s) in ` +
      `the range are non-shipping (first is ${input.rangePaths[0]})`,
  };
}

/**
 * What production actually serves, observed, plus the age of the reading.
 *
 * Both fields are MEASUREMENTS taken by the caller — `scripts/release-freeze-gate.mts`
 * reads the clock and asks `GET /api/build`. Neither is inferred here, and this
 * module still opens no socket and reads no clock.
 */
export interface ProductionObservation {
  /**
   * The commit production is serving right now. `null` means the observation
   * FAILED — a refusal, a non-200, an unparseable body, or an `unknown` commit.
   * It never means "production serves nothing".
   */
  readonly servedSha: string | null;
  /** How it was observed, or why it could not be. Printed either way. */
  readonly how: string;
  /**
   * Hours between the reading's `observedAt` and the caller's clock. `null` is
   * the absence of a measurement — a reading with no time cannot be aged — and
   * is treated as expired rather than as young.
   */
  readonly readingAgeHours: number | null;
  /** The bound in force for this evaluation. Passed, never read from anywhere. */
  readonly maxAgeHours: number;
  /**
   * The caller's measured proof that the served commit and the recorded
   * release carry the same application (NH289). Consulted ONLY when the two
   * shas differ; omitting it, or supplying `CANNOT_TELL`, leaves the strict
   * answer — PRODUCTION_MOVED — in force.
   */
  readonly equivalence?: ApplicationEquivalence | null;
}

/**
 * Whether a HEALTHY reading still covers the production it was taken against.
 *
 * This is a SEPARATE axis from `IntegrityState`, deliberately. `STALE_HEALTHY`
 * keeps its meaning untouched — the reading held, about another commit — and
 * this says what follows from that for a release. Folding the two together
 * would have meant repurposing an existing state, which is how a vocabulary
 * stops being readable.
 */
export const FRESHNESS_VERDICTS = [
  /** The reading is about the commit production serves, and it is inside the age bound. */
  "CURRENT_FOR_PRODUCTION",
  /** Production serves a commit the reading was not taken against. It moved under us. */
  "PRODUCTION_MOVED",
  /** The reading is older than the bound, or carries no time at all. */
  "READING_EXPIRED",
  /** Production could not be asked what it serves. Not a pass (RULING 24). */
  "PRODUCTION_UNOBSERVABLE",
  /** No observation was supplied at all, so freshness was never established. */
  "NOT_ASSESSED",
  /** Freshness does not arise: the change is not a release, or the reading is not HELD. */
  "NOT_APPLICABLE",
] as const;
export type FreshnessVerdict = (typeof FRESHNESS_VERDICTS)[number];

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
  /** Whether a healthy reading still covers what production serves. */
  readonly freshness: FreshnessVerdict;
  /** The commit production was observed to serve, when it could be observed. */
  readonly servedSha: string | null;
  /** The measured age of the reading, in hours. */
  readonly readingAgeHours: number | null;
  /**
   * The application-bearing release the integrity reading covers, when rule 4
   * established one. Differs from `servedSha` exactly when production reports
   * a PROVEN non-shipping descendant of the measured release (NH289); `null`
   * whenever rule 4 did not reach a covered release.
   */
  readonly applicationReleaseSha: string | null;
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
 *  4. **A HEALTHY READING MUST STILL COVER THE PRODUCTION IT IS ABOUT.**
 *     (Amended 2026-08-29. The old rule 4 read "STALE_HEALTHY does not freeze",
 *     full stop, and that is the hole: a green answer about another commit
 *     blessed every later release forever.)
 *
 *     For a production-changing release whose last reading HELD, exactly one of
 *     these is true, and each is named rather than defaulted:
 *
 *       - no observation was supplied            -> NOT_ASSESSED, FROZEN
 *       - production could not be asked          -> PRODUCTION_UNOBSERVABLE, FROZEN
 *       - production serves a different commit   -> PRODUCTION_MOVED, FROZEN
 *       - the reading is older than the bound    -> READING_EXPIRED, FROZEN
 *       - otherwise                              -> CURRENT_FOR_PRODUCTION, permitted
 *
 *     **NOT_ASSESSED FREEZES, and that direction is the design.** A caller that
 *     omits the observation gets the strict answer, never the lenient one, so
 *     there is no way to be permitted by leaving the question unasked. That is
 *     the only shape under which "there is no skip flag" survives contact with
 *     a caller who would like one.
 *
 *     **PRODUCTION_UNOBSERVABLE FREEZES** for the reason the whole file exists:
 *     "we could not ask production anything" is the blindness of 2026-08-28,
 *     and a network refusal that read as green would reintroduce it wholesale
 *     (RULING 24).
 *
 *     Rule 4 reaches ONLY readings that HELD. A reading that is DEGRADED,
 *     UNKNOWN or CREDENTIAL_MISSING has no health to go stale, and rules 2 and 3
 *     are the author's decisions about those. Widening the freeze into them
 *     through the back door of a freshness clause would be a different ruling
 *     wearing this one's clothes.
 */
export function evaluateReleaseFreeze(input: {
  record: IntegrityRecord;
  candidateSha: string | null;
  changedPaths: readonly string[] | null;
  /**
   * What production serves and how old the reading is. OMITTING IT IS NOT
   * NEUTRAL — see rule 4: an unsupplied observation freezes a
   * production-changing release on a healthy reading.
   */
  production?: ProductionObservation | null;
}): FreezeVerdict {
  const observation = input.production ?? null;
  /*
   * THE SUBJECT OF THE ASSESSMENT IS WHAT PRODUCTION SERVES, not the candidate.
   * The candidate is only the fallback for the case where production could not
   * be observed at all — and that case is frozen below on its own terms, so the
   * fallback never decides anything by itself.
   */
  const subjectSha = observation?.servedSha ?? input.candidateSha;
  const assessment = assessIntegrity(input.record, subjectSha);
  const deploy = classifyDeploy(input.changedPaths);
  const productionChanging = deploy.verdict !== "cancel";
  const schema = touchesSchemaContract(input.changedPaths);

  const base = {
    state: assessment.state,
    productionChanging,
    touchesSchemaContract: schema,
    servedSha: observation?.servedSha ?? null,
    readingAgeHours: observation?.readingAgeHours ?? null,
    applicationReleaseSha: null as string | null,
  };

  if (!productionChanging) {
    return {
      ...base,
      frozen: false,
      freshness: "NOT_APPLICABLE" as const,
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
      freshness: "NOT_APPLICABLE" as const,
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
      freshness: "NOT_APPLICABLE" as const,
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

  /* ---------------- rule 4: the freshness clause (2026-08-29) ------------- */

  const healthy =
    input.record.observed === "HELD" &&
    (assessment.state === "CURRENT" || assessment.state === "STALE_HEALTHY");

  if (healthy) {
    const reread =
      "Take a post-deploy reading against the commit production actually serves:\n" +
      `  pnpm integrity:check --sha=<the sha GET ${PUBLIC_SITE_ORIGIN}/api/build returns> --write\n` +
      "or let the observer do it — `.github/workflows/post-deploy-integrity.yml` runs\n" +
      "`pnpm exec tsx scripts/post-deploy-observer.mts` on every push to main and appends the\n" +
      "reading to the canonical software-release log. There is no skip flag and no environment override for this bound.";

    if (observation === null) {
      return {
        ...base,
        frozen: true,
        freshness: "NOT_ASSESSED" as const,
        reason:
          "The last reading HELD, but nothing established whether it still covers the production " +
          "this release would ship on top of. An unasked question is not a passing answer, so a " +
          "production-changing release is refused rather than permitted on an unmeasured reading.",
        remedy: reread,
      };
    }

    if (observation.servedSha === null) {
      return {
        ...base,
        frozen: true,
        freshness: "PRODUCTION_UNOBSERVABLE" as const,
        reason:
          "PRODUCTION COULD NOT BE ASKED WHAT IT SERVES, so nothing can be said about whether the " +
          `last healthy reading still applies (${observation.how}). This is COULD NOT TELL, and a ` +
          "check that cannot reach its subject must never print like one that did (RULING 24).",
        remedy: reread,
      };
    }

    if (!sameCommit(input.record.deployedSha, observation.servedSha)) {
      /*
       * NH289: A DIFFERENT COMMIT IS NOT NECESSARILY A DIFFERENT APPLICATION.
       * The observer's own record commit is non-shipping by the same predicate
       * the deploy filter runs, and when Netlify builds it anyway production
       * reports the observer's sha while serving the measured release's
       * application. The caller may PROVE that — served commit descends from
       * the recorded release and the whole range is non-shipping — and only
       * `EQUIVALENT` continues to the age check below. `NOT_EQUIVALENT` is a
       * real move; `CANNOT_TELL` and an absent proof freeze exactly as before,
       * so there is still no way to be permitted by leaving the question
       * unasked.
       */
      const equivalence = observation.equivalence ?? null;
      if (equivalence?.verdict !== "EQUIVALENT") {
        const evidence =
          equivalence === null
            ? "No application-equivalence proof was supplied."
            : `Equivalence: ${equivalence.verdict} — ${equivalence.how}`;
        return {
          ...base,
          frozen: true,
          freshness: "PRODUCTION_MOVED" as const,
          reason:
            `PRODUCTION MOVED UNDER THE LAST READING. It serves ${observation.servedSha}, and the ` +
            `reading was taken against ${input.record.deployedSha ?? "no commit"} at ` +
            `${input.record.observedAt ?? "an unrecorded time"}. A green answer about the commit ` +
            `production USED to serve is not an answer about the one it serves now. ${evidence}`,
          remedy: reread,
        };
      }
    }
    // The moved question is settled either way from here: the reading covers
    // this application-bearing release, whether production reports its exact
    // sha or a proven non-shipping descendant of it.
    base.applicationReleaseSha = input.record.deployedSha;

    if (observation.readingAgeHours === null || observation.readingAgeHours > observation.maxAgeHours) {
      const age =
        observation.readingAgeHours === null
          ? "carries no usable time, so it cannot be aged at all"
          : `is ${observation.readingAgeHours.toFixed(1)} hours old`;
      return {
        ...base,
        frozen: true,
        freshness: "READING_EXPIRED" as const,
        reason:
          `THE READING HAS EXPIRED. It ${age}, and the bound is ${observation.maxAgeHours} hours — ` +
          "one full cycle of the daily orchestrated run, which is the window the 2026-08-28 schema " +
          "drift hid in. A healthy answer that never expires is an answer about nothing.",
        remedy: reread,
      };
    }

    const coverage = sameCommit(input.record.deployedSha, observation.servedSha)
      ? `which is what production serves right now (${observation.how})`
      : `and production serves ${observation.servedSha} — a PROVEN non-shipping descendant of that ` +
        `release (${observation.equivalence?.how ?? "proof supplied"}), so the application is the same`;
    return {
      ...base,
      frozen: false,
      freshness: "CURRENT_FOR_PRODUCTION" as const,
      reason:
        `Release permitted. The last reading held against ${input.record.deployedSha}, ${coverage}, ` +
        `and it is ${(observation.readingAgeHours ?? 0).toFixed(1)} hours old against a bound of ` +
        `${observation.maxAgeHours}.`,
      remedy: null,
    };
  }

  const caveat =
    assessment.state === "CURRENT"
      ? ""
      : ` Integrity is ${assessment.state} and is NOT being reported as current: ${assessment.reason}`;

  return {
    ...base,
    frozen: false,
    freshness: "NOT_APPLICABLE" as const,
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
    `  freshness: ${v.freshness}` +
      (v.servedSha ? ` — production serves ${v.servedSha}` : " — production's served commit was NOT observed") +
      (v.readingAgeHours === null ? "" : `, reading ${v.readingAgeHours.toFixed(1)}h old`),
    // NH289: the served COMMIT and the application-bearing RELEASE are two
    // identities, and the log states both whenever rule 4 established which
    // release the reading covers.
    ...(v.applicationReleaseSha
      ? [`  application-bearing release: ${v.applicationReleaseSha}`]
      : []),
    `  ${v.reason}`,
  ];
  if (v.remedy) lines.push(`  REMEDY: ${v.remedy}`);
  return lines.join("\n");
}
