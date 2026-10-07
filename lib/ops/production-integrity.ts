/** Production-integrity status for Admin and post-deploy observation.
 * Status does not block software releases.
 */

/** Whether the deployed application and production database agree. A missing credential and a check of a different SHA are never green. */
export const INTEGRITY_STATES = [
  /** Checked against the exact deployed SHA, and it held. */
  "CURRENT",
  /** The last check held, but it was taken against a DIFFERENT SHA than the one now in question. */
  "STALE_HEALTHY",
  /** A check ran and failed. */
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

/** The durable integrity record; `deployedSha` is what makes a stale green detectable. */
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

/** Match full and historical abbreviated commit IDs. */
export function sameCommit(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  if (a === b) return true;
  if (a.length < 7 || b.length < 7) return false;
  return a.startsWith(b) || b.startsWith(a);
}

export interface IntegrityAssessment {
  readonly state: IntegrityState;
  readonly failureClass: FailureClass | null;
  /** Why this state, in one sentence. */
  readonly reason: string;
  /** The SHA the assessment is ABOUT, which may differ from the one observed. */
  readonly aboutSha: string | null;
  readonly observedSha: string | null;
}

/** Assess an observation against the commit whose status is requested. */
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

/** Maximum age of a reusable post-deploy observation. */
export const MAX_READING_AGE_HOURS = 24;
