import { REGISTRY_STATES } from "../../civic-data/state-scopes.ts";
import type { Sql } from "../repository/pg-store.ts";
import { fixItems, withFixAdded } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { projectBrief, easternBriefClock } from "../admin-view/brief.ts";
import { processNeonBytes } from "../../db/transfer-by-caller.ts";
import { countProblems, type CountProblem } from "../../counts/hour.ts";
import { groupCountProblems } from "../../counts/problem-groups.ts";
import { readHour, readRunnerReadProblems, readJobBreakerEvents, query } from "./read.ts";
import { runnerFamilyLabel } from "../../db/runner-read-families.ts";
import { formatEastern } from "../eastern-time.ts";
import { LINE_KEEPER_BY, type LineHour } from "./model.ts";
import { versionedRowsFor } from "../../db/versioned-rows.ts";

function ownBytes() { return processNeonBytes().reduce((n,h)=>n+Object.values(h.byCaller).reduce((a,b)=>a+b,0),0); }
/** Deduplicated owned repairs use the existing list and brief. A quiet counter cannot close a repair. */
export function withKeeperFixes(config: AdminConfig, hour: LineHour): AdminConfig {
  let next=config;
  for(const p of hour.problems) next=withFixAdded(next,{where:p.where,says:p.says,owner:p.owner,
    addedBy:LINE_KEEPER_BY,at:hour.measuredAt,sourceKey:`line-keeper:${p.key}`,
    technical:[`line-keeper:${p.key}`,`Observed window: ${hour.from} to ${hour.through}`]});
  const active=new Map(hour.problems.map(p=>[`line-keeper:${p.key}`,p]));
  next={...next,fixList:fixItems(next).map(item=>{
    const problem=item.technical?.map(key=>active.get(key)).find(Boolean);
    return problem?{...item,says:problem.says,owner:problem.owner}:item;
  })};
  const day=easternBriefClock(hour.measuredAt).day;
  const latest=next.latestBrief?.day===day?next.latestBrief:projectBrief(next,[],hour.measuredAt);
  const counted=hour.problems.filter((problem):problem is CountProblem=>"kind" in problem);
  const observations=hour.problems.filter(problem=>!("kind" in problem)).map(problem=>({
    key:`line-keeper:${problem.key}`,what:problem.says,owner:problem.owner,next:problem.next,
  }));
  const problems=[...latest.problems.filter(p=>!p.key.startsWith("line-keeper:")),...groupCountProblems(counted),...observations];
  const breakerUpdates=(hour.breakerEvents??[]).map(event=>({id:`job-breaker:${event.id}`,
    what:`${runnerFamilyLabel(event.job!)} ${event.action === "PAUSE" ? "paused new launches" : "resumed at half rate"} after ${Number(event.gb).toFixed(3)} GB in the measured hour.`,
    when:formatEastern(event.checked_at),label:"Proven",isWin:false,before:null,after:null,evidenceHref:null}));
  const ids=new Set(breakerUpdates.map(update=>update.id));
  const updates=[...breakerUpdates,...latest.updates.filter(update=>!ids.has(update.id))];
  return {...next,latestBrief:{...latest,updates,lineKeeperOnly:next.latestBrief?.day===day?next.latestBrief.lineKeeperOnly:true,createdAt:hour.measuredAt,problems},updatedAt:hour.measuredAt};
}
async function writeFixes(sql:Sql,hour:LineHour) {
  const keys=hour.problems.map(p=>`line-keeper:${p.key}`);
  const reads=versionedRowsFor(sql);
  for(let attempt=0;attempt<4;attempt++) {
    const row=await reads.one((text,params)=>query(sql,"fix-settings",text,params),"cp_admin_config",ADMIN_CONFIG_ID,"value->'latestBrief'");
    if(!row)throw Error("Admin settings are unavailable; the hourly repair work was not saved");
    const versions=await query(sql,"affected-fixes",`SELECT id,concat(xmin::text,'/',ctid::text) AS revision FROM cp_admin_fix_list WHERE config_id=$1
      AND value->'technical' ?| $2::text[]`,[ADMIN_CONFIG_ID,keys]) as {id:string;revision:string}[];
    const fixes=await reads.known("cp_admin_fix_list",versions,`line-keeper:${ADMIN_CONFIG_ID}`,async ids=>query(sql,"affected-fix-values",
      "SELECT id,value,concat(xmin::text,'/',ctid::text) AS revision FROM cp_admin_fix_list WHERE config_id=$1 AND id=ANY($2::text[])",[ADMIN_CONFIG_ID,ids]),
      row=>String(row.id),row=>String(row.revision));
    const before={...defaultAdminConfig(hour.measuredAt),latestBrief:row.value as AdminConfig['latestBrief'],fixList:fixes.map(f=>f.value as import('../fix-list.ts').FixItem)};
    const next=withKeeperFixes(before,hour);
    const saved=await query(sql,"save-fixes",`WITH saved AS (
      UPDATE cp_admin_config SET revision=revision+1,updated_at=$2::timestamptz,
        value=value||$3::jsonb WHERE id=$1 AND revision=$4 RETURNING id
    ), fixes AS (
      INSERT INTO cp_admin_fix_list(config_id,id,updated_at,value)
      SELECT saved.id,item->>'id',$2::timestamptz,item FROM saved CROSS JOIN jsonb_array_elements($5::jsonb) item
      ON CONFLICT(config_id,id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at
      WHERE cp_admin_fix_list.value IS DISTINCT FROM excluded.value RETURNING id
    ) SELECT id FROM saved`,[ADMIN_CONFIG_ID,hour.measuredAt,JSON.stringify({latestBrief:next.latestBrief,updatedAt:hour.measuredAt}),
      Number(row.revision),JSON.stringify(fixItems(next))]);
    if(saved.length)return;
  }
  throw Error("Admin settings changed during every hourly repair save");
}
/** Both normal and deploy invocations retire the old store without downloading it. */
export async function retireLineInventory(control:Sql) {
  await query(control,"retire-inventory","DELETE FROM cp_owner_snapshots WHERE id='line-keeper:current'");
  await query(control,"retire-country-inputs",`UPDATE cp_owner_snapshots SET value=value-ARRAY['capture','inputs']::text[],
    revision=revision+1,updated_at=statement_timestamp() WHERE id LIKE 'line-keeper:country:%'
    AND value ?| ARRAY['capture','inputs']::text[]`);
}
export async function runLineKeeper(control:Sql,reader:Sql,at:string,options:{readonly readOnly?:boolean}={}) {
  const baseline=ownBytes();
  const input=await readHour(control,reader,at);
  const readProblems=await readRunnerReadProblems(reader,input.window.from,input.window.through).catch(()=>[{
    key:"runner-reads:unread",where:"Runner database reads",says:"The runner’s hourly database reads could not be compared with the previous 24 hours.",
    owner:"the database workers",next:"Restore the hourly read comparison and check the affected job families.",
  }]);
  let breakerEvents: Awaited<ReturnType<typeof readJobBreakerEvents>> = [];
  try { breakerEvents=await readJobBreakerEvents(control,input.window.from,input.window.through); }
  catch { readProblems.push({key:"job-breaker:unread",where:"Job transfer protection",
    says:"The hourly pause and resume report could not be read.",owner:"the runner workers",next:"Restore the job transfer control log."}); }
  const hour:LineHour={...input.window,measuredAt:at,counts:input.counts,waiting:input.waiting,
    breakerEvents,problems:[...countProblems(input.counts,input.previous,input.waiting,at),...readProblems],own:{bytesRead:Math.max(0,ownBytes()-baseline)}};
  const oldest:Record<string,{n:number;at:string|null}>={};
  for(const waiting of input.waiting) {
    const code=REGISTRY_STATES.some(state=>state===waiting.state)?waiting.state:"US";
    const held=oldest[code];
    oldest[code]={n:(held?.n??0)+waiting.count,at:!waiting.oldestAt||held?.at===null?null:
      held?.at&&held.at<waiting.oldestAt?held.at:waiting.oldestAt};
  }
  if(!options.readOnly) {
    await retireLineInventory(control);
    await writeFixes(control,hour);
    await query(control,"retire-old-runs",`DELETE FROM line_keeper_run WHERE hour < $1::timestamptz - interval '2 hours'`,[hour.from]);
    await query(control,"save-run",`INSERT INTO line_keeper_run(hour,checked_at,problems,bytes_read,oldest)
      VALUES($1::timestamptz,$2::timestamptz,$3,$4,$5::jsonb) ON CONFLICT(hour) DO UPDATE SET
        checked_at=excluded.checked_at,problems=excluded.problems,bytes_read=excluded.bytes_read,oldest=excluded.oldest`,
      [hour.from,at,hour.problems.length,hour.own.bytesRead,JSON.stringify(oldest)]);
  }
  return {hour};
}
