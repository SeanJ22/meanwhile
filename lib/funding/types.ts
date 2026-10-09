/**
 * The funding corpus: FEC campaign-finance data at the FUNDING evidence tier.
 * It renders beside a candidate, never merges into the statements or votes
 * corpora, and never feeds any score or ordering. Every record carries its
 * data class, so pulling a ripcord is a filter:
 *
 * - `FEC_COMMITTEE`: committee-level totals; not behind a ripcord.
 * - `FEC_CONTRIBUTOR`: private source receipts. Public DTOs retain named
 *   organizations only, behind `ripcord.fecContributorDisplay`, and unreachable from the
 *   aggregation/export path. Subject to the 52 U.S.C. § 30111(a)(4)
 *   commercial-use restriction on contributor information.
 */

import type { Provenance } from "../sources/types.ts";

export type FundingDataClass = "FEC_COMMITTEE" | "FEC_CONTRIBUTOR";

/** One itemized receipt, exactly as filed — never characterized. */
export interface ContributionRow {
  dataClass: "FEC_CONTRIBUTOR";
  kind: "INDIVIDUAL" | "COMMITTEE_OR_ORGANIZATION";
  contributorName: string;
  amount: number;
  receiptDate: string | null;
  city: string | null;
  state: string | null;
  /**
   * The FEC's own entity typing for the money's source, as filed (IND, CAN,
   * CCM, COM, ORG, PAC, PTY). Null on rows collected before it was captured.
   */
  entityType: string | null;
  /** FEC form line number (13A is loans from the candidate). */
  lineNumber: string | null;
  /**
   * The contributing committee's own typing as filed on the Schedule A
   * `contributor` object: `committee_type`, `organization_type` (ORG_TP) and
   * `designation` (CMTE_DSGN); see lib/funding/committee-types.ts. Null on
   * individuals and on rows collected before capture.
   */
  committeeType: string | null;
  organizationType: string | null;
  designation: string | null;
  /**
   * The contributing committee's own FEC id (Schedule A `contributor_id`),
   * when the money came from a registered committee: the only basis for the
   * second hop. Null for individuals and older rows.
   */
  contributorCommitteeId: string | null;
  /** Native filing identity, for amendment reconciliation before grouping. */
  transactionId?: string | null;
  filingId?: string | null;
  sourceUrl?: string | null;
  /** Original evidence observation, retained when an optional ledger refresh fails. */
  sourceObservedAt?: string;
}

/**
 * The second hop: a contributing committee's own top itemized receipts, one
 * level down, fetched by committee id and rendered under its own name, never
 * as the candidate's donors. FEC_CONTRIBUTOR class, governed by
 * `ripcord.fecContributorDisplay` at the accessor.
 */
export interface SecondHopCommittee {
  dataClass: "FEC_CONTRIBUTOR";
  /** The FEC committee id — the join key, and the cache key for the row. */
  committeeId: string;
  cycle?: number;
  /** The committee's name exactly as it is registered. */
  name: string;
  /** Its own filed typing, so the pills read from the committee's filing. */
  committeeType: string | null;
  organizationType: string | null;
  designation: string | null;
  /** Its own top itemized receipts, as filed, largest first. */
  topContributions: ContributionRow[];
  /** Total receipts the committee itself reported for the cycle, if filed. */
  receipts: number | null;
  provenance: Provenance;
}

export interface CommitteeTotals {
  receipts: number | null;
  disbursements: number | null;
  cashOnHand: number | null;
  individualItemized: number | null;
  individualUnitemized: number | null;
  /**
   * Unitemized individual dollars ($200 or less per donor in the cycle)
   * divided by the filing's itemized plus unitemized individual dollars.
   * Null when either filed line is unrecorded or their sum is zero.
   */
  smallDonorShare: number | null;
  coverageEndDate: string | null;
}

export interface FundingCandidate {
  dataClass: "FEC_COMMITTEE";
  fecCandidateId: string;
  name: string;
  state: string;
  office: "H" | "S";
  district: string | null;
  /** Every app-side id this record answers for — roster officeholder ids
   *  (`congress:B001288`), ballot candidacy ids, and lineup nominee keys. */
  targetKeys: string[];
  matchRoutes: string[];
  principalCommitteeId: string | null;
  /** Every source-confirmed authorized committee for this candidate and cycle. */
  principalCommitteeIds?: string[];
  /** The two-year period the totals cover — stated, never assumed to be
   *  the current cycle (a dormant off-cycle committee's latest filing may
   *  be an earlier cycle, and the surface says which). */
  cycle: number;
  totals: CommitteeTotals;
  topContributions: ContributionRow[];
  provenance: Provenance;
  acquisition?: { totalsComplete: boolean; contributionsComplete: boolean; checkedAt: string };
}

/** An earned "no money reported" — the search that came back empty,
 *  recorded with its reason, never rendered as silence. */
export interface FundingAbsence {
  targetKey: string;
  displayName: string;
  reason: string;
  checkedAt: string;
  searchUrl: string | null;
}

export interface FundingSnapshot {
  formatVersion: 1;
  fetchedAt: string;
  cycle: number;
  matchReport: {
    rosterMatched: number;
    rosterTotal: number;
    ballotMatched: number;
    ballotTotal: number;
  };
  candidates: FundingCandidate[];
  absences: FundingAbsence[];
  /**
   * The second hop, keyed by committee id, joined to the first hop by
   * `ContributionRow.contributorCommitteeId` at render time. Two distinct
   * committee ids must never carry identical books.
   */
  secondHop?: SecondHopCommittee[];
  /** Attempt order for the standing collector; never replaces a source observation date. */
  refreshAttempts?: Record<string, string>;
}
