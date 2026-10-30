import type { Meeting, Provenance } from "../sources/types.ts";

/** Callers supply the existing exact registry/committed-alias lookup. A name,
 * division alone or an unverified body ID is never a resolved civic body. */
export type ResolveListingBody = (bodyId: string | null | undefined) => { bodyId: string } | null;

export interface MeetingListingMultiplicityGroup {
  readonly kind: "UNRESOLVED_MULTIPLICITY";
  readonly canonicalBodyId: string;
  /** Canonical ISO spelling of the exact published instant, not a new time. */
  readonly startsAt: string;
  readonly sourceListingCount: number;
  readonly uniqueMeetingCount: null;
  readonly sourceIds: readonly string[];
  readonly sources: readonly (Readonly<Provenance> & { readonly id: string })[];
  readonly reason: string;
}

export interface MeetingListingIdentityReadback {
  /** Input rows, including any repeated native ID that needs its own repair. */
  readonly recordCount: number;
  /** Distinct nonempty publisher record IDs; never a count of unique events. */
  readonly sourceListingCount: number;
  readonly groups: readonly MeetingListingMultiplicityGroup[];
  readonly unresolvedBodySourceIds: readonly string[];
  readonly unresolvedTimeSourceIds: readonly string[];
  readonly duplicateNativeIds: readonly string[];
}

/** Sort object keys only. Array order, null, false and missing fields remain
 * distinct. Unknown future civic fields participate automatically. */
function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, ordered(child)]));
  return value;
}

/** Two different publisher IDs can describe the same body/time/details without
 * establishing whether they describe one event. Preserve both listings and
 * their exact sources; this diagnostic never merges a meeting, copies an
 * agenda/outcome, or declares either listing the canonical event. */
export function meetingListingIdentity(meetings: readonly Meeting[], resolveBody: ResolveListingBody): MeetingListingIdentityReadback {
  const idCounts = new Map<string, number>();
  for (const meeting of meetings) if (meeting.id) idCounts.set(meeting.id, (idCounts.get(meeting.id) ?? 0) + 1);
  const duplicateNativeIds = [...idCounts].filter(([, count]) => count > 1).map(([id]) => id).sort();
  const duplicates = new Set(duplicateNativeIds);
  const unresolvedBodySourceIds = new Set<string>();
  const unresolvedTimeSourceIds = new Set<string>();
  const buckets = new Map<string, { canonicalBodyId: string; startsAt: string; rows: Meeting[] }>();
  for (const meeting of meetings) {
    const body = resolveBody(meeting.bodyId);
    if (!body?.bodyId) { unresolvedBodySourceIds.add(meeting.id); continue; }
    // Date.parse accepts bare dates and zone-less local times. Those values do
    // not establish a published instant, even if precision was omitted. The
    // contract permits an omitted precision on older explicitly timed sources;
    // it does not permit inferring their clock or UTC offset.
    const explicitlyTimed = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(meeting.startsAt);
    const instant = explicitlyTimed ? Date.parse(meeting.startsAt) : NaN;
    if (!Number.isFinite(instant) || meeting.startPrecision === "DAY") { unresolvedTimeSourceIds.add(meeting.id); continue; }
    if (!meeting.id || duplicates.has(meeting.id)) continue;
    const startsAt = new Date(instant).toISOString();
    const { id: _id, provenance, carried: _carried, fieldSources: _fieldSources, ...civic } = meeting;
    const { sourceUrl: _sourceUrl, collectedAt: _collectedAt, verifiedAt: _verifiedAt, ...sourceAuthority } = provenance;
    // Only record identity and read-history fields are removed. Titles, status,
    // venue/online access, geography, agenda URL/absence observation, acting-body
    // evidence and any future civic fields must all agree exactly.
    const key = JSON.stringify(ordered({ ...civic, bodyId: body.bodyId, startsAt, sourceAuthority }));
    const bucket = buckets.get(key);
    if (bucket) bucket.rows.push(meeting);
    else buckets.set(key, { canonicalBodyId: body.bodyId, startsAt, rows: [meeting] });
  }
  const groups = [...buckets.values()].filter(bucket => bucket.rows.length > 1).map(({ canonicalBodyId, startsAt, rows }): MeetingListingMultiplicityGroup => {
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    return {
      kind: "UNRESOLVED_MULTIPLICITY", canonicalBodyId, startsAt,
      sourceListingCount: sorted.length, uniqueMeetingCount: null,
      sourceIds: sorted.map(row => row.id),
      sources: sorted.map(row => ({ id: row.id, ...row.provenance })),
      reason: `${sorted.length} calendar listings share this body, time and other recorded details. We have not established how many distinct meetings they describe.`,
    };
  }).sort((a, b) => a.canonicalBodyId.localeCompare(b.canonicalBodyId) || a.startsAt.localeCompare(b.startsAt) || JSON.stringify(a.sourceIds).localeCompare(JSON.stringify(b.sourceIds)));
  return { recordCount: meetings.length, sourceListingCount: idCounts.size, groups, unresolvedBodySourceIds: [...unresolvedBodySourceIds].sort(), unresolvedTimeSourceIds: [...unresolvedTimeSourceIds].sort(), duplicateNativeIds };
}

/** Exact native lookup only: an unrelated ID never inherits a group's claim. */
export function listingMultiplicityForSource(readback: MeetingListingIdentityReadback, sourceId: string): MeetingListingMultiplicityGroup | null {
  const matches = readback.groups.filter(group => group.sourceIds.includes(sourceId));
  return matches.length === 1 ? matches[0] : null;
}
