import type { BallotpediaRace } from "./ballotpedia.ts";
import { ballotpediaRaceId } from "./ballotpedia.ts";
import type { ElectionResult, ElectionResultStatus, ElectionSummary, ResultSource } from "./types.ts";

type CongressOffice = "us_senate" | "us_house";

/** A result, never a source body or a copy of the ballot. Survives partial job turns. */
export interface CongressRaceResult {
  readonly sourceRaceId: string;
  readonly state: string;
  readonly office: CongressOffice;
  readonly electionDate: string;
  readonly status: ElectionResultStatus;
  readonly winners: readonly { readonly name: string; readonly party: string | null }[];
  readonly seatsFlipped: number | null;
  readonly incumbentsLost: number | null;
  readonly checkedAt: string;
  readonly sources: readonly ResultSource[];
}

export interface StateCongressResult {
  /** These are the seats up in this election; Senate holdovers are not inferred. */
  readonly scope: "election-races";
  readonly seatsNow: Readonly<Record<string, number>>;
  readonly stillCounting: number;
  readonly seatsFlipped: number;
  readonly unknownFlipRaces: number;
  readonly incumbentsLost: number;
  readonly unknownIncumbentLossRaces: number;
  readonly reportedRaces: number;
  readonly totalRaces: number;
}

export interface NationalCongressSummary {
  readonly checkedAt: string;
  readonly sources: readonly ResultSource[];
  readonly states: Readonly<Record<string, Readonly<Record<CongressOffice, StateCongressResult>>>>;
  readonly statewide?: Readonly<Record<string, Omit<ElectionSummary, "quote" | "quotes">>>;
  /** Each U.S. House district's result, keyed by cd OCD id. Only contests whose candidates all matched appear; a missing district is neutral. */
  readonly houseDistricts?: Readonly<Record<string, HouseDistrictResult>>;
}

export interface HouseDistrictResult {
  readonly status: ElectionResultStatus;
  readonly party: "D" | "R" | "I" | null;
  readonly flipped: boolean | null;
}

const key = (race: Pick<CongressRaceResult, "electionDate" | "sourceRaceId">) => `${race.electionDate}:${race.sourceRaceId}`;
const decided = (race: CongressRaceResult) => ["called", "certified", "unopposed"].includes(race.status) && race.winners.length > 0;

/** Keep acquired source races even when our ballot has not matched them yet. */
export function updateCongressResults(prior: Readonly<Record<string, CongressRaceResult>> | undefined,
  races: readonly ElectionResult[]): Readonly<Record<string, CongressRaceResult>> {
  const values = { ...prior };
  for (const race of races) {
    if (race.sourceId !== "ballotpedia" || race.office !== "us_house" && race.office !== "us_senate") continue;
    values[key(race)] = { sourceRaceId: race.sourceRaceId, state: race.state, office: race.office, electionDate: race.electionDate,
      status: race.status, winners: race.candidates.filter(candidate => candidate.won).map(candidate => ({ name: candidate.name, party: candidate.party ?? null })),
      seatsFlipped: race.seatsFlipped ?? (race.flipped === undefined ? null : Number(race.flipped)),
      incumbentsLost: race.incumbentsLost ?? (race.incumbentLost === undefined ? null : Number(race.incumbentLost)),
      checkedAt: race.checkedAt, sources: [{ name: race.sourceName, url: race.sourceUrl }, ...race.creditedSources] };
  }
  return values;
}

/** One small precomputed map document, with unknown coverage kept distinct from zero. */
export function summarizeCongressResults(races: readonly CongressRaceResult[], checkedAt: string,
  expectedRoutes: readonly BallotpediaRace[] = [], previous?: NationalCongressSummary): NationalCongressSummary {
  const unique = [...new Map(races.map(race => [key(race), race])).values()];
  const expected = expectedRoutes.map(route => ({ ...route, sourceRaceId: ballotpediaRaceId(route.url), electionDate: route.electionDate ?? "2026-11-03" }));
  const states = [...new Set([...Object.keys(previous?.states ?? {}), ...unique.map(race => race.state), ...expected.map(route => route.state)])].sort();
  const summarize = (state: string, office: CongressOffice): StateCongressResult => {
    const reported = unique.filter(race => race.state === state && race.office === office);
    if (!reported.length && previous?.states[state]?.[office]) return previous.states[state][office];
    const total = new Set([...reported.map(key), ...expected.filter(route => route.state === state && route.office === office).map(key)]).size;
    const called = reported.filter(decided), seatsNow: Record<string, number> = {};
    for (const race of called) for (const winner of race.winners) if (winner.party) seatsNow[winner.party] = (seatsNow[winner.party] ?? 0) + 1;
    const sumKnown = (field: "seatsFlipped" | "incumbentsLost") => called.reduce((sum, race) => sum + (race[field] ?? 0), 0);
    return { scope: "election-races", seatsNow, stillCounting: total - called.length,
      seatsFlipped: sumKnown("seatsFlipped"), unknownFlipRaces: called.filter(race => race.seatsFlipped === null).length,
      incumbentsLost: sumKnown("incumbentsLost"), unknownIncumbentLossRaces: called.filter(race => race.incumbentsLost === null).length,
      reportedRaces: reported.length, totalRaces: total };
  };
  return { checkedAt, ...(previous?.statewide ? { statewide: previous.statewide } : {}),
    states: Object.fromEntries(states.map(state => [state, { us_house: summarize(state, "us_house"), us_senate: summarize(state, "us_senate") }])),
    sources: [...new Map([...previous?.sources ?? [], ...unique.flatMap(race => race.sources)].map(source => [JSON.stringify(source), source])).values()] };
}
