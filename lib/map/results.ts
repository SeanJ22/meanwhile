import { officeIdentity } from "../officials/office-identity.ts";
import { flippedParty, winnersOf } from "../ballot/results.ts";
import { partyKey, seatCounts, type PartyKey, type SeatCounts } from "../ballot/scorecard-view.ts";
import type { BallotSet, Contest } from "../ballot/types.ts";
import type { BallotResultFacts, CandidateResult, ContestResult } from "../ballot/election-results.ts";
import type { NationalCongressSummary } from "../election-results/summary.ts";

/**
 * The results map's whole view of a contest result. This file is the only place
 * that reads the ballot's result fields; everything else on the map works on
 * `DistrictResult`.
 */

/** The ballot scorecard's party keys and seat counts, so the map and the scorecard count the same way. */
export type ResultParty = PartyKey;
export type ContestStatus = "counting" | "called" | "certified" | "runoff" | "unopposed" | "pending";

export interface ResultCandidate {
  name: string;
  party: ResultParty;
  incumbent: boolean;
  /** `won` takes a seat; `runoff` goes on to a runoff; null lost or is not decided. */
  result: "won" | "runoff" | null;
  votes: number | null;
}

/** One contest as the map reads it, in the shape of the ballot's result fields. */
export interface ResultContest {
  ocdId: string;
  status: ContestStatus;
  /** Seats up (vote for N). */
  seats: number;
  /** The party that gained the seat when the source says the contest flipped, and how many seats changed hands when it says. */
  flip: { to: ResultParty; seats: number | null } | null;
  candidates: ResultCandidate[];
}

export interface DistrictResult {
  ocdId: string;
  status: ContestStatus;
  /** Seats up here, and who holds them so far. */
  seats: number;
  counts: SeatCounts;
  /** The party that gained a seat here, when the source says a seat flipped, and how many seats flipped (null when it does not say). */
  flipTo: ResultParty | null;
  flipSeats: number | null;
  candidates: ResultCandidate[];
}

/** The seats of one district, folded over every contest held in it. */
export function districtResult(contests: readonly ResultContest[]): DistrictResult {
  const candidates: ResultCandidate[] = [], won: Record<string, number> = {};
  let status: ContestStatus = contests[0].status, seats = 0, flipTo: ResultParty | null = null, flipSeats: number | null = null, flipUnknown = false;
  for (const contest of contests) {
    seats += contest.seats;
    for (const candidate of contest.candidates) if (candidate.result === "won") won[candidate.party] = (won[candidate.party] ?? 0) + 1;
    candidates.push(...contest.candidates);
    flipTo ??= contest.flip?.to ?? null;
    if (contest.flip) { if (contest.flip.seats === null) flipUnknown = true; else flipSeats = (flipSeats ?? 0) + contest.flip.seats; }
    if (contest.status === "counting" || contest.status === "pending" || contest.status === "runoff") status = contest.status;
  }
  const decided = Object.values(won).reduce((sum, count) => sum + count, 0);
  return { ocdId: contests[0].ocdId, status, seats, counts: seatCounts(won, Math.max(0, seats - decided)), flipTo, flipSeats: flipUnknown ? null : flipSeats, candidates };
}

export function resultsByDistrict(contests: readonly ResultContest[]): Record<string, DistrictResult> {
  const grouped = new Map<string, ResultContest[]>();
  for (const contest of contests) grouped.set(contest.ocdId, [...grouped.get(contest.ocdId) ?? [], contest]);
  return Object.fromEntries([...grouped].map(([ocdId, rows]) => [ocdId, districtResult(rows)]));
}

/** How a district is drawn. */
export type FillClass = ResultParty | "split" | "counting";

export function fillClass({ counts }: Pick<DistrictResult, "counts">): FillClass {
  if (counts.counting > 0) return "counting";
  const parties = (["D", "R", "O"] as const).filter(party => counts[party] > 0);
  return parties.length > 1 ? "split" : parties[0] ?? "counting";
}

/** The party that gained a seat in this district, when the source says a seat changed hands. */
export const flipParty = (result: DistrictResult): ResultParty | null => result.flipTo;

/** `ocd-division/country:us/state:az/sldu:17` → `{ state: "az", kind: "sldu", number: "17" }`. */
export function parseDistrictOcd(ocdId: string): { state: string; kind: string; number: string } | null {
  const match = /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})\/(sldu|sldl|cd):([^/]+)$/.exec(ocdId);
  return match ? { state: match[1], kind: match[2], number: match[3] } : null;
}

export const STATE_DIVISION = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/;

export const stateOcd = (state: string) => `ocd-division/country:us/${state.toLowerCase() === "dc" ? "district" : "state"}:${state.toLowerCase()}`;

/** The title a district's card carries: "State House, District 17". */
export function districtTitle(ocdId: string): string {
  const parsed = parseDistrictOcd(ocdId);
  if (!parsed) return ocdId;
  const kind = parsed.kind === "sldu" ? "State Senate" : parsed.kind === "sldl" ? "State House" : "U.S. House";
  return `${kind}, District ${parsed.number}`;
}

/* ------------------------------------------- the results job's documents --- */

/** A contest the map draws: a legislative or U.S. House district, or a state's U.S. Senate seat. Governor and other statewide offices share the state's division and are not drawn. */
const drawn = (contest: Contest) => parseDistrictOcd(contest.ocdId) !== null
  || (STATE_DIVISION.test(contest.ocdId) && officeIdentity(contest.title, contest.ocdId) === "us_senator");

const factFor = <T>(facts: BallotResultFacts, row: { id: string; aliases?: readonly string[] }): T | undefined =>
  [row.id, ...row.aliases ?? []].map(id => facts[id]).find(value => value !== undefined) as T | undefined;

/**
 * One state's contests with their filed results: the sliced ballot says which contest is which district and who ran,
 * and the state's published results feed says how each came out. A contest the feed has nothing for is simply absent,
 * so its district reads as "no results yet".
 */
export function resultContests(ballot: Pick<BallotSet, "contests" | "candidacies">, facts: BallotResultFacts): ResultContest[] {
  return ballot.contests.flatMap(contest => {
    const filed = factFor<ContestResult>(facts, contest);
    if (!filed || filed.withheld || !drawn(contest)) return [];
    const ran = ballot.candidacies.filter(row => row.contestId === contest.id).map(row => ({ row, result: factFor<CandidateResult>(facts, row) }));
    const winners = new Set(winnersOf(ran).map(entry => entry.row));
    const candidates = ran.map(({ row, result }): ResultCandidate => ({ name: `${row.givenName} ${row.familyName}`.trim(), party: partyKey(row.partyLabel) ?? "O",
      incumbent: row.incumbent === true, result: winners.has(row) ? "won" : result?.runoff ? "runoff" : null, votes: result?.votes ?? null }));
    const gained = flippedParty(filed);
    return [{ ocdId: contest.ocdId, status: filed.status, seats: Math.max(1, filed.seatsToFill ?? contest.voteFor ?? 1),
      flip: gained ? { to: gained, seats: filed.seatsFlipped ?? null } : null, candidates }];
  });
}

/**
 * The national summary as one result per state, for one chamber: the seats each party holds so far, seats still being
 * counted, and flips so far. The summary names no candidates and no gaining party; a flip's party is known only when every
 * seat won so far belongs to one party. A state that reported no races in the chamber is absent.
 */
export function nationalResults(summary: Pick<NationalCongressSummary, "states">, office: "us_senate" | "us_house"): Record<string, DistrictResult> {
  return Object.fromEntries(Object.entries(summary.states).flatMap(([state, offices]) => {
    const row = offices[office];
    if (!row || row.reportedRaces === 0) return [];
    const counts = seatCounts(row.seatsNow, row.stillCounting), seats = counts.D + counts.R + counts.O + counts.counting;
    const winners = (["D", "R", "O"] as const).filter(party => counts[party] > 0);
    const ocdId = stateOcd(state);
    return [[ocdId, { ocdId, status: row.stillCounting > 0 ? "counting" as const : "called" as const, seats, counts,
      flipTo: row.seatsFlipped > 0 && winners.length === 1 ? winners[0] : null, flipSeats: row.seatsFlipped, candidates: [] }]];
  }));
}
