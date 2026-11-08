export type ElectionResultStatus = "counting" | "called" | "certified" | "runoff" | "unopposed" | "pending";

export interface ResultSource { name: string; url?: string }
export interface ResultCandidate {
  name: string;
  party?: string;
  votes?: number;
  percent?: number;
  won?: boolean;
  runoff?: boolean;
  incumbent?: boolean;
  quote?: string;
}
export interface ElectionResult {
  sourceId: "multistate" | "ballotpedia";
  sourceName: string;
  sourceUrl: string;
  creditedSources: ResultSource[];
  sourceRaceId: string;
  state: string;
  office: string;
  officeName: string;
  districtHint?: string;
  electionDate: string;
  status: ElectionResultStatus;
  percentCounted?: number;
  statusChangedAt?: string;
  seatsToFill?: number;
  flipped?: boolean;
  /** Source-stated or candidate-counted seats, including multi-seat races. */
  seatsFlipped?: number;
  gainedByParty?: string;
  incumbentLost?: boolean;
  incumbentsLost?: number;
  candidates: ResultCandidate[];
  measure?: {
    name: string;
    number?: string;
    yesVotes?: number;
    noVotes?: number;
    yesPercent?: number;
    outcome: "passed" | "failed" | "counting";
  };
  checkedAt: string;
  /** Exact substring of the batch's transient source text; never persisted. */
  quote: string;
}

export interface ElectionSummary {
  state: string;
  chambers: {
    name: string;
    seatsBefore: Record<string, number>;
    seatsNow: Record<string, number>;
    stillCounting: number;
    controlBefore: string | null;
    controlNow: string | null;
    seatsFlipped?: number;
  }[];
  governor: { before: string | null; now: string | null; name?: string | null };
  incumbentsLost?: number;
  statewideOfficesFlipped: { office: string; from: string; to: string }[];
  source: ResultSource;
  creditedSources: ResultSource[];
  checkedAt: string;
  quote: string;
  /** Separate exact fragments when a summary draws on more than one part of the source. */
  quotes?: string[];
}

export interface ElectionResultBatch {
  source: ResultSource;
  races: ElectionResult[];
  summaries: ElectionSummary[];
  /** Public source-owned race catalog; independent of which contests our ballot already holds. */
  racePages?: { state: string; office: "us_house" | "us_senate"; districtHint?: string; electionDate: string; url: string }[];
  catalogErrors?: { url: string; reason: string }[];
  /** Request-scoped evidence only. Source bodies never enter durable storage. */
  evidence: { text: string; contentType: string; contentHash: string };
}
