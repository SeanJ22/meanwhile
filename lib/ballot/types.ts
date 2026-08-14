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
  /** Seats to vote for — mandatory, not an edge case (NH multi-member). */
  voteFor: number;
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

export interface BallotSet {
  election: Election;
  contests: Contest[];
  candidacies: Candidacy[];
  measures: Measure[];
  absences: BallotAbsence[];
  /**
   * Honest statements of OUR gaps — contests known to exist that are not yet
   * curated or not yet mappable to a division. Rendered distinctly, because
   * a silently missing contest reads as "nothing local is on your ballot",
   * which the coverage-honesty rule forbids. Distinct from `absences`, which
   * are the *authority's* statements.
   */
  coverageNotes?: string[];
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
