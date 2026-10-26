import { placeReadConnection } from "../repository/pg-store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { isDoorRecord, type DoorRecord } from "../../doors/registry.ts";
import { deadLinkReadings } from "../../health/surface-speed.ts";
import { DOORS_SHOWN, projectDoors, type DoorsView } from "./v6-doors-read.ts";
import type { ActionReceipt } from "../gateway/contract.ts";
import type { Sql } from "../repository/pg-store.ts";
import { versionedRowsFor } from "../../db/versioned-rows.ts";

// The same validity test as isDoorRecord, evaluated before a row leaves PostgreSQL.
export const VALID_DOOR_SQL = `value->'formatVersion'='1'::jsonb
  AND jsonb_typeof(value->'doorId')='string' AND jsonb_typeof(value->'kind')='string'
  AND jsonb_typeof(value->'bodyIds')='array' AND jsonb_typeof(value->'hosts')='array'
  AND value->>'status' IN ('OPEN','SHUT','SUSPENDED') AND jsonb_typeof(value->'updatedAt')='string'`;
const DOOR_KEYS = ["doorId", "kind", "bodyIds", "hosts", "holds", "status", "updatedAt", "shutSince", "lastSuccessAt", "lastFailureAt", "shutReason", "lastFailureReason", "notes"];
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
  const [row] = await sql.query(`WITH doors AS (SELECT value, (${VALID_DOOR_SQL}) IS TRUE AS valid FROM cp_doors)
    SELECT count(*) FILTER (WHERE valid AND value->>'status'='OPEN')::text AS open,
      count(*) FILTER (WHERE valid AND value->>'status'='SHUT')::text AS shut,
      count(*) FILTER (WHERE valid AND value->>'status'='SUSPENDED')::text AS aside,
      count(*) FILTER (WHERE NOT valid)::text AS unreadable FROM doors`) as Record<string,unknown>[];
  return { open:Number(row.open),shut:Number(row.shut),setAside:Number(row.aside),unreadable:Number(row.unreadable) };
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

/** Link health is a few summary records; document contents never enter Admin. */
export async function readAdminDeadLinks(repos: ControlPlaneRepositories) {
  const rows = await repos.doors.listWhereNarrowed(["kind"],"link-sweep",{ kind:true,config:["surface","links","dead","sweptAt"] });
  return deadLinkReadings(rows.map(row=>row.value as Pick<DoorRecord,"kind"|"config">));
}

export async function readAdminShutDoors(sql: Sql): Promise<readonly DoorRecord[]> {
  const rows = await versionedRowsFor(sql).rows((text,params)=>sql.query(text,[...params]), "cp_doors",
    `value->>'status'='SHUT' AND (${VALID_DOOR_SQL})`, [], ADMIN_DOOR_VALUE_SQL);
  return rows.map(row=>typeof row.value==='string'?JSON.parse(row.value):row.value).filter(isDoorRecord);
}
