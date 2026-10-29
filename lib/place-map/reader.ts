import { AsyncLocalStorage } from "node:async_hooks";
import { factReader } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { placesAtPoint, placesForCode, codeMembershipsSql } from "./read.ts";
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
  return { ids, partial, samples: 0, states: result.states,
    qualifiedDistricts: [...new Set(ids.flatMap(id => districtFamilyKey(id) ?? []))], ...(fringe.length ? { fringe } : {}) };
}

export function placeDivisionType(layer: string, id: string): string {
  return ["unsd","elsd","scsd"].includes(layer) ? "school_district" : layer === "cousub" ? "place"
    : layer === "district" && id.includes("/special_district:") ? "special_district" : layer;
}

export async function readZipPlace(zip: string | null, selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceEntry | null> {
  if (!zip || !/^\d{5}$/.test(zip)) return null;
  const result = await placesForCode(placeMapQuery(), "zip", zip, selection);
  if (!result.memberships.length) return null;
  return (await orderZipStates(new Map([[zip,placeEntry(result)]]))).get(zip)!;
}

/** Keep a crossing ZIP's existing statewide shelf while showing every touched state's places. */
async function orderZipStates(entries: Map<string,PlaceEntry>): Promise<Map<string,PlaceEntry>> {
  const crossing = [...entries].filter(([,entry]) => (entry.states?.length ?? 0) > 1).map(([zip]) => zip);
  if (!crossing.length) return entries;
  const { readZipPostalAreas } = await import("./locations.ts");
  for (const [zip,postal] of await readZipPostalAreas(crossing)) {
    const entry = entries.get(zip)!;
    if (entry.states?.includes(postal.state)) entries.set(zip,{...entry,states:[postal.state,...entry.states.filter(state => state !== postal.state)]});
  }
  return entries;
}

export async function readPointPlace(lat: number, lng: number, selection: GeographySelection = currentRepresentationSelection()): Promise<PlaceEntry> {
  return placeEntry(await placesAtPoint(placeMapQuery(), [lng, lat], selection));
}

export async function stateForZip(zip: string): Promise<string | null> {
  return (await readZipPlace(zip))?.states?.[0] ?? null;
}

/** Enumerate only the requested state's codes; their memberships use the same lookup as a typed ZIP. */
export function readStateZipPlaces(input: string, selection: GeographySelection = currentRepresentationSelection()): Promise<ReadonlyMap<string, PlaceEntry>> {
  return stateZipPlaces(input, selection, true);
}

async function stateZipPlaces(input: string, selection: GeographySelection, postalLinks: boolean): Promise<ReadonlyMap<string, PlaceEntry>> {
  const state = requireRegistryState(input.replace(/^US-/i, "")), query = placeMapQuery();
  const codes = await query("SELECT DISTINCT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id WHERE e.state=$1::char(2) AND e.kind='place' ORDER BY m.zip", [state]);
  const out = new Map<string, PlaceEntry>();
  // Read the state in one bounded query, then apply the shared year selection per code.
  if (!codes.length) return out;
  const rows = await query(codeMembershipsSql("zip", "$1::text[]", postalLinks), [codes.map(row => String(row.zip))]);
  for (const row of rows) {
    const code=String(row.zip),result = await placesForCode(async () => [row], "zip", code, selection);
    const entry = placeEntry(result);
    if (entry.states?.includes(state) && entry.ids.length) out.set(code, entry);
  }
  return orderZipStates(out);
}

/** A division's example ZIP holds that division itself, never only through a mail-only ZIP's postal link. */
export async function lowestZipByDivision(state: string): Promise<ReadonlyMap<string, string>> {
  const out = new Map<string, string>();
  for (const [zip, entry] of await stateZipPlaces(state, currentRepresentationSelection(), false)) for (const id of entry.ids) {
    if (!out.has(id)) out.set(id, zip);
  }
  return out;
}

export interface DivisionZipOptions {
  /** Manual state-wide records may use the first ZIP holding a child division when the state itself has no row. */
  readonly stateFallback?: boolean;
  readonly selection?: GeographySelection;
}
const DIVISION_ZIP_PAGE = 16;
const DIVISION_ZIP_MEMBERSHIPS_SQL = `SELECT m.zip,json_agg(json_build_object(
    'placeId',e.id,'state',e.state,'layer',b.layer,'boundaryYear',b.boundary_year,'version',b.version,'fringe',m.fringe)
    ORDER BY e.id,b.boundary_year) AS memberships
  FROM zip_place m JOIN entity e ON e.id=m.place_id
  JOIN place_boundary b ON b.place_id=m.place_id AND b.boundary_year=m.boundary_year
  WHERE m.zip=ANY($1::text[]) AND e.kind='place' GROUP BY m.zip ORDER BY m.zip`;

/** Read only candidate ZIPs for these divisions. Selection uses the same per-ZIP plans and latest local boundaries as a typed ZIP.
 * Postal links stay out: a witness ZIP must hold its division directly. */
export async function lowestZipsForDivisions(input: string, divisions: readonly string[], options: DivisionZipOptions = {}): Promise<ReadonlyMap<string,string>> {
  const state=requireRegistryState(input.replace(/^US-/i,"")),wanted=[...new Set(divisions)],out=new Map<string,string>();
  if(!wanted.length)return out;
  const query=placeMapQuery(),selection=options.selection??currentRepresentationSelection(),contexts=new Map<string,PlaceMapResult>();
  const readCodes=async(codes:readonly string[])=>{
    const missing=[...new Set(codes)].filter(code=>!contexts.has(code));
    if(!missing.length)return;
    const rows=await query(DIVISION_ZIP_MEMBERSHIPS_SQL,[missing]);
    for(const code of missing){
      const row=rows.find(row=>row.zip===code);
      const result=row?await placesForCode(async()=>[row],"zip",code,selection):{memberships:[],states:[]};
      contexts.set(code,result);
    }
  };
  const find=async(targets:readonly string[],children:boolean)=>{
    const pending=new Set(targets),after:Record<string,string>={};
    while(pending.size){
      const rows=await query(`SELECT wanted.division,p.zip FROM unnest($1::text[]) wanted(division)
        CROSS JOIN LATERAL(SELECT DISTINCT m.zip FROM zip_place m JOIN entity e ON e.id=m.place_id
          WHERE ${children?"m.place_id LIKE wanted.division||'/%'":"m.place_id=wanted.division"} AND e.kind='place'
            AND m.zip>coalesce($3::jsonb->>wanted.division,'')
            AND(e.state=$2::char(2) OR EXISTS(SELECT 1 FROM zip_place own JOIN entity owner_place ON owner_place.id=own.place_id
              WHERE own.zip=m.zip AND owner_place.state=$2::char(2) AND owner_place.kind='place'))
          ORDER BY m.zip LIMIT ${DIVISION_ZIP_PAGE}) p ORDER BY wanted.division,p.zip`,[[...pending],state,JSON.stringify(after)]);
      const pages=new Map<string,string[]>();
      for(const row of rows){const id=String(row.division);pages.set(id,[...(pages.get(id)??[]),String(row.zip)]);}
      for(let position=0;position<DIVISION_ZIP_PAGE&&pending.size;position++){
        const candidates=[...pending].flatMap(id=>pages.get(id)?.[position]?[{id,zip:pages.get(id)![position]}]:[]);
        if(!candidates.length)break;
        await readCodes(candidates.map(candidate=>candidate.zip));
        for(const{id,zip}of candidates){
          const context=contexts.get(zip)!;
          if(context.states.includes(state)&&context.memberships.some(row=>!row.fringe&&(children?row.placeId.startsWith(`${id}/`):row.placeId===id))){out.set(id,zip);pending.delete(id);}
        }
      }
      for(const id of pending){const page=pages.get(id)??[];if(page.length<DIVISION_ZIP_PAGE)pending.delete(id);else after[id]=page.at(-1)!;}
    }
  };
  await find(wanted,false);
  if(options.stateFallback)await find(wanted.filter(id=>!out.has(id)&&/^ocd-division\/country:us\/state:[a-z]{2}$/.test(id)),true);
  return out;
}

export async function lowestZipForDivision(state:string,division:string,options:DivisionZipOptions={}):Promise<string|null>{
  return(await lowestZipsForDivisions(state,[division],options)).get(division)??null;
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
