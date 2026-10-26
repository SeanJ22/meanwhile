import type { RoutineDataStore } from "./store.ts";
import type { RoutineRecordClass } from "./types.ts";

/** Ordinary source-plan inputs: only pointed content identifiers, never held payloads or credentials. */
export type SourceProbeDependencies = Readonly<Record<string, readonly [string, string | null, string | null, string] | null>>;

export async function readSourceProbeDependencies(store: Pick<RoutineDataStore,"readSourceHead">,
  pointers: readonly {readonly recordClass:RoutineRecordClass;readonly scope:string}[]):Promise<SourceProbeDependencies> {
  const entries: (readonly [string,readonly [string,string|null,string|null,string]|null])[]=[];
  for(let offset=0;offset<pointers.length;offset+=8) {
    const batch=await Promise.all(pointers.slice(offset,offset+8).map(async pointer=>{
      const head=await store.readSourceHead(pointer.recordClass,pointer.scope);
      return [`${pointer.recordClass}:${pointer.scope}`,head?[head.versionId,head.rawHash,head.normalizedHash,head.parserVersion] as const:null] as const;
    }));
    entries.push(...batch);
  }
  return Object.fromEntries(entries);
}
