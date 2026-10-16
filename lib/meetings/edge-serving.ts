import { publishAuthorityRecords, readAuthorityRecords, type RecordIndex } from "./authority-records.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { gzipSync, gunzipSync } from "node:zlib";

import {
  mergeScopeArtifacts,
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
} from "./edge-artifacts.ts";
import type { RegistryRuntimeCarton, RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { CommentAccessProjection } from "../registry/comment-access.ts";
import { withStateFacts, type BodyFacts } from "../facts/registry-overlay.ts";
import { factReader } from "../facts/db.ts";
import { readSittingFacts, withSittingFacts } from "../facts/meeting-read.ts";
import type { Meeting } from "../sources/types.ts";
import type { StateFactsIndex } from "../facts/state-facts-publication.ts";
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
import { applyMeetingFreshChecks, laterCheck, sameMeetingFreshChecks } from "./fresh-checks.ts";
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
    (manifest.composition ?? null) === (checks?.composition ?? null) &&
    sameMeetingFreshChecks(manifest.freshChecks, checks?.freshChecks);
}

function manifestWithChecks(
  manifest: ReaderManifest,
  sequence: number,
  update: { readonly generatedAt: string; readonly retrievedAt: string | null; readonly checks: PublishReaderChecks | undefined },
): ReaderManifest {
  const { freshChecks: _freshChecks, composition: _composition, ...rest } = manifest;
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
  if (manifestStatesChecks(current.manifest, generatedAt, update.checks)) {
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
export type PublishAuthority = Partial<Record<Exclude<AuthorityFamily, "ballot-navigation">, PublishAuthorityValue | PublishAuthorityCarried>>;
/** Complete: one entry per promoted registration pointer, since the reader reads an unnamed state as having none. */
export type PublishBallotNavigation = AsyncIterable<readonly [string, PublishAuthorityValue | PublishAuthorityCarried]>;
export type PublishRegistrations = Readonly<Record<string, PublishAuthorityValue | PublishAuthorityCarried>>;

interface RegistrationArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "registration";
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

interface StateFactsArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "state-facts";
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: StateFactsIndex;
}

interface FactBucketArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "fact-bucket";
  readonly state: string;
  readonly bucket: number;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: RecordIndex;
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
  return ref?.layout === "records" ? ref.version : null;
}

interface AuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: AuthorityFamily;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

function extrasFingerprint(extras: PublishReaderExtras | undefined): string {
  return sha256OfJson({
    everydayRouting: extras?.everydayRouting ?? null,
    versionIds: extras?.versionIds ?? null,
  });
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

const STATE_BALLOT_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = PROMOTED_AUTHORITY_FAMILIES.filter((family) => /^ballot-[a-z]{2}$/.test(family));

export const READER_FUNDING_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "registry-runtime",
  "federal-directory",
  "federal-funding",
  "state-money",
  ...STATE_BALLOT_AUTHORITY_FAMILIES,
];

const ASK_ONLY_AUTHORITY_FAMILIES: ReadonlySet<AuthorityFamily> = new Set<AuthorityFamily>([
  "state-votes",
  "prl-profiles",
  "pima-finance",
  "federal-votes",
  "federal-key-votes",
  "officeholder-statements",
  "executive-actions",
]);

export const READER_BALLOT_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  ...READER_MAP_AUTHORITY_FAMILIES,
  ...PROMOTED_AUTHORITY_FAMILIES.filter((family) => !ASK_ONLY_AUTHORITY_FAMILIES.has(family)),
];

const authorityValueCache = new Map<string, { version: string; value: Promise<unknown | null> }>();
const authorityEdgeCache = new Map<string, { version: string; value: Promise<unknown | null> }>();

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

async function publishedRecords(ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore): Promise<RecordIndex | undefined> {
  if (ref?.layout !== "records") return undefined;
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes) return undefined;
    const { value } = JSON.parse(gunzipSync(bytes).toString("utf8")) as { value: RecordIndex };
    return value.kind === "READER_RECORDS" && sha256OfJson(value) === ref.sha ? value : undefined;
  } catch { return undefined; }
}

export async function readAuthorityArtifactValue(
  family: AuthorityFamily,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<unknown | null> {
  if (!ref?.key || !ref.version || ref.layout !== "records") return null;
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
  });
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
  for (const scope of manifest.scopes) if (wanted.has(scope.scope)) void fetchScopeArtifact(scope, store).catch(() => undefined);
  for (const state of states) {
    const ref = manifest.registrations?.[state];
    if (ref) void fetchRegistrationArtifact(state, ref, store);
  }
}

const stateFactsEdgeCache = new Map<string, { version: string; value: Promise<StateFactsIndex | null> }>();
const factBucketEdgeCache = new Map<string, { version: string; value: Promise<RecordIndex | null> }>();
const mergedRegistryCache = new Map<string, { version: string; value: Promise<RegistryRuntimeReadModel | null> }>();

async function readEnvelope<T extends { readonly value: unknown; readonly versionId: string }>(ref: AuthorityArtifactRef, store: ReaderArtifactStore,
  belongs: (envelope: T) => boolean): Promise<T["value"] | null> {
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes) return null;
    const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as T;
    return belongs(envelope) && envelope.versionId === ref.version && sha256OfJson(envelope.value) === ref.sha ? envelope.value : null;
  } catch { return null; }
}

/** One state's served bucket list, read once per version per process. */
export async function readServedStateFactsIndex(state: string, ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore): Promise<StateFactsIndex | null> {
  if (!ref?.key || !ref.version) return null;
  return heldFetch(stateFactsEdgeCache, state, `${ref.version}:${ref.key}`,
    () => readEnvelope<StateFactsArtifactEnvelope>(ref, store, envelope => envelope.family === "state-facts" && envelope.state === state));
}

/** One bucket's record index, read once per version per process; its records are fetched only as a selection needs them. */
export async function readServedFactBucket(state: string, bucket: number, ref: AuthorityArtifactRef, store: ReaderArtifactStore): Promise<RecordIndex | null> {
  return heldFetch(factBucketEdgeCache, `${state}/${bucket}`, `${ref.version}:${ref.key}`,
    () => readEnvelope<FactBucketArtifactEnvelope>(ref, store, envelope => envelope.family === "fact-bucket" && envelope.state === state && envelope.bucket === bucket));
}

/** One body's facts as an immutable record, ahead of the bucket index that will name it. */
export async function writeFactRecord(store: ReaderArtifactStore, value: BodyFacts): Promise<{ readonly key: string; readonly sha: string }> {
  return { key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(value), "utf8")), "json.gz"), sha: sha256OfJson(value) };
}

export async function writeFactBucket(store: ReaderArtifactStore, state: string, bucket: number, versionId: string, index: RecordIndex, now: string): Promise<AuthorityArtifactRef> {
  const envelope: FactBucketArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "fact-bucket", state, bucket, versionId, generatedAt: now, value: index };
  return { key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz"), version: versionId, sha: sha256OfJson(index) };
}

/** The facts of every body a reader's selection names, from the states it touches; every body when there is no selection. */
async function readStateFacts(refs: readonly (readonly [string, AuthorityArtifactRef])[], store: ReaderArtifactStore,
  selection: ReturnType<typeof currentReaderSelection>): Promise<BodyFacts[] | null> {
  const states = selection ? new Set([...selection.keys].flatMap(key => /^ocd-division\/country:us\/state:([a-z]{2})/.exec(key)?.[1]?.toUpperCase() ?? [])) : null;
  const read = await Promise.all(refs.filter(([state]) => states === null || states.has(state)).map(async ([state, ref]) => {
    const index = await readServedStateFactsIndex(state, ref, store);
    if (!index) return null;
    const buckets = await Promise.all(index.buckets.map((bucket, n) => bucket ? readServedFactBucket(state, n, bucket, store) : null));
    if (index.buckets.some((bucket, n) => bucket !== null && buckets[n] === null)) return null;
    const bodies = await Promise.all(buckets.flatMap(bucket => bucket ? [readAuthorityRecords(bucket, store, selection) as Promise<{ bodies: BodyFacts[] }>] : []));
    return bodies.flatMap(row => row.bodies);
  }).map(state => state.catch(() => null)));
  return read.some(state => state === null) ? null : read.flat() as BodyFacts[];
}

export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderManifest, "authorityArtifacts" | "registrations" | "stateLegislators" | "ballotNavigation" | "meetingPlaces" | "stateFacts">,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  families: readonly AuthorityFamily[] = AUTHORITY_FAMILIES,
): Promise<ReaderAuthorityEdgeBundle> {
  const refs = manifest.authorityArtifacts;
  const registrationRefs = manifest.registrations;
  const registrations = registrationRefs && store
    ? { registrations: { states: new Set(Object.keys(registrationRefs)), load: (state: string) => fetchRegistrationArtifact(state, registrationRefs[state], store) } }
    : {};
  const navigationLoads = new Map<string, Promise<PromotedEdgeEntry | null>>();
  const ballotNavigation = store && families.includes("ballot-navigation") ? { ballotNavigation: { load: (state: string) => {
    let pending = navigationLoads.get(state);
    if (!pending) {
      pending = (async () => {
        const value = await readAuthorityArtifactValue("ballot-navigation", manifest.ballotNavigation?.[state], store) as PromotedFamilyArtifactValue | null;
        const entry = value?.kind === "PROMOTED_POINTERS" && value.entries.length === 1 ? value.entries[0] : null;
        const scope = entry?.kind === "PROMOTED" ? entry.projection.scope : entry?.scope;
        return scope === `US-${state}:official-ballot-navigation` ? entry : null;
      })();
      navigationLoads.set(state, pending);
    }
    return pending;
  } } } : {};
  const stateLegislatorRefs = manifest.stateLegislators;
  const stateLegislators: { stateLegislators?: ReaderAuthorityEdgeBundle["stateLegislators"] } = {};
  if (store && families.includes("state-legislators")) {
    if (stateLegislatorRefs) {
      stateLegislators.stateLegislators = { jurisdictions: new Set(Object.keys(stateLegislatorRefs)),
        load: (jurisdiction: string) => fetchStateLegislatorsArtifact(jurisdiction, stateLegislatorRefs[jurisdiction], store) };
    }
  }
  if (!refs || !store) return { ...registrations, ...stateLegislators, ...ballotNavigation };
  const bundle: {
    censusDistricts?: { value: CensusDistrictEdge; versionId: string };
    registryRuntime?: { value: RegistryRuntimeReadModel; versionId: string };
    federalDirectory?: { value: FederalDirectoryReadModel; versionId: string };
    campaignSites?: { value: CuratedReaderProjection; versionId: string };
    meetingOutcomes?: { value: OutcomeSnapshot; versionId: string };
    commentAccess?: { value: CommentAccessProjection; versionId: string };
  } = {};
  const wanted = new Set(families);
  const fetchWanted = (family: AuthorityFamily) =>
    wanted.has(family) ? readAuthorityArtifactValue(family, refs[family], store) : Promise.resolve(null);
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
  // Each body's facts lay on the partition; comment rules come from the same records.
  const stateFactRefs = Object.entries(manifest.stateFacts ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const factsVersion = sha256OfJson(stateFactRefs.map(([state, ref]) => [state, ref.version])).slice(0, 16);
  const [registry, federal, campaign, outcomes, bodies] = await Promise.all([
    fetchWanted("registry-runtime"),
    fetchWanted("federal-directory"),
    fetchWanted("campaign-sites"),
    fetchWanted("meeting-outcomes"),
    wanted.has("registry-runtime") ? readStateFacts(stateFactRefs, store, selected) : Promise.resolve([]),
  ]);
  if (registry !== null && bodies !== null) {
    const versionId = stateFactRefs.length ? `${refs["registry-runtime"]!.version}+${factsVersion}` : refs["registry-runtime"]!.version;
    const value = selected ? withStateFacts(registry as RegistryRuntimeCarton, bodies)
      : await heldFetch(mergedRegistryCache, "registry-runtime", versionId, async () => withStateFacts(registry as RegistryRuntimeCarton, bodies));
    if (value) bundle.registryRuntime = { value, versionId };
    if (stateFactRefs.length) bundle.commentAccess = { versionId: factsVersion, value: { kind: "comment-access",
      records: bodies.flatMap(body => body.comment ? [{ id: `comment-access:${body.id}`, ...body.comment }] : []) } };
  }
  if (federal !== null) bundle.federalDirectory = { value: federal as FederalDirectoryReadModel, versionId: refs["federal-directory"]!.version };
  if (campaign !== null) bundle.campaignSites = { value: campaign as CuratedReaderProjection, versionId: refs["campaign-sites"]!.version };
  if (outcomes !== null) bundle.meetingOutcomes = { value: outcomes as OutcomeSnapshot, versionId: refs["meeting-outcomes"]!.version };
  if (censusDistricts !== null) bundle.censusDistricts = { value: censusDistricts as CensusDistrictEdge, versionId: refs["census-districts"]!.version };
  const promoted = new Map<string, PromotedEdgeEntry>();
  const promotedFamilies = new Set<string>();
  const promotedValues = new Map<PromotedAuthorityFamily, unknown>();
  const load = async (family: PromotedAuthorityFamily) => promotedValues.set(family, await fetchWanted(family));
  await Promise.all(PROMOTED_AUTHORITY_FAMILIES.filter(family => family.startsWith("ballot-") && family !== "ballot-navigation").map(load));
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
    const family: PromotedAuthorityFamily = recordClass === "STATE_ROLL_CALL" || recordClass === "STATE_LEGISLATOR_VOTES" ? "state-votes"
      : recordClass === "PRL_PROFILE" ? "prl-profiles" : recordClass === "PRL_ARCHIVE" ? "prl-archives" : "other-reader-data";
    const artifact = await readServedPromotedFamily(family, refs[family], store);
    if (!artifact) return null;
    promotedFamilies.add(family);
    for (const entry of artifact.entries) {
      const key = entry.kind === "PROMOTED" ? entry.projection.key : `${entry.recordClass}:${entry.scope}`;
      promoted.set(key, entry);
    }
    return promoted.get(`${recordClass}:${scope}`) ?? null;
  };
  return { ...bundle, ...registrations, ...stateLegislators, ...ballotNavigation, promoted, promotedFamilies, loadPromoted,
    ...(manifest.meetingPlaces ? { meetingPlaces: new Map(Object.entries(manifest.meetingPlaces)) } : {}),
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
    readonly ballotNavigation?: PublishBallotNavigation;
    /** Complete: one entry per state with live facts. */
    readonly stateFacts?: PublishRegistrations;
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
  const extrasSha = extrasFingerprint(options.extras);
  const authorityFamilies = AUTHORITY_FAMILIES.filter((family): family is Exclude<AuthorityFamily, "ballot-navigation"> => family !== "ballot-navigation");
  const authorityVersions = (m: Pick<ReaderManifest, "authorityArtifacts"> | undefined) =>
    authorityFamilies.map((f) => `${f}=${m?.authorityArtifacts?.[f]?.version ?? ""}`).join("|");
  const newAuthorityVersions = authorityFamilies
    .map((f) => `${f}=${options.authority?.[f]?.versionId ?? ""}`)
    .join("|");
  const registrationVersions = (entries: readonly (readonly [string, string])[] | null) =>
    entries === null ? "none" : entries.map(([state, version]) => `${state}=${version}`).sort().join("|");
  const newRegistrationVersions = registrationVersions(
    options.registrations === undefined ? null : Object.entries(options.registrations).map(([state, entry]) => [state, entry.versionId] as const),
  );
  const newLegislatorVersions = registrationVersions(options.stateLegislators === undefined ? null : Object.entries(options.stateLegislators).map(([scope, entry]) => [scope, entry.versionId] as const));
  const newStateFactVersions = registrationVersions(options.stateFacts === undefined ? null : Object.entries(options.stateFacts).map(([state, entry]) => [state, entry.versionId] as const));
  const carriedSummary = snapshot ? snapshotClientMeta(snapshot).carried : undefined;

  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  const ballotNavigation: Record<string, AuthorityArtifactRef> = { ...current?.manifest.ballotNavigation };
  try {
    if (options.ballotNavigation) for await (const [state, entry] of options.ballotNavigation) {
      if ("carried" in entry) {
        const served = current?.manifest.ballotNavigation?.[state];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence: (current?.manifest.sequence ?? 0) + 1 };
        ballotNavigation[state] = served;
      } else {
        const indexed = await publishAuthorityRecords(entry.value, store, await publishedRecords(current?.manifest.ballotNavigation?.[state], store));
        const envelope: AuthorityArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION,
          family: "ballot-navigation", versionId: entry.versionId, generatedAt: now, value: indexed };
        const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
        ballotNavigation[state] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "records" };
      }
    }
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  if (current) {
    const currentShas = new Map(current.manifest.scopes.map((s) => [s.scope, s.sha256]));
    const sameSet = snapshot === null || (currentShas.size === shaByScope.size &&
      [...shaByScope].every(([scope, sha]) => currentShas.get(scope) === sha));
    const sameExtras = options.extras === undefined || extrasFingerprint({
      everydayRouting: current.manifest.everydayRouting,
      versionIds: current.manifest.extrasVersionIds,
    }) === extrasSha;
    const sameAuthority = options.authority === undefined || (authorityVersions(current.manifest) === newAuthorityVersions &&
      Object.values(current.manifest.authorityArtifacts ?? {}).every(ref => ref.layout === "records"));
    const sameRegistrations = options.registrations === undefined || registrationVersions(
      current.manifest.registrations === undefined ? null : Object.entries(current.manifest.registrations).map(([state, ref]) => [state, ref.version] as const),
    ) === newRegistrationVersions;
    const sameMeetingAreas = snapshot === null || options.meetingRegistryVersion === undefined ||
      current.manifest.meetingRegistryVersion === options.meetingRegistryVersion;
    const sameLegislators = options.stateLegislators === undefined || registrationVersions(current.manifest.stateLegislators === undefined ? null : Object.entries(current.manifest.stateLegislators).map(([scope, ref]) => [scope, ref.version] as const)) === newLegislatorVersions;
    const sameNavigation = options.ballotNavigation === undefined || !current.manifest.authorityArtifacts?.["ballot-navigation"] &&
      Object.values(current.manifest.ballotNavigation ?? {}).every(ref => ref.layout === "records") &&
      registrationVersions(Object.entries(current.manifest.ballotNavigation ?? {}).map(([state, ref]) => [state, ref.version] as const)) ===
      registrationVersions(Object.entries(ballotNavigation).map(([state, ref]) => [state, ref.version] as const));
    const samePlaces = options.meetingPlaces === undefined || JSON.stringify(options.meetingPlaces) === JSON.stringify(current.manifest.meetingPlaces);
    const sameSummary = snapshot === null || JSON.stringify(carriedSummary) === JSON.stringify(current.manifest.carriedSummary);
    const sameStateFacts = options.stateFacts === undefined || registrationVersions(current.manifest.stateFacts === undefined ? null
      : Object.entries(current.manifest.stateFacts).map(([state, ref]) => [state, ref.version] as const)) === newStateFactVersions;
    if (sameSet && sameExtras && sameAuthority && sameRegistrations && sameLegislators && sameStateFacts && sameMeetingAreas && samePlaces && sameSummary && sameNavigation) {
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
  const authorityArtifacts: Partial<Record<AuthorityFamily, AuthorityArtifactRef>> = options.authority === undefined ? { ...current?.manifest.authorityArtifacts } : {};
  const registrations: Record<string, AuthorityArtifactRef> = options.registrations === undefined ? { ...current?.manifest.registrations } : {};
  if (options.ballotNavigation !== undefined) delete authorityArtifacts["ballot-navigation"];
  const stateLegislators: Record<string, AuthorityArtifactRef> = options.stateLegislators === undefined ? { ...current?.manifest.stateLegislators } : {};
  const stateFacts: Record<string, AuthorityArtifactRef> = options.stateFacts === undefined ? { ...current?.manifest.stateFacts } : {};
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
    for (const family of authorityFamilies) {
      const entry = options.authority?.[family];
      if (!entry) continue;
      if ("carried" in entry) {
        const served = current?.manifest.authorityArtifacts?.[family];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        authorityArtifacts[family] = served;
        continue;
      }
      const indexed = await publishAuthorityRecords(entry.value, store, await publishedRecords(current?.manifest.authorityArtifacts?.[family], store));
      const envelope: AuthorityArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family,
        versionId: entry.versionId,
        generatedAt: now,
        value: indexed,
      };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      authorityArtifacts[family] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "records" };
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
      registrations[state] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "records" };
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
      stateLegislators[jurisdiction] = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "records" };
    }
    for (const [state, entry] of Object.entries(options.stateFacts ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.stateFacts?.[state];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        stateFacts[state] = served;
        continue;
      }
      const envelope: StateFactsArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "state-facts", state, versionId: entry.versionId, generatedAt: now, value: entry.value as StateFactsIndex };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      stateFacts[state] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
  } catch (error) {
    // Complete immutable bytes precede CAS; partial writes cannot change a served artifact.
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  const summary = snapshot ? carriedSummary : current?.manifest.carriedSummary;
  const manifest: ReaderManifest = {
    ...(summary ? { carriedSummary: summary } : {}),
    ...(options.meetingPlaces ?? current?.manifest.meetingPlaces ? { meetingPlaces: options.meetingPlaces ?? current?.manifest.meetingPlaces } : {}),
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
    ...(options.ballotNavigation !== undefined || current?.manifest.ballotNavigation !== undefined ? { ballotNavigation } : {}),
    ...(options.stateFacts !== undefined || current?.manifest.stateFacts !== undefined ? { stateFacts } : {}),
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
  const fallback = async () => withStoredSittingFacts(await (options.fallback ?? (() => readPreparedMeetingsProjection(options.now ? { now: options.now } : {})))());
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
  if (artifacts.length !== needed.length) return fallback();

  const merged = applyMeetingFreshChecks(mergeScopeArtifacts(artifacts, manifest), { checkedAt: null, routes: manifest.freshChecks ?? {} });
  // Each served sitting takes its body's live facts from that body's record.
  const bodies = await readStateFacts(Object.entries(manifest.stateFacts ?? {}), store, { keys: new Set(sittingBodies(merged.meetings)) });
  const value = { ...merged, meetings: withSittingFacts(merged.meetings, bodies?.flatMap(body => body.sittings) ?? []) };
  const complete = artifacts.length === needed.length && bodies !== null;
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

const sittingBodies = (meetings: readonly Meeting[]) => [...new Set(meetings.flatMap(meeting => meeting.bodyId ?? []))];

/** Off the edge, sittings take their live facts from the fact store; without one, or while it fails, the partition rows stand. */
async function withStoredSittingFacts(read: MeetingsProjectionReadResult): Promise<MeetingsProjectionReadResult> {
  const query = factReader();
  if (read.kind !== "PROMOTED" || query === null) return read;
  const facts = await readSittingFacts(query, sittingBodies(read.value.meetings)).catch(() => null);
  return facts?.size ? { ...read, value: { ...read.value, meetings: withSittingFacts(read.value.meetings, [...facts.values()].flat()) } } : read;
}

export function servedWholeFromReaderEdge(read: MeetingsProjectionReadResult): boolean {
  return completeEdgeReads.has(read);
}
