/** BR-26: the same bounded stuck population and capture score Admin displays. */
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { parseV6PlaceKey } from "../admin-view/v6-hunts-read.ts";
import { population } from "../admin-view/v6-stuck-route.ts";
import { stuckViews, type StuckPopulation } from "../admin-view/v6-stuck-read.ts";
import { readPlaceOwed, type PlaceOwedRead, type PlaceOwedRefusal } from "../admin-view/place-owed-read.ts";
import { scorePlace } from "../admin-view/place-scorecard.ts";

export function askedPlace(asked: string, from: string): string | null {
  const key = /\b(?:geo:[a-z]{2}\.[a-z_]+\.[0-9]+|st:[a-z]{2})\b/i.exec(asked)?.[0]?.toLowerCase();
  if (key && parseV6PlaceKey(key)) return key;
  const district = /\b([a-z]{2})\s*[-–]\s*(\d{1,2}|at.large)\b/i.exec(asked);
  const state = district ? US_STATES.find(s => s.code === district[1].toLowerCase()) : US_STATES.find(s => new RegExp(`\\b${s.name}\\b`, "i").test(asked));
  const number = district?.[2] ?? /\b(?:district|congressional district)\s*(\d{1,2}|at.large)\b/i.exec(asked)?.[1];
  if (state) {
    if (!number) return `st:${state.code}`;
    const fips = Object.entries(FIPS_TO_STATE).find(([,s]) => s.postal.toLowerCase() === state.code)?.[0];
    if (fips) return `geo:${state.code}.congressional_district.${fips}${/^\d+$/.test(number) ? number.padStart(2, "0") : "00"}`;
  }
  // A named unknown place must never silently become the selected place.
  if (!/\b(?:this|selected|my)\s+(?:place|district|state|county)\b/i.test(asked)) return null;
  try { const selected = new URL(from, "https://admin.invalid").searchParams.get("scope"); return selected && parseV6PlaceKey(selected) ? selected : null; } catch { return null; }
}

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
