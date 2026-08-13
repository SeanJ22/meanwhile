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
 */
export function deriveActiveDistrictTypes(
  showDistricts: boolean,
  districtsFailed: boolean,
  selected: readonly DistrictType[],
): DistrictType[] {
  return showDistricts && !districtsFailed ? [...selected] : [];
}
