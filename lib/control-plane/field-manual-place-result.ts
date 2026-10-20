import type { FieldManualRepository } from "./repository/types.ts";
import { ConcurrentModification } from "./repository/types.ts";
import { mergePlaceResults, type PlaceResult } from "./field-manual-places.ts";

/** Update this place's result without bringing the method's other places into the runner. */
export async function recordFieldManualPlaceResult(repo: FieldManualRepository, id: string, result: PlaceResult, now: string): Promise<void> {
  if (!repo.readArrayPage || !repo.compareAndSetArrayItem) throw new Error("FIELD_MANUAL_POINT_RESULT_REQUIRED");
  for (let attempt = 0; ; attempt += 1) {
    const page = await repo.readArrayPage(id, "placeResults", { match: { path: ["place"], value: result.place }, limit: 2 });
    if (!page) throw new Error(`FIELD_MANUAL_METHOD_MISSING:${id}`);
    const first = await repo.readArrayPage(id, "placeResults", { limit: 1 });
    // Legacy methods express their first results through their original place
    // scope. Preserve that scope server-side instead of expanding its members.
    const fields = first?.values.length === 0 ? { placeResultsPartial: true } : undefined;
    const next = mergePlaceResults(page.values as PlaceResult[], [result])[0];
    if (JSON.stringify(next) === JSON.stringify(page.values[0])) return;
    try { await repo.compareAndSetArrayItem(id, page.revision, "placeResults", ["place"], result.place, next, now, undefined, fields); return; }
    catch (error) { if (!(error instanceof ConcurrentModification) || attempt >= 31) throw error; }
  }
}
