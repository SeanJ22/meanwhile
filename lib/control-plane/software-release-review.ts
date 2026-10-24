/** Software-release log rows: owner review decisions partitioned by staging SHA, and post-deploy integrity readings in the fixed `production-integrity` partition. Append-only; joins nothing civic. */

import type { IntegrityRecord } from "../ops/production-integrity.ts";

export const SOFTWARE_RELEASE_REVIEW_FORMAT_VERSION = 1;

/** The three owner decisions a review section can carry. */
export const REVIEW_DECISIONS = ["APPROVE", "NEEDS_CHANGES", "DISCARD"] as const;

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
  "POST_DEPLOY_INTEGRITY",
] as const;
export type ReviewRecordKind = (typeof REVIEW_RECORD_KINDS)[number];

export const PRODUCTION_INTEGRITY_LOG_KEY = "production-integrity" as const;

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
  /**
   * Present only on `POST_DEPLOY_INTEGRITY`. Older decision rows predate this
   * field, so absence is the review-record case; it is never interpreted as an
   * empty integrity reading.
   */
  readonly productionIntegrity?: IntegrityRecord;
  /** The trusted run that took the reading, never a credential or free text. */
  readonly sourceRunId?: string | null;
}

export type ProductionIntegrityLogRecord = SoftwareReleaseReviewRecord & {
  readonly decision: "POST_DEPLOY_INTEGRITY";
  readonly section: null;
  readonly raisedStateChoice: null;
  readonly feedback: null;
  readonly composedFrom: null;
  readonly productionIntegrity: IntegrityRecord;
};

export function isProductionIntegrityLogRecord(
  row: SoftwareReleaseReviewRecord,
): row is ProductionIntegrityLogRecord {
  return row.decision === "POST_DEPLOY_INTEGRITY" && row.productionIntegrity !== undefined;
}
