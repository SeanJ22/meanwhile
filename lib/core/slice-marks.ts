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
  if (entities.length) for (const row of await query(`SELECT DISTINCT ep.place_id,e.kind FROM entity e JOIN entity_place ep ON ep.entity_id=e.id WHERE e.kind<>'meeting' AND e.id=ANY($1::text[])
    UNION SELECT DISTINCT coalesce(x.entity_id,e.parent_id),e.kind FROM entity e LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.parent_id
    WHERE e.kind='meeting' AND e.parent_id IS NOT NULL AND e.id=ANY($1::text[])`, [entities])) for (const card of cardsOfKind(String(row.kind))) add(String(row.place_id), card);
  for (const place of places) for (const card of SLICE_CARDS) add(place, card);
  return [...marks.values()];
}

const encodedBoard = /^source:[^:]+:body:([^:]+)/;

/**
 * The slices a published calendar or registration reaches, read after its rows are in place. A calendar's partition reaches the meetings of
 * the boards it holds (a board folded into another is marked under the one it was folded into) and, for a state's family, the places
 * its rows name without a board. A history partition reaches only the history; a new version of a calendar reaches the history too, since the version it replaced may now hold sittings the held window no longer does.
 * A registration reaches the bodies card of every place it names. A registry's runtime model is held on the shelf, whose version moves with the pointer.
 */
async function slicesOfPublication(query: Query, input: { readonly recordClass: string; readonly scope: string }): Promise<readonly SliceMark[]> {
  if (input.recordClass === "REGISTRATION") {
    const rows = await query(`SELECT e.id FROM entity e WHERE e.kind='place' AND e.id IN (SELECT DISTINCT a->>'divisionId'
      FROM civic_data_rows r,LATERAL jsonb_array_elements(r.value->'associations') a WHERE r.promotion_key='REGISTRATION:'||$1 AND r.collection='governments')`, [input.scope]);
    return rows.map(row => ({ placeId: String(row.id), card: "bodies" as const }));
  }
  if (input.recordClass !== "MEETING") return [];
  const own = encodedBoard.exec(input.scope)?.[1];
  const rows = own ? [{ board: decodeURIComponent(own), ocd: null }] : await query(`SELECT DISTINCT body_id AS board,CASE WHEN coalesce(body_id,'')='' THEN value->>'ocdId' END AS ocd FROM civic_data_rows
    WHERE promotion_key='MEETING:'||$1 AND collection='meetings'`, [input.scope]);
  const subjects = [...new Set(rows.map(row => row.ocd ? String(row.ocd) : row.board ? String(row.board) : ""))].filter(Boolean);
  const canonical = subjects.length ? await query("SELECT s.id,coalesce(x.entity_id,s.id) AS canonical FROM unnest($1::text[]) s(id) LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=s.id", [subjects]) : [];
  const cards: readonly SliceCard[] = input.scope.endsWith(":history") ? ["history"] : ["meetings", "agenda", "history"];
  return [...new Set(canonical.map(row => String(row.canonical)))].flatMap(subject => cards.map(card => ({ placeId: subject, card })));
}

let list = (): WorkList => workList(controlPlaneQuery(), { owner: "slide" });
let unavailable = false;
/** A test's own work list stands in for the control-plane database. */
export function markSlicesOn(next: () => WorkList): void { list = next; unavailable = false; }

/**
 * The marks go on the work list as `slice` rows, after the commit. A row already waiting is left as it is, so a burst of facts for one place
 * is one rebuild. The fact is live whatever happens here; a mark that could not be made is said once, and the slice is rebuilt at the next change to its place.
 */
export async function markSlices(marks: readonly SliceMark[] | Promise<readonly SliceMark[]>): Promise<void> {
  try {
    const waiting = await marks;
    if (waiting.length) await list().touch(waiting.map(mark => ({ kind: "slice" as const, placeId: mark.placeId, subjectId: mark.placeId, field: mark.card,
      origin: { from: "loader" as const }, source: { source: "The Slide filed a fact here" } })));
  } catch (error) {
    if (unavailable) return;
    unavailable = true;
    console.error(`Slices could not be marked after a fact was filed (${error instanceof Error ? error.message : String(error)}); each is rebuilt at the next change to its place`);
  }
}

/** After a calendar or registration is published, the slices it reaches are marked. */
export const markPublicationSlices = (query: Query, input: Parameters<typeof slicesOfPublication>[1]): Promise<void> => markSlices(slicesOfPublication(query, input));
