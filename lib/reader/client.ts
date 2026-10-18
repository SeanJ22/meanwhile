import type { CoverageSummary } from "../registry/coverage.ts";
import { WIRED_STATUSES } from "../registry/coverage-client.ts";
import type { DirectoryFile } from "../officials/directory.ts";
import type { ZipDivisionEntry } from "../geo/zip-division-index.ts";
import type { MeetingSearchResult } from "../meetings/query.ts";
import { representationForDivision } from "../registry/representation.ts";
import { projectedRosterGapsForDivision } from "../registry/body-roster-client.ts";
import { fetchReaderResponse, readReaderJson } from "./bootstrap.ts";
import type { StateMemberDirectory } from "../../hooks/use-member-directory.ts";

export interface ReaderStateResponse {
  state: string;
  version: string;
  coverage: CoverageSummary;
  zipPlaces: Record<string, ZipDivisionEntry>;
  directory: DirectoryFile | null;
  memberDirectories?: readonly StateMemberDirectory[];
  boundaryUrl: string;
}

const stateCache = new Map<string, { promise: Promise<ReaderStateResponse>; expires: number; value?: ReaderStateResponse }>();

/** Only the state package's own families are authoritative here; local governments use place facts. */
function stateCacheForDivision(ocdId: string) {
  const match = /^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/(?:cd|sldu|sldl):[^/#]+)?$/.exec(ocdId);
  if (!match) return null;
  return stateCache.get(match[1].toUpperCase()) ?? null;
}

export function getCachedStateCoverageForDivision(ocdId: string): CoverageSummary | null {
  const held = stateCacheForDivision(ocdId);
  return held?.value && held.expires > Date.now() ? held.value.coverage : null;
}

/** Map geometry can arrive before the state's people; it must not start duplicate district requests. */
export function isStateDivisionPending(ocdId: string): boolean {
  const held = stateCacheForDivision(ocdId);
  return held?.expires === Infinity && !held.value;
}

/** A held empty state seat is an answer; it never triggers another representation request. */
export function getCachedStateDivision(ocdId: string) {
  const coverage = getCachedStateCoverageForDivision(ocdId);
  if (!coverage) return null;
  const root = /^ocd-division\/country:us\/(?:state|district|territory):[a-z]{2}$/.test(ocdId);
  const holders = root
    ? [...new Map([...coverage.senators, ...coverage.statewideExecutives].map(holder => [holder.id, holder])).values()]
    : representationForDivision(coverage, ocdId);
  const division = coverage.divisions.find(row => row.ocdId === ocdId) ?? coverage.seats.find(row => row.ocdId === ocdId);
  return { holders, label: division?.label ?? null, divisionType: division?.divisionType ?? null, tier: division?.tier ?? null,
    rosterGaps: projectedRosterGapsForDivision(coverage, ocdId) };
}

/** The whole state is shared by subsequent ZIPs and card clicks for thirty seconds. */
export function loadReaderState(state: string): Promise<ReaderStateResponse> {
  const code = state.toUpperCase().replace(/^US-/, "");
  const held = stateCache.get(code);
  if (held && held.expires > Date.now()) return held.promise;
  const promise: Promise<ReaderStateResponse> = fetchReaderResponse(`/api/reader/state?state=${encodeURIComponent(code)}`, {
    headers: { accept: "application/json" },
  }).then(async response => {
    if (!response.ok) throw new Error(`State request failed: ${response.status}`);
    const value = await readReaderJson<ReaderStateResponse>(response);
    if (stateCache.get(code)?.promise === promise) stateCache.set(code, { promise, value, expires: Date.now() + 30_000 });
    return value;
  }).catch(error => {
    if (stateCache.get(code)?.promise === promise) stateCache.delete(code);
    throw error;
  });
  stateCache.set(code, { promise, expires: Infinity });
  return promise;
}

function withCounts(coverage: CoverageSummary, meetingCount: number): CoverageSummary {
  const { bodies, seats } = coverage;
  const withSource = bodies.filter(body => WIRED_STATUSES.has(body.coverageStatus)).length;
  const governing = bodies.filter(body => body.bodyClass === "GOVERNING");
  return {
    ...coverage,
    state: meetingCount ? "MEETINGS" : !bodies.length ? "UNMAPPED" : governing.some(body => !WIRED_STATUSES.has(body.coverageStatus)) ? "NO_SOURCE" : "NONE_SCHEDULED",
    counts: {
      total: bodies.length, withSource, withoutSource: bodies.length - withSource,
      lookedAt: bodies.filter(body => body.lookedAt).length,
      governing: { total: governing.length, withSource: governing.filter(body => WIRED_STATUSES.has(body.coverageStatus)).length },
    },
    seatCounts: { total: seats.length, named: seats.filter(seat => seat.representatives.length > 0).length },
  };
}

/** A state package is complete for its state; a ZIP displays only the divisions it touches. */
export function stateCoverageForZip(state: ReaderStateResponse, zip: string, resolved?: ZipDivisionEntry): CoverageSummary | null {
  const entry = resolved ?? state.zipPlaces[zip];
  // Mail-only ZIPs can lack a district index. Their state's senators and executives still serve them.
  const ids = new Set(entry?.ids ?? []);
  const partial = new Set(entry?.partial ?? []);
  return withCounts({
    ...state.coverage,
    bodies: state.coverage.bodies.filter(body => body.ocdId && ids.has(body.ocdId.split("#")[0]))
      .map(body => ({ ...body, couldGovern: !!body.ocdId && partial.has(body.ocdId.split("#")[0]) })),
    seats: state.coverage.seats.filter(seat => seat.ocdId === "ocd-division/country:us" || ids.has(seat.ocdId)),
    divisions: state.coverage.divisions.filter(division => ids.has(division.ocdId)),
  }, 0);
}

function mergeRows<T>(base: readonly T[], local: readonly T[], key: (row: T) => string): T[] {
  return [...new Map([...base, ...local].map(row => [key(row), row])).values()];
}

export function mergeReaderCoverage(state: CoverageSummary | null, place: CoverageSummary | null, meetingCount: number): CoverageSummary | null {
  if (!state || !place) return place ?? state;
  return withCounts({
    ...state, ...place,
    bodies: mergeRows(state.bodies, place.bodies, row => row.bodyId),
    seats: mergeRows(state.seats, place.seats, row => row.ocdId),
    divisions: mergeRows(state.divisions, place.divisions, row => row.ocdId),
    senators: mergeRows(state.senators, place.senators, row => row.id),
    statewideExecutives: mergeRows(state.statewideExecutives, place.statewideExecutives, row => row.id),
  }, meetingCount);
}

/** Both requests start before either is awaited. State is published first, even if place wins the race. */
export async function loadStateAndPlace<T extends MeetingSearchResult>(options: {
  state: () => Promise<ReaderStateResponse | null>;
  place: () => Promise<T>;
  signal: AbortSignal;
  onState: (state: ReaderStateResponse) => void;
  onPlace: (place: T, state: ReaderStateResponse | null) => void;
}): Promise<void> {
  const state = options.state().catch(() => null).then(value => {
    if (value && !options.signal.aborted) options.onState(value);
    return value;
  });
  // Turn rejection into a value immediately: a fast place failure cannot become an unhandled rejection while state loads.
  const place = options.place().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
  const [stateValue, placeValue] = await Promise.all([state, place]);
  if (options.signal.aborted) return;
  if (!placeValue.ok) throw placeValue.error;
  options.onPlace(placeValue.value, stateValue);
}
