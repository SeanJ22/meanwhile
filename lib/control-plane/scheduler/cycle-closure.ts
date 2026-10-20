import { openHistoryIndex, closeHistoryIndex } from "../workers/streamed-history.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { dischargesObligation, type DispatchResult } from "./dispatch.ts";
import { closeOccurrence, closeSettledOccurrence } from "./durable.ts";
import type { RecoveredOccurrence } from "./shadow-loop.ts";

/** Dependent occurrence/obligation aliases close serially, while independent groups share the existing query capacity. */
export async function closeStreamedCycleOccurrences(repos:ControlPlaneRepositories,input:{
  readonly cycle:{readonly dispatched:Iterable<DispatchResult>;readonly recovered:Iterable<RecoveredOccurrence>};
  readonly occurrenceFor:(id:string)=>string|null;
  readonly now:string;
  readonly concurrency?:number;
}):Promise<void> {
  const index=await openHistoryIndex(),db=index.db;
  try {
    db.exec("CREATE TABLE parents(key TEXT PRIMARY KEY,parent TEXT NOT NULL); CREATE TABLE operations(seq INTEGER PRIMARY KEY,occurrence TEXT NOT NULL,obligation TEXT NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL,component TEXT NOT NULL DEFAULT ''); CREATE INDEX operation_group ON operations(component,seq)");
    const parent=db.prepare("SELECT parent FROM parents WHERE key=?"),insertParent=db.prepare("INSERT OR IGNORE INTO parents VALUES(?,?)"),updateParent=db.prepare("UPDATE parents SET parent=? WHERE key=?");
    const root=(key:string):string=>{
      insertParent.run(key,key);let value=key;
      for(;;){const next=parent.get(value)!.parent;if(next===value)break;value=next;}
      while(key!==value){const next=parent.get(key)!.parent;updateParent.run(value,key);key=next;}
      return value;
    };
    const insert=db.prepare("INSERT INTO operations(seq,occurrence,obligation,kind,body) VALUES(?,?,?,?,?)");let sequence=0;
    const add=(occurrence:string,obligation:string,kind:string,body:unknown)=>{
      insert.run(sequence++,occurrence,obligation,kind,JSON.stringify(body));updateParent.run(root(`obligation:${obligation}`),root(`occurrence:${occurrence}`));
    };
    for(const result of input.cycle.dispatched){const occurrence=input.occurrenceFor(result.obligationId);if(occurrence!==null)add(occurrence,result.obligationId,"dispatch",result);}
    for(const recovered of input.cycle.recovered)add(recovered.occurrenceId,recovered.obligationId,"recovered",recovered);
    const assign=db.prepare("UPDATE operations SET component=? WHERE seq=?");
    for(const row of db.prepare("SELECT seq,occurrence FROM operations ORDER BY seq").iterate())assign.run(root(`occurrence:${row.occurrence}`),Number(row.seq));
    const groups=db.prepare("SELECT component,min(seq) AS first FROM operations GROUP BY component ORDER BY first").iterate()[Symbol.iterator]();
    const count=Number(db.prepare("SELECT count(DISTINCT component) AS count FROM operations").get()?.count??0);
    let firstFailure:{seq:number;error:unknown}|null=null;
    const workers=Array.from({length:Math.max(1,Math.min(input.concurrency??1,count||1))},async()=>{
      // A worker's own statement holds at most the current group's current record across an await.
      const operations=db.prepare("SELECT seq,occurrence,kind,body FROM operations WHERE component=? ORDER BY seq");
      for(;;){const group=groups.next();if(group.done)return;
        for(const row of operations.iterate(group.value.component))try{
          if(row.kind==="recovered")await closeSettledOccurrence(repos,{settled:JSON.parse(row.body) as RecoveredOccurrence,now:input.now});
          else {const result=JSON.parse(row.body) as DispatchResult,discharged=dischargesObligation(result);await closeOccurrence(repos,{occurrenceId:row.occurrence,disposition:discharged?result.disposition:null,unresolvedReason:discharged?null:result.detail,now:input.now});}
        }catch(error){const seq=Number(row.seq);if(firstFailure===null||seq<firstFailure.seq)firstFailure={seq,error};break;}
      }
    });
    await Promise.all(workers);
    if(firstFailure!==null)throw (firstFailure as {error:unknown}).error;
  }finally{await closeHistoryIndex(index);}
}
