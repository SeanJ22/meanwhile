import type { Clocks,Query } from "../facts/publish.ts";
import { factClocks } from "../facts/clocks.ts";
import { runBoundedWorkPool } from "../ops/bounded-work-pool.ts";
import { CAMPAIGN_FINANCE_SOURCES,campaignFinanceNativeScope,type CampaignFinanceWorkCheck } from "./state-sources.ts";
import { CAMPAIGN_STATE_CLOCK_FIELDS } from "./state-cadence.ts";
import { campaignMoneyStateDue } from "./state-people.ts";
import { campaignMoneyDependencyHash } from "./state-source-probe.ts";

type Work=Partial<CampaignFinanceWorkCheck["records"][number]>;
export const CAMPAIGN_LOCAL_REPAIR_SQL=`SELECT EXISTS(
  SELECT 1 FROM entity committee JOIN fact f ON f.entity_id=committee.id AND f.status='live' AND f.field LIKE 'campaign-money:%'
    JOIN entity person ON person.id=committee.parent_id AND person.kind='person' AND person.state=$1
  WHERE committee.state=$1 AND f.value#>>'{person,id}'=person.id AND f.value#>>'{person,name}'=person.name
    AND f.value->>'filingState'='FILED' AND jsonb_array_length(f.value->'amounts')>0
    AND NOT EXISTS(SELECT 1 FROM fact cycle WHERE cycle.entity_id=person.id AND cycle.status='live'
      AND cycle.field='campaign-cycle:'||committee.id||':'||(f.value->>'cycle')
      AND cycle.value#>>'{person,name}'=person.name AND cycle.value#>>'{person,seat}'=f.value#>>'{person,seat}')
) AS needed`;

/** Only an input digest and an existence bit cross the wire; held filing bodies stay closed until work changed. */
export async function campaignMoneyLocalWorkDue(query:Query,state:string,held:Work|null):Promise<boolean>{
  if(!held)return false;
  if(held.heldContinuationPending===true)return true;
  if(await campaignMoneyDependencyHash(query,state)!==held.dependencyHash)return true;
  const [row]=await query(CAMPAIGN_LOCAL_REPAIR_SQL,[state]);
  return row?.needed===true;
}

/** The national command routes state work; each actual publisher keeps its own clock. */
export async function readCampaignMoneyAdmission(query:Query,at:string,clocks:Clocks=factClocks(null),states=CAMPAIGN_FINANCE_SOURCES.map(source=>source.state)){
  const keys=new Map(states.map(state=>[campaignFinanceNativeScope(state),state]));
  const rows=await query(`SELECT name,(SELECT coalesce(jsonb_object_agg(k,position::jsonb->k),'{}'::jsonb)
    FROM unnest($2::text[])k WHERE position::jsonb?k)AS position FROM pass_cursor WHERE name=ANY($1::text[])`,[[...keys.keys()],CAMPAIGN_STATE_CLOCK_FIELDS]);
  const held=new Map<string,Work>();
  for(const row of rows){const state=keys.get(String(row.name));if(!state)continue;
    try{held.set(state,(typeof row.position==="string"?JSON.parse(row.position):row.position) as Work);}catch{/* A missing clock is owed as a first actual source baseline. */}}
  const results=await runBoundedWorkPool(states,4,async state=>{
    const work=held.get(state)??null,providerDue=campaignMoneyStateDue(work,at,clocks);
    return{state,providerDue,localDue:!providerDue&&await campaignMoneyLocalWorkDue(query,state,work)};
  });
  const work=results.map(result=>{if(!result.ok)throw Error(result.error);return result.value;});
  return{providerDue:work.some(row=>row.providerDue),localDue:work.some(row=>row.localDue),work};
}
