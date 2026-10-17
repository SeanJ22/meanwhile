import {learnedRouteIds} from "../../method/manual-bridge.ts";
import type { FixMapRepository } from "../../method/fix-map.ts";
import { sourceHintsOf } from "../field-manual-sources.ts";
import { entryInSlice, projectFieldManual, readMethodEvidence, type FieldManualEntry } from "../field-manual.ts";
import { IdentityCollision, type AggregateRepository, type FieldManualRepository, type Persisted } from "./types.ts";

export function fieldManualRows(base: AggregateRepository<FieldManualEntry>,fixMap:()=>FixMapRepository): FieldManualRepository {
  const repository:FieldManualRepository={
    ...base,
    readMany: base.readMany ?? (async (ids) => (await Promise.all([...new Set(ids)].sort().map((id) => base.read(id))))
      .filter((row): row is Persisted<FieldManualEntry> => row !== null)),
    async learnedRoutes(routeIds) {
      const known=learnedRouteIds({entries:(await base.list()).map(row=>row.value)});
      return {present:known.size>0,routeIds:[...new Set(routeIds)].filter(id=>known.has(id)).sort()};
    },
    async sourceHints(scope,url){return sourceHintsOf((await base.list()).map(row=>row.value),scope,url);},
    async select(query) {
      const entries=(await base.list()).map(row=>row.value).filter(entry=>entryInSlice(entry,query));
      const evidence=await readMethodEvidence({fieldManual:repository,fixMap:fixMap()},entries,query);
      const projection=projectFieldManual({entries},query,evidence);
      const byId=new Map(entries.map(entry=>[entry.id,entry]));
      const selected=query.limit===undefined?entries:projection.entryIds.map(id=>byId.get(id)!);
      return {projection,store:{entries:selected},...(evidence?{evidence:{
        here:selected.flatMap(entry=>evidence.here.filter(row=>row.methodId===entry.id)),
        works:Object.fromEntries(selected.flatMap(entry=>evidence.works[entry.id]?[[entry.id,evidence.works[entry.id]]]:[]))}}:{})};
    },
    async insertNew(entries, now) {
      const inserted = new Set<string>();
      for (const entry of entries) {
        try { if ((await base.put(entry.id, entry, now)).created) inserted.add(entry.id); }
        catch (error) { if (!(error instanceof IdentityCollision)) throw error; }
      }
      return inserted;
    },
  };
  return repository;
}
