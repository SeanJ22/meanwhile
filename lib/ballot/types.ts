import type { GeneralLineup } from "./general-lineup.ts";
import type { AnalysesFile } from "./analyses.ts";
import type { CandidateContact } from "./candidate-contacts.ts";
import type { AzCandidateIdentity, AzContestIdentity, LineupReconciliation } from "../identity/types.ts";
import type { MeasureRecord } from "./measure-records.ts";
import type { OcdId, Provenance } from "../sources/types.ts";
import type { RetrievalEvidence } from "../civic-data/types.ts";

export interface Election {
  id: string;
  date: string;
  name: string;
  state: string;
}

export type ContestType = "CANDIDACY" | "MEASURE" | "RETENTION";

export interface Contest {
  /** Earlier source keys for this same election, office and division. */
  aliases?: readonly string[];
  sources?: readonly Provenance[];
  identity?: Pick<AzContestIdentity, "identityId" | "level" | "financeFilingAuthority">;
  filing?: { id: string; publishedTitle: string; provenance: Provenance };
  /** True only when every candidate on this saved authoritative list was independently verified. */
  candidateListComplete?: boolean;
  /** Stable within a source, namespaced by the source. */
  id: string;
  electionId: string;
  ocdId: OcdId;
  divisionVintage: string;
  title: string;
  type: ContestType;
  measureTextUrl?: string;
  /** Seats to vote for; multi-member seats are ordinary. */
  voteFor: number | null;
  termYears: number | null;
  scopeNote: string | null;
  provenance: Provenance;
}

export interface Candidacy {
  /** Every previously published candidacy and card key for this person in this race. */
  aliases?: readonly string[];
  sources?: readonly Provenance[];
  personId?: string;
  /** Historical running-mate keys remain distinct from the lead's person aliases. */
  runningMateAliases?: readonly string[];
  /** The ballot choice is joint; each member retains their own person identity. */
  ticket?: {
    id: string;
    runningMate: Candidacy & { office?: string };
    provenance: Provenance;
  };
  identity?: Omit<AzCandidateIdentity, "displayName" | "givenName" | "familyName" | "partyLabel" | "canonicalCandidacyId" | "contestIdentityId">;
  filing?: {
    id: string;
    publishedName?: string;
    filingDate?: string;
    signaturesFiled?: number;
    provenance: Provenance;
    heldIdentityJoin?: { rule: string; matchedForm: string; heldCandidacyId: string; heldPublishedName: string } | null;
  };
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  /** Display only — never joined on, never inferred from. */
  partyLabel: string | null;
  slogan: string | null;
  /** True only where the filing itself states incumbency; null is unknown, not false. */
  incumbent: boolean | null;
  /** The candidate's own site, only as stated in the filing. Never found. */
  websiteUrl: string | null;
  provenance: Provenance;
}

export interface Measure {
  id: string;
  contestId: string;
  /** The publisher's designation, when held; never generated from list order. */
  officialNumber?: string;
  /** The official question text, verbatim. Never paraphrased. */
  questionText: string;
  /** The official interpretive statement or analysis, verbatim, if any. */
  officialStatement: string | null;
  provenance: Provenance;
}

export interface BallotAbsence {
  ocdId: OcdId;
  divisionVintage: string;
  statement: string;
  provenance: Provenance;
}

export interface CandidacyRemoval {
  /** The candidacy id it had — the join key that must not be re-minted. */
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel: string | null;
  slogan: string | null;
  status: "REMOVED_FROM_FILING";
  lastListed: Provenance;
  absentFrom: Provenance;
  /** The first run that found it absent, `YYYY-MM-DD`. Stable across runs. */
  firstAbsentOn: string;
  statement: string;
}

export interface BallotSet {
  /** Pairings stated by the election authority, never inferred from party. */
  candidateTickets?: readonly { id: string; leadCandidacyId: string;
    runningMate: Candidacy & { office?: string }; provenance: Provenance }[];
  sourceAggregates?: readonly {
    id: string;
    sourceId: string;
    scope: string;
    rawDocumentCount: number;
    retrieval: RetrievalEvidence;
  }[];
  generalLineup?: GeneralLineup;
  measureAnalyses?: AnalysesFile;
  filingCandidacies?: Candidacy[];
  lineupReconciliation?: LineupReconciliation;
  contacts?: readonly CandidateContact[];
  heldContests?: readonly HeldBallotContest[];
  measureRecords?: readonly MeasureRecord[];
  election: Election;
  contests: Contest[];
  candidacies: Candidacy[];
  measures: Measure[];
  absences: BallotAbsence[];
  removals?: CandidacyRemoval[];
  coverageNotes?: string[];
  /** Source notes with explicit applicability; never widened from a county
   * or one measured ZIP to every reader of a statewide source. */
  scopedCoverageNotes?: readonly ScopedBallotCoverageNote[];
}

export interface HeldBallotContest extends Pick<Contest, "id" | "electionId" | "ocdId" | "title" | "provenance"> {
  readonly reason: string;
}

export interface ScopedBallotCoverageNote {
  readonly text: string;
  readonly scope: { readonly kind: "DIVISIONS"; readonly ids: readonly string[] }
    | { readonly kind: "ZIPS"; readonly ids: readonly string[] };
}

export interface BallotSource {
  readonly name: string;
  fetch(): Promise<unknown[]>;
  normalize(raw: unknown[]): BallotSet;
  upsert(set: BallotSet): Promise<{ inserted: number; updated: number }>;
}
