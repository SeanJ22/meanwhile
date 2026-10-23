import { meetingStateOf } from "../../lib/meetings/body-scope.ts";
import { MEETING_PARTITION_CONTRACTS, HELD_MEETING_PARTITIONS } from "../../lib/civic-data/meeting-partitions.ts";
import { readReaderEdgeMeetings } from "../../lib/meetings/edge-serving.ts";
import { meetingSettingsFromValues } from "../../lib/meetings/settings.ts";
import type { RoutineDataStore } from "../../lib/civic-data/store.ts";
import type { ReaderArtifactStore } from "../../lib/meetings/edge-store.ts";
import type { MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import { installCanonicalMeetings } from "./canonical-reader-fixtures.ts";
import { freshEdge } from "./meeting-body-fixtures.ts";

export async function readEveryBody(store: RoutineDataStore, now: string, options: {readonly window?: "SHOWN"|"HELD"; readonly includeAgenda?: boolean; readonly registry?: unknown; readonly edge?: ReaderArtifactStore} = {}) {
  installCanonicalMeetings(store);
  const scopes = await store.listPromotionScopes?.(["MEETING"]) ?? [];
  const pointers = await store.readPromotions<MeetingsSnapshot>("MEETING",scopes.map(p=>p.scope));
  const bodyIds = [...new Set(pointers.flatMap(p=>p.payload.meetings.flatMap(m=>m.bodyId ?? [])))];
  const read = await readReaderEdgeMeetings({bodyIds,now,settings:meetingSettingsFromValues(),window:options.window ?? "HELD",includeAgenda:options.includeAgenda});
  return {read,edge:options.edge ?? freshEdge(),plan:{stats:{failed:[]}},status:"PUBLISHED",bodyIds};
}
export function readBody(_edge: ReaderArtifactStore, store: RoutineDataStore, now: string, bodyId: string, window: "SHOWN"|"HELD"="SHOWN") {
  installCanonicalMeetings(store);
  return readReaderEdgeMeetings({bodyIds:[bodyId],now,settings:meetingSettingsFromValues(),window});
}

async function owned(store:RoutineDataStore,bodyId:string) {
  const scopes=await store.listPromotionScopes?.(["MEETING"]) ?? [];
  const pointers=await store.readPromotions<MeetingsSnapshot>("MEETING",scopes.map(p=>p.scope));
  return pointers.filter(p=>p.payload.meetings.some(m=>m.bodyId===bodyId));
}
export async function coupledContracts(store:RoutineDataStore,_state:string,bodyId:string):Promise<string[]> {
  return (await owned(store,bodyId)).map(p=>[...MEETING_PARTITION_CONTRACTS,...HELD_MEETING_PARTITIONS].find(c=>c.scope===p.scope)?.id ?? p.scope).sort();
}
export async function stateIndexOf(store:RoutineDataStore,state:string) {
  const scopes=await store.listPromotionScopes?.(["MEETING"]) ?? [];
  const pointers=await store.readPromotions<MeetingsSnapshot>("MEETING",scopes.map(p=>p.scope));
  const ids=[...new Set(pointers.flatMap(p=>p.payload.meetings.flatMap(m=>m.bodyId && meetingStateOf(m.bodyId)===state ? [m.bodyId]:[])))];
  const places:Record<string,string[]>={};
  for(const p of pointers) for(const m of p.payload.meetings) if(m.bodyId && m.ocdId && ids.includes(m.bodyId)) {
    const own=places[m.ocdId] ??= []; if(!own.includes(m.bodyId)) own.push(m.bodyId);
  }
  return {bodies:Object.fromEntries(ids.map(id=>[id,{divisions:[id.split("#")[0]],family:false}])),places};
}
