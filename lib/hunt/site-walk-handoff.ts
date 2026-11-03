import {controlPlaneQuery,workList,type WorkList,type WorkRow} from '../core/work.ts';

/** A link that could not be read this many times is a dead end that waits for a better way to read it. */
const ATTEMPTS=5;
/** No dead end waits longer than this before another try. */
const REST_MS=5*24*3600000;
export interface WalkLead {url:string;bodyId?:string}
export interface HandedLinks {readonly leads:readonly WalkLead[];readonly claims:ReadonlyMap<string,WorkRow>}

let shared:WorkList|undefined;
/** The walk's own handle on the work list; a link it takes is its for the length of one walk. */
export const walkList=():WorkList=>shared??=workList(controlPlaneQuery(),{owner:'site-walk',leaseMs:300_000});

const host=(url:string)=>{try{return new URL(url).hostname.toLowerCase().replace(/^www\./,'');}catch{return null;}};

/** The links hunters found under a government, taken off the work list to go to the front of its next walk: on the government's own site, one per address. A link on another site is not the walk's to read, so it rests. */
export async function handedLinks(input:{list:WorkList;governmentIds:readonly string[];website:string;limit:number;now?:()=>number}):Promise<HandedLinks>{
  const own=host(input.website),claims=new Map<string,WorkRow>(),leads:WalkLead[]=[];
  if(!own)return {leads,claims};
  for(const government of input.governmentIds){
    for(const claim of await input.list.claim('lead',input.limit,{government,untagged:true})){
      const at=host(claim.url!);
      if(!at || at!==own && !at.endsWith(`.${own}`)){await input.list.release(claim,new Date((input.now?.()??Date.now())+REST_MS).toISOString());continue;}
      claims.set(claim.url!,claim);
      leads.push({url:claim.url!,...claim.subjectId?.includes('#body:')?{bodyId:claim.subjectId}:{}});
    }
  }
  return {leads,claims};
}

/** A link the walk read is done; one it could not read waits and is tried again, and after repeated failures it is a dead end. A link the pass did not get to goes back as it was, still first in line. */
export async function settleHandedLinks(input:{list:WorkList;handed:HandedLinks;read:ReadonlySet<string>;failed:ReadonlyMap<string,string>}):Promise<{read:number;failed:number}> {
  const tally={read:0,failed:0};
  for(const [url,claim] of input.handed.claims){
    const reason=input.failed.get(url);
    if(input.read.has(url)){await input.list.finish(claim);tally.read++;}
    else if(reason===undefined)await input.list.release(claim);
    else{
      if(claim.attempts>=ATTEMPTS)await input.list.refuse(claim,reason,{kind:'method',text:reason,...claim.state==='US'?{}:{state:claim.state.toLowerCase()}});
      else await input.list.later(claim,reason);
      tally.failed++;
    }
  }
  return tally;
}
