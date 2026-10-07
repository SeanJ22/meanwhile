/**
 * Meetings, meeting outcomes, official actions, candidate profiles and pilot-county ballots for reader tests, installed on the same process edge as
 * `promoted-fixtures.ts` (through its `installPromotedValue`). Nothing here reads a deleted seed file: the
 * values come from kept recorded fixtures (`tests/fixtures/`), plus small synthetic rows each helper names.
 */
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
import { readCandidateProfilesProjection, readNhBallotProjection } from "../../lib/civic-data/manual-read-models.ts";
import type { AzBallotProjection, NhBallotProjection } from "../../lib/civic-data/manual-projections.ts";
import type { CandidacyRemoval, Contest } from "../../lib/ballot/types.ts";
import type { MeasureRecord } from "../../lib/ballot/measure-records.ts";
import { requiredRoutineContract } from "../../lib/civic-data/contracts.ts";
import { readNjMorrisFiling, type NjMorrisContactDocument, type NjMorrisReadModel, type RawFile } from "../../lib/sources/ballot-nj-morris/index.ts";
import { installAbsent, installManualValue, installPromotedValue, syntheticAzBallot } from "./promoted-fixtures.ts";

const ROOT = join(import.meta.dirname, "..", "..");

/* ------------------------------------------------------------------ meeting outcomes */

/** The recorded Pima Legistar outcome store (`tests/fixtures/legistar-outcome-store`): four sittings of the Board of Supervisors. */
export function pimaOutcomeFixture(): OutcomeSnapshot {
  return JSON.parse(readFileSync(join(ROOT, "tests/fixtures/legistar-outcome-store/data/outcomes/legistar-outcomes.json"), "utf8")) as OutcomeSnapshot;
}

/**
 * Pima's outcome door on the process edge as its promoted pointer, then read through the production
 * refresh (every door; the others answer NOT_RECORDED), so `getOutcomeSnapshot` serves it.
 */
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

/* ------------------------------------------------------------------ meetings */

/** The recorded `/api/meetings` answer for 85701 (`tests/fixtures/reader-upcoming-meetings-85701.json`): 51 Pima County, Tucson Unified and Pima Community College rows. */
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

/**
 * Meetings on the process edge exactly as the runner promotes them: each row goes to its registered
 * source/body partition's pointer (one fresh version per partition, carry marks dropped), and every other
 * partition, history and held-route pointer answers NOT_RECORDED. The reader composes them through
 * `readMeetingsProjection` unchanged.
 */
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

/**
 * The agenda document each held notice summary cites, at the exact version (content hash and URL) the
 * summary names, attached to its recorded meeting.
 */
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

/** The recorded 85701 meetings with their held notice documents, as one composed snapshot value. */
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

/**
 * Synthetic second calendar listings: for `count` recorded, placed Tucson Unified board sittings on distinct
 * local days, a sibling row with its own publisher id and source URL and every civic field equal, so the pair is
 * an unresolved listing multiplicity. Returns every recorded row plus the siblings, and the pairs.
 */
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

/** Synthetic date-only listings: `count` recorded rows republished with only a local date, under new ids. */
export function dateOnlyListings(count = 3, meetings: readonly Meeting[] = recordedMeetings85701()): Meeting[] {
  return meetings.filter((row) => row.bodyId?.endsWith("county:pima#governing") && row.id.startsWith("legistar:")).slice(0, count)
    .map((row) => ({ ...row, id: `${row.id}-date-only`, startsAt: row.startsAt.slice(0, 10), startPrecision: "DAY" as const }));
}

/* ------------------------------------------------------------------ Arizona official actions */

/**
 * A synthetic Arizona governor's action holding: two executive orders and one held, unread bill letter,
 * each attributed to the seat and to `officeholderName` (the registry's current holder, so the committed
 * identity join can be exercised). Designations, titles and URLs are invented and say so.
 */
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

/** The Arizona official-action pointer on the process edge, read through the production refresh. */
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

/* ------------------------------------------------------------------ candidate profiles */

/** One held candidate card with every field the profile contract classifies; values are synthetic. */
export function syntheticCandidateCard(over: Partial<CandidateCardData> = {}): CandidateCardData {
  return {
    photoUrl: null, photoSource: null,
    bio: null, bioSourceUrl: null, bioSourceLabel: null,
    email: null, phone: null, phoneSource: null, phoneLabel: null,
    filedAddress: null, filedAddressSource: null,
    ...over,
  };
}

/**
 * A synthetic candidate profile holding: cards and verified links keyed by the candidacy keys a test
 * names. The values are labelled test text and `example.test` URLs, never a real person's details.
 */
export function candidateProfilesFor(
  cards: Readonly<Record<string, CandidateCardData>>,
  links: Readonly<Record<string, CandidateLinks>> = {},
): CandidateProfilesProjection {
  return {
    cards: { curatedAt: "2026-09-25", note: "Synthetic test cards.", cards, hunts: [] },
    links: { curatedAt: "2026-09-25", note: "Synthetic test links.", links, hunts: [] },
  };
}

/** The candidate-profile pointer on the process edge, read through its production Reader. */
export async function installCandidateProfiles(value: CandidateProfilesProjection): Promise<CandidateProfilesProjection> {
  installManualValue("candidate-profiles", value, "test:candidate-profiles");
  const read = await readCandidateProfilesProjection();
  if (read.kind !== "PROMOTED") throw new Error(`Candidate profiles fixture did not install: ${read.kind}`);
  return value;
}

/* ------------------------------------------------------------------ Arizona ballot, as the ballot source reads it */

/**
 * `syntheticAzBallot` with the ballot file's `formatVersion`, which the curated ballot source's validator
 * requires before it serves any contest to Ask or the ballot page.
 */
export function servableAzBallot(contests: Parameters<typeof syntheticAzBallot>[0]): AzBallotProjection {
  const value = syntheticAzBallot(contests);
  return { ...value, ballot: { formatVersion: 1, ...value.ballot } } as AzBallotProjection;
}

/* ------------------------------------------------------------------ ballots for the pilot counties */

const TEST_BALLOT_PROVENANCE = { sourceUrl: "https://example.test/ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };

/** One synthetic race: a contest and its filed candidacies (or the measure it puts to voters). */
export interface TestRace {
  readonly id: string;
  readonly title: string;
  readonly ocdId: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly measure?: { readonly questionText: string; readonly officialNumber?: string };
}

function rawBallot(state: string, races: readonly TestRace[]): RawFile {
  const electionId = `${state.toLowerCase()}-2026-general-test`;
  return {
    formatVersion: 1,
    election: { id: electionId, date: "2026-11-03", name: "2026 General Election (test)", state },
    contests: races.map((race) => ({
      id: race.id, electionId, ocdId: race.ocdId, divisionVintage: "2026", title: race.title, type: race.type ?? (race.measure ? "MEASURE" : "CANDIDACY"),
      voteFor: 1, termYears: race.measure ? null : 4, scopeNote: null, provenance: TEST_BALLOT_PROVENANCE,
    })),
    candidacies: races.flatMap((race) => (race.candidacies ?? []).map((row) => ({
      id: row.id, contestId: race.id, givenName: row.givenName, familyName: row.familyName, partyLabel: row.partyLabel ?? null,
      slogan: null, incumbent: null, websiteUrl: null, provenance: TEST_BALLOT_PROVENANCE,
    }))),
    measures: races.flatMap((race) => race.measure ? [{
      id: `${race.id}#measure`, contestId: race.id, ...(race.measure.officialNumber ? { officialNumber: race.measure.officialNumber } : {}),
      questionText: race.measure.questionText, officialStatement: null, provenance: TEST_BALLOT_PROVENANCE,
    }] : []),
    absences: [],
  } as RawFile;
}

/**
 * A synthetic Morris County filing projection: the races a test names, any sourced removals, and the
 * filed contact rows (email and a filed mailing address the reader must never show).
 */
export function njMorrisFiling(races: readonly TestRace[], extra: {
  readonly removals?: readonly CandidacyRemoval[];
  readonly contacts?: NjMorrisContactDocument["contacts"];
} = {}): NjMorrisReadModel {
  return {
    ballot: { ...rawBallot("NJ", races), removals: [...(extra.removals ?? [])] },
    contacts: { generatedAt: "2026-09-25", route: "https://example.test/morris-filings", note: "Synthetic test contacts.", contacts: extra.contacts ?? [] },
  };
}

/** The Morris County filing pointer on the process edge, read through its production Reader. */
export async function installNjMorrisFiling(value: NjMorrisReadModel): Promise<NjMorrisReadModel> {
  const contract = requiredRoutineContract("nj-morris-filing");
  installPromotedValue({ recordClass: contract.recordClass, scope: contract.scope, sourceId: contract.sourceId, versionId: "test:nj-morris-filing", value });
  const read = await readNjMorrisFiling();
  if (read.kind !== "PROMOTED") throw new Error(`Morris filing fixture did not install: ${read.kind}`);
  return value;
}

/** A synthetic Merrimack County (New Hampshire) ballot with the races a test names. */
export function nhBallot(races: readonly TestRace[]): NhBallotProjection {
  return { ballot: rawBallot("NH", races) } as NhBallotProjection;
}

/** The New Hampshire ballot pointer on the process edge, read through its production Reader. */
export async function installNhBallot(value: NhBallotProjection): Promise<NhBallotProjection> {
  installManualValue("nh-curated-ballot", value, "test:nh-curated-ballot");
  const read = await readNhBallotProjection();
  if (read.kind !== "PROMOTED") throw new Error(`New Hampshire ballot fixture did not install: ${read.kind}`);
  return value;
}

/** Arizona measures for `servableAzBallot`: each race's measure row, plus its held measure record when given. */
export function withAzMeasures(value: AzBallotProjection, races: readonly TestRace[], records: readonly MeasureRecord[] = []): AzBallotProjection {
  const raw = rawBallot("AZ", races);
  return {
    ...value,
    ballot: {
      ...value.ballot,
      contests: [...value.ballot.contests, ...raw.contests.map((contest) => ({ ...contest, electionId: value.ballot.election.id }))],
      measures: [...value.ballot.measures, ...raw.measures],
      measureRecords: records,
    },
  } as AzBallotProjection;
}
