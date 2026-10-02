/**
 * **THE GEOGRAPHY BEHIND THE COUNTRY VIEW: A STATE'S CONGRESSIONAL DISTRICTS,
 * THEIR ZIPS, AND EVERY DIVISION THOSE ZIPS TOUCH.**
 *
 * Nothing here uses the network. A district's ZIPs come from the published
 * Census lookup in the reader store (the same slice the Start-many-hunts picker
 * uses: `stateContainers`, one read per state, ZIP areas included); the divisions
 * a ZIP touches come from the committed national ZIP index
 * (`data/derived/zip-divisions`), read one shard at a time. A district's divisions
 * are the union over every one of its ZIPs, plus the district itself, its state
 * and the country, so its owed list is read from held data exactly once.
 *
 * A read that fails answers a named gap, never an empty district.
 */
import { censusWorkDivision } from "../../census-geography/division-id.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import { divisionIdsOfZip } from "../bulk-hunts/zip-state.ts";
import { FIPS_TO_STATE } from "../../ocd/fips.ts";
import { stateBase } from "../../ocd/divisions.ts";
import { districtLabelOf } from "./district-label.ts";
import { stateContainers, type ReadOnlyQuery } from "./promoted-slices.ts";
import type { V6PlaceScope } from "./v6-hunts-read.ts";

export interface DistrictInfo {
  readonly state: string;
  readonly geoid: string;
  /** `AZ-06`. */
  readonly label: string;
  /** `geo:az.congressional_district.0406`. */
  readonly placeKey: string;
  /** The district's own OCD division. */
  readonly divisionId: string;
  /** Every ZIP area the published lookup puts wholly or partly inside it, sorted. */
  readonly zips: readonly string[];
}

export type DistrictsRead =
  | { readonly ok: true; readonly versionId: string; readonly districts: readonly DistrictInfo[] }
  | { readonly ok: false; readonly code: "DISTRICTS_UNREAD" | "DISTRICTS_NOT_PUBLISHED" | "DISTRICT_PLAN_AMBIGUOUS"; readonly says: string };

export const districtPlaceKey = (state: string, geoid: string): string => `geo:${state.toLowerCase()}.congressional_district.${geoid}`;

const COUNTRY = "ocd-division/country:us";

/** The OCD id of a state's own government, or null for a code this table does not know. */
export function stateDivisionId(state: string): string | null {
  const fips = Object.entries(FIPS_TO_STATE).find(([, e]) => e.postal === state.toUpperCase())?.[0];
  return fips === undefined ? null : stateBase(fips)?.base ?? null;
}

/**
 * The ZIPs the published Census lookup puts wholly or partly in the congressional district or county a place scope names: what lets
 * Admin bind a ZIP's hunt, workers and money to the district or county that holds it. Null for any other scope (a ZIP, a metro, a
 * state, the country) and when the lookup could not be read, so a binding that cannot be settled stays unsettled.
 */
export async function readAreaZips(scope: V6PlaceScope | null, query: ReadOnlyQuery | null = readerQuery()): Promise<ReadonlySet<string> | null> {
  if (scope === null || scope.kind !== "geo") return null;
  try {
    if (scope.type === "congressional_district") {
      const read = await readStateDistricts(scope.state, query);
      const district = read.ok ? read.districts.find((d) => d.geoid === scope.geoid) : undefined;
      return district === undefined ? null : new Set(district.zips);
    }
    if (scope.type === "county") {
      const slice = await stateContainers(scope.state, ["county"], true, query);
      if (slice.kind !== "HELD") return null;
      const zips = new Set<string>();
      let found = false;
      for (const c of slice.value.containers) if (c.ref.type === "county" && c.ref.geoid === scope.geoid) { found = true; for (const o of c.overlaps ?? []) zips.add(o.zcta5); }
      return found ? zips : null;
    }
  } catch { return null; }
  return null;
}

const MEMO_MS = 5 * 60_000;
const MEMO_STATES = 8;
const memo = new Map<string, { at: number; read: DistrictsRead }>();

/** A state's districts with their ZIPs, from the published Census lookup. Memoized for five minutes; a failed read is never kept. */
export async function readStateDistricts(state: string, query: ReadOnlyQuery | null = readerQuery(), now: () => number = Date.now): Promise<DistrictsRead> {
  const st = state.toLowerCase();
  const held = memo.get(st);
  if (held && now() - held.at < MEMO_MS) return held.read;
  const slice = await stateContainers(st, ["congressional_district"], true, query);
  if (slice.kind === "UNREAD") return { ok: false, code: "DISTRICTS_UNREAD", says: slice.detail };
  if (slice.kind === "NOT_PUBLISHED") return { ok: false, code: "DISTRICTS_NOT_PUBLISHED", says: "The Census district lookup is not published to this store yet." };
  const versions = new Set(slice.value.scopes.filter((s) => s.type === "congressional_district").map((s) => s.version));
  if (versions.size !== 1) return { ok: false, code: "DISTRICT_PLAN_AMBIGUOUS", says: "The published lookup holds more than one congressional district plan, so districts are not mixed." };
  const districts: DistrictInfo[] = [];
  for (const c of slice.value.containers) {
    if (c.ref.type !== "congressional_district" || !versions.has(c.ref.version) || c.ref.stateAbbr.toLowerCase() !== st) continue;
    const divisionId = censusWorkDivision(c.ref);
    if (divisionId === null) continue; // water and unassigned area are not a seat
    districts.push({ state: st, geoid: c.ref.geoid, label: districtLabelOf(st, c.ref.geoid), placeKey: districtPlaceKey(st, c.ref.geoid), divisionId,
      zips: [...new Set((c.overlaps ?? []).map((o) => o.zcta5))].sort() });
  }
  districts.sort((a, b) => a.geoid.localeCompare(b.geoid));
  const read: DistrictsRead = { ok: true, versionId: slice.versionId, districts };
  memo.set(st, { at: now(), read });
  while (memo.size > MEMO_STATES) memo.delete(memo.keys().next().value as string);
  return read;
}

/** The divisions each ZIP touches, from the committed national ZIP index. A ZIP the index lacks maps to an empty list. Shards are read concurrently, a few at a time. */
export async function zipDivisionIds(zips: readonly string[], readOne: (zip: string) => Promise<readonly string[] | null> = divisionIdsOfZip): Promise<ReadonlyMap<string, readonly string[]>> {
  const out = new Map<string, readonly string[]>();
  const queue = [...new Set(zips)];
  const worker = async () => {
    for (let zip = queue.pop(); zip !== undefined; zip = queue.pop()) out.set(zip, (await readOne(zip)) ?? []);
  };
  await Promise.all(Array.from({ length: Math.min(8, queue.length) }, worker));
  return out;
}

const TITLE = (slug: string) => slug.split("_").map((w) => (w === "" ? w : w[0].toUpperCase() + w.slice(1))).join(" ");

/** A readable name for a division id that carries no label of its own (the ZIP index stores ids only). */
export function labelOfDivisionId(id: string): string {
  if (id === COUNTRY) return "United States";
  const last = id.split("/").at(-1) ?? id;
  const at = last.indexOf(":");
  const type = at < 0 ? "" : last.slice(0, at), value = at < 0 ? last : last.slice(at + 1);
  if (type === "state" || type === "district" || type === "territory") return value.toUpperCase();
  if (type === "county") return `${TITLE(value)} County`;
  return TITLE(value);
}

export interface NationalDivision {
  readonly id: string;
  readonly label: string;
}

/**
 * The divisions one place touches: every id of its ZIPs, then the extra ids it is always inside (the district itself, the
 * state, the country). Order is stable and an id appears once.
 */
export function unionDivisions(zipIds: readonly (readonly string[])[], always: readonly NationalDivision[]): NationalDivision[] {
  const seen = new Map<string, NationalDivision>();
  for (const a of always) if (!seen.has(a.id)) seen.set(a.id, a);
  for (const ids of zipIds) for (const id of ids) if (!seen.has(id)) seen.set(id, { id, label: labelOfDivisionId(id) });
  return [...seen.values()];
}

/** What a district is always inside: itself, its state and the country. */
export function districtAlways(d: DistrictInfo): NationalDivision[] {
  const state = stateDivisionId(d.state);
  return [{ id: COUNTRY, label: "United States" }, ...(state === null ? [] : [{ id: state, label: d.state.toUpperCase() }]), { id: d.divisionId, label: d.label }];
}

/** Every division a district touches, resolved with one pass over its ZIPs. */
export async function districtDivisions(d: DistrictInfo, ids: ReadonlyMap<string, readonly string[]> | null = null): Promise<NationalDivision[]> {
  const byZip = ids ?? await zipDivisionIds(d.zips);
  return unionDivisions(d.zips.map((z) => byZip.get(z) ?? []), districtAlways(d));
}

/** Test seam: forget what was read. */
export function forgetNationalGeography(): void {
  memo.clear();
}
