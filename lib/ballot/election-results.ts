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

