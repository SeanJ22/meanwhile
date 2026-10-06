import type { MeasureRecord } from "./measure-records.ts";
import type { OcdId, Provenance } from "../sources/types.ts";

/**
 * The ballot record shapes — S2, and the spine D08's research proved out:
 * election → ballot-style area (OCD-IDs) → contest → candidacy | measure.
 *
 * **The never-tells-anyone-how-to-vote constraint applies to every field
 * here.** No record may carry a score, rank, rating, match, fit, grade,
 * alignment or recommendation key — `tests/neutrality-guards.test.ts` holds
 * that against these shapes the same way it holds the candidate corpus.
 * Candidates render in ballot order where the clerk's drawing was machine-
 * readable, alphabetically by surname otherwise, and in no other order.
 *
 * `partyLabel` and `slogan` are carried because the filing publishes them
 * and hiding them would be less honest, not more. Display only; nothing may
 * infer a position from either.
 */

export interface Election {
  /** `<state>-<date>`, e.g. `nj-2026-11-03`. */
  id: string;
  date: string;
  name: string;
  state: string;
}

export type ContestType = "CANDIDACY" | "MEASURE" | "RETENTION";

export interface Contest {
  /** Stable within a source, namespaced by the source. */
  id: string;
  electionId: string;
  /**
   * The division whose voters see this contest. State-level contests carry
   * the bare state identifier, which resolution derives from any division
   * at the point — the same hierarchy walk the senators use.
   */
  ocdId: OcdId;
  /** The vintage of the division vocabulary the id was written against. */
  divisionVintage: string;
  /** The office or question title, as the filing titles it. */
  title: string;
  type: ContestType;
  /** The official measure text link can publish before the document is acquired. */
  measureTextUrl?: string;
  /** Seats to vote for — mandatory, not an edge case (NH multi-member). */
  voteFor: number | null;
  /** Term in years, where the filing states it. */
  termYears: number | null;
  /**
   * Free-text scope note read off the filing where the division alone
   * under-describes it — e.g. a regional school board whose seats are
   * allocated per municipality.
   */
  scopeNote: string | null;
  provenance: Provenance;
}

export interface Candidacy {
  id: string;
  contestId: string;
  /** As filed: surname with suffix, and given names. */
  familyName: string;
  givenName: string;
  /** Display only — never joined on, never inferred from. */
  partyLabel: string | null;
  /** The filed slogan (NJ carries these as first-class filing fields). */
  slogan: string | null;
  /**
   * True only where the filing itself states incumbency. The Morris County
   * clerk's file does not, so every 2026 row is null — unknown, not false.
   */
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

/**
 * A statement of absence, from the authority's own publication. "No local
 * election" is a fact a reader needs, and it must be citable exactly like a
 * contest — an empty list without one of these reads as our gap.
 */
export interface BallotAbsence {
  ocdId: OcdId;
  divisionVintage: string;
  /** What is absent, in the authority's own words where possible. */
  statement: string;
  provenance: Provenance;
}

/**
 * A candidacy the authority's CURRENT filing no longer lists, retained with
 * its evidence rather than deleted (2026-09-02).
 *
 * The Morris County Clerk's 1 September revision listed 147 general-election
 * candidates where the 21 August revision listed 148; Lana Leguía (CD-7) was
 * the difference, and the clerk's page said nothing about it. Deleting the
 * row would have been silence about a real change; keeping her in
 * `candidacies` would have rendered a person the clerk no longer lists as
 * running. So the record is kept, keyed on the id every reaction, card and
 * link already hangs off, and it carries BOTH documents — the one that listed
 * the person and the later one that does not. Two citations, or it is not
 * evidence of a removal.
 *
 * Never rendered as a candidate. The generator also writes the same fact as a
 * `BallotAbsence` on the contest's division, which is the surface a reader
 * sees it on.
 */
export interface CandidacyRemoval {
  /** The candidacy id it had — the join key that must not be re-minted. */
  id: string;
  contestId: string;
  familyName: string;
  givenName: string;
  partyLabel: string | null;
  slogan: string | null;
  status: "REMOVED_FROM_FILING";
  /** The document that listed the candidacy, and the day it was read. */
  lastListed: Provenance;
  /** The later document that does not, and the day it was read. */
  absentFrom: Provenance;
  /** The first run that found it absent, `YYYY-MM-DD`. Stable across runs. */
  firstAbsentOn: string;
  /** What the authority says about the change, or that it says nothing. */
  statement: string;
}

export interface BallotSet {
  /** Plain-language records carried by the civic-data ballot projection. */
  measureRecords?: readonly MeasureRecord[];
  election: Election;
  contests: Contest[];
  candidacies: Candidacy[];
  measures: Measure[];
  absences: BallotAbsence[];
  /** Candidacies the current filing no longer lists, with their evidence. */
  removals?: CandidacyRemoval[];
  /**
   * Honest statements of OUR gaps — contests known to exist that are not yet
   * curated or not yet mappable to a division. Rendered distinctly, because
   * a silently missing contest reads as "nothing local is on your ballot",
   * which the coverage-honesty rule forbids. Distinct from `absences`, which
   * are the *authority's* statements.
   */
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

/**
 * The contract a ballot source implements — deliberately parallel to
 * `MeetingSource`, so the D08 national-feed question is a source swap later,
 * not a rewrite. Today's only implementation reads a committed curated file;
 * a licensed feed implements the same three functions.
 */
export interface BallotSource {
  readonly name: string;
  /** Read the upstream — for the curated source, the committed file. */
  fetch(): Promise<unknown[]>;
  /** Validate and shape. Reports counts; a zero is loud, never silent. */
  normalize(raw: unknown[]): BallotSet;
  upsert(set: BallotSet): Promise<{ inserted: number; updated: number }>;
}
