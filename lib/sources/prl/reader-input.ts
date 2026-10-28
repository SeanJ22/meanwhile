import { MemoryRoutineDataStore,PostgresRoutineDataStore } from "../../civic-data/store.ts";
import type { PromotedCivicDataReadOptions } from "../../civic-data/read-model.ts";
import type { RoutineRecordClass } from "../../civic-data/types.ts";
import { currentPromotedEdge,currentReaderAuthorityEdge,ensurePromotedEdge,refuseDatabaseInEdgeOnlyContext } from "../../registry/runtime-edge.ts";
import { readerQuery } from "../../civic-data/promoted-reader-query.ts";
import type { ReadOnlyQuery } from "../../control-plane/admin-view/promoted-slices.ts";

export type PrlPersonReadOptions=PromotedCivicDataReadOptions&{readonly query?:ReadOnlyQuery};
/** Full snapshots are already local in Memory or on a served edge. Database fallbacks select keyed person rows only. */
export async function localPrlSnapshot(recordClass:RoutineRecordClass,scope:string,options:PrlPersonReadOptions):Promise<PromotedCivicDataReadOptions|null> {
  if(options.edge||options.store instanceof MemoryRoutineDataStore)return options;
  if(options.store||options.query)return null;
  const current=currentPromotedEdge(recordClass,scope);if(current)return {...options,edge:current.value};
  if(currentReaderAuthorityEdge()){const loaded=await ensurePromotedEdge(recordClass,scope);if(loaded)return {...options,edge:loaded.value};}
  return null;
}
export function prlPersonQuery(options:PrlPersonReadOptions):ReadOnlyQuery|null {
  refuseDatabaseInEdgeOnlyContext("The exact PRL person rows");
  if(options.query)return options.query;
  if(options.store&&!(options.store instanceof PostgresRoutineDataStore))throw Error("PRL person reads require an explicit local snapshot or keyed query.");
  return readerQuery();
}
