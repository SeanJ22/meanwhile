import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The certified general-election lineup (6a): each party's primary winner
 * per the state's own canvass, read from the canvass document and cited to
 * it. The filing-list fallback retires for any contest with a lineup entry
 * — a certified nominee list and a filed-candidate list are different
 * claims, and the certified one wins the moment it exists.
 *
 * `tests/ballot.test.ts` guards the shape (no ranking keys; every file
 * cites its canvass) alongside the other committed ballot data.
 */

export interface LineupNominee {
  name: string;
  partyLabel: string;
  /** A fact from the canvass worth stating ("won as a write-in"). */
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

let cache: GeneralLineup | null = null;

/** Null when no lineup file exists — the filing list then stands. */
export function getGeneralLineup(): GeneralLineup | null {
  if (cache) return cache;
  try {
    cache = JSON.parse(
      readFileSync(
        join(process.cwd(), "data", "states", "az", "ballot", "az-general-lineup-2026.json"),
        "utf8",
      ),
    ) as GeneralLineup;
    return cache;
  } catch {
    return null;
  }
}

export function lineupForContest(contestId: string): LineupContest | null {
  return (
    getGeneralLineup()?.contests.find((c) => c.contestId === contestId) ?? null
  );
}
