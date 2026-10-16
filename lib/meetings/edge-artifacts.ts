import { createHash } from "node:crypto";

import { ocdStateCode } from "../ocd/state-of.ts";
import type { Meeting } from "../sources/types.ts";
import type { AgendaDocument } from "./agenda-documents.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import { mergeReaderSittings } from "./sitting-merge.ts";
import {
  snapshotCounts,
  type MeetingsSnapshot,
  type SnapshotSourceReport,
  type SnapshotCarriedMeta,
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
  readonly meetingOrder: readonly number[];
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly scope: string;
  readonly ocdId?: string;
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
  readonly meetingIds?: readonly string[];
  readonly agendaOnly?: boolean;
  /** Immutable, content-addressed artifact key. */
  readonly key: string;
  readonly sha256: string;
  readonly meetingCount: number;
  readonly generatedAt: string;
}

/** A jurisdiction piece is shared by every ZIP in that division. */
export function meetingAreaScope(ocdId: string | null | undefined): string {
  const division = ocdId?.split("#")[0];
  return division?.startsWith("ocd-division/")
    ? `area-${stateOfOcdId(division) ?? NATIONAL_SCOPE}-${sha256OfJson(division).slice(0, 24)}`
    : NATIONAL_SCOPE;
}

export function readerScopeApplies(
  scope: Pick<ReaderManifestScope, "scope" | "ocdId" | "meetingIds" | "agendaOnly">,
  area: { readonly states?: readonly string[]; readonly ocdIds?: readonly string[];
    readonly meetingId?: string; readonly includeAgenda?: boolean; },
): boolean {
  if (area.includeAgenda === false && scope.agendaOnly) return false;
  if (area.meetingId) return scope.meetingIds ? scope.meetingIds.includes(area.meetingId) : true;
  if (scope.scope === NATIONAL_SCOPE || scope.scope === `${NATIONAL_SCOPE}-agenda` || scope.ocdId && stateOfOcdId(scope.ocdId) === null) return true;
  if (!scope.ocdId) return !area.states || scopesForStates(area.states).includes(scope.scope);
  if (!area.ocdIds) return !area.states || area.states.some(state => state.toLowerCase() === stateOfOcdId(scope.ocdId));
  return area.ocdIds.some(id => id.split("#")[0] === scope.ocdId);
}

export interface ReaderManifest {
  readonly carriedSummary?: SnapshotCarriedMeta;
  readonly meetingPlaces?: Readonly<Record<string, readonly string[]>>;
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

  readonly freshChecks?: Readonly<Record<string, string>>;

  readonly composition?: string;
}

export interface ReaderAuthorityManifest {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly sequence: number;
  readonly generatedAt: string;
  readonly authorityArtifacts?: Partial<Record<GlobalAuthorityFamily, AuthorityArtifactRef>>;
  readonly stateFacts?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly stateAuthorities?: Partial<Record<StateAuthorityFamily, Readonly<Record<string, AuthorityArtifactRef>>>>;
  readonly registrations?: Readonly<Record<string, AuthorityArtifactRef>>;
  readonly stateLegislators?: Readonly<Record<string, AuthorityArtifactRef>>;
}

export const STATE_AUTHORITY_FAMILIES = ["ballot-contests", "candidate-profiles", "candidate-publications", "voting-sites", "candidate-campaign-sites-derived"] as const;
export type StateAuthorityFamily = typeof STATE_AUTHORITY_FAMILIES[number];
export type GlobalAuthorityFamily = Exclude<AuthorityFamily, StateAuthorityFamily | "state-legislators">;
export type GlobalPromotedAuthorityFamily = Exclude<PromotedAuthorityFamily, StateAuthorityFamily>;
export function isStateAuthorityFamily(family: string): family is StateAuthorityFamily {
  return (STATE_AUTHORITY_FAMILIES as readonly string[]).includes(family);
}

/** Each artifact carries one or more proven pointers whole, read through each pointer's own typed Reader. */
export type PromotedAuthorityFamily =
  | "other-reader-data"
  | "state-votes"
  | "candidate-campaign-sites-derived"
  | "ballot-contests"
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
  | "prl-profiles"
  | "executive-actions"
  | "government-domains";

export const PROMOTED_AUTHORITY_FAMILIES: readonly PromotedAuthorityFamily[] = [
  "other-reader-data",
  "state-votes",
  "candidate-campaign-sites-derived",
  "ballot-contests",
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
  "prl-profiles",
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
  | "meeting-outcomes"
  | "everyday-routing"
  | PromotedAuthorityFamily;

export const AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "census-districts",
  "registry-runtime",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
  "meeting-outcomes",
  "everyday-routing",
  ...PROMOTED_AUTHORITY_FAMILIES,
];

export interface AuthorityArtifactRef {
  readonly layout?: "records";
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
  const order = new Map(snapshot.meetings.map((meeting, index) => [meeting.id, index]));
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
    const artifact: ReaderGeoArtifact = {
      formatVersion: READER_ARTIFACT_FORMAT_VERSION,
      scope,
      ...(scope !== NATIONAL_SCOPE && ocdId ? { ocdId } : {}),
      meetingIds: [...new Set([...meetings.flatMap(meeting => [meeting.id, ...(meeting.mergedMeetingIds ?? [])]), ...agenda.map(doc => doc.meetingId)])].sort(),
      generatedAt: snapshot.generatedAt || now,
      counts: countsFor(meetings),
      meetings,
      meetingOrder: meetings.map(meeting => order.get(meeting.id)!),
      agendaDocuments: [],
    };
    return [
      ...(meetings.length ? [artifact] : []),
      ...(agenda.length ? [{ ...artifact, scope: `${scope}-agenda`, agendaOnly: true,
        meetings: [], meetingOrder: [], counts: countsFor([]), agendaDocuments: agenda }] : []),
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
  const order = new Map<string, number>();
  const agendaById = new Map<string, AgendaDocument>();
  for (const artifact of artifacts) {
    for (const [index, meeting] of artifact.meetings.entries()) if (!meetingsById.has(meeting.id)) {
      meetingsById.set(meeting.id, meeting);
      order.set(meeting.id, artifact.meetingOrder[index]);
    }
    for (const doc of artifact.agendaDocuments) if (!agendaById.has(doc.id)) agendaById.set(doc.id, doc);
  }
  const merged = mergeReaderSittings([...meetingsById.values()].sort((left, right) => order.get(left.id)! - order.get(right.id)!));
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
