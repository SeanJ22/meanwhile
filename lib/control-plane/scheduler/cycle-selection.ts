import { heldSlotKeys, type AggregateRepository, type AppendOnlyRepository, type ChangedRecord, type ControlPlaneRepositories, type Persisted, type RecordProjection } from "../repository/types.ts";
import type { WorkItem } from "../work-item.ts";

type Visitor<T> = (row:Persisted<T>)=>Promise<void>|void;
type AggregateSource<T> = (projection:RecordProjection|undefined,visit:Visitor<T>)=>Promise<void>;

/** A filtered pass reads one selected history at a time, including through the paged interfaces. */
export async function selectedCycleRepositories(repos: ControlPlaneRepositories, obligationIds: Iterable<string>): Promise<ControlPlaneRepositories> {
  const selectedIds=new Set(obligationIds),workIds=new Set<string>();
  for(const id of selectedIds)for(const row of await repos.occurrences.listWhereNarrowed(["obligationId"],id,{workItemId:true})){
    workIds.add((row.value as {readonly workItemId:string}).workItemId);
  }
  const aggregate=<T>(repository:AggregateRepository<T>,source:AggregateSource<T>):AggregateRepository<T>=>({
    ...repository,
    list:async()=>{const rows:Persisted<T>[]=[];await source(undefined,row=>{rows.push(row);});return rows;},
    listNarrowed:async projection=>{const rows:Persisted<T>[]=[];await source(projection,row=>{rows.push(row);});return rows;},
    listChangedSince:async(_since,held,options={})=>{
      // Exact point reads have no database snapshot clock. Replay these selected histories on each pass.
      const rows:Persisted<T>[]=[],skip=heldSlotKeys(held);
      await source(options.projection,async row=>{if(skip.has(`${row.id}\n${row.revision}`))return;if(options.page)await options.page([row]);else rows.push(row);});
      return {rows,through:null};
    },
  });
  const where=<T>(repository:AggregateRepository<T>,path:readonly string[],keys:Iterable<string>):AggregateSource<T>=>async(projection,visit)=>{
    for(const key of keys){
      const rows=projection?await repository.listWhereNarrowed(path,key,projection):await repository.listWhere(path,key);
      for(const row of rows)await visit(row as Persisted<T>);
    }
  };
  const log=<T>(repository:AppendOnlyRepository<T>,keys:ReadonlySet<string>|(()=>AsyncIterable<string>)):AppendOnlyRepository<T>=>{
    const readChangedSince:AppendOnlyRepository<T>["readChangedSince"]=async(since,held,options={})=>{
      const records:ChangedRecord<T>[]=[],requested=options.keys===undefined?null:new Set(options.keys);
      let through:string|null=null;
      for await(const key of typeof keys==="function"?keys():[...keys].sort()){
        if(requested&&!requested.has(key))continue;
        const read=await repository.readChangedSince(since,held,{...options,keys:[key],page:async page=>{
          if(options.page)await options.page(page);else records.push(...page);
        }});
        if(read.through!==null&&(through===null||read.through<through))through=read.through;
      }
      return {records,through};
    };
    return {...repository,readChangedSince,
      readAll:async()=>(await readChangedSince(null)).records.map(row=>row.record),
      readAllNarrowed:async projection=>(await readChangedSince(null,undefined,{projection})).records.map(row=>row.record),
    };
  };
  async function* dispositionKeys():AsyncIterable<string>{
    for(const workItemId of workIds)for(const task of await repos.routeTasks.listWhereNarrowed(["workItemId"],workItemId,{}))yield task.id;
  }
  return {...repos,
    occurrences:aggregate(repos.occurrences,where(repos.occurrences,["obligationId"],selectedIds)),
    workItems:aggregate(repos.workItems,async(projection,visit)=>{for(const id of workIds){const row=projection?await repos.workItems.readNarrowed(id,projection):await repos.workItems.read(id);if(row)await visit(row as Persisted<WorkItem>);}}),
    routeTasks:aggregate(repos.routeTasks,where(repos.routeTasks,["workItemId"],workIds)),
    attempts:aggregate(repos.attempts,where(repos.attempts,["workItemId"],workIds)),
    leases:aggregate(repos.leases,async(projection,visit)=>{
      for(const id of workIds)for(const task of await repos.routeTasks.listWhereNarrowed(["workItemId"],id,{})){
        await where(repos.leases,["routeTaskId"],[task.id])(projection,visit);
      }
    }),
    workerResults:log(repos.workerResults,workIds),costs:log(repos.costs,workIds),
    dispositions:log(repos.dispositions,dispositionKeys),scoutResults:log(repos.scoutResults,selectedIds),
  };
}
