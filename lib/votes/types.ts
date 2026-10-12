/**
 * The votes corpus — how members actually voted, from the chambers' own
 * published roll calls. RECORD-tier evidence that never merges with the
 * STATEMENT-tier corpus in `lib/corpus/`.
 *
 * Never characterized by us: titles are official words, positions are the
 * chamber's recorded value mapped onto four states, and no record carries a
 * score, rating, rank, match, fit, grade, alignment or recommendation key.
 *
 * Runtime facts are read from a proof-validated promoted projection; no
 * request fetches a publisher live.
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
   * How many chamber identifiers matched the roster, out of how many; a silent
   * zero-match join must be visible.
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
