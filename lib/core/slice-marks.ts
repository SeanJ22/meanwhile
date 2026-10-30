import type { Query } from "../facts/publish.ts";
import { cardsOfKind, SLICE_CARDS, type SliceCard } from "../reader/slices.ts";
import { controlPlaneQuery, workList, type WorkList } from "./work.ts";

/** One slice of one place that a filed fact belongs to. */
export interface SliceMark { readonly placeId: string; readonly card: SliceCard }

/**
 * The slices these entities are on, read inside the transaction that filed them so the places are the ones just committed.
 * `places` are places the entities no longer serve; each of their cards changed too.
 */
export async function slicesOf(query: Query, entities: readonly string[], places: readonly string[] = []): Promise<readonly SliceMark[]> {
  const marks = new Map<string, SliceMark>();
  const add = (placeId: string, card: SliceCard) => marks.set(`${placeId}\t${card}`, { placeId, card });
  if (entities.length) for (const row of await query(`SELECT DISTINCT ep.place_id,e.kind FROM entity_place ep JOIN entity e ON e.id=ep.entity_id
    WHERE ep.entity_id=ANY($1::text[])`, [entities])) for (const card of cardsOfKind(String(row.kind))) add(String(row.place_id), card);
  for (const place of places) for (const card of SLICE_CARDS) add(place, card);
  return [...marks.values()];
}

let list = (): WorkList => workList(controlPlaneQuery(), { owner: "slide" });
let unavailable = false;
/** A test's own work list stands in for the control-plane database. */
export function markSlicesOn(next: () => WorkList): void { list = next; unavailable = false; }

/**
 * After the commit, the marks go on the work list as `slice` rows. A row already waiting is left as it is, so a burst of facts for one place
 * is one rebuild. The fact is live whatever happens here; a mark that could not be made is said once, and the slice is rebuilt at the next change to the place.
 */
export async function markSlices(marks: readonly SliceMark[]): Promise<void> {
  if (!marks.length) return;
  try {
    await list().touch(marks.map(mark => ({ kind: "slice" as const, placeId: mark.placeId, subjectId: mark.placeId, field: mark.card,
      origin: { from: "loader" as const }, source: { source: "The Slide filed a fact here" } })));
  } catch (error) {
    if (unavailable) return;
    unavailable = true;
    console.error(`Slices could not be marked after a fact was filed (${error instanceof Error ? error.message : String(error)}); each is rebuilt at the next change to its place`);
  }
}
