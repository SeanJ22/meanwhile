import { gzipSync, gunzipSync } from "node:zlib";

import {
  artifactKey,
  authorityArtifactKey,
  mergeScopeArtifacts,
  registrationArtifactKey,
  partitionSnapshotByScope,
  readerScopeApplies,
  scopesForStates,
  sha256OfJson,
  AUTHORITY_FAMILIES,
  PROMOTED_AUTHORITY_FAMILIES,
  READER_ARTIFACT_FORMAT_VERSION,
  type AuthorityArtifactRef,
  type AuthorityFamily,
  type PromotedFamilyArtifactValue,
  type ReaderGeoArtifact,
  type ReaderManifest,
  type ReaderManifestScope,
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
import { activeReaderProofMeetingPin } from "./proof-pin.ts";
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

/**
 * Publish + read for the geographic reader edge artifacts.
 *
 * PUBLISH (the standing runner, after it composes once): split the composition
 * into per-scope artifacts, write the immutable ones, then flip the manifest
 * pointer with a monotonic compare-and-set. Idempotent — an unchanged
 * composition republishes nothing. Last-valid-safe — a failed publish leaves
 * the previous manifest and artifacts serving.
 *
 * READ (the reader): read the manifest, fetch the artifacts for the ZIP's
 * scopes, merge. The reader never composes 124 partitions and never wakes the
 * database on this path; a CDN-cached Route Handler in front of it serves the
 * bytes from the edge. The fallback chain is edge → DB prepared row → live
 * compose, so the reader always answers.
 */

/**
 * Purge Netlify CDN cache tags so a new publication switches over instantly
 * rather than waiting out the manifest's `s-maxage`. Off-Netlify (the runner)
 * this needs a site id + a Netlify token; absent either, it no-ops and the new
 * data still appears within the manifest TTL — never a failure.
 */
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

/**
 * What a manifest says about quiet re-checks (lib/meetings/fresh-checks.ts):
 * the composition its scope artifacts were partitioned from, and each route's
 * newest successful fresh check that found nothing new.
 */
export interface PublishReaderChecks {
  readonly composition: string;
  readonly freshChecks: Readonly<Record<string, string>>;
}

/** A manifest already states these checks and this "Last checked". */
function manifestStatesChecks(manifest: ReaderManifest, generatedAt: string, checks: PublishReaderChecks | undefined): boolean {
  return manifest.generatedAt === generatedAt &&
    (manifest.composition ?? null) === (checks?.composition ?? null) &&
    sameMeetingFreshChecks(manifest.freshChecks, checks?.freshChecks);
}

/** The manifest with new checks and "Last checked", everything it points at unchanged. */
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

/**
 * **A QUIET RE-CHECK REPUBLISHES THE MANIFEST ALONE** (2026-09-25).
 *
 * When the served scope artifacts are exactly the composition the prepared
 * serving copy still holds (`composition`), and a partition was re-checked with
 * nothing new, only "Last checked" and the route checks move: one small manifest
 * write, compare-and-set like every publish, pointing at the same immutable
 * artifacts. No row is read from the database and no artifact is rewritten. A
 * manifest from another composition is refused (NOT_COMPOSABLE), and the caller
 * publishes in full.
 */
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

/** The other ready-to-display reader families the runner embeds in the manifest. */
export interface PublishReaderExtras {
  readonly commentAccess?: readonly unknown[];
  readonly everydayRouting?: unknown;
  readonly versionIds?: ReaderManifest["extrasVersionIds"];
}

/** One large "authority" family the runner publishes as its own compressed artifact. */
export interface PublishAuthorityValue {
  readonly value: unknown;
  readonly versionId: string;
}
/**
 * A family whose promoted version is exactly the one the current manifest
 * already serves. Its artifact was written from a proven read of that same
 * immutable version, so publish reuses the manifest's reference instead of
 * the runner reading the whole value (24 MB for registry-runtime) every pass.
 */
export interface PublishAuthorityCarried {
  readonly versionId: string;
  readonly carried: true;
}
/** The authority families the runner may publish, keyed by family id. */
export type PublishAuthority = Partial<Record<AuthorityFamily, PublishAuthorityValue | PublishAuthorityCarried>>;
/**
 * Every state's promoted registration the runner publishes, keyed by lower-case state: a proven value, or the
 * version the manifest already serves. The set is COMPLETE, one entry per promoted registration pointer, because the
 * reader reads a state it does not name as having none (`ReaderManifest.registrations`).
 */
export type PublishRegistrations = Readonly<Record<string, PublishAuthorityValue | PublishAuthorityCarried>>;

interface RegistrationArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: "registration";
  readonly state: string;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

/** The version a manifest serves for one authority family, or null when it serves none. */
export function servedAuthorityVersion(
  manifest: Pick<ReaderManifest, "authorityArtifacts"> | null | undefined,
  family: AuthorityFamily,
): string | null {
  return manifest?.authorityArtifacts?.[family]?.version ?? null;
}

/** The compressed authority artifact envelope stored in the edge store. */
interface AuthorityArtifactEnvelope {
  readonly formatVersion: typeof READER_ARTIFACT_FORMAT_VERSION;
  readonly family: AuthorityFamily;
  readonly versionId: string;
  readonly generatedAt: string;
  readonly value: unknown;
}

function extrasFingerprint(extras: PublishReaderExtras | undefined): string {
  return sha256OfJson({
    commentAccess: extras?.commentAccess ?? null,
    everydayRouting: extras?.everydayRouting ?? null,
    versionIds: extras?.versionIds ?? null,
  });
}

/**
 * **THE MANIFEST IS HELD FOR FIFTEEN SECONDS PER INSTANCE.** (C21, 2026-09-25.)
 *
 * Every `/api/meetings`, Ask and funding request read the ~140 KB manifest from
 * Netlify Blobs before anything else (~0.2 s measured on production), so a
 * reader's second request seconds after the first paid it again. Now one read
 * serves an instance for {@link READER_MANIFEST_MEMO_MS}, and concurrent
 * requests share the read in flight.
 *
 * Why fifteen seconds, and why that is no staler than before: the reader's
 * Blobs read is `eventual` (edge-store.ts), which Netlify allows to lag a write
 * by up to 60 s, so a request just after a publish could already be served the
 * previous manifest, and after the runner purges the `reader-manifest` tag the
 * CDN could already be refilled from such a read. Holding the manifest adds at
 * most fifteen seconds to that window: a new publication reaches every reader
 * within 60 s + 15 s + the CDN's 300 s `s-maxage` in the worst case, and
 * immediately in the usual one. Both are far inside the hourly refresh rule
 * (docs/rulings.md §4). A failed or absent read is never held.
 *
 * Only the Netlify Blobs store is held. The local-file store (dev, tests,
 * measurement) is a disk read and is always read fresh, so a test that
 * republishes sees its new manifest at once.
 */
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

/** Read just the current manifest (or null). The reader uses this once per
 * request to serve meetings AND the embedded families from one edge read. */
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

/**
 * The authority families the map's own routes read (C21, 2026-09-25):
 * `/api/meetings` and `/api/representation` resolve divisions, coverage and
 * officeholders, and never read the recorded meeting outcomes (~1.6 MB, Ask's)
 * or the comment-access artifact (the meetings route takes those rules from the
 * manifest). Fetching and parsing those two on a cold instance sat on the
 * critical path of every first map request for nothing.
 *
 * `/ballot` reads the same four (R30, 2026-09-25): divisions, the federal
 * officeholders, the campaign-site URLs that key the officeholder graph, and
 * the state legislators incumbency asks about.
 */
export const READER_MAP_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "census-districts",
  "registry-runtime",
  "federal-directory",
  "campaign-sites",
  "state-legislators",
];

/**
 * What a cold `/ballot` reads (2026-09-25): the map's four, and the proven
 * pointers it read from the database in two stages until now — the ballots,
 * the candidate profiles (with the derived campaign sites) and publications,
 * the navigation links, the NH roster, FEC and state money. Never the
 * Ask-only records (Pima finance, votes, statements, executive actions).
 */
/**
 * What a cold `/api/funding` reads (2026-09-25): the registry and the federal
 * directory that plan a target, and the money itself — FEC, state money, and
 * the AZ ballot that carries Arizona's candidacy identity. Nothing else: the
 * route used to fetch every family, Ask's records included.
 */
export const READER_FUNDING_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  "registry-runtime",
  "federal-directory",
  "federal-funding",
  "state-money",
  "ballot-az",
];

export const READER_BALLOT_AUTHORITY_FAMILIES: readonly AuthorityFamily[] = [
  ...READER_MAP_AUTHORITY_FAMILIES,
  "ballot-contests",
  "ballot-az",
  "ballot-nh",
  "candidate-profiles",
  "candidate-publications",
  "ballot-navigation",
  "voting-sites",
  "official-filings",
  // A sitting legislator's capitol and district offices.
  "member-offices",
  "nh-members",
  "federal-funding",
  "state-money",
];

// The reader fetches each large authority artifact from the edge at most once
// per version per process; every request thereafter reuses the in-process value
// (national artifacts, shared by all ZIPs — never per-ZIP). The PROMISE is held
// (C21), so two reads on one instance share one fetch and one parse instead of
// each fetching megabytes; a fetch that answers null is not held.
const authorityEdgeCache = new Map<AuthorityFamily, { version: string; value: Promise<unknown | null> }>();

/**
 * Hold a fetch per key and version while it runs and after it answers. One that
 * answers null or throws is forgotten, so the next read fetches again; whoever
 * is already waiting on it still sees its null or its error.
 */
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

async function fetchAuthorityValue(
  family: AuthorityFamily,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<unknown | null> {
  if (!ref?.key || !ref.version) return null;
  return heldFetch(authorityEdgeCache, family, ref.version, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as AuthorityArtifactEnvelope;
      return envelope.value;
    } catch {
      return null;
    }
  });
}

// Per-scope meeting artifacts are immutable, so the reader fetches each scope's
// artifact at most once per published version per process and reuses it on every
// request thereafter; only the small manifest is read from the store per request.
// The cache holds one entry per scope (bounded ~50) but is gated by the manifest's
// per-scope content hash: a changed scope has a new sha256, so the next read misses
// and refreshes, replacing the prior version. Because the fresh manifest is the
// single monotonic pointer and names the sha the reader must serve, a cached entry
// can never serve data older than — or different from — what the manifest names.
// The fetch is held while it runs (C21), so a prefetch started before the
// request knows its exact states and the read that follows share one fetch.
// A read that failed is not held; the next one fetches again, as before.
const scopeArtifactCache = new Map<string, { version: string; value: Promise<ReaderGeoArtifact | null> }>();

function fetchScopeArtifact(
  scope: ReaderManifestScope,
  store: ReaderArtifactStore,
): Promise<ReaderGeoArtifact | null> {
  return heldFetch(scopeArtifactCache, scope.scope, scope.sha256, () => store.readArtifact(scope.key));
}

// Each state's registration artifact, fetched only when a request names the state, at most once per version.
const registrationEdgeCache = new Map<string, { version: string; value: Promise<RegistrationReadModel | null> }>();

async function fetchRegistrationArtifact(
  state: string,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<{ value: RegistrationReadModel; versionId: string } | null> {
  if (!ref?.key || !ref.version) return null;
  const version = ref.version;
  const value = await heldFetch(registrationEdgeCache, state, version, async () => {
    try {
      const bytes = await store.readBytes(ref.key);
      if (!bytes) return null;
      const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as RegistrationArtifactEnvelope;
      if (envelope.family !== "registration" || envelope.state !== state || envelope.versionId !== version) return null;
      return envelope.value as RegistrationReadModel;
    } catch {
      return null;
    }
  });
  return value === null ? null : { value, versionId: version };
}

/**
 * Start fetching, without waiting, what a request for these states will read
 * from the edge: their meeting scope artifacts and their registrations (C21,
 * 2026-09-25). `/api/meetings` learns its states exactly only after resolving
 * divisions, which waits on the authority families; a hint from the typed ZIP
 * (or the nearest one) lets these fetches run beside that instead of after it.
 * A hint is never an answer: the request still reads by the states its
 * divisions name, and a scope the hint missed is simply fetched then. Nothing
 * here reads the database or the request's edge context.
 */
export function prefetchReaderEdgeStates(
  manifest: ReaderManifest | null,
  states: readonly string[],
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): void {
  if (!manifest || !store || states.length === 0 || activeReaderProofMeetingPin() !== null) return;
  const wanted = new Set(scopesForStates(states));
  // A failed prefetch is not an answer: the real read sees the failure, or fetches again.
  for (const scope of manifest.scopes) if (wanted.has(scope.scope)) void fetchScopeArtifact(scope, store).catch(() => undefined);
  for (const state of states) {
    const ref = manifest.registrations?.[state];
    if (ref) void fetchRegistrationArtifact(state, ref, store);
  }
}

/**
 * Fetch (and cache in-process) the reader-authority edge bundle the manifest
 * points at — registry-runtime, the federal directory, and campaign-site URLs —
 * decompressing each. Any family the manifest does not carry, or whose fetch
 * fails, is simply absent from the bundle; the reader then falls back to the DB
 * path for THAT family on THAT request only. Never reads Neon.
 *
 * `families` names the ones this caller reads (C21): a family left out is not
 * fetched and is absent from the bundle, exactly as an unpublished one is.
 * Omitted, every family is fetched (Ask, funding, the keep-warm call).
 */
export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderManifest, "authorityArtifacts" | "registrations">,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
  families: readonly AuthorityFamily[] = AUTHORITY_FAMILIES,
): Promise<ReaderAuthorityEdgeBundle> {
  const refs = manifest.authorityArtifacts;
  const registrationRefs = manifest.registrations;
  // Registration is loaded per state on demand, never with the bundle (lib/registry/runtime-edge.ts RegistrationsEdge).
  const registrations = registrationRefs && store
    ? { registrations: { states: new Set(Object.keys(registrationRefs)), load: (state: string) => fetchRegistrationArtifact(state, registrationRefs[state], store) } }
    : {};
  if (!refs || !store) return registrations;
  const bundle: {
    censusDistricts?: { value: CensusDistrictEdge; versionId: string };
    registryRuntime?: { value: RegistryRuntimeReadModel; versionId: string };
    federalDirectory?: { value: FederalDirectoryReadModel; versionId: string };
    campaignSites?: { value: CuratedReaderProjection; versionId: string };
    stateLegislators?: { value: Record<string, OfficialStateLegislatorReadModel>; versionId: string };
    meetingOutcomes?: { value: OutcomeSnapshot; versionId: string };
    commentAccess?: { value: CuratedReaderProjection; versionId: string };
  } = {};
  // The families are independent artifacts, fetched together rather than one
  // after another on a cold instance (2026-09-24, C20/C22). Each fetch answers
  // null for its own failure, so one missing family never costs another.
  const wanted = new Set(families);
  const fetchWanted = (family: AuthorityFamily) =>
    wanted.has(family) ? fetchAuthorityValue(family, refs[family], store) : Promise.resolve(null);
  // The proven-pointer families start with the others, never after them.
  const promotedFetch = Promise.all(PROMOTED_AUTHORITY_FAMILIES.map(fetchWanted));
  const [registry, federal, campaign, legislators, outcomes, commentAccess, censusDistricts] = await Promise.all([
    fetchWanted("registry-runtime"),
    fetchWanted("federal-directory"),
    fetchWanted("campaign-sites"),
    fetchWanted("state-legislators"),
    fetchWanted("meeting-outcomes"),
    fetchWanted("comment-access"),
    fetchWanted("census-districts"),
  ]);
  if (registry !== null) bundle.registryRuntime = { value: registry as RegistryRuntimeReadModel, versionId: refs["registry-runtime"]!.version };
  if (federal !== null) bundle.federalDirectory = { value: federal as FederalDirectoryReadModel, versionId: refs["federal-directory"]!.version };
  if (campaign !== null) bundle.campaignSites = { value: campaign as CuratedReaderProjection, versionId: refs["campaign-sites"]!.version };
  if (legislators !== null) bundle.stateLegislators = { value: legislators as Record<string, OfficialStateLegislatorReadModel>, versionId: refs["state-legislators"]!.version };
  if (outcomes !== null) bundle.meetingOutcomes = { value: outcomes as OutcomeSnapshot, versionId: refs["meeting-outcomes"]!.version };
  if (commentAccess !== null) bundle.commentAccess = { value: commentAccess as CuratedReaderProjection, versionId: refs["comment-access"]!.version };
  if (censusDistricts !== null) bundle.censusDistricts = { value: censusDistricts as CensusDistrictEdge, versionId: refs["census-districts"]!.version };
  // The proven-pointer families, fetched beside the others. A family whose
  // artifact is missing, failed or malformed adds nothing, and each of its
  // pointers is then read from the database by its own settle.
  const promoted = new Map<string, PromotedEdgeEntry>();
  const promotedFamilies = new Set<string>();
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
  return { ...bundle, ...registrations, ...(promoted.size > 0 ? { promoted, promotedFamilies } : {}) };
}

function scopeDataSha(artifact: ReaderGeoArtifact): string {
  // Stable over re-runs: hashes the DATA, not the generatedAt stamp, so an
  // unchanged composition produces the same sha and republishes nothing.
  return sha256OfJson({ meetings: artifact.meetings, agendaDocuments: artifact.agendaDocuments });
}

/**
 * Publish the composed snapshot as per-scope edge artifacts + a monotonic
 * manifest. `store` defaults to the runner write store (Netlify Blobs with
 * explicit creds, or a local dir); returns SKIPPED_NO_STORE when neither is
 * configured so the runner degrades to the DB prepared row rather than failing.
 */
export async function publishReaderEdgeArtifacts(
  snapshot: MeetingsSnapshot | null,
  metadata: PublishMetadata,
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly now?: string;
    readonly extras?: PublishReaderExtras;
    readonly authority?: PublishAuthority;
    readonly registrations?: PublishRegistrations;
    readonly meetingBodies?: Parameters<typeof partitionSnapshotByScope>[2];
    readonly meetingRegistryVersion?: string | null;
    /** The composition and its quiet re-checks (lib/meetings/fresh-checks.ts), stated in the manifest. */
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

  let current;
  try {
    current = await store.readManifest();
  } catch (error) {
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  // Idempotent: identical scope set AND per-scope data AND embedded families AND
  // all authority-family versions → nothing to do. Any of them changing advances
  // the pointer, because all of them are part of what serves.
  if (current) {
    const currentShas = new Map(current.manifest.scopes.map((s) => [s.scope, s.sha256]));
    const sameSet = snapshot === null || (currentShas.size === shaByScope.size &&
      [...shaByScope].every(([scope, sha]) => currentShas.get(scope) === sha));
    const sameExtras = extrasFingerprint({
      commentAccess: current.manifest.commentAccess,
      everydayRouting: current.manifest.everydayRouting,
      versionIds: current.manifest.extrasVersionIds,
    }) === extrasSha;
    const sameAuthority = authorityVersions(current.manifest) === newAuthorityVersions;
    const sameRegistrations = registrationVersions(
      current.manifest.registrations === undefined ? null : Object.entries(current.manifest.registrations).map(([state, ref]) => [state, ref.version] as const),
    ) === newRegistrationVersions;
    const sameMeetingAreas = snapshot === null || options.meetingRegistryVersion === undefined ||
      current.manifest.meetingRegistryVersion === options.meetingRegistryVersion;
    if (sameSet && sameExtras && sameAuthority && sameRegistrations && sameMeetingAreas) {
      const generatedAt = snapshot?.generatedAt || (options.checks ? laterCheck(current.manifest.generatedAt, metadata.retrievedAt) : null) || current.manifest.generatedAt;
      const checks = options.checks ?? (snapshot === null && current.manifest.composition !== undefined
        ? { composition: current.manifest.composition, freshChecks: current.manifest.freshChecks ?? {} } : undefined);
      if (manifestStatesChecks(current.manifest, generatedAt, checks)) {
        return { status: "CURRENT", sequence: current.manifest.sequence, scopes: current.manifest.scopes.length };
      }
      // The same data, re-checked: "Last checked" and the route checks move and
      // nothing else, so the manifest points at the artifacts it already serves.
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
  const authorityArtifacts: Partial<Record<AuthorityFamily, AuthorityArtifactRef>> = {};
  const registrations: Record<string, AuthorityArtifactRef> = {};
  // Complete or absent: one carried state the manifest no longer serves at that version drops the whole section this
  // pass (the reader then reads registration from the database), so a registered state never reads as having none.
  let registrationsComplete = options.registrations !== undefined;
  try {
    for (const artifact of artifacts) {
      const unchanged = current?.manifest.scopes.find(scope => scope.scope === artifact.scope && scope.sha256 === shaByScope.get(artifact.scope));
      if (unchanged) {
        manifestScopes.push(unchanged);
        continue;
      }
      const key = artifactKey(sequence, artifact.scope);
      await store.writeArtifact(key, artifact);
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
    // Each large authority family: one compressed, immutable, NATIONAL artifact
    // (never per-ZIP), pointed at by the manifest.
    for (const family of AUTHORITY_FAMILIES) {
      const entry = options.authority?.[family];
      if (!entry) continue;
      if ("carried" in entry) {
        // Only the exact version this manifest serves carries forward; if the
        // manifest moved since the caller looked, the family is left out, as a
        // failed read is, and the Reader falls back to the database for it.
        const served = current?.manifest.authorityArtifacts?.[family];
        if (served && served.version === entry.versionId) authorityArtifacts[family] = served;
        continue;
      }
      const key = authorityArtifactKey(sequence, family);
      const envelope: AuthorityArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family,
        versionId: entry.versionId,
        generatedAt: now,
        value: entry.value,
      };
      await store.writeBytes(key, gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")));
      authorityArtifacts[family] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
    // Each state's registration: one compressed, immutable artifact per state, written only when its version moved.
    for (const [state, entry] of Object.entries(options.registrations ?? {})) {
      if ("carried" in entry) {
        const served = current?.manifest.registrations?.[state];
        if (served && served.version === entry.versionId) registrations[state] = served;
        else registrationsComplete = false;
        continue;
      }
      const key = registrationArtifactKey(sequence, state);
      const envelope: RegistrationArtifactEnvelope = {
        formatVersion: READER_ARTIFACT_FORMAT_VERSION,
        family: "registration",
        state,
        versionId: entry.versionId,
        generatedAt: now,
        value: entry.value,
      };
      await store.writeBytes(key, gzipSync(Buffer.from(JSON.stringify(envelope), "utf8")));
      registrations[state] = { key, version: entry.versionId, sha: sha256OfJson(entry.value) };
    }
  } catch (error) {
    // Artifacts are content-addressed by this new sequence; a partial write
    // leaves the previous manifest untouched, so the last valid set keeps serving.
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
    ...(options.extras?.commentAccess !== undefined ? { commentAccess: options.extras.commentAccess } : {}),
    ...(options.extras?.everydayRouting !== undefined ? { everydayRouting: options.extras.everydayRouting } : {}),
    ...(options.extras?.versionIds !== undefined ? { extrasVersionIds: options.extras.versionIds } : {}),
    ...(Object.keys(authorityArtifacts).length > 0 ? { authorityArtifacts } : {}),
    ...(registrationsComplete ? { registrations } : {}),
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
  // CAS miss → a newer publish won; the immutable artifacts we wrote are simply
  // unreferenced. Never regress the pointer.
  return result.modified
    ? { status: "PUBLISHED", sequence, scopes: manifestScopes.length, meetings: snapshot?.meetings.length ?? manifestScopes.reduce((sum, scope) => sum + scope.meetingCount, 0) }
    : { status: "RACED", sequence };
}

// The reads `readReaderEdgeMeetings` answered whole from the published edge
// artifacts (C21). The meetings route lets the CDN hold only an answer built
// from one of these: the runner purges `reader-manifest` when it publishes, and
// a database-fallback or partial answer is not the publication that purge
// replaces.
const completeEdgeReads = new WeakSet<object>();
// Share a published area's merge, as well as its immutable artifacts. Every
// manifest observation is part of the key, including quiet freshness updates.
const areaReads = new Map<string, MeetingsProjectionReadResult>();

/**
 * The reader's edge path: manifest → the ZIP's scope artifacts → merged
 * snapshot. `states` narrows to the geographic artifacts the ZIP needs (plus
 * the national `us` bucket); omitted, every published scope is loaded. Falls
 * back to the DB prepared row (then live compose) when no edge store is
 * configured, no manifest exists yet, or the store is unreachable — a safety
 * backstop, never the routine path.
 */
export async function readReaderEdgeMeetings(
  options: ReaderEdgeMeetingsOptions = {},
): Promise<MeetingsProjectionReadResult> {
  const [read, settings] = await Promise.all([readReaderEdgeMeetingsHeld(options), options.settings ?? readReaderMeetingSettings()]);
  return applyServedWindow(read, options.window ?? "SHOWN", options.now, settings);
}

/**
 * Which part of what the partitions hold a read hands back (DB-01).
 *
 * `SHOWN` (the default): 90 days back and 90 ahead, for the map, "when does it
 * meet next" and agenda listings. `HELD`: every kept past meeting and the same
 * 90 ahead, for looking up a past meeting by body and date, since a promoted
 * partition keeps its concluded meetings with records for good.
 */
export type ReaderMeetingsWindow = "SHOWN" | "HELD";

const servedWindows = new WeakMap<object, Map<string, MeetingsProjectionReadResult>>();

/** Applies the served window once, on whichever path produced the read. */
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
  // Shared held reads need a fresh window for the exact clock and settings.
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
    /** A manifest already read this request, so the reader reads the store once. */
    readonly manifest?: ReaderManifest | null;
    /** Backstop when the edge has no answer; defaults to the DB prepared-row reader. */
    readonly fallback?: () => Promise<MeetingsProjectionReadResult>;
    /** `SHOWN` (default) or `HELD`; see `ReaderMeetingsWindow`. */
    readonly window?: ReaderMeetingsWindow;
    /** One request's published settings, when its caller already read them. */
    readonly settings?: MeetingSettings;
  };

async function readReaderEdgeMeetingsHeld(
  options: ReaderEdgeMeetingsOptions,
): Promise<MeetingsProjectionReadResult> {
  // The DB prepared-row / compose fallback takes only the clock — never the
  // artifact store, which is a different store from the routine data store.
  const fallback = options.fallback ?? (() => readPreparedMeetingsProjection(options.now ? { now: options.now } : {}));
  // Proof-only (lib/meetings/proof-pin.ts; null in every deployed build): an
  // edge artifact names no partition versions, so it cannot be shown to be
  // the pinned ones. The pinned run reads through the version-coupled fallback.
  if (activeReaderProofMeetingPin() !== null) return fallback();
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

  // A quiet re-check since these artifacts were written restamps its route's
  // fresh rows; "Last checked" is already the manifest's (lib/meetings/fresh-checks.ts).
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

/** Whether this read was served whole from the reader edge artifacts (every scope it asked for). */
export function servedWholeFromReaderEdge(read: MeetingsProjectionReadResult): boolean {
  return completeEdgeReads.has(read);
}
