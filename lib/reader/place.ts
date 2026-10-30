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
import { buildPlacePackage } from "./place-builder.ts";
import { mergePlaceRows } from "./place-compose.ts";
import { currentPlaceRow,type BodyHeaders } from "./place-identity.ts";
import { unpackPlaceContextRow } from "./place-ready.ts";
import { nationalEverydayRouting } from "./national.ts";
import type { PlaceInput, PlacePackage } from "./place-types.ts";
export type { PlaceInput, PlacePackage, AgendaDocumentLink } from "./place-types.ts";

export const identityCtes = `page_dependencies AS MATERIALIZED (
  SELECT s.id AS page_id,d.entity_id FROM selected s JOIN place_page p ON p.place_id=s.id CROSS JOIN LATERAL unnest(p.depends) AS d(entity_id)
  UNION SELECT id,id FROM selected
), page_headers AS MATERIALIZED (
  SELECT d.page_id,b.id AS original,c.id,c.name FROM page_dependencies d JOIN entity b ON b.id=d.entity_id AND b.kind='body'
    LEFT JOIN entity_external_id x ON x.scheme='body-alias' AND x.value=b.id
    JOIN entity c ON c.id=coalesce(x.entity_id,b.id) AND c.kind='body'
  UNION SELECT d.page_id,x.value,c.id,c.name FROM page_dependencies d JOIN entity_external_id x ON x.entity_id=d.entity_id
    JOIN entity c ON c.id=x.entity_id AND c.kind='body' WHERE x.scheme='body-alias'
)`;
export const identityHeaders=(page?:string)=>`coalesce((SELECT jsonb_object_agg(original,jsonb_build_object('id',id,'name',name))
  FROM page_headers${page?` WHERE page_id=${page}`:''}),'{}'::jsonb)`;

/** Every selection of places and boards is composed from their saved pages and the identity aliases they depend on. */
export const PLACE_SELECTION = `WITH requested_bodies AS (
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

/** What the saved pages of a selection and the aliases they depend on come to, as one short text. */
const PAGES_PRINT = `printed AS (
  SELECT md5(coalesce(string_agg(s.id||':'||coalesce(p.version::text,'-')||':'||(${identityHeaders('s.id')})::text,',' ORDER BY s.id),'')) AS print
    FROM selected s LEFT JOIN entity e ON e.id=s.id LEFT JOIN place_page p ON p.place_id=s.id WHERE e.state=$1::char(2) OR e.state IS NULL
)`;
/** The print alone, so asking again about an answer a server already holds costs one short text. Its parameters are the selection's first seven. */
export const PLACE_PRINT_SQL = `${PLACE_SELECTION}, ${PAGES_PRINT} SELECT print FROM printed`;

/**
 * The saved pages of a selection as one row, so a read pays the connection's per-row cost once: the print of the whole selection,
 * the requested boards, the identity headers of every page once, and each page as [id, kind, built (epoch seconds), version, row]. The rows of pages a server
 * already holds ($10, as id:version:kind) are left out and listed under `held`. When any page has no saved content yet no row is sent: the
 * caller answers the selection another way, so the others' rows would only be wasted bytes.
 */
export const PLACE_PAGES_SQL = `${PLACE_SELECTION}, ${PAGES_PRINT}, pages AS (
SELECT s.id AS page_id,CASE WHEN $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies) THEN 'empty' ELSE e.kind END AS page_kind,p.built_at,p.version,
  coalesce(saved.value->CASE WHEN $8::boolean THEN 'full' WHEN $9::boolean THEN 'facts' ELSE 'brief' END,saved.value) AS row,
  ${identityHeaders('s.id')} AS body_headers
  FROM selected s LEFT JOIN entity e ON e.id=s.id LEFT JOIN place_page p ON p.place_id=s.id
  LEFT JOIN LATERAL (SELECT p.context->CASE WHEN NOT $6::boolean AND cardinality($2::text[])=0 AND cardinality($3::text[])=0
    OR $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies)
    THEN CASE WHEN $7::boolean THEN 'emptyHistory' ELSE 'emptyCurrent' END
    ELSE CASE WHEN $7::boolean THEN 'history' ELSE 'current' END END AS value) saved ON true
  WHERE e.state=$1::char(2) OR e.state IS NULL
), listed AS (
SELECT pages.*,pages.row IS NOT NULL AND pages.page_id||':'||pages.version||':'||pages.page_kind=ANY($10::text[]) AS saved,bool_or(pages.row IS NULL) OVER () AS unbuilt FROM pages
)
SELECT jsonb_build_object('print',(SELECT print FROM printed),'bodies',ARRAY(SELECT id FROM requested_bodies),
  'held',coalesce(jsonb_agg(page_id||':'||version||':'||page_kind ORDER BY page_id) FILTER (WHERE saved AND NOT unbuilt),'[]'),
  'headers',CASE WHEN bool_or(unbuilt) THEN '{}'::jsonb ELSE coalesce((SELECT jsonb_object_agg(h.key,h.value) FROM pages p CROSS JOIN LATERAL jsonb_each(p.body_headers) h),'{}') END,
  'pages',coalesce(jsonb_agg(jsonb_build_array(page_id,page_kind,extract(epoch FROM built_at)::text,version,CASE WHEN saved OR unbuilt THEN NULL ELSE row END) ORDER BY page_id),'[]')) AS read
  FROM listed`;

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
  if(kept && Date.now()-kept.at<COMBINED_MS && (await query(PLACE_PRINT_SQL,params.slice(0,7)))[0]?.print===kept.print)return kept.place;
  const read=async(have:readonly string[])=>{
    const [{read:out}={}]=await query(PLACE_PAGES_SQL,[...params,have]);
    const {print,bodies,headers,held,pages}=out as {print:string;bodies:string[];headers:BodyHeaders;held:string[];pages:[string,string,string,number|null,unknown][]};
    const kept=new Set(held);
    return {print,bodies,headers,rows:pages.map(([page_id,page_kind,built,version,row])=>
      ({page_id,page_kind,version,row,built_at:Number(built)*1000,held:kept.has(`${page_id}:${version}:${page_kind}`)}))};
  };
  const rowKey=(row:{page_id:string;version:number|null;page_kind:string})=>`${prefix}${row.page_id}:${row.version}:${row.page_kind}`;
  let {rows,print,bodies,headers}=await read(remember?[...heldRows.keys()].filter(held=>held.startsWith(prefix)).map(held=>held.slice(prefix.length)):[]);
  if(rows.some(row=>row.held && !heldRows.has(rowKey(row))))({rows,print,bodies,headers}=await read([]));
  const withRows=rows.map(row=>row.held?{...row,row:heldRows.get(rowKey(row))}:row);
  // The national routing record is held once in this server's memory, not in each saved page.
  const routing=()=>input.bodyFactsOnly||input.meetingIds!==undefined?null:nationalEverydayRouting().catch(error=>{console.error("READER_ROUTING_UNAVAILABLE",error);return null;});
  // A selection with a place that has no saved content yet is assembled live from the fact store, as it was before saved pages. This goes when every place is built.
  if(withRows.some(row=>!row.row)) {
    const place={...await buildPlacePackage({...input,includeAgenda:input.includeAgenda??false},query),everydayRouting:await routing()};
    pageIds.set(place,rows.map(row=>row.page_id));
    return place;
  }
  if(remember)for(const row of withRows){
    heldRows.delete(rowKey(row));
    heldRows.set(rowKey(row),row.row);
  }
  for(const oldest of heldRows.keys()){ if(heldRows.size<=HELD_ROWS)break; heldRows.delete(oldest); }
  const empty=!input.allBodies&&!input.divisionIds.length&&!input.bodyIds?.length;
  const canonical={...input,bodyIds:bodies};
  const merged=mergePlaceRows(canonical,withRows.map(row=>({...currentPlaceRow(unpackPlaceContextRow(row.row),headers,input.placeId!==undefined),page_id:row.page_id,
    page_kind:empty?'empty':row.page_kind,built_at:row.built_at})));
  const place={...await composePlaceRow(canonical,merged),everydayRouting:await routing()};
  pageIds.set(place,rows.map(row=>row.page_id));
  if(remember && typeof print==="string") {
    combined.delete(key);
    combined.set(key,{print,at:Date.now(),place});
    for(const oldest of combined.keys()){ if(combined.size<=COMBINED_KEPT)break; combined.delete(oldest); }
  }
  return place;
}
