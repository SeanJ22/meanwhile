import { projectHeldPlaceCapture } from "./held-place-projection.ts";
import { readRegistryRuntimeProjection, withRegistryRuntimeStates } from "../registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";
import { readPromotedCivicDataBatch, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { readHeldPlaceFamilies } from "./held-place-families.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import { heldPlaceValue as published, readPlacePointerSlices, type PlaceCaptureRead } from "./held-place-slices.ts";
import { statesForRegistryDivisions } from "./state-scopes.ts";
import { readHeldPlaceGeography } from "./held-place-geography.ts";
import { PostgresRoutineDataStore } from "./store.ts";
import type { PlaceCaptureKind } from "../coverage/place-owed.ts";

export interface HeldPlaceCapture {
  readonly subjects: readonly { id: string; kind: "division" | "body" | "seat" | "calendar" | "contest" | "funding" | "deadline"; divisionIds: readonly string[]; label: string; captureKind?: PlaceCaptureKind; calendarBodyId?: string; funcstat?: string; startsAt?: string }[];
  readonly held: readonly { subjectId: string; checklistId: string; state: "published" | "held" | "unpublished";
    sourceUrl: string; checkedAt: string; freshUntil: string; value: unknown }[];
}

async function readStatePlaceCapture(state: string | null, divisionIds: readonly string[], options: PromotedCivicDataReadOptions): Promise<HeldPlaceCapture> {
  const sliced = !options.store || options.store instanceof PostgresRoutineDataStore;
  const registry = state ? placeRegistry(await readRegistryRuntimeProjection([state], options), new Set(divisionIds)) : null;
  const value = registry ? published(registry) : null;
  const bodies = new Set((value?.registry.bodies ?? []).filter(body =>
    [body.ocdId, ...(body.alsoServesOcdIds ?? [])].some(id => id !== null && divisionIds.includes(id))).map(body => body.id));
  const partitions = MEETING_PARTITION_CONTRACTS.filter(partition =>
    bodies.has(partition.bodyId) || (partition.ocdId !== null && divisionIds.includes(partition.ocdId)) ||
    (partition.derivedFamily !== null && divisionIds.some(id => id.includes(`/state:${partition.derivedFamily!.slice(3).toLowerCase()}`))));
  const outcomeScopes = ROUTINE_SOURCE_CONTRACTS.filter(contract => contract.recordClass === "MEETING_OUTCOME" &&
    contract.schedule?.follows?.some(partition => bodies.has(partition.bodyId) ||
      partitions.some(known => known.bodyId === partition.bodyId))).map(contract => contract.scope);
  const [meetings, families, outcomes, geography] = await Promise.all([
    sliced ? readPlacePointerSlices<MeetingsSnapshot>("MEETING", partitions.map(partition => partition.scope), divisionIds, [...bodies]) :
      readPromotedCivicDataBatch<MeetingsSnapshot>("MEETING", partitions.map(partition => partition.scope), options),
    readHeldPlaceFamilies(divisionIds, options, sliced ? value : undefined),
    sliced ? readPlacePointerSlices<OutcomeSnapshot>("MEETING_OUTCOME", outcomeScopes, divisionIds, [...bodies]) :
      readPromotedCivicDataBatch<OutcomeSnapshot>("MEETING_OUTCOME", outcomeScopes, options),
    sliced ? readHeldPlaceGeography(divisionIds, value?.registry.divisions ?? []) : Promise.resolve({ subjects: [], held: [] }),
  ]);
  const capture = projectHeldPlaceCapture(divisionIds, registry, meetings, options.now ?? new Date().toISOString(), families, outcomes);
  return { subjects: [...capture.subjects, ...geography.subjects], held: [...capture.held, ...geography.held] };
}

function placeRegistry(read: PlaceCaptureRead<RegistryRuntimeReadModel>, ids: ReadonlySet<string>): PlaceCaptureRead<RegistryRuntimeReadModel> {
  const value = published(read);
  if (!value) return read;
  const bodies = value.registry.bodies.filter(body => [body.ocdId, ...(body.alsoServesOcdIds ?? [])].some(id => id !== null && ids.has(id)));
  const bodyIds = new Set(bodies.map(body => body.id));
  const bodyRosters = value.bodyRosters.filter(roster => bodyIds.has(roster.bodyId));
  const statewideExecutives = value.statewideExecutives.filter(row => ids.has(row.stateOcdId));
  const bridge = value.officialCandidacies.rows.filter(row => row.holder.divisions.some(id => ids.has(id)));
  const holders = new Set([...bodyRosters.flatMap(roster => roster.members.map(member => member.id)),
    ...statewideExecutives.map(row => row.holder.id), ...bridge.map(row => row.holder.id)]);
  return { ...read, value: { ...value, registry: { ...value.registry, bodies, divisions: value.registry.divisions.filter(row => ids.has(row.ocdId)) },
    bodyRosters, statewideExecutives, officialCandidacies: { ...value.officialCandidacies, rows: bridge },
    officialPhotos: { ...value.officialPhotos, photos: value.officialPhotos.photos.filter(row => holders.has(row.officeholderId)) },
    rosterPhotos: Object.fromEntries(Object.entries(value.rosterPhotos).filter(([id]) => holders.has(id))) } };
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
