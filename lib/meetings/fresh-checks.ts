
import type { Meeting } from "../sources/types.ts";
import type { UnchangedConfirmation } from "../civic-data/unchanged-confirmation.ts";
import type { MeetingsSnapshot, SnapshotSourceReport } from "./snapshot.ts";

/**
 * The route a row was read through: its adapter (the id's namespace) and body.
 * Null for an id without a namespace, which no check is applied to.
 */
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

/**
 * The successful fresh check a confirmation records for `versionId`, or null:
 * only a confirmation of that exact version, and only for a version that reads
 * a source (`readsASource`).
 */
export function confirmationCheckedAt(
  confirmation: Pick<UnchangedConfirmation, "versionId" | "retrieval"> | null | undefined,
  versionId: string | null | undefined,
  readsASource: boolean,
): string | null {
  if (!readsASource || !confirmation || !versionId || confirmation.versionId !== versionId) return null;
  return Number.isFinite(instant(confirmation.retrieval.retrievedAt)) ? confirmation.retrieval.retrievedAt : null;
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

/**
 * A snapshot with later successful checks applied: `generatedAt` ("Last checked")
 * becomes the later of its own and `checkedAt`, and each fresh row whose route has
 * a later check is restamped with it. Carried rows, sources, counts and every fact
 * are untouched. The snapshot itself when nothing is later, so an unchanged serve
 * stays the same object.
 */
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

/**
 * What the serving copy and the edge apply for a set of coupled versions:
 * `checkedAt`, the newest check of any version that reads a source (the footer's
 * "Last checked" floor), and each route's newest check. A route two versions both
 * hold is left out: it cannot be told which version's check its rows had, and a
 * row is never stamped fresher than it is proven.
 */
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
