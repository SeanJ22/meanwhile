import type { Provenance } from "../sources/types.ts";
import { currentGenericBallotProjection } from "./generic-projection.ts";

export interface LineupNominee {
  provenance?: Provenance;
  name: string;
  partyLabel: string;
  note: string | null;
}

export interface LineupContest {
  contestId: string;
  nominees: LineupNominee[];
}

export interface GeneralLineup {
  curatedAt: string;
  canvass: {
    title: string;
    url: string;
    issuedBy: string;
    reportDate: string;
    readAt: string;
    readNote: string;
  };
  note: string;
  contests: LineupContest[];
}

export function getGeneralLineup(state: string): GeneralLineup | null {
  return Object.values(currentGenericBallotProjection(state).ballots).find(ballot => ballot.generalLineup)?.generalLineup ?? null;
}

/** Null when the ballot projection holding it cannot be read in this process. */
export function lineupForContest(state: string, contestId: string): LineupContest | null {
  let records: readonly LineupContest[] | undefined;
  try {
    records = getGeneralLineup(state)?.contests;
  } catch {
    return null;
  }
  return records?.find(record => record.contestId === contestId) ?? null;
}
