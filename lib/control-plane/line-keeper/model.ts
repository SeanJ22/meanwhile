import { countWindow, type HourCount, type OldestWaiting, type CountProblem } from "../../counts/hour.ts";

export const HOUR = 3_600_000;
export const LINE_KEEPER_BY = "The line keeper";
export interface LineHour {
  readonly from: string;
  readonly through: string;
  readonly measuredAt: string;
  readonly counts: readonly HourCount[] | null;
  readonly waiting: readonly OldestWaiting[] | null;
  readonly problems: readonly CountProblem[];
  readonly own: { readonly bytesRead: number };
}
/** Counts stay in count_hour. A run saves only its hour, finish time, problem count and bytes read. */
export interface LineState {
  readonly version: 2;
  readonly checkedAt: string;
  readonly hours: readonly LineHour[];
}
export const closedHour = countWindow;
export function keeperStatus(state: LineState | null, at: string): string {
  if (!state) return "The line keeper’s report is unavailable.";
  if (Date.parse(at) - Date.parse(state.checkedAt) > HOUR) return "The line keeper has stopped reporting.";
  if (!state.hours.some(h=>h.from === closedHour(at).from)) return "The line keeper has not reported for the last full hour.";
  return "The line keeper is checking every hour.";
}
