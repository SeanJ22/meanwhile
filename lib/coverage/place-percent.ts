import { checklistItem } from "./checklist-map.ts";

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

/** Floored to one decimal, so rounding can never produce an unearned 100%. Null when nothing is owed. */
export function percentOf(captured: number, total: number): number | null {
  return total === 0 ? null : Math.floor((captured / total) * 1000) / 10;
}
