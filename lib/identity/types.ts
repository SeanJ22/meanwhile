/**
 * **THE STATEWIDE ARIZONA 2026 CANDIDATE IDENTITY LAYER — THE TYPES.**
 * (Session C3, 2026-09-01. RULING 229, RULING 206, RULING 207.)
 *
 * ## Why an identity layer exists at all
 *
 * Three layers, and the whole point of RULING 229 is that they are three:
 *
 * ```
 * ACQUISITION   the complete authoritative source universe — statewide,
 *               and with no dependency on any reader's ZIP
 * IDENTITY      THIS LAYER. one canonical statewide candidate/contest
 *               registry: candidate -> contest -> office/division -> party
 *               -> filing authority -> committee(s)
 * PROJECTION    a reader surface asking the corpus about a candidate the
 *               registry named. `stateMoneyForTarget(candidacyId)`
 * ```
 *
 * The measured defect this was built for: Arizona's certified general-election
 * lineup keys its cards `${contestId}|${nomineeName}`, the state campaign-money
 * snapshot keys its records to canonical CANDIDACY ids, and nothing joined the
 * two. `stateMoneyForTarget("ballot-az-pima:governor:hobbs-katie")` returned a
 * FILED record of $11,109,719.95; the card asked by NAME and got nothing, so
 * eighteen of twenty-two non-federal candidates at 85701 rendered the generic
 * *"We don't hold a campaign finance filing for this person"* — a sentence that
 * was false about us, over money we held.
 *
 * ## What may NOT be in here
 *
 * The registry is STATEWIDE. It is not named, keyed, scoped or filtered by
 * `az-pima`, by 85701, by 85641, or by any other reader location, and adding a
 * ZIP to it would be the exact collapse RULING 229 forbids. Reader location
 * decides applicability and DISPLAY; it never decides who exists.
 */

import type { NameForm } from "./name-forms.ts";

/** Which government layer the seat belongs to. Decides which money regime applies. */
export type AzGovernmentLevel = "FEDERAL" | "STATE" | "COUNTY" | "LOCAL";

export interface AzContestIdentity {
  /** Statewide identity key. NEVER a ZIP-scoped or county-scoped id. */
  identityId: string;
  /** The office as the state's own authorities name it. */
  office: string;
  /** The division the seat is elected from. */
  ocdId: string;
  level: AzGovernmentLevel;
  /**
   * Which authority holds the campaign-finance filings for this seat. Federal
   * seats file with the FEC and are outside the Secretary of State's regime;
   * saying so here is what keeps the projection layer from asking the wrong
   * agency and reading its silence as an absence.
   */
  financeFilingAuthority: string;
  /**
   * The canonical ballot-set contest ids this identity is served through. A
   * PROJECTION detail, listed so the bridge is auditable — never the identity.
   */
  canonicalContestIds: string[];
}

export interface AzCommitteeLink {
  /** The agency's own committee identifier. Never a name string. */
  committeeId: string;
  registeredName: string;
  /** The agency that holds it. */
  agency: string;
  /** How this committee came to be attached to this candidate. */
  basis: string;
}

export interface AzCandidateIdentity {
  /** Statewide identity key. */
  identityId: string;
  contestIdentityId: string;
  /** The name exactly as the sourcing authority published it. Never cleaned. */
  displayName: string;
  givenName: string | null;
  familyName: string | null;
  /** Every exact form this name may lawfully be compared as, with its rule. */
  nameForms: NameForm[];
  partyLabel: string | null;
  /** Which authority states this candidacy exists, and in which document. */
  candidacyAuthority: string;
  candidacySourceUrl: string | null;
  /**
   * The canonical candidacy id the reader surfaces and the finance snapshot
   * both key on, or `null` where this candidate is named by an authority that
   * the ballot set does not carry a candidacy row for.
   *
   * `null` is a real and honest value: Arizona's certified canvass stars
   * write-in primary winners who never appear on the March candidate-filing
   * list, and inventing a candidacy id for them would put a key into the
   * projection layer that no authority ever published.
   */
  canonicalCandidacyId: string | null;
  committees: AzCommitteeLink[];
}

export interface AzIdentityRegistry {
  formatVersion: 1;
  state: "AZ";
  cycle: number;
  generatedAt: string;
  generatedBy: string;
  sources: { name: string; url: string | null; readAt: string; note: string }[];
  /** Stated with their denominators. Never a bare count, never a percentage. */
  denominators: {
    contests: number;
    candidates: number;
    candidatesWithCanonicalCandidacyId: number;
    candidatesWithoutCanonicalCandidacyId: number;
    candidatesWithCommitteeIdentity: number;
    nonFederalCandidates: number;
    federalCandidates: number;
  };
  contests: AzContestIdentity[];
  candidates: AzCandidateIdentity[];
}

/**
 * The four outcomes of reconciling ONE certified-lineup nominee against the
 * registry. There is no fifth, and in particular there is no "closest".
 */
export type LineupOutcome =
  /** Contest agrees, party agrees where both stated it, exactly one candidate. */
  | "RECONCILED"
  /** More than one registry candidate in this contest shares a name form. */
  | "AMBIGUOUS_MULTIPLE_CANDIDATES"
  /** Exactly one name match, and the two authorities state different parties. */
  | "PARTY_CONFLICT"
  /** No registry candidate in this contest shares any exact name form. */
  | "NO_CANDIDATE_MATCH";

export interface LineupReconciliationRow {
  /** The card's own key, exactly as `app/ballot/page.tsx` builds it. */
  cardKey: string;
  contestId: string;
  nomineeName: string;
  nomineePartyLabel: string | null;
  outcome: LineupOutcome;
  /** Present only on RECONCILED. */
  candidateIdentityId: string | null;
  canonicalCandidacyId: string | null;
  /** The values each authority actually published, so a person can check it. */
  sourceValues: {
    canvassName: string;
    canvassParty: string | null;
    registryName: string | null;
    registryParty: string | null;
    registryCandidateIds: string[];
  };
  /** Which rule produced the shared name form, and what else was checked. */
  basis: {
    contestAgrees: boolean;
    partyChecked: boolean;
    partyAgrees: boolean | null;
    sharedNameForm: string | null;
    sharedNameFormRules: string[];
    note: string;
  };
  /**
   * ON AN UNRESOLVED ROW ONLY: one plain sentence about US, for the reader.
   * It is never a characterization of the candidate and never a figure.
   */
  readerGapSentence: string | null;
}

export interface LineupReconciliation {
  formatVersion: 1;
  state: "AZ";
  cycle: number;
  generatedAt: string;
  generatedBy: string;
  sources: { name: string; url: string | null; readAt: string; note: string }[];
  /**
   * THE POPULATION PROOF, over the WHOLE lineup rather than over examples.
   *
   * `duplicateTargetCollisions` is an ERROR unless the election model proves
   * why two nominees may resolve to one candidacy, and no such proof exists for
   * Arizona 2026: one candidacy is one person in one contest.
   */
  proof: {
    lineupContests: number;
    lineupNominees: number;
    uniquelyReconciled: number;
    ambiguous: number;
    unmatched: number;
    duplicateTargetCollisions: number;
    /** The subset the state campaign-finance regime actually applies to. */
    applicableNonFederalNominees: number;
    applicableNonFederalReconciled: number;
    applicableNonFederalUnresolved: number;
  };
  /** The agency's OWN next filing deadline, for the unresolved rows to carry. */
  agencyNextFilingDue: { reportName: string; filingPeriodEndDate: string } | null;
  rows: LineupReconciliationRow[];
}
