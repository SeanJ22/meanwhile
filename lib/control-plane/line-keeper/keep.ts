import type { Sql } from "../repository/pg-store.ts";
import { fixItems, withFixAdded } from "../fix-list.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, type AdminConfig } from "../gateway/admin-config.ts";
import { projectBrief, easternBriefClock } from "../admin-view/brief.ts";
import { processNeonBytes } from "../../db/transfer-by-caller.ts";
import { countProblems } from "../../counts/hour.ts";
import { readHour, query } from "./read.ts";
import { LINE_KEEPER_BY, type LineHour } from "./model.ts";

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
  const problems=new Map(latest.problems.map(p=>[p.key,p]));
  for(const p of hour.problems)problems.set(`line-keeper:${p.key}`,{key:`line-keeper:${p.key}`,what:p.says,owner:p.owner,next:p.next});
  return {...next,latestBrief:{...latest,lineKeeperOnly:next.latestBrief?.day===day?next.latestBrief.lineKeeperOnly:true,createdAt:hour.measuredAt,problems:[...problems.values()]},updatedAt:hour.measuredAt};
}
async function writeFixes(sql:Sql,hour:LineHour) {
  if(!hour.problems.length)return;
  const keys=hour.problems.map(p=>`line-keeper:${p.key}`);
  for(let attempt=0;attempt<4;attempt++) {
    const [row]=await query(sql,"fix-settings",`SELECT revision,value->'latestBrief' AS brief FROM cp_admin_config WHERE id=$1`,[ADMIN_CONFIG_ID]);
    if(!row)throw Error("Admin settings are unavailable; the hourly repair work was not saved");
    const fixes=await query(sql,"affected-fixes",`SELECT value FROM cp_admin_fix_list WHERE config_id=$1
      AND value->'technical' ?| $2::text[]`,[ADMIN_CONFIG_ID,keys]);
    const before={...defaultAdminConfig(hour.measuredAt),latestBrief:row.brief as AdminConfig['latestBrief'],fixList:fixes.map(f=>f.value as import('../fix-list.ts').FixItem)};
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
  const hour:LineHour={...input.window,measuredAt:at,counts:input.counts,waiting:input.waiting,
    problems:countProblems(input.counts,input.previous,input.waiting,at),own:{bytesRead:Math.max(0,ownBytes()-baseline)}};
  if(!options.readOnly) {
    await retireLineInventory(control);
    await writeFixes(control,hour);
    await query(control,"retire-old-runs",`DELETE FROM line_keeper_run WHERE hour < $1::timestamptz - interval '2 hours'`,[hour.from]);
    await query(control,"save-run",`INSERT INTO line_keeper_run(hour,checked_at,problems,bytes_read)
      VALUES($1::timestamptz,$2::timestamptz,$3,$4) ON CONFLICT(hour) DO UPDATE SET
        checked_at=excluded.checked_at,problems=excluded.problems,bytes_read=excluded.bytes_read`,
      [hour.from,at,hour.problems.length,hour.own.bytesRead]);
  }
  return {hour};
}
