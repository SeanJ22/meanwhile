import { AsyncLocalStorage } from "node:async_hooks";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { placesAtPoint, placesForCode, CURRENT_LOCAL_BOUNDARY_SQL } from "./read.ts";
import type { PlaceMapResult } from "./types.ts";
import { currentRepresentationSelection, type GeographySelection } from "../census-geography/selection.ts";
import { districtFamilyKey } from "../census-geography/division-id.ts";
import { requireRegistryState } from "../civic-data/state-scopes.ts";

/** The memberships a reader can use, including separately named fringe places. */
export interface PlaceEntry {
  readonly ids: readonly string[];
  readonly partial: readonly string[];
  readonly fringe?: readonly string[];
  readonly qualifiedDistricts?: readonly string[];
  readonly samples: number;
  readonly states?: readonly string[];
}

const reads = new AsyncLocalStorage<Map<string, ReturnType<Query>>>();
let installed: Query | null | undefined;

/** Use a connection already held by a script or an isolated map fixture. */
export function installPlaceMapQuery(query: Query | null | undefined): void {
  installed = query;
}

/** A request shares source rows across representation and election selections. */
export const withPlaceMapReads = <T>(read: () => T): T => reads.getStore() ? read() : reads.run(new Map(), read);

export function placeMapQuery(): Query {
  const query = installed === undefined ? factReader() : installed;
  if (!query) throw new Error("The place map could not be loaded");
  return (sql, params = []) => {
    const cache = reads.getStore();
    if (!cache) return query(sql, params);
    const key = JSON.stringify([sql, params]);
    const held = cache.get(key);
    if (held) return held;
    const read = query(sql, params);
    cache.set(key, read);
    return read;
  };
}

export function placeEntry(result: PlaceMapResult): PlaceEntry {
  const ids = [...new Set(result.memberships.filter(row => !row.fringe).map(row => row.placeId))];
  const partial = [...new Set(result.memberships.filter(row => !row.fringe && (row.partial || row.countyAttachment)).map(row => row.placeId))];
  const fringe = [...new Set(result.memberships.filter(row => row.fringe).map(row => row.placeId))];
  const states = [...new Set(result.memberships.filter(row => !row.fringe).flatMap(row => row.state ? [row.state] : []))].sort();
  return { ids, partial, samples: 0, states: result.states.filter(state => states.includes(state)),
    qualifiedDistricts: [...new Set(ids.flatMap(id => districtFamilyKey(id) ?? []))], ...(fringe.length ? { fringe } : {}) };
}

export function placeDivisionType(layer: string, id: string): string {
  return ["unsd","elsd","scsd"].includes(layer) ? "school_district" : layer === "cousub" ? "place"
    : layer === "district" && id.includes("/special_district:") ? "special_district" : layer;
}

export async function readZipPlace(zip: string | null, selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceEntry | null> {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  const result = await placesForCode(placeMapQuery(), "zip", zip, selection);
  return result.memberships.length ? placeEntry(result) : null;
}

export async function readPointPlace(lat: number, lng: number, selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceEntry> {
  return placeEntry(await placesAtPoint(placeMapQuery(), [lng, lat], selection));
}

export async function stateForZip(zip: string): Promise<string | null> {
  return (await readZipPlace(zip))?.states?.[0] ?? null;
}

/** Enumerate only the requested state's codes; their memberships use the same lookup as a typed ZIP. */
export async function readStateZipPlaces(input: string, selection: GeographySelection = currentRepresentationSelection()): Promise<ReadonlyMap<string, PlaceEntry>> {
  const state = requireRegistryState(input.replace(/^US-/i, "")), query = placeMapQuery();
  const codes = await query("SELECT DISTINCT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id WHERE e.state=$1::char(2) ORDER BY m.zip", [state]);
  const out = new Map<string, PlaceEntry>();
  // Read the state in one bounded query, then apply the shared year selection per code.
  if (!codes.length) return out;
  const rows = await query(`SELECT m.zip, e.id AS place_id, e.name, e.state, b.layer, b.boundary_year, b.version,
    b.county_attachment, b.host_county_id, m.share, m.share_basis, m.partial, m.fringe
    FROM zip_place m JOIN entity e ON e.id=m.place_id
    JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year
    WHERE m.zip=ANY($1::text[]) AND ${CURRENT_LOCAL_BOUNDARY_SQL} ORDER BY m.zip,e.id,b.boundary_year`, [codes.map(row => String(row.zip))]);
  const byCode = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) { const code = String(row.zip), held = byCode.get(code) ?? []; held.push(row); byCode.set(code, held); }
  for (const [code, held] of byCode) {
    const result = await placesForCode(async () => held, "zip", code, selection);
    const entry = placeEntry(result);
    if (entry.states?.includes(state) && entry.ids.length) out.set(code, entry);
  }
  return out;
}

export async function lowestZipByDivision(state: string): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  for (const [zip, entry] of await readStateZipPlaces(state)) for (const id of entry.ids) {
    if (!out.has(id)) out.set(id, zip);
  }
  return out;
}

/** Identity and source metadata come from the same selected map memberships. */
export async function readZipDivisions(zip: string, selection: GeographySelection = currentRepresentationSelection()): Promise<import("../registry/types.ts").Division[]> {
  const query = placeMapQuery(), result = await placesForCode(query, "zip", zip, selection);
  if (!result.memberships.length) return [];
  const rows = await query(`SELECT b.place_id,b.boundary_year,b.source_urls,b.checked_at
    FROM place_boundary b JOIN jsonb_to_recordset($1::jsonb) AS wanted(place_id text,boundary_year integer)
    USING(place_id,boundary_year)`, [JSON.stringify(result.memberships.map(row => ({place_id:row.placeId,boundary_year:row.boundaryYear})))]);
  const sources = new Map(rows.map(row => [`${row.place_id}|${row.boundary_year}`,row]));
  return result.memberships.flatMap(row => {
    const source = sources.get(`${row.placeId}|${row.boundaryYear}`), url = (source?.source_urls as string[] | undefined)?.[0];
    if (!url || !source?.checked_at || !row.state) return [];
    const divisionType = placeDivisionType(row.layer,row.placeId);
    return [{ ocdId:row.placeId,divisionType,tier:row.layer === "cd" ? "national" as const : ["state","sldu","sldl"].includes(row.layer) ? "state" as const : "local" as const,
      state:row.state,label:row.name,parentOcdId:row.placeId.slice(0,row.placeId.lastIndexOf("/")),lsad:null,funcstat:null,classfp:null,geoid:null,
      canonicalOcdId:null,canonicalMatch:"none" as const,canonicalGap:"UNDETERMINED" as const,sourceDataset:"DERIVED" as const,
      provenance:{sourceUrl:url,sourceOrg:new URL(url).hostname,collectedAt:new Date(source.checked_at as string).toISOString(),verifiedAt:null} }];
  });
}
