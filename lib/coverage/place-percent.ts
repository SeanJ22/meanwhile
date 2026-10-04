import { checklistItem } from "./checklist-map.ts";

/** The one percent formula for a place: Admin, the national list and the runner's
 * place order all read it. Captured means published, captured and waiting to
 * publish, or not published by the government. Core items only: extension items
 * are counted apart. It only counts; it never gates publishing.
 *
 * PURE. */
export type PlaceItemState = "published" | "held" | "unpublished" | "stale" | "missing";

/** An item is core when the overlay scores it as core; every other civic item is an extension. */
export function isCoreChecklistItem(checklistId: string): boolean {
  return checklistItem(checklistId)?.scoreAs === "core";
}

/** A summary item's detail items carry its count, so it stays out of the denominator. */
export function isSummaryChecklistItem(checklistId: string): boolean {
  return checklistItem(checklistId)?.countsAs === "summary";
}

/** In the headline: a core item that counts under its own ID. */
export function isCountedChecklistItem(checklistId: string): boolean {
  return isCoreChecklistItem(checklistId) && !isSummaryChecklistItem(checklistId);
}

export function isCapturedState(state: PlaceItemState): boolean {
  return state === "published" || state === "held" || state === "unpublished";
}

/** Floored to one decimal, so rounding can never produce an unearned 100%. Null when nothing is owed. */
export function percentOf(captured: number, total: number): number | null {
  return total === 0 ? null : Math.floor((captured / total) * 1000) / 10;
}

export function placePercent(rows: readonly { readonly checklistId: string; readonly state: PlaceItemState }[]): number | null {
  const core = rows.filter(row => isCountedChecklistItem(row.checklistId));
  return percentOf(core.filter(row => isCapturedState(row.state)).length, core.length);
}
