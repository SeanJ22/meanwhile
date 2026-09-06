/**
 * **SOFTWARE RELEASE REVIEW RECORDS — the one additive table of Admin Pass B.**
 * (2026-09-06.)
 *
 * The owner reviews a SOFTWARE BUILD — the exact staging SHA Prompt 3's
 * release manifest names — section by section, and records what he decided.
 * This module is the record's shape and nothing else: no logic, no reader, no
 * civic fact. The rows live in the control plane's `software_release_reviews`
 * append-only log, keyed by the staging SHA the row was made against, so a new
 * SHA starts with no rows at all and no decision ever carries forward. Nothing
 * is updated or deleted; a later decision supersedes an earlier one for gating
 * and the earlier one stays as history.
 *
 * It joins nothing. No OCD id, no work item, no readiness cell, no promotion
 * record, no civic fact: a row here says what the owner thought of a build,
 * and the build is named by its SHA and its Netlify deploy id.
 */

export const SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION = 1;

/** The three owner decisions a review section can carry. */
export const REVIEW_DECISIONS = ["APPROVE", "NEEDS_CHANGES", "DISCARD"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

/** The Raised State variants the owner chooses among — a recorded choice, never an activation. */
export const RAISED_STATE_CHOICES = ["A_SOFT_LIFT", "B_MATERIAL_LIFT", "C_DEEP_LIFT"] as const;
export type RaisedStateChoice = (typeof RAISED_STATE_CHOICES)[number];

/**
 * Every kind of row the log holds. `MANIFEST_OBSERVED` is not a decision: it
 * is the Admin's own note that it saw a manifest for this SHA at this time,
 * which is what lets the page say "last observed" when the manifest is
 * unreachable. It never counts toward any gate.
 */
export const REVIEW_RECORD_KINDS = [
  ...REVIEW_DECISIONS,
  "FEEDBACK_ONLY",
  "RAISED_STATE_CHOICE",
  "OWNER_APPROVED_FOR_PRODUCTION",
  "MANIFEST_OBSERVED",
] as const;
export type ReviewRecordKind = (typeof REVIEW_RECORD_KINDS)[number];

export interface SoftwareReleaseReviewRecord {
  readonly formatVersion: typeof SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION;
  /** The row id, also the append record id: `<stagingSha>:<kind>:<section or ->:<createdAt>`. */
  readonly id: string;
  /** The exact staging SHA displayed to the owner at the moment of the click; the log key. */
  readonly stagingSha: string;
  /** The Netlify deploy id the manifest carried for that SHA, or null when it carried none. */
  readonly deployId: string | null;
  /** The review section id (`map-movement` … `raised-state`); null for the composite and for an observation. */
  readonly section: string | null;
  readonly decision: ReviewRecordKind;
  readonly raisedStateChoice: RaisedStateChoice | null;
  readonly feedback: string | null;
  /** The authenticated owner session that wrote it (`session:<sid>`), or `manifest-reader` for an observation. */
  readonly actor: string;
  /** OWNER_APPROVED_FOR_PRODUCTION only: the ids of the rows it was composed from — the five section approvals and the variant choice. */
  readonly composedFrom: readonly string[] | null;
  /** The server clock at the append. */
  readonly createdAt: string;
  /** What the manifest said at that moment, for the audit. */
  readonly manifest: {
    readonly prompt3Status: string | null;
    readonly reviewState: string | null;
    readonly stagingBoundary: string | null;
    readonly reportedAt: string | null;
  };
}
