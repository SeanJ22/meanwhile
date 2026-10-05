/** BR-26: the same bounded stuck population and capture score Admin displays. */
import { askedPlace } from "./place-key.ts";
export { askedPlace } from "./place-key.ts";
import { population } from "../admin-view/v6-stuck-route.ts";
import { stuckViews, type StuckPopulation } from "../admin-view/v6-stuck-read.ts";
import { readPlaceOwed, type PlaceOwedRead, type PlaceOwedRefusal } from "../admin-view/place-owed-read.ts";
import { scorePlace } from "../admin-view/place-scorecard.ts";


export interface PlaceStuckReading {
  readonly key: string; readonly label: string; readonly captured: number; readonly owed: number; readonly percent: number | null;
  readonly stuck: number; readonly causes: readonly string[]; readonly observedAt: string;
}
export async function readPlaceStuck(asked: string, from: string, nowIso: string, deps: {
  readonly stuck: () => Promise<StuckPopulation | null>;
  readonly owed: (key: string) => Promise<PlaceOwedRead | PlaceOwedRefusal>;
} = { stuck: population, owed: readPlaceOwed }): Promise<PlaceStuckReading | null> {
  const key = askedPlace(asked, from);
  if (!key) return null;
  const [stuck, owed] = await Promise.all([deps.stuck(), deps.owed(key)]);
  if (!stuck || owed.state !== "READ") return null;
  const view = stuckViews(stuck.rows, key, nowIso);
  const score = scorePlace(owed.rows, {}, []).overall;
  return { key, label: owed.label, captured: score.captured, owed: score.total, percent: score.percent,
    stuck: view.total, causes: view.sameCause.slice(0, 2).map(c => c.cause), observedAt: owed.observedAt };
}
