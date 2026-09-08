import type { RoutineRecordClass } from "./types.ts";

export interface RoutineSourceTask {
  readonly id: string;
  readonly sourceId: string;
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly requestedUrl: string;
  readonly parserVersion: string;
  readonly command: readonly string[];
  readonly cadenceMs: number;
  readonly retryMs: number;
}

const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

/**
 * The standing machine's direct-promotion portfolio. Each command is a data
 * operation only: source bytes -> candidate -> validation -> atomic pointer.
 */
export const ROUTINE_SOURCE_TASKS: readonly RoutineSourceTask[] = [
  {
    id: "fec-funding",
    sourceId: "fec-open-api",
    recordClass: "FEC_FUNDING",
    scope: "federal-supported",
    requestedUrl: "https://api.open.fec.gov/v1/",
    parserVersion: "fec-funding/2",
    command: ["scripts/fetch-fec.mts", "--promote"],
    cadenceMs: 7 * DAY,
    retryMs: 6 * HOUR,
  },
  {
    id: "nh-members",
    sourceId: "nh-general-court",
    recordClass: "STATE_LEGISLATOR",
    scope: "US-NH",
    requestedUrl: "https://gc.nh.gov/downloads/Members.txt",
    parserVersion: "nh-general-court/2",
    command: ["scripts/nh-gencourt-members.mts", "--promote"],
    cadenceMs: DAY,
    retryMs: HOUR,
  },
  {
    id: "census-acs-population",
    sourceId: "census-data-api",
    recordClass: "CENSUS_REFERENCE",
    scope: "acs-population",
    requestedUrl: "https://api.census.gov/data/2024/acs/acs5",
    parserVersion: "census-data-api/2",
    command: ["scripts/acs-population-promote.mts"],
    cadenceMs: 30 * DAY,
    retryMs: 6 * HOUR,
  },
] as const;

export interface RoutineTaskClock {
  readonly lastAttemptedAt?: string;
  readonly lastSucceededAt?: string;
}

export function routineTaskDue(task: RoutineSourceTask, clock: RoutineTaskClock | undefined, nowMs: number): boolean {
  if (!clock?.lastAttemptedAt) return true;
  const attempted = Date.parse(clock.lastAttemptedAt);
  const succeeded = clock.lastSucceededAt ? Date.parse(clock.lastSucceededAt) : Number.NaN;
  if (!Number.isFinite(attempted)) return true;
  if (!Number.isFinite(succeeded)) return nowMs - attempted >= task.retryMs;
  // Once a due read fails, the source's retry clock owns the next attempt.
  // Measuring from the older success would make every pilot cycle retry at
  // once merely because the ordinary cadence had already elapsed.
  if (attempted > succeeded) return nowMs - attempted >= task.retryMs;
  return nowMs - succeeded >= task.cadenceMs;
}
