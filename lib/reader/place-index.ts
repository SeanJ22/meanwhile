import type { Query } from "../facts/publish.ts";
import { readStateZipPlaces } from "../place-map/reader.ts";
import { readZipLocations } from "../place-map/locations.ts";
import { stateDivisionId } from "./state-share.ts";

/**
 * One light index per state: every place of the state with what a map needs to choose it, and every ZIP with its places and its point. A place is
 * `[id, kind, name, parent, file, centerLat, centerLng, west, south, east, north]`: kind 0 is a place and 1 a board, the parent is a position in
 * `places` (-1 when it has none), and the file is the name of the place's file. The box is the place's boundary and the center is the box's center.
 * A ZIP is `[lat, lng, states, ids, partial, fringe, districts]`, its places as positions in `places`; its districts are the Census districts reaching
 * into it, which its state's answer is made from beside its ids.
 */
export interface PlaceIndex {
  readonly v: 1;
  readonly state: string;
  /** The name of the national file. */
  readonly national: string;
  /** The ids that start with a slash follow this prefix. */
  readonly base: string;
  readonly places: readonly (readonly [string, 0 | 1, string, number, string, ...(number | null)[]])[];
  /** Board names folded into the boards they became. */
  readonly aliases: Readonly<Record<string, string>>;
  readonly zips: Readonly<Record<string, readonly [number | null, number | null, readonly string[], readonly number[], readonly number[], readonly number[], readonly number[]]>>;
}

export interface PlaceMeta { readonly id: string; readonly kind: "place" | "body"; readonly name: string; readonly parent: string | null; readonly box: readonly number[] | null }
/** A ZIP with its places named by id. */
export interface ZipPlaces { readonly point: readonly [number | null, number | null]; readonly states: readonly string[]; readonly ids: readonly string[]; readonly partial: readonly string[]; readonly fringe: readonly string[]; readonly districts: readonly string[] }

/** A place with the box of its latest boundary. */
const PLACE_META_SQL = `SELECT e.id,e.kind,e.name,e.parent_id AS parent,
  (SELECT b.bounds::text FROM place_boundary b WHERE b.place_id=e.id AND b.bounds IS NOT NULL ORDER BY b.boundary_year DESC LIMIT 1) AS box
  FROM entity e WHERE e.id=ANY($1::text[])`;

/** `(east,north),(west,south)` as [west, south, east, north], to the 4th decimal. */
const boxOf = (text: unknown): readonly number[] | null => {
  const found = typeof text === "string" ? text.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)?.map(Number) : undefined;
  return found?.length === 4 ? [found[2]!, found[3]!, found[0]!, found[1]!].map(value => Math.round(value * 1e4) / 1e4) : null;
};
export const placeMeta = async (query: Query, ids: readonly string[]): Promise<PlaceMeta[]> => ids.length === 0 ? [] :
  (await query(PLACE_META_SQL, [ids])).map(row => ({ id: String(row.id), kind: row.kind === "body" ? "body" : "place", name: String(row.name ?? ""), parent: (row.parent as string | null) ?? null, box: boxOf(row.box) }));

/** The ids of a state's boards that were folded into other boards. */
export const stateAliases = async (query: Query, state: string): Promise<Record<string, string>> =>
  Object.fromEntries((await query(`SELECT x.value,x.entity_id FROM entity_external_id x JOIN entity b ON b.id=x.entity_id AND b.state=$1::char(2) WHERE x.scheme='body-alias'`, [state]))
    .map(row => [String(row.value), String(row.entity_id)]));

/** Every ZIP that touches the state, with its places, its point and the Census districts reaching into it. */
export async function readZipPlaces(state: string, districts: ReadonlyMap<string, readonly string[]>): Promise<Record<string, ZipPlaces>> {
  const entries = await readStateZipPlaces(state), points = await readZipLocations([...entries.keys()]);
  return Object.fromEntries([...entries].map(([zip, entry]) => [zip, { point: [points.get(zip)?.lat ?? null, points.get(zip)?.lng ?? null] as const, states: entry.states ?? [state],
    ids: entry.ids, partial: entry.partial, fringe: entry.fringe ?? [], districts: districts.get(zip) ?? [] }]));
}

const shorten = (base: string, id: string): string => id.startsWith(`${base}/`) ? id.slice(base.length) : id;
export const lengthen = (base: string, id: string): string => id.startsWith("/") ? base + id : id;

/** The index of a state from its places' files and what is known of them. Places a ZIP lists that have no file are left out of its lists. */
export function buildPlaceIndex(state: string, national: string, files: ReadonlyMap<string, string>, meta: ReadonlyMap<string, PlaceMeta>, aliases: Readonly<Record<string, string>>, zips: Readonly<Record<string, ZipPlaces>>): PlaceIndex {
  const base = stateDivisionId(state), ids = [...files.keys()].sort(), at = new Map(ids.map((id, n) => [id, n]));
  const places = ids.map(id => {
    const row = meta.get(id), box = row?.box ?? null;
    const center = box ? [Math.round((box[1]! + box[3]!) * 5e3) / 1e4, Math.round((box[0]! + box[2]!) * 5e3) / 1e4] : [null, null];
    return [shorten(base, id), row?.kind === "body" ? 1 : 0, row?.name ?? "", at.get(row?.parent ?? "") ?? -1, files.get(id)!, ...center, ...(box ?? [null, null, null, null])] as const;
  });
  const listed = (list: readonly string[]) => list.flatMap(id => at.has(id) ? [at.get(id)!] : []);
  return { v: 1, state, national, base, places, aliases,
    zips: Object.fromEntries(Object.entries(zips).map(([zip, row]) => [zip, [row.point[0], row.point[1], row.states, listed(row.ids), listed(row.partial), listed(row.fringe), listed(row.districts)] as const])) };
}

/** What the lane knows of an index it published: where each place's file is, what was known of each place, and its ZIPs. */
export function readPlaceIndex(index: PlaceIndex): { files: Map<string, string>; meta: Map<string, PlaceMeta>; zips: Record<string, ZipPlaces> } {
  const ids = index.places.map(row => lengthen(index.base, row[0])), files = new Map<string, string>(), meta = new Map<string, PlaceMeta>();
  for (const [n, row] of index.places.entries()) {
    files.set(ids[n]!, row[4]);
    meta.set(ids[n]!, { id: ids[n]!, kind: row[1] ? "body" : "place", name: row[2], parent: row[3] >= 0 ? ids[row[3]]! : null, box: row[7] === null || row[7] === undefined ? null : [row[7], row[8]!, row[9]!, row[10]!] });
  }
  const named = (list: readonly number[]) => list.map(n => ids[n]!);
  return { files, meta, zips: Object.fromEntries(Object.entries(index.zips).map(([zip, row]) => [zip, { point: [row[0], row[1]] as const, states: row[2], ids: named(row[3]), partial: named(row[4]), fringe: named(row[5]), districts: named(row[6]) }])) };
}
