import { publishAuthorityRecords, readAuthorityRecords, type RecordIndex } from "./authority-records.ts";
import { currentReaderSelection } from "../db/reader-route.ts";
import { createHash } from "node:crypto";
import { stateBallotScope } from "../civic-data/state-scopes.ts";
import { stateRegistryRuntimeScope, statesForRegistryDivisions } from "../civic-data/state-scopes.ts";
import { readPromotedCivicData, registerIntegrityCheckedEdgeEntries } from "../civic-data/read-model.ts";
import { gzipSync, gunzipSync, createGzip } from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  sha256OfJson,
  AUTHORITY_FAMILIES,
  GLOBAL_AUTHORITY_FAMILIES,
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
import type { StateFactsIndex } from "../facts/state-facts-publication.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import { currentReaderAuthorityEdge, reportReaderStateFailure, type ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
import type { RegistrationReadModel } from "../registration/candidate.ts";
import type { OutcomeSnapshot } from "../outcomes/types.ts";
import type { CensusDistrictEdge } from "../census-geography/district-edge.ts";
import type { PromotedEdgeEntry } from "../civic-data/read-model.ts";
import {
  READER_MANIFEST_KEY,
  resolveReaderArtifactStore,
  resolveReaderArtifactWriteStore,
  type ReaderArtifactStore,
} from "./edge-store.ts";
import type { RoutineDataStore } from "../civic-data/store.ts";
import type { AgendaDocument } from "./agenda-documents.ts";
import {
  decodeMeetingBlob,
  meetingBodyPointerKey,
  divisionOf,
  mergeMeetingBodies,
  meetingStateOf,
  MEETING_BODY_FORMAT_VERSION,
  type MeetingBodyRecord,
  type MeetingBodyChecks,
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
export type PublishAuthority = Partial<Record<GlobalAuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried>>;
export interface PublishedStateAuthority {
  readonly versionId: string;
  readonly artifact: AuthorityArtifactRef;
  readonly expectedPreviousVersion?: string | null;
}
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
  family: GlobalAuthorityFamily,
): string | null {
  const ref = manifest?.authorityArtifacts?.[family];
  return ref?.layout === "records" ? ref.version : null;
}

interface AuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: GlobalAuthorityFamily;
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
  ...STATE_AUTHORITY_FAMILIES.filter(family => family !== "registry-runtime"),
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
  family: GlobalAuthorityFamily,
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

export async function readServedPromotedFamily(family: GlobalPromotedAuthorityFamily, ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore): Promise<PromotedFamilyArtifactValue | null> {
  const value = await readAuthorityArtifactValue(family, ref, store) as Partial<PromotedFamilyArtifactValue> | null;
  return value?.kind === "PROMOTED_POINTERS" && Array.isArray(value.entries) ? value as PromotedFamilyArtifactValue : null;
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

export function holdReaderAuthorityEdge(error: unknown,
  manifest?: Pick<ReaderManifest, "stateAuthorities">,
  families: readonly AuthorityFamily[] = STATE_AUTHORITY_FAMILIES): null {
  const selection = currentReaderSelection();
  const states = selection?.states ?? statesForRegistryDivisions([...selection?.keys ?? [], ...selection?.divisions ?? []]);
  const scoped = STATE_AUTHORITY_FAMILIES.filter(family => families.includes(family));
  if (!states.length) reportReaderStateFailure("reader-authority", null, READER_MANIFEST_KEY, error);
  else for (const state of states) {
    if (!scoped.length) reportReaderStateFailure("reader-authority", state, READER_MANIFEST_KEY, error);
    for (const family of scoped) reportReaderStateFailure(family, state, manifest?.stateAuthorities?.[family]?.[state]?.key ?? READER_MANIFEST_KEY, error);
  }
  return null;
}

async function readStateAuthorityArtifact(family: StateAuthorityFamily, state: string, ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore): Promise<PromotedFamilyArtifactValue | null> {
  if (!ref?.key || !ref.version) {
    reportReaderStateFailure(family, state, ref?.key ?? null, new Error("STATE_ARTIFACT_REFERENCE_MISSING"));
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
      const scope = family === "registry-runtime" ? stateRegistryRuntimeScope(state)
        : stateBallotScope(family === "candidate-publications" ? "candidate-corpus" : family, state);
      if (envelope.formatVersion !== READER_ARTIFACT_FORMAT_VERSION || envelope.family !== family || envelope.state !== state ||
        envelope.versionId !== ref.version || envelope.value?.kind !== "PROMOTED_POINTERS" || !Array.isArray(envelope.value.entries) || envelope.value.entries.length !== 1 ||
        envelope.value.entries.some(entry => (entry.kind === "PROMOTED" ? entry.projection.scope : entry.scope) !== scope)) throw new Error("STATE_ARTIFACT_ENVELOPE_INVALID");
      registerIntegrityCheckedEdgeEntries(envelope.value.entries);
      for (const entry of envelope.value.entries) {
        const recordClass = ({ "registry-runtime": "REGISTRY_RUNTIME_BINDING", "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE",
          "candidate-publications": "CANDIDATE_PUBLICATION", "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD" } as const)[family];
        const read = await readPromotedCivicData(recordClass, scope, { edge: entry });
        if (read.kind === "STORE_UNREACHABLE") throw new Error(`STATE_ARTIFACT_PROOF_INVALID:${read.detail}`);
      }
      return envelope.value;
    } catch (error) { reportReaderStateFailure(family, state, ref.key, error); return null; }
  });

}

const stateFactsEdgeCache = new Map<string, { version: string; value: Promise<StateFactsIndex | null> }>();
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

/** One state's served bucket list, read once per version per process. */
export async function readServedStateFactsIndex(state: string, ref: AuthorityArtifactRef | undefined, store: ReaderArtifactStore): Promise<StateFactsIndex | null> {
  if (!ref?.key || !ref.version) {
    reportReaderStateFailure("state-facts", state, ref?.key ?? null, new Error("STATE_ARTIFACT_REFERENCE_MISSING"));
    return null;
  }
  return heldFetch(stateFactsEdgeCache, state, `${ref.version}:${ref.key}`,
    () => readEnvelope<StateFactsArtifactEnvelope>(ref, store, "state-facts", state, envelope => envelope.family === "state-facts" && envelope.state === state));
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

/** The facts of every body a reader's selection names, from the states it touches; every body when there is no selection. */
async function readStateFacts(refs: readonly (readonly [string, AuthorityArtifactRef])[], store: ReaderArtifactStore,
  selection: ReturnType<typeof currentReaderSelection>): Promise<BodyFacts[] | null> {
  const states = selection ? new Set(selection.states ?? statesForRegistryDivisions([...selection.keys, ...selection.divisions ?? []])) : null;
  const read = await Promise.all(refs.filter(([state]) => states === null || states.has(state)).map(async ([state, ref]) => {
    try {
      const index = await readServedStateFactsIndex(state, ref, store);
      if (!index) return null;
      const buckets = await Promise.all(index.buckets.map((bucket, n) => bucket ? readServedFactBucket(state, n, bucket, store) : null));
      if (index.buckets.some((bucket, n) => bucket !== null && buckets[n] === null)) return null;
      const bodies = await Promise.all(buckets.flatMap(bucket => bucket ? [readAuthorityRecords(bucket, store, selection) as Promise<{ bodies: BodyFacts[] }>] : []));
      return bodies.flatMap(row => row.bodies);
    } catch (error) { reportReaderStateFailure("state-facts", state, ref.key, error); return null; }
  }));
  return read.some(state => state === null) ? null : read.flat() as BodyFacts[];
}

export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderManifest, "authorityArtifacts" | "registrations" | "stateLegislators" | "stateFacts" | "stateAuthorities">,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  families: readonly AuthorityFamily[] = AUTHORITY_FAMILIES,
): Promise<ReaderAuthorityEdgeBundle> {
  try {
    const refs = manifest.authorityArtifacts;
    const promotedFamilies = new Set<string>();
    const bundle: {
      censusDistricts?: { value: CensusDistrictEdge; versionId: string };
      federalDirectory?: { value: FederalDirectoryReadModel; versionId: string };
      campaignSites?: { value: CuratedReaderProjection; versionId: string };
      meetingOutcomes?: { value: OutcomeSnapshot; versionId: string };
      commentAccess?: { value: CommentAccessProjection; versionId: string };
    } = {};
    const factReads = new Map<string, Promise<{ bodies: readonly BodyFacts[]; versionId: string | null } | null>>();
    const stateRegistryFacts = store ? { stateRegistryFacts: { key: (state: string) => manifest.stateFacts?.[state]?.key ?? null, load: (state: string) => {
      const selectionKey = `${state}:${[...currentReaderSelection()?.keys ?? []].sort().join("|")}`;
      let read = factReads.get(selectionKey);
      if (!read) {
        read = (async () => {
          const ref = manifest.stateFacts?.[state];
          const selected = currentReaderSelection();
          const localKeys = selected ? [...selected.keys].filter(key => statesForRegistryDivisions([key]).includes(state)) : [];
          const placeSelection = selected && localKeys.some(key => /\/(?:state|district|territory):[a-z]{2}\//i.test(key) || key.includes("#")) ? selected : undefined;
          const bodies = ref ? await readStateFacts([[state, ref]], store, placeSelection) : [];
          if (!bodies) return null;
          const prior = bundle.commentAccess;
          bundle.commentAccess = { versionId: [...new Set([prior?.versionId, ref?.version ?? `not-recorded:${state}`].filter(Boolean))].join("|"),
            value: { kind: "comment-access", records: [...new Map([...prior?.value.records ?? [],
              ...bodies.flatMap(body => body.comment ? [{ id: `comment-access:${body.id}`, ...body.comment }] : [])].map(row => [row.id, row])).values()] } };
          return { bodies, versionId: ref?.version ?? null };
        })();
        factReads.set(selectionKey, read);
      }
      return read;
    } } } : {};
    const stateAuthorityRefs = manifest.stateAuthorities ?? {};
    const stateAuthorities = stateAuthorityRefs && store ? { stateAuthorities: {
      key: (family: StateAuthorityFamily, state: string) => stateAuthorityRefs[family]?.[state]?.key ?? null,
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
    if (!refs || !store) return Object.assign(bundle, registrations, stateLegislators, stateAuthorities, stateRegistryFacts, { promotedFamilies });
    const wanted = new Set(families);
    const fetchWanted = (family: GlobalAuthorityFamily) =>
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
    const [federal, campaign, outcomes] = await Promise.all([
      fetchWanted("federal-directory"), fetchWanted("campaign-sites"), fetchWanted("meeting-outcomes"),
    ]);
    if (federal !== null) bundle.federalDirectory = { value: federal as FederalDirectoryReadModel, versionId: refs["federal-directory"]!.version };
    if (campaign !== null) bundle.campaignSites = { value: campaign as CuratedReaderProjection, versionId: refs["campaign-sites"]!.version };
    if (outcomes !== null) bundle.meetingOutcomes = { value: outcomes as OutcomeSnapshot, versionId: refs["meeting-outcomes"]!.version };
    if (censusDistricts !== null) bundle.censusDistricts = { value: censusDistricts as CensusDistrictEdge, versionId: refs["census-districts"]!.version };
    const promoted = new Map<string, PromotedEdgeEntry>();
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
    return Object.assign(bundle, registrations, stateLegislators, stateAuthorities, stateRegistryFacts, { promoted, promotedFamilies, loadPromoted,
      ...(selected ? { selection: selected } : {}) });
  } catch (error) {
    holdReaderAuthorityEdge(error, manifest, families);
    throw error;
  }
}

export async function publishReaderEdgeArtifacts(
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly now?: string;
    readonly extras?: PublishReaderExtras;
    readonly authority?: PublishAuthority;
    readonly stateAuthorities?: PublishStateAuthorities;
    readonly registrations?: PublishRegistrations;
    readonly stateLegislators?: PublishRegistrations;
    /** Complete: one entry per state with live facts. */
    readonly stateFacts?: PublishRegistrations;
    /** Complete: one entry per state with meetings. */
    readonly meetingStates?: PublishRegistrations;
  } = {},
): Promise<PublishReaderEdgeResult> {
  const store = options.store ?? resolveReaderArtifactWriteStore();
  if (!store) return { status: "SKIPPED_NO_STORE" };
  const now = options.now ?? new Date().toISOString();

  const extrasSha = extrasFingerprint(options.extras);
  const authorityVersions = (m: Pick<ReaderManifest, "authorityArtifacts"> | undefined) =>
    GLOBAL_AUTHORITY_FAMILIES.map((f) => `${f}=${m?.authorityArtifacts?.[f]?.version ?? ""}`).join("|");
  const newAuthorityVersions = GLOBAL_AUTHORITY_FAMILIES
    .map((f) => `${f}=${options.authority?.[f]?.versionId ?? ""}`)
    .join("|");
  const registrationVersions = (entries: readonly (readonly [string, string])[] | null) =>
    entries === null ? "none" : entries.map(([state, version]) => `${state}=${version}`).sort().join("|");
  const newRegistrationVersions = registrationVersions(
    options.registrations === undefined ? null : Object.entries(options.registrations).map(([state, entry]) => [state, entry.versionId] as const),
  );
  const newLegislatorVersions = registrationVersions(options.stateLegislators === undefined ? null : Object.entries(options.stateLegislators).map(([scope, entry]) => [scope, entry.versionId] as const));
  const newStateFactVersions = registrationVersions(options.stateFacts === undefined ? null : Object.entries(options.stateFacts).map(([state, entry]) => [state, entry.versionId] as const));
  const newMeetingVersions = registrationVersions(options.meetingStates === undefined ? null : Object.entries(options.meetingStates).map(([state, entry]) => [state, entry.versionId] as const));

  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  if (current) {
    const sameExtras = options.extras === undefined || extrasFingerprint({
      everydayRouting: current.manifest.everydayRouting,
      versionIds: current.manifest.extrasVersionIds,
    }) === extrasSha;
    const sameAuthority = !Object.keys(current.manifest.authorityArtifacts ?? {}).some(family => !GLOBAL_AUTHORITY_FAMILIES.includes(family as GlobalAuthorityFamily)) && (options.authority === undefined || (authorityVersions(current.manifest) === newAuthorityVersions &&
      Object.values(current.manifest.authorityArtifacts ?? {}).every(ref => ref.layout === "records")));
    const sameRegistrations = options.registrations === undefined || registrationVersions(
      current.manifest.registrations === undefined ? null : Object.entries(current.manifest.registrations).map(([state, ref]) => [state, ref.version] as const),
    ) === newRegistrationVersions;
    const sameLegislators = options.stateLegislators === undefined || registrationVersions(current.manifest.stateLegislators === undefined ? null : Object.entries(current.manifest.stateLegislators).map(([scope, ref]) => [scope, ref.version] as const)) === newLegislatorVersions;
    const sameStateFacts = options.stateFacts === undefined || registrationVersions(current.manifest.stateFacts === undefined ? null
      : Object.entries(current.manifest.stateFacts).map(([state, ref]) => [state, ref.version] as const)) === newStateFactVersions;
    const sameMeetingStates = options.meetingStates === undefined || registrationVersions(current.manifest.meetingStates === undefined ? null
      : Object.entries(current.manifest.meetingStates).map(([state, ref]) => [state, ref.version] as const)) === newMeetingVersions;
    const sameStateAuthorities = Object.entries(options.stateAuthorities ?? {}).every(([family, states]) =>
      current.manifest.stateAuthorities?.[family as StateAuthorityFamily] !== undefined &&
      Object.entries(states).every(([state, entry]) => current.manifest.stateAuthorities?.[family as StateAuthorityFamily]?.[state]?.version === entry.versionId));
    if (sameStateAuthorities && sameExtras && sameAuthority && sameRegistrations && sameLegislators && sameStateFacts && sameMeetingStates) {
      return { status: "CURRENT", sequence: current.manifest.sequence, states: Object.keys(current.manifest.meetingStates ?? {}).length };
    }
  }

  const sequence = (current?.manifest.sequence ?? 0) + 1;
  const meetingStates: Record<string, AuthorityArtifactRef> = options.meetingStates === undefined ? { ...current?.manifest.meetingStates } : {};
  const authorityArtifacts: Partial<Record<GlobalAuthorityFamily, AuthorityArtifactRef>> = options.authority === undefined ? Object.fromEntries(Object.entries(current?.manifest.authorityArtifacts ?? {}).filter(([family]) => GLOBAL_AUTHORITY_FAMILIES.includes(family as GlobalAuthorityFamily))) : {};
  const stateAuthorities: Partial<Record<StateAuthorityFamily, Record<string, AuthorityArtifactRef>>> = Object.fromEntries(
    Object.entries(current?.manifest.stateAuthorities ?? {}).map(([family, states]) => [family, { ...states }]));
  const registrations: Record<string, AuthorityArtifactRef> = options.registrations === undefined ? { ...current?.manifest.registrations } : {};
  const stateLegislators: Record<string, AuthorityArtifactRef> = options.stateLegislators === undefined ? { ...current?.manifest.stateLegislators } : {};
  const stateFacts: Record<string, AuthorityArtifactRef> = options.stateFacts === undefined ? { ...current?.manifest.stateFacts } : {};
  try {
    for (const family of GLOBAL_AUTHORITY_FAMILIES) {
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
    for (const family of STATE_AUTHORITY_FAMILIES) {
      const entries = options.stateAuthorities?.[family];
      if (!entries) continue;
      const refs = stateAuthorities[family] ??= {};
      for (const [state, entry] of Object.entries(entries)) {
        const served = current?.manifest.stateAuthorities?.[family]?.[state];
        if ("artifact" in entry && entry.expectedPreviousVersion !== undefined &&
          (served?.version ?? null) !== entry.expectedPreviousVersion && served?.version !== entry.versionId) return { status: "RACED", sequence };
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
    for (const [state, entry] of Object.entries(options.meetingStates ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.meetingStates?.[state];
        if (!served || served.version !== entry.versionId) return { status: "RACED", sequence };
        meetingStates[state] = served;
        continue;
      }
      const envelope: MeetingStateArtifactEnvelope = { formatVersion: READER_ARTIFACT_FORMAT_VERSION, family: "meeting-index", state, versionId: entry.versionId, generatedAt: now, value: entry.value as MeetingStateIndex };
      const key = await store.putImmutable(gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")), "json.gz");
      meetingStates[state] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
  } catch (error) {
    // Complete immutable bytes precede CAS; partial writes cannot change a served artifact.
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  const manifest: ReaderManifest = {
    formatVersion: READER_ARTIFACT_FORMAT_VERSION,
    sequence,
    ...(options.meetingStates !== undefined || current?.manifest.meetingStates !== undefined ? { meetingStates } : {}),
    ...(options.extras === undefined ? {
      ...(current?.manifest.everydayRouting !== undefined ? { everydayRouting: current.manifest.everydayRouting } : {}),
      ...(current?.manifest.extrasVersionIds !== undefined ? { extrasVersionIds: current.manifest.extrasVersionIds } : {}),
    } : {
      ...(options.extras.everydayRouting !== undefined ? { everydayRouting: options.extras.everydayRouting } : {}),
      ...(options.extras.versionIds !== undefined ? { extrasVersionIds: options.extras.versionIds } : {}),
    }),
    ...(Object.keys(authorityArtifacts).length > 0 ? { authorityArtifacts } : {}),
    ...(Object.keys(stateAuthorities).length ? { stateAuthorities } : {}),
    ...(options.registrations !== undefined || current?.manifest.registrations !== undefined ? { registrations } : {}),
    ...(options.stateLegislators !== undefined || current?.manifest.stateLegislators !== undefined ? { stateLegislators } : {}),
    ...(options.stateFacts !== undefined || current?.manifest.stateFacts !== undefined ? { stateFacts } : {}),
  };
  let result;
  try {
    result = await store.writeManifest(manifest, current?.etag ?? null);
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }
  return result.modified
    ? { status: "PUBLISHED", sequence, states: Object.keys(meetingStates).length }
    : { status: "RACED", sequence };
}


// Reads answered whole from published edge artifacts; only these may be held by the CDN.
const completeEdgeReads = new WeakSet<object>();
const areaReads = new Map<string, MeetingsProjectionReadResult>();
const meetingIndexEdgeCache = new Map<string, { version: string; value: Promise<MeetingStateIndex | null> }>();
const meetingBlobs = new Map<string, Promise<unknown>>();

interface MeetingStateArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "meeting-index";
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: MeetingStateIndex;
}

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
  const [read, settings] = await Promise.all([readReaderEdgeMeetingsHeld(options), options.settings ?? readReaderMeetingSettings()]);
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
  const row = await readMeetingBodyRow(state, bodyId, options.dataStore);
  if (row === null) return null;
  return {
    key: null, checks: { checkedAt: null, routes: {} }, fromEdge: false, agenda: wantAgenda ? row.snapshot.agendaDocuments : [],
    record: { formatVersion: MEETING_BODY_FORMAT_VERSION, bodyId, snapshot: { ...row.snapshot, agendaDocuments: [] }, agenda: null, history: null,
      sourceThrough: row.sourceThrough, retrievedAt: row.retrievedAt, promotedThrough: row.promotedThrough },
    history: wantHistory ? await readMeetingBodyHistory(row, options.dataStore) : null,
  };
}

/** One state's index: the edge's when it supplies one, else the database row, else none. */
async function loadStateIndex(
  state: string,
  manifest: ReaderManifest | null,
  store: ReaderArtifactStore | null,
  dataStore: ReaderEdgeMeetingsOptions["dataStore"],
): Promise<MeetingStateIndex | null> {
  const ref = manifest?.meetingStates?.[state];
  if (store && ref) {
    const served = await readServedMeetingIndex(state, ref, store);
    if (served) return served;
  } else if (manifest?.meetingStates !== undefined) return null;
  return readMeetingIndexRow(state, dataStore);
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
    const index = await loadStateIndex(state, manifest, store, options.dataStore);
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

  const indexes = await Promise.all(states.map(async (state) => ({ state, index: await loadStateIndex(state, manifest, store, options.dataStore) })));
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

  const areaKey = sha256OfJson({ agenda: options.includeAgenda !== false, history: options.window === "HELD", bodies: bodies.map(({ key, record, checks }) => [key ?? record.bodyId, checks]) });
  const cachedArea = areaReads.get(areaKey);
  if (cachedArea && loaded.length === bodies.length) return cachedArea;

  const merged = mergeMeetingBodies(bodies);
  // Each served sitting takes its body's live facts from that body's record.
  let value = merged.snapshot;
  let factsRead = true;
  if (store && manifest?.stateFacts) {
    const facts = await readStateFacts(Object.entries(manifest.stateFacts), store, { keys: new Set(sittingBodies(merged.snapshot.meetings)) });
    factsRead = facts !== null;
    value = { ...value, meetings: withSittingFacts(value.meetings, facts?.flatMap(body => body.sittings) ?? []) };
  } else {
    const stored = await withStoredSittingFacts({ kind: "PROMOTED", value, metadata: NOT_A_PLACE.metadata, detail: "" });
    if (stored.kind === "PROMOTED") value = stored.value;
  }
  const complete = bodies.length === loaded.length && bodies.every((body) => body.fromEdge) && factsRead && store !== null && manifest?.meetingStates !== undefined;
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
    detail: `Served from ${bodies.length}/${loaded.length} body record(s) in ${indexes.filter(({ index }) => index !== null).map(({ state }) => state).join(", ") || "no state"}.`,
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
