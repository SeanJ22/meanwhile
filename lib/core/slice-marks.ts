import type { Query } from "../facts/publish.ts";
import { cardsOfKind, CONFIRMED, SLICE_CARDS, type SliceCard } from "../reader/slices.ts";
import { controlPlaneQuery, workList, type WorkList } from "./work.ts";

/** A source read again with nothing else new moves only the date a card shows as last checked; that waits this long, and every such re-check in the time shares the one rebuild. A calendar's is brought up to date in the card held, which costs little, so it waits less. */
const FACT_CHECKED_WAIT_MS = 24 * 3_600_000, CALENDAR_CHECKED_WAIT_MS = 3_600_000;

/** One slice of one place that a filed fact belongs to. `wait` is how long its rebuild may wait when all that moved is the date it was last checked. */
export interface SliceMark { readonly placeId: string; readonly card: SliceCard | typeof CONFIRMED; readonly wait?: number }

/**
 * The slices these entities are on, read inside the transaction that filed them so the places are the ones just committed.
 * `places` are places the entities no longer serve; each of their cards changed too.
 */
export async function slicesOf(query: Query, entities: readonly string[], places: readonly string[] = [], wait?: number): Promise<readonly SliceMark[]> {
  const marks = new Map<string, SliceMark>();
  const add = (placeId: string, card: SliceCard) => marks.set(`${placeId}\t${card}`, { placeId, card, wait });
  if (entities.length) for (const row of await query(`SELECT DISTINCT ep.place_id,e.kind FROM entity e JOIN entity_place ep ON ep.entity_id=e.id WHERE e.kind<>'meeting' AND e.id=ANY($1::text[])
    UNION SELECT DISTINCT coalesce(x.entity_id,e.parent_id),e.kind FROM entity e LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=e.parent_id
    WHERE e.kind='meeting' AND e.parent_id IS NOT NULL AND e.id=ANY($1::text[])`, [entities])) for (const card of cardsOfKind(String(row.kind))) add(String(row.place_id), card);
  for (const place of places) for (const card of SLICE_CARDS) add(place, card);
  return [...marks.values()];
}

/** The slices a source read again reaches: at once where something a card shows moved (its page, its quote, its kind), and after the wait where only the date it was last checked did. */
export async function slicesOfConfirmed(query: Query, entities: readonly string[], shown: ReadonlySet<string>): Promise<readonly SliceMark[]> {
  const now = await slicesOf(query, entities.filter(id => shown.has(id))), key = (mark: SliceMark) => `${mark.placeId}\t${mark.card}`, held = new Set(now.map(key));
  return [...now, ...(await slicesOf(query, entities.filter(id => !shown.has(id)), [], FACT_CHECKED_WAIT_MS)).filter(mark => !held.has(key(mark)))];
}

const encodedBoard = /^source:[^:]+:body:([^:]+)/;

/**
 * The slices a published calendar or registration reaches, read after its rows are in place. A calendar's partition reaches the meetings of
 * the boards it holds (a board folded into another is marked under the one it was folded into) and, for a state's family, the places
 * its rows name without a board. A confirmation that nothing changed reaches only the calendar's last-checked time, and a history partition only the history; a new version of a calendar reaches the history too, since the version it replaced may now hold sittings the held window no longer does.
 * A registration reaches the bodies card of every place it names. A registry's runtime model is held on the shelf, whose version moves with the pointer.
 */
async function slicesOfPublication(query: Query, input: { readonly recordClass: string; readonly scope: string; readonly confirmed?: boolean }): Promise<readonly SliceMark[]> {
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
  const cards: readonly SliceMark["card"][] = input.confirmed ? [CONFIRMED] : input.scope.endsWith(":history") ? ["history"] : ["meetings", "agenda", "history"];
  return [...new Set(canonical.map(row => String(row.canonical)))].flatMap(subject => cards.map(card => ({ placeId: subject, card, ...input.confirmed ? { wait: CALENDAR_CHECKED_WAIT_MS } : {} })));
}

let list = (): WorkList => workList(controlPlaneQuery(), { owner: "slide" });
let unavailable = false;
/** A test's own work list stands in for the control-plane database. */
export function markSlicesOn(next: () => WorkList): void { list = next; unavailable = false; }

/** The marks go on the work list as `slice` rows, after the commit. A waiting row is left as it is unless this mark is due sooner, so a burst is one rebuild. The fact is live whatever happens here; a mark that could not be made is said once, and the slice is rebuilt at the next change to its place. */
export async function markSlices(marks: readonly SliceMark[] | Promise<readonly SliceMark[]>): Promise<void> {
  try {
    const waiting = await marks;
    if (waiting.length) await list().touch(waiting.map(mark => ({ kind: "slice" as const, placeId: mark.placeId, subjectId: mark.placeId, field: mark.card,
      origin: { from: "loader" as const }, source: { source: "The Slide filed a fact here" }, ...mark.wait ? { dueAt: new Date(Date.now() + mark.wait).toISOString() } : {} })));
  } catch (error) {
    if (unavailable) return;
    unavailable = true;
    console.error(`Slices could not be marked after a fact was filed (${error instanceof Error ? error.message : String(error)}); each is rebuilt at the next change to its place`);
  }
}

/** After a calendar or registration is published, the slices it reaches are marked. */
export const markPublicationSlices = (query: Query, input: Parameters<typeof slicesOfPublication>[1]): Promise<void> => markSlices(slicesOfPublication(query, input));
