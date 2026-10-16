import type { MemberVote } from "./types.ts";



export interface PartyTally {
  /** The roster's own label, pluralized mechanically ("Democrats"). */
  party: string;
  yes: number;
  no: number;
}

/** Parse the chamber's recorded yes–no tally off the result string
 *  ("Passed 218–210"). Null when the result carries no tally. */
export function parseResultTally(
  result: string,
): { yes: number; no: number } | null {
  const match = /(\d+)–(\d+)\s*$/.exec(result);
  return match ? { yes: Number(match[1]), no: Number(match[2]) } : null;
}

export function partyBreakdownFor(
  voteId: string,
  result: string,
  positions: readonly MemberVote[],
  partyByOfficeholderId: ReadonlyMap<string, string | null>,
): PartyTally[] | null {
  const expected = parseResultTally(result);
  if (!expected) return null;

  const tallies = new Map<string, { yes: number; no: number }>();
  for (const position of positions) {
    if (position.voteId !== voteId) continue;
    if (position.position !== "YES" && position.position !== "NO") continue;
    const party = partyByOfficeholderId.get(position.officeholderId);
    // A YES/NO from a member whose party we cannot source makes the
    // breakdown incomplete — the sum check below will refuse it.
    const key = party ?? "(unsourced)";
    const tally = tallies.get(key) ?? { yes: 0, no: 0 };
    if (position.position === "YES") tally.yes++;
    else tally.no++;
    tallies.set(key, tally);
  }

  if (tallies.has("(unsourced)")) return null;

  let yesSum = 0;
  let noSum = 0;
  for (const tally of tallies.values()) {
    yesSum += tally.yes;
    noSum += tally.no;
  }
  if (yesSum !== expected.yes || noSum !== expected.no) return null;

  // Alphabetical — a neutral criterion, never size or side.
  return [...tallies.entries()]
    .map(([party, tally]) => ({ party: `${party}s`, ...tally }))
    .sort((a, b) => a.party.localeCompare(b.party));
}

/** The rendered sentence: plain words, numbers only, no conclusions. */
export function formatPartyBreakdown(tallies: PartyTally[]): string {
  return tallies
    .map((t) => `${t.party} ${t.yes} for, ${t.no} against`)
    .join(" · ");
}

export interface PartyVoters { readonly yes: readonly string[]; readonly no: readonly string[] }

export function partyVotersByVote(positions: readonly MemberVote[]): Map<string, PartyVoters> {
  const groups = new Map<string, {yes:string[];no:string[]}>();
  for (const row of positions) {
    if (row.position !== "YES" && row.position !== "NO") continue;
    const group = groups.get(row.voteId) ?? {yes:[],no:[]};
    group[row.position === "YES" ? "yes" : "no"].push(row.officeholderId);
    groups.set(row.voteId,group);
  }
  return groups;
}
