import { mergeReaderSittings } from "./sitting-merge.ts";
import { createHash } from "node:crypto";

import { ocdStateCode } from "../ocd/state-of.ts";
import type { Meeting } from "../sources/types.ts";
import type { AgendaDocument } from "./agenda-documents.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import {
  snapshotCounts,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
} from "./snapshot.ts";

export const READER_ARTIFACT_FORMAT_VERSION = 1 as const;

/** The scope for meetings whose OCD division names no state (online/unresolved). */
export const NATIONAL_SCOPE = "us";

/** The 2-letter state (or DC, or territory: `lib/ocd/state-of.ts`) of an OCD division id, or null when it names none. */
export function stateOfOcdId(ocdId: string | null | undefined): string | null {
  return ocdStateCode(ocdId);
}

/** The geographic serving scope a meeting belongs to (its state, else `us`). */
export function scopeOfMeeting(meeting: Meeting): string {
  return stateOfOcdId(meeting.ocdId) ?? NATIONAL_SCOPE;
}

export interface ReaderArtifactCounts {
  readonly fresh: number;
  readonly carried: number;
  readonly total: number;
  readonly duplicatesCollapsed: number;
}

/** One geographic serving artifact — a state's (or the `us` bucket's) meetings. */
export interface ReaderGeoArtifact {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly scope: string;
  readonly ocdId?: string;
  readonly bounds?: ReaderAreaBounds;
  readonly meetingIds?: readonly string[];
  readonly agendaOnly?: boolean;
  readonly generatedAt: string;
  readonly counts: ReaderArtifactCounts;
  readonly meetings: Meeting[];
  readonly agendaDocuments: AgendaDocument[];
}

/** The manifest's record of one published scope artifact. */
export interface ReaderManifestScope {
  readonly scope: string;
  readonly ocdId?: string;
  readonly bounds?: ReaderAreaBounds;
  readonly meetingIds?: readonly string[];
  readonly agendaOnly?: boolean;
  /** Immutable, content-addressed artifact key. */
  readonly key: string;
  readonly sha256: string;
  readonly meetingCount: number;
  readonly generatedAt: string;
}

export interface ReaderAreaBounds {
  readonly south: number;
  readonly north: number;
  readonly west: number;
  readonly east: number;
}

/** A jurisdiction piece is shared by every ZIP in that division. */
export function meetingAreaScope(ocdId: string | null | undefined): string {
  const division = ocdId?.split("#")[0];
  return division?.startsWith("ocd-division/")
    ? `area-${stateOfOcdId(division) ?? NATIONAL_SCOPE}-${sha256OfJson(division).slice(0, 24)}`
    : NATIONAL_SCOPE;
}

export function readerScopeApplies(
  scope: Pick<ReaderManifestScope, "scope" | "ocdId" | "bounds" | "meetingIds" | "agendaOnly">,
  area: { readonly states?: readonly string[]; readonly ocdIds?: readonly string[];
    readonly meetingId?: string; readonly includeAgenda?: boolean;
    readonly nearby?: { readonly lat: number; readonly lng: number; readonly radiusKm: number } },
): boolean {
  if (area.includeAgenda === false && scope.agendaOnly) return false;
  if (area.meetingId) return scope.meetingIds ? scope.meetingIds.includes(area.meetingId) : true;
  if (scope.scope === NATIONAL_SCOPE || scope.scope === `${NATIONAL_SCOPE}-agenda` || scope.ocdId && stateOfOcdId(scope.ocdId) === null) return true;
  if (!scope.ocdId) return !area.states || scopesForStates(area.states).includes(scope.scope);
  if (!area.ocdIds?.length) return !area.states || area.states.some(state => state.toLowerCase() === stateOfOcdId(scope.ocdId));
  if (area.ocdIds.some(id => id.split("#")[0] === scope.ocdId)) return true;
  const point = area.nearby;
  const bounds = scope.bounds;
  if (!point || !bounds) return false;
  const latDelta = point.radiusKm / 110;
  const lngDelta = point.radiusKm / (110 * Math.max(0.01, Math.cos(Math.min(90, Math.abs(point.lat) + latDelta) * Math.PI / 180)));
  // A generous enclosing box preserves every radius-ladder candidate. Account
  // for the date line by comparing the equivalent longitudes on either side.
  return bounds.north >= point.lat - latDelta && bounds.south <= point.lat + latDelta &&
    [-360, 0, 360].some(shift => bounds.east + shift >= point.lng - lngDelta && bounds.west + shift <= point.lng + lngDelta);
}

export interface ReaderManifest {
  /** Missing on the former state layout; the normal publisher replaces it once. */
  readonly meetingLayout?: "governing-area";
  /** Registry version used for canonical body areas; absent on single-area copies. */
  readonly meetingRegistryVersion?: string | null;
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly sequence: number;
  readonly generatedAt: string;
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
  /** National per-source accounting the footer reads (shared across scopes). */
  readonly sources: SnapshotSourceReport[];
  readonly scopes: readonly ReaderManifestScope[];
  readonly commentAccess?: readonly unknown[];
  readonly everydayRouting?: unknown;
  /** Pointer identities for the embedded serving copies; old manifests refresh once. */
  readonly extrasVersionIds?: Readonly<Partial<Record<"comment-access" | "everyday-routing", string | null>>>;
  readonly authorityArtifacts?: Partial<Record<AuthorityFamily, AuthorityArtifactRef>>;
  readonly registrations?: Readonly<Record<string, AuthorityArtifactRef>>;
  /** Legislative people loaded separately for each requested jurisdiction. */
  readonly stateLegislators?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly translations?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly freshChecks?: Readonly<Record<string, string>>;
  readonly composition?: string;
}

/** Each artifact carries one or more proven pointers whole, read through each pointer's own typed Reader. */
export type PromotedAuthorityFamily =
  | "ballot-contests"
  | "ballot-az"
  | "ballot-nh"
  | "candidate-profiles"
  | "candidate-publications"
  | "ballot-navigation"
  | "voting-sites"
  | "official-filings"
  | "member-offices"
  | "nh-members"
  | "federal-funding"
  | "state-money"
  | "pima-finance"
  | "federal-votes"
  | "federal-key-votes"
  | "officeholder-statements"
  | "prl-archives"
  | "executive-actions"
  | "government-domains";

export const PROMOTED_AUTHORITY_FAMILIES: readonly PromotedAuthorityFamily[] = [
  "ballot-contests",
  "ballot-az",
  "ballot-nh",
  "candidate-profiles",
  "candidate-publications",
  "ballot-navigation",
  "voting-sites",
  "official-filings",
  "member-offices",
  "nh-members",
  "federal-funding",
  "state-money",
  "pima-finance",
  "federal-votes",
  "federal-key-votes",
  "officeholder-statements",
  "prl-archives",
  "executive-actions",
  "government-domains",
];

/** A proven-pointer family's artifact value: every pointer the family names, each proven or answered absent. */
export interface PromotedFamilyArtifactValue {
  readonly kind: "PROMOTED_POINTERS";
  readonly entries: readonly PromotedEdgeEntry[];
}

export function isPromotedAuthorityFamily(family: AuthorityFamily): family is PromotedAuthorityFamily {
  return (PROMOTED_AUTHORITY_FAMILIES as readonly string[]).includes(family);
}

export type AuthorityFamily =
  | "census-districts"
  | "registry-runtime"
  | "federal-directory"
  | "campaign-sites"
  | "state-legislators"
  | "plain-english-translations"
  | "meeting-outcomes"
  | "comment-access"
  | PromotedAuthorityFamily;

export const AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "census-districts",
  "registry-runtime",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
  "plain-english-translations",
  "meeting-outcomes",
  "comment-access",
  ...PROMOTED_AUTHORITY_FAMILIES,
];

export interface AuthorityArtifactRef {
  readonly key: string;
  readonly version: string;
  readonly sha: string;
}

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function countsFor(meetings: readonly Meeting[]): ReaderArtifactCounts {
  const base = snapshotCounts(meetings, 0);
  return { fresh: base.fresh, carried: base.carried, total: base.total, duplicatesCollapsed: 0 };
}

export function partitionSnapshotByScope(
  snapshot: MeetingsSnapshot,
  now: string = new Date().toISOString(),
  bodies: readonly { readonly id: string; readonly ocdId: string | null; readonly alsoServesOcdIds?: readonly string[] }[] = [],
): ReaderGeoArtifact[] {
  const byBody = new Map(bodies.map(body => [body.id, body]));
  const meetingScope = new Map<string, readonly { scope: string; ocdId?: string }[]>();
  const byScope = new Map<string, { meetings: Meeting[]; agenda: AgendaDocument[]; ocdId?: string }>();
  const bucket = (scope: string, ocdId?: string) => {
    let b = byScope.get(scope);
    if (!b) { b = { meetings: [], agenda: [], ...(ocdId ? { ocdId } : {}) }; byScope.set(scope, b); }
    return b;
  };

  for (const meeting of snapshot.meetings) {
    const body = meeting.bodyId ? byBody.get(meeting.bodyId) : undefined;
    const divisions = [...new Set([body?.ocdId ?? meeting.ocdId, ...(body?.alsoServesOcdIds ?? [])]
      .map(id => id?.split("#")[0] ?? null))];
    const areas = divisions.map(ocdId => ({ scope: meetingAreaScope(ocdId), ...(ocdId ? { ocdId } : {}) }));
    meetingScope.set(meeting.id, areas);
    for (const area of areas) bucket(area.scope, area.ocdId).meetings.push(meeting);
  }
  for (const doc of snapshot.agendaDocuments) {
    const areas = meetingScope.get(doc.meetingId) ?? [{ scope: meetingAreaScope(doc.ocdId), ocdId: doc.ocdId?.split("#")[0] }];
    for (const area of areas) bucket(area.scope, area.ocdId ?? undefined).agenda.push(doc);
  }

  return [...byScope.keys()].sort().flatMap((scope) => {
    const { meetings, agenda, ocdId } = byScope.get(scope)!;
    const locations = meetings.flatMap(meeting => meeting.location && Number.isFinite(meeting.location.lat) && Number.isFinite(meeting.location.lng) ? [meeting.location] : []);
    const bounds = locations.reduce<ReaderAreaBounds | undefined>((held, point) => ({
      south: Math.min(held?.south ?? point.lat, point.lat), north: Math.max(held?.north ?? point.lat, point.lat),
      west: Math.min(held?.west ?? point.lng, point.lng), east: Math.max(held?.east ?? point.lng, point.lng),
    }), undefined);
    const artifact: ReaderGeoArtifact = {
      formatVersion: READER_ARTIFACT_FORMAT_VERSION,
      scope,
      ...(scope !== NATIONAL_SCOPE && ocdId ? { ocdId } : {}),
      ...(bounds ? { bounds } : {}),
      meetingIds: [...new Set([...meetings.flatMap(meeting => [meeting.id, ...(meeting.mergedMeetingIds ?? [])]), ...agenda.map(doc => doc.meetingId)])].sort(),
      generatedAt: snapshot.generatedAt || now,
      counts: countsFor(meetings),
      meetings,
      agendaDocuments: [],
    };
    return [
      ...(meetings.length ? [artifact] : []),
      ...(agenda.length ? [{ ...artifact, scope: `${scope}-agenda`, agendaOnly: true,
        meetings: [], counts: countsFor([]), agendaDocuments: agenda }] : []),
    ];
  });
}

/** The scopes a reader at these states needs: each state plus the `us` bucket. */
export function scopesForStates(states: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const s of states) {
    const st = typeof s === "string" ? s.trim().toLowerCase() : "";
    if (/^[a-z]{2}$/.test(st)) set.add(st);
  }
  set.add(NATIONAL_SCOPE);
  return [...set].sort();
}

export function mergeScopeArtifacts(
  artifacts: readonly ReaderGeoArtifact[],
  manifest: Pick<ReaderManifest, "generatedAt" | "sources">,
): MeetingsSnapshot {
  const meetingsById = new Map<string, Meeting>();
  const agendaById = new Map<string, AgendaDocument>();
  for (const artifact of artifacts) {
    for (const meeting of artifact.meetings) if (!meetingsById.has(meeting.id)) meetingsById.set(meeting.id, meeting);
    for (const doc of artifact.agendaDocuments) if (!agendaById.has(doc.id)) agendaById.set(doc.id, doc);
  }
  const merged = mergeReaderSittings([...meetingsById.values()]);
  const meetings = merged.rows;
  return {
    formatVersion: 1,
    generatedAt: manifest.generatedAt,
    counts: snapshotCounts(meetings, 0),
    sources: [...manifest.sources],
    meetings,
    agendaDocuments: [...agendaById.values()].map(document => ({ ...document, meetingId: merged.aliases.get(document.meetingId) ?? document.meetingId })),
  };
}
