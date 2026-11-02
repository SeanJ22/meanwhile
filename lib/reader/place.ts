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
import { readSlicedRows } from "./place-slices.ts";
import { mergePlaceRows } from "./place-compose.ts";
import { currentPlaceRow } from "./place-identity.ts";
import { nationalEverydayRouting } from "./national.ts";
import type { PlaceInput, PlacePackage } from "./place-types.ts";
export type { PlaceInput, PlacePackage, AgendaDocumentLink } from "./place-types.ts";

export const identityCtes = `page_dependencies AS MATERIALIZED (
  SELECT s.id AS page_id,d.entity_id FROM selected s JOIN place_page p ON p.place_id=s.id CROSS JOIN LATERAL unnest(coalesce(p.depends,ARRAY(SELECT o.entity_id FROM place_page_dependency o WHERE o.page_id=p.place_id))) AS d(entity_id)
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

/**
 * The saved-page selection of the old place read, with the identity headers above. Only the ballot's read (lib/ballot/place-package-until-nov-4.ts)
 * uses them; they go with it after Nov 4 ET.
 */
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
    AND CASE WHEN EXISTS(SELECT 1 FROM place_page q WHERE q.place_id=x.entity_id AND q.depends IS NOT NULL)
      THEN EXISTS(SELECT 1 FROM place_page q WHERE q.place_id=x.entity_id AND q.stale_at IS NOT NULL)
      ELSE EXISTS(SELECT 1 FROM rebuild_queue q WHERE q.place_id=x.entity_id AND (q.built_generation IS NULL OR q.generation>q.built_generation)) END
  UNION SELECT id FROM entity WHERE kind='place' AND (state=$1::char(2) OR $1='US' AND id='ocd-division/country:us')
    AND id ~ '^ocd-division/country:us(/(state|territory|district):[a-z]{2})?$'
    AND (NOT $6::boolean AND cardinality($2::text[])=0 AND cardinality($3::text[])=0
      OR $6::boolean AND NOT EXISTS (SELECT 1 FROM state_bodies))
), ${identityCtes}`;

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
  const read=loadPlacePackage(selected,query());
  request?.set(key,read);
  return read;
}


/** A selection is answered from the slices of its places and boards, and from nothing a worker has still to build. */
async function loadPlacePackage(input:PlaceInput,query:Query|null):Promise<PlacePackage> {
  if(!query)throw new Error("FACT_STORE_DATABASE_URL_MISSING");
  const sliced=await readSlicedRows(input,query);
  const merged=mergePlaceRows(input,sliced.rows.map(row=>({...currentPlaceRow(row,sliced.headers,input.placeId!==undefined),page_id:row.page_id,page_kind:row.page_kind,built_at:row.built_at})));
  // The national routing record is held once in this server's memory, not in each place's slices.
  const routing=input.meetingIds!==undefined?null:await nationalEverydayRouting().catch(error=>{console.error("READER_ROUTING_UNAVAILABLE",error);return null;});
  const place={...await composePlaceRow(input,merged),everydayRouting:routing};
  pageIds.set(place,sliced.pages);
  return place;
}
