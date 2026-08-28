import type { Tier } from "./tiers.ts";
import type { DistrictType } from "../state/types.ts";

/**
 * **WHICH LEVEL OF GOVERNMENT EACH MAP OVERLAY BELONGS TO.**
 * (MAP-5, the 2026-08-28 reader-feedback sweep.)
 *
 * ## Why this is its own module
 *
 * The mapping already existed, as a `tier` field on each entry of
 * `DISTRICT_LAYERS` in `lib/map/districts.ts`. That file is the MapLibre layer
 * builder: it reaches for `maplibre-gl`, for design tokens off the document,
 * and for the geometry loader. Nothing outside the map can import it cheaply,
 * so nothing outside the map ever asked it which level a boundary belongs to.
 *
 * That is exactly how MAP-5 happened. The Local / State / Federal control
 * filtered MEETINGS — `tierForMeeting` in `lib/state/derive.ts` — and left
 * every civic boundary drawn, because the derivation that chooses overlays
 * (`lib/state/district-intent.ts`) could not see a tier without pulling the
 * map into the state layer. A reader who turned Local off watched the meeting
 * list empty while Vail Unified, Tucson Unified, Sahuarita Unified and the
 * county outline stayed on the map.
 *
 * So the fact moves to where BOTH consumers can reach it, and neither owns a
 * copy. `DISTRICT_LAYERS` reads its `tier` from here; so does the overlay
 * derivation. There is one table, and a new overlay type cannot be added
 * without answering the question.
 *
 * ## The rule this encodes
 *
 * These are the app's OWN civic overlays and nothing else. The basemap's
 * roads, place labels, terrain and rivers are not on this table and are never
 * touched by the level filter: a reader hiding Local government is asking to
 * see fewer BOUNDARIES, not to lose the map underneath them.
 *
 * Classification is STRUCTURAL, by what kind of division the layer draws.
 * `CLAUDE.md` forbids deriving a tier by string-matching a label, and the same
 * refusal applies here — this is a table, not a heuristic over layer names or
 * paint colours.
 */
export const DISTRICT_TYPE_TIER: Readonly<Record<DistrictType, Tier>> = {
  // Seats in the US House.
  congressional: "national",
  // The two chambers of the state legislature.
  "state-senate": "state",
  "state-house": "state",
  // County, municipality and the three school types are all local government.
  county: "local",
  municipal: "local",
  "school-unified": "local",
  "school-elementary": "local",
  "school-secondary": "local",
};

/** Whether an overlay type is drawn under the given level selection. */
export function districtTypeInTiers(
  type: DistrictType,
  tiers: readonly Tier[],
): boolean {
  return tiers.includes(DISTRICT_TYPE_TIER[type]);
}
