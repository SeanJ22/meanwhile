import type { ElectionResultStatus, ElectionSummary, ResultSource } from "../election-results/types.ts";

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
  /** Set by the publisher only when every candidate with votes in the source matched our ballot. Without it, no outcome is shown. */
  readonly allCandidatesMatched?: boolean;
  /** Set by `guardResultFacts` when an outcome was held back; the card shows only the source. */
  readonly withheld?: boolean;
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


const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const raceOf = (value: Record<string, unknown>) => `${value.sourceId}:${value.electionDate}:${value.sourceRaceId}`;
/** A contest fact: a source race's status with no votes of its own. A measure carries its own yes/no outcome and needs no candidate match. */
const candidateContest = (value: Record<string, unknown>) => typeof value.status === "string" && typeof value.sourceRaceId === "string"
  && !("votes" in value) && !("percent" in value) && !("won" in value) && !("outcome" in value) && !("yesVotes" in value);

/**
 * A race shows a leader, Won, Called or Flipped only when the publisher marked that every candidate with votes matched our
 * ballot. Any other contest fact keeps its source and loses its outcome, and its candidates lose won/runoff.
 */
export function guardResultFacts(facts: BallotResultFacts): BallotResultFacts {
  const held = new Set<string>();
  for (const value of Object.values(facts)) if (record(value) && candidateContest(value) && value.allCandidatesMatched !== true) held.add(raceOf(value));
  if (!held.size) return facts;
  return Object.fromEntries(Object.entries(facts).map(([id, value]) => {
    if (!record(value) || !held.has(raceOf(value))) return [id, value];
    if (candidateContest(value)) return [id, { status: "pending", withheld: true, sources: value.sources, checkedAt: value.checkedAt,
      sourceId: value.sourceId, sourceRaceId: value.sourceRaceId, electionDate: value.electionDate }];
    const { won: _won, runoff: _runoff, ...rest } = value;
    return [id, rest];
  }));
}
