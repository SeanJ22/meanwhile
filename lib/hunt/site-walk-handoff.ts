import {findingFact,finishBoxFinding,takeBoxFinding,type BoxFinding,type BoxRepository} from '../control-plane/box.ts';
import {SITE_WALK_LEAD} from '../facts/finding-slots.ts';

/** The builder name a walk gives itself on the links it reads. */
const SITE_WALK='site-walk';
/** A link that failed this many times waits before the walk tries it again, so one broken link never takes the front of every walk. */
const FAILURES_BEFORE_REST=3;
/** No dead end waits longer than this before another try. */
const REST_MS=5*24*3600000;
const LEASE_MS=30*60000;
export interface WalkLead {url:string;bodyId?:string}
export interface HandedLinks {readonly leads:readonly WalkLead[];readonly rows:ReadonlyMap<string,readonly BoxFinding[]>}

const host=(url:string)=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}};

/** The links hunters found on a government's pages, ready to go to the front of its next walk: on the government's own site, not tried and failed lately, one per address. */
export async function handedLinks(input:{boxFindings:BoxRepository;governmentIds:readonly string[];website:string;now:string;limit:number}):Promise<HandedLinks>{
  const own=host(input.website);
  const rows=new Map<string,BoxFinding[]>(),leads:WalkLead[]=[];
  if(!own)return {leads,rows};
  for(const row of await input.boxFindings.waitingUnder(SITE_WALK_LEAD,input.limit,input.governmentIds)){
    const url=findingFact(row)?.value;
    if(typeof url!=='string')continue;
    const at=host(url);
    if(!at || at!==own && !at.endsWith(`.${own}`))continue;
    const failed=row.attempts.filter(attempt=>attempt.outcome==='failed');
    if(failed.length>=FAILURES_BEFORE_REST && Date.parse(input.now)-Date.parse(failed.at(-1)!.endedAt)<REST_MS)continue;
    if(!rows.has(url)){
      rows.set(url,[]);
      if(leads.length<input.limit)leads.push({url,...row.subjectId.includes('#body:')?{bodyId:row.subjectId}:{}});
    }
    rows.get(url)!.push(row);
  }
  return {leads:leads.filter(lead=>rows.has(lead.url)),rows};
}

/** A link the walk read is done; one it could not read goes back to waiting with the reason, and rests after repeated failures. A link the pass did not get to stays first in line. */
export async function settleHandedLinks(input:{boxFindings:BoxRepository;handed:HandedLinks;read:ReadonlySet<string>;failed:ReadonlyMap<string,string>;attemptId:string;now:string}):Promise<{built:number;failed:number}> {
  const tally={built:0,failed:0};
  const end=new Date(Date.parse(input.now)+LEASE_MS).toISOString();
  for(const [url,rows] of input.handed.rows){
    const outcome=input.read.has(url)?{state:'built' as const,buildResultId:`site-walk:${input.attemptId}`}
      :input.failed.has(url)?{state:'failed' as const,reason:input.failed.get(url)!}:null;
    if(!outcome)continue;
    for(const row of rows){
      const claim=await takeBoxFinding(input.boxFindings,row.id,SITE_WALK,input.now,end);
      if(!claim)continue;
      await finishBoxFinding(input.boxFindings,row.id,claim.token,outcome,input.now);
      tally[outcome.state==='built'?'built':'failed']++;
    }
  }
  return tally;
}
