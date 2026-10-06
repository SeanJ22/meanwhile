/**
 * **THE SENT PLACES THE SCOREBOARD COUNTS (BR-30, SC-19).** A mission is a saved scope on the Admin config row. For the most recent
 * ones this reads each place's owed list and history exactly as Admin's place view does, and turns them into the Scorecard's
 * measures: completeness, freshness, delivery, coverage, people coverage, the starting and grown lists, the trend and the time to
 * core information. A place that cannot be read in time is counted as unread, never as zero. Read only; it starts no work.
 */
import { GROUP_NAMES } from "../../coverage/group-names.ts";
import { peopleCoverage } from "../../coverage/people-coverage.ts";
import { placeCoverage } from "../../coverage/place-coverage.ts";
import { placeGrowth } from "../../coverage/place-growth.ts";
import type { PlaceHistoryPoint } from "../../coverage/place-history.ts";
import { measuresByFamily, placeMeasures } from "../../coverage/place-measures.ts";
import { timeToCore } from "../../coverage/time-to-core.ts";
import type { AdminConfig } from "../gateway/admin-config.ts";
import { missionStartOf } from "./mission-start.ts";
import type { PlaceOwedRead, PlaceOwedRefusal } from "./place-owed-read.ts";
import type { ScoreboardPlace } from "./scoreboard-read.ts";
import { huntPlaceKey } from "./v6-hunts-read.ts";

/** The most recent missions the Scoreboard reads; each is a Census and held-data read, so the number is bounded. */
export const SCOREBOARD_PLACES_MOST = 8;

export interface ScoreboardPlaceDeps {
  readonly readOwed: (placeKey: string) => Promise<PlaceOwedRead | PlaceOwedRefusal>;
  readonly readHistory: (placeKey: string) => Promise<readonly PlaceHistoryPoint[]>;
  /** How long the whole read may take before the places not yet read are counted as unread. */
  readonly budgetMs: number;
}

/** The sent places, most recently started first, each once. */
export function sentPlaces(config: AdminConfig | null): readonly { readonly placeKey: string; readonly missionStart: string }[] {
  const keys = new Map<string, string>();
  for (const scope of config?.expansionScopes ?? []) keys.set(huntPlaceKey(scope), "");
  const out: { placeKey: string; missionStart: string }[] = [];
  for (const placeKey of keys.keys()) {
    const missionStart = missionStartOf(config, placeKey);
    if (missionStart !== null) out.push({ placeKey, missionStart });
  }
  return out.sort((a, b) => Date.parse(b.missionStart) - Date.parse(a.missionStart));
}

export function scoreboardPlaceOf(read: PlaceOwedRead, history: readonly PlaceHistoryPoint[], missionStart: string, coreIds: ReadonlySet<string>): ScoreboardPlace {
  const today = read.observedAt.slice(0, 10);
  const earlier = [...history].filter((point) => point.day < today).sort((a, b) => b.day.localeCompare(a.day))[0] ?? null;
  return {
    label: read.label,
    measures: placeMeasures(read.rows),
    familyMeasures: measuresByFamily(read.rows, Object.keys(GROUP_NAMES)),
    coverage: placeCoverage(read.rows, read.divisions),
    profiles: peopleCoverage(read.rows),
    growth: placeGrowth(read.rows, missionStart),
    earlier,
    core: timeToCore(read.rows, coreIds, missionStart),
  };
}

/** The places that could be read, and how many sent places could not (a refused read, a failure or the time budget). */
export async function readScoreboardPlaces(config: AdminConfig | null, coreIds: ReadonlySet<string>, deps: ScoreboardPlaceDeps): Promise<{ readonly places: readonly ScoreboardPlace[]; readonly unread: number }> {
  const sent = sentPlaces(config).slice(0, SCOREBOARD_PLACES_MOST);
  const places: ScoreboardPlace[] = [];
  const reads = sent.map(async (one) => {
    try {
      const [owed, history] = await Promise.all([deps.readOwed(one.placeKey), deps.readHistory(one.placeKey).catch(() => [] as readonly PlaceHistoryPoint[])]);
      if (owed.state === "READ") places.push(scoreboardPlaceOf(owed, history, one.missionStart, coreIds));
    } catch { /* counted as unread below */ }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([Promise.all(reads), new Promise<void>((resolve) => { timer = setTimeout(resolve, deps.budgetMs); })]);
  if (timer !== undefined) clearTimeout(timer);
  // A read that finishes after the budget is not in `places`, so it is counted as unread rather than half-shown.
  const taken = [...places];
  return { places: taken, unread: sent.length - taken.length };
}
