/**
 * **A DERIVED MEETING FAMILY: ONE STATE'S REVIEWED CALENDARS, EACH HELD TO
 * ITS OWN EVIDENCE.** (C16, 2026-09-24.)
 *
 * One partition per registered state (`meetings:derived:US-AZ`, every state
 * since 2026-09-25) whose members are the promoted meeting-source wiring's rows
 * for that state. Its
 * child reads each ACTIVE member on that member's own attested host, and
 * builds one candidate in which every member stands alone:
 *
 * - a member read cleanly contributes its fresh sittings, reconciled against
 *   its own last verified sittings exactly as a partition is;
 * - a member that failed, read off its host, returned another body's rows, or
 *   is SUSPENDED for review contributes its last verified sittings, carried and
 *   marked, and is named in the version (`derivedMembers`) with why. Previously
 *   verified records are preserved through an outage and through a review;
 * - nothing one member does can hold or erase another member's sittings.
 *
 * Its authority is not a route: each member read is named as a
 * MEMBER_ACQUISITION input beside the wiring version that authorizes it, and
 * the door checks every read's host against that version's ACTIVE row
 * (`lib/civic-data/derived-door.ts`). An unreadable wiring store builds no
 * member at all: the candidate is refused and the family's last known good
 * stays live.
 */
import { createHash } from "node:crypto";

import { canonicalCivicDataJson } from "./changes.ts";
import { derivedRetrieval, type DerivedInputRef } from "./derived-authority.ts";
import { derivedRequestedUrl } from "./derived-door.ts";
import { DERIVED_WIRING_SOURCE_NAMES, type DerivedWiringRecord } from "./derived-meeting-wiring.ts";
import type { MeetingPartitionContract } from "./meeting-partitions.ts";
import { sourceProjectionEvidence, type RoutineCandidate, type RoutineRemovalEvidence } from "./types.ts";
import type { DerivedFamilyMemberReport, MeetingsSnapshot } from "../meetings/snapshot.ts";
import type { Meeting } from "../sources/types.ts";
import { carriedFromAnswer, mark as markCarried } from "../meetings/carry-forward.ts";
import { ocdStateCode } from "../ocd/state-of.ts";

export const DERIVED_FAMILY_SOURCE_ID = "meetings-derived-routes" as const;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");
const bare = (host: string): string => host.toLowerCase().replace(/^www\./, "");

/** The member's own sittings and documents in the family's last verified version. */
export function familyMemberSlice(previous: MeetingsSnapshot | null, member: DerivedWiringRecord): {
  readonly meetings: readonly Meeting[];
  readonly agendaDocuments: MeetingsSnapshot["agendaDocuments"];
} {
  if (previous === null) return { meetings: [], agendaDocuments: [] };
  const source = DERIVED_WIRING_SOURCE_NAMES[member.row.kind];
  const meetings = previous.meetings.filter((m) => m.bodyId === member.row.bodyId && m.id.startsWith(`${source}:`));
  const ids = new Set(meetings.map((m) => m.id));
  return { meetings, agendaDocuments: previous.agendaDocuments.filter((d) => ids.has(d.meetingId)) };
}

/**
 * A held member's rows are marked by carry-forward's own mark: a row keeps the instant it was really read, a row
 * already carried keeps its first mark, and the mark names no reason (a member is held for an outage, a read off its
 * host, or a review, and no one sentence is true of all three). The version's `derivedMembers` says which.
 */
export const carriedMember = markCarried;

/** One sitting may be listed by several verified routes. Prefer a fresh,
 * newer reading; a failed sibling must never replace it with carried data. */
function combineMeetings(rows: readonly Meeting[]): { meetings: Meeting[]; dropped: Meeting[] } {
  const kept = new Map<string, Meeting>();
  const dropped: Meeting[] = [];
  const richness = (row: Meeting) => Number(!!row.agendaUrl) * 4 + Number(!!row.location) * 2 + Number(!!row.online);
  for (const row of rows) {
    // A conflicting body remains two rows for the existing identity validator.
    const key = `${row.id}\u0000${row.bodyId}`;
    const prior = kept.get(key);
    if (!prior) { kept.set(key, row); continue; }
    const order = Number(!row.carried) - Number(!prior.carried) ||
      Date.parse(row.provenance.collectedAt) - Date.parse(prior.provenance.collectedAt) || richness(row) - richness(prior);
    const [winner, other] = order > 0 ? [row, prior] : [prior, row];
    const sameSitting = Date.parse(winner.startsAt) === Date.parse(other.startsAt);
    kept.set(key, sameSitting && !winner.agendaUrl && other.agendaUrl
      ? { ...winner, agendaUrl: other.agendaUrl, agendaSlotObservedEmpty: false }
      : winner);
    dropped.push(other);
  }
  return { meetings: [...kept.values()], dropped };
}

/** One member's read, as the family child made it. */
export interface FamilyMemberRead {
  readonly member: DerivedWiringRecord;
  /** Every response the member's adapter read: the evidence its host is checked on. */
  readonly acquisitions: readonly {
    readonly requestedUrl: string;
    readonly finalUrl: string;
    readonly httpStatus: number;
    readonly rawHash: string;
    readonly byteCount: number;
  }[];
  readonly ok: boolean;
  readonly error: string | null;
  readonly freshMeetings: readonly Meeting[];
  readonly freshAgendaDocuments: MeetingsSnapshot["agendaDocuments"];
  readonly retrievedAt: string;
}

/**
 * Why a member's clean read may not enter the family, or null. Anything read off the member's attested host, or any
 * row not the member's own body and source, holds the member on its last verified sittings.
 */
export function familyMemberReadIssue(read: FamilyMemberRead): string | null {
  const row = read.member.row;
  if (!read.ok) return read.error ?? "the member's source failed";
  if (read.acquisitions.length === 0) return "the member's read carries no acquired-response evidence";
  for (const a of read.acquisitions) {
    for (const url of [a.requestedUrl, a.finalUrl]) {
      let host: string;
      try {
        host = new URL(url).hostname;
      } catch {
        return `the member read ${url}, which is not a URL`;
      }
      if (!url.startsWith("https://") || bare(host) !== bare(row.officialHost)) return `the member read ${url}, off its attested host ${row.officialHost}`;
    }
    if (!/^[a-f0-9]{64}$/.test(a.rawHash) || a.byteCount <= 0 || a.httpStatus < 200 || a.httpStatus >= 300) {
      return `the member's read of ${a.finalUrl} carries invalid acquired-byte evidence`;
    }
  }
  return null;
}

/** The candidate a family attempt makes when it cannot build any member: refused, so its last known good stays. */
export function derivedFamilyFailedCandidate(partition: MeetingPartitionContract, attemptedAt: string, failureDetail: string): RoutineCandidate {
  const requestedUrl = derivedRequestedUrl(DERIVED_FAMILY_SOURCE_ID, partition.scope);
  return {
    id: `cv-${sha256(`${DERIVED_FAMILY_SOURCE_ID}\u001f${partition.scope}\u001ffailed\u001f${attemptedAt}`).slice(0, 32)}`,
    sourceId: DERIVED_FAMILY_SOURCE_ID,
    recordClass: "MEETING",
    scope: partition.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(DERIVED_FAMILY_SOURCE_ID, "MEETING", partition.scope),
    retrieval: { succeeded: false, requestedUrl, finalUrl: null, httpStatus: null, retrievedAt: attemptedAt, rawHash: null, failureDetail },
    normalization: {
      succeeded: false, parserVersion: "meetings-composite/2", schemaVersion: "MeetingsSnapshot:1", normalizedHash: null,
      inputRecords: 0, outputRecords: 0, droppedRecords: 0, missingRequiredFields: [], failureDetail,
    },
    identities: [],
    temporal: { version: attemptedAt, expectedVersion: attemptedAt, sourceThrough: attemptedAt, staleAtRetrieval: false },
    semantics: { factKind: "public-body meeting and agenda publication", violations: [] },
    horizon: { kind: "OPEN_FACT_SET", query: `derived family ${partition.derivedFamily}`, returnedRecords: 0, declaredTotal: null, paginationComplete: false, claimsComplete: false },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [],
    normalizedPayload: null,
    readModel: null,
  };
}

export interface DerivedFamilyBuild {
  readonly snapshot: MeetingsSnapshot;
  readonly removalEvidence: readonly RoutineRemovalEvidence[];
  readonly heldFacts: NonNullable<RoutineCandidate["excludedFacts"]>;
  readonly inputs: readonly DerivedInputRef[];
}

/**
 * Assemble one family version from its members. `reconcile` is the partition's own reconciliation of a clean read
 * against a member's last verified sittings (removal evidence included); a member it does not reconcile is carried.
 */
export function buildDerivedFamily(input: {
  readonly wiringInput: DerivedInputRef & { readonly kind: "PROMOTED_VERSION" };
  readonly members: readonly DerivedWiringRecord[];
  readonly reads: readonly FamilyMemberRead[];
  readonly previous: MeetingsSnapshot | null;
  readonly generatedAt: string;
  readonly reconcile: (read: FamilyMemberRead, previousSlice: MeetingsSnapshot | null, windowAnchor: string) => {
    readonly meetings: readonly Meeting[];
    readonly agendaDocuments: MeetingsSnapshot["agendaDocuments"];
    readonly removalEvidence: readonly RoutineRemovalEvidence[];
  };
}): DerivedFamilyBuild {
  const meetings: Meeting[] = [];
  const agendaDocuments: MeetingsSnapshot["agendaDocuments"] = [];
  const removalEvidence: RoutineRemovalEvidence[] = [];
  const heldFacts: { key: string; code: string; detail: string; record?: unknown }[] = [];
  const reports: DerivedFamilyMemberReport[] = [];
  const inputs: DerivedInputRef[] = [input.wiringInput];
  // The door derives its retrieval instant from these exact input times. Use
  // that same instant for every member's reconciliation, even when collection
  // crosses a serving-window boundary. Individual observations keep their times.
  const acceptedReads = input.members.filter(member => member.status === "ACTIVE").flatMap(member => {
    const read = input.reads.find(row => row.member.id === member.id);
    return read && familyMemberReadIssue(read) === null ? [read] : [];
  });
  const windowAnchor = derivedRetrieval([input.wiringInput, ...acceptedReads.flatMap(read => read.acquisitions.map(a => ({
    kind: "MEMBER_ACQUISITION" as const, memberKey: read.member.id, ...a, retrievedAt: read.retrievedAt,
  })))]).retrievedAt ?? input.generatedAt;
  type Acquisition = NonNullable<MeetingsSnapshot["sources"][number]["acquisitions"]>[number];
  const perSource = new Map<string, { fetched: number; normalized: number; acquisitions: Acquisition[] }>();
  const tally = (source: string) => {
    const existing = perSource.get(source);
    if (existing) return existing;
    const fresh = { fetched: 0, normalized: 0, acquisitions: [] as Acquisition[] };
    perSource.set(source, fresh);
    return fresh;
  };

  for (const member of input.members) {
    const source = DERIVED_WIRING_SOURCE_NAMES[member.row.kind];
    const slice = familyMemberSlice(input.previous, member);
    const read = input.reads.find((r) => r.member.id === member.id);
    const issue = member.status === "SUSPENDED"
      ? `suspended for review (${member.suspension?.trigger ?? "trigger unrecorded"}): ${member.suspension?.detail ?? ""}`.trim()
      : read === undefined ? "the member was not read this pass" : familyMemberReadIssue(read);
    const t = tally(source);
    if (issue !== null || read === undefined) {
      /* Held: its last verified sittings are carried, marked, and nothing it read this pass enters. */
      const carried = slice.meetings.map((m) => carriedMember(m, source, input.previous?.generatedAt ?? input.generatedAt));
      meetings.push(...carried);
      agendaDocuments.push(...slice.agendaDocuments);
      heldFacts.push({ key: `derived-member:${member.id}`, code: "DERIVED_MEMBER_HELD_LKG", detail: `${member.id}: ${issue}; ${carried.length} prior sitting(s) retained.`, record: { memberId: member.id, status: member.status } });
      reports.push({ id: member.id, source, bodyId: member.row.bodyId, status: member.status, outcome: "HELD", detail: issue ?? "not read" });
      continue;
    }
    const previousSlice: MeetingsSnapshot | null = input.previous === null ? null : {
      ...input.previous,
      meetings: [...slice.meetings],
      agendaDocuments: [...slice.agendaDocuments],
      derivedMembers: undefined,
    };
    // Failures belong to their own record, not to unrelated members or rows.
    // The same minimum identity/source rules formerly held the whole candidate.
    const usable = read.freshMeetings.filter(meeting => {
      const detail = !meeting.id || !meeting.bodyId || !meeting.provenance?.sourceUrl
        ? "The meeting lacks its exact id, body, or authoritative source URL."
        : meeting.bodyId !== member.row.bodyId || !meeting.id.startsWith(`${source}:`)
          ? "The meeting is not this member's own body/source row."
          : !Number.isFinite(Date.parse(meeting.startsAt)) ? "The meeting has no confirmed date and time." : null;
      if (detail === null) return true;
      heldFacts.push({ key: `meeting:${meeting.id || member.id}`, code: "MEETING_ROW_UNVERIFIED", detail, record: meeting });
      return false;
    });
    const ids = new Set(usable.map(meeting => meeting.id));
    const reconciled = input.reconcile({ ...read, freshMeetings: usable,
      freshAgendaDocuments: read.freshAgendaDocuments.filter(document => ids.has(document.meetingId)) }, previousSlice, windowAnchor);
    meetings.push(...reconciled.meetings);
    agendaDocuments.push(...reconciled.agendaDocuments);
    removalEvidence.push(...reconciled.removalEvidence);
    t.fetched += read.freshMeetings.length;
    t.normalized += usable.length;
    for (const a of read.acquisitions) {
      t.acquisitions.push({ source, requestedUrl: a.requestedUrl, finalUrl: a.finalUrl, httpStatus: a.httpStatus, rawHash: a.rawHash, byteCount: a.byteCount });
      inputs.push({ kind: "MEMBER_ACQUISITION", memberKey: member.id, requestedUrl: a.requestedUrl, finalUrl: a.finalUrl, httpStatus: a.httpStatus, rawHash: a.rawHash, retrievedAt: read.retrievedAt });
    }
    reports.push({ id: member.id, source, bodyId: member.row.bodyId, status: member.status, outcome: "FRESH" });
  }

  const combined = combineMeetings(meetings);
  const carriedCount = combined.meetings.filter((m) => m.carried).length;
  const snapshot: MeetingsSnapshot = {
    formatVersion: 1,
    generatedAt: input.generatedAt,
    counts: { fresh: combined.meetings.length - carriedCount, carried: carriedCount, total: combined.meetings.length,
      duplicatesCollapsed: combined.dropped.filter(row => !row.carried).length },
    sources: [...perSource.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).flatMap(([source, t]) => {
      const answered = t.acquisitions.length > 0;
      const carried = combined.meetings.filter(row => row.carried?.source === source);
      const dropped = combined.dropped.filter(row => row.carried?.source === source);
      const successful = (row: Meeting) => carriedFromAnswer(row.carried?.reason);
      const report = (ok: boolean, rows: Meeting[], collapsed: Meeting[], acquired: boolean) => ({
        source, ok, error: ok ? null : "calendar routes are held on their last verified sittings",
        fetched: acquired ? t.fetched : 0, normalized: acquired ? t.normalized : 0,
        ...(rows.length ? { carriedForward: rows.length } : {}),
        ...(collapsed.length ? { carriedCollapsed: collapsed.length } : {}),
        drops: { placeless: 0, unknownVenue: 0, unplaceableInTime: 0, notConfigured: 0 },
        ...(acquired ? { acquisitions: t.acquisitions } : {}),
      });
      if (!answered) return [report(false, carried, dropped, false)];
      const reports = [report(true, carried.filter(successful), dropped.filter(successful), true)];
      const held = carried.filter(row => !successful(row)), heldDropped = dropped.filter(row => !successful(row));
      if (held.length || heldDropped.length) reports.push(report(false, held, heldDropped, false));
      return reports;
    }),
    meetings: combined.meetings,
    agendaDocuments: [...new Map(agendaDocuments.map(document => [document.id, document])).values()],
    derivedMembers: reports,
  };
  return { snapshot, removalEvidence, heldFacts, inputs };
}

/** The family's candidate: authentic as its wiring version and its members' reads, never as a route. */
export function derivedFamilyCandidate(partition: MeetingPartitionContract, build: DerivedFamilyBuild): RoutineCandidate {
  const { snapshot } = build;
  const retrieval = derivedRetrieval(build.inputs);
  const memberReads = build.inputs.filter((i) => i.kind === "MEMBER_ACQUISITION").length;
  const succeeded = memberReads > 0 && retrieval.retrievedAt !== null;
  const normalized = sha256(canonicalCivicDataJson(snapshot));
  const members = snapshot.derivedMembers ?? [];
  const violations: string[] = [];
  if (snapshot.counts.total !== snapshot.meetings.length || snapshot.counts.fresh + snapshot.counts.carried !== snapshot.counts.total) {
    violations.push("Meeting fresh/carried/total accounting does not reconcile to the projection.");
  }
  if (snapshot.meetings.some((m) => !m.id || !m.bodyId || !m.provenance?.sourceUrl)) violations.push("A meeting lacks an exact meeting id, body id, or authoritative source URL.");
  if (new Set(snapshot.meetings.map((m) => m.id)).size !== snapshot.meetings.length) violations.push("Meeting identifiers are duplicated.");
  if (snapshot.meetings.some((m) => !members.some((member) => member.bodyId === m.bodyId && m.id.startsWith(`${member.source}:`)))) {
    violations.push("A family version holds a row no member accounts for.");
  }
  const sourceThrough = snapshot.meetings
    .map((m) => m.carried?.lastFreshAt ?? m.provenance?.collectedAt ?? "")
    .filter(Boolean).sort().at(-1) ?? snapshot.generatedAt;
  const retrievedAt = retrieval.retrievedAt ?? snapshot.generatedAt;
  return {
    /* Each pass is its own attempt: a pass whose members were all held reads nothing new, so its time names it too. */
    id: `cv-${sha256(`${DERIVED_FAMILY_SOURCE_ID}\u001f${partition.scope}\u001f${retrieval.rawHash}\u001f${retrievedAt}\u001f${snapshot.generatedAt}\u001f${normalized}`).slice(0, 32)}`,
    sourceId: DERIVED_FAMILY_SOURCE_ID,
    recordClass: "MEETING",
    scope: partition.scope,
    sourceProjectionEvidence: sourceProjectionEvidence(DERIVED_FAMILY_SOURCE_ID, "MEETING", partition.scope),
    retrieval: {
      succeeded,
      requestedUrl: derivedRequestedUrl(DERIVED_FAMILY_SOURCE_ID, partition.scope),
      finalUrl: null,
      httpStatus: null,
      retrievedAt,
      rawHash: succeeded ? retrieval.rawHash : null,
      ...(succeeded ? {} : { failureDetail: "No active member of this family was read cleanly this pass; every member keeps its last verified sittings." }),
      derived: { inputs: build.inputs },
    },
    normalization: {
      succeeded: true,
      parserVersion: "meetings-composite/2",
      schemaVersion: `MeetingsSnapshot:${snapshot.formatVersion}`,
      normalizedHash: normalized,
      normalizedPayloadHash: normalized,
      inputRecords: snapshot.meetings.length,
      outputRecords: snapshot.meetings.length,
      droppedRecords: 0,
      missingRequiredFields: snapshot.meetings.some((m) => !m.id || !m.bodyId) ? ["meeting.id/bodyId"] : [],
    },
    identities: snapshot.meetings.map((m) => {
      const state = ocdStateCode(m.ocdId);
      return {
        subjectId: m.id,
        jurisdiction: state ? `US-${state.toUpperCase()}` : "SUPPORTED-BODY-WITHOUT-CENSUS-DIVISION",
        identifiers: { meeting_id: m.id, body_id: m.bodyId ?? "missing", source_route: m.provenance?.sourceUrl ?? "missing" },
        matchBasis: "OFFICIAL_ID" as const,
        ambiguous: false,
      };
    }),
    temporal: { version: snapshot.generatedAt, expectedVersion: snapshot.generatedAt, sourceThrough, staleAtRetrieval: false },
    semantics: { factKind: "public-body meeting and agenda publication", violations },
    horizon: {
      kind: "BOUNDED",
      query: `derived meeting family ${partition.derivedFamily}: ${members.length} reviewed member(s)`,
      returnedRecords: snapshot.meetings.length,
      declaredTotal: snapshot.counts.total,
      paginationComplete: true,
      claimsComplete: false,
    },
    absence: { claimsAbsence: false, basis: "NONE", exactSubject: null, exactHorizon: null },
    dependentChecks: [
      { consumer: "lib/meetings/snapshot.ts", passed: snapshot.counts.total === snapshot.meetings.length, detail: `${snapshot.meetings.length} exact meeting rows.` },
      { consumer: "agenda and Ask", passed: snapshot.agendaDocuments.every((d) => snapshot.meetings.some((m) => m.id === d.meetingId)), detail: `${snapshot.agendaDocuments.length} agenda versions reference a retained meeting.` },
      { consumer: `derived family ${partition.derivedFamily}`, passed: members.length > 0, detail: `${members.filter((m) => m.outcome === "FRESH").length} member(s) read, ${members.filter((m) => m.outcome === "HELD").length} held on their last verified sittings.` },
    ],
    normalizedPayload: snapshot,
    readModel: snapshot,
    removalEvidence: build.removalEvidence,
    excludedFacts: [
      ...build.heldFacts,
      ...snapshot.meetings
        .filter((m) => m.carried?.reason === "UNEXPLAINED_DISAPPEARANCE")
        .map((m) => ({
          key: `meeting:${m.id}`,
          code: "MEETING_UNEXPLAINED_DISAPPEARANCE_RETAINED",
          detail: `${m.id} was absent from an authenticated but incomplete member read and remains on its prior exact fact/LKG evidence.`,
          record: m,
        })),
    ],
  };
}
