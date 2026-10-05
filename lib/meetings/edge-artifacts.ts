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

/**
 * **The permanent reader serving model (PDC-9, 2026-09-15) — geographic edge artifacts.**
 *
 * PDC composes the promoted meeting partitions once (see prepared-snapshot.ts).
 * This module splits that one national composition into REUSABLE GEOGRAPHIC
 * artifacts — one per governing division, with agenda text in its own piece.
 * Every ZIP in a division shares those pieces; the map reads calendar pieces
 * for its divisions and nearby venues, and Ask and agenda read their area.
 *
 * The artifacts are immutable and content-addressed by the publication sequence;
 * a small manifest names the current sequence and the available scopes. The
 * reader looks up which scopes a ZIP needs, fetches those artifacts from the
 * edge, and merges them back into the exact `MeetingsSnapshot` shape the search
 * and freshness code already consume — so nothing downstream of the read
 * changes. The promoted partitions stay the sole authoritative civic truth
 * (RULING 282); these are serving copies of them (RULING 283).
 *
 * Nothing here is hardcoded to today's pilot ZIPs: the partition key is the
 * meeting's own OCD division, so adding a state is adding promoted data, never
 * editing this file.
 */
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
  /** Content-addressed blob key: `reader/v<sequence>/meetings-<scope>.json`. */
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

/** Old state artifacts remain readable while the runner publishes area pieces. */
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

/**
 * The tiny mutable pointer. The reader reads THIS (short-TTL, edge-cached) to
 * learn the current sequence and which immutable scope artifacts to fetch.
 * `sequence` is monotonic: a publish never lowers it, so an older composition
 * can never replace a newer one.
 */
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
  /**
   * The other ready-to-display reader families the /api/meetings response
   * carries, embedded so the reader serves them from the edge instead of waking
   * the database per visit. Typed loosely here to keep this module free of the
   * comment-access / routing type graph; the reader casts them. Absent → the
   * reader falls back to reading that family from the DB.
   */
  readonly commentAccess?: readonly unknown[];
  readonly everydayRouting?: unknown;
  /** Pointer identities for the embedded serving copies; old manifests refresh once. */
  readonly extrasVersionIds?: Readonly<Partial<Record<"comment-access" | "everyday-routing", string | null>>>;
  /**
   * The large "authority" reader families — the map's division/coverage/roster
   * bindings (registry-runtime, ~3.7 MB), the federal directory (~1.2 MB) and
   * the campaign-site URLs. Each is too large to embed in the manifest (which
   * the reader reads every request), so the manifest POINTS at a separate,
   * gzip-compressed, immutable artifact per family; the reader fetches each once
   * per version (module-cached) and primes it request-scoped, never waking the
   * database for an ordinary visitor.
   *
   * 2026-09-24 (C20): the recorded meeting outcomes (~1.6 MB, the pole of a cold
   * Ask at 2.0–2.3 s from the database) and the comment-access rules (0.6–0.8 s)
   * are families too, so a cold topic question reads them in the same parallel
   * edge fetch as the registry instead of as two cold database reads.
   */
  readonly authorityArtifacts?: Partial<Record<AuthorityFamily, AuthorityArtifactRef>>;
  /**
   * **Each state's promoted REGISTRATION (`lib/registration/`), one artifact per
   * state** (2026-09-24). Registration is per state by construction (82.6 MB for
   * all 56, the largest about 5 MB), so it is never one national artifact: the
   * reader fetches only the states a request's divisions name, once per version.
   * The runner writes a state's artifact only after its registration pointer
   * promotes, and carries every unchanged state's reference forward.
   *
   * Present, it is complete: a state it does not name has no promoted
   * registration, and the reader composes nothing for it without waking the
   * database. Absent (the family was never published), the reader reads the
   * state from the database.
   */
  readonly registrations?: Readonly<Record<string, AuthorityArtifactRef>>;
  /**
   * **Quiet re-checks, applied when served** (2026-09-25, lib/meetings/fresh-checks.ts).
   * Each route's (`<adapter>|<bodyId>`) newest successful fresh check that found
   * nothing new since its rows were written. The reader restamps that route's
   * fresh rows with it; carried rows never. `generatedAt` above already states
   * the newest check as "Last checked". Absent: no check since the artifacts.
   */
  readonly freshChecks?: Readonly<Record<string, string>>;
  /**
   * The partition versions these scope artifacts were composed from
   * (`meetingCompositionId`): how the runner tells a quiet re-check, which
   * republishes this manifest alone, from new data, which republishes the
   * scopes. Absent on manifests written before it.
   */
  readonly composition?: string;
}

/**
 * **THE PROVEN-POINTER FAMILIES** (2026-09-25). Each artifact carries one or
 * more proven pointers whole (`PromotedEdgeEntry`, lib/civic-data/read-model.ts)
 * and is read through each pointer's own typed Reader. A cold /ballot read the
 * first eight from the database, in two stages (the ballot, then the rest);
 * a cold Ask read all of them among its deferrable sources (14.8 s measured
 * on production for one cold Mesa question, 2026-09-25).
 */
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
  | "executive-actions";

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
  "executive-actions",
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
  | "comment-access"
  | PromotedAuthorityFamily;

export const AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "census-districts",
  "registry-runtime",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
  "meeting-outcomes",
  "comment-access",
  ...PROMOTED_AUTHORITY_FAMILIES,
];

export interface AuthorityArtifactRef {
  readonly key: string;
  readonly version: string;
  readonly sha: string;
}

export function artifactKey(sequence: number, scope: string): string {
  return `reader/v${sequence}/meetings-${scope}.json`;
}

/** The gzip-compressed artifact key for one authority family at a sequence. */
export function authorityArtifactKey(sequence: number, family: AuthorityFamily): string {
  return `reader/v${sequence}/${family}.json.gz`;
}

/** One state's registration artifact, immutable within its manifest sequence. */
export function registrationArtifactKey(sequence: number, state: string): string {
  return `reader/v${sequence}/registration-${state.toLowerCase()}.json.gz`;
}

export function sha256OfJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function countsFor(meetings: readonly Meeting[]): ReaderArtifactCounts {
  const base = snapshotCounts(meetings, 0);
  return { fresh: base.fresh, carried: base.carried, total: base.total, duplicatesCollapsed: 0 };
}

/**
 * Split one composed national snapshot into per-scope artifacts, deterministic
 * and order-stable. A meeting's scope is its governing division; an agenda
 * stays in its meeting's area, even when its own geography differs. Agenda
 * text is separate so a calendar read never fetches it. Counts
 * are honest for the subset (the strict cross-source write-boundary invariant
 * does not apply to a serving projection, and the reader never re-checks it).
 */
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

/**
 * Merge the fetched scope artifacts back into one `MeetingsSnapshot`, exactly
 * the shape `searchMeetings`/`snapshotClientMeta` consume. Meetings are
 * de-duplicated by id (a meeting can only be in one scope, but the merge is
 * defensive), agenda documents by id. The national `sources` accounting comes
 * from the manifest so the footer's failed-source attribution stays complete
 * even when only one state's meetings are loaded.
 */
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
