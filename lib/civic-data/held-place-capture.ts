import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";
import { readPromotedCivicDataBatch, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { projectHeldPlaceFamilies, readHeldPlaceFamilies, type HeldPlaceFamilies } from "./held-place-families.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "./contracts.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import { observationFreshUntil, observationIsFresh } from "../ask/agenda-publication.ts";
import { reconcilePublicationObservations } from "../outcomes/publication.ts";
import { readPlacePointerSlice, readPlacePointerSlices, type PlaceCaptureRead } from "./held-place-slices.ts";
import { REGISTRY_RUNTIME_SCOPE } from "../registry/runtime-data-plane.ts";
import { readHeldPlaceGeography } from "./held-place-geography.ts";
import { PostgresRoutineDataStore } from "./store.ts";
import type { PlaceCaptureKind } from "../coverage/place-owed.ts";
import { FRESHNESS_HOURS, meetingFreshnessHours } from "../coverage/checklist-map.ts";

export interface HeldPlaceCapture {
  readonly subjects: readonly { id: string; kind: "division" | "body" | "seat" | "calendar" | "contest" | "funding" | "deadline"; divisionIds: readonly string[]; label: string; captureKind?: PlaceCaptureKind; calendarBodyId?: string; funcstat?: string; startsAt?: string }[];
  readonly held: readonly { subjectId: string; checklistId: string; state: "published" | "held" | "unpublished";
    sourceUrl: string; checkedAt: string; freshUntil: string; value: unknown }[];
}

function published<T>(read: PlaceCaptureRead<T>): T | null {
  if (read.kind === "PROMOTED") return read.value;
  if (read.kind === "NOT_RECORDED") return null;
  throw new Error(`HELD_PLACE_READ_FAILED:${read.metadata.recordClass}:${read.metadata.scope}:${read.kind}`);
}

export function projectHeldPlaceCapture(
  divisionIds: readonly string[], registryRead: PlaceCaptureRead<RegistryRuntimeReadModel>,
  meetingReads: readonly PlaceCaptureRead<MeetingsSnapshot>[], now: string,
  families: HeldPlaceFamilies = {},
  outcomeReads: readonly PlaceCaptureRead<OutcomeSnapshot>[] = [],
): HeldPlaceCapture {
  const registry = published(registryRead);
  const wanted = new Set(divisionIds);
  const subjects = new Map<string, HeldPlaceCapture["subjects"][number]>();
  const held = new Map<string, HeldPlaceCapture["held"][number]>();
  // Preserve the held Census classification even for callers that only know
  // a division ID. Statistical geography is not another government inventory.
  for (const division of registry?.registry.divisions ?? []) {
    if (!wanted.has(division.ocdId)) continue;
    subjects.set(division.ocdId, { id: division.ocdId, kind: "division", divisionIds: [division.ocdId],
      label: division.label, ...(division.funcstat ? { funcstat: division.funcstat } : {}) });
  }
  const bodies = new Map((registry?.registry.bodies ?? []).map(body => [body.id, body]));
  const divisionsFor = (id: string | undefined, division: string | null) => {
    const body = id === undefined ? undefined : bodies.get(id);
    return [...new Set([body?.ocdId ?? division, ...(body?.alsoServesOcdIds ?? [])]
      .filter((value): value is string => value !== null && value !== undefined))];
  };
  const add = (subjectId: string, checklistId: string, value: unknown, sourceUrl: string | null,
    checkedAt: string, hours: number, recordId?: number) => {
    const checked = Date.parse(checkedAt);
    if (!sourceUrl || !Number.isFinite(checked)) return;
    const fieldKeys = value !== null && typeof value === "object" ? Object.keys(value).sort().join(",") : "";
    const key = `${subjectId}:${checklistId}:${fieldKeys}${recordId === undefined ? "" : `:${recordId}`}`;
    const prior = held.get(key);
    if (prior && Date.parse(prior.checkedAt) >= checked) return;
    held.set(key, { subjectId, checklistId, state: "published", sourceUrl, checkedAt,
      freshUntil: new Date(checked + hours * 3_600_000).toISOString(), value });
  };
  for (const body of bodies.values()) {
    const divisions = divisionsFor(body.id, body.ocdId);
    if (!divisions.some(id => wanted.has(id))) continue;
    subjects.set(body.id, { id: body.id, kind: "body", captureKind: "registry-body",
      divisionIds: divisions, label: body.name ?? body.id });
    if (body.name && body.bodyClass && body.ocdId) add(body.id, "GOV-01",
      { id: body.id, name: body.name, type: body.bodyClass, divisionIds: divisions },
      body.provenance.sourceUrl, body.provenance.collectedAt, FRESHNESS_HOURS.registryRecord);
  }
  for (const roster of registry?.bodyRosters ?? []) {
    const divisions = divisionsFor(roster.bodyId, null);
    if (!divisions.some(id => wanted.has(id))) continue;
    // Classify the represented office from its canonical body territory, not
    // titles such as "Senator" or "President", which also occur locally.
    const territory = bodies.get(roster.bodyId)?.ocdId ?? "";
    const captureKind: PlaceCaptureKind | undefined = /^ocd-division\/country:us\/(?:state|district|territory):[^/]+\/sld[ul]:[^/]+$/.test(territory)
      ? "state-legislator"
      : /^ocd-division\/country:us\/(?:state|district|territory):[^/]+\/(?:county|place|cousub|school_district|special_district):[^/]+(?:\/[^/]+)*$/.test(territory)
        ? "local-officeholder" : undefined;
    for (const member of roster.members) {
      if (!member.name || !member.officeTitle) continue;
      subjects.set(member.id, { id: member.id, kind: "seat", divisionIds: divisions, label: member.officeTitle,
        ...(captureKind ? { captureKind } : {}) });
      const source = member.membershipSource ?? roster;
      add(member.id, "OFF-04", { name: member.name, office: member.officeTitle }, source.sourceUrl, source.collectedAt, FRESHNESS_HOURS.registryRecord);
      add(member.id, "OFF-08", { name: member.name, office: member.officeTitle }, source.sourceUrl, source.collectedAt, FRESHNESS_HOURS.registryRecord);
      // Each optional fact keeps its own source clock.
      for (const key of ["termNote", "email", "phone", "websiteUrl"] as const) {
        if (!member[key]) continue;
        const origin = member.fieldSources?.[key] ?? source;
        add(member.id, key === "termNote" ? "OFF-06" : key === "websiteUrl" ? "OFF-08" : "OFF-09", { [key]: member[key], contactScope: member.contactScope },
          origin.sourceUrl, origin.collectedAt, FRESHNESS_HOURS.registryRecord);
      }
    }
  }
  for (const read of meetingReads) {
    for (const meeting of published(read)?.meetings ?? []) {
      const divisions = divisionsFor(meeting.bodyId, meeting.ocdId);
      if (!divisions.some(id => wanted.has(id))) continue;
      subjects.set(meeting.id, { id: meeting.id, kind: "calendar", divisionIds: divisions, label: meeting.title,
        captureKind: "meeting", startsAt: meeting.startsAt, ...(meeting.bodyId ? { calendarBodyId: meeting.bodyId } : {}) });
      const hours = meetingFreshnessHours(meeting.startsAt, now);
      const field = (id: string, value: unknown) => add(meeting.id, id, value,
        meeting.provenance.sourceUrl, meeting.provenance.collectedAt, hours);
      if (meeting.bodyId) field("MTG-05", { id: meeting.id, bodyId: meeting.bodyId });
      field("MTG-06", meeting.startsAt);
      if (meeting.startPrecision !== "DAY") field("MTG-07", { startsAt: meeting.startsAt, timeZone: meeting.timeZone });
      if (meeting.location || meeting.online) field("MTG-08", meeting.location ?? meeting.online);
      field("MTG-10", meeting.status);
      field("MTG-12", meeting.provenance.sourceUrl);
      if (meeting.online) field("MTG-09", meeting.online);
      if (meeting.agendaUrl) field("DOC-01", { url: meeting.agendaUrl });
    }
  }
  const extra = projectHeldPlaceFamilies(divisionIds, registry, families);
  for (const read of outcomeReads) {
    for (const sitting of published(read)?.sittings ?? []) {
      const divisions = divisionsFor(sitting.bodyId ?? undefined, sitting.ocdId);
      if (!divisions.some(id => wanted.has(id))) continue;
      const previous = subjects.get(sitting.meetingId);
      const calendarBodyId = sitting.bodyId ?? previous?.calendarBodyId;
      subjects.set(sitting.meetingId, { id: sitting.meetingId, kind: "calendar", divisionIds: divisions, label: sitting.bodyName,
        captureKind: "meeting", ...(sitting.startsAt ? { startsAt: sitting.startsAt } : previous?.startsAt ? { startsAt: previous.startsAt } : {}),
        ...(calendarBodyId ? { calendarBodyId } : {}) });
      const agenda = reconcilePublicationObservations(sitting.meetingId, sitting.publicationObservations.filter(observation =>
        observation.provenance === "FIRST_PARTY_PUBLISHER" && observationIsFresh(observation, Date.parse(now))));
      if (agenda.actionable?.report === "NOT_AVAILABLE" && !sitting.publication.agendaFile &&
          agenda.actionable.evidenceQuote.trim()) {
        const observation = agenda.actionable;
        const freshUntil = observationFreshUntil(observation);
        if (freshUntil) for (const checklistId of ["DOC-01", "DOC-02", "DOC-03"]) {
          held.set(`${sitting.meetingId}:${checklistId}:unpublished`, { subjectId: sitting.meetingId, checklistId,
            state: "unpublished", sourceUrl: observation.observedUrl, checkedAt: observation.observedAt, freshUntil,
            value: { statement: observation.evidenceQuote } });
        }
      }
      const checked = Date.parse(sitting.publication.observedAt);
      const hours = meetingFreshnessHours(sitting.startsAt ?? "", now);
      const sourceUrl = sitting.publication.inSiteUrl ?? sitting.sourceUrl;
      if (sitting.publication.agendaFile) add(sitting.meetingId, "DOC-01", { url: sitting.publication.agendaFile },
        sourceUrl, sitting.publication.observedAt, hours);
      // This captures the publisher's link and status, never document retrieval
      // or readable text. Preserve "Draft" verbatim rather than calling it approved.
      if (sitting.publication.minutesFile && sitting.publication.minutesStatusName?.trim()) {
        add(sitting.meetingId, "DOC-06", { url: sitting.publication.minutesFile,
          publisherStatus: sitting.publication.minutesStatusName, publisherStatusId: sitting.publication.minutesStatusId },
        sourceUrl, sitting.publication.observedAt, hours);
      }
      const itemIds = new Set((sitting.agenda ?? []).filter(item => item.eventId === sitting.eventId).map(item => item.eventItemId));
      for (const action of sitting.outcomes ?? []) {
        if (action.recordClass !== "ACTION_SUMMARY" || action.eventId !== sitting.eventId) continue;
        itemIds.add(action.eventItemId);
        add(sitting.meetingId, "DOC-08", { meetingId: sitting.meetingId, ...action },
          action.provenance.endpoint, action.provenance.readOn, hours, action.eventItemId);
      }
      for (const roll of sitting.rollCalls ?? []) {
        if (roll.recordClass !== "ROLL_CALL" || !roll.votes.length || !itemIds.has(roll.eventItemId)) continue;
        add(sitting.meetingId, "DOC-09", { meetingId: sitting.meetingId, ...roll },
          roll.provenance.endpoint, roll.provenance.readOn, hours, roll.eventItemId);
      }
      if (sitting.extraction === "NOT_YET_PUBLISHED" && sitting.extractionNote && sitting.sourceUrl &&
          !sitting.publication.minutesFile && Number.isFinite(checked) && checked <= Date.parse(now) &&
          checked + hours * 3_600_000 >= Date.parse(now)) {
        held.set(`${sitting.meetingId}:DOC-06:unpublished`, { subjectId: sitting.meetingId, checklistId: "DOC-06",
          state: "unpublished", sourceUrl: sitting.sourceUrl, checkedAt: sitting.publication.observedAt,
          freshUntil: new Date(checked + hours * 3_600_000).toISOString(), value: { statement: sitting.extractionNote } });
      }
    }
  }
  return { subjects: [...subjects.values(), ...extra.subjects], held: [...held.values(), ...extra.held] };
}

export async function readHeldPlaceCapture(divisionIds: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<HeldPlaceCapture> {
  const sliced = !options.store || options.store instanceof PostgresRoutineDataStore;
  const registry = sliced
    ? await readPlacePointerSlice<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", REGISTRY_RUNTIME_SCOPE, divisionIds)
    : await readRegistryRuntimeProjection(options);
  const value = published(registry);
  const bodies = new Set((value?.registry.bodies ?? []).filter(body =>
    [body.ocdId, ...(body.alsoServesOcdIds ?? [])].some(id => id !== null && divisionIds.includes(id))).map(body => body.id));
  const partitions = MEETING_PARTITION_CONTRACTS.filter(partition =>
    bodies.has(partition.bodyId) || (partition.ocdId !== null && divisionIds.includes(partition.ocdId)));
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
