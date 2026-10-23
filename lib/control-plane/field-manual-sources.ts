import { domainToUnicode } from "node:url";
import { entryInSlice, type FieldManualEntry, type FieldManualOutcome, type FieldManualQuery } from "./field-manual.ts";

export type FieldManualSourceScope = Pick<FieldManualQuery,"ocdIds"|"bodyIds"|"state">;
export interface FieldManualSourceHint {
  readonly url:string;
  readonly outcome:FieldManualOutcome;
  readonly observedAt:string|null;
  readonly worked:boolean;
  readonly workedFor:readonly string[];
}

export function sourceOriginKeys(value:string):string[] {
  const url=new URL(value),hosts=new Set([url.hostname,domainToUnicode(url.hostname)||url.hostname]);
  return [...hosts].flatMap(host=>{
    const origin=`${url.protocol}//${host}${url.port?`:${url.port}`:""}`;
    const defaultPort=!url.port?(url.protocol==="https:"?"443":url.protocol==="http:"?"80":null):null;
    return defaultPort?[origin,`${origin}:${defaultPort}`]:[origin];
  }).map(origin=>origin.toLowerCase());
}

export function sourceHintsOf(entries:readonly FieldManualEntry[],scope:FieldManualSourceScope,url:string):FieldManualSourceHint[] {
  const origin=new URL(url).origin;
  const hints=new Map<string,{latest:FieldManualEntry;firstWorked:string|null;classes:Set<string>}>();
  for(const entry of [...entries].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)) {
    if(entry.url===null||!entryInSlice(entry,scope))continue;
    try {if(new URL(entry.url).origin!==origin)continue;}catch{continue;}
    const held=hints.get(entry.url)??{latest:entry,firstWorked:null,classes:new Set<string>()};
    if((entry.observedAt??"")>(held.latest.observedAt??""))held.latest=entry;
    if(entry.outcome==="YIELDED") {
      held.firstWorked??=entry.id;
      for(const kind of entry.recordClasses)held.classes.add(kind);
    }
    hints.set(entry.url,held);
  }
  return [...hints.values()].sort((a,b)=>{
    if(a.firstWorked===null&&b.firstWorked!==null)return 1;
    if(a.firstWorked!==null&&b.firstWorked===null)return -1;
    const left=a.firstWorked??a.latest.url!,right=b.firstWorked??b.latest.url!;
    return left<right?-1:left>right?1:0;
  }).map(({latest,firstWorked,classes})=>({url:latest.url!,outcome:latest.outcome,observedAt:latest.observedAt,
    worked:firstWorked!==null,workedFor:[...classes].sort()}));
}
