/** Read-only preflight for the autonomous fleet. No bootstrap or mutation. */
import { neon } from "@neondatabase/serverless";
import { controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
const connection = controlPlaneUrlFromEnv();
if (!connection) throw new Error("CONTROL_PLANE_NOT_CONFIGURED");
const sql = neon(connection);
const rows = await sql.query(`SELECT statement_timestamp() AS observed_at,
 (SELECT version FROM cp_schema_version WHERE singleton=true) AS schema_version,
 (SELECT count(*) FROM cp_work_items) AS work_items,
 (SELECT count(*) FROM cp_log_worker_results) AS worker_results,
 (SELECT coalesce(jsonb_agg(value), '[]') FROM cp_work_items WHERE value->>'subject' ~* 'corona|springfield|atlantic|mescal') AS selected_items,
 (SELECT coalesce(jsonb_agg(jsonb_build_object('modelLaneEnabled',value->'modelLaneEnabled','pausedByOwner',value->'pausedByOwner','cycleFinishedAt',value->'cycleFinishedAt','bounds',value->'bounds')), '[]') FROM cp_research_state) AS research,
 (SELECT coalesce(jsonb_agg(record), '[]') FROM cp_log_costs WHERE (record->>'recordedAt')::timestamptz >= now()-interval '24 hours') AS costs`);
const r = rows[0];
console.log(JSON.stringify({ ...r, costs: undefined,
  selected_items: (r.selected_items as Record<string,unknown>[]).map(i => ({id:i.id,subject:i.subject,state:i.state,obligation:i.obligation,routeTaskIds:i.routeTaskIds})),
  costByRole: (r.costs as {role:string;cost:{usd:number|null}}[]).reduce((acc, row) => {
    const entry = acc[row.role] ??= { attempts: 0, measuredUsd: 0, unknown: 0 };
    entry.attempts++; if (row.cost.usd === null) entry.unknown++; else entry.measuredUsd += row.cost.usd;
    return acc;
  }, {} as Record<string,{attempts:number;measuredUsd:number;unknown:number}>) }, null, 2));
