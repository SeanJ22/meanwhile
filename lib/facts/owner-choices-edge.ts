import { resolveReaderArtifactStore, resolveReaderArtifactWriteStore, type ReaderArtifactStore } from "../meetings/edge-store.ts";

export interface ReaderOwnerChoice {
  readonly id:number;
  readonly resolvedAt:string;
  readonly choice:"REMOVE"|"TYPED_VALUE";
  readonly values:Readonly<Record<string,unknown>>;
  readonly sourceUrl:string|null;
}
type Snapshot={readonly choices:Readonly<Record<string,ReaderOwnerChoice>>};
export function ownerChoiceState(record:Readonly<Record<string,unknown>>):string {
  const id=String(record.id ?? record.bodyId ?? record.ocdId ?? "");
  const state=/\/state:([a-z]{2})\b/i.exec(id)?.[1] ?? /(?:^|:)([a-z]{2})-(?:legislature|general-court):/i.exec(id)?.[1]
    ?? (/^[a-z]{2}$/i.test(String(record.state)) ? String(record.state) : (record.office as {state?:string}|undefined)?.state);
  return state?.toUpperCase() ?? "US";
}
const keyOf=(family:string,state:string)=>`reader/owner-choices/${encodeURIComponent(family)}/${state}.json`;

/** Existing reader-artifact CAS prevents two owner answers from losing one another. */
export async function publishOwnerChoice(family:string,record:Readonly<Record<string,unknown>>,choice:ReaderOwnerChoice,
  store:ReaderArtifactStore|null=resolveReaderArtifactWriteStore() ?? resolveReaderArtifactStore()):Promise<void> {
  if (!store) return; // A host without a reader edge serves the database's owner values directly.
  const key=keyOf(family,ownerChoiceState(record)),id=String(record.id);
  for(let attempt=0;attempt<3;attempt++){
    const held=await store.readJsonPointer<Snapshot>(key);
    const previous=held?.value.choices[id];
    if(previous && (previous.resolvedAt>choice.resolvedAt || previous.resolvedAt===choice.resolvedAt && previous.id>=choice.id))return;
    const next={choices:{...held?.value.choices,[id]:choice}};
    if((await store.writeJsonPointer(key,next,held?.etag ?? null)).modified)return;
  }
  throw new Error("The reader copy changed during this answer. Try again.");
}

/** Only the states of the selected records are read; an edge request makes no database call. */
export async function readOwnerChoicesFromEdge(family:string,records:readonly {readonly id:string}[],
  store:ReaderArtifactStore|null=resolveReaderArtifactStore()):Promise<ReadonlyMap<string,ReaderOwnerChoice>|null>{
  if(!store)return null;
  const states=[...new Set(records.map(record=>ownerChoiceState(record as Record<string,unknown>)))];
  const snapshots=await Promise.all(states.map(state=>store.readJsonPointer<Snapshot>(keyOf(family,state))));
  const wanted=new Set(records.map(record=>record.id));
  return new Map(snapshots.flatMap(snapshot=>Object.entries(snapshot?.value.choices ?? {}).filter(([id])=>wanted.has(id))));
}
