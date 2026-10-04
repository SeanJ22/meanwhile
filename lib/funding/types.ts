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
  /**
   * The FEC's own entity typing for the money's source, as filed (IND,
   * CAN, CCM, COM, ORG, PAC, PTY). The mechanical basis for the plain
   * label — a candidate's own money renders as exactly that (2a), derived
   * from this field and never guessed. Null on rows collected before the
   * field was captured.
   */
  entityType: string | null;
  /** FEC form line number (13A is loans from the candidate). */
  lineNumber: string | null;
  /**
   * The contributing COMMITTEE's own typing, as it filed it (item 6,
   * 2026-08-14). Carried on the Schedule A row's `contributor` object:
   * `committee_type`, `organization_type` (ORG_TP) and `designation`
   * (CMTE_DSGN). These three fields are the whole mechanical basis for the
   * plain "what kind of money" label — see lib/funding/committee-types.ts.
   * Null on individuals, and on rows collected before the fields were
   * captured (which fall to the pre-item-6 generic, honestly).
   */
  committeeType: string | null;
  organizationType: string | null;
  designation: string | null;
  /**
   * The contributing COMMITTEE's own FEC committee id (Schedule A's
   * `contributor_id`), when the money came from a registered committee.
   * Null for individuals and for rows collected before the field was
   * captured. This id is the ONLY basis for the second hop (item 3,
   * 2026-08-15): a joint-fundraising committee is itself an FEC filer with
   * its own books, and "who gives to the Booker Victory Fund" is answered
   * by that committee's own Schedule A — never by inference from this one.
   */
  contributorCommitteeId: string | null;
}

/**
 * The second hop (item 3, 2026-08-15, the author's design) — a contributing
 * committee's OWN top itemized receipts, one level down.
 *
 * A joint-fundraising committee is not a donor in the ordinary sense: it is
 * a pooled raise that splits proceeds among its participants by a filed
 * formula. So the reader who wants to know where a $1.1M "transfer" came
 * from is asking about a different committee's books, and this record is
 * that committee's books — fetched from the FEC by committee id, rendered
 * under the fund's OWN name, never relabeled as the candidate's donors.
 *
 * FEC_CONTRIBUTOR class, so `ripcord.fecContributorDisplay` governs it
 * exactly as it governs the first hop: pulling the ripcord empties this
 * data at the accessor, not in CSS.
 */
export interface SecondHopCommittee {
  dataClass: "FEC_CONTRIBUTOR";
  /** The FEC committee id — the join key, and the cache key for the row. */
  committeeId: string;
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
  receipts: number;
  disbursements: number;
  cashOnHand: number;
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
  /**
   * The second hop, keyed by committee id (item 3). Joined to the first hop
   * by `ContributionRow.contributorCommitteeId` at render time — the same
   * committee funding three candidates is fetched and stored ONCE, and the
   * distinctness invariant applies: two distinct committee ids must never
   * carry identical books (guarded in tests/funding.test.ts, the D40
   * family). Absent on snapshots written before the hop existed.
   */
  secondHop?: SecondHopCommittee[];
}
