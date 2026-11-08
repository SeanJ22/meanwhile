import type { PostalArea } from "../geo/postal-core.ts";
import type { ZctaCentroid } from "../geo/zcta-core.ts";
import type { CoverageSummary, CoveredBody } from "../registry/coverage.ts";
import type { MeetingSearchResult } from "../meetings/query.ts";
import type { Meeting } from "../sources/types.ts";
import { fetchReaderResponse, readReaderJson } from "./bootstrap.ts";
import type { ReaderStateResponse } from "./client.ts";

/**
 * A published ZIP is read as two small files, the same for every reader: the ZIP3 file names the ZIP's point and its answer's version, and the
 * answer is the whole page for the ZIP. A board's roster and the sources of a board and its meetings arrive when a reader opens them.
 */
export interface Zip3Entry {
  readonly states: readonly string[];
  readonly point: readonly [number, number];
  /** The version stamp in the answer's address. */
  readonly key: string;
  readonly ids: readonly string[];
  readonly partial: readonly string[];
  readonly fringe: readonly string[];
  /** What kind of mail ZIP this is, when the file says; the mail-only notice reads it. */
  readonly postal?: PostalArea;
}
export interface Zip3File { readonly v: 1; readonly zips: Readonly<Record<string, Zip3Entry>> }

export const zip3Url = (zip: string): string => `/api/reader/zip3/${zip.slice(0, 3)}.json`;
export const answerUrl = (zip: string, key: string): string => `/api/answer/${zip}/${key}`;

/** What a board's detail file holds, keyed by what the answer left out. */
export interface BoardDetail {
  readonly bodyId?: string;
  readonly readerRoster?: NonNullable<CoveredBody["readerRoster"]>;
  readonly fieldSources?: CoveredBody["fieldSources"];
  readonly meetings?: Readonly<Record<string, Pick<Meeting, "fieldSources" | "publicationConflicts" | "provenance">>>;
}

type SlimBody = Omit<CoveredBody, "readerRoster" | "fieldSources"> & { readerRoster?: { count: number; detail: string } | CoveredBody["readerRoster"] };
type SlimCoverage = Omit<CoverageSummary, "bodies"> & { bodies: SlimBody[] };
/** The answer as published: today's meetings-with-state body, without what a first look does not read. */
export type SlimAnswer = Omit<MeetingSearchResult, "coverage" | "meetings"> & {
  coverage: SlimCoverage | null;
  meetings: Meeting[];
  stateResponse?: Omit<ReaderStateResponse, "coverage"> & { coverage: SlimCoverage };
};
export type ReaderAnswer = MeetingSearchResult & { nearZip?: string | null; stateResponse?: ReaderStateResponse };

const ZIP3_KEPT_MS = 10 * 60_000;
const zip3Files = new Map<string, { promise: Promise<Zip3File | null>; expires: number }>();

/** One ZIP3 file per prefix: null when the file is missing, which sends the ZIP to the database routes. */
export function loadZip3(zip: string): Promise<Zip3File | null> {
  const prefix = zip.slice(0, 3), held = zip3Files.get(prefix);
  if (held && held.expires > Date.now()) return held.promise;
  const promise = fetchReaderResponse(zip3Url(zip), { headers: { accept: "application/json" } }).then(async response => {
    if (!response.ok) return null;
    const file = await readReaderJson<Zip3File>(response);
    return file?.v === 1 && file.zips ? file : null;
  }).catch(() => null).then(file => {
    if (!file && zip3Files.get(prefix)?.promise === promise) zip3Files.delete(prefix);
    return file;
  });
  zip3Files.set(prefix, { promise, expires: Date.now() + ZIP3_KEPT_MS });
  return promise;
}

/** The ZIP's entry, or null when its state is not published yet. */
export const loadZipEntry = async (zip: string): Promise<Zip3Entry | null> => (await loadZip3(zip))?.zips[zip] ?? null;

export const centroidOfEntry = (zip: string, entry: Zip3Entry): ZctaCentroid =>
  ({ zip, lat: entry.point[0], lng: entry.point[1], ...(entry.states[0] ? { state: entry.states[0] } : {}), ...(entry.postal ? { postal: entry.postal } : {}) });

/** A stale key answers with a redirect to the current one, which the browser follows. Null when no answer is published under the key. */
export async function loadAnswer(zip: string, entry: Zip3Entry, signal?: AbortSignal): Promise<ReaderAnswer | null> {
  const response = await fetchReaderResponse(answerUrl(zip, entry.key), { headers: { accept: "application/json" }, ...(signal ? { signal } : {}) });
  if (response.status === 404) return null;
  if (!response.ok) throw Object.assign(new Error(`Answer request failed: ${response.status}`), { status: response.status });
  return expandAnswer(await readReaderJson<SlimAnswer>(response));
}

const lightRoster = (roster: SlimBody["readerRoster"]): roster is { count: number; detail: string } => !!roster && "detail" in roster && typeof roster.detail === "string";

/** The page's shape: a light roster becomes a reference the card follows, and everything else stays as sent. */
function expandCoverage<T extends SlimCoverage | null>(coverage: T): T extends null ? null : CoverageSummary {
  if (!coverage) return null as never;
  return { ...coverage, bodies: coverage.bodies.map(({ readerRoster, ...body }) =>
    lightRoster(readerRoster) ? { ...body, readerRosterRef: readerRoster } : readerRoster ? { ...body, readerRoster } : body) } as never;
}

export function expandAnswer(slim: SlimAnswer): ReaderAnswer {
  const { coverage, stateResponse, ...rest } = slim;
  return { ...rest, coverage: expandCoverage(coverage),
    ...(stateResponse ? { stateResponse: { ...stateResponse, coverage: expandCoverage(stateResponse.coverage) } } : {}) } as ReaderAnswer;
}

const details = new Map<string, Promise<BoardDetail>>();

/** A board's detail file, fetched once: it never changes under its address. */
export function loadBoardDetail(url: string): Promise<BoardDetail> {
  const held = details.get(url);
  if (held) return held;
  const promise = fetch(url, { headers: { accept: "application/json" } }).then(response => {
    if (!response.ok) throw new Error(`Detail request failed: ${response.status}`);
    return response.json() as Promise<BoardDetail>;
  });
  details.set(url, promise);
  promise.catch(() => { if (details.get(url) === promise) details.delete(url); });
  return promise;
}

/** The address of the detail that belongs to a board of the answer: its light roster's, or the one its meetings name. */
export function detailUrlOfBody(result: Pick<MeetingSearchResult, "coverage" | "meetings">, bodyId: string): string | null {
  const body = result.coverage?.bodies.find(row => row.bodyId === bodyId);
  return body?.readerRosterRef?.detail ?? result.meetings.find(meeting => meeting.bodyId === bodyId && meeting.detail)?.detail ?? null;
}

const merge = <T extends object>(base: T, extra: Partial<T>): T => ({ ...base, ...Object.fromEntries(Object.entries(extra).filter(([, value]) => value !== undefined)) });

/** The answer with one board's detail filled in; the same object when there is nothing to add. */
export function withBoardDetail<T extends Pick<MeetingSearchResult, "coverage" | "meetings">>(result: T, bodyId: string, detail: BoardDetail): T {
  const body = result.coverage?.bodies.find(row => row.bodyId === bodyId);
  const meetings = detail.meetings ?? {};
  const wanted = result.meetings.some(meeting => meeting.bodyId === bodyId && meetings[meeting.id] && !meeting.provenance);
  if (!body && !wanted) return result;
  return { ...result,
    coverage: result.coverage && body ? { ...result.coverage, bodies: result.coverage.bodies.map(row => row.bodyId === bodyId
      ? merge(row, { readerRoster: detail.readerRoster, fieldSources: detail.fieldSources }) : row) } : result.coverage,
    meetings: result.meetings.map(meeting => meeting.bodyId === bodyId && meetings[meeting.id] ? merge(meeting, meetings[meeting.id]!) : meeting) };
}
