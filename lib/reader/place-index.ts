import { createHash } from "node:crypto";
import type { Query } from "../facts/publish.ts";
import { placeMapQuery, readStateZipPlaces } from "../place-map/reader.ts";
import { readZipLocations } from "../place-map/locations.ts";
import { stateDivisionId } from "./state-share.ts";

/**
 * A state publishes small files besides its places' own: a map index, a list of its boards, one ZIP file per three-digit prefix, and a pointer that names
 * them.
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

/**
 * A ZIP file holds the ZIPs of one prefix. `places` lists once each place the prefix's ZIPs read, `[id, file]`; a ZIP is
 * `[lat, lng, states, ids, partial, fringe, districts, key, elsewhere?]` with its places as positions in that list, and, for a ZIP across a state line, the
 * ids that are the other side's. The Census districts are the ones reaching into the ZIP. The key is the answer's: a short hash of the names of every file
 * it reads in every state it touches, the national file and, for Arizona, the bundled territory file. It moves only when one of those does; the address of
 * the assembled answer adds the Eastern day.
 */
export interface ZipFile {
  readonly v: 1;
  readonly state: string;
  readonly places: readonly (readonly [string, string])[];
  readonly zips: Readonly<Record<string, readonly [number | null, number | null, readonly string[], readonly number[], readonly number[], readonly number[], readonly number[], string, ...(readonly (readonly string[])[])[]]>>;
}

/** The one mutable file of a state: the names of its current map index, boards, ZIP files by prefix, and the national file. */
export interface IndexPointer { readonly map: string; readonly boards: string; readonly zip3: Readonly<Record<string, string>>; readonly national: string }

export interface PlaceMeta { readonly id: string; readonly kind: "place" | "body"; readonly name: string; readonly box: readonly number[] | null }
/** A ZIP with its places named by id. */
export interface ZipPlaces { readonly point: readonly [number | null, number | null]; readonly states: readonly string[]; readonly ids: readonly string[]; readonly partial: readonly string[]; readonly fringe: readonly string[]; readonly districts: readonly string[] }

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
      ids: same(entry.ids), partial: same(entry.partial), fringe: same(entry.fringe ?? []), districts: same(districts.get(zip) ?? []) };
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

/** The ZIP files of a state, one per three-digit prefix. `others` gives the local key of each other state a ZIP touches. */
export function buildZipFiles(state: string, files: ReadonlyMap<string, string>, zips: Readonly<Record<string, ZipPlaces>>, national: string, territory: string,
  others: (zip: string, other: string) => string): Record<string, ZipFile> {
  const base = stateDivisionId(state), out: Record<string, { at: Map<string, number>; rows: Record<string, ZipFile["zips"][string]> }> = {};
  for (const [zip, row] of Object.entries(zips)) {
    const group = out[zip.slice(0, 3)] ??= { at: new Map(), rows: {} };
    const at = (id: string) => group.at.get(id) ?? (group.at.set(id, group.at.size), group.at.size - 1);
    const own = localKey(state, files, row, national, territory), listed = (list: readonly string[]) => list.filter(id => files.has(id)).map(at);
    const keys = row.states.length > 1 ? row.states.map(other => other === state ? own : others(zip, other)).sort() : [own];
    const elsewhere = [row.ids, row.partial, row.fringe].map(list => list.filter(id => !files.has(id)));
    at(stateDivisionId(state));
    group.rows[zip] = [row.point[0], row.point[1], row.states, listed(row.ids), listed(row.partial), listed(row.fringe), listed(row.districts), digest(keys, 10),
      ...(elsewhere.some(list => list.length) ? [elsewhere] : [])];
    for (const id of filesOf(state, files, row).keys()) at(id);
  }
  return Object.fromEntries(Object.entries(out).map(([prefix, { at, rows }]) => [prefix, { v: 1, state, places: [...at.keys()].map(id => [shorten(base, id), files.get(id) ?? ""] as const), zips: rows } satisfies ZipFile]));
}

/** What the lane knows of the files it published: where each place's file is, what was known of each place, and its ZIPs. */
export function readPublished(map: MapIndex, boards: BoardsIndex, zip3: readonly ZipFile[]): { files: Map<string, string>; meta: Map<string, PlaceMeta>; zips: Record<string, ZipPlaces> } {
  const files = new Map<string, string>(), meta = new Map<string, PlaceMeta>();
  for (const row of map.places) {
    const id = lengthen(map.base, row[0]);
    files.set(id, row.at(-1) as string);
    meta.set(id, { id, kind: "place", name: row[2], box: row[3] === null || row[3] === undefined ? null : [row[3], row[4], row[5], row[6]] as number[] });
  }
  for (const [short, name, file] of boards.boards) { const id = lengthen(boards.base, short); files.set(id, file); meta.set(id, { id, kind: "body", name, box: null }); }
  const zips: Record<string, ZipPlaces> = {}, pool = new Map<string, string>();
  for (const file of zip3) {
    const id = (n: number) => { const short = file.places[n]![0]; return pool.get(short) ?? (pool.set(short, lengthen(map.base, short)), pool.get(short)!); };
    for (const [zip, row] of Object.entries(file.zips)) {
      const more = row[8] as (readonly string[])[] | undefined;
      zips[zip] = { point: [row[0], row[1]], states: row[2], ids: [...row[3].map(id), ...more?.[0] ?? []], partial: [...row[4].map(id), ...more?.[1] ?? []],
        fringe: [...row[5].map(id), ...more?.[2] ?? []], districts: row[6].map(id) };
    }
  }
  return { files, meta, zips };
}

/** The address of a ZIP's assembled answer: its key and the day (US Eastern) whose meetings it shows. */
export const answerKey = (key: string, now: Date): string => digest([key, now.toLocaleDateString("en-CA", { timeZone: "America/New_York" })], 12);
