/** Shared EPA reader materialization, with four pending writes and the held state registration joins. */
import { US_JURISDICTIONS } from "../../coverage/states.ts";
import type { EchoPartition } from "./echo-gaps.ts";
import type { OpenDataFact } from "./model.ts";
import { normalizeEcho, type GovernmentJoin } from "./normalize.ts";

export async function materializeEchoPartitions(input:{
  partitions:AsyncIterable<EchoPartition>;
  readStateJoins:(state:string)=>Promise<GovernmentJoin[]>;
  addReports:(rows:readonly OpenDataFact[])=>void;
  writePartition:(partition:EchoPartition)=>Promise<void>;
}):Promise<void> {
  let heldState:string|null=null,held:GovernmentJoin[]=[];
  const pending=new Set<Promise<void>>();
  let writeFailure:unknown;
  try {for await(const partition of input.partitions) {
    const state=partition.rows[0]?.state ?? null;
    if(state!==heldState){heldState=state;held=[];
      if(state && US_JURISDICTIONS.some(s=>s.usps===state))held=await input.readStateJoins(state);
    }
    const rows=partition.rows.map(row=>normalizeEcho(row.sourceRow,row.capturedAt,row.publishedAt,held));
    if(!partition.partition.startsWith("cell:"))input.addReports(rows);
    const writing:Promise<void>=input.writePartition({...partition,rows}).catch(error=>{writeFailure??=error;}).finally(()=>pending.delete(writing));pending.add(writing);
    if(pending.size>=4)await Promise.race(pending);
    if(writeFailure)throw writeFailure;
  }await Promise.all(pending);if(writeFailure)throw writeFailure;}finally{await Promise.allSettled(pending);}
}
