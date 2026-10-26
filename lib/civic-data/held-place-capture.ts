import { projectHeldPlaceCapture } from "./held-place-projection.ts";
import { withRegistryRuntimeStates } from "../registry/runtime-read-model.ts";
import { readPlaceRegistry } from "./place-registry-read.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";
import { readPromotedCivicDataBatch, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { readHeldPlaceFamilies } from "./held-place-families.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import { heldPlaceValue as published, readPlacePointerSlices } from "./held-place-slices.ts";
import { statesForRegistryDivisions } from "./state-scopes.ts";
import { readHeldPlaceGeography } from "./held-place-geography.ts";
import { readDerivedMeetingBodyRows,derivedBodyScope } from "./derived-meeting-body.ts";
import { readerQuery } from "./promoted-reader-query.ts";
import type { RoutineDataStore } from "./store.ts";
import { PostgresRoutineDataStore } from "./store.ts";
import type { PlaceCaptureKind } from "../coverage/place-owed.ts";

export interface HeldPlaceCapture {
  readonly subjects: readonly { id: string; kind: "division" | "body" | "seat" | "calendar" | "contest" | "funding" | "deadline"; divisionIds: readonly string[]; label: string; captureKind?: PlaceCaptureKind; calendarBodyId?: string; funcstat?: string; startsAt?: string }[];
  readonly held: readonly { subjectId: string; checklistId: string; state: "published" | "held" | "unpublished";
    sourceUrl: string; checkedAt: string; freshUntil: string; value: unknown }[];
}

async function readStatePlaceCapture(state: string | null, divisionIds: readonly string[], options: PromotedCivicDataReadOptions): Promise<HeldPlaceCapture> {
  const sliced = !options.store || options.store instanceof PostgresRoutineDataStore;
  const registry = state ? await readPlaceRegistry(state,divisionIds,options) : null;
  const value = registry ? published(registry) : null;
  const bodies = new Set((value?.registry.bodies ?? []).filter(body =>
    [body.ocdId, ...(body.alsoServesOcdIds ?? [])].some(id => id !== null && divisionIds.includes(id))).map(body => body.id));
  const partitions = MEETING_PARTITION_CONTRACTS.filter(partition =>
    bodies.has(partition.bodyId) || (partition.ocdId !== null && divisionIds.includes(partition.ocdId)) ||
    (partition.derivedFamily !== null && divisionIds.some(id => id.includes(`/state:${partition.derivedFamily!.slice(3).toLowerCase()}`))));
  const outcomeScopes = ROUTINE_SOURCE_CONTRACTS.filter(contract => contract.recordClass === "MEETING_OUTCOME" &&
    contract.schedule?.follows?.some(partition => bodies.has(partition.bodyId) ||
      partitions.some(known => known.bodyId === partition.bodyId))).map(contract => contract.scope);
  const slicesFor=<T>(recordClass:'MEETING'|'MEETING_OUTCOME',scopes:readonly string[])=>
    readPlacePointerSlices<T>(recordClass,scopes,divisionIds,[...bodies]);
  const ordinary=partitions.filter(partition=>partition.derivedFamily===null);
  const derived=async()=>{
    if(!state||!bodies.size)return [];
    const store=options.store as Partial<Pick<RoutineDataStore,"readDerivedMeetingBody">>|undefined,query=store?null:readerQuery();
    if(store&&!store.readDerivedMeetingBody)throw new Error("DERIVED_MEETING_KEYED_STORE_UNAVAILABLE");
    if(!store&&!query)throw new Error("DERIVED_MEETING_READER_STORE_UNAVAILABLE");
    return Promise.all([...bodies].map(async body=>{
      const slice=store?await store.readDerivedMeetingBody!(`US-${state}`,body):await readDerivedMeetingBodyRows(async(text,params)=>{
        const [rows]=await query!([{text,params:params??[]}]);return rows;},`US-${state}`,body);
      return {kind:slice?"PROMOTED" as const:"NOT_RECORDED" as const,value:slice?.snapshot??null,
        metadata:{recordClass:"MEETING" as const,scope:slice?.input.scope??derivedBodyScope(body,false,`US-${state}`),versionId:slice?.input.versionId??null}};
    }));
  };
  const [meetingParts, families, outcomes, geography] = await Promise.all([
    Promise.all([sliced?slicesFor<MeetingsSnapshot>("MEETING",ordinary.map(partition=>partition.scope)):
      readPromotedCivicDataBatch<MeetingsSnapshot>("MEETING",ordinary.map(partition=>partition.scope),options),derived()]),
    readHeldPlaceFamilies(divisionIds, options, sliced ? value : undefined),
    sliced ? slicesFor<OutcomeSnapshot>("MEETING_OUTCOME", outcomeScopes) :
      readPromotedCivicDataBatch<OutcomeSnapshot>("MEETING_OUTCOME", outcomeScopes, options),
    sliced ? readHeldPlaceGeography(divisionIds, value?.registry.divisions ?? []) : Promise.resolve({ subjects: [], held: [] }),
  ]);
  const capture = projectHeldPlaceCapture(divisionIds, registry, meetingParts.flat(), options.now ?? new Date().toISOString(), families, outcomes);
  return { subjects: [...capture.subjects, ...geography.subjects], held: [...capture.held, ...geography.held] };
}

export async function readHeldPlaceCapture(divisionIds: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<HeldPlaceCapture> {
  const states = statesForRegistryDivisions(divisionIds);
  return withRegistryRuntimeStates(states, async () => {
  const subjects = new Map<string, HeldPlaceCapture["subjects"][number]>(), held: HeldPlaceCapture["held"][number][] = [];
  for (const state of states.length ? states : divisionIds.length ? [null] : []) {
    const ids = divisionIds.filter(id => { const own = statesForRegistryDivisions([id]); return !own.length || (state !== null && own.includes(state)); });
    const capture = await readStatePlaceCapture(state, ids, options);
    for (const subject of capture.subjects) {
      const previous = subjects.get(subject.id);
      subjects.set(subject.id, previous ? { ...subject, divisionIds: [...new Set([...previous.divisionIds, ...subject.divisionIds])] } : subject);
    }
    held.push(...capture.held);
  }
  return { subjects: [...subjects.values()], held };
  });
}
