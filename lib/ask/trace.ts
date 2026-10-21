import type { AskIntent, AskTemporal } from "./intent.ts";

export interface RungTrace {
  ran: boolean;
  why?: string;
  model?: string;
  servedModel?: string | null;
  ms?: number;
  cached?: boolean;
}

export interface AskTrace {
  fallback?: { ran: boolean; ms: number; model: string };
  interpretation: RungTrace & {
    intent?: AskIntent;
    temporal?: AskTemporal;
    mentionCount?: number;
    referentProposed?: boolean;
    fellBackToDeterministic?: boolean;
  };
  resolution: {
    state: "BOUND" | "AMBIGUOUS" | "UNRESOLVED" | "NONE";
    subjectId?: string | null;
    subjectName?: string | null;
    basis?: string;
  };
  retrieval: {
    selection: string;
    recordCount: number;
    sourceCount: number;
    gapCount: number;
    denominators: Record<string, number>;
  };
  officeLookup?: { phrase: string; office: string };
  synthesis: RungTrace & {
    effort?: string;
    cache?: {
      callerKey: string;
      cacheReadInputTokens: number;
      cacheCreationInputTokens: number;
      uncachedInputTokens: number;
    };
    writers?: { model: string; servedModel?: string | null; role: "FAST" | "FRONTIER"; ms: number; result: "PASSED" | "FAILED" | "UNAVAILABLE"; failed?: string[]; detail?: string }[];
    escalation?: string;
    writerSelection?: { memberVoteRowsShown: number; memberVoteRowsWithheld: number; rollCallsWithheld: number; personVoteRecordsShown?: number; personVoteRecordsWithheld?: number };
  };
  validation: {
    ran: boolean;
    passed?: boolean;
    checked?: string[];
    failed?: string[];
  };
  composition?: {
    kind: "SITTING" | "MONEY" | "OFFICIALS" | "ROSTER" | "VOTES" | "CALENDAR" | "BALLOT";
    shape: string;
    basis?: "FEC_FILED_TOTALS" | "RECORDED_ACTIONS" | "ROLL_CALLS" | "SITTING_AND_GAPS" | "STATE_COMMITTEE_FILINGS" | "BALLOT_ABSENCE_AND_COUNTY_REGISTER" | "HELD_OFFICEHOLDERS" | "HELD_ROSTER" | "HELD_ROLL_CALLS" | "HELD_MEETINGS" | "HELD_BALLOT";
    composed: boolean;
    passed?: boolean;
    failed?: string[];
  };
  speculation?: {
    ran: boolean;
    why: string;
    delivered: "SPECULATIVE_ANSWER" | "MODEL_READING";
    codeIntent?: AskIntent;
    codeTemporal?: AskTemporal;
    /** Milliseconds from the request's start to the speculative writer's start. */
    writerStartedAtMs?: number;
    aborted?: boolean;
  };
  /** Wall-clock milliseconds per stage of the request, in order. */
  stages?: Record<string, number>;
  /** Milliseconds per source preload; these run in parallel, so they overlap rather than sum. */
  preloads?: Record<string, number>;
  preloadRetries?: string[];
  preloadSources?: Record<string, "EDGE" | "DATABASE">;
  sourcesLoaded?: "ESSENTIAL" | "IDENTITY_AND_MEETINGS" | "WITHOUT_PERSON_RECORDS" | "ALL";
  answerMode: AnswerMode;
  totalMs: number;
}

export type AnswerMode =
  | "GROUNDED_CLAUDE"
  | "GROUNDED_COMPOSED"
  | "STRUCTURED_GROUNDED"
  | "CLARIFY"
  | "UNRESOLVED"
  | "NO_EVIDENCE"
  | "REJECTED_FELL_BACK"
  | "OFF"
  | "TRANSPORT_FAILED";

export function emptyTrace(): AskTrace {
  return {
    interpretation: { ran: false },
    resolution: { state: "NONE" },
    retrieval: {
      selection: "ANY",
      recordCount: 0,
      sourceCount: 0,
      gapCount: 0,
      denominators: {},
    },
    synthesis: { ran: false },
    validation: { ran: false },
    answerMode: "NO_EVIDENCE",
    totalMs: 0,
  };
}
