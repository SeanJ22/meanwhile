import { createHash } from "node:crypto";
import type { Query } from "../facts/publish.ts";
import { placeMapQuery, readStateZipPlaces } from "../place-map/reader.ts";
import { readZipLocations } from "../place-map/locations.ts";
import { stateDivisionId } from "./state-share.ts";
import type { Zip3File, ZipRow } from "./zip3.ts";

/** The US Eastern day of an instant, as yyyy-mm-dd. A key names the day its answer shows. */
export const easternDay = (instant: Date): string => instant.toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/**
 * A state publishes small files besides its places' own: a map index, a list of its boards, and a pointer that names them. Where a ZIP is lives in the
 * mutable rows of its three-digit prefix (zip3.ts), which the lane writes from every state's local keys.
 *
 * The map index is what a map needs to choose places in view: `[id, kind, name, west, south, east, north, file]`, the box the place's boundary (its
 * center is the box's center) and the file the place's file name. Ids that start with a slash follow `base`. Boards, which have no
 * place on a map, are listed apart as `[id, name, file]`.
 */
export interface MapIndex {
  readonly v: 1;
  readonly state: string;
  readonly base: string;
  readonly places: readonly (readonly [string, 0, string, ...(number | null)[], string])[];
}
export interface BoardsIndex { readonly v: 1; readonly state: string; readonly base: string; readonly boards: readonly (readonly [string, string, string])[] }

/** The one mutable file of a state: the names of its current map index, boards and the national file, and the three-digit prefixes of the ZIPs it touches. */
export interface IndexPointer { readonly map: string; readonly boards: string; readonly national: string; readonly prefixes: readonly string[] }

export interface PlaceMeta { readonly id: string; readonly kind: "place" | "body"; readonly name: string; readonly box: readonly number[] | null }
/** A ZIP with its places named by id. */
export interface ZipPlaces { readonly point: readonly [number | null, number | null]; readonly states: readonly string[]; readonly ids: readonly string[]; readonly partial: readonly string[]; readonly fringe: readonly string[]; readonly districts: readonly string[]; readonly postal?: unknown }

/** A place with the box of its latest boundary. */
const PLACE_META_SQL = `SELECT e.id,e.kind,e.name,
  (SELECT b.bounds::text FROM place_boundary b WHERE b.place_id=e.id AND b.bounds IS NOT NULL ORDER BY b.boundary_year DESC LIMIT 1) AS box
  FROM entity e WHERE e.id=ANY($1::text[])`;

/** `(east,north),(west,south)` as [west, south, east, north], to the 3rd decimal (about 100 m). */
const boxOf = (text: unknown): readonly number[] | null => {
  const found = typeof text === "string" ? text.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi)?.map(Number) : undefined;
  return found?.length === 4 ? [found[2]!, found[3]!, found[0]!, found[1]!].map(value => Math.round(value * 1e3) / 1e3) : null;
};
export const placeMeta = async (query: Query, ids: readonly string[]): Promise<PlaceMeta[]> => ids.length === 0 ? [] :
  (await query(PLACE_META_SQL, [ids])).map(row => ({ id: String(row.id), kind: row.kind === "body" ? "body" : "place", name: String(row.name ?? ""), box: boxOf(row.box) }));

/** Every ZIP that touches the state, with its places, its point and the Census districts reaching into it. They are read a prefix at a time, so only a prefix's memberships are in memory at once. */
export async function readZipPlaces(state: string, districts: ReadonlyMap<string, readonly string[]>): Promise<Record<string, ZipPlaces>> {
  const out: Record<string, ZipPlaces> = {}, pool = new Map<string, string>();
  // The same place is named by many ZIPs: one copy of each id is kept.
  const same = (ids: readonly string[]) => ids.map(id => pool.get(id) ?? (pool.set(id, id), id));
  for (const { prefix } of await placeMapQuery()(`SELECT DISTINCT left(m.zip,3) AS prefix FROM zip_place m JOIN entity e ON e.id=m.place_id WHERE e.state=$1::char(2) AND e.kind='place' ORDER BY 1`, [state])) {
    const entries = await readStateZipPlaces(state, undefined, String(prefix)), points = await readZipLocations([...entries.keys()]);
    for (const [zip, entry] of entries) out[zip] = { point: [points.get(zip)?.lat ?? null, points.get(zip)?.lng ?? null] as const, states: entry.states ?? [state],
      ids: same(entry.ids), partial: same(entry.partial), fringe: same(entry.fringe ?? []), districts: same(districts.get(zip) ?? []),
      ...(points.get(zip)?.postal ? { postal: points.get(zip)!.postal } : {}) };
  }
  return out;
}

const shorten = (base: string, id: string): string => id.startsWith(`${base}/`) ? id.slice(base.length) : id;
export const lengthen = (base: string, id: string): string => id.startsWith("/") ? base + id : id;
const digest = (parts: readonly string[], length: number): string => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, length);

export function buildMapIndex(state: string, files: ReadonlyMap<string, string>, meta: ReadonlyMap<string, PlaceMeta>): { map: MapIndex; boards: BoardsIndex } {
  const base = stateDivisionId(state), ids = [...files.keys()].sort(), kind = (id: string) => meta.get(id)?.kind === "body";
  return { map: { v: 1, state, base, places: ids.filter(id => !kind(id)).map(id => {
    const box = meta.get(id)?.box ?? null;
    return [shorten(base, id), 0, meta.get(id)?.name ?? "", ...(box ?? [null, null, null, null]), files.get(id)!] as const;
  }) }, boards: { v: 1, state, base, boards: ids.filter(kind).map(id => [shorten(base, id), meta.get(id)?.name ?? "", files.get(id)!] as const) } };
}

/** The names of the files a ZIP's answer reads in this state, by id. */
function filesOf(state: string, files: ReadonlyMap<string, string>, row: ZipPlaces): Map<string, string> {
  return new Map([...new Set([stateDivisionId(state), ...row.ids, ...row.fringe, ...row.districts])].sort().flatMap(id => files.has(id) ? [[id, files.get(id)!] as const] : []));
}
/** What a state's files say of one ZIP, apart from the other states it touches. */
export const localKey = (state: string, files: ReadonlyMap<string, string>, row: ZipPlaces, national: string, territory: string): string =>
  digest([...filesOf(state, files, row).values(), national, territory], 10);

/**
 * The rows of the ZIPs a state is the first state of, by three-digit prefix (zip3.ts). A ZIP across a state line has one key for every state it touches, so
 * `others` gives the local key of each other state. The row names every district the ZIP lies in, those of the other state included when it has published.
 */
export function buildZipRows(state: string, files: ReadonlyMap<string, string>, zips: Readonly<Record<string, ZipPlaces>>, national: string, territory: string,
  others: (zip: string, other: string, row: ZipPlaces) => { readonly key: string; readonly districts: readonly string[] }, now: Date): Record<string, Record<string, ZipRow>> {
  const out: Record<string, Record<string, ZipRow>> = {}, day = easternDay(now);
  for (const [zip, row] of Object.entries(zips)) {
    if (row.states[0] !== state) continue;
    const own = localKey(state, files, row, national, territory), districts = new Set(row.districts);
    const keys = row.states.length > 1 ? row.states.map(other => { if (other === state) return own; const found = others(zip, other, row); found.districts.forEach(id => districts.add(id)); return found.key; }).sort() : [own];
    (out[zip.slice(0, 3)] ??= {})[zip] = { states: row.states, point: row.point[0] === null || row.point[1] === null ? null : [row.point[1], row.point[0]], key: answerKey(keys, now), day,
      ids: [...row.ids].sort(), partial: [...row.partial].sort(), fringe: [...row.fringe].sort(), districts: [...districts].sort(), ...(row.postal ? { postal: row.postal } : {}) };
  }
  return out;
}

/** What the lane knows of the files it published: where each place's file is, what was known of each place, and the ZIPs the state touches (from the rows of its prefixes). */
export function readPublished(state: string, map: MapIndex, boards: BoardsIndex, rows: readonly Zip3File[]): { files: Map<string, string>; meta: Map<string, PlaceMeta>; zips: Record<string, ZipPlaces> } {
  const files = new Map<string, string>(), meta = new Map<string, PlaceMeta>();
  for (const row of map.places) {
    const id = lengthen(map.base, row[0]);
    files.set(id, row.at(-1) as string);
    meta.set(id, { id, kind: "place", name: row[2], box: row[3] === null || row[3] === undefined ? null : [row[3], row[4], row[5], row[6]] as number[] });
  }
  for (const [short, name, file] of boards.boards) { const id = lengthen(boards.base, short); files.set(id, file); meta.set(id, { id, kind: "body", name, box: null }); }
  const zips: Record<string, ZipPlaces> = {};
  for (const file of rows) for (const [zip, row] of Object.entries(file.zips)) {
    if (row.states.includes(state)) zips[zip] = { point: row.point ? [row.point[1], row.point[0]] : [null, null], states: row.states, ids: row.ids, partial: row.partial, fringe: row.fringe, districts: row.districts,
      ...(row.postal ? { postal: row.postal } : {}) };
  }
  return { files, meta, zips };
}

/** Raised only when the shape of the assembled answer changes, so a deploy that changes it moves every key and one that does not keeps every cached answer. */
export const ANSWER_FORMAT = 1;

/** The address of a ZIP's assembled answer: the format of the answer, the keys of the ZIP in each state it touches, and the day (US Eastern) whose meetings it shows. */
export const answerKey = (keys: readonly string[], now: Date): string => digest([`format:${ANSWER_FORMAT}`, ...keys, easternDay(now)], 12);
