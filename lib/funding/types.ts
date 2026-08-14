/**
 * The funding corpus (D34) — FEC campaign-finance data, snapshot-committed,
 * FUNDING evidence tier. It renders beside a candidate, never merges into
 * the statements or votes corpora, and never feeds any score or ordering.
 *
 * Every record carries its data class — the ripcord doctrine's provenance
 * tag, so pulling a ripcord is a filter, never a migration or a hunt:
 *
 * - `FEC_COMMITTEE` — committee-level totals. Public summary figures; not
 *   behind a ripcord.
 * - `FEC_CONTRIBUTOR` — itemized receipts as filed (names). Reader-facing
 *   display ONLY, behind `ripcord.fecContributorDisplay`, and structurally
 *   unreachable from the aggregation/export path (guard-tested in
 *   tests/funding.test.ts). The open question is D23 — the 52 U.S.C.
 *   § 30111(a)(4) commercial-use restriction on contributor information;
 *   counsel closes it, nobody else.
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
}

export interface CommitteeTotals {
  receipts: number;
  disbursements: number;
  cashOnHand: number;
  individualItemized: number;
  individualUnitemized: number;
  /**
   * Unitemized individual contributions (under $200 total per donor, the
   * FEC's own itemization threshold) divided by total receipts. Null when
   * nothing has been raised. The surface states this method in plain words.
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
  /** The two-year period the totals cover — stated, never assumed to be
   *  the current cycle (a dormant off-cycle committee's latest filing may
   *  be an earlier cycle, and the surface says which). */
  cycle: number;
  totals: CommitteeTotals;
  topContributions: ContributionRow[];
  provenance: Provenance;
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
}
