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
  type ReaderManifest,
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
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { AgendaDocument } from "./agenda-documents.ts";
import type { MeetingStateEntry } from "./body-publication.ts";
import {
  decodeMeetingBlob,
  meetingBodyPointerKey,
  divisionOf,
  mergeMeetingBodies,
  meetingStateOf,
  MEETING_BODY_FORMAT_VERSION,
  type MeetingBodyRecord,
  type MeetingBodyChecks,
  type MeetingBodyRow,
  type MeetingBodyPointer,
  type MeetingStateIndex,
} from "./body-records.ts";
import { readMeetingBodyHistory, readMeetingBodyRow, readMeetingIndexRow } from "./body-rows.ts";
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
  | { readonly status: "PUBLISHED"; readonly sequence: number; readonly states: number }
  | { readonly status: "CURRENT"; readonly sequence: number; readonly states: number }
  | { readonly status: "RACED"; readonly sequence: number }
  | { readonly status: "SKIPPED_NO_STORE" }
  | { readonly status: "FAILED"; readonly error: string };

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
  _manifest: ReaderManifest | null,
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
      selected ? { selection: selected } : {});
  } catch (error) {
    holdReaderAuthorityEdge(error, families);
    throw error;
  }
}

interface MeetingStateArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "meeting-index";
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: MeetingStateIndex;
}

/** The meetings manifest: one index reference per state. Every authority family publishes to its own pointer, apart from it. */
export async function publishReaderMeetings(
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly now?: string;
    /** Complete: one entry per state with meetings. */
    readonly meetingStates?: Readonly<Record<string, MeetingStateEntry>>;
  } = {},
): Promise<PublishReaderEdgeResult> {
  const store = options.store ?? resolveReaderArtifactWriteStore();
  if (!store) return { status: "SKIPPED_NO_STORE" };
  const now = options.now ?? new Date().toISOString();

  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  const versions = (entries: readonly (readonly [string, string])[]) => entries.map(([state, version]) => `${state}=${version}`).sort().join("|");
  if (current && (options.meetingStates === undefined ||
    versions(Object.entries(options.meetingStates).map(([state, entry]) => [state, entry.versionId] as const)) ===
      versions(Object.entries(current.manifest.meetingStates ?? {}).map(([state, ref]) => [state, ref.version] as const)))) {
    return { status: "CURRENT", sequence: current.manifest.sequence, states: Object.keys(current.manifest.meetingStates ?? {}).length };
  }

  const sequence = (current?.manifest.sequence ?? 0) + 1;
  const meetingStates: Record<string, AuthorityArtifactRef> = options.meetingStates === undefined ? { ...current?.manifest.meetingStates } : {};
  try {
    for (const [state, entry] of Object.entries(options.meetingStates ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.meetingStates?.[state];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        meetingStates[state] = served;
        continue;
      }
      const envelope: MeetingStateArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "meeting-index", state, versionId: entry.versionId, generatedAt: now, value: entry.value };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      meetingStates[state] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
  } catch (error) {
    // Complete immutable bytes precede CAS; partial writes cannot change a served artifact.
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  const manifest: ReaderManifest = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, sequence, meetingStates };
  let result;
  try {
    result = await store.writeManifest(manifest, current?.etag ?? null);
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  return result.modified ? { status: "PUBLISHED", sequence, states: Object.keys(meetingStates).length } : { status: "RACED", sequence };
}

// Reads answered whole from published edge artifacts; only these may be held by the CDN.
const completeEdgeReads = new WeakSet<object>();
const areaReads = new Map<string, MeetingsProjectionReadResult>();
const meetingIndexEdgeCache = new Map<string, { version: string; value: Promise<MeetingStateIndex | null> }>();
const meetingBlobs = new Map<string, Promise<unknown>>();

/** One state's meeting index, read once per version per process. */
export function readServedMeetingIndex(state: string, ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore): Promise<MeetingStateIndex | null> {
  if (!ref?.key || !ref.version) {
    reportReaderStateFailure("meeting-index", state, ref?.key ?? null, new Error("STATE_ARTIFACT_REFERENCE_MISSING"));
    return Promise.resolve(null);
  }
  return heldFetch(meetingIndexEdgeCache, state, `${ref.version}:${ref.key}`,
    () => readEnvelope<MeetingStateArtifactEnvelope>(ref, store, "meeting-index", state, envelope => envelope.family === "meeting-index" && envelope.state === state));
}

/** A state's index is fetched ahead of the read that will want it. */
export function prefetchReaderEdgeStates(
  manifest: ReaderManifest | null,
  states: readonly string[],
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): void {
  if (!manifest?.meetingStates || !store) return;
  for (const state of states) void readServedMeetingIndex(state.toUpperCase(), manifest.meetingStates[state.toUpperCase()], store).catch(() => undefined);
}

/** One immutable meeting blob, checked against its hash and held while the process runs. */
function readMeetingBlob<T>(ref: string, store: ReaderArtifactStore, state: string, family: string): Promise<T | null> {
  let read = meetingBlobs.get(ref) as Promise<T | null> | undefined;
  if (!read) {
    read = (async () => {
      const bytes = await store.readBytes(ref);
      if (!bytes) throw new Error("MEETING_BLOB_MISSING");
      return decodeMeetingBlob<T>(bytes, ref);
    })().catch((error) => { meetingBlobs.delete(ref); reportReaderStateFailure(family, state, ref, error); return null; });
    meetingBlobs.set(ref, read);
    if (meetingBlobs.size > 2048) meetingBlobs.delete(meetingBlobs.keys().next().value!);
  }
  return read;
}

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

/** A read names the place it is for (divisions) or the bodies it wants; it never asks for the country. */
type ReaderEdgeMeetingsOptions = {
    readonly store?: ReaderArtifactStore | null;
    readonly dataStore?: Pick<RoutineDataStore, "readPreparedReaderProjection" | "readPromotions">;
    readonly states?: readonly string[];
    readonly ocdIds?: readonly string[];
    readonly bodyIds?: readonly string[];
    /** With `bodyIds`: also the bodies that serve any division those bodies serve, so shared documents are seen against their neighbours. */
    readonly neighbors?: boolean;
    readonly includeAgenda?: boolean;
    readonly now?: string;
    readonly manifest?: ReaderManifest | null;
    readonly window?: ReaderMeetingsWindow;
    readonly settings?: MeetingSettings;
  };

const NOT_A_PLACE: MeetingsProjectionReadResult = {
  kind: "NOT_RECORDED", value: null, detail: "A meetings read names a place or a body.",
  metadata: { recordClass: MEETINGS_RECORD_CLASS, scope: MEETINGS_SCOPE, sourceId: null, version: null, versionId: null, lastKnownGoodVersionId: null,
    sourceThrough: null, retrievedAt: null, promotedAt: null, stale: "UNKNOWN", staleAt: null },
};

function meetingsUnreachable(detail: string): MeetingsProjectionReadResult {
  return { kind: "STORE_UNREACHABLE", value: null, metadata: NOT_A_PLACE.metadata, code: "STORE_READ_FAILED", detail };
}

/** A place whose government could not be resolved holds no meetings; the answer says so rather than naming a stand-in. */
export function emptyMeetingsRead(now: string = new Date().toISOString()): MeetingsProjectionReadResult {
  return { kind: "PROMOTED", detail: "The place resolved to no government.", metadata: { ...NOT_A_PLACE.metadata, stale: "UNKNOWN" },
    value: { formatVersion: 1, generatedAt: now, counts: snapshotCounts([], 0), sources: [], meetings: [], agendaDocuments: [] } };
}

/** Where a body stands now; never held, since it moves with every check. */
function readBodyPointer(store: ReaderArtifactStore, state: string, bodyId: string): Promise<MeetingBodyPointer | null> {
  const key = meetingBodyPointerKey(state, bodyId);
  return store.readJsonPointer<MeetingBodyPointer>(key).then((found) => found?.value ?? null).catch((error) => {
    reportReaderStateFailure("meeting-body", state, key, error); return null;
  });
}

interface LoadedBody {
  /** The record's edge key; null when the body came from its database row. */
  readonly key: string | null;
  readonly checks: MeetingBodyChecks;
  readonly record: MeetingBodyRecord;
  readonly agenda: readonly AgendaDocument[];
  readonly history: MeetingsSnapshot | null;
  readonly fromEdge: boolean;
}

/** One body from its pointer and record on the edge; its database row by key when the edge cannot supply it whole. */
async function loadBody(
  at: { readonly state: string; readonly bodyId: string; readonly pointer?: MeetingBodyPointer | null },
  store: ReaderArtifactStore | null,
  options: Pick<ReaderEdgeMeetingsOptions, "dataStore" | "includeAgenda" | "window">,
): Promise<LoadedBody | null> {
  const { state, bodyId } = at;
  const wantAgenda = options.includeAgenda !== false;
  const wantHistory = options.window === "HELD";
  const pointer = store ? at.pointer !== undefined ? at.pointer : await readBodyPointer(store, state, bodyId) : null;
  const record = store && pointer ? await readMeetingBlob<MeetingBodyRecord>(pointer.record, store, state, "meeting-body") : null;
  if (store && pointer && record !== null) {
    const agenda = !wantAgenda || record.agenda === null ? [] : await readMeetingBlob<AgendaDocument[]>(record.agenda, store, state, "meeting-agenda");
    const history = !wantHistory || record.history === null ? null : await readMeetingBlob<MeetingsSnapshot>(record.history, store, state, "meeting-history");
    if (agenda !== null && (history !== null || !wantHistory || record.history === null)) return { key: pointer.record, checks: pointer.checks, record, agenda, history, fromEdge: true };
  }
  let row: MeetingBodyRow | null;
  let history: MeetingsSnapshot | null = null;
  try {
    row = await readMeetingBodyRow(state, bodyId, options.dataStore);
    if (row !== null && wantHistory) history = await readMeetingBodyHistory(row, options.dataStore);
  } catch {
    return null;
  }
  if (row === null) return null;
  return {
    key: null, checks: { checkedAt: null, routes: {} }, fromEdge: false, agenda: wantAgenda ? row.snapshot.agendaDocuments : [],
    record: { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId, snapshot: { ...row.snapshot, agendaDocuments: [] }, agenda: null, history: null,
      sourceThrough: row.sourceThrough, retrievedAt: row.retrievedAt, promotedThrough: row.promotedThrough },
    history,
  };
}

interface StateIndexRead {
  readonly index: MeetingStateIndex | null;
  /** The index exists but could not be read from the edge or the database, which is not the same as having none. */
  readonly failed: boolean;
}

/** One state's index: the edge's when it supplies one, else the database row. A state a published manifest does not list has none. */
async function loadStateIndex(
  state: string,
  manifest: ReaderManifest | null,
  store: ReaderArtifactStore | null,
  dataStore: ReaderEdgeMeetingsOptions["dataStore"],
): Promise<StateIndexRead> {
  const ref = manifest?.meetingStates?.[state];
  if (store && ref) {
    const served = await readServedMeetingIndex(state, ref, store);
    if (served) return { index: served, failed: false };
  } else if (manifest?.meetingStates !== undefined) return { index: null, failed: false };
  try {
    return { index: await readMeetingIndexRow(state, dataStore), failed: false };
  } catch {
    return { index: null, failed: true };
  }
}

export interface StateMeetingBody {
  readonly state: string;
  readonly bodyId: string;
  /** The key of its record, so a caller that kept what it read of this record can skip reading it again; null when the edge holds none. */
  readonly sha: string | null;
  /** Reads this one body; null when neither the edge nor the database can supply it. */
  readonly load: () => Promise<{ readonly snapshot: MeetingsSnapshot; readonly fromEdge: boolean } | null>;
}

const WALK_BATCH = 64;

/** Every body of these states, listed from each state's index and read one body at a time, for jobs that cover a state rather than a place. */
export async function* readMeetingBodies(options: Pick<ReaderEdgeMeetingsOptions, "store" | "dataStore" | "manifest" | "states" | "includeAgenda" | "window" | "settings" | "now">):
  AsyncGenerator<StateMeetingBody> {
  const store = options.store === undefined ? resolveReaderArtifactStore() : options.store;
  const manifest = options.manifest !== undefined ? options.manifest : store ? await store.readManifest().then((stored) => stored?.manifest ?? null, () => null) : null;
  const states = (options.states ?? Object.keys(manifest?.meetingStates ?? {})).map((state) => state.toUpperCase());
  const settings = options.settings ?? await readReaderMeetingSettings();
  for (const state of states) {
    const { index, failed } = await loadStateIndex(state, manifest, store, options.dataStore);
    if (failed) throw new Error(`MEETING_INDEX_UNREADABLE:${state}`);
    const ids = index?.bodies ?? [];
    for (let at = 0; at < ids.length; at += WALK_BATCH) {
      const batch = ids.slice(at, at + WALK_BATCH);
      const pointers = store ? await Promise.all(batch.map((bodyId) => readBodyPointer(store, state, bodyId))) : batch.map(() => null);
      for (const [offset, bodyId] of batch.entries()) {
        const pointer = pointers[offset]!;
        yield { state, bodyId, sha: pointer?.record ?? null, load: async () => {
          const body = await loadBody({ state, bodyId, pointer }, store, options);
          if (body === null) return null;
          const read = applyServedWindow({ kind: "PROMOTED", value: mergeMeetingBodies([body]).snapshot, metadata: NOT_A_PLACE.metadata, detail: "" },
            options.window ?? "SHOWN", options.now, settings);
          return read.kind === "PROMOTED" ? { snapshot: read.value, fromEdge: body.fromEdge } : null;
        } };
      }
    }
  }
}

/** The ids of the bodies these states' indexes list, for questions that name a body of the reader's state. */
export async function readHeldBodyIds(options: Pick<ReaderEdgeMeetingsOptions, "manifest" | "store"> & { readonly states: readonly string[] }): Promise<ReadonlySet<string>> {
  const store = options.store === undefined ? resolveReaderArtifactStore() : options.store;
  const manifest = options.manifest !== undefined ? options.manifest : store ? await store.readManifest().then((stored) => stored?.manifest ?? null, () => null) : null;
  const read = await Promise.all([...new Set(options.states.map((state) => state.toUpperCase()))].map((state) => loadStateIndex(state, manifest, store, undefined)));
  return new Set(read.flatMap(({ index }) => index?.bodies ?? []));
}

const divisionsOfBodies = new WeakMap<MeetingStateIndex, ReadonlyMap<string, readonly string[]>>();
const bodySets = new WeakMap<MeetingStateIndex, ReadonlySet<string>>();

function bodiesOfIndex(index: MeetingStateIndex): ReadonlySet<string> {
  let held = bodySets.get(index);
  if (!held) { held = new Set(index.bodies); bodySets.set(index, held); }
  return held;
}

/** The divisions each body of a state serves, read back from the places that list it. */
function divisionsInIndex(index: MeetingStateIndex): ReadonlyMap<string, readonly string[]> {
  let held = divisionsOfBodies.get(index);
  if (!held) {
    const built = new Map<string, string[]>();
    for (const [division, ids] of Object.entries(index.places)) for (const id of ids) built.set(id, [...built.get(id) ?? [], division]);
    held = built; divisionsOfBodies.set(index, held);
  }
  return held;
}

async function readReaderEdgeMeetingsHeld(
  options: ReaderEdgeMeetingsOptions,
): Promise<MeetingsProjectionReadResult> {
  const divisions = [...new Set((options.ocdIds ?? []).map(divisionOf))];
  const bodyIds = [...new Set(options.bodyIds ?? [])];
  if (divisions.length === 0 && bodyIds.length === 0) return NOT_A_PLACE;
  const states = [...new Set([...(options.states ?? []).map((state) => state.toUpperCase()), ...divisions.map((id) => meetingStateOf(id)),
    ...bodyIds.map((id) => meetingStateOf(id))])].sort();
  const store = options.store === undefined ? resolveReaderArtifactStore() : options.store;
  let manifest: ReaderManifest | null = null;
  if (options.manifest !== undefined) manifest = options.manifest;
  else if (store) manifest = await store.readManifest().then((stored) => stored?.manifest ?? null, () => null);

  const indexes = await Promise.all(states.map(async (state) => ({ state, ...await loadStateIndex(state, manifest, store, options.dataStore) })));
  const unreadable = indexes.filter(({ failed }) => failed).map(({ state }) => state);
  if (unreadable.length > 0) return meetingsUnreachable(`The meeting index of ${unreadable.join(", ")} could not be read.`);
  const chosen = new Map<string, string>();
  for (const { state, index } of indexes) {
    if (index === null) continue;
    const held = bodiesOfIndex(index);
    const named = bodyIds.filter((id) => held.has(id));
    const nearby = options.neighbors ? named.flatMap((id) => (divisionsInIndex(index).get(id) ?? []).flatMap((division) => index.places[division] ?? [])) : [];
    const ids = new Set([...divisions.flatMap((division) => index.places[division] ?? []), ...named, ...nearby]);
    for (const id of ids) if (!chosen.has(id)) chosen.set(id, state);
  }

  const loaded = await Promise.all([...chosen].map(([bodyId, state]) => loadBody({ state, bodyId }, store, options)));
  const bodies = loaded.filter((body): body is LoadedBody => body !== null);
  if (bodies.length < loaded.length) return meetingsUnreachable(`${loaded.length - bodies.length} of ${loaded.length} bodies of this place could not be read.`);

  const areaKey = sha256OfJson({ agenda: options.includeAgenda !== false, history: options.window === "HELD", bodies: bodies.map(({ key, record, checks }) => [key ?? record.bodyId, checks]) });
  const cachedArea = areaReads.get(areaKey);
  if (cachedArea) return cachedArea;

  const merged = mergeMeetingBodies(bodies);
  // Each served sitting takes its body's live facts from that body's record.
  let value = merged.snapshot;
  let factsRead = true;
  if (store) {
    const keys = new Set(sittingBodies(value.meetings));
    const facts = await readStateFacts(statesForRegistryDivisions([...keys]), store, { keys });
    factsRead = facts !== null;
    value = { ...value, meetings: withSittingFacts(value.meetings, facts?.bodies.flatMap(body => body.sittings) ?? []) };
  } else {
    const stored = await withStoredSittingFacts({ kind: "PROMOTED", value, metadata: NOT_A_PLACE.metadata, detail: "" });
    if (stored.kind === "PROMOTED") value = stored.value;
  }
  const complete = bodies.every((body) => body.fromEdge) && factsRead && store !== null && manifest?.meetingStates !== undefined;
  const read: MeetingsProjectionReadResult = {
    kind: "PROMOTED",
    value: bodies.length === 0 ? { ...value, generatedAt: options.now ?? new Date().toISOString() } : value,
    metadata: {
      recordClass: MEETINGS_RECORD_CLASS,
      scope: MEETINGS_SCOPE,
      sourceId: MEETINGS_SOURCE_ID,
      version: null,
      versionId: null,
      lastKnownGoodVersionId: null,
      sourceThrough: merged.sourceThrough,
      retrievedAt: merged.retrievedAt,
      promotedAt: merged.promotedThrough,
      stale: complete ? "CURRENT" : "UNKNOWN",
      staleAt: null,
    },
    detail: `Served from ${bodies.length} body record(s) in ${indexes.filter(({ index }) => index !== null).map(({ state }) => state).join(", ") || "no state"}.`,
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
