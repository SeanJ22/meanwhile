import { placeReadConnection } from "../repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { isDoorRecord, type DoorRecord } from "../../doors/registry.ts";
import { deadLinkReadings } from "../../health/surface-speed.ts";
import { DOORS_SHOWN, doorName, doorWhy, projectDoors, type DoorsView, type QueueDoorsView } from "./v6-doors-read.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { versionedRowsFor } from "../../db/versioned-rows.ts";
import { controlCounts } from "../repository/control-counts.ts";
import { peopleDoorCovers } from "../../doors/people-feeds.ts";

// The same validity test as isDoorRecord, evaluated before a row leaves PostgreSQL.
export const VALID_DOOR_SQL = `value->'formatVersion'='1'::jsonb
  AND jsonb_typeof(value->'doorId')='string' AND jsonb_typeof(value->'kind')='string'
  AND jsonb_typeof(value->'bodyIds')='array' AND jsonb_typeof(value->'hosts')='array'
  AND value->>'status' IN ('OPEN','SHUT','SUSPENDED') AND jsonb_typeof(value->'updatedAt')='string'`;
const DOOR_KEYS = ["doorId", "kind", "bodyIds", "hosts", "holds", "status", "updatedAt", "shutSince", "lastSuccessAt", "lastFailureAt", "shutReason", "lastFailureReason", "notes"];
export const OFFICIALS_DOOR_FIELDS = {formatVersion:true,doorId:true,kind:true,bodyIds:true,hosts:true,holds:true,status:true,updatedAt:true,
  lastSuccessAt:true,lastFailureAt:true,lastChangedAt:true,config:["sourceId","scope","sourceUrl","url","route","listUrl"]} as const;
export const ADMIN_DOOR_VALUE_SQL = `jsonb_build_object('formatVersion',1,'config','{}'::jsonb,
  ${DOOR_KEYS.map(key => `'${key}',value->'${key}'`).join(",")},
  'meeting',CASE WHEN value->'meeting' IS NULL OR value->'meeting'='null'::jsonb THEN NULL ELSE
    jsonb_build_object('jurisdiction',value #> '{meeting,jurisdiction}','publishingOrg',value #> '{meeting,publishingOrg}') END)`;

export async function readDoorCounts(repos: ControlPlaneRepositories): Promise<DoorsView["counts"]> {
  const sql = placeReadConnection(repos);
  if (!sql) {
    const rows = await repos.doors.listNarrowed({ formatVersion:true,doorId:true,kind:true,bodyIds:true,hosts:true,status:true,updatedAt:true });
    const doors = rows.map(row => row.value).filter(isDoorRecord);
    return { open:doors.filter(d=>d.status==='OPEN').length, shut:doors.filter(d=>d.status==='SHUT').length,
      setAside:doors.filter(d=>d.status==='SUSPENDED').length, unreadable:rows.length-doors.length };
  }
  return readDoorCountsFromSql(sql);
}

export async function readDoorCountsFromSql(sql: Sql): Promise<DoorsView["counts"]> {
  const rows = await controlCounts(sql, "cp_doors", ["OPEN", "SHUT", "SUSPENDED", "UNREADABLE"]);
  if (rows.length !== 4) throw new Error("Door counts have not been initialized");
  const counts = new Map(rows.map(row => [row.bucket, row.count]));
  return { open: counts.get("OPEN")!, shut: counts.get("SHUT")!, setAside: counts.get("SUSPENDED")!, unreadable: counts.get("UNREADABLE")! };
}

export async function readAdminDoors(repos: ControlPlaneRepositories, saves: readonly ActionReceipt[], observedAt: string): Promise<DoorsView> {
  const sql = placeReadConnection(repos);
  const counts = await readDoorCounts(repos);
  const fields = { formatVersion:true,doorId:true,kind:true,bodyIds:true,hosts:true,holds:true,status:true,updatedAt:true,
    shutSince:true,lastSuccessAt:true,lastFailureAt:true,shutReason:true,lastFailureReason:true,meeting:["jurisdiction","publishingOrg"] } as const;
  const rows = (sql ? await sql.query(`WITH shown AS (SELECT id FROM cp_doors WHERE ${VALID_DOOR_SQL}
    ORDER BY CASE value->>'status' WHEN 'SHUT' THEN 0 WHEN 'SUSPENDED' THEN 1 ELSE 2 END,id LIMIT ${DOORS_SHOWN})
    SELECT id,${ADMIN_DOOR_VALUE_SQL} AS value FROM cp_doors WHERE (${VALID_DOOR_SQL}) AND
      (id IN (SELECT id FROM shown) OR id=ANY($1::text[]))
    ORDER BY CASE value->>'status' WHEN 'SHUT' THEN 0 WHEN 'SUSPENDED' THEN 1 ELSE 2 END,id`, [saves.map(save=>save.subject)])
    : await repos.doors.listNarrowed(fields)) as readonly {value:unknown}[];
  const doors = rows.map(row=>typeof row.value==='string'?JSON.parse(row.value):row.value).filter(isDoorRecord);
  return { ...projectDoors({ doors, unreadable:counts.unreadable, saves, observedAt }), counts,
    total:counts.open+counts.shut+counts.setAside };
}

/** The Queue displays a shut source's name, reason and clock; the registry has its own wider reading. */
export async function readAdminQueueDoors(repos: ControlPlaneRepositories, observedAt: string): Promise<QueueDoorsView> {
  const sql = placeReadConnection(repos);
  if (sql) return readQueueDoorsFromSql(sql);
  const rows = await repos.doors.listWhereNarrowed(["status"],"SHUT",{formatVersion:true,doorId:true,kind:true,bodyIds:true,
      hosts:true,holds:true,status:true,updatedAt:true,shutSince:true,shutReason:true,lastFailureReason:true,meeting:["jurisdiction"]});
  const doors = rows.map(row=>typeof row.value==='string'?JSON.parse(row.value):row.value).filter(isDoorRecord);
  return {rows:projectDoors({doors,unreadable:0,saves:[],observedAt}).rows.map(({name,why,since})=>({name,why,since}))};
}

/** The ordinary checked SQL connection fingerprints this small selected result on every use. */
export async function readQueueDoorsFromSql(sql: Sql): Promise<QueueDoorsView> {
  const [row] = await boundedQuery(sql,{operation:"cp_doors.queue",callClass:"PAGE"},
    `SELECT coalesce(jsonb_agg(jsonb_build_array(value->'holds',value->'hosts'->0,value #> '{meeting,jurisdiction}',
      value->'shutReason',value->'lastFailureReason',value->'shutSince') ORDER BY id),'[]'::jsonb) AS doors
     FROM cp_doors WHERE id IN (SELECT id FROM cp_doors WHERE value->>'status'='SHUT' AND (${VALID_DOOR_SQL}) ORDER BY id LIMIT ${DOORS_SHOWN})`,[]) as {doors: readonly [readonly string[],string|null,string|null,string|null,string|null,string|null][]}[];
  if (!row || !Array.isArray(row.doors)) throw new Error("Shut sources could not be read");
  return {rows:row.doors.map(([holds,host,jurisdiction,shutReason,lastFailureReason,since])=>({
    name:doorName({holds,hosts:host?[host]:[],meeting:jurisdiction?{jurisdiction}:null}),why:doorWhy({shutReason,lastFailureReason}),since,
  }))};
}

/** A people-source list carries its identity, links and outcome clocks, never saved configuration payloads. */
export async function readOfficialsDoors(repos:ControlPlaneRepositories,divisions:readonly string[]):Promise<readonly DoorRecord[]> {
  const sql=placeReadConnection(repos);
  const fields=Object.keys(OFFICIALS_DOOR_FIELDS).filter(key=>key!=="config");
  const selected=`jsonb_build_object(${fields.map(key=>`'${key}',value->'${key}'`).join(",")},'config',
    jsonb_build_object(${OFFICIALS_DOOR_FIELDS.config.map(key=>`'${key}',value #> '{config,${key}}'`).join(",")}))`;
  const states=[...new Set(divisions.flatMap(id=>/^ocd-division\/country:us\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase()??[]))];
  const rows=sql?await versionedRowsFor(sql).selectedRows(async(text,params)=>await boundedQuery(sql,
    {operation:"cp_doors.officials",callClass:"PAGE"},text,params),"cp_doors",
    `SELECT id FROM cp_doors WHERE (${VALID_DOOR_SQL}) AND value->>'doorId' LIKE 'feed:%'
      AND value->'holds' ?| ARRAY['state-legislator','federal-directory']
      AND coalesce(value #>> '{config,sourceId}','')<>'people-portraits'
      AND (value #>> '{config,scope}'='US' OR value #>> '{config,scope}' LIKE 'US:%'
        OR substring(value #>> '{config,scope}' FROM '^US-([A-Z]{2})(?:$|:)')=ANY($1::text[])) ORDER BY id`,[states],selected)
    :await repos.doors.listNarrowed(OFFICIALS_DOOR_FIELDS);
  return rows.map(row=>typeof row.value==='string'?JSON.parse(row.value):row.value).filter(isDoorRecord)
    .filter(door=>peopleDoorCovers(door,divisions));
}

/** Link health is a few summary records; document contents never enter Admin. */
export async function readAdminDeadLinks(repos: ControlPlaneRepositories) {
  const rows = await repos.doors.listWhereNarrowed(["kind"],"link-sweep",{ kind:true,config:["surface","links","dead","sweptAt"] });
  return deadLinkReadings(rows.map(row=>row.value as Pick<DoorRecord,"kind"|"config">));
}

/** A shut door is already live and readers are affected; unchanged door rows are confirmed by revision, not re-sent. */
export async function readAdminShutDoors(sql: Sql): Promise<readonly DoorRecord[]> {
  const selected = `jsonb_build_object('formatVersion',1,'config','{}'::jsonb,'bodyIds','[]'::jsonb,
    'doorId',value->'doorId','kind',value->'kind','hosts',value->'hosts','status',value->'status',
    'updatedAt',value->'updatedAt','shutSince',value->'shutSince','lastFailureAt',value->'lastFailureAt','shutReason',value->'shutReason')`;
  const rows = await versionedRowsFor(sql).selectedRows(async(text,params)=>await boundedQuery(sql,
    {operation:"cp_doors.shut",callClass:"PAGE"},text,params),"cp_doors",
    `SELECT id FROM cp_doors WHERE value->>'status'='SHUT' AND (${VALID_DOOR_SQL})
     ORDER BY value->>'shutSince' ASC NULLS LAST,id LIMIT 300`,[],selected);
  return rows.map(row=>typeof row.value==='string'?JSON.parse(row.value):row.value).filter(isDoorRecord);
}
