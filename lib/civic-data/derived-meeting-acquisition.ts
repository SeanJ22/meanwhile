import { MEETING_HELD_HORIZON_DAYS, MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { buildCompositeSource, STANDING_PARTITION_ACQUISITION_TIMEOUT_MS } from "../sources/composite/wiring.ts";
import { jobFailureDetail } from "../sources/composite/failure-kind.ts";
import { municodePortalKey, type MunicodeRaw } from "../sources/municode/index.ts";
import type { Meeting } from "../sources/types.ts";
import { bodySourceWiringFor, DERIVED_WIRING_SOURCE_NAMES, type DerivedWiringRecord } from "./derived-meeting-wiring.ts";
import type { FamilyMemberRead } from "./derived-meeting-family.ts";

export function* derivedFamilyReadGroups(members: readonly DerivedWiringRecord[]): Generator<DerivedWiringRecord[]> {
  const portals = new Map<string, DerivedWiringRecord[]>();
  for (const member of members) {
    if (member.status !== "ACTIVE") continue;
    if (member.row.kind !== "MUNICODE") { yield [member]; continue; }
    let key: string;
    try { key = municodePortalKey(member.row.route); } catch { yield [member]; continue; }
    const group = portals.get(key) ?? [];
    group.push(member);
    portals.set(key, group);
  }
  for (const group of portals.values()) yield group;
}

/** @freshness-reads-here: each grouped source read stamps its own completed acquisition. */
export async function readDerivedFamilyMembers(
  members: readonly DerivedWiringRecord[],
  fetchImpl: typeof fetch,
  attribute: (meetings: Meeting[]) => Meeting[] = meetings => meetings,
  now = new Date(),
): Promise<FamilyMemberRead[]> {
  if (members.length === 0) return [];
  const sourceName = DERIVED_WIRING_SOURCE_NAMES[members[0].row.kind];
  try {
    const source = buildCompositeSource({ timeoutMs: STANDING_PARTITION_ACQUISITION_TIMEOUT_MS,
      captureAcquisitionEvidence: true, sourceNames: [sourceName],
      derivedRows: members.map(member => bodySourceWiringFor(member.row)), fetchImpl });
    const raw = await source.fetch({ lat: 39.5, lng: -98.35, radiusKm: 5000,
      startsAfter: new Date(now.getTime() - MEETING_HELD_LOOKBACK_DAYS * 86_400_000).toISOString(),
      startsBefore: new Date(now.getTime() + MEETING_HELD_HORIZON_DAYS * 86_400_000).toISOString() });
    const fetched = source.fetchedSourceReport(sourceName);
    const ownRaw = new Map<string, typeof raw>();
    if (sourceName === "municode") for (const tagged of raw) {
      const bodyId = (tagged.raw as MunicodeRaw).wiring.bodyId;
      const own = ownRaw.get(bodyId) ?? [];
      own.push(tagged);
      ownRaw.set(bodyId, own);
    }
    return members.map(member => {
      const meetings = fetched?.ok ? attribute(source.normalize(sourceName === "municode" ? ownRaw.get(member.row.bodyId) ?? [] : raw)) : [];
      const report = source.lastReport?.children.find(child => child.source === sourceName);
      const foreign = meetings.some(meeting => meeting.bodyId !== member.row.bodyId);
      const ok = fetched?.ok === true && report?.ok === true && !foreign;
      return { member, acquisitions: fetched?.acquisitions ?? [], ok,
        error: ok ? null : foreign ? jobFailureDetail("the adapter returned another body's meetings") : fetched?.error ?? report?.error ?? `the composite produced no report for ${sourceName}`,
        freshMeetings: ok ? meetings : [], freshAgendaDocuments: [], retrievedAt: new Date().toISOString() };
    });
  } catch (error) {
    const detail = jobFailureDetail(error instanceof Error ? error.message : String(error));
    const retrievedAt = new Date().toISOString();
    return members.map(member => ({ member, acquisitions: [], ok: false, error: detail,
      freshMeetings: [], freshAgendaDocuments: [], retrievedAt }));
  }
}
