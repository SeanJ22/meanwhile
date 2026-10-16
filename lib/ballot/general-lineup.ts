import { currentAzBallotProjection } from "../civic-data/manual-read-models.ts";

export interface LineupNominee {
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

export function getGeneralLineup(): GeneralLineup | null {
  return currentAzBallotProjection().generalLineup;
}

/** Null when the ballot projection holding it cannot be read in this process. */
export function lineupForContest(contestId: string): LineupContest | null {
  let records: readonly LineupContest[] | undefined;
  try {
    records = getGeneralLineup()?.contests;
  } catch {
    return null;
  }
  return records?.find(record => record.contestId === contestId) ?? null;
}
