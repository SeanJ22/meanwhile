import type { ScoreboardRow } from "../../../app/(admin)/_mw/admin-v6/model.ts";
import { REGISTRY_STATES } from "../../civic-data/state-scopes.ts";
import { keeperStatus, type LineState } from "./model.ts";
const n=(value:number)=>value.toLocaleString("en-US");
export function keeperRows(state:LineState|null,at:string):readonly [string,ScoreboardRow][] {
  if(!state?.hours.length)return [];
  const current=state.hours[0];
  const states=[...new Set([...REGISTRY_STATES,"US",...state.hours.flatMap(h=>h.counts?.map(c=>c.state)??[])])].sort();
  const total=current.counts?.filter(c=>c.stage==='fact:live').reduce((sum,c)=>sum+c.total,0)??null;
  const liveRows=current.counts?.filter(c=>c.stage==='fact:live');
  const incoming=liveRows?.some(c=>c.incoming===null)?null:liveRows?.reduce((sum,c)=>sum+c.incoming!,0)??null;
  const status=keeperStatus(state,at);
  return [["Facts live per hour (fact store)",{id:"Facts live per hour (fact store)",name:"Hourly counts",value:total===null?null:n(total),
    counts:incoming===null?(total===null?null:`${n(total)} facts marked live now`):`${n(total!)} facts marked live now · ${n(incoming)} became live in the last full hour`,says:status,
    notMeasured:total===null?"The hourly counts are unavailable.":null,items:[],technical:[],
    hourlyCounts:{at,status,states,hours:state.hours.map(h=>({from:h.from,through:h.through,measuredAt:h.measuredAt,counts:h.counts,waiting:h.waiting}))}}]];
}
