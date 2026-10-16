import { publishAuthorityRecords, readAuthorityRecords, type RecordIndex, type StateRecordIndex } from "./authority-records.ts";
import { currentReaderSelection, withReaderSelection } from "../db/reader-route.ts";
import { gzipSync, gunzipSync } from "node:zlib";

import {
  mergeScopeArtifacts,
  promotedFamilyOf,
  partitionSnapshotByScope,
  readerScopeApplies,
  scopesForStates,
  sha256OfJson,
  AUTHORITY_FAMILIES,
  PROMOTED_AUTHORITY_FAMILIES,
  READER_ARTIFACT_FORMAT_VERSION,
  type AuthorityArtifactRef,
  type AuthorityFamily,
  type PromotedAuthorityFamily,
  type PromotedFamilyArtifactValue,
  type ReaderGeoArtifact,
  type ReaderManifest,
  type ReaderManifestScope,
  type ReaderStateArtifact,
  stateOfOcdId,
} from "./edge-artifacts.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
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
import { applyMeetingFreshChecks, laterCheck } from "./fresh-checks.ts";
import {
  MEETINGS_RECORD_CLASS,
  MEETINGS_SCOPE,
  MEETINGS_SOURCE_ID,
  snapshotCounts,
  snapshotClientMeta,
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
    (checks === undefined || manifest.composition === checks.composition && manifest.checksSha === sha256OfJson(checks.freshChecks));
}

function manifestWithChecks(
  manifest: ReaderManifest,
  sequence: number,
  update: { readonly generatedAt: string; readonly retrievedAt: string | null; readonly checks: PublishReaderChecks | undefined },
): ReaderManifest {
  return {
    ...manifest,
    sequence,
    generatedAt: update.generatedAt,
    retrievedAt: laterCheck(manifest.retrievedAt, update.retrievedAt),
    ...(update.checks ? { checksSha: sha256OfJson(update.checks.freshChecks) } : {}),
    ...(update.checks ? { composition: update.checks.composition } : {}),
  };
}

async function updateStateChecks(manifest: ReaderManifest, checks: PublishReaderChecks | undefined, store: ReaderArtifactStore): Promise<ReaderManifest> {
  if (!checks) return manifest;
  const byState = new Map<string, Record<string, string>>();
  for (const [route, at] of Object.entries(checks.freshChecks)) {
    const state = stateOfOcdId(route) ?? "us";
    const rows = byState.get(state) ?? {}; rows[route] = at; byState.set(state, rows);
  }
  const scopes: ReaderManifestScope[] = [];
  for (const scope of manifest.scopes) {
    const artifact = await fetchReaderState(scope, store);
    if (!artifact) throw new Error("READER_STATE_ARTIFACT_MISSING");
    const next = { ...artifact, freshChecks: byState.get(scope.scope) ?? {} };
    const sha256 = sha256OfJson(next);
    scopes.push(sha256 === scope.sha256 ? scope : { ...scope, sha256,
      key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(next))), "json.gz") });
  }
  return { ...manifest, scopes };
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
  if (manifestStatesChecks(current.manifest, generatedAt, update.checks)) {
    return { status: "CURRENT", sequence: current.manifest.sequence, scopes: current.manifest.scopes.length };
  }
  const sequence = current.manifest.sequence + 1;
  let result;
  try {
    result = await store.writeManifest(await updateStateChecks(manifestWithChecks(current.manifest, sequence, { ...update, generatedAt }), update.checks, store), current.etag ?? null);
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  return result.modified
    ? { status: "PUBLISHED", sequence, scopes: current.manifest.scopes.length, meetings: current.manifest.scopes.reduce((sum, scope) => sum + scope.meetingCount, 0) }
    : { status: "RACED", sequence };
}

export interface PublishReaderExtras {
  readonly everydayRouting?: unknown;
  readonly versionIds?: ReaderManifest["extrasVersionIds"];
}

export interface PublishAuthorityValue {
  readonly value: unknown;
  readonly versionId: string;
}
export interface PublishAuthorityCarried {
  readonly versionId: string;
  readonly carried: true;
}
export interface PublishAuthorityIndex {
  readonly index: StateRecordIndex;
  readonly versionId: string;
}
export type PublishAuthority = Partial<Record<AuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried | PublishAuthorityIndex>>;
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
  manifest: Pick<ReaderManifest, "authorityArtifacts"> | null | undefined,
  family: AuthorityFamily,
): string | null {
  const ref = manifest?.authorityArtifacts?.[family];
  return ref?.layout === "places" ? ref.version : null;
}

interface AuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: AuthorityFamily;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

// Blobs reads are eventually consistent (up to 60 s behind a write); holding adds at most this much to that window.
export const READER_MANIFEST_MEMO_MS = 15_000;
let manifestMemo: { readonly at: number; readonly value: Promise<ReaderManifest | null> } | null = null;

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

export const READER_MAP_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "government-domains",
  "census-districts",
  "registry-runtime",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
];

export const READER_MEETING_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [...READER_MAP_AUTHORITY_FAMILIES, "comment-access"];

const STATE_BALLOT_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = PROMOTED_AUTHORITY_FAMILIES.filter((family) => /^ballot-[a-z]{2}$/.test(family));

export const READER_FUNDING_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "registry-runtime",
  "federal-directory",
  "federal-funding",
  "state-money",
  ...STATE_BALLOT_AUTHORITY_FAMILIES,
];

export const READER_BALLOT_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  ...READER_MAP_AUTHORITY_FAMILIES,
  ...STATE_BALLOT_AUTHORITY_FAMILIES,
  "ballot-contests",
];

const authorityValueCache = new Map<string, { version: string; value: Promise<unknown | null> }>();
const authorityEdgeCache = new Map<string, { version: string; value: Promise<unknown | null> }>();

function heldFetch<K, V>(
  cache: Map<K, { version: string; value: Promise<V | null> }>,
  key: K,
  version: string,
  fetch: () => Promise<V | null>,
  limit = 8,
): Promise<V | null> {
  const cached = cache.get(key);
  if (cached?.version === version) return cached.value;
  const entry = { version, value: fetch() };
  cache.set(key, entry);
  if (cache.size > limit) cache.delete(cache.keys().next().value!);
  const forget = () => {
    if (cache.get(key) === entry) cache.delete(key);
  };
  entry.value.then((value) => { if (value === null) forget(); }, forget);
  return entry.value;
}

export async function readPublishedAuthorityIndex(ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore): Promise<RecordIndex | StateRecordIndex | undefined> {
  if (ref?.layout !== "places") return undefined;
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes) return undefined;
    const { value } = JSON.parse(gunzipSync(bytes).toString("utf8")) as { value: RecordIndex | StateRecordIndex };
    return ["READER_PLACE_RECORDS", "READER_STATE_RECORDS"].includes(value.kind) && sha256OfJson(value) === ref.sha ? value : undefined;
  } catch { return undefined; }
}

async function publishedRecords(ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore): Promise<RecordIndex | undefined> {
  const value = await readPublishedAuthorityIndex(ref, store);
  return value?.kind === "READER_PLACE_RECORDS" ? value : undefined;
}

export async function readAuthorityArtifactValue(
  family: AuthorityFamily,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<unknown | null> {
  if (!ref?.key || !ref.version || ref.layout !== "places") return null;
  const selection = currentReaderSelection();
  const index = await heldFetch(authorityEdgeCache, family, `${ref.version}:${ref.key}`, async () => {
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
  }, AUTHORITY_FAMILIES.length);
  const read = async () => {
    try { return index === null ? null : await readAuthorityRecords(index as RecordIndex, store, selection); }
    catch { return null; }
  };
  return selection ? read() : heldFetch(authorityValueCache, family, `${ref.version}:${ref.key}`, read);
}

export async function readServedPromotedFamily(family: PromotedAuthorityFamily, ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore): Promise<PromotedFamilyArtifactValue | null> {
  const value = await readAuthorityArtifactValue(family, ref, store) as Partial<PromotedFamilyArtifactValue> | null;
  return value?.kind === "PROMOTED_POINTERS" && Array.isArray(value.entries) ? value as PromotedFamilyArtifactValue : null;
}

const stateArtifactCache = new Map<string, { version: string; value: Promise<ReaderStateArtifact | null> }>();
const stateArtifactVersions = new WeakMap<ReaderStateArtifact, string>();

async function fetchReaderState(scope: ReaderManifestScope, store: ReaderArtifactStore): Promise<ReaderStateArtifact | null> {
  return heldFetch(stateArtifactCache, scope.scope, scope.key, async () => {
    const bytes = await store.readBytes(scope.key);
    if (!bytes) return null;
    const value = JSON.parse(gunzipSync(bytes).toString("utf8")) as ReaderStateArtifact;
    if (!Array.isArray(value.scopes) || sha256OfJson(value) !== scope.sha256) return null;
    stateArtifactVersions.set(value, scope.key);
    return value;
  });
}

function nearbyBounds(bounds: import("./edge-artifacts.ts").ReaderAreaBounds, point: readonly [number, number]): boolean {
  const dy = 150 / 110;
  const dx = 150 / (110 * Math.max(0.01, Math.cos(Math.min(90, Math.abs(point[1]) + dy) * Math.PI / 180)));
  return bounds.north >= point[1] - dy && bounds.south <= point[1] + dy &&
    [-360, 0, 360].some(shift => bounds.east + shift >= point[0] - dx && bounds.west + shift <= point[0] + dx);
}

export async function readReaderStates(scopes: readonly ReaderManifestScope[], store: ReaderArtifactStore, selected = true): Promise<ReaderStateArtifact[]> {
  const selection = selected ? currentReaderSelection() : undefined;
  const states = new Set<string>();
  for (const key of selection?.keys ?? []) {
    const state = stateOfOcdId(key) ?? /^state:([A-Z]{2})$/.exec(key)?.[1]?.toLowerCase();
    if (state) states.add(state);
  }
  const wanted = scopes.filter(scope => !selection || states.has(scope.scope) || scope.scope === "us" ||
    selection.point && scope.bounds && nearbyBounds(scope.bounds, selection.point));
  const result: ReaderStateArtifact[] = [];
  for (let at = 0; at < wanted.length; at += 8) {
    const values = await Promise.all(wanted.slice(at, at + 8).map(scope => fetchReaderState(scope, store)));
    if (values.some(value => value === null)) throw new Error("READER_STATE_ARTIFACT_MISSING");
    result.push(...values as ReaderStateArtifact[]);
  }
  return result;
}

const scopeArtifactCache = new Map<string, { version: string; value: Promise<ReaderGeoArtifact | null> }>();

function fetchScopeArtifact(
  scope: ReaderManifestScope,
  store: ReaderArtifactStore,
): Promise<ReaderGeoArtifact | null> {
  return heldFetch(scopeArtifactCache, scope.scope, scope.sha256, async () => {
    const artifact = await store.readArtifact(scope.key);
    return artifact && Array.isArray(artifact.meetingOrder) && artifact.meetingOrder.length === artifact.meetings.length ? artifact : null;
  });
}

const registrationEdgeCache = new Map<string, { version: string; value: Promise<RecordIndex | null> }>();

async function fetchRegistrationArtifact(
  state: string,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<{ value: RegistrationReadModel; versionId: string } | null> {
  if (!ref?.key || !ref.version) return null;
  const version = ref.version;
  const selection = currentReaderSelection();
  const index = await heldFetch(registrationEdgeCache, state, `${version}:${ref.key}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as RegistrationArtifactEnvelope;
      if (envelope.family !== "registration" || envelope.state !== state || envelope.versionId !== version || sha256OfJson(envelope.value) !== ref.sha) return null;
      return envelope.value as unknown as RecordIndex;
    } catch {
      return null;
    }
  });
  try { return index === null ? null : { value: await readAuthorityRecords(index, store, selection) as RegistrationReadModel, versionId: version }; }
  catch { return null; }
}

const stateLegislatorsEdgeCache = new Map<string, { version: string; value: Promise<RecordIndex | null> }>();

async function fetchStateLegislatorsArtifact(jurisdiction: string, ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore) {
  if (!ref?.key || !ref.version) return null;
  const selection = currentReaderSelection();
  const index = await heldFetch(stateLegislatorsEdgeCache, jurisdiction, `${ref.version}:${ref.key}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as StateLegislatorsArtifactEnvelope;
      if (envelope.family !== "state-legislators" || envelope.jurisdiction !== jurisdiction || envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) return null;
      return envelope.value as unknown as RecordIndex;
    } catch { return null; }
  });
  try { return index === null ? null : { value: await readAuthorityRecords(index, store, selection) as OfficialStateLegislatorReadModel, versionId: ref.version }; }
  catch { return null; }
}

export function prefetchReaderEdgeStates(
  manifest: ReaderManifest | null,
  states: readonly string[],
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): void {
  if (!manifest || !store || states.length === 0) return;
  const wanted = new Set(scopesForStates(states));
  for (const scope of manifest.scopes) if (wanted.has(scope.scope)) void fetchReaderState(scope, store).catch(() => undefined);
  for (const state of states) {
    const ref = manifest.registrations?.[state];
    if (ref) void fetchRegistrationArtifact(state, ref, store);
  }
}

function readerScopedLoader<T>(load: (id: string) => Promise<T>): (id: string) => Promise<T> {
  const standalone = {};
  const contexts = new WeakMap<object, Map<string, { selection: string; value: Promise<T> }>>();
  return id => {
    const selection = currentReaderSelection();
    const context = selection ?? standalone;
    let cache = contexts.get(context);
    if (!cache) { cache = new Map(); contexts.set(context, cache); }
    const signature = sha256OfJson(selection ? { ...selection, keys: [...selection.keys].sort() } : null);
    const held = cache.get(id);
    if (held?.selection === signature) return held.value;
    const value = load(id);
    cache.set(id, { selection: signature, value });
    return value;
  };
}

export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderManifest, "authorityArtifacts" | "registrations" | "stateLegislators" | "scopes">,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  families: readonly AuthorityFamily[] = AUTHORITY_FAMILIES,
): Promise<ReaderAuthorityEdgeBundle> {
  const refs = manifest.authorityArtifacts;
  const registrationRefs = manifest.registrations;
  const registrations = registrationRefs && store
    ? { registrations: { states: new Set(Object.keys(registrationRefs)), load: readerScopedLoader((state: string) => fetchRegistrationArtifact(state, registrationRefs[state], store)) } }
    : {};
  const stateLegislatorRefs = manifest.stateLegislators;
  const stateLegislators: { stateLegislators?: ReaderAuthorityEdgeBundle["stateLegislators"] } = {};
  if (store && families.includes("state-legislators")) {
    if (stateLegislatorRefs) {
      stateLegislators.stateLegislators = { jurisdictions: new Set(Object.keys(stateLegislatorRefs)),
        load: readerScopedLoader((jurisdiction: string) => fetchStateLegislatorsArtifact(jurisdiction, stateLegislatorRefs[jurisdiction], store)) };
    }
  }
  if (!refs || !store) return { ...registrations, ...stateLegislators };
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
    wanted.has(family) && (family !== "government-domains" || !currentReaderSelection() ||
      [...currentReaderSelection()!.keys].some(key => key.startsWith("government:"))) ? readAuthorityArtifactValue(family, refs[family], store) : Promise.resolve(null);
  const censusDistricts = await fetchWanted("census-districts") as CensusDistrictEdge | null;
  const selected = currentReaderSelection();
  if (selected && censusDistricts) {
    const { censusDistrictEdgeSlice } = await import("../census-geography/district-edge.ts");
    const { censusWorkDivision } = await import("../census-geography/division-id.ts");
    for (const zip of [...selected.keys].filter(key => /^\d{5}$/.test(key))) {
      const slice = censusDistrictEdgeSlice(censusDistricts, refs["census-districts"]!.version, zip);
      if (slice.kind === "HELD") for (const container of slice.value.containers) {
        const id = censusWorkDivision(container.ref);
        if (id) selected.keys.add(id);
      }
    }
  }
  // Registration supplies the division keys for a native government identity.
  for (const state of new Set([...selected?.keys ?? []].flatMap(key => /^government:US-([A-Z]{2}):/.exec(key)?.[1]?.toLowerCase() ?? []))) {
    if (registrationRefs?.[state]) await fetchRegistrationArtifact(state, registrationRefs[state], store);
  }
  const [states, registry, federal, campaign, outcomes] = await Promise.all([
    readReaderStates(manifest.scopes, store),
    fetchWanted("registry-runtime"),
    fetchWanted("federal-directory"),
    fetchWanted("campaign-sites"),
    fetchWanted("meeting-outcomes"),
  ]);
  const commentAccess = await fetchWanted("comment-access");
  if (registry !== null) bundle.registryRuntime = { value: registry as RegistryRuntimeReadModel, versionId: refs["registry-runtime"]!.version };
  if (federal !== null) bundle.federalDirectory = { value: federal as FederalDirectoryReadModel, versionId: refs["federal-directory"]!.version };
  if (campaign !== null) bundle.campaignSites = { value: campaign as CuratedReaderProjection, versionId: refs["campaign-sites"]!.version };
  if (outcomes !== null) bundle.meetingOutcomes = { value: outcomes as OutcomeSnapshot, versionId: refs["meeting-outcomes"]!.version };
  if (commentAccess !== null) bundle.commentAccess = { value: commentAccess as import("../registry/comment-access.ts").CommentAccessProjection, versionId: refs["comment-access"]!.version };
  if (censusDistricts !== null) bundle.censusDistricts = { value: censusDistricts as CensusDistrictEdge, versionId: refs["census-districts"]!.version };
  const promoted = new Map<string, PromotedEdgeEntry>();
  const promotedFamilies = new Set<string>();
  const promotedValues = new Map<PromotedAuthorityFamily, unknown>();
  const load = async (family: PromotedAuthorityFamily) => promotedValues.set(family, await fetchWanted(family));
  await Promise.all(PROMOTED_AUTHORITY_FAMILIES.filter(family => family.startsWith("ballot-")).map(load));
  await Promise.all(PROMOTED_AUTHORITY_FAMILIES.filter(family => !family.startsWith("ballot-")).map(load));
  PROMOTED_AUTHORITY_FAMILIES.forEach(family => {
    const artifact = promotedValues.get(family) as Partial<PromotedFamilyArtifactValue> | null;
    if (artifact?.kind !== "PROMOTED_POINTERS" || !Array.isArray(artifact.entries)) return;
    promotedFamilies.add(family);
    for (const entry of artifact.entries) {
      const pointer = entry?.kind === "PROMOTED" ? entry.projection?.key : entry?.kind === "NOT_RECORDED" ? `${entry.recordClass}:${entry.scope}` : null;
      if (typeof pointer === "string") promoted.set(pointer, entry);
    }
  });
  const loadPromoted: NonNullable<ReaderAuthorityEdgeBundle["loadPromoted"]> = async (recordClass, scope) => {
    const family = promotedFamilyOf(recordClass, scope);
    selected?.keys.add(`pointer:${recordClass}:${scope}`);
    const artifact = await readServedPromotedFamily(family, refs[family], store);
    if (!artifact) return null;
    promotedFamilies.add(family);
    for (const entry of artifact.entries) {
      const key = entry.kind === "PROMOTED" ? entry.projection.key : `${entry.recordClass}:${entry.scope}`;
      promoted.set(key, entry);
    }
    return promoted.get(`${recordClass}:${scope}`) ?? null;
  };
  return { ...bundle, ...registrations, ...stateLegislators, promoted, promotedFamilies, loadPromoted,
    meetingPlaces: new Map([...new Set(states.flatMap(state => Object.keys(state.meetingPlaces)))].map(source =>
      [source,[...new Set(states.flatMap(state => state.meetingPlaces[source] ?? []))]])),
    ...(selected ? { selection: selected } : {}) };
}

function scopeDataSha(artifact: ReaderGeoArtifact): string {
  return sha256OfJson({ meetings: artifact.meetings, order: artifact.meetingOrder, agendaDocuments: artifact.agendaDocuments });
}

export async function publishReaderEdgeArtifacts(
  snapshot: MeetingsSnapshot | null,
  metadata: PublishMetadata,
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly now?: string;
    readonly extras?: PublishReaderExtras;
    readonly authority?: PublishAuthority;
    readonly registrations?: PublishRegistrations;
    readonly stateLegislators?: PublishRegistrations;
    readonly meetingBodies?: Parameters<typeof partitionSnapshotByScope>[2];
    readonly meetingRegistryVersion?: string | null;
    readonly meetingPlaces?: Readonly<Record<string, readonly string[]>>;
    readonly checks?: PublishReaderChecks;
  } = {},
): Promise<PublishReaderEdgeResult> {
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
  const authorityVersions = (m: Pick<ReaderManifest, "authorityArtifacts"> | undefined) =>
    AUTHORITY_FAMILIES.map((f) => `${f}=${m?.authorityArtifacts?.[f]?.version ?? ""}`).join("|");
  const newAuthorityVersions = AUTHORITY_FAMILIES
    .map((f) => `${f}=${options.authority?.[f]?.versionId ?? ""}`)
    .join("|");
  const registrationVersions = (entries: readonly (readonly [string, string])[] | null) =>
    entries === null ? "none" : entries.map(([state, version]) => `${state}=${version}`).sort().join("|");
  const newRegistrationVersions = registrationVersions(
    options.registrations === undefined ? null : Object.entries(options.registrations).map(([state, entry]) => [state, entry.versionId] as const),
  );
  const newLegislatorVersions = registrationVersions(options.stateLegislators === undefined ? null : Object.entries(options.stateLegislators).map(([scope, entry]) => [scope, entry.versionId] as const));
  const carriedSummary = snapshot ? snapshotClientMeta(snapshot).carried : undefined;

  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  if (current) {
    const currentDetails = snapshot !== null && current.manifest.scopeLayout === "states" ? (await readReaderStates(current.manifest.scopes, store, false)).flatMap(state => state.scopes) : [];
    const currentShas = new Map(currentDetails.map((s) => [s.scope, s.sha256]));
    const sameSet = snapshot === null || (currentShas.size === shaByScope.size &&
      [...shaByScope].every(([scope, sha]) => currentShas.get(scope) === sha));
    const sameExtras = options.extras === undefined ||
      sha256OfJson(options.extras.everydayRouting ?? null) === sha256OfJson(current.manifest.everydayRouting ?? null) &&
      sha256OfJson(options.extras.versionIds ?? null) === sha256OfJson(current.manifest.extrasVersionIds ?? null);
    const sameAuthority = options.authority === undefined || (authorityVersions(current.manifest) === newAuthorityVersions &&
      Object.values(current.manifest.authorityArtifacts ?? {}).every(ref => ref.layout === "places"));
    const sameRegistrations = options.registrations === undefined || registrationVersions(
      current.manifest.registrations === undefined ? null : Object.entries(current.manifest.registrations).map(([state, ref]) => [state, ref.version] as const),
    ) === newRegistrationVersions;
    const sameMeetingAreas = snapshot === null || options.meetingRegistryVersion === undefined ||
      current.manifest.meetingRegistryVersion === options.meetingRegistryVersion;
    const sameLegislators = options.stateLegislators === undefined || registrationVersions(current.manifest.stateLegislators === undefined ? null : Object.entries(current.manifest.stateLegislators).map(([scope, ref]) => [scope, ref.version] as const)) === newLegislatorVersions;
    const samePlaces = options.meetingPlaces === undefined || sha256OfJson(options.meetingPlaces) === current.manifest.meetingPlacesSha;
    const sameSummary = snapshot === null || JSON.stringify(carriedSummary) === JSON.stringify(current.manifest.carriedSummary);
    if (current.manifest.scopeLayout === "states" && sameSet && sameExtras && sameAuthority && sameRegistrations && sameLegislators && sameMeetingAreas && samePlaces && sameSummary) {
      const generatedAt = snapshot?.generatedAt || (options.checks ? laterCheck(current.manifest.generatedAt, metadata.retrievedAt) : null) || current.manifest.generatedAt;
      const checks = options.checks;
      if (manifestStatesChecks(current.manifest, generatedAt, checks)) {
        return { status: "CURRENT", sequence: current.manifest.sequence, scopes: current.manifest.scopes.length };
      }
      const sequence = current.manifest.sequence + 1;
      let written;
      try {
        written = await store.writeManifest(
          await updateStateChecks(manifestWithChecks(current.manifest, sequence, { generatedAt, retrievedAt: metadata.retrievedAt, checks }), checks, store),
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
  const changesGeography = snapshot !== null || options.meetingPlaces !== undefined || options.checks !== undefined;
  const priorStates = new Map<string, ReaderStateArtifact>();
  if (changesGeography && current?.manifest.scopeLayout === "states") for (const scope of current.manifest.scopes) {
    const state = await fetchReaderState(scope, store);
    if (!state) return { status: "FAILED", error: "Reader state artifact missing" };
    priorStates.set(scope.scope, state);
  }
  const manifestScopes: ReaderManifestScope[] = snapshot === null ? [...priorStates.values()].flatMap(state => state.scopes) : [];
  const authorityArtifacts: Partial<Record<AuthorityFamily, AuthorityArtifactRef>> = options.authority === undefined ? { ...current?.manifest.authorityArtifacts } : {};
  const registrations: Record<string, AuthorityArtifactRef> = options.registrations === undefined ? { ...current?.manifest.registrations } : {};
  const stateLegislators: Record<string, AuthorityArtifactRef> = options.stateLegislators === undefined ? { ...current?.manifest.stateLegislators } : {};
  try {
    for (const artifact of artifacts) {
      const unchanged = [...priorStates.values()].flatMap(state => state.scopes).find(scope => scope.scope === artifact.scope && scope.sha256 === shaByScope.get(artifact.scope));
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
    for (const family of AUTHORITY_FAMILIES) {
      const entry = options.authority?.[family];
      if (!entry) continue;
      if ("carried" in entry) {
        const served = current?.manifest.authorityArtifacts?.[family];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        authorityArtifacts[family] = served;
        continue;
      }
      const indexed = "index" in entry ? entry.index : await publishAuthorityRecords(entry.value, store, await publishedRecords(current?.manifest.authorityArtifacts?.[family], store));
      const envelope: AuthorityArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family,
        versionId: entry.versionId,
        generatedAt: now,
        value: indexed,
      };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      authorityArtifacts[family] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "places" };
    }
    for (const [state, entry] of Object.entries(options.registrations ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.registrations?.[state];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        registrations[state] = served;
        continue;
      }
      const indexed = await publishAuthorityRecords(entry.value, store, await publishedRecords(current?.manifest.registrations?.[state], store));
      const envelope: RegistrationArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family: "registration",
        state,
        versionId: entry.versionId,
        generatedAt: now,
        value: indexed as unknown as RegistrationReadModel,
      };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      registrations[state] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "places" };
    }
    for (const [jurisdiction, entry] of Object.entries(options.stateLegislators ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.stateLegislators?.[jurisdiction];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        stateLegislators[jurisdiction] = served;
        continue;
      }
      const indexed = await publishAuthorityRecords(entry.value, store, await publishedRecords(current?.manifest.stateLegislators?.[jurisdiction], store));
      const envelope: StateLegislatorsArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "state-legislators", jurisdiction, versionId: entry.versionId, generatedAt: now, value: indexed as unknown as OfficialStateLegislatorReadModel };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      stateLegislators[jurisdiction] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "places" };
    }
  } catch (error) {
    // Complete immutable bytes precede CAS; partial writes cannot change a served artifact.
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  const stateNames = new Set([...priorStates.keys(), ...manifestScopes.map(scope => stateOfOcdId(scope.ocdId) ?? "us")]);
  const places = new Map<string, Record<string, readonly string[]>>();
  for (const [source, ids] of Object.entries(options.meetingPlaces ?? {})) for (const state of new Set(ids.map(id => stateOfOcdId(id) ?? "us"))) {
    const rows = places.get(state) ?? {};
    rows[source] = ids.filter(id => (stateOfOcdId(id) ?? "us") === state);
    places.set(state, rows); stateNames.add(state);
  }
  const reports = new Map<string, import("./snapshot.ts").SnapshotSourceReport[]>();
  for (const source of snapshot?.sources ?? []) {
    const state = stateOfOcdId(source.bodyId) ?? stateOfOcdId(source.unreachableOcdIds?.[0]) ?? "us";
    reports.set(state, [...reports.get(state) ?? [], source]); stateNames.add(state);
  }
  const checksByState = new Map<string, Record<string, string>>();
  for (const [route, at] of Object.entries(options.checks?.freshChecks ?? {})) {
    const state = stateOfOcdId(route) ?? "us";
    const rows = checksByState.get(state) ?? {}; rows[route] = at;
    checksByState.set(state, rows); stateNames.add(state);
  }
  const stateScopes: ReaderManifestScope[] = changesGeography ? [] : [...current?.manifest.scopes ?? []];
  for (const state of [...stateNames].sort()) {
    const old = priorStates.get(state);
    const artifact: ReaderStateArtifact = {
      sources: snapshot === null ? old?.sources ?? [] : reports.get(state) ?? [],
      freshChecks: options.checks === undefined ? old?.freshChecks ?? {} : checksByState.get(state) ?? {},
      scopes: manifestScopes.filter(scope => (stateOfOcdId(scope.ocdId) ?? "us") === state),
      meetingPlaces: options.meetingPlaces === undefined ? old?.meetingPlaces ?? {} : places.get(state) ?? {},
    };
    const sha256 = sha256OfJson(artifact);
    const previous = current?.manifest.scopes.find(scope => scope.scope === state && scope.sha256 === sha256);
    const bounds = artifact.scopes.reduce<import("./edge-artifacts.ts").ReaderAreaBounds | undefined>((held, scope) => scope.bounds ? {
      south: Math.min(held?.south ?? scope.bounds.south, scope.bounds.south), north: Math.max(held?.north ?? scope.bounds.north, scope.bounds.north),
      west: Math.min(held?.west ?? scope.bounds.west, scope.bounds.west), east: Math.max(held?.east ?? scope.bounds.east, scope.bounds.east),
    } : held, undefined);
    stateScopes.push(previous ?? { scope: state, ...(bounds ? { bounds } : {}), key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(artifact))), "json.gz"), sha256,
      meetingCount: artifact.scopes.reduce((sum, scope) => sum + scope.meetingCount, 0), generatedAt: now });
  }
  const summary = snapshot ? carriedSummary : current?.manifest.carriedSummary;
  const manifest: ReaderManifest = {
    ...(summary ? { carriedSummary: summary } : {}),
    scopeLayout: "states",
    meetingPlacesSha: options.meetingPlaces === undefined ? current?.manifest.meetingPlacesSha : sha256OfJson(options.meetingPlaces),
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
    scopes: stateScopes,
    ...(options.extras === undefined ? {
      ...(current?.manifest.everydayRouting !== undefined ? { everydayRouting: current.manifest.everydayRouting } : {}),
      ...(current?.manifest.extrasVersionIds !== undefined ? { extrasVersionIds: current.manifest.extrasVersionIds } : {}),
    } : {
      ...(options.extras.everydayRouting !== undefined ? { everydayRouting: options.extras.everydayRouting } : {}),
      ...(options.extras.versionIds !== undefined ? { extrasVersionIds: options.extras.versionIds } : {}),
    }),
    ...(Object.keys(authorityArtifacts).length > 0 ? { authorityArtifacts } : {}),
    ...(options.registrations !== undefined || current?.manifest.registrations !== undefined ? { registrations } : {}),
    ...(options.stateLegislators !== undefined || current?.manifest.stateLegislators !== undefined ? { stateLegislators } : {}),
    ...(options.checks ? { checksSha: sha256OfJson(options.checks.freshChecks) } : current?.manifest.checksSha ? { checksSha: current.manifest.checksSha } : {}),
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
  const fallback = () => {
    const selection = currentReaderSelection();
    return withReaderSelection(selection ? { ...selection, radiusKm: options.nearby?.radiusKm ?? selection.radiusKm, includeAgenda: options.includeAgenda, meetingId: options.meetingId } : undefined,
      options.fallback ?? (() => readPreparedMeetingsProjection(options.now ? { now: options.now } : {})));
  };
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

  let stateArtifacts: ReaderStateArtifact[];
  try { stateArtifacts = await readReaderStates(manifest.scopes, store); } catch { return fallback(); }
  const needed = stateArtifacts.flatMap(state => state.scopes).filter(scope => readerScopeApplies(scope, options));
  const areaKey = sha256OfJson({ sequence: manifest.sequence, generatedAt: manifest.generatedAt,
    sourceThrough: manifest.sourceThrough, retrievedAt: manifest.retrievedAt, promotedThrough: manifest.promotedThrough,
    states: stateArtifacts.map(state => stateArtifactVersions.get(state)), scopes: needed.map(({ scope, sha256 }) => [scope, sha256]) });
  const cachedArea = areaReads.get(areaKey);
  if (cachedArea) return cachedArea;

  let artifacts: ReaderGeoArtifact[];
  try {
    artifacts = [];
    for (let at = 0; at < needed.length; at += 8) {
      const batch = await Promise.all(needed.slice(at, at + 8).map(scope => fetchScopeArtifact(scope, store)));
      artifacts.push(...batch.filter((artifact): artifact is ReaderGeoArtifact => artifact !== null));
    }
  } catch {
    return fallback();
  }
  if (artifacts.length !== needed.length) return fallback();

  const value = applyMeetingFreshChecks(mergeScopeArtifacts(artifacts, { generatedAt: manifest.generatedAt,
    sources: stateArtifacts.flatMap(state => state.sources) }), { checkedAt: null,
    routes: Object.assign({}, ...stateArtifacts.map(state => state.freshChecks)) });
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
    if (areaReads.size >= 4) areaReads.delete(areaReads.keys().next().value!);
    areaReads.set(areaKey, read);
  }
  return read;
}

export function servedWholeFromReaderEdge(read: MeetingsProjectionReadResult): boolean {
  return completeEdgeReads.has(read);
}
