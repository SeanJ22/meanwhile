/**
 * DB-10: today's meeting doors, as registry records.
 *
 * Door ids follow how partitions really work. A hand-wired door is
 * (meeting source, body), which is today's partition id
 * (`meetings:<source>:<bodyId>`); one wiring row can produce several sources
 * and so several doors. A derived member's door id is its derived wiring row
 * id, and it stays a member of its state's family partition
 * (`meetings:derived:<state>`), named in its settings.
 *
 * PURE: mapping only. `scripts/seed-doors-from-meetings.mts` does the one-time
 * write. Pointers and last-known-good data are not touched here: the registry
 * records doors, it does not move what readers see.
 */

import { derivedMeetingFamilyId, meetingAcquisitionFailureDomain, meetingPartitionId } from "../civic-data/meeting-partitions.ts";
import { DERIVED_WIRING_SOURCE_NAMES, type DerivedWiringRecord } from "../civic-data/derived-meeting-wiring.ts";
import { meetingSourceNamesForWiring, type BodySourceWiring } from "../registry/source-wiring.ts";
import { normalizeHost, upsertDerivedDoor, type DoorDraft, type DoorRepository } from "./registry.ts";

/** Every host a wiring row's settings name: full URLs, and settings that are a bare host. */
export function hostsOfConfig(config: Readonly<Record<string, string>>, extraUrls: readonly (string | undefined)[] = []): string[] {
  const hosts = new Set<string>();
  const add = (raw: string) => {
    const host = normalizeHost(raw);
    if (host !== null) hosts.add(host);
  };
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue;
    if (/^https?:\/\//i.test(value.trim())) add(value.trim());
    else if (/host$/i.test(key) && value.trim() !== "") add(value.trim());
  }
  for (const url of extraUrls) if (typeof url === "string" && /^https?:\/\//i.test(url.trim())) add(url.trim());
  return [...hosts].sort();
}

/** One door per (meeting source, body) a hand-wired row produces. */
export function doorsFromWiringRow(row: BodySourceWiring): DoorDraft[] {
  return meetingSourceNamesForWiring(row).map((source) => {
    // Some adapters read one fixed host that no setting names; the partition's upstream boundary is the host actually contacted.
    const upstream = meetingAcquisitionFailureDomain(source, row).replace(/^meeting-upstream:/, "").split("/")[0];
    return {
      doorId: meetingPartitionId(source, row.bodyId),
      kind: source,
      ocdId: row.ocdId,
      bodyIds: [row.bodyId],
      hosts: [...new Set([upstream, ...hostsOfConfig(row.config, [row.noticeUrl])])].sort(),
      config: { ...row.config },
      holds: ["meetings"],
      checkEveryMinutes: null,
      notes:
        `Hand-wired meeting door for ${row.publishingOrg}, confirmed working ${row.verifiedAt}.` +
        (row.publishesHistory === false ? ` Its route carries no past meetings: ${row.historyGapReason ?? "reason not recorded"}` : ""),
      meeting: {
        agendaSourceType: row.agendaSourceType,
        jurisdiction: row.jurisdiction,
        publishingOrg: row.publishingOrg,
        timeZone: row.timeZone,
        ...(row.noticeUrl ? { noticeUrl: row.noticeUrl } : {}),
        ...(row.publishesHistory === false ? { publishesHistory: false as const, historyGapReason: row.historyGapReason ?? "reason not recorded" } : {}),
        verifiedAt: row.verifiedAt,
        family: null,
      },
      status: "OPEN" as const,
      readNow: false,
    };
  });
}

/** One door per derived wiring row: ACTIVE rows open, SUSPENDED rows suspended. */
export function doorFromDerivedRecord(record: DerivedWiringRecord): DoorDraft {
  const { row } = record;
  return {
    doorId: record.id,
    kind: DERIVED_WIRING_SOURCE_NAMES[row.kind],
    ocdId: row.ocdId,
    bodyIds: [row.bodyId],
    hosts: hostsOfConfig(row.config, [row.route, `https://${row.officialHost}/`]),
    config: { ...row.config, route: row.route, familyPartition: derivedMeetingFamilyId(row.state.replace(/^US-/, "") as never) },
    holds: ["meetings"],
    checkEveryMinutes: null,
    notes: `Derived meeting door for ${row.publishingOrg}, from the reviewed crosswalk row ${row.crosswalkRowId} (reviewed ${row.reviewedAt}).`,
    meeting: {
      agendaSourceType: row.kind,
      jurisdiction: row.publishingOrg,
      publishingOrg: row.publishingOrg,
      timeZone: row.timeZone,
      verifiedAt: row.verifiedAt,
      family: derivedMeetingFamilyId(row.state.replace(/^US-/, "") as never),
    },
    status: record.status === "SUSPENDED" ? "SUSPENDED" : "OPEN",
    readNow: false,
  };
}

export interface MeetingSeedCounts {
  created: number;
  updated: number;
  unchanged: number;
  keptManualEdit: number;
  refused: readonly string[];
}

/**
 * Import every wiring row and derived row once. Safe to repeat: rows upsert by
 * door id and a hand edit newer than `deriveInputAt` is never overwritten.
 */
export async function seedMeetingDoors(input: {
  readonly repo: DoorRepository;
  readonly wiring: readonly BodySourceWiring[];
  readonly derived: readonly DerivedWiringRecord[];
  readonly deriveInputAt: string;
  readonly at: string;
}): Promise<MeetingSeedCounts> {
  const counts: MeetingSeedCounts = { created: 0, updated: 0, unchanged: 0, keptManualEdit: 0, refused: [] };
  const refused: string[] = [];
  const drafts: DoorDraft[] = [];
  for (const row of input.wiring) {
    try {
      drafts.push(...doorsFromWiringRow(row));
    } catch (error) {
      refused.push(`${row.bodyId}: ${(error as Error).message}`);
    }
  }
  for (const record of input.derived) drafts.push(doorFromDerivedRecord(record));
  for (const draft of drafts) {
    try {
      const result = await upsertDerivedDoor(input.repo, draft, input.deriveInputAt, input.at);
      if (result === "created") counts.created += 1;
      else if (result === "updated") counts.updated += 1;
      else if (result === "unchanged") counts.unchanged += 1;
      else counts.keptManualEdit += 1;
    } catch (error) {
      refused.push(`${draft.doorId}: ${(error as Error).message}`);
    }
  }
  return { ...counts, refused };
}
