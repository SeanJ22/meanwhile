import { createHash } from "node:crypto";
import { stateBallotScope } from "../ballot/state-scopes.ts";
import { registerIntegrityCheckedEdgeEntries } from "../civic-data/read-model.ts";
import { gzipSync, gunzipSync } from "node:zlib";

import {
  mergeScopeArtifacts,
  partitionSnapshotByScope,
  readerScopeApplies,
  scopesForStates,
  sha256OfJson,
  AUTHORITY_FAMILIES,
  STATE_AUTHORITY_FAMILIES,
  isStateAuthorityFamily,
  type StateAuthorityFamily,
  type GlobalAuthorityFamily,
  type GlobalPromotedAuthorityFamily,
  PROMOTED_AUTHORITY_FAMILIES,
  READER_ARTIFACT_FORMAT_VERSION,
  type AuthorityArtifactRef,
  type AuthorityFamily,
  type PromotedFamilyArtifactValue,
  type ReaderGeoArtifact,
  type ReaderManifest,
  type ReaderAuthorityManifest,
  type ReaderManifestScope,
} from "./edge-artifacts.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
import type { CommentAccess, CommentAccessProjection } from "../registry/comment-access.ts";
import type { EverydayRoutingProjection } from "../routing/everyday.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import type { CensusDistrictEdge } from "../census-geography/district-edge.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import {
  resolveReaderArtifactStore,
  resolveReaderArtifactWriteStore,
  type ReaderArtifactStore,
} from "./edge-store.ts";
import {
  readPreparedMeetingsProjection,
} from "./prepared-snapshot.ts";
import { applyMeetingFreshChecks, laterCheck, sameMeetingFreshChecks } from "./fresh-checks.ts";
import {
  MEETINGS_RECORD_CLASS,
  MEETINGS_SCOPE,
  MEETINGS_SOURCE_ID,
  snapshotCounts,
  type MeetingsProjectionReadResult,
  type MeetingsSnapshot,
} from "./snapshot.ts";
import type { MeetingSettings } from "./settings.ts";
import { readReaderMeetingSettings } from "./reader-settings.ts";

export async function purgeReaderCacheTags(
  tags: readonly string[],
): Promise<{ readonly purged: boolean; readonly detail?: string }> {
  const siteID = process.env.NETLIFY_SITE_ID?.trim() || process.env.NETLIFY_BLOBS_SITE_ID?.trim();
  const token = process.env.NETLIFY_API_TOKEN?.trim() || process.env.NETLIFY_BLOBS_TOKEN?.trim();
  if (!siteID || !token || tags.length === 0) return { purged: false, detail: "no purge credentials or tags" };
  try {
    const res = await fetch("https://api.netlify.com/api/v1/purge", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: siteID, cache_tags: [...tags] }),
    });
    return res.ok ? { purged: true } : { purged: false, detail: `purge HTTP ${res.status}` };
  } catch (error) {
    return { purged: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export const READER_MANIFEST_CACHE_TAG = "reader-manifest";

export type PublishReaderEdgeResult =
  | { readonly status: "PUBLISHED"; readonly sequence: number; readonly scopes: number; readonly meetings: number }
  | { readonly status: "CURRENT"; readonly sequence: number; readonly scopes: number }
  | { readonly status: "RACED"; readonly sequence: number }
  | { readonly status: "SKIPPED_NO_STORE" }
  | { readonly status: "NOT_COMPOSABLE"; readonly detail: string }
  | { readonly status: "FAILED"; readonly error: string };

export interface PublishMetadata {
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  readonly promotedThrough: string | null;
}

export interface PublishReaderChecks {
  readonly composition: string;
  readonly freshChecks: Readonly<Record<string, string>>;
}

function manifestStatesChecks(manifest: ReaderManifest, generatedAt: string, checks: PublishReaderChecks | undefined): boolean {
  return manifest.generatedAt === generatedAt &&
    (manifest.composition ?? null) === (checks?.composition ?? null) &&
    sameMeetingFreshChecks(manifest.freshChecks, checks?.freshChecks);
}

function manifestWithChecks(
  manifest: ReaderManifest,
  sequence: number,
  update: { readonly generatedAt: string; readonly retrievedAt: string | null; readonly checks: PublishReaderChecks | undefined },
): ReaderManifest {
  const { freshChecks: _freshChecks, composition: _composition, ...held } = manifest;
  const rest = Object.fromEntries(Object.entries(held).filter(([key]) => !["authorityArtifacts", "stateAuthorities", "registrations", "stateLegislators", "commentAccess", "everydayRouting", "extrasVersionIds"].includes(key))) as Omit<ReaderManifest, "freshChecks" | "composition">;
  return {
    ...rest,
    sequence,
    generatedAt: update.generatedAt,
    retrievedAt: laterCheck(manifest.retrievedAt, update.retrievedAt),
    ...(update.checks && Object.keys(update.checks.freshChecks).length > 0 ? { freshChecks: update.checks.freshChecks } : {}),
    ...(update.checks ? { composition: update.checks.composition } : {}),
  };
}

export async function publishReaderEdgeChecks(
  update: { readonly generatedAt: string; readonly retrievedAt: string | null; readonly checks: PublishReaderChecks },
  options: { readonly store?: ReaderArtifactStore | null } = {},
): Promise<PublishReaderEdgeResult> {
  const store = options.store ?? resolveReaderArtifactWriteStore();
  if (!store) return { status: "SKIPPED_NO_STORE" };
  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  if (!current) return { status: "NOT_COMPOSABLE", detail: "no served manifest to carry the checks" };
  if (current.manifest.composition !== undefined && current.manifest.composition !== update.checks.composition) {
    return { status: "NOT_COMPOSABLE", detail: "the served manifest was partitioned from another composition" };
  }
  const generatedAt = laterCheck(current.manifest.generatedAt, update.generatedAt) ?? update.generatedAt;
  if (!["authorityArtifacts", "stateAuthorities", "registrations", "stateLegislators", "commentAccess", "everydayRouting", "extrasVersionIds"].some(key => Object.hasOwn(current.manifest, key)) &&
    manifestStatesChecks(current.manifest, generatedAt, update.checks)) {
    return { status: "CURRENT", sequence: current.manifest.sequence, scopes: current.manifest.scopes.length };
  }
  const sequence = current.manifest.sequence + 1;
  let result;
  try {
    result = await store.writeManifest(manifestWithChecks(current.manifest, sequence, { ...update, generatedAt }), current.etag ?? null);
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  return result.modified
    ? { status: "PUBLISHED", sequence, scopes: current.manifest.scopes.length, meetings: current.manifest.scopes.reduce((sum, scope) => sum + scope.meetingCount, 0) }
    : { status: "RACED", sequence };
}

export interface PublishAuthorityValue {
  readonly value: unknown;
  readonly versionId: string;
}
export interface PublishAuthorityCarried {
  readonly versionId: string;
  readonly carried: true;
}
export type PublishAuthority = Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried>>;
export interface PublishedStateAuthority { readonly versionId: string; readonly artifact: AuthorityArtifactRef }
export type PublishStateAuthorities = Partial<Record<StateAuthorityFamily, Readonly<Record<string, PublishAuthorityValue | PublishAuthorityCarried | PublishedStateAuthority>>>>;
/** Complete: one entry per promoted registration pointer, since the reader reads an unnamed state as having none. */
export type PublishRegistrations = Readonly<Record<string, PublishAuthorityValue | PublishAuthorityCarried>>;

interface RegistrationArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "registration";
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

interface StateLegislatorsArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "state-legislators";
  readonly jurisdiction: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: OfficialStateLegislatorReadModel;
}

export function servedAuthorityVersion(
  manifest: Pick<ReaderAuthorityManifest, "authorityArtifacts"> | null | undefined,
  family: AuthorityFamily,
): string | null {
  return !isStateAuthorityFamily(family) && family !== "state-legislators" ? manifest?.authorityArtifacts?.[family]?.version ?? null : null;
}

interface AuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: GlobalAuthorityFamily;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

// Blobs reads are eventually consistent (up to 60 s behind a write); holding adds at most this much to that window.
export const READER_MANIFEST_MEMO_MS = 15_000;
let manifestMemo: { readonly at: number; readonly value: Promise<ReaderManifest | null> } | null = null;
let authorityManifestMemo: { readonly at: number; readonly value: Promise<ReaderAuthorityManifest | null> } | null = null;

async function readManifestFrom(store: ReaderArtifactStore): Promise<ReaderManifest | null> {
  try {
    const stored = await store.readManifest();
    return stored?.manifest ?? null;
  } catch {
    return null;
  }
}

export async function readReaderManifest(
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  now: () => number = Date.now,
): Promise<ReaderManifest | null> {
  if (!store) return null;
  if (store.kind !== "netlify-blobs") return readManifestFrom(store);
  const at = now();
  if (manifestMemo && at - manifestMemo.at >= 0 && at - manifestMemo.at < READER_MANIFEST_MEMO_MS) return manifestMemo.value;
  const memo = { at, value: readManifestFrom(store) };
  manifestMemo = memo;
  void memo.value.then((manifest) => {
    if (manifest === null && manifestMemo === memo) manifestMemo = null;
  });
  return memo.value;
}

export async function readReaderAuthorityManifest(store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  now: () => number = Date.now): Promise<ReaderAuthorityManifest | null> {
  if (!store) return null;
  const read = () => store.readAuthorityManifest().then(value => value?.manifest ?? null).catch(() => null);
  if (store.kind !== "netlify-blobs") return read();
  const at = now();
  if (authorityManifestMemo && at - authorityManifestMemo.at >= 0 && at - authorityManifestMemo.at < READER_MANIFEST_MEMO_MS) return authorityManifestMemo.value;
  const memo = { at, value: read() };
  authorityManifestMemo = memo;
  void memo.value.then(manifest => { if (manifest === null && authorityManifestMemo === memo) authorityManifestMemo = null; });
  return memo.value;
}

export const READER_MAP_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "government-domains",
  "census-districts",
  "registry-runtime",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
];

export const READER_FUNDING_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "registry-runtime",
  "federal-directory",
  "federal-funding",
  "state-money",
  "ballot-contests",
];

const ASK_ONLY_AUTHORITY_FAMILIES: ReadonlySet<AuthorityFamily> = new Set<AuthorityFamily>([
  "pima-finance",
  "federal-votes",
  "federal-key-votes",
  "officeholder-statements",
  "executive-actions",
]);

export const READER_BALLOT_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  ...READER_MAP_AUTHORITY_FAMILIES.filter((family) => family !== "registry-runtime"),
  ...PROMOTED_AUTHORITY_FAMILIES.filter((family) => !ASK_ONLY_AUTHORITY_FAMILIES.has(family)),
];

const authorityEdgeCache = new Map<AuthorityFamily, { version: string; value: Promise<unknown | null> }>();

function heldFetch<K, V>(
  cache: Map<K, { version: string; value: Promise<V | null> }>,
  key: K,
  version: string,
  fetch: () => Promise<V | null>,
): Promise<V | null> {
  const cached = cache.get(key);
  if (cached?.version === version) return cached.value;
  const entry = { version, value: fetch() };
  cache.set(key, entry);
  const forget = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };
  entry.value.then((value) => { if (value === null) forget(); }, forget);
  return entry.value;
}

export async function readAuthorityArtifactValue(
  family: GlobalAuthorityFamily,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<unknown | null> {
  if (!ref?.key || !ref.version) return null;
  return heldFetch(authorityEdgeCache, family, `${ref.version}:${ref.key}:${ref.sha}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as AuthorityArtifactEnvelope;
      if (envelope.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || envelope.family !== family ||
        envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) return null;
      return envelope.value;
    } catch {
      return null;
    }
  });
}

export async function readServedPromotedFamily(family: GlobalPromotedAuthorityFamily, ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore): Promise<PromotedFamilyArtifactValue | null> {
  const value = await readAuthorityArtifactValue(family, ref, store) as Partial<PromotedFamilyArtifactValue> | null;
  return value?.kind === "PROMOTED_POINTERS" && Array.isArray(value.entries) ? value as PromotedFamilyArtifactValue : null;
}

export async function readReaderExtras(manifest: ReaderAuthorityManifest, store: ReaderArtifactStore | null = resolveReaderArtifactStore()): Promise<{
  commentAccess?: readonly CommentAccess[] | Error;
  everydayRouting?: EverydayRoutingProjection | null | Error;
}> {
  const read = async (family: "comment-access" | "everyday-routing") => {
    const ref = manifest.authorityArtifacts?.[family];
    if (!ref) return undefined;
    const value = store ? await readAuthorityArtifactValue(family, ref, store) : null;
    return value ?? new Error(`Published ${family} artifact is unavailable`);
  };
  const [comments, routing] = await Promise.all([read("comment-access"), read("everyday-routing")]);
  const commentAccess = comments instanceof Error || comments === undefined ? comments
    : Array.isArray((comments as CommentAccessProjection).records)
      ? (comments as CommentAccessProjection).records.map(({ id: _id, ...record }) => record)
      : new Error("Published comment-access artifact is invalid");
  const everydayRouting = routing instanceof Error || routing === undefined ? routing
    : typeof routing === "object" && routing !== null && "projection" in routing
      ? (routing as { projection: EverydayRoutingProjection | null }).projection
      : new Error("Published everyday-routing artifact is invalid");
  return { commentAccess, everydayRouting };
}

const scopeArtifactCache = new Map<string, { version: string; value: Promise<ReaderGeoArtifact | null> }>();

function fetchScopeArtifact(
  scope: ReaderManifestScope,
  store: ReaderArtifactStore,
): Promise<ReaderGeoArtifact | null> {
  return heldFetch(scopeArtifactCache, scope.scope, scope.sha256, () => store.readArtifact(scope.key));
}

const registrationEdgeCache = new Map<string, { version: string; value: Promise<RegistrationReadModel | null> }>();

async function fetchRegistrationArtifact(
  state: string,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<{ value: RegistrationReadModel; versionId: string } | null> {
  if (!ref?.key || !ref.version) return null;
  const version = ref.version;
  const value = await heldFetch(registrationEdgeCache, state, `${version}:${ref.key}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as RegistrationArtifactEnvelope;
      if (envelope.family !== "registration" || envelope.state !== state || envelope.versionId !== version || sha256OfJson(envelope.value) !== ref.sha) return null;
      return envelope.value as RegistrationReadModel;
    } catch {
      return null;
    }
  });
  return value === null ? null : { value, versionId: version };
}

const stateLegislatorsEdgeCache = new Map<string, { version: string; value: Promise<OfficialStateLegislatorReadModel | null> }>();

async function fetchStateLegislatorsArtifact(jurisdiction: string, ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore) {
  if (!ref?.key || !ref.version) return null;
  const value = await heldFetch(stateLegislatorsEdgeCache, jurisdiction, `${ref.version}:${ref.key}:${ref.sha}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as StateLegislatorsArtifactEnvelope;
      if (envelope.family !== "state-legislators" || envelope.jurisdiction !== jurisdiction || envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) return null;
      return envelope.value;
    } catch { return null; }
  });
  return value === null ? null : { value, versionId: ref.version };
}

interface StateAuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: StateAuthorityFamily;
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: PromotedFamilyArtifactValue;
}

export async function prepareStateAuthorityArtifact(family: StateAuthorityFamily, state: string, entry: PublishAuthorityValue,
  store: ReaderArtifactStore, now: string): Promise<PublishedStateAuthority> {
  const envelope: StateAuthorityArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION,
    family, state, versionId: entry.versionId, generatedAt: now, value: entry.value as PromotedFamilyArtifactValue };
  const bytes = gzipSync(Buffer.from(JSON.stringify(envelope), "utf8"));
  return { versionId: entry.versionId, artifact: { key: await store.putImmutable(bytes, "json.gz"), version: entry.versionId, sha: bytesHash(bytes) } };
}

const stateAuthorityCache = new Map<string, { version: string; value: Promise<PromotedFamilyArtifactValue | null> }>();
const STATE_ARTIFACT_CACHE_LIMIT = 8;
const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export async function readStateAuthorityArtifact(family: StateAuthorityFamily, state: string, ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore): Promise<PromotedFamilyArtifactValue | null> {
  if (!ref?.key || !ref.version) return null;
  const cacheKey = `${family}:${state}`;
  const result = heldFetch(stateAuthorityCache, cacheKey, `${ref.version}:${ref.key}:${ref.sha}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes || bytesHash(bytes) !== ref.sha) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as StateAuthorityArtifactEnvelope;
      const scope = stateBallotScope(family === "candidate-publications" ? "candidate-corpus" : family, state);
      if (envelope.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || envelope.family !== family || envelope.state !== state ||
        envelope.versionId !== ref.version || envelope.value?.kind !== "PROMOTED_POINTERS" || !Array.isArray(envelope.value.entries) ||
        envelope.value.entries.some(entry => (entry.kind === "PROMOTED" ? entry.projection.scope : entry.scope) !== scope)) return null;
      registerIntegrityCheckedEdgeEntries(envelope.value.entries);
      return envelope.value;
    } catch { return null; }
  });
  const entry = stateAuthorityCache.get(cacheKey);
  if (entry) { stateAuthorityCache.delete(cacheKey); stateAuthorityCache.set(cacheKey, entry); }
  while (stateAuthorityCache.size > STATE_ARTIFACT_CACHE_LIMIT) stateAuthorityCache.delete(stateAuthorityCache.keys().next().value!);
  return result;
}

export function prefetchReaderEdgeStates(
  manifest: ReaderManifest | null,
  states: readonly string[],
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): void {
  if (!manifest || !store || states.length === 0) return;
  const wanted = new Set(scopesForStates(states));
  for (const scope of manifest.scopes) if (wanted.has(scope.scope)) void fetchScopeArtifact(scope, store).catch(() => undefined);
}

export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderAuthorityManifest, "authorityArtifacts" | "registrations" | "stateLegislators" | "stateAuthorities">,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  families: readonly AuthorityFamily[] = AUTHORITY_FAMILIES,
): Promise<ReaderAuthorityEdgeBundle> {
  const refs = manifest.authorityArtifacts;
  const promotedFamilies = new Set<string>();
  const stateAuthorityRefs = manifest.stateAuthorities;
  const stateAuthorities = stateAuthorityRefs && store ? { stateAuthorities: {
    states: Object.fromEntries(STATE_AUTHORITY_FAMILIES.filter(family => families.includes(family) && stateAuthorityRefs[family] !== undefined)
      .map(family => [family, new Set(Object.keys(stateAuthorityRefs[family]!))])),
    load: async (family: StateAuthorityFamily, state: string) => {
      const value = await readStateAuthorityArtifact(family, state, stateAuthorityRefs[family]?.[state], store);
      if (value) promotedFamilies.add(family);
      return value;
    },
  } } : {};
  const registrationRefs = manifest.registrations;
  const registrations = registrationRefs && store
    ? { registrations: { states: new Set(Object.keys(registrationRefs)), load: (state: string) => fetchRegistrationArtifact(state, registrationRefs[state], store) } }
    : {};
  const stateLegislatorRefs = manifest.stateLegislators;
  const stateLegislators: { stateLegislators?: ReaderAuthorityEdgeBundle["stateLegislators"] } = {};
  if (store && families.includes("state-legislators")) {
    if (stateLegislatorRefs) {
      stateLegislators.stateLegislators = { jurisdictions: new Set(Object.keys(stateLegislatorRefs)),
        load: (jurisdiction: string) => fetchStateLegislatorsArtifact(jurisdiction, stateLegislatorRefs[jurisdiction], store) };
    }
  }
  if (!refs || !store) return { ...registrations, ...stateLegislators, ...stateAuthorities, promotedFamilies };
  const bundle: {
    censusDistricts?: { value: CensusDistrictEdge; versionId: string };
    registryRuntime?: { value: RegistryRuntimeReadModel; versionId: string };
    federalDirectory?: { value: FederalDirectoryReadModel; versionId: string };
    campaignSites?: { value: CuratedReaderProjection; versionId: string };
    meetingOutcomes?: { value: OutcomeSnapshot; versionId: string };
    commentAccess?: { value: import("../registry/comment-access.ts").CommentAccessProjection; versionId: string };
  } = {};
  const wanted = new Set(families);
  const fetchWanted = (family: AuthorityFamily) =>
    !isStateAuthorityFamily(family) && family !== "state-legislators" && wanted.has(family) ? readAuthorityArtifactValue(family, refs[family], store) : Promise.resolve(null);
  const promotedFetch = Promise.all(PROMOTED_AUTHORITY_FAMILIES.map(fetchWanted));
  const [registry, federal, campaign, outcomes, commentAccess, censusDistricts] = await Promise.all([
    fetchWanted("registry-runtime"),
    fetchWanted("federal-directory"),
    fetchWanted("campaign-sites"),
    fetchWanted("meeting-outcomes"),
    fetchWanted("comment-access"),
    fetchWanted("census-districts"),
  ]);
  if (registry !== null) bundle.registryRuntime = { value: registry as RegistryRuntimeReadModel, versionId: refs["registry-runtime"]!.version };
  if (federal !== null) bundle.federalDirectory = { value: federal as FederalDirectoryReadModel, versionId: refs["federal-directory"]!.version };
  if (campaign !== null) bundle.campaignSites = { value: campaign as CuratedReaderProjection, versionId: refs["campaign-sites"]!.version };
  if (outcomes !== null) bundle.meetingOutcomes = { value: outcomes as OutcomeSnapshot, versionId: refs["meeting-outcomes"]!.version };
  if (commentAccess !== null) bundle.commentAccess = { value: commentAccess as import("../registry/comment-access.ts").CommentAccessProjection, versionId: refs["comment-access"]!.version };
  if (censusDistricts !== null) bundle.censusDistricts = { value: censusDistricts as CensusDistrictEdge, versionId: refs["census-districts"]!.version };
  const promoted = new Map<string, PromotedEdgeEntry>();
  const promotedValues = await promotedFetch;
  PROMOTED_AUTHORITY_FAMILIES.forEach((family, index) => {
    const artifact = promotedValues[index] as Partial<PromotedFamilyArtifactValue> | null;
    if (artifact?.kind !== "PROMOTED_POINTERS" || !Array.isArray(artifact.entries)) return;
    promotedFamilies.add(family);
    for (const entry of artifact.entries) {
      const pointer = entry?.kind === "PROMOTED" ? entry.projection?.key : entry?.kind === "NOT_RECORDED" ? `${entry.recordClass}:${entry.scope}` : null;
      if (typeof pointer === "string") promoted.set(pointer, entry);
    }
  });
  return { ...bundle, ...registrations, ...stateLegislators, ...stateAuthorities, promoted, promotedFamilies };
}

function scopeDataSha(artifact: ReaderGeoArtifact): string {
  return sha256OfJson({ meetings: artifact.meetings, agendaDocuments: artifact.agendaDocuments });
}

export interface PublishReaderEdgeOptions {
  readonly store?: ReaderArtifactStore | null;
  readonly now?: string;
  readonly authority?: PublishAuthority;
  readonly stateAuthorities?: PublishStateAuthorities;
  readonly registrations?: PublishRegistrations;
  readonly stateLegislators?: PublishRegistrations;
  readonly meetingBodies?: Parameters<typeof partitionSnapshotByScope>[2];
  readonly meetingRegistryVersion?: string | null;
  readonly checks?: PublishReaderChecks;
}

export async function publishReaderAuthorityArtifacts(options: PublishReaderEdgeOptions): Promise<PublishReaderEdgeResult> {
  const store = options.store ?? resolveReaderArtifactWriteStore();
  if (!store) return { status: "SKIPPED_NO_STORE" };
  const now = options.now ?? new Date().toISOString();
  const authorityVersions = (m: Pick<ReaderAuthorityManifest, "authorityArtifacts"> | undefined) =>
    AUTHORITY_FAMILIES.filter((f): f is GlobalAuthorityFamily => !isStateAuthorityFamily(f) && f !== "state-legislators").map((f) => `${f}=${m?.authorityArtifacts?.[f]?.version ?? ""}`).join("|");
  const newAuthorityVersions = AUTHORITY_FAMILIES.filter((f): f is GlobalAuthorityFamily => !isStateAuthorityFamily(f) && f !== "state-legislators")
    .map((f) => `${f}=${options.authority?.[f]?.versionId ?? ""}`)
    .join("|");
  const registrationVersions = (entries: readonly (readonly [string, string])[] | null) =>
    entries === null ? "none" : entries.map(([state, version]) => `${state}=${version}`).sort().join("|");
  const newRegistrationVersions = registrationVersions(
    options.registrations === undefined ? null : Object.entries(options.registrations).map(([state, entry]) => [state, entry.versionId] as const),
  );
  const newLegislatorVersions = registrationVersions(options.stateLegislators === undefined ? null : Object.entries(options.stateLegislators).map(([scope, entry]) => [scope, entry.versionId] as const));

  let current;
  try { current = await store.readAuthorityManifest(); }
  catch (error) { return { status: "FAILED", error: error instanceof Error ? error.message : String(error) }; }
  if (current) {
    const sameAuthority = !Object.keys(current.manifest.authorityArtifacts ?? {}).some(family => isStateAuthorityFamily(family) || family === "state-legislators") &&
      (options.authority === undefined || authorityVersions(current.manifest) === newAuthorityVersions);
    const sameStateAuthorities = Object.entries(options.stateAuthorities ?? {}).every(([family, states]) =>
      current.manifest.stateAuthorities?.[family as StateAuthorityFamily] !== undefined &&
      Object.entries(states).every(([state, entry]) => current.manifest.stateAuthorities?.[family as StateAuthorityFamily]?.[state]?.version === entry.versionId));
    const sameRegistrations = options.registrations === undefined || registrationVersions(
      current.manifest.registrations === undefined ? null : Object.entries(current.manifest.registrations).map(([state, ref]) => [state, ref.version] as const),
    ) === newRegistrationVersions;
    const sameLegislators = options.stateLegislators === undefined || registrationVersions(current.manifest.stateLegislators === undefined ? null : Object.entries(current.manifest.stateLegislators).map(([scope, ref]) => [scope, ref.version] as const)) === newLegislatorVersions;
    if (sameAuthority && sameStateAuthorities && sameRegistrations && sameLegislators)
      return { status: "CURRENT", sequence: current.manifest.sequence, scopes: 0 };
  }
  const sequence = (current?.manifest.sequence ?? 0) + 1;
  const authorityArtifacts: Partial<Record<GlobalAuthorityFamily, AuthorityArtifactRef>> = options.authority === undefined
    ? Object.fromEntries(Object.entries(current?.manifest.authorityArtifacts ?? {}).filter(([family]) => !isStateAuthorityFamily(family) && family !== "state-legislators")) : {};
  const stateAuthorities: Partial<Record<StateAuthorityFamily, Record<string, AuthorityArtifactRef>>> = Object.fromEntries(
    Object.entries(current?.manifest.stateAuthorities ?? {}).map(([family, states]) => [family, { ...states }]));
  const registrations: Record<string, AuthorityArtifactRef> = options.registrations === undefined ? { ...current?.manifest.registrations } : {};
  const stateLegislators: Record<string, AuthorityArtifactRef> = options.stateLegislators === undefined ? { ...current?.manifest.stateLegislators } : {};
  try {
    for (const family of AUTHORITY_FAMILIES) {
      if (isStateAuthorityFamily(family) || family === "state-legislators") continue;
      const entry = options.authority?.[family];
      if (!entry) continue;
      if ("carried" in entry) {
        const served = current?.manifest.authorityArtifacts?.[family];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        authorityArtifacts[family] = served;
        continue;
      }
      const envelope: AuthorityArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family,
        versionId: entry.versionId,
        generatedAt: now,
        value: entry.value,
      };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      authorityArtifacts[family] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
    for (const family of STATE_AUTHORITY_FAMILIES) {
      const entries = options.stateAuthorities?.[family];
      if (!entries) continue;
      const refs = stateAuthorities[family] ??= {};
      for (const [state, entry] of Object.entries(entries)) {
        const served = current?.manifest.stateAuthorities?.[family]?.[state];
        if ("carried" in entry || served?.version === entry.versionId) {
          if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
          refs[state] = served;
          continue;
        }
        refs[state] = "artifact" in entry ? entry.artifact : (await prepareStateAuthorityArtifact(family, state, entry, store, now)).artifact;
      }
    }
    for (const [state, entry] of Object.entries(options.registrations ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.registrations?.[state];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        registrations[state] = served;
        continue;
      }
      const envelope: RegistrationArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family: "registration",
        state,
        versionId: entry.versionId,
        generatedAt: now,
        value: entry.value,
      };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      registrations[state] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
    for (const [jurisdiction, entry] of Object.entries(options.stateLegislators ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.stateLegislators?.[jurisdiction];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        stateLegislators[jurisdiction] = served;
        continue;
      }
      const envelope: StateLegislatorsArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "state-legislators", jurisdiction, versionId: entry.versionId, generatedAt: now, value: entry.value as OfficialStateLegislatorReadModel };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      stateLegislators[jurisdiction] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
    const manifest: ReaderAuthorityManifest = {
      formatVersion: READER_ARTIFACT_FORMAT_VERSION, sequence, generatedAt: now,
      ...(Object.keys(authorityArtifacts).length ? { authorityArtifacts } : {}),
      ...(Object.keys(stateAuthorities).length ? { stateAuthorities } : {}),
      ...(options.registrations !== undefined || current?.manifest.registrations !== undefined ? { registrations } : {}),
      ...(options.stateLegislators !== undefined || current?.manifest.stateLegislators !== undefined ? { stateLegislators } : {}),
    };
    const result = await store.writeAuthorityManifest(manifest, current?.etag ?? null);
    return result.modified ? { status: "PUBLISHED", sequence, scopes: 0, meetings: 0 } : { status: "RACED", sequence };
  } catch (error) { return { status: "FAILED", error: error instanceof Error ? error.message : String(error) }; }
}

export async function publishReaderEdgeArtifacts(snapshot: MeetingsSnapshot | null, metadata: PublishMetadata,
  options: PublishReaderEdgeOptions = {}): Promise<PublishReaderEdgeResult> {
  const hasAuthority = options.authority !== undefined || options.stateAuthorities !== undefined || options.registrations !== undefined || options.stateLegislators !== undefined;
  const authority = hasAuthority ? await publishReaderAuthorityArtifacts(options) : null;
  if (authority && authority.status !== "CURRENT" && authority.status !== "PUBLISHED") return authority;
  if (snapshot === null && options.checks === undefined && authority) return authority;
  const meetings = await publishReaderMeetingArtifacts(snapshot, metadata, options);
  if (!authority || (meetings.status !== "CURRENT" && meetings.status !== "PUBLISHED")) return meetings;
  const sequence = Math.max(authority.sequence, meetings.sequence);
  return meetings.status === "CURRENT" && authority.status === "PUBLISHED"
    ? { ...authority, sequence, scopes: meetings.scopes }
    : { ...meetings, sequence };
}

async function publishReaderMeetingArtifacts(snapshot: MeetingsSnapshot | null, metadata: PublishMetadata,
  options: PublishReaderEdgeOptions): Promise<PublishReaderEdgeResult> {
  const store = options.store ?? resolveReaderArtifactWriteStore();
  if (!store) return { status: "SKIPPED_NO_STORE" };
  const now = options.now ?? new Date().toISOString();

  let artifacts: ReaderGeoArtifact[];
  try {
    artifacts = snapshot === null ? [] : partitionSnapshotByScope(snapshot, now, options.meetingBodies);
  } catch (error) {
    return { status: "NOT_COMPOSABLE", detail: error instanceof Error ? error.message : String(error) };
  }
  const shaByScope = new Map(artifacts.map((a) => [a.scope, scopeDataSha(a)]));

  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  if (current) {
    const currentShas = new Map(current.manifest.scopes.map((s) => [s.scope, s.sha256]));
    const sameSet = snapshot === null || (currentShas.size === shaByScope.size &&
      [...shaByScope].every(([scope, sha]) => currentShas.get(scope) === sha));
    const sameMeetingAreas = snapshot === null || options.meetingRegistryVersion === undefined ||
      current.manifest.meetingRegistryVersion === options.meetingRegistryVersion;

    if (sameSet && sameMeetingAreas && !["authorityArtifacts", "stateAuthorities", "registrations", "stateLegislators", "commentAccess", "everydayRouting", "extrasVersionIds"].some(key => Object.hasOwn(current.manifest, key))) {
      const generatedAt = snapshot?.generatedAt || (options.checks ? laterCheck(current.manifest.generatedAt, metadata.retrievedAt) : null) || current.manifest.generatedAt;
      const checks = options.checks ?? (snapshot === null && current.manifest.composition !== undefined
        ? { composition: current.manifest.composition, freshChecks: current.manifest.freshChecks ?? {} } : undefined);
      if (manifestStatesChecks(current.manifest, generatedAt, checks)) {
        return { status: "CURRENT", sequence: current.manifest.sequence, scopes: current.manifest.scopes.length };
      }
      const sequence = current.manifest.sequence + 1;
      let written;
      try {
        written = await store.writeManifest(
          { ...manifestWithChecks(current.manifest, sequence, { generatedAt, retrievedAt: metadata.retrievedAt, checks }), sources: snapshot?.sources ?? current.manifest.sources },
          current.etag ?? null,
        );
      } catch (error) {
        return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
      }
      return written.modified
        ? { status: "PUBLISHED", sequence, scopes: current.manifest.scopes.length, meetings: snapshot?.meetings.length ?? current.manifest.scopes.reduce((sum, scope) => sum + scope.meetingCount, 0) }
        : { status: "RACED", sequence };
    }
  }

  const sequence = (current?.manifest.sequence ?? 0) + 1;
  const manifestScopes: ReaderManifestScope[] = snapshot === null ? [...(current?.manifest.scopes ?? [])] : [];

  try {
    for (const artifact of artifacts) {
      const unchanged = current?.manifest.scopes.find(scope => scope.scope === artifact.scope && scope.sha256 === shaByScope.get(artifact.scope));
      if (unchanged) {
        manifestScopes.push(unchanged);
        continue;
      }
      const key = await store.putImmutable(Buffer.from(JSON.stringify(artifact), "utf8"), "json");
      manifestScopes.push({
        scope: artifact.scope,
        ...(artifact.ocdId ? { ocdId: artifact.ocdId } : {}),
        ...(artifact.bounds ? { bounds: artifact.bounds } : {}),
        ...(artifact.meetingIds ? { meetingIds: artifact.meetingIds } : {}),
        ...(artifact.agendaOnly ? { agendaOnly: true } : {}),
        key,
        sha256: shaByScope.get(artifact.scope)!,
        meetingCount: artifact.meetings.length,
        generatedAt: artifact.generatedAt,
      });
    }

  } catch (error) {
    // Complete immutable bytes precede CAS; partial writes cannot change a served artifact.
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  const manifest: ReaderManifest = {
    formatVersion: READER_ARTIFACT_FORMAT_VERSION,
    sequence,
    ...(snapshot !== null ? { meetingLayout: "governing-area" as const } : current?.manifest.meetingLayout ? { meetingLayout: current.manifest.meetingLayout } : {}),
    ...(snapshot !== null && options.meetingRegistryVersion !== undefined
      ? { meetingRegistryVersion: options.meetingRegistryVersion }
      : snapshot === null && current?.manifest.meetingRegistryVersion !== undefined
        ? { meetingRegistryVersion: current.manifest.meetingRegistryVersion } : {}),
    generatedAt: snapshot?.generatedAt || (options.checks ? laterCheck(current?.manifest.generatedAt ?? null, metadata.retrievedAt) : null) || current?.manifest.generatedAt || now,
    sourceThrough: snapshot === null ? current?.manifest.sourceThrough ?? null : metadata.sourceThrough,
    retrievedAt: snapshot === null ? laterCheck(current?.manifest.retrievedAt ?? null, options.checks ? metadata.retrievedAt : null) : metadata.retrievedAt,
    promotedThrough: snapshot === null ? current?.manifest.promotedThrough ?? null : metadata.promotedThrough,
    sources: snapshot?.sources ?? current?.manifest.sources ?? [],
    scopes: manifestScopes,
    ...((options.checks?.freshChecks ?? (snapshot === null ? current?.manifest.freshChecks : undefined)) !== undefined
      ? { freshChecks: options.checks?.freshChecks ?? current!.manifest.freshChecks } : {}),
    ...((options.checks?.composition ?? (snapshot === null ? current?.manifest.composition : undefined)) !== undefined
      ? { composition: options.checks?.composition ?? current!.manifest.composition } : {}),
  };
  let result;
  try {
    result = await store.writeManifest(manifest, current?.etag ?? null);
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  return result.modified
    ? { status: "PUBLISHED", sequence, scopes: manifestScopes.length, meetings: snapshot?.meetings.length ?? manifestScopes.reduce((sum, scope) => sum + scope.meetingCount, 0) }
    : { status: "RACED", sequence };
}

// Reads answered whole from published edge artifacts; only these may be held by the CDN.
const completeEdgeReads = new WeakSet<object>();
const areaReads = new Map<string, MeetingsProjectionReadResult>();

export async function readReaderEdgeMeetings(
  options: ReaderEdgeMeetingsOptions = {},
): Promise<MeetingsProjectionReadResult> {
  const [read, settings] = await Promise.all([readReaderEdgeMeetingsHeld(options), options.settings ?? readReaderMeetingSettings(),
    import("../doors/meeting-doors.ts").then(module => module.ensureMeetingDoors()),
  ]);
  return applyServedWindow(read, options.window ?? "SHOWN", options.now, settings);
}

/** `SHOWN`: the configured shown window. `HELD`: every kept past meeting plus the shown window ahead. */
export type ReaderMeetingsWindow = "SHOWN" | "HELD";

const servedWindows = new WeakMap<object, Map<string, MeetingsProjectionReadResult>>();

function applyServedWindow(
  read: MeetingsProjectionReadResult,
  window: ReaderMeetingsWindow,
  nowOption: string | undefined,
  settings: MeetingSettings,
): MeetingsProjectionReadResult {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") return read;
  const now = nowOption ? Date.parse(nowOption) : Date.now();
  if (!Number.isFinite(now)) return read;
  const day = 86_400_000;
  const key = `${window}:${now}:${settings.shownBackDays}:${settings.shownAheadDays}`;
  const memo = servedWindows.get(read) ?? new Map<string, MeetingsProjectionReadResult>();
  const hit = memo.get(key);
  if (hit) return hit;
  const lower = window === "HELD" ? Number.NEGATIVE_INFINITY : now - settings.shownBackDays * day;
  const upper = now + settings.shownAheadDays * day;
  const meetings = read.value.meetings.filter((meeting) => {
    const startsAt = Date.parse(meeting.startsAt);
    return !Number.isFinite(startsAt) || (startsAt >= lower && startsAt <= upper);
  });
  let served = read;
  if (meetings.length !== read.value.meetings.length) {
    const kept = new Set(meetings.map(({ id }) => id));
    served = {
      ...read,
      value: {
        ...read.value,
        meetings,
        agendaDocuments: read.value.agendaDocuments.filter((document) => kept.has(document.meetingId)),
        counts: snapshotCounts(meetings, read.value.counts.duplicatesCollapsed ?? 0),
      },
    };
    if (completeEdgeReads.has(read)) completeEdgeReads.add(served);
  }
  memo.set(key, served);
  if (memo.size > 4) memo.delete([...memo.keys()][0]!);
  servedWindows.set(read, memo);
  return served;
}

type ReaderEdgeMeetingsOptions = {
    readonly store?: ReaderArtifactStore | null;
    readonly states?: readonly string[];
    readonly ocdIds?: readonly string[];
    readonly meetingId?: string;
    readonly includeAgenda?: boolean;
    readonly nearby?: { readonly lat: number; readonly lng: number; readonly radiusKm: number };
    readonly now?: string;
    readonly manifest?: ReaderManifest | null;
    readonly fallback?: () => Promise<MeetingsProjectionReadResult>;
    readonly window?: ReaderMeetingsWindow;
    readonly settings?: MeetingSettings;
  };

async function readReaderEdgeMeetingsHeld(
  options: ReaderEdgeMeetingsOptions,
): Promise<MeetingsProjectionReadResult> {
  // The fallback takes only the clock, never the artifact store, which is a different store from the data store.
  const fallback = options.fallback ?? (() => readPreparedMeetingsProjection(options.now ? { now: options.now } : {}));
  const store = options.store ?? resolveReaderArtifactStore();
  if (!store) return fallback();

  let manifest: ReaderManifest | null;
  if (options.manifest !== undefined) {
    manifest = options.manifest;
  } else {
    try {
      const stored = await store.readManifest();
      manifest = stored?.manifest ?? null;
    } catch {
      manifest = null;
    }
  }
  if (!manifest || manifest.scopes.length === 0) return fallback();

  const needed = manifest.scopes.filter(scope => readerScopeApplies(scope, options));
  const areaKey = sha256OfJson({ manifest, scopes: needed.map(({ scope, sha256 }) => [scope, sha256]) });
  const cachedArea = areaReads.get(areaKey);
  if (cachedArea) return cachedArea;

  let artifacts: ReaderGeoArtifact[];
  try {
    const fetched = await Promise.all(needed.map((s) => fetchScopeArtifact(s, store)));
    artifacts = fetched.filter((a): a is ReaderGeoArtifact => a !== null);
  } catch {
    return fallback();
  }
  if (needed.length > 0 && artifacts.length === 0) return fallback();

  const value = applyMeetingFreshChecks(mergeScopeArtifacts(artifacts, manifest), { checkedAt: null, routes: manifest.freshChecks ?? {} });
  const complete = artifacts.length === needed.length;
  const read: MeetingsProjectionReadResult = {
    kind: "PROMOTED",
    value,
    metadata: {
      recordClass: MEETINGS_RECORD_CLASS,
      scope: MEETINGS_SCOPE,
      sourceId: MEETINGS_SOURCE_ID,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: manifest.sourceThrough,
      retrievedAt: manifest.retrievedAt,
      promotedAt: manifest.promotedThrough,
      stale: complete ? "CURRENT" : "UNKNOWN",
      staleAt: null,
    },
    partitions: [],
    detail: `Served from the reader edge artifacts (manifest sequence ${manifest.sequence}, ${artifacts.length}/${needed.length} scope(s): ${artifacts.map((a) => a.scope).join(", ")}).`,
  };
  if (complete) {
    completeEdgeReads.add(read);
    if (areaReads.size >= 64) areaReads.delete(areaReads.keys().next().value!);
    areaReads.set(areaKey, read);
  }
  return read;
}

export function servedWholeFromReaderEdge(read: MeetingsProjectionReadResult): boolean {
  return completeEdgeReads.has(read);
}
