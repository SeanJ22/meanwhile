import { districtFamilyKey } from "../census-geography/division-id.ts";
import type { ReaderArtifactStore } from "../meetings/edge-store.ts";
import { readReaderMeetingSettings } from "../meetings/reader-settings.ts";
import type { PlaceEntry } from "../place-map/reader.ts";
import type { Meeting } from "../sources/types.ts";
import type { PlaceInput } from "./place-types.ts";
import { DEFAULT_RADIUS_KM } from "../meetings/constants.ts";
import { stateCoverage } from "./coverage.ts";
import { locationFromEntry, readLocationPlace, readerTerritory } from "./location.ts";
import { composeMeetingsAnswer } from "./meetings-answer.ts";
import { loadPlaceFromFiles, type PlaceFile } from "./place-file.ts";
import { openPlaceFiles } from "./place-files.ts";
import { lengthen, type PlaceIndex } from "./place-index.ts";
import { stateResponseHeaders } from "./state-response.ts";
import { stateAnswerFromFiles } from "./zip-files.ts";
import type { ZipRow } from "./zip3.ts";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- the answer's records of many shapes, read by field

/** The addresses of a ZIP's answer and of a board's detail. A board's id carries characters a path cannot. */
export const answerPath = (zip: string, key: string): string => `/api/answer/${zip}/${key}`;
export const boardPath = (bodyId: string, version: string): string => `/api/answer/board/${encodeURIComponent(bodyId)}/${version}`;

/* ---- the day the answer is for -------------------------------------------------------------------------------------- */

/** The US Eastern day of an instant, as yyyy-mm-dd. A key names the day its answer shows. */
export const easternDay = (instant: Date): string => instant.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hourCycle: "h23" });
/** The first instant of a US Eastern day: the answer is made as of then, so what it shows is right the whole day. */
export function easternDayStart(day: string): Date {
  for (const offset of [4, 5]) {
    const start = new Date(`${day}T0${offset}:00:00Z`);
    if (easternDay(start) === day && Number(hourFormat.format(start)) === 0) return start;
  }
  throw new Error(`EASTERN_DAY_INVALID:${day}`);
}

/* ---- the boards ------------------------------------------------------------------------------------------------------ */

/** A state's boards by id: the version of each board's file. An id folded into another board is the board it became. */
const boardsOf = (() => {
  const held = new WeakMap<PlaceIndex, ReadonlyMap<string, string>>();
  return (index: PlaceIndex): ReadonlyMap<string, string> => {
    let boards = held.get(index);
    if (!boards) held.set(index, boards = new Map(index.places.filter(row => row[1] === 1).map(row => [lengthen(index.base, row[0]), row[4]])));
    return boards;
  };
})();
export const boardVersion = (index: PlaceIndex, bodyId: string): { readonly id: string; readonly version: string } | null => {
  const id = index.aliases[bodyId] ?? bodyId, version = boardsOf(index).get(id);
  return version ? { id, version } : null;
};

/* ---- one ZIP's answer ------------------------------------------------------------------------------------------------ */

/** The place map's entry for a ZIP, as its row of the ZIP file gives it. */
const entryOf = (row: ZipRow): PlaceEntry & { readonly districts: readonly string[] } => ({ ids: row.ids, partial: row.partial, samples: 0, states: row.states, districts: row.districts,
  qualifiedDistricts: [...new Set(row.ids.flatMap(id => districtFamilyKey(id) ?? []))], ...(row.fringe.length ? { fringe: row.fringe } : {}) });

/** What `/api/meetings?zip=&include=state` answers, made from published files alone. Nothing here reads a database. */
export async function assembleFullAnswer(store: ReaderArtifactStore, zip: string, row: ZipRow, day: string): Promise<{ readonly answer: Row; readonly indexes: ReadonlyMap<string, PlaceIndex> }> {
  if (!row.point) throw new Error(`ZIP_HAS_NO_POINT:${zip}`);
  const files = openPlaceFiles(store), entry = entryOf(row), location = locationFromEntry(entry, zip), [lng, lat] = row.point;
  const sources = new Map(await Promise.all(row.states.map(async state => [state, await files.source(state)] as const)));
  const indexes = new Map(await Promise.all(row.states.map(async state => [state, (await files.index(state))!.index] as const)));
  const territory = await readerTerritory(location.state);
  const load = (input: PlaceInput) => loadPlaceFromFiles(input, sources.get(input.state)!);
  const [place, settings, value] = await Promise.all([readLocationPlace(location, lat, lng, territory, load), readReaderMeetingSettings(),
    stateAnswerFromFiles(sources.get(location.state)!, location.state, zip, entry)]);
  const stateResponse = { status: 200, headers: [...new Headers({ "content-type": "application/json", ...stateResponseHeaders(location.state, value.version, zip) })], value };
  const { answer } = await composeMeetingsAnswer({ location, lat, lng, radiusKm: DEFAULT_RADIUS_KM, now: easternDayStart(day), place, state: null, settings, territory, stateResponse });
  return { answer, indexes };
}

/** The fields of a meeting that its board's detail holds in place of the answer: its sources, conflicts and provenance. */
const MOVED_MEETING = ["fieldSources", "publicationConflicts", "provenance"] as const;

/** An answer with its heavy parts left at their boards. A body or meeting whose board has no file keeps them. */
export function slimAnswer(full: Row, detail: (bodyId: string) => string | null): Row {
  const bodies = (list: readonly Row[]) => list.map(body => {
    const url = detail(body.bodyId);
    if (!url || !body.readerRoster) return body;
    const { readerRoster, fieldSources: _sources, ...rest } = body;
    return { ...rest, readerRoster: { count: readerRoster.members.length, detail: url } };
  });
  const meetings = (list: readonly Row[]) => list.map(meeting => {
    const url = meeting.bodyId ? detail(meeting.bodyId) : null;
    if (!url) return meeting;
    const { fieldSources: _a, publicationConflicts: _b, provenance: _c, ...rest } = meeting;
    return { ...rest, detail: url };
  });
  const state = full.stateResponse?.value;
  return { ...full, meetings: meetings(full.meetings), coverage: { ...full.coverage, bodies: bodies(full.coverage.bodies) },
    ...(state ? { stateResponse: { ...full.stateResponse, value: { ...state, coverage: { ...state.coverage, bodies: bodies(state.coverage.bodies) } } } } : {}) };
}

/** A ZIP's answer as it is published. */
export async function assembleAnswer(store: ReaderArtifactStore, zip: string, row: ZipRow, day: string): Promise<Row> {
  const { answer, indexes } = await assembleFullAnswer(store, zip, row, day);
  return slimAnswer(answer, bodyId => { for (const index of indexes.values()) { const board = boardVersion(index, bodyId); if (board) return boardPath(board.id, board.version); } return null; });
}

/* ---- one board's detail ---------------------------------------------------------------------------------------------- */

export interface BoardDetail {
  readonly bodyId: string;
  readonly readerRoster: unknown;
  readonly fieldSources: unknown;
  /** The sources, conflicts and provenance of the board's meetings, by meeting id. */
  readonly meetings: Readonly<Record<string, Row>>;
}

/** What a board's answer parts say, from the board's own file. */
export async function assembleBoard(store: ReaderArtifactStore, file: PlaceFile): Promise<BoardDetail> {
  const state = file.state!, source = await openPlaceFiles(store).source(state), id = file.id;
  const place = await loadPlaceFromFiles({ state, divisionIds: [], bodyIds: [id], placeId: `board:${id}` }, source);
  const body = place.registry!.registry.bodies.find(candidate => candidate.id === id);
  const served = body ? [...(body.ocdId ? [body.ocdId] : []), ...(body.alsoServesOcdIds ?? [])] : [];
  const coverage = stateCoverage({ state, registry: place.registry!, version: place.snapshot.generatedAt }, served, 0, 0, place.meetings, place.bodies, place.divisions);
  const covered = coverage.bodies.find(candidate => candidate.bodyId === id);
  const meetings = Object.fromEntries((place.meetings as readonly Meeting[]).filter(meeting => meeting.bodyId === id).flatMap(meeting => {
    const moved = Object.fromEntries(MOVED_MEETING.filter(field => meeting[field] !== undefined).map(field => [field, meeting[field]]));
    return Object.keys(moved).length ? [[meeting.id, moved]] : [];
  }));
  return { bodyId: id, readerRoster: covered?.readerRoster ?? null, fieldSources: covered?.fieldSources ?? null, meetings };
}
