import { statesForRegistryDivisions } from "../../civic-data/state-scopes.ts";
import { buildPlaceOwedList } from "../../coverage/place-owed.ts";
import type { HeldPlaceCapture } from "../../civic-data/held-place-capture.ts";
import { placePercent } from "../../coverage/place-measures.ts";
import type { NationalDivision } from "./v6-national-geography.ts";

export interface ScoreTarget {
  readonly placeKey: string;
  readonly divisions: readonly NationalDivision[];
  readonly zips?: readonly string[];
}

export interface ScoreDeps {
  readonly now: () => string;
  readonly readHeld: (divisionIds: readonly string[], now: string) => Promise<HeldPlaceCapture>;
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Each target's owed list is built in memory over its own divisions, so its number is exactly what `readPlaceOwed` gives that place alone. */
export async function scoreTargets(targets: readonly ScoreTarget[], deps: ScoreDeps): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (targets.length === 0) return out;
  const now = deps.now();
  const groups = new Map<string, ScoreTarget[]>();
  for (const target of targets) {
    const key = statesForRegistryDivisions(target.divisions.map(division => division.id)).sort().join(",");
    const rows = groups.get(key) ?? [];
    rows.push(target); groups.set(key, rows);
  }
  for (const group of groups.values()) {
    const held = await deps.readHeld([...new Set(group.flatMap(target => target.divisions.map(division => division.id)))], now);
    for (const target of group) {
      const rows = buildPlaceOwedList({ divisions: target.divisions, subjects: held.subjects, held: held.held, now, ...(target.zips ? { zips: target.zips } : {}) });
      out.set(target.placeKey, placePercent(rows));
      await tick();
    }
  }
  return out;
}
