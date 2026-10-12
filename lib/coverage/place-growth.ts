import { placeMeasures, type Measure, type MeasureRow } from "./place-measures.ts";

/**
 * Completeness on the starting list (owed before the mission started) and the
 * grown list (owed now). A new find adds blanks to the grown list only, so it
 * never lowers the starting figure. Pure.
 */
export interface GrowthRow extends MeasureRow {
  /** When the blank started being owed; null when it was owed from the start or no record dates it. */
  readonly owedSince?: string | null;
}

export interface PlaceGrowth {
  readonly missionStart: string;
  readonly starting: Measure;
  readonly grown: Measure;
  /** Blanks added since the mission started: the grown list's rows minus the starting list's. */
  readonly added: number;
}

/** A row belongs to the starting list unless a record dates it after the mission started. */
export function onStartingList(row: Pick<GrowthRow, "owedSince">, missionStart: string): boolean {
  const since = row.owedSince ?? null;
  return since === null || !(Date.parse(since) > Date.parse(missionStart));
}

export function placeGrowth(rows: readonly GrowthRow[], missionStart: string | null): PlaceGrowth | null {
  if (missionStart === null || !Number.isFinite(Date.parse(missionStart))) return null;
  const starting = rows.filter((row) => onStartingList(row, missionStart));
  const pick = (m: Measure): Measure => ({ n: m.n, of: m.of, percent: m.percent });
  return {
    missionStart,
    starting: pick(placeMeasures(starting).completeness),
    grown: pick(placeMeasures(rows).completeness),
    added: rows.length - starting.length,
  };
}
