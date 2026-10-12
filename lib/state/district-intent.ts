import { districtTypeInTiers } from "../ocd/district-tiers.ts";
import type { Tier } from "../ocd/tiers.ts";
import type { DistrictType } from "./types.ts";

/**
 * The overlay-visibility contract between the district-type checkboxes and the
 * "Show districts" master toggle. A reader who touches the district-type group
 * is asking to see districts, so the interaction turns the overlay on — except
 * "clear", which draws nothing.
 */

/** Every way a reader can touch the district-type group. */
export type DistrictInteraction = "toggle-type" | "select-all" | "clear";

/**
 * Whether this interaction implies the reader wants the overlay visible.
 * Applied by the filters panel when the master toggle is currently off.
 */
export function interactionTurnsOverlayOn(kind: DistrictInteraction): boolean {
  return kind !== "clear";
}

/**
 * Which overlay types are actually drawn — the single derivation the map
 * reads. A populated selection with the overlay enabled and boundaries
 * loadable may never derive to nothing.
 *
 * `tiers` is the Local / State / Federal selection the meeting list also
 * filters on. `components/map/map-canvas.tsx` uses this one list for which
 * layers it adds, their labels, and hit-testing (`districtsAt`), so a hidden
 * level is neither drawn nor clickable.
 *
 * A DISPLAY filter only: it changes nothing about who governs the reader.
 */
export function deriveActiveDistrictTypes(
  showDistricts: boolean,
  districtsFailed: boolean,
  selected: readonly DistrictType[],
  tiers: readonly Tier[],
): DistrictType[] {
  if (!showDistricts || districtsFailed) return [];
  return selected.filter((type) => districtTypeInTiers(type, tiers));
}
