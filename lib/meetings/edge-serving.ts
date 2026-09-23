import { gzipSync, gunzipSync } from "node:zlib";

import {
  artifactKey,
  authorityArtifactKey,
  mergeScopeArtifacts,
  partitionSnapshotByScope,
  scopesForStates,
  sha256OfJson,
  AUTHORITY_FAMILIES,
  READER_ARTIFACT_FORMAT_VERSION,
  type AuthorityArtifactRef,
  type AuthorityFamily,
  type ReaderGeoArtifact,
  type ReaderManifest,
  type ReaderManifestScope,
} from "./edge-artifacts.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import type { FederalDirectoryReadModel } from "../officials/federal-directory-data-plane.ts";
import type { CuratedReaderProjection } from "../civic-data/manual-projections.ts";
import type { OfficialStateLegislatorReadModel } from "../civic-data/candidate-builders.ts";
import type { ReaderAuthorityEdgeBundle } from "../registry/runtime-edge.ts";
import {
  resolveReaderArtifactStore,
  resolveReaderArtifactWriteStore,
  type ReaderArtifactStore,
} from "./edge-store.ts";
import {
  readPreparedMeetingsProjection,
} from "./prepared-snapshot.ts";
import {
  MEETINGS_RECORD_CLASS,
  MEETINGS_SCOPE,
  MEETINGS_SOURCE_ID,
  type MeetingsProjectionReadResult,
  type MeetingsSnapshot,
} from "./snapshot.ts";

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

/** The other ready-to-display reader families the runner embeds in the manifest. */
export interface PublishReaderExtras {
  readonly commentAccess?: readonly unknown[];
  readonly everydayRouting?: unknown;
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
  });
}

/** Read just the current manifest (or null). The reader uses this once per
 * request to serve meetings AND the embedded families from one edge read. */
export async function readReaderManifest(
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): Promise<ReaderManifest | null> {
  if (!store) return null;
  try {
    const stored = await store.readManifest();
    return stored?.manifest ?? null;
  } catch {
    return null;
  }
}

// The reader fetches each large authority artifact from the edge at most once
// per version per process; every request thereafter reuses the in-process value
// (national artifacts, shared by all ZIPs — never per-ZIP).
const authorityEdgeCache = new Map<AuthorityFamily, { version: string; value: unknown }>();

async function fetchAuthorityValue(
  family: AuthorityFamily,
  ref: AuthorityArtifactRef | undefined,
  store: ReaderArtifactStore,
): Promise<unknown | null> {
  if (!ref?.key || !ref.version) return null;
  const cached = authorityEdgeCache.get(family);
  if (cached?.version === ref.version) return cached.value;
  try {
    const bytes = await store.readBytes(ref.key);
    if (!bytes) return null;
    const envelope = JSON.parse(gunzipSync(bytes).toString("utf8")) as AuthorityArtifactEnvelope;
    authorityEdgeCache.set(family, { version: ref.version, value: envelope.value });
    return envelope.value;
  } catch {
    return null;
  }
}

// Per-scope meeting artifacts are immutable, so the reader fetches each scope's
// artifact at most once per published version per process and reuses it on every
// request thereafter; only the small manifest is read from the store per request.
// The cache holds one entry per scope (bounded ~50) but is gated by the manifest's
// per-scope content hash: a changed scope has a new sha256, so the next read misses
// and refreshes, replacing the prior version. Because the fresh manifest is the
// single monotonic pointer and names the sha the reader must serve, a cached entry
// can never serve data older than — or different from — what the manifest names.
const scopeArtifactCache = new Map<string, { sha256: string; artifact: ReaderGeoArtifact }>();

async function fetchScopeArtifact(
  scope: ReaderManifestScope,
  store: ReaderArtifactStore,
): Promise<ReaderGeoArtifact | null> {
  const cached = scopeArtifactCache.get(scope.scope);
  if (cached?.sha256 === scope.sha256) return cached.artifact;
  const artifact = await store.readArtifact(scope.key);
  if (artifact) scopeArtifactCache.set(scope.scope, { sha256: scope.sha256, artifact });
  return artifact;
}

/**
 * Fetch (and cache in-process) the reader-authority edge bundle the manifest
 * points at — registry-runtime, the federal directory, and campaign-site URLs —
 * decompressing each. Any family the manifest does not carry, or whose fetch
 * fails, is simply absent from the bundle; the reader then falls back to the DB
 * path for THAT family on THAT request only. Never reads Neon.
 */
export async function ensureReaderAuthorityEdge(
  manifest: Pick<ReaderManifest, "authorityArtifacts">,
  store: ReaderArtifactStore | null = resolveReaderArtifactStore(),
): Promise<ReaderAuthorityEdgeBundle> {
  const refs = manifest.authorityArtifacts;
  if (!refs || !store) return {};
  const bundle: {
    registryRuntime?: { value: RegistryRuntimeReadModel; versionId: string };
    federalDirectory?: { value: FederalDirectoryReadModel; versionId: string };
    campaignSites?: { value: CuratedReaderProjection; versionId: string };
    stateLegislators?: { value: Record<string, OfficialStateLegislatorReadModel>; versionId: string };
  } = {};
  const registry = await fetchAuthorityValue("registry-runtime", refs["registry-runtime"], store);
  if (registry !== null) bundle.registryRuntime = { value: registry as RegistryRuntimeReadModel, versionId: refs["registry-runtime"]!.version };
  const federal = await fetchAuthorityValue("federal-directory", refs["federal-directory"], store);
  if (federal !== null) bundle.federalDirectory = { value: federal as FederalDirectoryReadModel, versionId: refs["federal-directory"]!.version };
  const campaign = await fetchAuthorityValue("campaign-sites", refs["campaign-sites"], store);
  if (campaign !== null) bundle.campaignSites = { value: campaign as CuratedReaderProjection, versionId: refs["campaign-sites"]!.version };
  const legislators = await fetchAuthorityValue("state-legislators", refs["state-legislators"], store);
  if (legislators !== null) bundle.stateLegislators = { value: legislators as Record<string, OfficialStateLegislatorReadModel>, versionId: refs["state-legislators"]!.version };
  return bundle;
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
  snapshot: MeetingsSnapshot,
  metadata: PublishMetadata,
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly now?: string;
    readonly extras?: PublishReaderExtras;
    readonly authority?: PublishAuthority;
  } = {},
): Promise<PublishReaderEdgeResult> {
  const store = options.store ?? resolveReaderArtifactWriteStore();
  if (!store) return { status: "SKIPPED_NO_STORE" };
  const now = options.now ?? new Date().toISOString();

  let artifacts: ReaderGeoArtifact[];
  try {
    artifacts = partitionSnapshotByScope(snapshot, now);
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
    const sameSet = currentShas.size === shaByScope.size &&
      [...shaByScope].every(([scope, sha]) => currentShas.get(scope) === sha);
    const sameExtras = extrasFingerprint({
      commentAccess: current.manifest.commentAccess,
      everydayRouting: current.manifest.everydayRouting,
    }) === extrasSha;
    const sameAuthority = authorityVersions(current.manifest) === newAuthorityVersions;
    if (sameSet && sameExtras && sameAuthority) return { status: "CURRENT", sequence: current.manifest.sequence, scopes: artifacts.length };
  }

  const sequence = (current?.manifest.sequence ?? 0) + 1;
  const manifestScopes: ReaderManifestScope[] = [];
  const authorityArtifacts: Partial<Record<AuthorityFamily, AuthorityArtifactRef>> = {};
  try {
    for (const artifact of artifacts) {
      const key = artifactKey(sequence, artifact.scope);
      await store.writeArtifact(key, artifact);
      manifestScopes.push({
        scope: artifact.scope,
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
  } catch (error) {
    // Artifacts are content-addressed by this new sequence; a partial write
    // leaves the previous manifest untouched, so the last valid set keeps serving.
    return { status: "FAILED", error: error instanceof Error ? error.message : String(error) };
  }

  const manifest: ReaderManifest = {
    formatVersion: READER_ARTIFACT_FORMAT_VERSION,
    sequence,
    generatedAt: snapshot.generatedAt || now,
    sourceThrough: metadata.sourceThrough,
    retrievedAt: metadata.retrievedAt,
    promotedThrough: metadata.promotedThrough,
    sources: snapshot.sources,
    scopes: manifestScopes,
    ...(options.extras?.commentAccess !== undefined ? { commentAccess: options.extras.commentAccess } : {}),
    ...(options.extras?.everydayRouting !== undefined ? { everydayRouting: options.extras.everydayRouting } : {}),
    ...(Object.keys(authorityArtifacts).length > 0 ? { authorityArtifacts } : {}),
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
    ? { status: "PUBLISHED", sequence, scopes: artifacts.length, meetings: snapshot.meetings.length }
    : { status: "RACED", sequence };
}

/**
 * The reader's edge path: manifest → the ZIP's scope artifacts → merged
 * snapshot. `states` narrows to the geographic artifacts the ZIP needs (plus
 * the national `us` bucket); omitted, every published scope is loaded. Falls
 * back to the DB prepared row (then live compose) when no edge store is
 * configured, no manifest exists yet, or the store is unreachable — a safety
 * backstop, never the routine path.
 */
export async function readReaderEdgeMeetings(
  options: {
    readonly store?: ReaderArtifactStore | null;
    readonly states?: readonly string[];
    readonly now?: string;
    /** A manifest already read this request, so the reader reads the store once. */
    readonly manifest?: ReaderManifest | null;
    /** Backstop when the edge has no answer; defaults to the DB prepared-row reader. */
    readonly fallback?: () => Promise<MeetingsProjectionReadResult>;
  } = {},
): Promise<MeetingsProjectionReadResult> {
  // The DB prepared-row / compose fallback takes only the clock — never the
  // artifact store, which is a different store from the routine data store.
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

  const wanted = options.states
    ? new Set(scopesForStates(options.states))
    : null;
  const chosen = manifest.scopes.filter((s) => wanted === null || wanted.has(s.scope));
  const needed = chosen.length > 0 ? chosen : manifest.scopes; // never serve nothing when the manifest has data

  let artifacts: ReaderGeoArtifact[];
  try {
    const fetched = await Promise.all(needed.map((s) => fetchScopeArtifact(s, store)));
    artifacts = fetched.filter((a): a is ReaderGeoArtifact => a !== null);
  } catch {
    return fallback();
  }
  if (artifacts.length === 0) return fallback();

  const value = mergeScopeArtifacts(artifacts, manifest);
  const complete = artifacts.length === needed.length;
  return {
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
}
