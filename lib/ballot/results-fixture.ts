import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BallotSet, Candidacy, Contest } from "./types.ts";
import type { CandidateResult, ContestResult, ChamberScore, PartyKey, Scorecard, SeatCounts } from "./results.ts";

/*
 * TEST FIXTURE ONLY. Maps MultiState's public Arizona file onto the result fields so every
 * card state can be seen before stream/cx-election-results lands. Deleted when that merges:
 * the page then reads the real fields from the ballot data.
 */

interface MsCandidate { name: string; party: string; is_incumbent: boolean; result: string; votes?: number; vote_pct?: string; status?: string }
interface MsRace {
  office: string; seat_label: string; result_status: string; result_status_source: string | null; result_status_set_at: string | null;
  flipped_seat: { from: string; to: string; seats?: number } | null; incumbent_defeated: boolean; num_seats?: number; seats_up?: number | null;
  chamber?: string; district?: string; candidates: MsCandidate[];
}
interface MsFile {
  generated_at: string;
  chambers: Record<string, { total: number; composition: { D: number; R: number; Other: number }; control: string; supermajority: number }>;
  statewide_officers: { office: string; name: string | null; party: string | null }[];
  elections_2026: { governor: MsRace; statewide: MsRace[]; legislative: MsRace[] };
  ballot_measures: { number: string; result: string }[];
}

const FIXTURE_SOURCE = { name: "MultiState", credits: null, url: "https://www.multistate.us/elections/data/states/AZ.json", checkedAt: "" };
const party = (value: string | null | undefined): PartyKey => value === "D" ? "D" : value === "R" ? "R" : "O";
const key = (name: string) => name.toLowerCase().replace(/["“”'’.,]/g, "").replace(/\s+/g, " ").trim();
const dateOf = (iso: string | null) => iso ? new Date(Date.parse(iso) - 7 * 3600_000).toISOString().slice(0, 10) : null;

function fullName(candidate: Candidacy): string { return key(`${candidate.givenName} ${candidate.familyName}`); }
function sameName(candidate: Candidacy, msName: string): boolean {
  const a = fullName(candidate), b = key(msName);
  if (a === b) return true;
  const [af, ...ar] = a.split(" "), [bf, ...br] = b.split(" ");
  return ar.at(-1) === br.at(-1) && (af === bf || af.startsWith(bf) || bf.startsWith(af));
}

function raceFor(file: MsFile, contest: Contest): MsRace | null {
  const { governor, statewide, legislative } = file.elections_2026;
  const house = /^State Representative, District (\d+)$/.exec(contest.title), senate = /^State Senator, District (\d+)$/.exec(contest.title);
  if (/^Governor\b/i.test(contest.title)) return governor;
  if (house) return legislative.find(race => race.chamber === "House" && race.district === house[1]) ?? null;
  if (senate) return legislative.find(race => race.chamber === "Senate" && race.district === senate[1]) ?? null;
  const office = { "State Treasurer": "Treasurer", "State Mine Inspector": "State Mine Inspector" }[contest.title] ?? contest.title;
  return statewide.find(race => race.office === office) ?? null;
}

function contestResult(race: MsRace, seats: number): ContestResult {
  const uncontested = race.result_status_source === "uncontested";
  return {
    status: race.result_status === "Counting" ? "counting" : uncontested ? "unopposed" : "called",
    percentCounted: null, statusDate: dateOf(race.result_status_set_at), seats,
    flipped: Boolean(race.flipped_seat), flippedTo: race.flipped_seat ? party(race.flipped_seat.to) : null, incumbentLost: race.incumbent_defeated,
    source: FIXTURE_SOURCE,
  };
}

function tally(file: MsFile, chamber: "House" | "Senate"): ChamberScore {
  const seats = file.chambers[chamber].total, before = file.chambers[chamber].composition;
  const now: SeatCounts = { D: 0, R: 0, O: 0, counting: 0 };
  for (const race of file.elections_2026.legislative.filter(row => row.chamber === chamber)) {
    const slots = chamber === "House" ? 2 : 1;
    if (race.result_status === "Counting") { now.counting += slots; continue; }
    const winners = race.candidates.filter(candidate => candidate.result === "Won");
    for (const winner of winners) now[party(winner.party)] += 1;
    now.counting += Math.max(0, slots - winners.length);
  }
  const toControl = Math.floor(seats / 2) + 1;
  const lead = (counts: SeatCounts): PartyKey | null => counts.D >= toControl ? "D" : counts.R >= toControl ? "R" : null;
  const beforeCounts: SeatCounts = { D: before.D, R: before.R, O: before.Other, counting: 0 };
  return { name: chamber === "House" ? "State House" : "State Senate", seats, toControl, before: beforeCounts, now,
    controlBefore: lead(beforeCounts), controlNow: lead(now) };
}

function scorecard(file: MsFile): Scorecard {
  const { governor, statewide, legislative } = file.elections_2026;
  const winner = governor.candidates.find(candidate => candidate.result === "Won");
  const lost = { D: 0, R: 0 };
  for (const race of [governor, ...statewide, ...legislative]) for (const candidate of race.candidates)
    if (candidate.is_incumbent && candidate.result === "Lost" && (candidate.party === "D" || candidate.party === "R")) lost[candidate.party] += 1;
  const holder = file.statewide_officers.find(officer => officer.office === "Governor");
  return {
    scope: "AZ", name: "Arizona",
    chambers: [tally(file, "House"), tally(file, "Senate")],
    governor: winner ? { name: winner.name, party: party(winner.party), flipped: holder?.party !== winner.party, reelected: holder?.name === winner.name } : null,
    statewide: { total: statewide.length + 1, flipped: [governor, ...statewide].filter(race => race.flipped_seat).map(race => ({ office: race.office, to: party(race.flipped_seat!.to) })) },
    incumbentsLost: lost,
    sources: [{ what: "State results and chamber seats", from: "MultiState", checked: file.generated_at, url: "https://www.multistate.us/elections/data/states/AZ.json" }],
  };
}

export function withFixtureResults(set: BallotSet): BallotSet {
  if (process.env.WTP_RESULTS_FIXTURE !== "1" || set.election.state !== "AZ") return set;
  const file = JSON.parse(readFileSync(join(process.cwd(), "tests/fixtures/results/az-multistate.json"), "utf8")) as MsFile;
  FIXTURE_SOURCE.checkedAt = file.generated_at;
  const byContest = new Map<string, Candidacy[]>();
  for (const candidate of set.candidacies) byContest.set(candidate.contestId, [...byContest.get(candidate.contestId) ?? [], candidate]);
  const proposition = new Map(file.ballot_measures.map(row => [row.number.replace(/\D+/g, ""), row.result]));
  const propositionOf = (contest: Contest | undefined) => /prop(?:osition)?[- ]?(\d+)/i.exec(`${contest?.id ?? ""} ${contest?.title ?? ""}`)?.[1] ?? "";
  const candidacies = new Map<string, CandidateResult>();
  const contests = set.contests.map(contest => {
    if (contest.type === "MEASURE") {
      const outcome = proposition.get(propositionOf(contest));
      if (!outcome) return contest;
      const status = outcome === "Pending" ? "counting" : "called";
      return { ...contest, result: { status, percentCounted: null, statusDate: null, seats: 1, flipped: false, flippedTo: null, incumbentLost: false, source: FIXTURE_SOURCE } as ContestResult };
    }
    const race = contest.type === "CANDIDACY" ? raceFor(file, contest) : null;
    if (!race) return contest;
    const seats = contest.voteFor ?? 1;
    for (const candidate of byContest.get(contest.id) ?? []) {
      const row = race.candidates.find(item => item.votes !== undefined && sameName(candidate, item.name));
      if (row?.votes !== undefined) candidacies.set(candidate.id, { votes: row.votes, percent: Number(row.vote_pct), outcome: row.result === "Won" ? "won" : null });
    }
    return { ...contest, result: contestResult(race, seats) };
  });
  return {
    ...set, contests,
    candidacies: set.candidacies.map(candidate => candidacies.has(candidate.id) ? { ...candidate, result: candidacies.get(candidate.id) } : candidate),
    measures: set.measures.map(measure => {
      const contest = set.contests.find(row => row.id === measure.contestId);
      const outcome = proposition.get(propositionOf(contest));
      return outcome === "Passed" || outcome === "Failed"
        ? { ...measure, result: { yes: null, no: null, yesPercent: null, outcome: outcome === "Passed" ? "passed" as const : "failed" as const } } : measure;
    }),
    scorecards: { AZ: scorecard(file) },
  };
}
