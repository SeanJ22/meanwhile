import type { Candidacy } from "./types.ts";
import type { ContestResult } from "./election-results.ts";

/** Candidates the source marked as winners. */
export function winnersOf<T extends Pick<Candidacy, "result">>(candidates: readonly T[]): T[] {
  return candidates.filter(c => c.result?.won === true);
}

/** The top N by votes, where N is the seats up. */
export function leadersOf<T extends Pick<Candidacy, "result">>(candidates: readonly T[], seats: number): T[] {
  return candidates.filter(c => typeof c.result?.votes === "number").sort((a, b) => b.result!.votes! - a.result!.votes!).slice(0, Math.max(1, seats));
}

/** The party that gained a flipped seat: "D", "R", or null for any other party. */
export const flippedParty = (result: ContestResult): "D" | "R" | null =>
  result.flipped !== true ? null : /^(?:d|democrat(?:ic)?)/i.test(result.gainedByParty ?? "") ? "D" : /^(?:r|republican)/i.test(result.gainedByParty ?? "") ? "R" : null;

/** "Nov 5" from a date or a timestamp, read on the state's own clock; with the year when asked ("Dec 8, 2026"). */
export function shortDate(value: string | null | undefined, options: { withYear?: boolean; zone?: string | null } = {}): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", ...(options.withYear ? { year: "numeric" } : {}),
    timeZone: dateOnly ? "UTC" : options.zone ?? "UTC" }).format(new Date(value));
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[]): string {
  return names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** One decimal at 10% and up, two below; the bar never disappears. */
export const formatPercent = (value: number): string => `${value >= 10 ? value.toFixed(1) : value.toFixed(2)}%`;
export const barWidth = (value: number): string => `${Math.min(100, Math.max(0.4, value))}%`;
