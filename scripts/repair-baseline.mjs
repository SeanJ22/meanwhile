import { readFile, mkdir, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { neon } from "@neondatabase/serverless";

const envPath = process.argv[2];
const output = process.argv[3];
if (!envPath || !output) throw new Error("Pass existing environment path and external evidence directory.");
const env = parseEnv(await readFile(envPath,"utf8"));
const url = env.WTP_CONTROL_PLANE_DATABASE_URL;
if (!url) throw new Error("Existing control-plane connection unavailable");
const sql = neon(url);
const [clock, beats, research, configs, budgets, counts, costs, published] = await sql.transaction([
  sql`SELECT now() AS observed_at`,
  sql`SELECT id,updated_at,value FROM cp_runner_heartbeat`,
  sql`SELECT id,updated_at,value->>'testedSha' AS tested_sha,value->>'cycleStartedAt' AS cycle_started,value->>'cycleFinishedAt' AS cycle_finished,value->'assignments' AS assignments,value->'researchProgression' AS progression,value->'bounds' AS bounds,value->'dispatchWork' AS dispatch_work FROM cp_research_state`,
  sql`SELECT id,revision,updated_at,value FROM cp_admin_config`,
  sql`SELECT id,updated_at,value FROM cp_budget WHERE id LIKE '%85635%' OR value::text LIKE '%85635%'`,
  sql`SELECT value->>'state' AS state,count(*)::int AS count FROM cp_work_items GROUP BY value->>'state'`,
  sql`SELECT record_id,recorded_at,record FROM cp_log_costs WHERE recorded_at >= '2026-09-27T22:17:50.236Z' ORDER BY recorded_at,record_id`,
  sql`SELECT record_id,recorded_at,record FROM cp_log_promotion_pipeline WHERE recorded_at >= '2026-09-27T22:17:50.236Z' AND record->>'stage' = 'APPROVED_FOR_PROMOTION' ORDER BY recorded_at,record_id`
],{readOnly:true,isolationLevel:"RepeatableRead"});
const selectedResearch = research.map(r=>({...r, assignments: r.assignments?.assignments?.filter(a=>a.key === "zcta:2020/85635") ?? r.assignments }));
const result = {kind:"READ_ONLY_BASELINE",observedAt:clock[0].observed_at,beats,research:selectedResearch,configs,budgets,counts,costs,published};
await mkdir(output,{recursive:true});
await writeFile(`${output}/baseline.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify({observedAt:result.observedAt,beats:beats.map(b=>({id:b.id,updatedAt:b.updated_at,beatAt:b.value.beatAt,testedSha:b.value.testedSha,lastCycleOk:b.value.lastCycleOk,nextCycleDueAt:b.value.nextCycleDueAt})),research:selectedResearch.map(r=>({at:r.updated_at,sha:r.tested_sha,start:r.cycle_started,finish:r.cycle_finished,assignments:r.assignments?.map?.(a=>({key:a.key,budget:a.budget,completion:a.completion}))})),configIds:configs.map(r=>r.id),budgetRows:budgets.length,counts,costRows:costs.length,approvedRows:published.length}));
