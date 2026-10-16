import { createHash } from "node:crypto";

import type { MeetingDocumentChecks } from "./document-checks.ts";
import type { Meeting } from "../sources/types.ts";
import type { UnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import type { MeetingsSnapshot, SnapshotSourceReport } from "./snapshot.ts";

export interface MeetingPartitionFreshCheck {
  /** The route of every fresh (not carried) row the version holds, sorted. */
  readonly routes: readonly string[];
  /** The newest successful fresh check that found nothing new, when later than the version's own; null when none. */
  readonly checkedAt: string | null;
}

export function meetingRouteKey(meeting: Pick<Meeting, "id" | "bodyId">): string | null {
  const colon = meeting.id.indexOf(":");
  if (colon <= 0) return null;
  return `${meeting.id.slice(0, colon)}|${meeting.bodyId ?? ""}`;
}

export function meetingVersionReadsASource(sources: readonly Pick<SnapshotSourceReport, "ok">[]): boolean {
  return sources.some((source) => source.ok === true);
}

function instant(value: string | null | undefined): number {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NaN;
}

export function laterCheck(left: string | null | undefined, right: string | null | undefined): string | null {
  const l = instant(left);
  const r = instant(right);
  if (!Number.isFinite(l)) return Number.isFinite(r) ? right! : null;
  if (!Number.isFinite(r)) return left!;
  return r > l ? right! : left!;
}

export function confirmationCheckedAt(
  confirmation: Pick<UnchangedConfirmation, "versionId" | "retrieval"> | null | undefined,
  versionId: string | null | undefined,
  readsASource: boolean,
): string | null {
  if (!readsASource || !confirmation || !versionId || confirmation.versionId !== versionId) return null;
  const checkedAt = confirmation.retrieval.sourceCheck?.checkedAt ?? confirmation.retrieval.retrievedAt;
  return Number.isFinite(instant(checkedAt)) ? checkedAt : null;
}

/** The fresh-row routes of one partition version, or null when the version reads no source. */
export function meetingVersionRoutes(snapshot: Pick<MeetingsSnapshot, "meetings" | "sources">): readonly string[] | null {
  if (!meetingVersionReadsASource(snapshot.sources)) return null;
  const routes = new Set<string>();
  for (const meeting of snapshot.meetings) {
    if (meeting.carried) continue;
    const route = meetingRouteKey(meeting);
    if (route !== null) routes.add(route);
  }
  return [...routes].sort();
}

/** A fresh row, restamped with a later successful check of its route; the row itself when the check is not later. */
function restamped(meeting: Meeting, checkedAt: string | undefined): Meeting {
  if (checkedAt === undefined || meeting.carried) return meeting;
  const collectedAt = meeting.provenance?.collectedAt;
  // A row that states no collection instant is not given one.
  if (!Number.isFinite(instant(collectedAt)) || instant(checkedAt) <= instant(collectedAt)) return meeting;
  return { ...meeting, provenance: { ...meeting.provenance, collectedAt: checkedAt } };
}

export function applyMeetingFreshChecks(
  snapshot: MeetingsSnapshot,
  checks: { readonly checkedAt: string | null; readonly routes: Readonly<Record<string, string>> },
): MeetingsSnapshot {
  const generatedAt = laterCheck(snapshot.generatedAt, checks.checkedAt) ?? snapshot.generatedAt;
  let changed = generatedAt !== snapshot.generatedAt;
  const meetings = snapshot.meetings.map((meeting) => {
    const route = meeting.carried ? null : meetingRouteKey(meeting);
    const next = route === null ? meeting : restamped(meeting, checks.routes[route]);
    if (next !== meeting) changed = true;
    return next;
  });
  return changed ? { ...snapshot, generatedAt, meetings } : snapshot;
}

export function applyDocumentFreshChecks(snapshot: MeetingsSnapshot, checks: MeetingDocumentChecks | undefined): MeetingsSnapshot {
  if (!checks) return snapshot;
  const byIdentity = new Map(checks.documents.flatMap(check => check.contentHash && check.checkedAt
    ? [[`${check.url}|${check.contentHash}`, check] as const] : []));
  const meetingById = new Map(snapshot.meetings.map(meeting => [meeting.id, meeting]));
  let changed = false;
  const agendaDocuments = snapshot.agendaDocuments.map(document => {
    const meeting = meetingById.get(document.meetingId);
    const check = byIdentity.get(`${document.documentUrl}|${document.contentHash}`) ?? byIdentity.get(`${meeting?.agendaUrl}|${document.contentHash}`);
    if (!check || check.url !== document.documentUrl && check.url !== meeting?.agendaUrl ||
      Date.parse(check.checkedAt!) <= Date.parse(document.retrievedAt)) return document;
    changed = true;
    return { ...document, retrievedAt: check.checkedAt! };
  });
  const meetings = snapshot.meetings.map(meeting => {
    let documentChanged = false;
    const publishedDocuments = meeting.publishedDocuments?.map(document => {
      const check = byIdentity.get(`${document.url}|${document.contentHash}`);
      if (!check || check.url !== document.url || Date.parse(check.checkedAt!) <= Date.parse(document.checkedAt)) return document;
      documentChanged = true;
      return { ...document, checkedAt: check.checkedAt! };
    });
    if (!documentChanged) return meeting;
    changed = true;
    return { ...meeting, publishedDocuments };
  });
  return changed ? { ...snapshot, agendaDocuments, meetings } : snapshot;
}

export function applyPartitionFreshCheck(snapshot: MeetingsSnapshot, checkedAt: string | null): MeetingsSnapshot {
  if (checkedAt === null) return snapshot;
  const routes: Record<string, string> = {};
  for (const meeting of snapshot.meetings) {
    const route = meetingRouteKey(meeting);
    if (route !== null) routes[route] = checkedAt;
  }
  return applyMeetingFreshChecks(snapshot, { checkedAt, routes });
}

/** A coupled partition version, as the prepared serving copy records it, with its check when it has one. */
export interface FreshCheckCoupling {
  readonly contractId: string;
  readonly versionId: string;
  /** Present only for a version that reads a source (`meetingVersionRoutes`). */
  readonly routes?: readonly string[];
  readonly checkedAt?: string | null;
}

export function meetingFreshChecks(couplings: readonly FreshCheckCoupling[]): {
  readonly checkedAt: string | null;
  readonly routes: Readonly<Record<string, string>>;
} {
  let checkedAt: string | null = null;
  const owners = new Map<string, number>();
  for (const coupling of couplings) {
    for (const route of coupling.routes ?? []) owners.set(route, (owners.get(route) ?? 0) + 1);
  }
  const routes: Record<string, string> = {};
  for (const coupling of couplings) {
    if (coupling.routes === undefined || !coupling.checkedAt) continue;
    checkedAt = laterCheck(checkedAt, coupling.checkedAt);
    for (const route of coupling.routes) {
      if (owners.get(route) === 1) routes[route] = coupling.checkedAt;
    }
  }
  return { checkedAt, routes: Object.fromEntries(Object.entries(routes).sort(([left], [right]) => left.localeCompare(right))) };
}

export function sameMeetingFreshChecks(
  left: Readonly<Record<string, string>> | undefined,
  right: Readonly<Record<string, string>> | undefined,
): boolean {
  const l = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const r = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return l.length === r.length && l.every(([route, at], index) => r[index]![0] === route && r[index]![1] === at);
}

export function meetingCompositionId(couplings: readonly Pick<FreshCheckCoupling, "contractId" | "versionId">[]): string {
  const fingerprint = couplings.map((entry) => `${entry.contractId}=${entry.versionId}`).sort().join("|");
  return createHash("sha256").update(fingerprint).digest("hex");
}
