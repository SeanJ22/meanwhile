import type { Meeting } from "../sources/types.ts";

/**
 * The map reads one light index per state and a place's own file only when the view is close enough to show its meetings. Every file is the same for
 * everyone and named by its version, so a file is fetched once; only a state's pointer moves.
 *
 * An index place is `[id, kind, name, parent, file, centerLat, centerLng, west, south, east, north]` (see lib/reader/place-index.ts); an id that starts
 * with a slash follows the index's `base`.
 */
type IndexRow = readonly [string, 0 | 1, string, number, string, ...(number | null)[]];
interface IndexFile { readonly v: 1; readonly state: string; readonly base: string; readonly places: readonly IndexRow[] }

export interface IndexPlace {
  readonly id: string;
  readonly kind: "place" | "body";
  readonly name: string;
  readonly file: string;
  /** [west, south, east, north] */
  readonly box: readonly [number, number, number, number];
}
export interface StateIndex { readonly state: string; readonly places: readonly IndexPlace[] }
export interface ViewBox { readonly west: number; readonly south: number; readonly east: number; readonly north: number }

/**
 * Meeting pins draw from place files only when the view is close enough to hold few places. Below zoom 10 a phone-width view spans more than about
 * 45 km, the places in it run to hundreds, and the state-level view stays. At zoom 10 and above a view draws only when it holds at most 40 places:
 * a dense metro reaches that count a zoom or two later than open country, which is the point of a cap.
 */
export const MIN_PIN_ZOOM = 10;
export const MAX_VIEW_FILES = 40;

const POINTER_KEPT_MS = 60_000;
const indexes = new Map<string, { promise: Promise<StateIndex | null>; expires: number }>();
const files = new Map<string, Promise<unknown>>();

const fetchJson = async <T>(url: string, signal?: AbortSignal): Promise<T | null> => {
  const response = await fetch(url, { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
  return response.ok ? await response.json() as T : null;
};

const lengthen = (base: string, id: string): string => id.startsWith("/") ? base + id : id;

/** A state's index, read through its pointer: null when the state has none published. */
export function loadStateIndex(state: string): Promise<StateIndex | null> {
  const held = indexes.get(state);
  if (held && held.expires > Date.now()) return held.promise;
  const promise = (async () => {
    const pointer = await fetchJson<{ index: string }>(`/api/reader/index/${state}.json`);
    const index = pointer && await fetchFile<IndexFile>(pointer.index);
    return index ? { state, places: index.places.flatMap((row): IndexPlace[] => row[7] === null || row[7] === undefined ? []
      : [{ id: lengthen(index.base, row[0]), kind: row[1] ? "body" : "place", name: row[2], file: row[4], box: [row[7], row[8]!, row[9]!, row[10]!] }]) } : null;
  })().catch(() => null).then(index => {
    if (!index && indexes.get(state)?.promise === promise) indexes.delete(state);
    return index;
  });
  indexes.set(state, { promise, expires: Date.now() + POINTER_KEPT_MS });
  return promise;
}

/** A file by its name: fetched once, since a name is a version and never changes. */
export function fetchFile<T>(name: string, signal?: AbortSignal): Promise<T | null> {
  const held = files.get(name);
  if (held) return held as Promise<T | null>;
  const promise = fetchJson<T>(`/api/reader/files/${name}.json`, signal);
  files.set(name, promise);
  promise.then(value => { if (value === null) files.delete(name); }, () => { if (files.get(name) === promise) files.delete(name); });
  return promise;
}

const intersects = (box: IndexPlace["box"], view: ViewBox): boolean =>
  box[0] <= view.east && box[2] >= view.west && box[1] <= view.north && box[3] >= view.south;

/**
 * What a settled view draws: the files of the places in view, or "zoom" when the view is too wide or holds too many places. A place larger than the
 * view's own width is a county or state around it; its meetings are not a view of this spot, so it is left to the card that opens it.
 */
export function placesForView(indexList: readonly StateIndex[], view: ViewBox, zoom: number): { readonly draw: false } | { readonly draw: true; readonly places: readonly IndexPlace[] } {
  if (!(zoom >= MIN_PIN_ZOOM)) return { draw: false };
  const width = view.east - view.west, height = view.north - view.south;
  const within = indexList.flatMap(index => index.places).filter(place => intersects(place.box, view)
    && place.box[2] - place.box[0] <= width * 2 && place.box[3] - place.box[1] <= height * 2);
  const unique = [...new Map(within.map(place => [place.file, place])).values()];
  return unique.length > MAX_VIEW_FILES ? { draw: false } : { draw: true, places: unique };
}

/** The place the index holds under this id, for a tap. */
export const placeById = (indexList: readonly StateIndex[], id: string): IndexPlace | null =>
  indexList.flatMap(index => index.places).find(place => place.id === id) ?? null;

/** The light fields a pin and its row need; everything else on a meeting waits for its card. */
const PIN_FIELDS = ["id", "ocdId", "bodyId", "bodyName", "title", "startsAt", "startPrecision", "timeZone", "status", "location", "mapPin", "online", "venueGap", "jurisdiction", "detail"] as const;

type Row = Record<string, unknown>;
const isMeeting = (value: unknown): value is Meeting => !!value && typeof value === "object" && typeof (value as Row).id === "string" && typeof (value as Row).startsAt === "string";

/**
 * The meetings a place's file lists, with only pin fields (or whole, for the place a reader opened). A file lists them as `pins`, or inside its current page; a page whose rows are not in the
 * file (held as parts) lists none here.
 */
export function pinsOfPlaceFile(file: unknown, whole = false): Meeting[] {
  const found = (file as { pins?: unknown } | null)?.pins;
  const inline = (((file as { variants?: { current?: { row?: { meeting_rows?: unknown } } } } | null)?.variants?.current?.row?.meeting_rows) as { payload?: { meetings?: unknown } }[] | undefined)
    ?.flatMap(part => Array.isArray(part.payload?.meetings) ? part.payload!.meetings as unknown[] : []);
  const listed = [...(Array.isArray(found) ? found : inline ?? [])].filter(isMeeting);
  if (whole) return listed;
  return listed.map(meeting => {
    const light: Row = {};
    for (const field of PIN_FIELDS) if ((meeting as unknown as Row)[field] !== undefined) light[field] = (meeting as unknown as Row)[field];
    return light as unknown as Meeting;
  });
}
