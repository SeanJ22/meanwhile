import type { ElectionResultStatus, ElectionSummary, ResultSource } from "../election-results/types.ts";
import type { BallotSet } from "./types.ts";
import { withCandidateTickets } from "./tickets.ts";

interface ResultAttribution {
  readonly sources: readonly ResultSource[];
  readonly checkedAt: string;
  readonly sourceId?: string;
  readonly sourceRaceId?: string;
  readonly electionDate?: string;
}

export interface ContestResult extends ResultAttribution {
  readonly status: ElectionResultStatus;
  readonly percentCounted?: number | null;
  readonly statusChangedAt?: string | null;
  readonly seatsToFill?: number | null;
  readonly flipped?: boolean | null;
  readonly gainedByParty?: string | null;
  readonly incumbentLost?: boolean | null;
  readonly seatsFlipped?: number | null;
  readonly incumbentsLost?: number | null;
  readonly yesVotes?: number | null;
  readonly noVotes?: number | null;
  readonly yesPercent?: number | null;
  readonly outcome?: "passed" | "failed" | "counting";
}

export interface CandidateResult extends ResultAttribution {
  readonly votes?: number | null;
  readonly percent?: number | null;
  readonly won?: boolean | null;
  readonly runoff?: boolean | null;
}

export interface MeasureResult extends ResultAttribution {
  readonly yesVotes?: number | null;
  readonly noVotes?: number | null;
  readonly yesPercent?: number | null;
  readonly outcome: "passed" | "failed" | "counting";
}

/** Source text stays transient; the reader carries only the published summary and its attribution. */
export type BallotElectionSummary = Omit<ElectionSummary, "quote" | "quotes" | "chambers"> & {
  readonly sourceClockKey?: string;
  readonly sources?: readonly ResultSource[];
  readonly chambers: (ElectionSummary["chambers"][number] & {
    readonly source?: ResultSource; readonly creditedSources?: readonly ResultSource[]; readonly checkedAt?: string;
  })[];
};
export type BallotResultFacts = Readonly<Record<string, unknown>>;

const statePlace = (state: string) => `ocd-division/country:us/${state === "DC" ? "district" :
  ["AS", "GU", "MP", "PR", "VI"].includes(state) ? "territory" : "state"}:${state.toLowerCase()}`;

function nationalSummary(facts: BallotResultFacts): BallotElectionSummary | undefined {
  const nation = "ocd-division/country:us";
  const base = facts[nation] as BallotElectionSummary | undefined;
  const parts = ["us_senate", "us_house"].flatMap(chamber => {
    const value = facts[`${nation}#election_summary:${chamber}`];
    return value ? [value as BallotElectionSummary] : [];
  });
  if (!parts.length) return base;
  const summaries = [...base ? [base] : [], ...parts], first = summaries[0];
  const chambers = new Map(summaries.flatMap(summary => summary.chambers.map(chamber => [chamber.name, {
    ...chamber, source: summary.source, creditedSources: summary.creditedSources, checkedAt: summary.checkedAt,
  }] as const)));
  const sources = new Map(summaries.flatMap(summary => [summary.source, ...summary.creditedSources].map(source => [JSON.stringify(source), source])));
  return { ...first, chambers: [...chambers.values()], sources: [...sources.values()],
    checkedAt: summaries.map(summary => summary.checkedAt).sort().at(-1)! };
}

/** Attach already checked facts to the ballot the reader loaded, without another database request. */
export function withBallotResultFacts<T extends { readonly ballots: Readonly<Record<string, BallotSet>> }>(projection: T,
  facts: BallotResultFacts): T {
  if (!Object.keys(facts).length) return projection;
  const resultFor = (row: { id: string; aliases?: readonly string[] }) =>
    [row.id, ...row.aliases ?? []].map(id => facts[id]).find(value => value !== undefined);
  return { ...projection, ballots: Object.fromEntries(Object.entries(projection.ballots).map(([key, original]) => {
    const ballot = withCandidateTickets(original);
    const state = facts[statePlace(ballot.election.state)], nation = nationalSummary(facts);
    const attach = <R extends { id: string; aliases?: readonly string[] }>(row: R): R => {
      const result = resultFor(row);
      return result === undefined ? row : { ...row, result };
    };
    return [key, { ...ballot, contests: ballot.contests.map(attach), candidacies: ballot.candidacies.map(attach),
      measures: ballot.measures.map(attach),
      ...(state !== undefined || nation !== undefined ? { results: { ...ballot.results,
        ...(state !== undefined ? { state: state as BallotElectionSummary } : {}),
        ...(nation !== undefined ? { nation: nation as BallotElectionSummary } : {}) } } : {}) }];
  })) };
}

