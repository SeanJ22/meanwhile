import { runBoundedWorkPool } from "../../ops/bounded-work-pool.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import type { WorkRow,workList } from "../../core/work.ts";
import { LEGISTAR_MEMBER_CADENCE_MS,LEGISTAR_MEMBER_SUBJECT } from "./members-queue.ts";

/** This many database failures in a row end the turn; the runner starts it again. */
export const HICCUPS_BEFORE_STOPPING = 5;

/** Slots are claimed directly on the shared list, independently of the routine source scheduler. */
export async function runLegistarMemberWorkers(input:{list:ReturnType<typeof workList>;kind:"load"|"check";concurrency:number;
  maxClaims?:number;
  stopRequested:()=>boolean;run:(claim:WorkRow,signal:AbortSignal)=>Promise<void|{refused?:string}>;
  sleep?:(ms:number)=>Promise<void>;log?:(message:string)=>void}) {
  const stats={claimed:0,done:0,refused:0,failed:0};
  const maximum=input.maxClaims??Infinity;
  if(input.maxClaims!==undefined&&(!Number.isSafeInteger(maximum)||maximum<1))throw Error("WORK_INVALID_BATCH");
  let reserved=0,hiccups=0;
  const results=await runBoundedWorkPool(Array.from({length:input.concurrency},(_,i)=>i),input.concurrency,async()=>{
    while(!input.stopRequested()) {
      if(reserved>=maximum)break;
      reserved++;
      // A database that is slow for one claim holds this slot for a moment; it does not end every other slot's turn.
      let claim:WorkRow|undefined;
      try {[claim]=await input.list.claim(input.kind,1,LEGISTAR_MEMBER_SUBJECT);hiccups=0;}
      catch(error){
        reserved--;stats.failed++;input.log?.(sanitizedErrorDiagnostic(error));
        if(++hiccups>=HICCUPS_BEFORE_STOPPING)throw error;
        await (input.sleep??(ms=>new Promise<void>(done=>setTimeout(done,ms))))(5_000);continue;
      }
      if(!claim){reserved--;if(!input.sleep)break;await input.sleep(5_000);continue;}
      stats.claimed++;
      const controller=new AbortController();let renewing=false;
      const timer=setInterval(()=>{
        if(renewing)return;renewing=true;
        void input.list.renew(claim).then(held=>{if(!held)controller.abort(new Error("WORK_LEASE_LOST"));})
          .catch(error=>controller.abort(error)).finally(()=>{renewing=false;});
      },60_000);
      try {
        const outcome=await input.run(claim,controller.signal);controller.signal.throwIfAborted();
        if(outcome?.refused){await input.list.refuse(claim,outcome.refused,{kind:"parser",name:"legistar",platform:"legistar",text:outcome.refused});stats.refused++;}
        else {if(!await input.list.finish(claim,input.kind==="load"?LEGISTAR_MEMBER_CADENCE_MS:undefined))throw Error("WORK_LEASE_LOST");stats.done++;}
      }catch(error){
        stats.failed++;const detail=sanitizedErrorDiagnostic(error);input.log?.(detail);
        // If the list cannot be told either, the lease runs out and the row comes back by itself.
        await input.list.later(claim,detail).catch(inner=>input.log?.(sanitizedErrorDiagnostic(inner)));
      }
      finally{clearInterval(timer);}
    }
  });
  for(const result of results)if(!result.ok)throw Error(result.error);
  return stats;
}
