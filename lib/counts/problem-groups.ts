import { countOwner, type CountProblem } from "./hour.ts";

export interface BriefProblem {
  readonly key:string; readonly what:string; readonly owner:string; readonly next:string;
  readonly group?: { readonly kind:CountProblem["kind"]; readonly items:number|null;
    readonly states:readonly {readonly state:string;readonly items:number|null;readonly problems:number}[] };
}
const words:Record<CountProblem["kind"],{title:string;next:string}> = {
  cache:{title:"Reader updates failed",next:"Repair the refreshes."},
  untimed:{title:"Waiting times are missing",next:"Restore the starting times."},
  expired:{title:"Work stopped before it finished",next:"Resume the unfinished work."},
  growing:{title:"Waiting work is growing",next:"Unblock the next step."},
  waiting:{title:"Work has waited at least an hour",next:"Unblock the next step."},
};
export function groupCountProblems(problems:readonly CountProblem[]):BriefProblem[] {
  return Object.entries(words).flatMap(([kind,copy])=>{
    const members=problems.filter(p=>p.kind===kind);
    if(!members.length)return [];
    const states=new Map<string,{state:string;items:number;problems:number}>();
    for(const p of members){const old=states.get(p.state);states.set(p.state,{state:p.state,items:(old?.items??0)+p.items,problems:(old?.problems??0)+1});}
    const owners=[...new Set(members.map(p=>countOwner(p.owner)))];
    return [{key:`line-keeper:group:${kind}`,what:copy.title,owner:owners.length===1?owners[0]:"The team",next:copy.next,
      group:{kind:kind as CountProblem["kind"],items:members.reduce((n,p)=>n+p.items,0),
        states:[...states.values()].sort((a,b)=>b.items-a.items||a.state.localeCompare(b.state))}}];
  });
}

/** Read already-saved daily snapshots without waiting for the next scheduled run. */
export function compactKeeperProblems(problems:readonly BriefProblem[]):BriefProblem[] {
  const legacy:CountProblem[]=[];
  const kept=problems.filter(p=>{
    const match=/^line-keeper:(counts|count-age):([A-Z]{2}):/.exec(p.key);
    if(!match)return true;
    const kind:CountProblem["kind"]=match[1]==="count-age"?"untimed":/cache refresh|reader updates? failed/.test(p.what)?"cache":
      /leases expired|assignments stopped/.test(p.what)?"expired":/pile grew|more came in/.test(p.what)?"growing":"waiting";
    const amount=/^([\d,]+)/.exec(p.what);
    // Older untimed findings did not save an item count. Keep it unknown instead of inventing one.
    legacy.push({kind,state:match[2],items:amount?Number(amount[1].replaceAll(",","")):0,
      key:p.key,where:match[2],says:p.what,owner:p.owner,next:p.next});
    return false;
  });
  return [...kept,...groupCountProblems(legacy).map(p=>p.group?.kind==="untimed"?{...p,group:{...p.group,items:null,
    states:p.group.states.map(s=>({...s,items:null}))}}:p)];
}
