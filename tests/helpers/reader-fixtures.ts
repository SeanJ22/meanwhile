
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { outcomePointers, refreshOutcomeSnapshotFromPromoted } from "../../lib/outcomes/store.ts";
import { AZ_OFFICIAL_ACTIONS_CONTRACT, PIMA_OUTCOME_TENANT } from "../../lib/outcomes/data-plane.ts";
import { refreshExecutiveActionsFromPromoted, type ExecutiveAction, type ExecutiveActionStore } from "../../lib/officials/executive-actions.ts";
import type { OutcomeSnapshot } from "../../lib/outcomes/types.ts";
import { HELD_MEETING_PARTITIONS, MEETING_PARTITION_CONTRACTS, meetingHistoryScope, type MeetingPartitionContract } from "../../lib/civic-data/meeting-partitions.ts";
import type { AgendaDocument } from "../../lib/meetings/agenda-documents.ts";
import { NOTICE_SUMMARIES } from "../../lib/meetings/notice-summary.ts";
import { snapshotCounts, type MeetingsSnapshot } from "../../lib/meetings/snapshot.ts";
import type { Meeting } from "../../lib/sources/types.ts";
import type { CandidateCardData } from "../../lib/ballot/candidate-cards.ts";
import type { CandidateLinks } from "../../lib/ballot/candidate-sites.ts";
import type { CandidateProfilesProjection } from "../../lib/civic-data/manual-projections.ts";



import { installAbsent, installPromotedValue } from "./promoted-fixtures.ts";

const ROOT = join(import.meta.dirname, "..", "..");

export function pimaOutcomeFixture(): OutcomeSnapshot {
  return JSON.parse(readFileSync(join(ROOT, "tests/fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json"), "utf8")) as OutcomeSnapshot;
}

export async function installPimaOutcomes(value: OutcomeSnapshot = pimaOutcomeFixture()): Promise<OutcomeSnapshot> {
  installPromotedValue({
    recordClass: PIMA_OUTCOME_TENANT.recordClass,
    scope: PIMA_OUTCOME_TENANT.scope,
    sourceId: PIMA_OUTCOME_TENANT.sourceId,
    versionId: "test:pima-outcomes",
    value,
  });
  for (const pointer of outcomePointers()) if (pointer.scope !== PIMA_OUTCOME_TENANT.scope) installAbsent(pointer.recordClass, pointer.scope);
  await refreshOutcomeSnapshotFromPromoted();
  return value;
}

export function recordedMeetings85701(): Meeting[] {
  const recorded = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/reader-upcoming-meetings-85701.json"), "utf8")) as { meetings: Meeting[] };
  return recorded.meetings;
}

function partitionFor(meeting: Meeting): MeetingPartitionContract {
  const partition = MEETING_PARTITION_CONTRACTS.find((row) =>
    row.derivedFamily === null && row.historyOf === undefined && row.bodyId === meeting.bodyId && meeting.id.startsWith(`${row.meetingSource}:`));
  if (partition) return partition;
  // A body with no partition of its own is served by its state's derived meeting family.
  const usps = /state:([a-z]{2})\b/.exec(meeting.ocdId ?? "")?.[1] ?? /^curated:([a-z]{2})\//.exec(meeting.bodyId ?? "")?.[1];
  const family = usps ? MEETING_PARTITION_CONTRACTS.find((row) => row.derivedFamily === `US-${usps.toUpperCase()}`) : undefined;
  if (!family) throw new Error(`No registered meeting partition holds ${meeting.id} (${meeting.bodyId}).`);
  return family;
}

export function installMeetings(meetings: readonly Meeting[], agendaDocuments: readonly AgendaDocument[] = [], retrievedAt = "2026-09-25T12:00:00.000Z"): void {
  const byPartition = new Map<MeetingPartitionContract, Meeting[]>();
  for (const meeting of meetings) {
    const partition = partitionFor(meeting);
    const { carried: _carried, ...fresh } = meeting;
    byPartition.set(partition, [...(byPartition.get(partition) ?? []), fresh as Meeting]);
  }
  for (const partition of MEETING_PARTITION_CONTRACTS) {
    installAbsent("MEETING", meetingHistoryScope(partition.scope));
    const rows = byPartition.get(partition);
    if (!rows) { installAbsent("MEETING", partition.scope); continue; }
    const ids = new Set(rows.map((row) => row.id));
    const sourceOf = (row: Meeting) => row.id.split(":")[0]!;
    const sourceNames = partition.derivedFamily === null ? [partition.meetingSource] : [...new Set(rows.map(sourceOf))].sort();
    const members = partition.derivedFamily === null ? undefined : [...new Map(rows.map((row) => [`${sourceOf(row)}:${row.bodyId}`, {
      id: `${sourceOf(row)}:${row.bodyId}`, source: sourceOf(row), bodyId: row.bodyId!, status: "ACTIVE" as const, outcome: "FRESH" as const,
    }])).values()];
    const value: MeetingsSnapshot = {
      formatVersion: 1,
      generatedAt: retrievedAt,
      counts: snapshotCounts(rows, 0),
      sources: sourceNames.map((source) => {
        const count = partition.derivedFamily === null ? rows.length : rows.filter((row) => sourceOf(row) === source).length;
        return {
          source, ok: true, error: null, fetched: count, normalized: count,
          drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        };
      }),
      meetings: rows,
      agendaDocuments: agendaDocuments.filter((document) => ids.has(document.meetingId)),
      ...(members ? { derivedMembers: members } : {}),
    };
    installPromotedValue({ recordClass: "MEETING", scope: partition.scope, sourceId: partition.sourceId, versionId: `test:${partition.id}`, value, retrievedAt });
  }
  for (const held of HELD_MEETING_PARTITIONS) installAbsent("MEETING", held.scope);
}

export function noticeSummaryDocuments(meetings: readonly Meeting[] = recordedMeetings85701()): AgendaDocument[] {
  return NOTICE_SUMMARIES.flatMap((summary) => {
    const meeting = meetings.find((row) => row.id === summary.meetingId);
    if (!meeting) return [];
    const retrievedAt = `${summary.writtenAt.slice(0, 10)}T00:00:00.000Z`;
    return [{
      id: `${summary.meetingId}@${summary.contentHash}`,
      meetingId: summary.meetingId,
      ocdId: meeting.ocdId,
      documentUrl: summary.summarizesUrl,
      contentHash: summary.contentHash,
      retrievedAt,
      contentType: "text/html",
      text: "Official meeting notice.",
      extraction: "html",
      extractionNote: null,
      sourceUrl: summary.summarizesUrl,
      sourceOrg: meeting.provenance.sourceOrg,
      collectedAt: retrievedAt,
      verifiedAt: null,
    } satisfies AgendaDocument];
  });
}

export function recordedMeetingsSnapshot(meetings: readonly Meeting[] = recordedMeetings85701()): MeetingsSnapshot {
  const rows = meetings.map(({ carried: _carried, ...row }) => row as Meeting);
  const sources = [...new Set(rows.map((row) => row.id.split(":")[0]!))].sort();
  return {
    formatVersion: 1,
    generatedAt: "2026-09-25T12:00:00.000Z",
    counts: snapshotCounts(rows, 0),
    sources: sources.map((source) => {
      const count = rows.filter((row) => row.id.startsWith(`${source}:`)).length;
      return { source, ok: true, error: null, fetched: count, normalized: count, drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 } };
    }),
    meetings: rows,
    agendaDocuments: noticeSummaryDocuments(rows),
  };
}

export function ambiguousListingPairs(count = 3, meetings: readonly Meeting[] = recordedMeetings85701()): { meetings: Meeting[]; pairs: [Meeting, Meeting][] } {
  const body = "ocd-division/country:us/state:az/school_district:tucson_unified_district#board";
  const day = (row: Meeting) => row.startsAt.slice(0, 10);
  const rows = meetings.filter((row) => row.bodyId === body && row.startPrecision !== "DAY");
  const placed = (row: Meeting) => Number.isFinite(row.location?.lat) && Number.isFinite(row.location?.lng);
  const lone = rows.filter((row) => placed(row) && rows.filter((other) => day(other) === day(row)).length === 1)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt)).slice(0, count);
  if (lone.length < count) throw new Error(`only ${lone.length} recorded sittings stand alone on their day`);
  const pairs = lone.map((row): [Meeting, Meeting] => [row, {
    ...row,
    id: `${row.id}-second-listing`,
    provenance: { ...row.provenance, sourceUrl: `${row.provenance.sourceUrl}#second-listing` },
  }]);
  return { meetings: [...meetings, ...pairs.map(([, sibling]) => sibling)], pairs };
}

export function dateOnlyListings(count = 3, meetings: readonly Meeting[] = recordedMeetings85701()): Meeting[] {
  return meetings.filter((row) => row.bodyId?.endsWith("county:pima#governing") && row.id.startsWith("legistar:")).slice(0, count)
    .map((row) => ({ ...row, id: `${row.id}-date-only`, startsAt: row.startsAt.slice(0, 10), startPrecision: "DAY" as const }));
}

export function syntheticExecutiveActions(officeholderName: string): ExecutiveActionStore {
  const base = {
    officeholderId: "statewide:az/governor", officeholderName, officeTitle: "Governor", ocdId: "ocd-division/country:us/state:az",
    sourceOrg: "Office of the Arizona Governor", collectedAt: "2026-09-25", sessionId: null, chapter: null, coveredBills: [], enactmentRoute: null,
  } as const;
  const order = (n: string, occurredAt: string): ExecutiveAction => ({
    ...base, id: `test-eo-2026-${n}`, kind: "EXECUTIVE_ORDER", designation: `Executive Order 2026-${n} (test)`,
    title: `Synthetic test executive order ${n}`, occurredAt, occurredAtState: "PUBLISHED",
    sourceUrl: `https://example.test/executive-order/2026-${n}`, documentUrl: `https://example.test/executive-order-2026-${n}.pdf`, coveredBills: [],
  });
  return {
    note: "Synthetic test holding.",
    source: { index: "https://example.test/executive-orders", publisher: "Office of the Arizona Governor", permission: "test", collectedAt: "2026-09-25" },
    denominator: { indexedAcrossPagesWalked: 3, indexPagesWalked: 1, detailPagesRead: 3, reachedEndOfIndex: true },
    legislative: null,
    actions: [
      order("01", "2026-05-20"),
      order("02", "2026-07-08"),
      {
        ...base, id: "test-letter-hb0001", kind: "BILL_LETTER_UNREAD", designation: "HB 0001 (test)", title: null,
        occurredAt: null, occurredAtState: "NOT_YET_READ", sourceUrl: "https://example.test/governors-letters",
        documentUrl: "https://example.test/governors-letters/hb0001.pdf", sessionId: "57leg/2r", coveredBills: ["HB0001"],
      },
    ],
  };
}

export async function installExecutiveActions(value: ExecutiveActionStore): Promise<ExecutiveActionStore> {
  installPromotedValue({
    recordClass: AZ_OFFICIAL_ACTIONS_CONTRACT.recordClass,
    scope: AZ_OFFICIAL_ACTIONS_CONTRACT.scope,
    sourceId: AZ_OFFICIAL_ACTIONS_CONTRACT.sourceId,
    versionId: "test:az-official-actions",
    value,
  });
  await refreshExecutiveActionsFromPromoted();
  return value;
}

export function syntheticCandidateCard(over: Partial<CandidateCardData> = {}): CandidateCardData {
  return {
    photoUrl: null, photoSource: null,
    bio: null, bioSourceUrl: null, bioSourceLabel: null,
    email: null, phone: null, phoneSource: null, phoneLabel: null,
    filedAddress: null, filedAddressSource: null,
    ...over,
  };
}

export function candidateProfilesFor(
  cards: Readonly<Record<string, CandidateCardData>>,
  links: Readonly<Record<string, CandidateLinks>> = {},
): CandidateProfilesProjection {
  return {
    cards: { curatedAt: "2026-09-25", note: "Synthetic test cards.", cards, hunts: [] },
    links: { curatedAt: "2026-09-25", note: "Synthetic test links.", links, hunts: [] },
  };
}
