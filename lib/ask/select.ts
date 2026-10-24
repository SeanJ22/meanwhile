import { localDate } from "./meeting-time.ts";

export type AgendaSelection = "NEXT" | "LAST" | "ANY" | "DATE";

export interface SittingLike {
  startsAt: string;
  timeZone?: string | null;
}

/** A tensed question never falls back to the other tense; `null` is a real answer. */
export function selectSitting<T extends SittingLike>(
  selection: AgendaSelection,
  sittings: readonly T[],
  now: number,
  requestedDate?: string | null,
): T | null {
  if (selection === "DATE") return requestedDate
    ? [...sittings].filter((meeting) => localDate(meeting) === requestedDate).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0] ?? null
    : null;
  const upcoming = sittings
    .filter((m) => Date.parse(m.startsAt) >= now)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  const past = sittings
    .filter((m) => Date.parse(m.startsAt) < now)
    .sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));

  if (selection === "NEXT") return upcoming[0] ?? null;
  if (selection === "LAST") return past[0] ?? null;
  return upcoming[0] ?? past[0] ?? null;
}

/** Grouped by the body's local day, not the UTC date, which can split one evening. */
export function sittingsOnSameLocalDay<T extends SittingLike & { timeZone?: string | null }>(
  chosen: T,
  sittings: readonly T[],
): readonly T[] {
  const day = localDate(chosen);
  return sittings
    .filter((m) => localDate(m) === day)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
