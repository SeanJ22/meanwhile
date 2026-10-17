import { publishAuthorityRecords, readAuthorityRecords, type RecordIndex } from "./authority-records.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { createHash } from "node:crypto";
import { statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { stateAuthorityPointers } from "../civic-data/state-reader.ts";
import { readPromotedCivicData, registerIntegrityCheckedEdgeEntries } from "../civic-data/read-model.ts";
import { gzipSync, gunzipSync, createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  GLOBAL_AUTHORITY_FAMILIES,
  mergeScopeArtifacts,
  partitionSnapshotByScope,
  readerScopeApplies,
  scopesForStates,
  sha256OfJson,
  AUTHORITY_FAMILIES,
  STATE_AUTHORITY_FAMILIES,
  type StateAuthorityFamily,
  type GlobalAuthorityFamily,
  type GlobalPromotedAuthorityFamily,
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
import type { CommentAccessProjection } from "../registry/comment-access.ts";
import { type BodyFacts } from "../facts/registry-overlay.ts";
import { factReader } from "../facts/db.ts";
import { readSittingFacts, withSittingFacts } from "../facts/meeting-read.ts";
import type { Meeting } from "../sources/types.ts";
import type { StateFactsPointer } from "../facts/state-facts-publication.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import { currentReaderAuthorityEdge, reportReaderStateFailure, type ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import type { CensusDistrictEdge } from "../census-geography/district-edge.ts";
import type { CodeSlice, Slice } from "../control-plane/admin-view/promoted-slices.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import {
  READER_MANIFEST_KEY,
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

const MANIFEST_FIELDS: readonly (keyof ReaderManifest)[] = ["carriedSummary", "meetingPlaces", "meetingLayout", "meetingRegistryVersion", "formatVersion",
  "sequence", "generatedAt", "sourceThrough", "retrievedAt", "promotedThrough", "sources", "scopes", "freshChecks", "composition"];

// A served manifest holding any other field is rewritten without it.
function manifestStatesChecks(manifest: ReaderManifest, generatedAt: string, checks: PublishReaderChecks | undefined): boolean {
  return Object.keys(manifest).every(key => (MANIFEST_FIELDS as readonly string[]).includes(key)) && manifest.generatedAt === generatedAt &&
    (manifest.composition ?? null) === (checks?.composition ?? null) &&
    sameMeetingFreshChecks(manifest.freshChecks, checks?.freshChecks);
}

function manifestWithChecks(
  manifest: ReaderManifest,
  sequence: number,
  update: { readonly generatedAt: string; readonly retrievedAt: string | null; readonly checks: PublishReaderChecks | undefined },
): ReaderManifest {
  const { freshChecks: _freshChecks, composition: _composition, ...rest } = Object.fromEntries(
    MANIFEST_FIELDS.flatMap(field => manifest[field] === undefined ? [] : [[field, manifest[field]]])) as unknown as ReaderManifest;
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

export interface PublishAuthorityValue {
  readonly value: unknown;
  readonly versionId: string;
}
export interface PublishedStateAuthority {
  readonly versionId: string;
  readonly artifact: AuthorityArtifactRef;
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

/** A family that grows with places keeps one pointer per state (or jurisdiction); the rest keep one each. */
export type AuthorityPointerFamily = GlobalAuthorityFamily | "registrations";

interface AuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: AuthorityPointerFamily;
  readonly place?: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

export const authorityPointerKey = (family: AuthorityPointerFamily | StateAuthorityFamily, place?: string) =>
  place === undefined ? `reader/authority/${family}.json` : `reader/authority/${family}/${place}.json`;

/** Families whose pointers multiply with places publish one pointer per state their scopes name, and "US" for the rest. */
export const PLACE_SPLIT_FAMILIES: ReadonlySet<GlobalPromotedAuthorityFamily> = new Set(["state-votes", "state-money", "other-reader-data"]);
export const authorityPlaceOfScope = (scope: string) =>
  /^US-([A-Z]{2})(?::|$)/.exec(scope)?.[1] ?? /\/(?:state|district|territory):([a-z]{2})(?:\/|$)/.exec(scope)?.[1]?.toUpperCase() ?? "US";

export interface ServedPointer {
  readonly ref: AuthorityArtifactRef;
  readonly etag: string | null;
}

/** The pointer as the publisher sees it, unheld, with the etag its next write compares against. */
export async function readServedPointer(store: ReaderArtifactStore, key: string): Promise<ServedPointer | null> {
  const read = await store.readJsonPointer<AuthorityArtifactRef>(key);
  return read ? { ref: read.value, etag: read.etag } : null;
}

/** Writes one family's value (one place's, when it has one) as records to its own pointer; false when another writer moved it first. */
export async function writeAuthorityPointer(store: ReaderArtifactStore, family: AuthorityPointerFamily, place: string | undefined,
  entry: PublishAuthorityValue, served: ServedPointer | null, now: string): Promise<boolean> {
  const indexed = await publishAuthorityRecords(entry.value, store, await publishedRecords(served?.ref, store));
  const envelope: AuthorityArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family, ...(place === undefined ? {} : { place }),
    versionId: entry.versionId, generatedAt: now, value: indexed };
  const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
  const ref: AuthorityArtifactRef = { key, version: entry.versionId, sha: sha256OfJson(indexed), layout: "records" };
  return (await store.writeJsonPointer(authorityPointerKey(family, place), ref, served?.etag ?? null)).modified;
}

// Blobs reads are eventually consistent (up to 60 s behind a write); holding adds at most this much to that window.
export const READER_MANIFEST_MEMO_MS = 15_000;
let manifestMemo: { readonly at: number; readonly value: Promise<ReaderManifest | null> } | null = null;

async function readManifestFrom(store: ReaderArtifactStore): Promise<ReaderManifest | null> {
  try {
    const stored = await store.readManifest();
    return stored?.manifest ?? null;
  } catch (error) {
    return holdReaderAuthorityEdge(error);
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
  "everyday-routing",
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
  "candidate-profiles",
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
  ...STATE_AUTHORITY_FAMILIES.filter(family => family !== "registry-runtime" && family !== "federal-directory"),
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

async function readAuthorityArtifactValue(
  family: AuthorityPointerFamily,
  ref: AuthorityArtifactRef | null | undefined,
  store: ReaderArtifactStore,
  place?: string,
): Promise<unknown | null> {
  if (!ref?.key || !ref.version || ref.layout !== "records") return null;
  const selection = currentReaderSelection();
  const cacheKey = place === undefined ? family : `${family}/${place}`;
  const index = await readAuthorityIndex(family, ref, store, place);
  const read = async () => {
    try { return index === null ? null : await readAuthorityRecords(index as RecordIndex, store, selection); }
    catch { return null; }
  };
  return selection ? read() : heldFetch(authorityValueCache, cacheKey, `${ref.version}:${ref.key}`, read);
}

/** A family's record index, read once per version per process. */
function readAuthorityIndex(family: AuthorityPointerFamily, ref: AuthorityArtifactRef, store: ReaderArtifactStore, place?: string): Promise<unknown | null> {
  return heldFetch(authorityEdgeCache, place === undefined ? family : `${family}/${place}`, `${ref.version}:${ref.key}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as AuthorityArtifactEnvelope;
      if (envelope.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || envelope.family !== family || envelope.place !== place ||
        envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) return null;
      return envelope.value;
    } catch {
      return null;
    }
  });
}

export async function readServedPromotedFamily(family: GlobalPromotedAuthorityFamily, ref: AuthorityArtifactRef | null | undefined,
  store: ReaderArtifactStore, place?: string): Promise<PromotedFamilyArtifactValue | null> {
  const value = await readAuthorityArtifactValue(family, ref, store, place) as Partial<PromotedFamilyArtifactValue> | null;
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

/** One place's value of a per-place family; a null value is the published answer that nothing is promoted there. */
async function readPlaceArtifact<T>(family: AuthorityPointerFamily, place: string, store: ReaderArtifactStore): Promise<{ value: T | null; versionId: string } | null> {
  const ref = await readHeldPointer<AuthorityArtifactRef>(authorityPointerKey(family, place), store);
  if (!ref) return null;
  const value = await readAuthorityArtifactValue(family, ref, store, place);
  if (value === null && ref.sha !== sha256OfJson(EMPTY_RECORDS)) throw new Error(`${family}/${place} artifact could not be read`);
  return { value: value as T | null, versionId: ref.version };
}
const EMPTY_RECORDS = { kind: "READER_RECORDS", base: null, records: [] };

interface StateAuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: StateAuthorityFamily;
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: PromotedFamilyArtifactValue;
}

function jsonMember(value: unknown, key: string): unknown {
  if (value !== null && (typeof value === "object" || typeof value === "bigint")) {
    const toJSON = (value as { toJSON?: (key: string) => unknown }).toJSON;
    if (typeof toJSON === "function") value = toJSON.call(value, key);
  }
  return value instanceof Number || value instanceof String || value instanceof Boolean ? value.valueOf() : value;
}

function* stateJsonTokens(value: unknown, parents: Set<object>): Generator<string> {
  if (value === null || typeof value !== "object") {
    yield JSON.stringify(value) ?? "null";
    return;
  }
  if (parents.has(value)) throw new TypeError("Converting circular structure to JSON");
  parents.add(value);
  if (Array.isArray(value)) {
    yield "[";
    for (let index = 0; index < value.length; index++) {
      if (index) yield ",";
      yield* stateJsonTokens(jsonMember(value[index], String(index)), parents);
    }
    yield "]";
  } else {
    yield "{";
    let first = true;
    for (const key of Object.keys(value)) {
      const child = jsonMember((value as Record<string, unknown>)[key], key);
      if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
      if (!first) yield ",";
      first = false;
      yield JSON.stringify(key);
      yield ":";
      yield* stateJsonTokens(child, parents);
    }
    yield "}";
  }
  parents.delete(value);
}

function* stateJsonChunks(value: unknown): Generator<string> {
  let parts: string[] = [], length = 0;
  for (const token of stateJsonTokens(jsonMember(value, ""), new Set())) {
    parts.push(token);
    length += token.length;
    if (length >= 32_768) { yield parts.join(""); parts = []; length = 0; }
  }
  if (parts.length) yield parts.join("");
}

export async function prepareStateAuthorityArtifact(family: StateAuthorityFamily, state: string, entry: PublishAuthorityValue,
  store: ReaderArtifactStore, now: string): Promise<PublishedStateAuthority> {
  const envelope: StateAuthorityArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION,
    family, state, versionId: entry.versionId, generatedAt: now, value: entry.value as PromotedFamilyArtifactValue };
  const bytes = await pipeline(Readable.from(stateJsonChunks(envelope), { objectMode: false }), createGzip(), async stream => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  });
  return { versionId: entry.versionId, artifact: { key: await store.putImmutable(bytes, "json.gz"), version: entry.versionId, sha: bytesHash(bytes) } };
}

type StateAuthorityCache = Map<string, { version: string; value: Promise<PromotedFamilyArtifactValue | null> }>;
const stateAuthorityCaches = new WeakMap<object, StateAuthorityCache>();
const bytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export function holdReaderAuthorityEdge(error: unknown, families: readonly AuthorityFamily[] = STATE_AUTHORITY_FAMILIES): null {
  const selection = currentReaderSelection();
  const states = selection?.states ?? statesForRegistryDivisions([...selection?.keys ?? [], ...selection?.divisions ?? []]);
  const scoped = STATE_AUTHORITY_FAMILIES.filter(family => families.includes(family));
  if (!states.length) reportReaderStateFailure("reader-authority", null, READER_MANIFEST_KEY, error);
  else for (const state of states) {
    if (!scoped.length) reportReaderStateFailure("reader-authority", state, READER_MANIFEST_KEY, error);
    for (const family of scoped) reportReaderStateFailure(family, state, authorityPointerKey(family, state), error);
  }
  return null;
}

async function readStateAuthorityArtifact(family: StateAuthorityFamily, state: string, store: ReaderArtifactStore): Promise<PromotedFamilyArtifactValue | null> {
  let ref: AuthorityArtifactRef | null;
  try { ref = await readHeldPointer<AuthorityArtifactRef>(authorityPointerKey(family, state), store); }
  catch (error) { reportReaderStateFailure(family, state, authorityPointerKey(family, state), error); return null; }
  if (!ref?.key || !ref.version) {
    reportReaderStateFailure(family, state, authorityPointerKey(family, state), new Error("STATE_ARTIFACT_REFERENCE_MISSING"));
    return null;
  }
  const context = currentReaderAuthorityEdge() ?? currentReaderSelection();
  const stateAuthorityCache = context ? stateAuthorityCaches.get(context) ?? new Map() : new Map();
  if (context) stateAuthorityCaches.set(context, stateAuthorityCache);
  const cacheKey = `${family}:${state}`;
  return heldFetch(stateAuthorityCache, cacheKey, `${ref.version}:${ref.key}:${ref.sha}`, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) throw new Error("STATE_ARTIFACT_BYTES_MISSING");
      if (bytesHash(bytes) !== ref.sha) throw new Error("STATE_ARTIFACT_HASH_MISMATCH");
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as StateAuthorityArtifactEnvelope;
      const pointers = stateAuthorityPointers(family, state);
      if (envelope.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || envelope.family !== family || envelope.state !== state ||
        envelope.versionId !== ref.version || envelope.value?.kind !== "PROMOTED_POINTERS" || !Array.isArray(envelope.value.entries) || envelope.value.entries.length !== pointers.length ||
        envelope.value.entries.some((entry, index) => (entry.kind === "PROMOTED" ? entry.projection.scope : entry.scope) !== pointers[index].scope)) throw new Error("STATE_ARTIFACT_ENVELOPE_INVALID");
      registerIntegrityCheckedEdgeEntries(envelope.value.entries);
      for (const [index, entry] of envelope.value.entries.entries()) {
        const read = await readPromotedCivicData(pointers[index].recordClass, pointers[index].scope, { edge: entry });
        if (read.kind === "STORE_UNREACHABLE") throw new Error(`STATE_ARTIFACT_PROOF_INVALID:${read.detail}`);
      }
      return envelope.value;
    } catch (error) { reportReaderStateFailure(family, state, ref.key, error); return null; }
  });

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

const pointerMemo = new Map<string, { readonly at: number; readonly value: Promise<unknown> }>();

/** A pointer as readers see it, held as long as the manifest is; null when nothing is published there yet. */
function readHeldPointer<T>(key: string, store: ReaderArtifactStore, now = Date.now()): Promise<T | null> {
  const held = store.kind === "netlify-blobs" ? pointerMemo.get(key) : undefined;
  if (held && now - held.at >= 0 && now - held.at < READER_MANIFEST_MEMO_MS) return held.value as Promise<T | null>;
  const value = store.readJsonPointer<T>(key).then(read => read?.value ?? null);
  if (store.kind === "netlify-blobs") {
    pointerMemo.set(key, { at: now, value });
    value.catch(() => { if (pointerMemo.get(key)?.value === value) pointerMemo.delete(key); });
  }
  return value;
}
const factBucketEdgeCache = new Map<string, { version: string; value: Promise<RecordIndex | null> }>();

async function readEnvelope<T extends { readonly value: unknown; readonly versionId: string }>(ref: AuthorityArtifactRef, store: ReaderArtifactStore,
  family: string, state: string, belongs: (envelope: T) => boolean): Promise<T["value"] | null> {
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes) throw new Error("STATE_ARTIFACT_BYTES_MISSING");
    const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as T;
    if (!belongs(envelope) || envelope.versionId !== ref.version || sha256OfJson(envelope.value) !== ref.sha) throw new Error("STATE_ARTIFACT_ENVELOPE_INVALID");
    return envelope.value;
  } catch (error) { reportReaderStateFailure(family, state, ref.key, error); return null; }
}

export const stateFactsPointerKey = (state: string) => `reader/state-facts/${state}.json`;

/** Whether a family's pointer (one place's, when given) is published, from the same held read its bundle uses. */
export async function authorityPointerHeld(family: AuthorityPointerFamily | StateAuthorityFamily, place?: string,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore()): Promise<boolean> {
  return store ? await readHeldPointer(authorityPointerKey(family, place), store).then(ref => ref !== null, () => false) : false;
}

/** One state's served bucket list from its own pointer; null when the state has none published. */
async function readStateFactsPointer(state: string, store: ReaderArtifactStore, now = Date.now()): Promise<StateFactsPointer | null> {
  const pointer = await readHeldPointer<StateFactsPointer>(stateFactsPointerKey(state), store, now);
  if (pointer && (pointer.state !== state || !Array.isArray(pointer.buckets))) throw new Error("STATE_ARTIFACT_ENVELOPE_INVALID");
  return pointer;
}

/** One bucket's record index, read once per version per process; its records are fetched only as a selection needs them. */
export async function readServedFactBucket(state: string, bucket: number, ref: AuthorityArtifactRef, store: ReaderArtifactStore): Promise<RecordIndex | null> {
  return heldFetch(factBucketEdgeCache, `${state}/${bucket}`, `${ref.version}:${ref.key}`,
    () => readEnvelope<FactBucketArtifactEnvelope>(ref, store, "fact-bucket", state, envelope => envelope.family === "fact-bucket" && envelope.state === state && envelope.bucket === bucket));
}

/** One body's facts as an immutable record, ahead of the bucket index that will name it. */
export async function writeFactRecord(store: ReaderArtifactStore, value: BodyFacts): Promise<{ readonly key: string; readonly sha: string }> {
  return { key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(value), "utf8")), "json.gz"), sha: sha256OfJson(value) };
}

export async function writeFactBucket(store: ReaderArtifactStore, state: string, bucket: number, versionId: string, index: RecordIndex, now: string): Promise<AuthorityArtifactRef> {
  const envelope: FactBucketArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "fact-bucket", state, bucket, versionId, generatedAt: now, value: index };
  return { key: await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz"), version: versionId, sha: sha256OfJson(index) };
}

/** The facts of every body a reader's selection names in the given states; every body of them when there is no selection. */
async function readStateFacts(states: readonly string[], store: ReaderArtifactStore,
  selection: ReturnType<typeof currentReaderSelection>): Promise<{ bodies: BodyFacts[]; versionId: string | null } | null> {
  const read = await Promise.all(states.map(async state => {
    try {
      const pointer = await readStateFactsPointer(state, store);
      if (!pointer) return { bodies: [], versionId: null };
      const buckets = await Promise.all(pointer.buckets.map((bucket, n) => bucket ? readServedFactBucket(state, n, bucket, store) : null));
      if (pointer.buckets.some((bucket, n) => bucket !== null && buckets[n] === null)) return null;
      const bodies = await Promise.all(buckets.flatMap(bucket => bucket ? [readAuthorityRecords(bucket, store, selection) as Promise<{ bodies: BodyFacts[] }>] : []));
      return { bodies: bodies.flatMap(row => row.bodies), versionId: pointer.versionId };
    } catch (error) { reportReaderStateFailure("state-facts", state, stateFactsPointerKey(state), error); return null; }
  }));
  if (read.some(state => state === null)) return null;
  return { bodies: read.flatMap(state => state!.bodies), versionId: read.map(state => state!.versionId).filter(Boolean).join("|") || null };
}

/** Each family's pointer is read only when this request names the family; a family with no pointer yet reads its database path. */
export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderManifest, "meetingPlaces"> | null,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  families: readonly AuthorityFamily[] = AUTHORITY_FAMILIES,
): Promise<ReaderAuthorityEdgeBundle | null> {
  if (!store) return null;
  try {
    const promotedFamilies = new Set<string>();
    const bundle: {
      campaignSites?: { value: CuratedReaderProjection; versionId: string };
      meetingOutcomes?: { value: OutcomeSnapshot; versionId: string };
      everydayRouting?: { value: { projection: unknown }; versionId: string };
      commentAccess?: { value: CommentAccessProjection; versionId: string };
    } = {};
    const factReads = new Map<string, Promise<{ bodies: readonly BodyFacts[]; versionId: string | null } | null>>();
    const stateRegistryFacts = { key: stateFactsPointerKey, load: (state: string) => {
      const selectionKey = `${state}:${[...currentReaderSelection()?.keys ?? []].sort().join("|")}`;
      let read = factReads.get(selectionKey);
      if (!read) {
        read = (async () => {
          const selected = currentReaderSelection();
          const localKeys = selected ? [...selected.keys].filter(key => statesForRegistryDivisions([key]).includes(state)) : [];
          const placeSelection = selected && localKeys.some(key => /\/(?:state|district|territory):[a-z]{2}\//i.test(key) || key.includes("#")) ? selected : undefined;
          const facts = await readStateFacts([state], store, placeSelection);
          if (!facts) return null;
          const { bodies, versionId } = facts;
          const prior = bundle.commentAccess;
          bundle.commentAccess = { versionId: [...new Set([prior?.versionId, versionId ?? `not-recorded:${state}`].filter(Boolean))].join("|"),
            value: { kind: "comment-access", records: [...new Map([...prior?.value.records ?? [],
              ...bodies.flatMap(body => body.comment ? [{ id: `comment-access:${body.id}`, ...body.comment }] : [])].map(row => [row.id, row])).values()] } };
          return facts;
        })();
        factReads.set(selectionKey, read);
      }
      return read;
    } };
    const stateAuthorities = {
      key: (family: StateAuthorityFamily, state: string) => authorityPointerKey(family, state),
      families: new Set(STATE_AUTHORITY_FAMILIES.filter(family => families.includes(family))),
      load: async (family: StateAuthorityFamily, state: string) => {
        const value = await readStateAuthorityArtifact(family, state, store);
        if (value) promotedFamilies.add(family);
        return value;
      },
    };
    const registrations = { load: (state: string) => readPlaceArtifact<RegistrationReadModel>("registrations", state, store) };
    const stateLegislators = families.includes("state-legislators")
      ? { stateLegislators: { load: (jurisdiction: string) => readPlaceArtifact<OfficialStateLegislatorReadModel>("state-legislators", jurisdiction, store) } } : {};
    const wanted = new Set(families);
    const refOf = (family: GlobalAuthorityFamily, place?: string) => readHeldPointer<AuthorityArtifactRef>(authorityPointerKey(family, place), store);
    const selected = currentReaderSelection();
    const states = selected?.states ?? statesForRegistryDivisions([...selected?.keys ?? [], ...selected?.divisions ?? []]);
    const places = ["US", ...states];
    // Every pointer and record index this request can need is asked for at once; each read below then waits only on its own records.
    const prefetch = (family: GlobalAuthorityFamily, place?: string) => {
      refOf(family, place).then(ref => ref?.layout === "records" ? readAuthorityIndex(family, ref, store, place) : null).catch(() => null);
    };
    const zips = [...selected?.keys ?? []].filter(key => /^\d{5}$/.test(key));
    const { postalArea } = zips.length && wanted.has("census-districts") ? await import("../geo/postal.ts") : { postalArea: () => null };
    for (const family of GLOBAL_AUTHORITY_FAMILIES) if (wanted.has(family)) {
      if (family === "census-districts") for (const zip of zips) prefetch(family, postalArea(zip)?.state ?? "US");
      else if (family === "meeting-outcomes" || PLACE_SPLIT_FAMILIES.has(family as GlobalPromotedAuthorityFamily)) for (const place of places) prefetch(family, place);
      else if (family !== "state-legislators") prefetch(family);
    }
    for (const state of states) {
      for (const family of stateAuthorities.families) readHeldPointer(authorityPointerKey(family, state), store).catch(() => null);
      readHeldPointer(stateFactsPointerKey(state), store).catch(() => null);
    }
    const fetchWanted = async (family: GlobalAuthorityFamily) => {
      if (!wanted.has(family)) return null;
      const ref = await refOf(family);
      return ref ? { value: await readAuthorityArtifactValue(family, ref, store), versionId: ref.version } : null;
    };
    const censusDistricts = wanted.has("census-districts") ? { censusDistricts: { slice: async (zip: string): Promise<Slice<CodeSlice>> => {
      const [{ censusDistrictEdgeSlice }, { postalArea }] = await Promise.all([import("../census-geography/district-edge.ts"), import("../geo/postal.ts")]);
      const state = postalArea(zip)?.state ?? "US", ref = await refOf("census-districts", state);
      const value = ref && await readAuthorityArtifactValue("census-districts", ref, store, state) as CensusDistrictEdge | null;
      return value ? censusDistrictEdgeSlice(value, ref.version, zip) : { kind: "UNREAD", detail: `Census districts for ${state} are not on the reader edge` };
    } } } : {};
    if (selected && censusDistricts.censusDistricts) {
      const { censusWorkDivision } = await import("../census-geography/division-id.ts");
      for (const zip of zips) {
        const slice = await censusDistricts.censusDistricts.slice(zip);
        if (slice.kind === "HELD") for (const container of slice.value.containers) {
          const id = censusWorkDivision(container.ref);
          if (id) selected.keys.add(id);
        }
      }
    }
    // Money and vote records are bound to members, so the members the selected divisions name join the selection first.
    if (selected && wanted.has("federal-directory")) for (const state of statesForRegistryDivisions([...selected.keys])) {
      const entry = (await readStateAuthorityArtifact("federal-directory", state, store))?.entries[0];
      const directory = entry?.kind === "PROMOTED" ? entry.projection.payload as { roster?: { divisions?: { ocdId: string; officeholderId: string }[] } } : null;
      for (const division of directory?.roster?.divisions ?? []) {
        if (selected.keys.has(division.ocdId)) selected.keys.add(division.officeholderId).add(division.officeholderId.replace(/^congress:/, ""));
      }
    }
    const readOutcomes = async () => {
      const parts = (await Promise.all(places.map(async place => {
        const ref = await refOf("meeting-outcomes", place);
        const value = ref && await readAuthorityArtifactValue("meeting-outcomes", ref, store, place) as OutcomeSnapshot | null;
        return value ? [{ value, versionId: ref.version }] : [];
      }))).flat();
      if (parts.length < 2) return parts[0] ?? null;
      const { combineOutcomeProjections } = await import("../outcomes/store.ts");
      return combineOutcomeProjections(parts.map(({ value }) => ({ value, pointers: value.pointers ?? [] })));
    };
    const [campaign, outcomes, routing] = await Promise.all([
      fetchWanted("campaign-sites"), wanted.has("meeting-outcomes") ? readOutcomes() : null, fetchWanted("everyday-routing"),
    ]);
    if (campaign?.value) bundle.campaignSites = { value: campaign.value as CuratedReaderProjection, versionId: campaign.versionId };
    if (outcomes?.value) bundle.meetingOutcomes = { value: outcomes.value as OutcomeSnapshot, versionId: outcomes.versionId };
    if (routing?.value) bundle.everydayRouting = { value: routing.value as { projection: unknown }, versionId: routing.versionId };
    const promoted = new Map<string, PromotedEdgeEntry>();
    const take = (family: PromotedAuthorityFamily, artifact: Partial<PromotedFamilyArtifactValue> | null) => {
      if (artifact?.kind !== "PROMOTED_POINTERS" || !Array.isArray(artifact.entries)) return;
      promotedFamilies.add(family);
      for (const entry of artifact.entries) {
        const pointer = entry?.kind === "PROMOTED" ? entry.projection?.key : entry?.kind === "NOT_RECORDED" ? `${entry.recordClass}:${entry.scope}` : null;
        if (typeof pointer === "string") promoted.set(pointer, entry);
      }
    };
    const loadPlace = async (family: PromotedAuthorityFamily, place: string) => take(family, await readServedPromotedFamily(family, await refOf(family, place), store, place));
    const load = (family: PromotedAuthorityFamily) => !wanted.has(family) ? Promise.resolve()
      : PLACE_SPLIT_FAMILIES.has(family) ? Promise.all(places.map(place => loadPlace(family, place))).then(() => undefined)
      : fetchWanted(family).then(read => take(family, read?.value as Partial<PromotedFamilyArtifactValue> | null));
    await Promise.all(PROMOTED_AUTHORITY_FAMILIES.filter(family => family.startsWith("ballot-")).map(load));
    await Promise.all(PROMOTED_AUTHORITY_FAMILIES.filter(family => !family.startsWith("ballot-")).map(load));
    const loadPromoted: NonNullable<ReaderAuthorityEdgeBundle["loadPromoted"]> = async (recordClass, scope) => {
      const family: PromotedAuthorityFamily = recordClass === "STATE_ROLL_CALL" || recordClass === "STATE_LEGISLATOR_VOTES" ? "state-votes"
        : recordClass === "STATE_CAMPAIGN_FINANCE" ? "state-money"
        : recordClass === "PRL_PROFILE" ? "prl-profiles" : recordClass === "PRL_ARCHIVE" ? "prl-archives" : "other-reader-data";
      if (PLACE_SPLIT_FAMILIES.has(family)) await loadPlace(family, authorityPlaceOfScope(scope));
      else take(family, await readServedPromotedFamily(family, await refOf(family), store));
      return promoted.get(`${recordClass}:${scope}`) ?? null;
    };
    return Object.assign(bundle, { registrations, stateAuthorities, stateRegistryFacts, promoted, promotedFamilies, loadPromoted }, stateLegislators, censusDistricts,
      manifest?.meetingPlaces ? { meetingPlaces: new Map(Object.entries(manifest.meetingPlaces)) } : {},
      selected ? { selection: selected } : {});
  } catch (error) {
    holdReaderAuthorityEdge(error, families);
    throw error;
  }
}

function scopeDataSha(artifact: ReaderGeoArtifact): string {
  return sha256OfJson({ meetings: artifact.meetings, order: artifact.meetingOrder, agendaDocuments: artifact.agendaDocuments });
}

/** The meetings manifest; every authority family publishes to its own pointer, apart from it. */
export async function publishReaderMeetings(
  snapshot: MeetingsSnapshot | null,
  metadata: PublishMetadata,
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly now?: string;
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
  const carriedSummary = snapshot ? snapshotClientMeta(snapshot).carried : undefined;

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
    const samePlaces = options.meetingPlaces === undefined || JSON.stringify(options.meetingPlaces) === JSON.stringify(current.manifest.meetingPlaces);
    const sameSummary = snapshot === null || JSON.stringify(carriedSummary) === JSON.stringify(current.manifest.carriedSummary);
    if (sameSet && sameMeetingAreas && samePlaces && sameSummary) {
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
  const keys = new Set(sittingBodies(merged.meetings));
  const facts = await readStateFacts(statesForRegistryDivisions([...keys]), store, { keys });
  const value = { ...merged, meetings: withSittingFacts(merged.meetings, facts?.bodies.flatMap(body => body.sittings) ?? []) };
  const complete = artifacts.length === needed.length && facts !== null;
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
