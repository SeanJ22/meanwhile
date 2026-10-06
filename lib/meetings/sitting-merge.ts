import { localWallClock, sittingKey } from "../sources/event-identity.ts";
import type { Meeting, Provenance } from "../sources/types.ts";
import { preferCurrentSource } from "../civic-data/source-conflicts.ts";
import type { SourceScopedHeldFact } from "../civic-data/manual-source-isolation.ts";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";

// Retain every contributing door after exact duplicate collapse, so two
// sittings from one door never become an unambiguous day merely by merging.
const sources = (meeting: Meeting) => [...new Set([meeting.id, ...(meeting.mergedMeetingIds ?? [])].map(id => id.split(":")[0]))];
const present = (value: unknown) => value !== null && value !== undefined && value !== "" && (!Array.isArray(value) || value.length > 0);
const meta = new Set(["id", "bodyId", "ocdId", "jurisdiction", "provenance", "fieldSources", "publicationConflicts", "mergedMeetingIds", "carried"]);
const timing = ["startsAt", "timeZone", "startPrecision"];
const venue = ["location", "online", "venueGap"];

/** Same body/day across doors. When a door lists multiple sittings that day,
 * only an unambiguous exact sitting identity can join them. */
export function mergeReaderSittings(input: readonly Meeting[]) {
  const groups = new Map<string, Meeting[]>();
  for (const meeting of input) {
    let date: string | undefined;
    try { if (meeting.timeZone && meeting.provenance) date = localWallClock(meeting.startsAt, meeting.timeZone)?.date; } catch { /* Invalid source dates do not acquire an identity. */ }
    const body = meeting.bodyId ?? (meeting.ocdId && meeting.bodyName ? `${meeting.ocdId}:${meeting.bodyName}` : null);
    const key = body && date ? `${body}\u001f${date}` : meeting.id;
    groups.set(key, [...(groups.get(key) ?? []), meeting]);
  }
  const rows: Meeting[] = [], dropped: Meeting[] = [];
  const aliases = new Map<string, string>();
  const conflicts: SourceScopedHeldFact[] = [];
  for (const group of groups.values()) {
    const routes = group.flatMap(sources);
    const buckets = new Map<string, Meeting[]>();
    const unambiguousDay = new Set(routes).size === routes.length;
    for (const meeting of group) {
      let identity: string | null = null;
      try { identity = sittingKey({ ...meeting, bodyId: meeting.bodyId ?? `${meeting.ocdId}:${meeting.bodyName}` }); } catch { /* Keep malformed identities separate. */ }
      const key = unambiguousDay ? "day" : identity ?? meeting.id;
      buckets.set(key, [...(buckets.get(key) ?? []), meeting]);
    }
    for (const candidates of buckets.values()) {
      if (candidates.length < 2 || new Set(candidates.flatMap(sources)).size !== candidates.flatMap(sources).length) {
        rows.push(...candidates); continue;
      }
      // Stable ordering makes ties independent of partition fetch order.
      const ordered = [...candidates].sort((a, b) => a.id.localeCompare(b.id));
      const primary = ordered.reduce((best, row) => preferCurrentSource(row.provenance, best.provenance) ? row : best);
      const result = { ...primary } as Meeting & Record<string, unknown>;
      const fieldSources: Record<string, Provenance> = { ...primary.fieldSources };
      const excluded: SourceScopedHeldFact[] = candidates.flatMap(row => row.publicationConflicts ?? []);
      const fieldSource = (row: Meeting, field: string) => row.fieldSources?.[field] ?? row.provenance;
      const merge = (fields: string[]) => {
        const value = (row: Meeting) => fields.length === 1 ? (row as unknown as Record<string, unknown>)[fields[0]]
          : Object.fromEntries(fields.map(key => [key, (row as unknown as Record<string, unknown>)[key] ?? null]));
        const available = ordered.filter(row => fields.some(key => present((row as unknown as Record<string, unknown>)[key])));
        if (!available.length) return;
        const winner = available.reduce((best, row) => preferCurrentSource(fieldSource(row, fields[0]), fieldSource(best, fields[0])) ? row : best);
        for (const field of fields) {
          const next = (winner as unknown as Record<string, unknown>)[field];
          if (next === undefined) delete result[field]; else result[field] = next;
          fieldSources[field] = fieldSource(winner, field);
        }
        for (const loser of available) if (loser !== winner && canonicalCivicDataJson(value(loser)) !== canonicalCivicDataJson(value(winner))) {
          excluded.push({ key: `${primary.id}:${fields[0]}:${loser.id}`, code: "CONFLICT_SUPERSEDED",
            detail: `Kept the higher source kind, then the newer read for ${fields[0]}.`,
            record: { memberId: primary.id, field: fields[0], value: value(loser), source: fieldSource(loser, fields[0]) } });
        }
      };
      merge(timing); merge(venue);
      const keys = new Set(candidates.flatMap(row => Object.keys(row)));
      for (const key of keys) if (!meta.has(key) && !timing.includes(key) && !venue.includes(key)) merge([key]);
      if (result.actingBodies) result.actingBodies = result.actingBodies.map(row => ({ ...row, meetingId: result.id }));
      if (result.agendaUrl) delete result.agendaSlotObservedEmpty;
      result.fieldSources = fieldSources;
      result.mergedMeetingIds = [...new Set(candidates.flatMap(row => [row.id, ...(row.mergedMeetingIds ?? [])]))].sort();
      result.publicationConflicts = [...new Map(excluded.map(row => [canonicalCivicDataJson(row), row])).values()];
      for (const id of result.mergedMeetingIds) aliases.set(id, result.id);
      conflicts.push(...result.publicationConflicts);
      dropped.push(...candidates.filter(row => row !== primary));
      rows.push(result);
    }
  }
  for (const row of rows) for (const id of row.mergedMeetingIds ?? []) aliases.set(id, row.id);
  return { rows, dropped, collapsed: dropped.length, aliases, conflicts };
}

/** Reconcile fields only after the composite has identified an exact duplicate.
 * An ambiguous source history or a different canonical body keeps both rows. */
export function mergeDuplicateSittingFields(held: Meeting, next: Meeting): Meeting | null {
  const merged = mergeReaderSittings([held, next]);
  return merged.rows.length === 1 ? merged.rows[0] : null;
}
