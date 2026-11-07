/**
 * The results map's whole view of a contest result. This file is the only place
 * that reads the ballot's result fields; everything else on the map works on
 * `DistrictResult`.
 */

export type ResultParty = "D" | "R" | "O";
/** A seat's state: a party that won it, or `C` while it is still being counted. */
export type SeatParty = ResultParty | "C";
export type ContestStatus = "counting" | "called" | "certified" | "runoff" | "unopposed" | "pending";

export interface ResultSeat {
  party: SeatParty;
  flip: boolean;
}

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
  /** The party that gained the seat(s), and how many seats changed hands. */
  flip: { to: ResultParty; seats: number } | null;
  candidates: ResultCandidate[];
}

export interface DistrictResult {
  ocdId: string;
  status: ContestStatus;
  seats: ResultSeat[];
  candidates: ResultCandidate[];
}

/** The seats of one district, folded over every contest held in it. */
export function districtResult(contests: readonly ResultContest[]): DistrictResult {
  const seats: ResultSeat[] = [];
  const candidates: ResultCandidate[] = [];
  let status: ContestStatus = contests[0].status;
  for (const contest of contests) {
    const winners = contest.candidates.filter(candidate => candidate.result === "won");
    let flips = contest.flip?.seats ?? 0;
    for (let index = 0; index < contest.seats; index += 1) {
      const winner = winners[index];
      const flip = Boolean(winner && flips > 0 && winner.party === contest.flip?.to);
      if (flip) flips -= 1;
      seats.push({ party: winner?.party ?? "C", flip });
    }
    candidates.push(...contest.candidates);
    if (contest.status === "counting" || contest.status === "pending" || contest.status === "runoff") status = contest.status;
  }
  return { ocdId: contests[0].ocdId, status, seats, candidates };
}

export function resultsByDistrict(contests: readonly ResultContest[]): Record<string, DistrictResult> {
  const grouped = new Map<string, ResultContest[]>();
  for (const contest of contests) grouped.set(contest.ocdId, [...grouped.get(contest.ocdId) ?? [], contest]);
  return Object.fromEntries([...grouped].map(([ocdId, rows]) => [ocdId, districtResult(rows)]));
}

/** How a district is drawn. */
export type FillClass = ResultParty | "split" | "counting";

export function fillClass(result: DistrictResult): FillClass {
  const parties = new Set(result.seats.map(seat => seat.party));
  if (parties.has("C")) return "counting";
  return parties.size > 1 ? "split" : [...parties][0] as ResultParty;
}

/** The party that gained a seat in this district, when any seat changed hands. */
export function flipParty(result: DistrictResult): ResultParty | null {
  return result.seats.find(seat => seat.flip)?.party as ResultParty | undefined ?? null;
}

export const flipCount = (result: DistrictResult) => result.seats.filter(seat => seat.flip).length;

/** `ocd-division/country:us/state:az/sldu:17` → `{ state: "az", kind: "sldu", number: "17" }`. */
export function parseDistrictOcd(ocdId: string): { state: string; kind: string; number: string } | null {
  const match = /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})\/(sldu|sldl|cd):([^/]+)$/.exec(ocdId);
  return match ? { state: match[1], kind: match[2], number: match[3] } : null;
}

export const stateOcd = (state: string) => `ocd-division/country:us/${state.toLowerCase() === "dc" ? "district" : "state"}:${state.toLowerCase()}`;

/** House seats flipped so far, by state: the phone's first national House view. */
export function houseFlipsByState(results: Readonly<Record<string, DistrictResult>>): Record<string, { count: number; party: ResultParty }> {
  const byState: Record<string, { count: number; party: ResultParty }> = {};
  for (const result of Object.values(results)) {
    const party = flipParty(result), parsed = parseDistrictOcd(result.ocdId);
    if (!party || parsed?.kind !== "cd") continue;
    const row = byState[parsed.state] ??= { count: 0, party };
    row.count += flipCount(result);
  }
  return byState;
}

/** The title a district's card carries: "State House, District 17". */
export function districtTitle(ocdId: string): string {
  const parsed = parseDistrictOcd(ocdId);
  if (!parsed) return ocdId;
  const kind = parsed.kind === "sldu" ? "State Senate" : parsed.kind === "sldl" ? "State House" : "U.S. House";
  return `${kind}, District ${parsed.number}`;
}

/* ------------------------------------------------- the ballot's fields --- */

/** What a ballot contest and its candidacies carry once results are filed. */
interface ContestResultFields {
  id: string;
  ocdId: string;
  voteFor: number | null;
  result?: { status: ContestStatus; flip?: { to: ResultParty; seats: number } | null };
}
interface CandidacyResultFields {
  contestId: string;
  givenName: string;
  familyName: string;
  partyLabel: string | null;
  incumbent: boolean | null;
  result?: { outcome: "won" | "runoff" | null; votes: number | null };
}

export const partyOf = (label: string | null): ResultParty =>
  /^d/i.test(label ?? "") ? "D" : /^r/i.test(label ?? "") ? "R" : "O";

/** Contests that carry a filed result. A contest without one is simply absent, so its district reads as "no results yet". */
export function resultContests(ballot: { contests: readonly ContestResultFields[]; candidacies: readonly CandidacyResultFields[] }): ResultContest[] {
  return ballot.contests.flatMap(contest => {
    if (!contest.result) return [];
    const candidates = ballot.candidacies.filter(row => row.contestId === contest.id).map((row): ResultCandidate => ({
      name: `${row.givenName} ${row.familyName}`.trim(),
      party: partyOf(row.partyLabel),
      incumbent: row.incumbent === true,
      result: row.result?.outcome ?? null,
      votes: row.result?.votes ?? null,
    }));
    return [{ ocdId: contest.ocdId, status: contest.result.status, seats: Math.max(1, contest.voteFor ?? 1), flip: contest.result.flip ?? null, candidates }];
  });
}
