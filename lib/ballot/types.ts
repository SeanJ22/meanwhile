import type { GeneralLineup } from "./general-lineup.ts";
import type { AnalysesFile } from "./analyses.ts";
import type { CandidateContact } from "./candidate-contacts.ts";
import type { AzIdentityRegistry, LineupReconciliation } from "../identity/types.ts";
import type { MeasureRecord } from "./measure-records.ts";
import type { OcdId, Provenance } from "../sources/types.ts";

export interface Election {
  id: string;
  date: string;
  name: string;
  state: string;
}

export type ContestType = "CANDIDACY" | "MEASURE" | "RETENTION";

export interface Contest {
  /** True only when every candidate on this saved authoritative list was independently verified. */
  candidateListComplete?: boolean;
  /** Stable within a source, namespaced by the source. */
  id: string;
  electionId: string;
  /**
   * The division whose voters see this contest. State-level contests carry
   * the bare state identifier, which resolution derives from any division
   * at the point — the same hierarchy walk the senators use.
   */
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
  generalLineup?: GeneralLineup;
  measureAnalyses?: AnalysesFile;
  candidateFilings?: unknown;
  identityRegistry?: AzIdentityRegistry;
  lineupReconciliation?: LineupReconciliation;
  contacts?: readonly CandidateContact[];
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
