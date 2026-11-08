import type { BallotResultFacts } from "../ballot/election-results.ts";

/** Only checked result values and identity indexes; ballots and source documents stay out of this feed. */
export interface StateResultFeed {
  readonly formatVersion: 1;
  readonly state: string;
  readonly ballotVersion: string | null;
  readonly checkedAt: string;
  readonly fingerprint: string;
  readonly facts: BallotResultFacts;
  readonly contestIds?: Readonly<Record<string, readonly string[]>>;
}

export const RESULT_STATES = "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC AS GU MP PR VI".split(" ");
export const isResultState = (state: string): boolean => RESULT_STATES.includes(state);
