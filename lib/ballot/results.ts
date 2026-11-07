import type { Candidacy, Contest, Measure } from "./types.ts";

/**
 * The election-result fields the ballot data carries (added by CX-ELECTION-RESULTS).
 * Readers never fetch results separately: they ride on the ballot the page already loads.
 */
export type ResultStatus = "counting" | "called" | "certified" | "runoff" | "unopposed" | "pending";
export type PartyKey = "D" | "R" | "O";

export interface ContestResult {
  status: ResultStatus;
  /** Percent of expected votes counted, 0–100; null when the source gives none. */
  percentCounted: number | null;
  /** The day the status took effect (the runoff day when status is "runoff"), YYYY-MM-DD. */
  statusDate: string | null;
  seats: number;
  flipped: boolean;
  /** The party that gained the seat; only when flipped. */
  flippedTo: PartyKey | null;
  incumbentLost: boolean;
  /** The page we read the counts and the call from, and the outfit it credits. Shown only in Sources. */
  source: { name: string; credits: string | null; url: string; checkedAt: string };
}

export interface CandidateResult {
  votes: number;
  /** 0–100. */
  percent: number;
  outcome: "won" | "runoff" | null;
}

export interface MeasureResult {
  /** Vote counts; null while the source gives none. */
  yes: number | null;
  no: number | null;
  /** 0–100; null while the source gives none. */
  yesPercent: number | null;
  outcome: "passed" | "failed" | null;
}

export interface SeatCounts { D: number; R: number; O: number; counting: number }
export type PartyTally = Readonly<Partial<Record<PartyKey, number>>>;
export interface ChamberScore {
  name: string;
  seats: number;
  toControl: number;
  before: SeatCounts;
  now: SeatCounts;
  controlBefore: PartyKey | null;
  controlNow: PartyKey | null;
  /** Seats that changed hands to each party. */
  flippedTo?: PartyTally;
  note?: string;
}
export interface OfficeFlip { office: string; to: PartyKey }
export interface Scorecard {
  /** "AZ" or "US". */
  scope: string;
  name: string;
  chambers: readonly ChamberScore[];
  governor: { name: string; party: PartyKey; flipped: boolean; reelected: boolean } | null;
  statewide: { total: number; flipped: readonly OfficeFlip[]; won?: PartyTally } | null;
  incumbentsLost: { D: number; R: number };
  /** Governor's offices that changed party (national scope). */
  governorsFlipped?: readonly OfficeFlip[];
  sources: readonly { what: string; from: string; checked: string; url: string }[];
}

export const resultOf = (contest: Pick<Contest, "result">): ContestResult | null => contest.result ?? null;

/** Candidate choices in ballot order, each with the result the data carries. */
export const hasResults = (contest: Contest): boolean => contest.result !== undefined && contest.result.status !== "pending";

export function winnersOf(candidates: readonly Candidacy[]): Candidacy[] {
  return candidates.filter(c => c.result?.outcome === "won");
}

/** The top N by votes, where N is the seats up. */
export function leadersOf(candidates: readonly Candidacy[], seats: number): Candidacy[] {
  return candidates.filter(c => c.result).sort((a, b) => b.result!.votes - a.result!.votes).slice(0, Math.max(1, seats));
}

export const measureHasResult = (measure: Measure | null): boolean => measure?.result?.outcome != null;

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "Nov 5" from "2026-11-05"; with the year when asked ("Dec 8, 2026"). */
export function shortDate(iso: string | null, withYear = false): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  if (!match) return null;
  const text = `${SHORT_MONTHS[Number(match[2]) - 1]} ${Number(match[3])}`;
  return withYear ? `${text}, ${match[1]}` : text;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One decimal at 10% and up, two below; the bar never disappears. */
export const formatPercent = (value: number): string => `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
export const barWidth = (value: number): string => `${Math.min(100, Math.max(0.4, value))}%`;
