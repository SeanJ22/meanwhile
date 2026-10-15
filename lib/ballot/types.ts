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
  // The bare state division makes statewide contests match every resolved place in that state.
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

export interface MeasureSourceReference {
  sourceUrl: string;
  sourceHash: string;
  retrievedAt: string;
  publisher: string;
  vault: { key: string; byteLength: number; contentType: string };
  originals?: MeasureSourceReference[];
}

export interface BallotSourceCorpusReference {
  format: "ballot-source-corpus@1";
  state: string;
  electionId: string;
  sourceHash: string;
  documentCount: number;
  reviewedAt: string;
  reviewedBy: string;
  vault: { key: string; byteLength: number; contentType: "application/x-ndjson" };
}

export interface MeasureVoterGuide extends MeasureSourceReference {
  summary?: string;
  fiscalImpact?: string;
  fiscalImpactSource?: MeasureSourceReference;
  passageThreshold?: string;
  passageThresholdSource?: MeasureSourceReference;
  argumentsFor?: string[];
  argumentsAgainst?: string[];
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
  officialText?: MeasureSourceReference;
  voterGuide?: MeasureVoterGuide;
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
  sourceCorpus?: BallotSourceCorpusReference;
  sourceAuthorities?: readonly MeasureSourceReference[];
  heldContests?: readonly HeldBallotContest[];
  measureRecords?: readonly MeasureRecord[];
  election: Election;
  contests: Contest[];
  candidacies: Candidacy[];
  measures: Measure[];
  absences: BallotAbsence[];
  removals?: CandidacyRemoval[];
  coverageNotes?: string[];
  // Local coverage notes must not be widened to every reader of the state source.
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
