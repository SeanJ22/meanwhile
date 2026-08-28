import { districtTypeInTiers } from "../ocd/district-tiers.ts";
import type { Tier } from "../ocd/tiers.ts";
import type { DistrictType } from "./types.ts";

/**
 * The overlay-visibility contract between the district-type checkboxes and
 * the "Show districts" master toggle.
 *
 * The 2026-08-14 defect (author's production pass): the checkboxes do
 * nothing. Diagnosed before fixing — the state→render path was measured
 * working at production's exact commit (check, uncheck, select all, clear,
 * both themes), and what reproduced was the master toggle being OFF: the
 * checkbox group stayed fully interactive and every click changed state
 * with zero visible effect. A hidden gate in a different visual group is a
 * hidden entry point, which the friction rule counts as a defect with the
 * same standing as a wrong number.
 *
 * The fix is intent: a reader who touches the district-type group is asking
 * to see districts, so the interaction turns the overlay on. The one
 * exception is "clear" — clearing every type draws nothing, so inferring
 * "show me districts" from it would be wrong.
 *
 * Kept as a pure module so the rule is testable without mounting React —
 * the seventh sighting of the operation-that-can-return-nothing shape was a
 * state change no test could reach (tests/representation.test.ts holds the
 * guard).
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
 * reads. Extracted from the map-entry memo so the guard can hold it: a
 * populated selection with the overlay enabled and boundaries loadable may
 * never derive to nothing.
 *
 * ## MAP-5 (2026-08-28): the level filter reaches the boundaries too
 *
 * `tiers` is the Local / State / Federal selection — the same `ui.tiers` the
 * meeting list already filtered on through `tierForMeeting`. Until now this
 * derivation could not see it, so the control owned HALF its own meaning: a
 * reader at 85641 who turned Local off watched the meetings drop to zero
 * while Vail Unified, Tucson Unified, Sahuarita Unified and the county
 * outline stayed drawn over the map they had just asked to simplify.
 *
 * Putting the predicate HERE rather than beside the map is what makes it a
 * class repair, because `components/map/map-canvas.tsx` reads this one list
 * for three different things:
 *
 * - which layers it adds, and which it removes;
 * - the app-owned labels those layers carry;
 * - `districtsAt(map, point, districtTypesRef.current)` — HIT-TESTING.
 *
 * That third one is the reason a synchronising callback would have been the
 * wrong shape. A hidden level must not stay clickable: a boundary the reader
 * cannot see must not open a popup, answer a hover, or become the selected
 * district. One predicate, consumed once, and all three follow.
 *
 * ## What this is NOT
 *
 * A DISPLAY filter. It changes what is drawn and what can be clicked, and it
 * changes nothing whatever about who governs the reader. The resolved
 * location, the divisions the reader's point falls in, ballot eligibility and
 * the Ask residency picture are all untouched — a reader hiding Local
 * government is not thereby ungoverned by Vail Unified. Nothing in this file
 * writes state; it reads two selections and returns a list.
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
