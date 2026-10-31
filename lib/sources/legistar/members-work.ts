import { ITEM_READ_MS, runClaimLoop } from "../../ops/claim-loop.ts";
import type { WorkRow,workList } from "../../core/work.ts";
import { LEGISTAR_MEMBER_CADENCE_MS,LEGISTAR_MEMBER_SUBJECT } from "./members-queue.ts";

export { HICCUPS_BEFORE_STOPPING } from "../../ops/claim-loop.ts";

export const newMemberStats=()=>({claimed:0,done:0,refused:0,failed:0,released:0});

/** Slots are claimed directly on the shared list, independently of the routine source scheduler. A check ends at the item limit and goes back to waiting; a tenant load has none. */
export async function runLegistarMemberWorkers(input:{list:ReturnType<typeof workList>;kind:"load"|"check";concurrency:number;
  maxClaims?:number;turnEnd?:AbortSignal; // at the turn's end, running work is cut off and its row goes back to waiting
  stopRequested:()=>boolean;run:(claim:WorkRow,signal:AbortSignal)=>Promise<void|{refused?:string}>;
  sleep?:(ms:number)=>Promise<void>;log?:(message:string)=>void;stats?:ReturnType<typeof newMemberStats>}) { // counts as they happen, for the turn's minute line
  const stats=input.stats??newMemberStats(),{list,kind}=input;
  await runClaimLoop({...input,stats,readMs:kind==="check"?ITEM_READ_MS:undefined,claim:async()=>(await list.claim(kind,1,LEGISTAR_MEMBER_SUBJECT))[0],work:input.run,
    settle:async(claim,outcome)=>{
      if(outcome?.refused){await list.refuse(claim,outcome.refused,{kind:"parser",name:"legistar",platform:"legistar",text:outcome.refused});stats.refused++;}
      else {if(!await list.finish(claim,kind==="load"?LEGISTAR_MEMBER_CADENCE_MS:undefined))throw Error("WORK_LEASE_LOST");stats.done++;}
    }});
  return stats;
}
