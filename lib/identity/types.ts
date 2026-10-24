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
   * Which authority holds the campaign-finance filings for this seat, so the
   * projection never asks the wrong agency and reads its silence as absence.
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
   * both key on, or `null` where the ballot set carries no candidacy row for
   * this candidate (e.g. a write-in primary winner). None is invented.
   */
  canonicalCandidacyId: string | null;
  committees: AzCommitteeLink[];
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
  /** On an unresolved row only: one plain sentence about us, never about the candidate. */
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
   * The population proof over the whole lineup. `duplicateTargetCollisions` is
   * an error: one candidacy is one person in one contest.
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
