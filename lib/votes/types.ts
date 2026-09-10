/**
 * The votes corpus — how members actually voted, from the chambers' own
 * published roll calls (5).
 *
 * **Votes and statements are separate corpora and never merge** — this store
 * holds RECORD-tier evidence (clerk.house.gov and senate.gov roll-call XML);
 * `lib/corpus/` holds STATEMENT-tier snapshots. A join between them is how a
 * summary starts blending rhetoric into record.
 *
 * **Never characterized by us.** The title is the chamber's or the bill's
 * official words; the position is the chamber's recorded value mapped onto
 * four states and nothing else. No record here may carry a score, rating,
 * rank, match, fit, grade, alignment or recommendation key —
 * `tests/votes.test.ts` holds that, the same guard family as candidates and
 * measures. The colors on the surface state the member's vote, never
 * approval.
 *
 * Runtime facts are read from a proof-validated promoted projection. The
 * bundled snapshot is first-seed material only; it is never a store-error
 * fallback and no request fetches a publisher live.
 */

/** Normalized Reader states; UNKNOWN preserves an unclassified publisher row. */
export type VotePosition = "YES" | "NO" | "ABSTAIN" | "PRESENT" | "NOT_VOTING" | "UNKNOWN";

export interface RollCallVote {
  /** `house:119-2:283` / `senate:119-2:231`. */
  id: string;
  chamber: "house" | "senate";
  congress: number;
  session: number;
  rollNumber: number;
  date: string;
  /**
   * What was being voted on, leading with official words: the bill's official
   * (short) title where one exists, else the chamber's own question/title
   * line. Never written or paraphrased by us.
   */
  title: string;
  /** Where the title came from — the audit trail for "sourced, not written". */
  titleSource: "BILL_TITLE" | "CHAMBER_QUESTION";
  /** The chamber's question line ("On Passage", "On Cloture..."). */
  question: string;
  /** The bill/measure designation ("H.R. 1234", "S. 5271"), where one exists. */
  legisNum: string | null;
  /** The chamber's stated result, with the tally: "Passed 218–210". */
  result: string;
  /** The bill's Congress.gov page (hosts the CRS summary), where one exists. */
  billUrl: string | null;
  /** The roll call itself, on the chamber's own site. */
  rollCallUrl: string;
  retrievedAt: string;
}

export interface MemberVote {
  /** Roster id: `congress:<bioguide>`. */
  officeholderId: string;
  voteId: string;
  position: VotePosition;
}

export interface VotesSnapshot {
  generatedAt: string;
  congress: number;
  session: number;
  /** The bounded window this snapshot covers, stated. */
  window: { houseRolls: number[]; senateRolls: number[] };
  /**
   * The identifier-set comparison, per the standing rule: how many chamber
   * identifiers matched the roster, out of how many. A silent zero-match
   * join is the cd:0 failure again.
   */
  identifierMatch: {
    houseMatched: number;
    houseTotal: number;
    senateMatched: number;
    senateTotal: number;
  };
  votes: RollCallVote[];
  positions: MemberVote[];
}
