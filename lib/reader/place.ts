import { factReader, statementQuery } from "../facts/db.ts";
import type { Query, FactDb } from "../facts/publish.ts";
import { snapshotCounts } from "../meetings/snapshot.ts";
import { combineStateRegistries } from "../registry/state-composition.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { readerDatabaseQuery } from "./database.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";
import { composePlaceRow } from "./place-decode.ts";
import { buildMissingPlacePages } from "./place-builder.ts";
import { mergePlaceRows } from "./place-compose.ts";
import { unpackPlaceContextRow, unpackReadyPlace, unpackReadyTerritory } from "./place-ready.ts";
import type { BodyTerritorySelection } from "../registry/body-territory.ts";
import type { PlaceInput, PlacePackage } from "./place-types.ts";
export type { PlaceInput, PlacePackage, AgendaDocumentLink } from "./place-types.ts";

/** The normal first ZIP visit reads one already composed page. */
export const READY_PLACE_SQL = `SELECT CASE WHEN $2::boolean THEN history_body ELSE body END AS page,version
  FROM place_page WHERE place_id=$1`;

/** Map and body selections use only ready pages and their existing identity aliases. */
export const PLACE_PAGES_SQL = `WITH requested_bodies AS (
  SELECT coalesce((SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=id),id) AS id
    FROM unnest($3::text[]) AS requested(id)
), state_bodies AS (
  SELECT id FROM entity WHERE $6::boolean AND kind='body' AND state=$1::char(2)
), selected AS (
  SELECT unnest($2::text[]) AS id WHERE NOT $6::boolean UNION SELECT unnest($4::text[]) WHERE NOT $6::boolean
  UNION SELECT id FROM requested_bodies WHERE NOT $6::boolean
  UNION SELECT split_part(id,'#',1) FROM requested_bodies WHERE NOT $6::boolean AND $5::boolean AND id LIKE 'ocd-division/%'
  UNION SELECT place_id FROM entity_place WHERE NOT $6::boolean AND $5::boolean AND entity_id IN (SELECT id FROM requested_bodies)
  UNION SELECT id FROM state_bodies
  UNION SELECT id FROM entity WHERE kind='place' AND (state=$1::char(2) OR $1='US' AND id='ocd-division/country:us')
    AND id ~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$'
    AND (NOT $6::boolean AND cardinality($2::text[])=0 AND cardinality($3::text[])=0
      OR $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies))
) SELECT s.id AS page_id,CASE WHEN $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies) THEN 'empty' ELSE e.kind END AS page_kind,p.built_at,
  coalesce(saved.value->CASE WHEN $8::boolean THEN 'full' WHEN $9::boolean THEN 'facts' ELSE 'brief' END,saved.value) AS row,
  ARRAY(SELECT id FROM requested_bodies) AS body_ids
  FROM selected s LEFT JOIN entity e ON e.id=s.id LEFT JOIN place_page p ON p.place_id=s.id
  LEFT JOIN LATERAL (SELECT p.context->CASE WHEN NOT $6::boolean AND cardinality($2::text[])=0 AND cardinality($3::text[])=0
    OR $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies)
    THEN CASE WHEN $7::boolean THEN 'emptyHistory' ELSE 'emptyCurrent' END
    ELSE CASE WHEN $7::boolean THEN 'history' ELSE 'current' END END AS value) saved ON true
  WHERE e.state=$1::char(2) OR e.state IS NULL ORDER BY s.id`;

const requests = serverReaderValue("place-requests", () => new WeakMap<object, Map<string, Promise<PlacePackage>>>());
const pageIds = serverReaderValue("place-page-ids", () => new WeakMap<PlacePackage, readonly string[]>());
const pageTerritories = serverReaderValue("place-page-territories", () => new WeakMap<PlacePackage, BodyTerritorySelection|null>());

/** Cache the exact pages selected, including canonical bodies reached through an alias. */
export function placePageCacheIds(place: PlacePackage): readonly string[] {
  return pageIds.get(place) ?? [];
}

export function placePageTerritory(place:PlacePackage):BodyTerritorySelection|null|undefined {
  return pageTerritories.get(place);
}

export function readPlacePackage(input:PlaceInput,query?:Query|null):Promise<PlacePackage> {
  if(query!==undefined || currentReaderAuthorityEdge())return loadPlacePackage(input,query===undefined?factReader():query,
    query?{transaction:work=>work(query)}:undefined);
  return readCachedPlacePackage(input,()=>{
    const socket=readerDatabaseQuery();
    return socket?statementQuery(socket):factReader();
  });
}

export function readPlacePackageHttp(input:PlaceInput):Promise<PlacePackage> {
  if(currentReaderAuthorityEdge())return loadPlacePackage(input,factReader());
  return readCachedPlacePackage(input,()=>{
    installDatabaseTransferCounter();
    const http=factReader(),socket=http?null:readerDatabaseQuery();
    return http??(socket?statementQuery(socket):null);
  });
}

/** A ZIP crossing a state line keeps the boards and calendars on both sides. */
export async function readPlacesForStates(states: readonly string[], input: Omit<PlaceInput,"state">): Promise<PlacePackage> {
  const values = await Promise.all([...new Set(states)].map(state => {
    const own = (id:string) => !ocdStateCode(id) || ocdStateCode(id) === state.toLowerCase();
    return readPlacePackageHttp({...input,state,divisionIds:input.divisionIds.filter(own),
      bodyIds:input.bodyIds?.filter(own),namedDivisionIds:input.namedDivisionIds?.filter(own)});
  }));
  if (!values.length || values.some(value => !value.registry)) throw new Error("The place's government records could not be loaded");
  if (values.length === 1) return values[0];
  const by = <T>(rows:readonly T[], key:(row:T)=>string):T[] => [...new Map(rows.map(row=>[key(row),row])).values()];
  const meetings=by(values.flatMap(value=>value.meetings),row=>row.id);
  const dates=values.flatMap(value=>value.snapshotHeldAt??[]).sort();
  return {...values[0],registry:combineStateRegistries(values.map(value=>value.registry!)),
    publicationAttempts:by(values.flatMap(value=>value.publicationAttempts),row=>JSON.stringify(row)),
    bodies:by(values.flatMap(value=>value.bodies),row=>row.id),governments:by(values.flatMap(value=>value.governments),row=>row.id),
    divisions:by(values.flatMap(value=>value.divisions),row=>row.ocdId),registrationHeld:values.every(value=>value.registrationHeld),
    meetings,snapshotHeldAt:dates.at(-1)??null,snapshot:{...values[0].snapshot,generatedAt:dates.at(-1)??values[0].snapshot.generatedAt,
      meetings,counts:snapshotCounts(meetings,values.reduce((sum,value)=>sum+(value.snapshot.counts.duplicatesCollapsed??0),0)),
      sources:values.flatMap(value=>value.snapshot.sources),agendaDocuments:by(values.flatMap(value=>value.snapshot.agendaDocuments),row=>row.id)},
    agendaDocumentLinks:by(values.flatMap(value=>value.agendaDocumentLinks),row=>`${row.meetingId}|${row.documentUrl}`),
    bodySnapshots:Object.assign({},...values.map(value=>value.bodySnapshots))};
}

function readCachedPlacePackage(input:PlaceInput,query:()=>Query|null):Promise<PlacePackage> {
  const selected={...input,state:input.state.toUpperCase(),divisionIds:[...new Set(input.divisionIds)].sort(),
    bodyIds:[...new Set(input.bodyIds??[])].sort(),namedDivisionIds:[...new Set(input.namedDivisionIds??[])].sort()};
  const key=JSON.stringify(selected),selection=currentReaderSelection();
  let request=selection?requests.get(selection):undefined;
  if(selection&&!request){request=new Map();requests.set(selection,request);}
  const prior=request?.get(key);
  if(prior)return prior;
  const read=loadPlacePackage(selected,query());
  request?.set(key,read);
  return read;
}

async function loadPlacePackage(input:PlaceInput,query:Query|null,writer?:FactDb):Promise<PlacePackage> {
  if(!query)throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  if(input.placeId && !(input.placeId.startsWith("zip:") && input.includeHistory)
    && !input.includeAgenda && !input.bodyFactsOnly && !input.meetingIds && !input.allBodies) {
    const [saved]=await query(READY_PLACE_SQL,[input.placeId,input.includeHistory??false]);
    if(!saved?.page){
      await buildMissingPlacePages([{id:input.placeId,kind:'place',state:input.state.toUpperCase()}],writer);
      return loadPlacePackage(input,query,writer);
    }
    const place=unpackReadyPlace(saved.page);
    const territory=unpackReadyTerritory(saved.page);
    if(territory!==undefined)pageTerritories.set(place,territory);
    pageIds.set(place,[input.placeId]);
    return place;
  }
  const rows=await query(PLACE_PAGES_SQL,[input.state.toUpperCase(),input.divisionIds,input.bodyIds??[],input.namedDivisionIds??[],
    input.neighbors??false,input.allBodies??false,input.includeHistory??false,input.includeAgenda??false,input.bodyFactsOnly??false]);
  const missing=rows.filter(row=>!row.row);
  if(missing.length){
    await buildMissingPlacePages(missing.map(row=>({id:String(row.page_id),kind:row.page_kind==='body'?'body':'place',state:input.state.toUpperCase()})),writer);
    return loadPlacePackage(input,query,writer);
  }
  const empty=!input.allBodies&&!input.divisionIds.length&&!input.bodyIds?.length;
  const canonical={...input,bodyIds:rows[0]?.body_ids as string[]??input.bodyIds};
  const merged=mergePlaceRows(canonical,rows.map(row=>({...unpackPlaceContextRow(row.row),page_id:row.page_id,
    page_kind:empty?'empty':row.page_kind,built_at:row.built_at})));
  const place=await composePlaceRow(canonical,merged);
  pageIds.set(place,rows.flatMap(row=>typeof row.page_id==='string'?[row.page_id]:[]));
  return place;
}
