import { readRegistryRuntimeProjection } from "../registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../meetings/snapshot.ts";
import { MEETING_PARTITION_CONTRACTS } from "./meeting-partitions.ts";
import { readPromotedCivicDataBatch, type CivicDataReadResult, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { projectHeldPlaceFamilies, readHeldPlaceFamilies, type HeldPlaceFamilies } from "./held-place-families.ts";

/** Derived from canonical published records, never filtered by their original job or ZIP. */
export interface HeldPlaceCapture {
  readonly subjects: readonly { id: string; kind: "body" | "seat" | "calendar" | "contest" | "funding" | "deadline"; divisionIds: readonly string[]; label: string }[];
  readonly held: readonly { subjectId: string; checklistId: string; state: "published" | "held";
    sourceUrl: string; checkedAt: string; freshUntil: string; value: unknown }[];
}

function published<T>(read: CivicDataReadResult<T>): T | null {
  if (read.kind === "PROMOTED") return read.value;
  if (read.kind === "NOT_RECORDED") return null;
  throw new Error(`HELD_PLACE_READ_FAILED:${read.metadata.recordClass}:${read.metadata.scope}:${read.kind}`);
}

/** Only the individual supported fields count; inventories and unrelated fields remain open. */
export function projectHeldPlaceCapture(
  divisionIds: readonly string[], registryRead: CivicDataReadResult<RegistryRuntimeReadModel>,
  meetingReads: readonly CivicDataReadResult<MeetingsSnapshot>[], now: string,
  families: HeldPlaceFamilies = {},
): HeldPlaceCapture {
  const registry = published(registryRead);
  const wanted = new Set(divisionIds);
  const subjects = new Map<string, HeldPlaceCapture["subjects"][number]>();
  const held = new Map<string, HeldPlaceCapture["held"][number]>();
  const bodies = new Map((registry?.registry.bodies ?? []).map(body => [body.id, body]));
  const divisionsFor = (id: string | undefined, division: string | null) => {
    const body = id === undefined ? undefined : bodies.get(id);
    return [...new Set([body?.ocdId ?? division, ...(body?.alsoServesOcdIds ?? [])]
      .filter((value): value is string => value !== null && value !== undefined))];
  };
  const add = (subjectId: string, checklistId: string, value: unknown, sourceUrl: string | null,
    checkedAt: string, hours: number) => {
    const checked = Date.parse(checkedAt);
    if (!sourceUrl || !Number.isFinite(checked)) return;
    const fieldKeys = value !== null && typeof value === "object" ? Object.keys(value).sort().join(",") : "";
    const key = `${subjectId}:${checklistId}:${fieldKeys}`;
    const prior = held.get(key);
    if (prior && Date.parse(prior.checkedAt) >= checked) return;
    held.set(key, { subjectId, checklistId, state: "published", sourceUrl, checkedAt,
      freshUntil: new Date(checked + hours * 3_600_000).toISOString(), value });
  };
  for (const body of bodies.values()) {
    const divisions = divisionsFor(body.id, body.ocdId);
    if (!divisions.some(id => wanted.has(id))) continue;
    subjects.set(body.id, { id: body.id, kind: "body", divisionIds: divisions, label: body.name ?? body.id });
    if (body.name && body.bodyClass && body.ocdId) add(body.id, "GOV-01",
      { id: body.id, name: body.name, type: body.bodyClass, divisionIds: divisions },
      body.provenance.sourceUrl, body.provenance.collectedAt, 30 * 24);
  }
  for (const roster of registry?.bodyRosters ?? []) {
    const divisions = divisionsFor(roster.bodyId, null);
    if (!divisions.some(id => wanted.has(id))) continue;
    for (const member of roster.members) {
      if (!member.name || !member.officeTitle) continue;
      subjects.set(member.id, { id: member.id, kind: "seat", divisionIds: divisions, label: member.officeTitle });
      const source = member.membershipSource ?? roster;
      add(member.id, "OFF-04", { name: member.name, office: member.officeTitle }, source.sourceUrl, source.collectedAt, 30 * 24);
      add(member.id, "OFF-08", { name: member.name, office: member.officeTitle }, source.sourceUrl, source.collectedAt, 30 * 24);
      // Optional facts retained from older reads keep their own source clocks.
      for (const key of ["termNote", "email", "phone", "websiteUrl"] as const) {
        if (!member[key]) continue;
        const origin = member.retainedFieldSources?.[key] ?? source;
        add(member.id, key === "termNote" ? "OFF-06" : key === "websiteUrl" ? "OFF-08" : "OFF-09", { [key]: member[key], contactScope: member.contactScope },
          origin.sourceUrl, origin.collectedAt, 30 * 24);
      }
    }
  }
  for (const read of meetingReads) {
    for (const meeting of published(read)?.meetings ?? []) {
      const divisions = divisionsFor(meeting.bodyId, meeting.ocdId);
      if (!divisions.some(id => wanted.has(id))) continue;
      subjects.set(meeting.id, { id: meeting.id, kind: "calendar", divisionIds: divisions, label: meeting.title });
      const hours = Math.abs(Date.parse(meeting.startsAt) - Date.parse(now)) <= 7 * 24 * 3_600_000 ? 1 : 12;
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
  return { subjects: [...subjects.values(), ...extra.subjects], held: [...held.values(), ...extra.held] };
}

export async function readHeldPlaceCapture(divisionIds: readonly string[], options: PromotedCivicDataReadOptions = {}): Promise<HeldPlaceCapture> {
  const registry = await readRegistryRuntimeProjection(options);
  const value = published(registry);
  const bodies = new Set((value?.registry.bodies ?? []).filter(body =>
    [body.ocdId, ...(body.alsoServesOcdIds ?? [])].some(id => id !== null && divisionIds.includes(id))).map(body => body.id));
  const partitions = MEETING_PARTITION_CONTRACTS.filter(partition =>
    bodies.has(partition.bodyId) || (partition.ocdId !== null && divisionIds.includes(partition.ocdId)) ||
    (partition.derivedFamily !== null && divisionIds.some(id => id.includes(`/state:${partition.derivedFamily!.slice(3).toLowerCase()}`))));
  const [meetings, families] = await Promise.all([
    readPromotedCivicDataBatch<MeetingsSnapshot>("MEETING", partitions.map(partition => partition.scope), options),
    readHeldPlaceFamilies(divisionIds, options),
  ]);
  return projectHeldPlaceCapture(divisionIds, registry, meetings, options.now ?? new Date().toISOString(), families);
}
