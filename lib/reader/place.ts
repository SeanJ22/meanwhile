import { factReader, statementQuery } from "../facts/db.ts";
import type { Query } from "../facts/publish.ts";
import { snapshotCounts } from "../meetings/snapshot.ts";
import { combineStateRegistries } from "../registry/state-composition.ts";
import { ocdStateCode } from "../ocd/state-of.ts";
import { currentReaderAuthorityEdge } from "../registry/runtime-edge.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { readerDatabaseQuery } from "./database.ts";
import { installDatabaseTransferCounter } from "../db/transfer.ts";
import { serverReaderValue } from "./memory.ts";
import { composePlaceRow } from "./place-decode.ts";
import { mergePlaceRows } from "./place-compose.ts";
import { currentPlaceRow,type BodyHeaders } from "./place-identity.ts";
import { unpackPlaceContextRow } from "./place-ready.ts";
import type { PlaceInput, PlacePackage } from "./place-types.ts";
export type { PlaceInput, PlacePackage, AgendaDocumentLink } from "./place-types.ts";

const identityCtes = `page_dependencies AS MATERIALIZED (
  SELECT s.id AS page_id,d.entity_id FROM selected s JOIN place_page p ON p.place_id=s.id CROSS JOIN LATERAL unnest(coalesce(p.depends,ARRAY(SELECT o.entity_id FROM place_page_dependency o WHERE o.page_id=p.place_id))) AS d(entity_id)
  UNION SELECT id,id FROM selected
), page_headers AS MATERIALIZED (
  SELECT d.page_id,b.id AS original,c.id,c.name FROM page_dependencies d JOIN entity b ON b.id=d.entity_id AND b.kind='body'
    LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=b.id
    JOIN entity c ON c.id=coalesce(x.entity_id,b.id) AND c.kind='body'
  UNION SELECT d.page_id,x.value,c.id,c.name FROM page_dependencies d JOIN entity_external_id x ON x.entity_id=d.entity_id
    JOIN entity c ON c.id=x.entity_id AND c.kind='body' WHERE x.scheme='body-alias'
)`;
const identityHeaders=(page?:string)=>`coalesce((SELECT jsonb_object_agg(original,jsonb_build_object('id',id,'name',name))
  FROM page_headers${page?` WHERE page_id=${page}`:''}),'{}'::jsonb)`;

/** Every selection of places and boards is composed from their saved pages and the identity aliases they depend on. */
const PLACE_SELECTION = `WITH requested_bodies AS (
  SELECT coalesce((SELECT entity_id FROM entity_external_id WHERE scheme='body-alias' AND value=id),id) AS id
    FROM unnest($3::text[]) AS requested(id)
), state_bodies AS (
  SELECT id FROM entity b WHERE $6::boolean AND kind='body' AND state=$1::char(2)
    AND NOT EXISTS(SELECT 1 FROM entity_external_id x WHERE x.scheme='body-alias' AND x.value=b.id)
), selected AS (
  SELECT unnest($2::text[]) AS id WHERE NOT $6::boolean UNION SELECT unnest($4::text[]) WHERE NOT $6::boolean
  UNION SELECT id FROM requested_bodies WHERE NOT $6::boolean
  UNION SELECT split_part(id,'#',1) FROM requested_bodies WHERE NOT $6::boolean AND $5::boolean AND id LIKE 'ocd-division/%'
  UNION SELECT place_id FROM entity_place WHERE NOT $6::boolean AND $5::boolean AND entity_id IN (SELECT id FROM requested_bodies)
  UNION SELECT id FROM state_bodies
  UNION SELECT x.value FROM entity_external_id x WHERE x.scheme='body-alias' AND x.entity_id IN
    (SELECT id FROM requested_bodies UNION SELECT id FROM state_bodies)
    AND EXISTS(SELECT 1 FROM place_page p WHERE p.place_id=x.value
      AND p.context ? CASE WHEN $7::boolean THEN 'history' ELSE 'current' END)
    AND EXISTS(SELECT 1 FROM place_page q WHERE q.place_id=x.entity_id AND q.stale_at IS NOT NULL)
  UNION SELECT id FROM entity WHERE kind='place' AND (state=$1::char(2) OR $1='US' AND id='ocd-division/country:us')
    AND id ~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$'
    AND (NOT $6::boolean AND cardinality($2::text[])=0 AND cardinality($3::text[])=0
      OR $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies))
), ${identityCtes}`;

/**
 * The saved pages of a selection. Given the print of the answer a server already holds ($10), it returns that print alone while the pages and the
 * aliases they depend on are unchanged. Otherwise it returns the pages, leaving out the rows of those a server already holds ($11, as id:version:kind).
 */
export const PLACE_PAGES_SQL = `${PLACE_SELECTION}, printed AS (
  SELECT md5(coalesce(string_agg(s.id||':'||coalesce(p.version::text,'-')||':'||(${identityHeaders('s.id')})::text,',' ORDER BY s.id),'')) AS print
    FROM selected s LEFT JOIN entity e ON e.id=s.id LEFT JOIN place_page p ON p.place_id=s.id WHERE e.state=$1::char(2) OR e.state IS NULL
), pages AS (
SELECT s.id AS page_id,CASE WHEN $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies) THEN 'empty' ELSE e.kind END AS page_kind,p.built_at,p.version,
  coalesce(saved.value->CASE WHEN $8::boolean THEN 'full' WHEN $9::boolean THEN 'facts' ELSE 'brief' END,saved.value) AS row,
  ${identityHeaders('s.id')} AS body_headers,
  ARRAY(SELECT id FROM requested_bodies) AS body_ids
  FROM selected s LEFT JOIN entity e ON e.id=s.id LEFT JOIN place_page p ON p.place_id=s.id
  LEFT JOIN LATERAL (SELECT p.context->CASE WHEN NOT $6::boolean AND cardinality($2::text[])=0 AND cardinality($3::text[])=0
    OR $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies)
    THEN CASE WHEN $7::boolean THEN 'emptyHistory' ELSE 'emptyCurrent' END
    ELSE CASE WHEN $7::boolean THEN 'history' ELSE 'current' END END AS value) saved ON true
  WHERE e.state=$1::char(2) OR e.state IS NULL ORDER BY s.id
)
SELECT pages.page_id,pages.page_kind,pages.built_at,pages.version,CASE WHEN held.saved THEN NULL ELSE pages.row END AS row,held.saved AS held,
  pages.body_headers,pages.body_ids,(SELECT print FROM printed) AS print
  FROM pages CROSS JOIN LATERAL (SELECT pages.row IS NOT NULL AND pages.page_id||':'||pages.version||':'||pages.page_kind=ANY($11::text[]) AS saved) held
  WHERE (SELECT print FROM printed) IS DISTINCT FROM $10::text
UNION ALL SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,(SELECT print FROM printed) WHERE (SELECT print FROM printed)=$10::text`;

/** A combined answer is kept in this server's memory while the print of its pages is unchanged, and never for long, since sittings are read against the clock. */
const COMBINED_KEPT = 24, COMBINED_MS = 60_000;
/** Saved page rows this server has read, by selection shape and page version, so a place shared by neighbouring ZIPs crosses the connection once. */
const HELD_ROWS = 300;
const heldRows = serverReaderValue("place-rows", () => new Map<string, unknown>());
const combined = serverReaderValue("place-combined", () => new Map<string, { readonly print: string; readonly at: number; readonly place: PlacePackage }>());

const requests = serverReaderValue("place-requests", () => new WeakMap<object, Map<string, Promise<PlacePackage>>>());
const pageIds = serverReaderValue("place-page-ids", () => new WeakMap<PlacePackage, readonly string[]>());

/** Cache the exact pages selected, including canonical bodies reached through an alias. */
export function placePageCacheIds(place: PlacePackage): readonly string[] {
  return pageIds.get(place) ?? [];
}

export function readPlacePackage(input:PlaceInput,query?:Query|null):Promise<PlacePackage> {
  if(query!==undefined || currentReaderAuthorityEdge())return loadPlacePackage(input,query===undefined?factReader():query);
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
  const read=loadPlacePackage(selected,query(),true);
  request?.set(key,read);
  return read;
}

async function loadPlacePackage(input:PlaceInput,query:Query|null,remember=false):Promise<PlacePackage> {
  if(!query)throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  const params=[input.state.toUpperCase(),input.divisionIds,input.bodyIds??[],input.namedDivisionIds??[],
    input.neighbors??false,input.allBodies??false,input.includeHistory??false,input.includeAgenda??false,input.bodyFactsOnly??false];
  const key=JSON.stringify([params,input.placeId??null]),kept=remember?combined.get(key):undefined;
  const shape=JSON.stringify(params.slice(6)),prefix=`${shape}|`;
  const read=async(have:readonly string[])=>query(PLACE_PAGES_SQL,[...params,kept && Date.now()-kept.at<COMBINED_MS ? kept.print : null,have]);
  let rows=await read(remember?[...heldRows.keys()].filter(held=>held.startsWith(prefix)).map(held=>held.slice(prefix.length)):[]);
  if(kept && rows.length===1 && rows[0]!.page_id===null && kept.print===rows[0]!.print)return kept.place;
  const rowKey=(row:Record<string,unknown>)=>`${prefix}${row.page_id}:${row.version}:${row.page_kind}`;
  if(rows.some(row=>row.held===true && !heldRows.has(rowKey(row))))rows=await read([]);
  const withRows=rows.map(row=>row.held===true?{...row,row:heldRows.get(rowKey(row))}:row);
  // A place whose page is not built yet adds nothing until it is; the places that are built still answer.
  const built=withRows.filter(row=>row.row);
  if(!built.length)throw new Error("PLACE_PAGE_NOT_BUILT");
  if(remember)for(const row of built){
    heldRows.delete(rowKey(row));
    heldRows.set(rowKey(row),row.row);
  }
  for(const oldest of heldRows.keys()){ if(heldRows.size<=HELD_ROWS)break; heldRows.delete(oldest); }
  const empty=!input.allBodies&&!input.divisionIds.length&&!input.bodyIds?.length;
  const canonical={...input,bodyIds:rows[0]?.body_ids as string[]??input.bodyIds};
  const merged=mergePlaceRows(canonical,built.map(row=>({...currentPlaceRow(unpackPlaceContextRow(row.row),row.body_headers as BodyHeaders ?? {},input.placeId!==undefined),page_id:row.page_id,
    page_kind:empty?'empty':row.page_kind,built_at:row.built_at})));
  const place=await composePlaceRow(canonical,merged);
  pageIds.set(place,rows.flatMap(row=>typeof row.page_id==='string'?[row.page_id]:[]));
  const print=rows[0]?.print;
  if(remember && typeof print==="string") {
    combined.delete(key);
    combined.set(key,{print,at:Date.now(),place});
    for(const oldest of combined.keys()){ if(combined.size<=COMBINED_KEPT)break; combined.delete(oldest); }
  }
  return place;
}
