import checklist from "../control-plane/readiness/checklist-profile.json" with { type: "json" };

/** The one percent formula for a place: Admin, the national list and the runner's
 * place order all read it. Captured means published, captured and waiting to
 * publish, or not published by the government. Core items only: extension items
 * are counted apart. It only counts; it never gates publishing.
 *
 * PURE. */
export type PlaceItemState = "published" | "held" | "unpublished" | "stale" | "missing";

const CORE_IDS: ReadonlySet<string> = new Set(checklist.definitions.filter(d => d.originalCore).map(d => d.id));

/** An item is core when Sean's checklist says so; every other civic item is an extension. */
export function isCoreChecklistItem(checklistId: string): boolean {
  return CORE_IDS.has(checklistId);
}

export function isCapturedState(state: PlaceItemState): boolean {
  return state === "published" || state === "held" || state === "unpublished";
}

/** Floored to one decimal, so rounding can never produce an unearned 100%. Null when nothing is owed. */
export function percentOf(captured: number, total: number): number | null {
  return total === 0 ? null : Math.floor((captured / total) * 1000) / 10;
}

export function placePercent(rows: readonly { readonly checklistId: string; readonly state: PlaceItemState }[]): number | null {
  const core = rows.filter(row => isCoreChecklistItem(row.checklistId));
  return percentOf(core.filter(row => isCapturedState(row.state)).length, core.length);
}
