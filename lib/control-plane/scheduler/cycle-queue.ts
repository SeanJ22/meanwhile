import type { ScheduledObligation } from "./obligation.ts";
import type { CycleWorkset, QueueSlot } from "./cycle-workset.ts";

export interface CycleQueueOptions {
  readonly capacity:number;
  readonly placePriority?:()=>Promise<{readonly revision:string;readonly rank:(id:string)=>number|null}>;
  readonly comparator?:()=>Promise<(left:ScheduledObligation,right:ScheduledObligation)=>number>;
  readonly huntRounds:boolean;
  readonly providerLimitOf?:(row:ScheduledObligation)=>{readonly key:string;readonly limit:number}|null;
  readonly run:(slot:QueueSlot)=>Promise<void>;
}

/** The original stable round/place order and live provider reservation, with pending work kept on disk. */
export async function runCycleQueue(workset:CycleWorkset,options:CycleQueueOptions):Promise<void> {
  const running=new Map<string,number>();
  let selection=Promise.resolve(),finished:()=>void=()=>{},compare:(left:ScheduledObligation,right:ScheduledObligation)=>number=()=>0;
  const take=():Promise<{slot:QueueSlot;provider:string|undefined}|undefined>=>{
    let taken:{slot:QueueSlot;provider:string|undefined}|undefined;
    const next=selection.then(async()=>{
      if(workset.pendingCount){
        if(options.placePriority){
          try{workset.rankPending(await options.placePriority());}
          catch(error){console.warn(`Place priority read failed; keeping last order: ${error instanceof Error?error.message:String(error)}`);}
        } else if(options.comparator||options.huntRounds){
          if(options.comparator)try{compare=await options.comparator();}
          catch(error){console.warn(`Place priority read failed; keeping last order: ${error instanceof Error?error.message:String(error)}`);}
          workset.sortPending(compare);
        }
      }
      for(;;){
        for(const slot of workset.pending()){
          const limit=options.providerLimitOf?.(slot.row)??null;
          if(limit&&(running.get(limit.key)??0)>=Math.max(1,limit.limit))continue;
          const provider=options.providerLimitOf?.(slot.row)?.key;
          workset.take(slot.seq);
          if(provider!==undefined)running.set(provider,(running.get(provider)??0)+1);
          taken={slot,provider};return;
        }
        if(!workset.pendingCount)return;
        await new Promise<void>(resolve=>{finished=resolve;});
      }
    });
    selection=next.catch(()=>undefined);return next.then(()=>taken);
  };
  let firstError:unknown;
  const workers=Array.from({length:Math.max(1,Math.min(options.capacity,workset.pendingCount||1))},async()=>{
    try {
      for(;;){
        const taken=await take();if(!taken)return;
        try{await options.run(taken.slot);}
        finally{if(taken.provider!==undefined){const n=running.get(taken.provider)!-1;if(n)running.set(taken.provider,n);else running.delete(taken.provider);finished();}}
      }
    }catch(error){firstError??=error;throw error;}
  });
  await Promise.allSettled(workers);
  if(firstError!==undefined)throw firstError;
}
