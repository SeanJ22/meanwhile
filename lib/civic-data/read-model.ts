import { stateRegistryRuntimeScope } from "./state-scopes.ts";
import type { RegistryRuntimeReadModel } from "../registry/runtime-data-plane.ts";
import { statePublicationPriorOf, rememberStatePublicationHashes } from "./state-publication.ts";
import { federalRollPublicationPriorProof } from "./federal-roll-publication-base.ts";
import { readerDatabaseQuery } from "../reader/database.ts";
import { currentReaderRoute, currentReaderSelection, type ReaderSelection } from "../db/reader-route.ts";
import { createHash } from "node:crypto";
import { sourceCheckedAt } from "./source-check.ts";
import { currentReaderAuthorityEdge, ensurePromotedEdge, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";
import { readerCanonicalEntry } from "../reader/canonical-context.ts";

import type {
  CandidateVersionRecord,
  PromotedPointerIdentity,
  PromotedProjection,
  RoutineRecordClass,
  ValidationReceipt,
} from "./types.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { canonicalCivicDataHash } from "./canonical-hash.ts";
import { durableStateHash, immutableStateHash, immutableStateValue, statePublicationScope } from "./state-publication.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { promotedPayloadSha256, type AttestedPromotion } from "./attested-promotion.ts";
import {
  mayUseTestFixture,
  type CivicDataFixtureEnvironment,
} from "./fixture-policy.ts";
export { mayUseTestFixture } from "./fixture-policy.ts";
export type { CivicDataFixtureEnvironment } from "./fixture-policy.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import type { CandidateVersionReadback, PublishedCandidateMetadata, RoutineDataStore } from "./store.ts";
import { projectionKey } from "./projection-key.ts";

const TTL_MS = 30_000;
const SHA256 = /^[a-f0-9]{64}$/;

function trustedLkgPredecessorVersionId(candidate: CandidateVersionRecord | null): string | null {
  const evidence = candidate?.candidate.bootstrapImport;
  if (evidence?.kind === "TRUSTED_LKG_REATTESTATION") return evidence.predecessorVersionId;
  return evidence?.kind === "TRUSTED_LKG_IMPORT"
    ? evidence.pimaOutcomeUnion?.predecessorVersionId ?? null
    : null;
}

function readProofCandidate(
  store: Pick<RoutineDataStore, "readCandidate"> & Partial<Pick<RoutineDataStore, "readCandidateProof">>,
  versionId: string,
): Promise<CandidateVersionRecord | null> {
  return typeof store.readCandidateProof === "function" ? store.readCandidateProof(versionId) : store.readCandidate(versionId);
}

function durableProjectionHash(value: unknown): string | null {
  try {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) return null;
    const durable = JSON.parse(encoded) as unknown;
    const currentCanonical = canonicalCivicDataJson(value);
    const durableCanonical = canonicalCivicDataJson(durable);
    if (currentCanonical !== durableCanonical) return null;
    return createHash("sha256").update(durableCanonical).digest("hex");
  } catch {
    return null;
  }
}

export type CivicDataStaleState = "CURRENT" | "STALE" | "UNKNOWN";

export interface CivicDataReadMetadata {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly sourceId: string | null;
  /** The source's semantic version/term/vintage, not the candidate id. */
  readonly version: string | null;
  readonly versionId: string | null;
  readonly lastKnownGoodVersionId: string | null;
  readonly sourceThrough: string | null;
  readonly retrievedAt: string | null;
  /** Real provider check; original source evidence keeps retrievedAt. */
  readonly checkedAt?: string;
  readonly promotedAt: string | null;
  readonly stale: CivicDataStaleState;
  readonly staleAt: string | null;
}

export type CivicDataReadResult<T> =
  | {
      readonly kind: "PROMOTED";
      readonly value: T;
      readonly metadata: CivicDataReadMetadata;
      readonly projection: PromotedProjection<T>;
    }
  | {
      readonly kind: "BOOTSTRAP";
      readonly value: T;
      readonly metadata: CivicDataReadMetadata;
      readonly detail: string;
    }
  | {
      readonly kind: "NOT_RECORDED";
      readonly value: null;
      readonly metadata: CivicDataReadMetadata;
      readonly detail: string;
    }
  | {
      readonly kind: "STORE_UNREACHABLE";
      readonly value: null;
      readonly metadata: CivicDataReadMetadata;
      readonly code: "STORE_NOT_CONFIGURED" | "STORE_READ_FAILED" | "PROMOTION_CANDIDATE_MISSING" | "PROMOTION_PROOF_INVALID" | "READ_NOT_INITIALIZED";
      readonly detail: string;
    };

export type CivicDataReadStore = Pick<
  RoutineDataStore,
  "readPromotion" | "readCandidate"
> & Partial<Pick<RoutineDataStore, "readPromotions" | "readCandidates" | "readPromotionIdentity" | "readPromotionIdentities" | "readPublishedCandidateMetadata">> & {
  /** Already published canonical database rows, read together for the reader shelf. */
  readonly readPromotedEntry?: (recordClass: RoutineRecordClass, scope: string) => Promise<PromotedEdgeEntry>;
};

type CivicDataBatchReadStore = Pick<
  RoutineDataStore,
  "readPromotion" | "readCandidate" | "readPromotions" | "readCandidates"
> & Partial<Pick<RoutineDataStore, "readPromotionIdentities" | "readCandidateProof" | "readCandidateProofs" | "readPublishedCandidateMetadata">>;

export interface PromotedCivicDataReadOptions {
  readonly store?: CivicDataReadStore;
  readonly now?: string;
  /** Age from the actual retrieval instant, not from process start. */
  readonly maxAgeMs?: number;
  readonly bypassCache?: boolean;
  /** Used only for its own class and scope, while the pointer still names it and its payload hashes to the proven payload; never with `bypassCache`. */
  readonly attested?: AttestedPromotion;
  /** When present the read is answered from it and the store is not opened. The runner and verification paths never pass it. */
  readonly edge?: PromotedEdgeEntry<unknown>;
}

function attestationHolds(
  attested: AttestedPromotion,
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection<unknown>,
): boolean {
  return attested.recordClass === recordClass &&
    attested.scope === scope &&
    projection.recordClass === recordClass &&
    projection.scope === scope &&
    projection.key === projectionKey(recordClass, scope) &&
    projection.versionId === attested.versionId &&
    projection.lastKnownGoodVersionId === attested.versionId &&
    promotedPayloadSha256(projection.payload) === attested.payloadSha256;
}

function attestedCandidate(attested: AttestedPromotion, projection: PromotedProjection<unknown>): CandidateVersionRecord {
  return {
    candidate: {
      id: attested.versionId,
      sourceId: projection.sourceId,
      recordClass: attested.recordClass,
      scope: attested.scope,
      retrieval: { retrievedAt: attested.retrievedAt },
      temporal: {
        staleAtRetrieval: attested.staleAtRetrieval,
        version: attested.version,
        sourceThrough: attested.sourceThrough,
      },
    } as unknown as CandidateVersionRecord["candidate"],
    state: "PROMOTED",
    acquisitionSucceeded: true,
    receipt: projection.receipt,
    promotedVersion: attested.versionId,
    lastKnownGoodVersion: attested.versionId,
    failureCode: null,
    failureDetail: null,
  };
}

export function attestPromotedVersion(
  recordClass: RoutineRecordClass,
  scope: string,
  store: CivicDataReadStore,
): AttestedPromotion | null {
  if (isStateAuthorityScope(scope)) return stateAttestations.get(store)?.get(projectionKey(recordClass, scope)) ?? null;
  const proven = provenPointersOf(store, scope).get(projectionKey(recordClass, scope));
  if (!proven) return null;
  return attestationOf(recordClass, scope, proven.projection, proven.candidate);
}

function attestationOf(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection,
  candidate: ProvenCandidate,
  payloadSha256?: string,
): AttestedPromotion | null {
  const temporal = candidate.candidate.temporal;
  const retrievedAt = candidate.candidate.retrieval?.retrievedAt;
  if (typeof retrievedAt !== "string" || !temporal) return null;
  return {
    recordClass,
    scope,
    versionId: projection.versionId,
    payloadSha256: payloadSha256 ?? promotedPayloadSha256(projection.payload),
    retrievedAt,
    staleAtRetrieval: temporal.staleAtRetrieval === true,
    version: temporal.version ?? null,
    sourceThrough: temporal.sourceThrough ?? null,
  };
}

export type PromotedEdgeEntry<T = unknown> =
  | {
      readonly kind: "PROMOTED";
      readonly projection: PromotedProjection<T>;
      readonly attested: AttestedPromotion;
    }
  | {
      readonly kind: "NOT_RECORDED";
      readonly recordClass: RoutineRecordClass;
      readonly scope: string;
    };

export function promotedEdgeEntryOf<T>(
  result: CivicDataReadResult<T>,
  recordClass: RoutineRecordClass,
  scope: string,
  store?: CivicDataReadStore,
): PromotedEdgeEntry<T> | null {
  if (result.kind === "NOT_RECORDED") return { kind: "NOT_RECORDED", recordClass, scope };
  if (result.kind !== "PROMOTED") return null;
  if (isStateAuthorityScope(scope)) {
    const proven = stateProofs.get(result.projection);
    if (!proven || proven.attested.versionId !== result.projection.versionId || proven.attested.recordClass !== recordClass || proven.attested.scope !== scope) return null;
    const entry: PromotedEdgeEntry<T> = { kind: "PROMOTED", projection: result.projection, attested: proven.attested };
    verifiedEdgeEntries.add(entry);
    return entry;
  }
  const proven = provenPointersOf(store, scope).get(projectionKey(recordClass, scope));
  if (!proven || proven.projection.versionId !== result.projection.versionId) return null;
  const attested = attestationOf(recordClass, scope, result.projection, proven.candidate);
  return attested === null ? null : { kind: "PROMOTED", projection: result.projection, attested };
}

const verifiedEdgeEntries = new WeakSet<object>();
const provenEdgeEntries = new WeakSet<object>();

export function registerIntegrityCheckedEdgeEntries(entries: readonly PromotedEdgeEntry[]): void {
  for (const entry of entries) if (entry.kind === "PROMOTED") verifiedEdgeEntries.add(entry);
}

function promotedEdgeIssue(
  recordClass: RoutineRecordClass,
  scope: string,
  entry: Extract<PromotedEdgeEntry<unknown>, { kind: "PROMOTED" }>,
): string | null {
  const { projection, attested } = entry;
  if (projection.key !== projectionKey(recordClass, scope) || projection.recordClass !== recordClass || projection.scope !== scope) {
    return "the edge copy names another class or scope";
  }
  if (provenEdgeEntries.has(entry)) return null;
  if (projection.lastKnownGoodVersionId !== projection.versionId) return "the current pointer and last-known-good pointer diverge";
  if (attested.recordClass !== recordClass || attested.scope !== scope || attested.versionId !== projection.versionId) {
    return "the attestation does not name the pointed version";
  }
  const receipt = parseValidationReceipt(projection.receipt);
  if (
    !receipt || receipt.decision !== "GOOD" || receipt.candidateId !== projection.versionId ||
    receipt.sourceId !== projection.sourceId || receipt.recordClass !== recordClass || receipt.scope !== scope
  ) return "the GOOD receipt does not identify the attested version";
  if (!verifiedEdgeEntries.has(entry)) {
    if (promotedPayloadSha256(projection.payload) !== attested.payloadSha256) return "the payload does not hash to the attested payload";
    verifiedEdgeEntries.add(entry);
  }
  provenEdgeEntries.add(entry);
  return null;
}

function readPromotedFromEdge<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  entry: PromotedEdgeEntry<unknown>,
  now: string,
  maxAgeMs: number | undefined,
): CivicDataReadResult<T> {
  if (entry.kind === "NOT_RECORDED") {
    if (entry.recordClass !== recordClass || entry.scope !== scope) {
      return {
        kind: "STORE_UNREACHABLE",
        value: null,
        metadata: emptyMetadata(recordClass, scope),
        code: "PROMOTION_PROOF_INVALID",
        detail: `The reader edge answered for ${projectionKey(entry.recordClass, entry.scope)}, not ${projectionKey(recordClass, scope)}.`,
      };
    }
    return {
      kind: "NOT_RECORDED",
      value: null,
      metadata: emptyMetadata(recordClass, scope),
      detail: `The routine civic-data store answered and holds no canonical pointer for ${projectionKey(recordClass, scope)}.`,
    };
  }
  const projection = entry.projection as PromotedProjection<T>;
  const issue = promotedEdgeIssue(recordClass, scope, entry);
  if (issue !== null) return promotionProofInvalidResult(recordClass, scope, projection, `the reader edge copy: ${issue}`);
  return promotedResult(projection, attestedCandidate(entry.attested, projection), now, maxAgeMs);
}

function hasBatchReadDoor(store: CivicDataReadStore): store is CivicDataBatchReadStore {
  const candidate = store as Partial<CivicDataBatchReadStore>;
  return typeof candidate.readPromotions === "function" && typeof candidate.readCandidates === "function";
}

export interface CivicDataBootstrap<T> {
  readonly value: T;
  readonly sourceId: string;
  readonly version: string;
  readonly versionId: string;
  readonly sourceThrough: string;
  readonly retrievedAt: string | null;
  readonly staleAtRetrieval?: boolean;
  readonly stale?: CivicDataStaleState;
  readonly detail: string;
}

export interface PromotedOrBootstrapOptions<T> extends PromotedCivicDataReadOptions {
  readonly recordClass: RoutineRecordClass;
  readonly scope: string;
  readonly bootstrap: () => CivicDataBootstrap<T>;
  /** Production never consults the fixture: an absent pointer is an authority gap. */
  readonly allowUnconfiguredBootstrap?: boolean;
}

type ProvenCandidate = { readonly candidate: {
  readonly retrieval: Pick<CandidateVersionRecord["candidate"]["retrieval"], "retrievedAt" | "sourceCheck">;
  readonly temporal: Pick<CandidateVersionRecord["candidate"]["temporal"], "version" | "sourceThrough" | "staleAtRetrieval">;
} };
type ProvenPair = { readonly projection: PromotedProjection; readonly candidate: ProvenCandidate };
interface CachedPromotion extends ProvenPair { readonly expiresAt: number }

const cache = new Map<string, CachedPromotion | { readonly expiresAt: number; readonly projection: null }>();
const provenByVersion = new Map<string, ProvenPair>();
const DEFAULT_STORE: object = {};
let inflight = new WeakMap<object, Map<string, Promise<ProvenPair | null>>>();
let provenPointers = new WeakMap<object, Map<string, ProvenPair>>();
const stateRequests = new WeakMap<object, WeakMap<object, {
  pointers: Map<string, ProvenPair>;
  flights: Map<string, Promise<ProvenPair | null>>;
}>>();
const stateProofs = new WeakMap<PromotedProjection, { candidate: ProvenCandidate; attested: AttestedPromotion }>();
const stateAttestations = new WeakMap<object, Map<string, AttestedPromotion>>();

function isStateAuthorityScope(scope: string): boolean {
  return statePublicationScope(scope);
}

function stateRequest(store: CivicDataReadStore | undefined) {
  const request = currentReaderAuthorityEdge() ?? currentReaderSelection();
  if (!request) return null;
  let stores = stateRequests.get(request);
  if (!stores) { stores = new WeakMap(); stateRequests.set(request, stores); }
  const identity = store ?? DEFAULT_STORE;
  let reads = stores.get(identity);
  if (!reads) { reads = { pointers: new Map(), flights: new Map() }; stores.set(identity, reads); }
  return reads;
}

function inflightOf(store: CivicDataReadStore | undefined, scope: string): Map<string, Promise<ProvenPair | null>> {
  const request = isStateAuthorityScope(scope) ? stateRequest(store) : null;
  if (request) return request.flights;
  const identity = store ?? DEFAULT_STORE;
  let flights = inflight.get(identity);
  if (!flights) { flights = new Map(); inflight.set(identity, flights); }
  return flights;
}

function provenPointersOf(store: CivicDataReadStore | undefined, scope?: string): Map<string, ProvenPair> {
  if (scope && isStateAuthorityScope(scope)) return stateRequest(store)?.pointers ?? new Map();
  const identity = store ?? DEFAULT_STORE;
  let pointers = provenPointers.get(identity);
  if (!pointers) { pointers = new Map(); provenPointers.set(identity, pointers); }
  return pointers;
}

function rememberStateProof(
  projection: PromotedProjection,
  candidate: ProvenCandidate,
  store: CivicDataReadStore | undefined,
  payloadSha256: string,
  retainAttestation: boolean,
): ProvenPair {
  const { retrieval, temporal } = candidate.candidate;
  const metadata: ProvenCandidate = { candidate: {
    retrieval: { retrievedAt: retrieval.retrievedAt, ...(retrieval.sourceCheck ? { sourceCheck: retrieval.sourceCheck } : {}) },
    temporal: { version: temporal.version, sourceThrough: temporal.sourceThrough, staleAtRetrieval: temporal.staleAtRetrieval },
  } };
  const attested = attestationOf(projection.recordClass, projection.scope, projection, metadata, payloadSha256);
  if (attested) {
    stateProofs.set(projection, { candidate: metadata, attested });
    if (retainAttestation) {
      const identity = store ?? DEFAULT_STORE;
      let attestations = stateAttestations.get(identity);
      if (!attestations) { attestations = new Map(); stateAttestations.set(identity, attestations); }
      attestations.set(projection.key, attested);
    }
  }
  return { projection, candidate: metadata };
}

function withLatestConfirmation<T>(projection: PromotedProjection<T>, identity: PromotedPointerIdentity): PromotedProjection<T> {
  const { latestConfirmation: _proven, ...rest } = projection;
  return identity.latestConfirmation ? { ...rest, latestConfirmation: identity.latestConfirmation } : rest;
}

function samePointer(identity: PromotedPointerIdentity, projection: PromotedProjection): boolean {
  return identity.key === projection.key &&
    identity.sourceId === projection.sourceId &&
    identity.recordClass === projection.recordClass &&
    identity.scope === projection.scope &&
    identity.versionId === projection.versionId &&
    identity.lastKnownGoodVersionId === projection.lastKnownGoodVersionId &&
    Date.parse(identity.promotedAt) === Date.parse(projection.promotedAt);
}

function emptyMetadata(recordClass: RoutineRecordClass, scope: string): CivicDataReadMetadata {
  return {
    recordClass,
    scope,
    sourceId: null,
    version: null,
    versionId: null,
    lastKnownGoodVersionId: null,
    sourceThrough: null,
    retrievedAt: null,
    promotedAt: null,
    stale: "UNKNOWN",
    staleAt: null,
  };
}

function temporalState(input: {
  readonly now: string;
  readonly retrievedAt: string | null;
  readonly staleAtRetrieval?: boolean;
  readonly maxAgeMs?: number;
  readonly declared?: CivicDataStaleState;
}): { stale: CivicDataStaleState; staleAt: string | null } {
  if (input.declared) return { stale: input.declared, staleAt: null };
  if (input.staleAtRetrieval) return { stale: "STALE", staleAt: input.retrievedAt };
  if (input.maxAgeMs === undefined || input.retrievedAt === null) {
    return { stale: input.staleAtRetrieval === false ? "CURRENT" : "UNKNOWN", staleAt: null };
  }
  const retrieved = Date.parse(input.retrievedAt);
  const now = Date.parse(input.now);
  if (!Number.isFinite(retrieved) || !Number.isFinite(now)) return { stale: "UNKNOWN", staleAt: null };
  const staleAtMs = retrieved + input.maxAgeMs;
  return {
    stale: now > staleAtMs ? "STALE" : "CURRENT",
    staleAt: new Date(staleAtMs).toISOString(),
  };
}

export function civicDataReadNotInitialized(
  recordClass: RoutineRecordClass,
  scope: string,
  detail: string,
): CivicDataReadResult<never> {
  return {
    kind: "STORE_UNREACHABLE",
    value: null,
    metadata: emptyMetadata(recordClass, scope),
    code: "READ_NOT_INITIALIZED",
    detail,
  };
}

export function maySeedFixture(
  result: CivicDataReadResult<unknown>,
  env: CivicDataFixtureEnvironment = process.env,
): boolean {
  return mayUseTestFixture(env) && (result.kind === "NOT_RECORDED" || (
    result.kind === "STORE_UNREACHABLE" &&
    (result.code === "STORE_NOT_CONFIGURED" || result.code === "READ_NOT_INITIALIZED")
  ));
}

/** `NOT_RECORDED`: the store answered and no pointer exists. `STORE_UNREACHABLE`: that could not be established. */
export async function readPromotedCivicData<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<T>> {
  const now = options.now ?? new Date().toISOString();
  if (options.store?.readPromotedEntry) return readPromotedFromEdge<T>(recordClass, scope, await options.store.readPromotedEntry(recordClass, scope), now, options.maxAgeMs);
  if (options.edge !== undefined) return readPromotedFromEdge<T>(recordClass, scope, options.edge, now, options.maxAgeMs);
  const injected = options.store !== undefined;
  const canonical = !injected && !currentReaderAuthorityEdge() && !options.bypassCache && !isStateAuthorityScope(scope)
    ? readerCanonicalEntry(recordClass, scope) : undefined;
  if (canonical) {
    try { return readPromotedFromEdge<T>(recordClass, scope, await canonical, now, options.maxAgeMs); }
    catch (error) { return storeReadFailedResult<T>(recordClass, scope, null, error); }
  }
  if (!injected && isStateAuthorityScope(scope)) {
    const [{ readStateAuthorityProjection }, { stateFromRegistryRuntimeScope }, { STATE_BALLOT_FAMILIES, stateFromBallotScope }] = await Promise.all([
      import("./state-reader.ts"), import("./state-scopes.ts"), import("./state-scopes.ts"),
    ]);
    const registryState = recordClass === "REGISTRY_RUNTIME_BINDING" ? stateFromRegistryRuntimeScope(scope) : null;
    if (registryState) return (await readStateAuthorityProjection<T>("registry-runtime", registryState)).result;
    for (const family of STATE_BALLOT_FAMILIES) {
      const state = stateFromBallotScope(scope, family);
      const familyClass = { "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE", "candidate-corpus": "CANDIDATE_PUBLICATION", "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD" }[family];
      if (state && recordClass === familyClass) return (await readStateAuthorityProjection<T>(family === "candidate-corpus" ? "candidate-publications" : family, state)).result;
    }
    return storeReadFailedResult<T>(recordClass, scope, null, new Error(`STATE_READER_SCOPE_INVALID:${recordClass}:${scope}`));
  }

  if (!injected && (!options.bypassCache || currentReaderSelection() || currentReaderRoute() !== "unattributed" || currentReaderAuthorityEdge()?.edgeOnly)) {
    const edge = await ensurePromotedEdge(recordClass, scope);
    if (edge !== null) return readPromotedFromEdge<T>(recordClass, scope, edge.value, now, options.maxAgeMs);
    refuseDatabaseInEdgeOnlyContext(`${recordClass}:${scope}`);
    const selection = currentReaderSelection();
    if (selection && process.env.DATABASE_URL) {
      try {
        return readPromotedFromEdge<T>(recordClass, scope, await readReaderProjection(recordClass, scope, selection), now, options.maxAgeMs);
      } catch (error) {
        return storeReadFailedResult<T>(recordClass, scope, null, error);
      }
    }
  }
  if (!injected && !process.env.DATABASE_URL) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: emptyMetadata(recordClass, scope),
      code: "STORE_NOT_CONFIGURED",
      detail: `The routine civic-data store is not configured; ${recordClass}:${scope} was not read.`,
    };
  }

  const key = `${recordClass}:${scope}`;
  const held = !injected && !isStateAuthorityScope(scope) && !options.bypassCache ? cache.get(key) : undefined;
  if (held && held.expiresAt > Date.now()) {
    if (held.projection === null) {
      return {
        kind: "NOT_RECORDED",
        value: null,
        metadata: emptyMetadata(recordClass, scope),
        detail: `The routine civic-data store answered and holds no canonical pointer for ${key}.`,
      };
    }
    return promotedResult(held.projection as PromotedProjection<T>, held.candidate, now, options.maxAgeMs);
  }
  if (options.bypassCache) return loadPromotedCivicData<T>(recordClass, scope, options, now, key);

  const flights = inflightOf(options.store, scope);
  const pending = flights.get(key);
  if (pending !== undefined) {
    const proven = await pending;
    if (proven !== null) return promotedResult(proven.projection as PromotedProjection<T>, proven.candidate, now, options.maxAgeMs);
  }
  let settle: (proven: ProvenPair | null) => void = () => undefined;
  const flight = new Promise<ProvenPair | null>((resolve) => { settle = resolve; });
  flights.set(key, flight);
  try {
    const result = await loadPromotedCivicData<T>(recordClass, scope, options, now, key);
    const proof = result.kind === "PROMOTED" && isStateAuthorityScope(scope) ? stateProofs.get(result.projection) : null;
    settle(result.kind === "PROMOTED" ? proof ? { projection: result.projection, candidate: proof.candidate }
      : provenPointersOf(options.store, scope).get(key) ?? null : null);
    return result;
  } catch (error) {
    settle(null);
    throw error;
  } finally {
    if (flights.get(key) === flight) flights.delete(key);
  }
}

async function loadPromotedCivicData<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  options: PromotedCivicDataReadOptions,
  now: string,
  key: string,
): Promise<CivicDataReadResult<T>> {
  const injected = options.store !== undefined;
  const stateAuthority = isStateAuthorityScope(scope);
  const cacheable = !injected && !stateAuthority;
  let observedProjection: PromotedProjection<T> | null = null;
  try {
    const store = options.store ?? new (await import("./store.ts")).PostgresRoutineDataStore();
    const known = options.bypassCache ? undefined : provenPointersOf(options.store, scope).get(key);
    if (known !== undefined && typeof store.readPromotionIdentity === "function") {
      const identity = await store.readPromotionIdentity(recordClass, scope);
      if (identity !== null && samePointer(identity, known.projection)) {
        const projection = withLatestConfirmation(known.projection, identity);
        if (cacheable) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate: known.candidate });
        if (stateAuthority) {
          const proof = stateProofs.get(known.projection);
          if (proof) rememberStateProof(projection, known.candidate, options.store, proof.attested.payloadSha256, true);
        }
        return promotedResult(projection as PromotedProjection<T>, known.candidate, now, options.maxAgeMs);
      }
    }
    const projection = await store.readPromotion<T>(recordClass, scope);
    if (projection === null) {
      if (cacheable) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection: null });
      return {
        kind: "NOT_RECORDED",
        value: null,
        metadata: emptyMetadata(recordClass, scope),
        detail: `The routine civic-data store answered and holds no canonical pointer for ${key}.`,
      };
    }
    observedProjection = projection;
    // The supervisor already proved this exact version in this pass.
    if (!options.bypassCache && options.attested && attestationHolds(options.attested, recordClass, scope, projection)) {
      const candidate = attestedCandidate(options.attested, projection);
      if (cacheable) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate });
      if (stateAuthority) rememberStateProof(projection, candidate, options.store, options.attested.payloadSha256, true);
      return promotedResult(projection, candidate, now, options.maxAgeMs);
    }
    // Immutable non-state versions reuse their proof; verification reads always re-prove.
    if (!options.bypassCache && !stateAuthority) {
      const proven = provenByVersion.get(projection.versionId);
      if (proven) {
        if (cacheable) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate: proven.candidate });
        provenPointersOf(options.store, scope).set(key, { projection, candidate: proven.candidate });
        return promotedResult(projection, proven.candidate, now, options.maxAgeMs);
      }
    }
    if (stateAuthority) {
      if (!store.readPublishedCandidateMetadata) throw new Error("STATE_PUBLISHED_METADATA_READ_REQUIRED");
      const candidate = await store.readPublishedCandidateMetadata(projection.versionId);
      if (!candidate) return {
        kind: "STORE_UNREACHABLE", value: null, metadata: observedProjectionMetadata(recordClass, scope, projection),
        code: "PROMOTION_CANDIDATE_MISSING", detail: `Canonical pointer ${key} names ${projection.versionId}, but its candidate metadata is missing.`,
      };
      const issue = publishedStateProofIssue(recordClass, scope, projection, candidate);
      if (issue) return promotionProofInvalidResult(recordClass, scope, projection, issue);
      if (candidate.candidate.normalization.stateRecordHashes) rememberStatePublicationHashes(projection, candidate.candidate.normalization);
      const proven = rememberStateProof(projection, candidate, options.store, candidate.candidate.normalization.normalizedHash!, !options.bypassCache);
      if (!options.bypassCache) provenPointersOf(options.store, scope).set(key, proven);
      return promotedResult(projection, proven.candidate, now, options.maxAgeMs);
    }
    const candidate = await readProofCandidate(store, projection.versionId);
    const predecessorVersionId = trustedLkgPredecessorVersionId(candidate);
    const predecessor = predecessorVersionId !== null
      ? await store.readCandidate(predecessorVersionId)
      : null;
    const result = resultFromPromotionProof(
      recordClass,
      scope,
      projection,
      candidate,
      predecessor,
      now,
      options.maxAgeMs,
    );
    if (result.kind === "PROMOTED" && candidate !== null) {
      if (cacheable) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate });
      if (!options.bypassCache) {
        provenByVersion.set(projection.versionId, { projection, candidate });
        provenPointersOf(options.store, scope).set(key, { projection, candidate });
      }
    }
    return result;
  } catch (error) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: observedProjection === null ? emptyMetadata(recordClass, scope) : {
        ...emptyMetadata(recordClass, scope),
        sourceId: observedProjection.sourceId,
        versionId: observedProjection.versionId,
        lastKnownGoodVersionId: observedProjection.lastKnownGoodVersionId,
        promotedAt: observedProjection.promotedAt,
      },
      code: "STORE_READ_FAILED",
      detail: `Reading canonical pointer ${key} failed (${error instanceof Error ? error.name : "unknown error"}). We could not ask the store.`,
    };
  }
}

export async function readPromotedCivicDataBatch<T>(
  recordClass: RoutineRecordClass,
  scopes: readonly string[],
  options: PromotedCivicDataReadOptions = {},
): Promise<readonly CivicDataReadResult<T>[]> {
  if (options.edge !== undefined) throw new Error("A batch civic-data read takes no reader edge entry.");
  if (scopes.length === 0) return [];
  if (scopes.some(isStateAuthorityScope)) {
    return Promise.all(scopes.map(scope => readPromotedCivicData<T>(recordClass, scope, options)));
  }
  const injected = options.store !== undefined;
  if (!injected) {
    if (currentReaderSelection()) return Promise.all(scopes.map(scope => readPromotedCivicData<T>(recordClass, scope, options)));
    const edgeScopes = new Set((await Promise.all(scopes.map(async scope => await ensurePromotedEdge(recordClass, scope) ? [scope] : []))).flat());
    if (edgeScopes.size > 0) {
      const remaining = scopes.filter((scope) => !edgeScopes.has(scope));
      const fromStore = await readPromotedCivicDataBatch<T>(recordClass, remaining, options);
      const byScope = new Map(remaining.map((scope, index) => [scope, fromStore[index]!]));
      return Promise.all(scopes.map((scope) => edgeScopes.has(scope)
        ? readPromotedCivicData<T>(recordClass, scope, options)
        : byScope.get(scope)!));
    }
    for (const scope of scopes) refuseDatabaseInEdgeOnlyContext(`${recordClass}:${scope}`);
  }
  if (!injected && !process.env.DATABASE_URL) {
    return scopes.map((scope) => ({
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: emptyMetadata(recordClass, scope),
      code: "STORE_NOT_CONFIGURED",
      detail: `The routine civic-data store is not configured; ${recordClass}:${scope} was not read.`,
    }));
  }

  const store = options.store ?? new (await import("./store.ts")).PostgresRoutineDataStore();
  if (!hasBatchReadDoor(store)) {
    return Promise.all(scopes.map((scope) => readPromotedCivicData<T>(recordClass, scope, options)));
  }

  const now = options.now ?? new Date().toISOString();
  const uniqueScopes = [...new Set(scopes)];
  const results = new Map<string, CivicDataReadResult<T>>();
  let misses: string[] = [];
  for (const scope of uniqueScopes) {
    const key = projectionKey(recordClass, scope);
    const held = !injected && !options.bypassCache ? cache.get(key) : undefined;
    if (!held || held.expiresAt <= Date.now()) {
      misses.push(scope);
      continue;
    }
    results.set(scope, held.projection === null
      ? notRecordedResult(recordClass, scope)
      : promotedResult(held.projection as PromotedProjection<T>, held.candidate, now, options.maxAgeMs));
  }

  const pointers = options.bypassCache ? null : provenPointersOf(options.store);
  const known = pointers === null ? [] : misses.filter((scope) => pointers.has(projectionKey(recordClass, scope)));
  if (pointers !== null && known.length > 0 && typeof store.readPromotionIdentities === "function") {
    let identities: readonly PromotedPointerIdentity[] | null = null;
    try {
      identities = await store.readPromotionIdentities(recordClass, known);
    } catch {
      identities = null;
    }
    if (identities !== null) {
      const identitiesByScope = new Map<string, PromotedPointerIdentity[]>();
      for (const identity of identities) {
        identitiesByScope.set(identity.scope, [...(identitiesByScope.get(identity.scope) ?? []), identity]);
      }
      misses = misses.filter((scope) => {
        const key = projectionKey(recordClass, scope);
        const proven = pointers.get(key);
        const rows = identitiesByScope.get(scope) ?? [];
        if (proven === undefined || rows.length !== 1 || !samePointer(rows[0]!, proven.projection)) return true;
        const projection = withLatestConfirmation(proven.projection, rows[0]!);
        results.set(scope, promotedResult(projection as PromotedProjection<T>, proven.candidate, now, options.maxAgeMs));
        if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate: proven.candidate });
        return false;
      });
    }
  }

  if (misses.length > 0) {
    let projections: readonly PromotedProjection<T>[];
    try {
      projections = await store.readPromotions<T>(recordClass, misses);
    } catch (error) {
      for (const scope of misses) {
        results.set(scope, storeReadFailedResult(recordClass, scope, null, error));
      }
      return scopes.map((scope) => results.get(scope)!);
    }

    const expectedScopes = new Set(misses);
    if (projections.some((projection) => !expectedScopes.has(projection.scope))) {
      const error = new Error("BATCH_PROMOTION_QUERY_RETURNED_UNREQUESTED_POINTER");
      for (const scope of misses) results.set(scope, storeReadFailedResult(recordClass, scope, null, error));
      return scopes.map((scope) => results.get(scope)!);
    }

    const projectionsByScope = new Map<string, PromotedProjection<T>[]>();
    for (const projection of projections) {
      projectionsByScope.set(projection.scope, [...(projectionsByScope.get(projection.scope) ?? []), projection]);
    }
    const uniqueProjections = [...projectionsByScope.values()]
      .filter((rows) => rows.length === 1)
      .map((rows) => rows[0]!);
        // Only fetch candidates for versions not already proven in this instance; a moved pointer is a memo miss.
    const memoUsable = !options.bypassCache;
    const candidateIds = [...new Set(
      uniqueProjections
        .filter((projection) => !(memoUsable && provenByVersion.has(projection.versionId)))
        .map((projection) => projection.versionId),
    )];
    let candidates: readonly CandidateVersionReadback[] = [];
    if (candidateIds.length > 0) {
      try {
        candidates = typeof store.readCandidateProofs === "function"
          ? await store.readCandidateProofs(candidateIds)
          : await store.readCandidates(candidateIds);
      } catch (error) {
        for (const scope of misses) {
          const projection = projectionsByScope.get(scope)?.[0] ?? null;
          results.set(scope, projection === null
            ? notRecordedResult(recordClass, scope)
            : storeReadFailedResult(recordClass, scope, projection, error));
        }
        return scopes.map((scope) => results.get(scope)!);
      }
    }

    const expectedCandidateIds = new Set(candidateIds);
    if (candidates.some((candidate) => !expectedCandidateIds.has(candidate.candidateId))) {
      const error = new Error("BATCH_CANDIDATE_QUERY_RETURNED_UNREQUESTED_ROW");
      for (const scope of misses) {
        const projection = projectionsByScope.get(scope)?.[0] ?? null;
        results.set(scope, projection === null
          ? notRecordedResult(recordClass, scope)
          : storeReadFailedResult(recordClass, scope, projection, error));
      }
      return scopes.map((scope) => results.get(scope)!);
    }

    const candidatesById = new Map<string, CandidateVersionRecord[]>();
    for (const candidate of candidates) {
      candidatesById.set(candidate.candidateId, [...(candidatesById.get(candidate.candidateId) ?? []), candidate.record]);
    }
    const predecessorIds = [...new Set(candidates.flatMap(({ record }) => {
      const predecessorVersionId = trustedLkgPredecessorVersionId(record);
      return predecessorVersionId === null ? [] : [predecessorVersionId];
    }))];
    let predecessorRows: readonly CandidateVersionReadback[] = [];
    if (predecessorIds.length > 0) {
      try {
        predecessorRows = await store.readCandidates(predecessorIds);
      } catch (error) {
        for (const scope of misses) {
          const projection = projectionsByScope.get(scope)?.[0] ?? null;
          results.set(scope, projection === null
            ? notRecordedResult(recordClass, scope)
            : storeReadFailedResult(recordClass, scope, projection, error));
        }
        return scopes.map((scope) => results.get(scope)!);
      }
    }
    const expectedPredecessorIds = new Set(predecessorIds);
    if (predecessorRows.some(({ candidateId }) => !expectedPredecessorIds.has(candidateId))) {
      const error = new Error("BATCH_CANDIDATE_QUERY_RETURNED_UNREQUESTED_PREDECESSOR");
      for (const scope of misses) {
        const projection = projectionsByScope.get(scope)?.[0] ?? null;
        results.set(scope, projection === null
          ? notRecordedResult(recordClass, scope)
          : storeReadFailedResult(recordClass, scope, projection, error));
      }
      return scopes.map((scope) => results.get(scope)!);
    }
    const predecessorsById = new Map<string, CandidateVersionRecord[]>();
    for (const predecessor of predecessorRows) {
      predecessorsById.set(
        predecessor.candidateId,
        [...(predecessorsById.get(predecessor.candidateId) ?? []), predecessor.record],
      );
    }
    for (const scope of misses) {
      const key = projectionKey(recordClass, scope);
      const pointerRows = projectionsByScope.get(scope) ?? [];
      if (pointerRows.length === 0) {
        const result = notRecordedResult<T>(recordClass, scope);
        results.set(scope, result);
        if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection: null });
        continue;
      }
      const projection = pointerRows[0]!;
      if (pointerRows.length > 1) {
        results.set(scope, promotionProofInvalidResult(
          recordClass,
          scope,
          projection,
          "the batch read returned more than one canonical pointer for the requested scope",
        ));
        continue;
      }
            // Already proven: no candidate was fetched for it, so `candidatesById` will not hold it.
      const proven = memoUsable ? provenByVersion.get(projection.versionId) : undefined;
      if (proven) {
        results.set(scope, promotedResult(projection, proven.candidate, now, options.maxAgeMs));
        if (!injected) {
          cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate: proven.candidate });
        }
        provenPointersOf(options.store).set(key, { projection, candidate: proven.candidate });
        continue;
      }
      const candidateRows = candidatesById.get(projection.versionId) ?? [];
      if (candidateRows.length > 1) {
        results.set(scope, promotionProofInvalidResult(
          recordClass,
          scope,
          projection,
          "the batch read returned more than one candidate row for the current version",
        ));
        continue;
      }
      const candidate = candidateRows[0] ?? null;
      const requiredPredecessorVersionId = trustedLkgPredecessorVersionId(candidate);
      const requiredPredecessorRows = requiredPredecessorVersionId !== null
        ? predecessorsById.get(requiredPredecessorVersionId) ?? []
        : [];
      if (
        requiredPredecessorVersionId !== null &&
        requiredPredecessorRows.length > 1
      ) {
        results.set(scope, promotionProofInvalidResult(
          recordClass,
          scope,
          projection,
          "the batch read returned more than one immutable predecessor row for the current trusted transfer",
        ));
        continue;
      }
      const predecessor = requiredPredecessorRows[0] ?? null;
      let result: CivicDataReadResult<T>;
      try {
        result = resultFromPromotionProof(
          recordClass,
          scope,
          projection,
          candidate,
          predecessor,
          now,
          options.maxAgeMs,
        );
      } catch (error) {
        result = promotionProofInvalidResult(
          recordClass,
          scope,
          projection,
          `proof evaluation failed (${error instanceof Error ? error.name : "unknown error"})`,
        );
      }
      results.set(scope, result);
      if (result.kind === "PROMOTED" && candidate !== null) {
        if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate });
        if (!options.bypassCache) {
          provenByVersion.set(projection.versionId, { projection, candidate });
          provenPointersOf(options.store).set(key, { projection, candidate });
        }
      }
    }
  }
  return scopes.map((scope) => results.get(scope)!);
}

export interface ProvenCivicDataHistory<T> {
  /** Older, individually proven versions, newest first. Never includes current. */
  readonly versions: readonly Extract<CivicDataReadResult<T>, { readonly kind: "PROMOTED" }>[];
  /** True only when the durable pointer-move chain reaches bootstrap/no-version. */
  readonly complete: boolean;
  readonly nextVersionId: string | null;
  readonly issue: string | null;
}

export interface ProvenCivicDataHistoryOptions {
  readonly store?: Pick<RoutineDataStore, "readCandidate" | "events"> &
    Partial<Pick<RoutineDataStore, "readCandidateProof" | "readCandidateProofs" | "pointerMoveEvents">>;
  readonly cursor?: string | null;
  /** Payloads per page, not a cap on the historical chain. */
  readonly pageSize?: number;
  readonly now?: string;
  readonly bypassCache?: boolean;
}

const HISTORY_TTL_MS = 60_000;
const historicalPages = new Map<string, { readonly expiresAt: number; readonly value: ProvenCivicDataHistory<unknown> }>();
const historicalFlights = new Map<string, Promise<ProvenCivicDataHistory<unknown>>>();

export async function readPromotedCivicDataPredecessors<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  current: Extract<CivicDataReadResult<T>, { readonly kind: "PROMOTED" }>,
  options: ProvenCivicDataHistoryOptions = {},
): Promise<ProvenCivicDataHistory<T>> {
  const pageSize = Math.min(16, Math.max(1, Math.floor(options.pageSize ?? 4)));
  const currentId = current.projection.versionId;
  const key = projectionKey(recordClass, scope);
  if (current.projection.key !== key || current.projection.recordClass !== recordClass || current.projection.scope !== scope) {
    return { versions: [], complete: false, nextVersionId: null, issue: "Current promoted pointer does not match the requested history scope." };
  }
  const cursor = options.cursor ?? null;
  if (cursor !== null && (!cursor || cursor.length > 256 || /\s/.test(cursor))) {
    return { versions: [], complete: false, nextVersionId: null, issue: "Historical continuation is malformed." };
  }
  const cacheKey = `${key}|${currentId}|${cursor ?? ""}|${pageSize}`;
  if (!options.store && !options.bypassCache) {
    const cached = historicalPages.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value as ProvenCivicDataHistory<T>;
    const pending = historicalFlights.get(cacheKey);
    if (pending) return pending as Promise<ProvenCivicDataHistory<T>>;
  }
  const work = (async (): Promise<ProvenCivicDataHistory<T>> => {
    const store = options.store ?? new (await import("./store.ts")).PostgresRoutineDataStore();
    const { readPointerMoveEvents } = await import("./store.ts");
    const versions: Extract<CivicDataReadResult<T>, { readonly kind: "PROMOTED" }>[] = [];
    const fail = (issue: string): ProvenCivicDataHistory<T> => ({ versions, complete: false, nextVersionId: null, issue });
    const seen = new Set<string>();
    const link = async (id: string): Promise<{ readonly previous: string | null; readonly at: string } | null> => {
      const events = await readPointerMoveEvents(store, id);
      const prefix = `Atomic pointer ${key} moved from `;
      const suffix = ` to ${id}.`;
      const matched = events.filter((event) => event.state === "PROMOTED" &&
        event.detail.startsWith(prefix) && event.detail.endsWith(suffix));
      if (matched.length !== 1) return null;
      const previous = matched[0]!.detail.slice(prefix.length, -suffix.length);
      if (!previous || /\s/.test(previous)) return null;
      return { previous: previous === "bootstrap/no-version" ? null : previous, at: matched[0]!.at };
    };
    let id = currentId;
    let next: string | null = null;
    const moves = new Map<string, { readonly previous: string | null; readonly at: string }>();
    const pageIds: string[] = [];
    try {
      // Rewalk the exact anchored links on a continuation. No caller-supplied
      // version can jump into an unrelated candidate's history.
      for (;;) {
        if (seen.has(id)) return fail("Historical pointer-move chain contains a cycle.");
        seen.add(id);
        const move = await link(id);
        if (!move) return fail(`Historical pointer-move proof is missing or ambiguous at ${id}.`);
        moves.set(id, move);
        next = move.previous;
        if (cursor === null || next === cursor) break;
        if (next === null) return fail("Historical continuation is not in the current pointer's chain.");
        id = next;
      }
      if (next === null) return { versions, complete: true, nextVersionId: null, issue: null };
      id = next;
      while (pageIds.length < pageSize) {
        if (seen.has(id)) return fail("Historical pointer-move chain contains a cycle.");
        seen.add(id);
        const move = await link(id);
        if (!move) return fail(`Historical pointer-move proof is missing or ambiguous at ${id}.`);
        moves.set(id, move);
        pageIds.push(id);
        if (move.previous === null) { next = null; break; }
        next = move.previous;
        id = next;
      }
      const candidateRows = typeof store.readCandidateProofs === "function"
        ? await store.readCandidateProofs(pageIds)
        : await Promise.all(pageIds.map(async (candidateId) => ({ candidateId,
          record: await readProofCandidate(store, candidateId) })));
      const candidates = new Map(candidateRows.filter((row): row is CandidateVersionReadback => row.record !== null)
        .map((row) => [row.candidateId, row.record] as const));
      for (const candidateId of pageIds) {
        const candidate = candidates.get(candidateId);
        if (!candidate) return fail(`Historical candidate ${candidateId} is missing.`);
        if (candidate.candidate.sourceId !== current.projection.sourceId) {
          return fail(`Historical candidate ${candidateId} changed the source authority.`);
        }
        const predecessorId = trustedLkgPredecessorVersionId(candidate);
        const predecessor = predecessorId === null ? null : candidates.get(predecessorId) ?? await store.readCandidate(predecessorId);
        const projection: PromotedProjection<T> = {
          key, sourceId: candidate.candidate.sourceId, recordClass, scope,
          versionId: candidateId, lastKnownGoodVersionId: candidateId,
          promotedAt: moves.get(candidateId)!.at,
          payload: candidate.candidate.readModel as T,
          receipt: candidate.receipt as ValidationReceipt,
        };
        const proven = resultFromPromotionProof(recordClass, scope, projection, candidate, predecessor,
          options.now ?? new Date().toISOString(), undefined);
        if (proven.kind !== "PROMOTED") return fail(`Historical candidate ${candidateId} failed promotion proof.`);
        versions.push(proven);
      }
      return { versions, complete: next === null, nextVersionId: next, issue: null };
    } catch (error) {
      return fail(`Historical store read failed (${error instanceof Error ? error.name : "unknown error"}).`);
    }
  })();
  if (options.store || options.bypassCache) return work;
  historicalFlights.set(cacheKey, work as Promise<ProvenCivicDataHistory<unknown>>);
  try {
    const result = await work;
    if (result.issue === null) historicalPages.set(cacheKey,
      { expiresAt: Date.now() + HISTORY_TTL_MS, value: result as ProvenCivicDataHistory<unknown> });
    return result;
  } finally {
    historicalFlights.delete(cacheKey);
  }
}

function observedProjectionMetadata<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection<T>,
): CivicDataReadMetadata {
  return {
    ...emptyMetadata(recordClass, scope),
    sourceId: projection.sourceId,
    versionId: projection.versionId,
    lastKnownGoodVersionId: projection.lastKnownGoodVersionId,
    promotedAt: projection.promotedAt,
  };
}

function notRecordedResult<T>(recordClass: RoutineRecordClass, scope: string): CivicDataReadResult<T> {
  return {
    kind: "NOT_RECORDED",
    value: null,
    metadata: emptyMetadata(recordClass, scope),
    detail: `The routine civic-data store answered and holds no canonical pointer for ${projectionKey(recordClass, scope)}.`,
  };
}

function storeReadFailedResult<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection<T> | null,
  error: unknown,
): CivicDataReadResult<T> {
  return {
    kind: "STORE_UNREACHABLE",
    value: null,
    metadata: projection === null
      ? emptyMetadata(recordClass, scope)
      : observedProjectionMetadata(recordClass, scope, projection),
    code: "STORE_READ_FAILED",
    detail: `Reading canonical pointer ${projectionKey(recordClass, scope)} failed (${error instanceof Error ? error.name : "unknown error"}). We could not ask the store.`,
  };
}

function promotionProofInvalidResult<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection<T>,
  issue: string,
): CivicDataReadResult<T> {
  return {
    kind: "STORE_UNREACHABLE",
    value: null,
    metadata: observedProjectionMetadata(recordClass, scope, projection),
    code: "PROMOTION_PROOF_INVALID",
    detail: `Canonical pointer ${projectionKey(recordClass, scope)} failed its promotion proof: ${issue}`,
  };
}

function resultFromPromotionProof<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection<T>,
  candidate: CandidateVersionRecord | null,
  predecessor: CandidateVersionRecord | null,
  now: string,
  maxAgeMs: number | undefined,
): CivicDataReadResult<T> {
  const key = projectionKey(recordClass, scope);
  if (candidate === null) {
    return {
      kind: "STORE_UNREACHABLE",
      value: null,
      metadata: observedProjectionMetadata(recordClass, scope, projection),
      code: "PROMOTION_CANDIDATE_MISSING",
      detail: `Canonical pointer ${key} names ${projection.versionId}, but its candidate/version row is missing.`,
    };
  }
  const proofIssue = promotionProofIssue(recordClass, scope, projection, candidate, predecessor);
  return proofIssue === null
    ? promotedResult(projection, candidate, now, maxAgeMs)
    : promotionProofInvalidResult(recordClass, scope, projection, proofIssue);
}

function publishedStateProofIssue(
  recordClass: RoutineRecordClass, scope: string, projection: PromotedProjection, row: PublishedCandidateMetadata,
): string | null {
  const candidate = row.candidate;
  if (projection.key !== projectionKey(recordClass, scope) || projection.recordClass !== recordClass || projection.scope !== scope)
    return "the pointer does not match its requested class and scope";
  if (!candidate || candidate.id !== projection.versionId || candidate.sourceId !== projection.sourceId ||
      candidate.recordClass !== recordClass || candidate.scope !== scope) return "the published candidate identity differs from the pointer";
  if (projection.lastKnownGoodVersionId !== projection.versionId || row.promotedVersion !== projection.versionId ||
      row.lastKnownGoodVersion !== projection.versionId) return "the current and last-known-good version identities diverge";
  if (row.state !== "PROMOTED" || row.acquisitionSucceeded !== true || candidate.retrieval?.succeeded !== true ||
      candidate.normalization?.succeeded !== true) return "the candidate metadata does not describe a successful publication";
  const receipt = parseValidationReceipt(projection.receipt), candidateReceipt = parseValidationReceipt(row.receipt);
  if (!receipt || !candidateReceipt || receipt.decision !== "GOOD" || candidateReceipt.decision !== "GOOD" ||
      receipt.candidateId !== candidate.id || receipt.sourceId !== candidate.sourceId || receipt.recordClass !== recordClass || receipt.scope !== scope ||
      receipt !== candidateReceipt && canonicalCivicDataHash(receipt) !== canonicalCivicDataHash(candidateReceipt)) return "the GOOD receipts do not identify the published candidate";
  const times = [candidate.retrieval.retrievedAt, receipt.validatedAt, projection.promotedAt].map(Date.parse);
  if (!times.every(Number.isFinite) || times[0] > times[1] || times[1] > times[2]) return "retrieval, validation, and promotion times are invalid or out of order";
  if (!candidate.temporal || typeof candidate.temporal.version !== "string" || typeof candidate.temporal.sourceThrough !== "string")
    return "the published candidate lacks temporal metadata";
  const hash = candidate.normalization.normalizedHash;
  if (typeof hash !== "string" || !SHA256.test(hash)) return "the published candidate lacks its validated payload hash";
  try {
    const owned = immutableStateValue(projection.payload);
    if (owned !== projection.payload || immutableStateHash(owned) !== hash) return "the state payload does not match its validated published hash";
  }
  catch { return "the state payload cannot be hashed"; }
  return null;
}

export function promotionProofIssue<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection<T>,
  row: CandidateVersionRecord,
  predecessor: CandidateVersionRecord | null = null,
): string | null {
  const candidate = row.candidate;
  const projectionReceipt = parseValidationReceipt(projection.receipt);
  const candidateReceipt = parseValidationReceipt(row.receipt);
  if (projection.key !== projectionKey(recordClass, scope)) return "the pointer key does not match its requested class and scope";
  if (projection.recordClass !== recordClass || projection.scope !== scope) return "the pointer body does not match its requested class and scope";
  if (!candidate || candidate.id !== projection.versionId) return "the candidate identity does not match the current version pointer";
  if (candidate.sourceId !== projection.sourceId || candidate.recordClass !== recordClass || candidate.scope !== scope) return "the candidate source, class, or scope does not match the pointer";
  if (projection.lastKnownGoodVersionId !== projection.versionId) return "the current pointer and last-known-good pointer diverge";
  if (row.state !== "PROMOTED" || row.acquisitionSucceeded !== true) return "the pointed candidate is not a successfully acquired PROMOTED row";
  if (row.promotedVersion !== projection.versionId || row.lastKnownGoodVersion !== projection.lastKnownGoodVersionId) return "the candidate's durable promotion fields do not match the pointer";
  const scoped = statePublicationScope(scope);
  const indexedPrior = scoped ? statePublicationPriorOf(candidate) : undefined;
  const sharedRollPrior = federalRollPublicationPriorProof(candidate, projection);
  const readModelHash = sharedRollPrior?.readModelHash ?? indexedPrior?.payloadHash ?? (scoped ? durableStateHash(candidate.readModel) : durableProjectionHash(candidate.readModel));
  if (
    readModelHash === null ||
    !candidate.normalization?.normalizedHash ||
    !SHA256.test(candidate.normalization.normalizedHash) ||
    candidate.normalization.normalizedHash !== readModelHash
  ) return "the candidate Reader projection does not match its durable normalized hash";
  const normalizedPayloadHash = sharedRollPrior?.normalizedPayloadHash ?? (indexedPrior ? candidate.normalization.normalizedPayloadHash : candidate.normalizedPayload === candidate.readModel ? readModelHash :
    scoped ? durableStateHash(candidate.normalizedPayload) : durableProjectionHash(candidate.normalizedPayload));
  if (
    normalizedPayloadHash === null ||
    !candidate.normalization.normalizedPayloadHash ||
    !SHA256.test(candidate.normalization.normalizedPayloadHash) ||
    candidate.normalization.normalizedPayloadHash !== normalizedPayloadHash
  ) return "the candidate normalized evidence does not match its durable payload hash";
  if (!projectionReceipt || !candidateReceipt) return "the pointer or candidate receipt is malformed";
  if (projectionReceipt.decision !== "GOOD" || candidateReceipt.decision !== "GOOD") return "the pointer is not backed by a GOOD receipt";
  const sourceCheck = candidateReceipt.checks.find((check) => check.check === "SOURCE_AUTHENTICITY");
  if (indexedPrior || sharedRollPrior) {
    if ((indexedPrior ?? sharedRollPrior)!.versionId !== candidate.id) return "the consumed prior index names a different immutable version";
  } else if (candidate.bootstrapImport) {
    const importIssue = trustedLkgImportEvidenceIssue(candidate, predecessor);
    if (importIssue !== null) return `the trusted-LKG import evidence is invalid: ${importIssue}`;
    const expectedSourceCode = candidate.bootstrapImport.kind === "TRUSTED_LKG_REATTESTATION"
      ? "TRUSTED_LKG_REATTESTATION_PROVENANCE_VALID"
      : "TRUSTED_LKG_IMPORT_PROVENANCE_VALID";
    if (sourceCheck?.code !== expectedSourceCode) {
      return "the trusted-LKG candidate receipt does not disclose its non-source-authenticated provenance";
    }
  } else if (
    sourceCheck?.code === "TRUSTED_LKG_IMPORT_PROVENANCE_VALID" ||
    sourceCheck?.code === "TRUSTED_LKG_REATTESTATION_PROVENANCE_VALID"
  ) {
    return "the receipt claims a trusted-LKG import but the candidate has no import evidence";
  }
  if (
    projectionReceipt.candidateId !== candidate.id ||
    projectionReceipt.sourceId !== candidate.sourceId ||
    projectionReceipt.recordClass !== recordClass ||
    projectionReceipt.scope !== scope
  ) return "the GOOD receipt does not identify the pointed candidate";
  if (canonicalCivicDataJson(projectionReceipt) !== canonicalCivicDataJson(candidateReceipt)) return "the candidate and pointer receipts differ";
  if (!indexedPrior && (scoped ? projection.payload !== candidate.readModel && durableStateHash(projection.payload) !== readModelHash :
    canonicalCivicDataJson(projection.payload) !== canonicalCivicDataJson(candidate.readModel))) return "the pointer payload differs from the validated candidate read model";
  const retrievedAt = Date.parse(candidate.retrieval?.retrievedAt ?? "");
  const validatedAt = Date.parse(projectionReceipt.validatedAt);
  const promotedAt = Date.parse(projection.promotedAt);
  if (![retrievedAt, validatedAt, promotedAt].every(Number.isFinite)) return "retrieval, validation, or promotion time is invalid";
  if (retrievedAt > validatedAt || validatedAt > promotedAt) return "retrieval, validation, and promotion times are out of order";
  return null;
}

function promotedResult<T>(
  projection: PromotedProjection<T>,
  candidate: ProvenCandidate,
  now: string,
  maxAgeMs: number | undefined,
): CivicDataReadResult<T> {
  // A confirmation re-acquired and validated this exact version and found
  // nothing new, so the version is as fresh as that re-check.
  const pointedRetrievedAt = candidate.candidate.retrieval.retrievedAt;
  const confirmedRetrievedAt = projection.latestConfirmation?.versionId === projection.versionId
    ? projection.latestConfirmation.retrieval.retrievedAt
    : null;
  const retrievedAt = confirmedRetrievedAt !== null && Date.parse(confirmedRetrievedAt) > Date.parse(pointedRetrievedAt)
    ? confirmedRetrievedAt
    : pointedRetrievedAt;
  const sourceChecks = [
    candidate.candidate.retrieval.sourceCheck ? sourceCheckedAt(candidate.candidate.retrieval, projection.promotedAt) : undefined,
    projection.latestConfirmation?.retrieval.sourceCheck ? sourceCheckedAt(projection.latestConfirmation.retrieval, projection.latestConfirmation.observedAt) : undefined,
  ].filter((at): at is string => at !== undefined).sort((a, b) => Date.parse(a) - Date.parse(b));
  const checkedAt = sourceChecks.at(-1);
  const temporal = temporalState({
    now,
    retrievedAt: checkedAt ?? retrievedAt,
    staleAtRetrieval: candidate.candidate.temporal.staleAtRetrieval,
    maxAgeMs,
  });
  return {
    kind: "PROMOTED",
    value: projection.payload,
    projection,
    metadata: {
      recordClass: projection.recordClass,
      scope: projection.scope,
      sourceId: projection.sourceId,
      version: candidate.candidate.temporal.version,
      versionId: projection.versionId,
      lastKnownGoodVersionId: projection.lastKnownGoodVersionId,
      sourceThrough: candidate.candidate.temporal.sourceThrough,
      retrievedAt,
      ...(checkedAt ? { checkedAt } : {}),
      promotedAt: projection.promotedAt,
      ...temporal,
    },
  };
}

function bootstrapResult<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  bootstrap: CivicDataBootstrap<T>,
  now: string,
  maxAgeMs: number | undefined,
): CivicDataReadResult<T> {
  return {
    kind: "BOOTSTRAP",
    value: bootstrap.value,
    detail: bootstrap.detail,
    metadata: {
      recordClass,
      scope,
      sourceId: bootstrap.sourceId,
      version: bootstrap.version,
      versionId: bootstrap.versionId,
      lastKnownGoodVersionId: null,
      sourceThrough: bootstrap.sourceThrough,
      retrievedAt: bootstrap.retrievedAt,
      promotedAt: null,
      ...temporalState({
        now,
        retrievedAt: bootstrap.retrievedAt,
        staleAtRetrieval: bootstrap.staleAtRetrieval,
        maxAgeMs,
        declared: bootstrap.stale,
      }),
    },
  };
}

export async function readPromotedOrBootstrap<T>(
  options: PromotedOrBootstrapOptions<T>,
): Promise<CivicDataReadResult<T>> {
  const result = await readPromotedCivicData<T>(options.recordClass, options.scope, options);
  const now = options.now ?? new Date().toISOString();
  const fixtureBootstrapAllowed =
    options.allowUnconfiguredBootstrap === true && process.env.NODE_ENV !== "production";
  if (
    fixtureBootstrapAllowed &&
    (result.kind === "NOT_RECORDED" ||
      (result.kind === "STORE_UNREACHABLE" && result.code === "STORE_NOT_CONFIGURED"))
  ) {
    return bootstrapResult(options.recordClass, options.scope, options.bootstrap(), now, options.maxAgeMs);
  }
  return result;
}

export class CivicDataStoreUnavailableError extends Error {
  readonly result: Extract<CivicDataReadResult<unknown>, { kind: "STORE_UNREACHABLE" }>;

  constructor(result: Extract<CivicDataReadResult<unknown>, { kind: "STORE_UNREACHABLE" }>) {
    super(result.detail);
    this.name = "CivicDataStoreUnavailableError";
    this.result = result;
  }
}

export function promotedVersionOrThrow<T>(result: CivicDataReadResult<T>): string | null {
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

/** Lets go of one pointer's proof once a caller holds what it needs of it, so a long publication holds one candidate at a time. */
export function forgetPromotedProof(store: CivicDataReadStore | undefined, recordClass: RoutineRecordClass, scope: string, versionId: string): void {
  provenByVersion.delete(versionId);
  provenPointersOf(store, scope).delete(projectionKey(recordClass, scope));
}

export function clearPromotedReadModelCache(): void {
  cache.clear();
  provenByVersion.clear();
  provenPointers = new WeakMap();
  inflight = new WeakMap();
}

const readerProjectionReads = new WeakMap<ReaderSelection, Map<string, Promise<PromotedEdgeEntry>>>();

/** Keep a place's complete selected slice when later card reads add aliases to its selection. */
export function primeReaderProjection(recordClass: RoutineRecordClass, scope: string, keys: readonly string[]): Promise<PromotedEdgeEntry> {
  const selection = currentReaderSelection();
  if (!selection) throw new Error("READER_SELECTION_REQUIRED");
  let held = readerProjectionReads.get(selection);
  if (!held) { held = new Map(); readerProjectionReads.set(selection, held); }
  const pointer = `${recordClass}:${scope}`;
  const existing = held.get(pointer);
  if (existing) return existing;
  const read = loadReaderProjection(recordClass, scope, { ...selection, keys: new Set([...selection.keys, ...keys]) });
  held.set(pointer, read);
  void read.catch(() => undefined);
  return read;
}

async function readReaderProjection(recordClass: RoutineRecordClass, scope: string, selection: ReaderSelection): Promise<PromotedEdgeEntry> {
  let held = readerProjectionReads.get(selection);
  if (!held) { held = new Map(); readerProjectionReads.set(selection, held); }
  const pointer = `${recordClass}:${scope}`;
  const key = pointer + JSON.stringify([...selection.keys].sort());
  const prior = held.get(pointer) ?? held.get(key);
  if (prior) return prior;
  const read = loadReaderProjection(recordClass, scope, selection);
  held.set(key, read);
  try {
    const value = await read;
    if (value.kind === "NOT_RECORDED") held.set(pointer, read);
    return value;
  } catch (error) { held.delete(key); throw error; }
}

// On an edge miss, Postgres returns the requested records and small pointer metadata; candidate payloads stay there.
async function loadReaderProjection(recordClass: RoutineRecordClass, scope: string, selection: ReaderSelection): Promise<PromotedEdgeEntry> {
  const query = readerDatabaseQuery(1800);
  if (!query) throw new Error("READER_STORE_UNCONFIGURED");
  const window = selection.governmentWindow;
  const payload = window ? `reader_inventory_payload(p.payload,$4::int,$5::int)` : `reader_place_payload(p.payload,$3::text[],$4::jsonb)`;
  const [rows] = await query([{ text: `SELECT p.key, p.source_id, p.record_class, p.scope, p.current_version_id, p.last_known_good_version_id,
    p.promoted_at, (p.validation_receipt - 'excludedFacts') || jsonb_build_object('excludedFacts','[]'::jsonb) validation_receipt,
    ${payload} payload,
    c.retrieved_at, reader_payload_node(c.candidate)->'temporal' temporal FROM civic_data_promotions p
    JOIN civic_data_candidates c ON c.id=p.current_version_id
    WHERE p.record_class=$1 AND p.scope=$2 AND c.state='PROMOTED' AND $3::text[] IS NOT NULL`, params: [recordClass, scope, [...selection.keys], ...(window ?? [selection.point ? JSON.stringify(selection.point) : null])] }]);
  const row = rows[0];
  if (!row) return { kind: "NOT_RECORDED", recordClass, scope };
  const temporal = row.temporal as { staleAtRetrieval?: boolean; version?: string; sourceThrough?: string } | null;
  return { kind: "PROMOTED", projection: { key: row.key as string, sourceId: row.source_id as string, recordClass, scope,
    versionId: row.current_version_id as string, lastKnownGoodVersionId: row.last_known_good_version_id as string,
    promotedAt: new Date(row.promoted_at as string).toISOString(), payload: row.payload,
    receipt: row.validation_receipt as Extract<PromotedEdgeEntry, {kind:"PROMOTED"}>["projection"]["receipt"] },
    attested: { recordClass, scope, versionId: row.current_version_id as string, payloadSha256: promotedPayloadSha256(row.payload),
      retrievedAt: new Date(row.retrieved_at as string).toISOString(), staleAtRetrieval: temporal?.staleAtRetrieval === true,
      version: temporal?.version ?? null, sourceThrough: temporal?.sourceThrough ?? null } };
}

export async function readStateRegistryRuntimeProjection(state: string, options: PromotedCivicDataReadOptions = {}): Promise<CivicDataReadResult<RegistryRuntimeReadModel>> {
  return readPromotedCivicData<RegistryRuntimeReadModel>("REGISTRY_RUNTIME_BINDING", stateRegistryRuntimeScope(state), options);
}
