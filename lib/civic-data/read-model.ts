import { createHash } from "node:crypto";
import { currentPromotedEdge, refuseDatabaseInEdgeOnlyContext } from "../registry/runtime-edge.ts";

import type {
  CandidateVersionRecord,
  PromotedPointerIdentity,
  PromotedProjection,
  RoutineRecordClass,
  ValidationReceipt,
} from "./types.ts";
import { canonicalCivicDataJson } from "./changes.ts";
import { parseValidationReceipt } from "./receipt.ts";
import { promotedPayloadSha256, type AttestedPromotion } from "./attested-promotion.ts";
import {
  mayUseTestFixture,
  type CivicDataFixtureEnvironment,
} from "./fixture-policy.ts";
export { mayUseTestFixture } from "./fixture-policy.ts";
export type { CivicDataFixtureEnvironment } from "./fixture-policy.ts";
import { trustedLkgImportEvidenceIssue } from "./trusted-lkg-import.ts";
import {
  PostgresRoutineDataStore,
  projectionKey,
  readPointerMoveEvents,
  type CandidateVersionReadback,
  type RoutineDataStore,
} from "./store.ts";

const TTL_MS = 30_000;
const SHA256 = /^[a-f0-9]{64}$/;

function trustedLkgPredecessorVersionId(candidate: CandidateVersionRecord | null): string | null {
  const evidence = candidate?.candidate.bootstrapImport;
  if (evidence?.kind === "TRUSTED_LKG_REATTESTATION") return evidence.predecessorVersionId;
  return evidence?.kind === "TRUSTED_LKG_IMPORT"
    ? evidence.pimaOutcomeUnion?.predecessorVersionId ?? null
    : null;
}

/**
 * The pointed candidate as its proof reads it (`candidateProofView`); a store
 * without the narrowed door is read whole. A predecessor stays a whole read:
 * a re-attestation's evidence re-derives its civic records.
 */
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
> & Partial<Pick<RoutineDataStore, "readPromotions" | "readCandidates" | "readPromotionIdentity" | "readPromotionIdentities">>;

/**
 * Optional set-oriented read door used by projections that compose many
 * independent authorities. Narrow test/readback stores may keep implementing
 * only the two scalar methods above; the production store implements both
 * batch methods so one Reader request never fans out into one database round
 * trip per authority.
 */
export type CivicDataBatchReadStore = Pick<
  RoutineDataStore,
  "readPromotion" | "readCandidate" | "readPromotions" | "readCandidates"
> & Partial<Pick<RoutineDataStore, "readPromotionIdentities" | "readCandidateProof" | "readCandidateProofs">>;

export interface PromotedCivicDataReadOptions {
  /** Deterministic store injection for tests and bounded readbacks. */
  readonly store?: CivicDataReadStore;
  readonly now?: string;
  /** Age from the actual retrieval instant, not from process start. */
  readonly maxAgeMs?: number;
  readonly bypassCache?: boolean;
  /**
   * A version the standing supervisor proved in this pass (see
   * `AttestedPromotion`). Used only for its own class and scope, only when the
   * pointer still names it and its payload hashes to the proven payload, and
   * never by verification (`bypassCache`).
   */
  readonly attested?: AttestedPromotion;
  /**
   * The reader edge's copy of this pointer (`PromotedEdgeEntry`): the read is
   * answered from it and the store is not opened. Only a reader request that
   * entered the edge passes it (`readPromotedEdgeFirst`,
   * lib/registry/runtime-edge.ts); the runner and every verification path never do.
   */
  readonly edge?: PromotedEdgeEntry<unknown>;
}

/** Whether a freshly read pointer is exactly the attested, proven version. */
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

/** The proven candidate fields a promoted result reports, as the attestation carries them. */
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

/**
 * The attestation of the version this process proved for a scope through
 * `store`, for the supervisor to hand its children; null when nothing is proven.
 */
export function attestPromotedVersion(
  recordClass: RoutineRecordClass,
  scope: string,
  store: CivicDataReadStore,
): AttestedPromotion | null {
  const proven = provenPointersOf(store).get(projectionKey(recordClass, scope));
  if (!proven) return null;
  return attestationOf(recordClass, scope, proven.projection, proven.candidate);
}

function attestationOf(
  recordClass: RoutineRecordClass,
  scope: string,
  projection: PromotedProjection,
  candidate: CandidateVersionRecord,
): AttestedPromotion | null {
  const temporal = candidate.candidate.temporal;
  const retrievedAt = candidate.candidate.retrieval?.retrievedAt;
  if (typeof retrievedAt !== "string" || !temporal) return null;
  return {
    recordClass,
    scope,
    versionId: projection.versionId,
    payloadSha256: promotedPayloadSha256(projection.payload),
    retrievedAt,
    staleAtRetrieval: temporal.staleAtRetrieval === true,
    version: temporal.version ?? null,
    sourceThrough: temporal.sourceThrough ?? null,
  };
}

/**
 * **A PROVEN POINTER AS THE READER EDGE CARRIES IT.** (2026-09-25.)
 *
 * A cold /ballot and a cold Ask read their ballot, candidate, money and record
 * families from the database: a pointer read and a proof read each, the proof
 * alone up to 6.4 MB (Pima finance) on a cold instance. The standing runner
 * already reads and proves each of them; it now publishes the proven pair on
 * the reader edge, and a reader request answers the same typed read from it.
 *
 * What the edge carries is what the proof leaves behind, never less:
 *
 * - the pointer row itself (`PromotedProjection`: payload, the durable GOOD
 *   receipt, the promotion instant, the newest unchanged confirmation), and
 * - the attestation of the candidate the runner proved it against
 *   (`AttestedPromotion`, RULING 288's "attest, never re-run", the same
 *   record the supervisor hands its children): the payload's SHA-256 and the
 *   candidate's retrieval instant, version, source-through and staleness.
 *
 * From those two the read is rebuilt exactly as `promotedResult` builds it
 * from the database, so a reader sees the same kind (PROMOTED), the same
 * metadata and the same staleness, measured at its own request instant. A copy
 * that names another pointer, carries no GOOD receipt for its version, or whose
 * payload does not hash to the attested payload is refused as
 * PROMOTION_PROOF_INVALID, as the database path refuses a pointer whose proof
 * fails. An answered, absent pointer travels as NOT_RECORDED, so a family with
 * no pointer (the derived campaign sites today) costs no database read either.
 */
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

/**
 * The runner's side: the edge entry for a read this process just made. A
 * PROMOTED read yields its pointer and the attestation of the candidate its
 * proof cleared (null when this process holds no proof of that exact version);
 * an answered, absent pointer yields NOT_RECORDED; anything else yields null
 * and publishes nothing.
 */
export function promotedEdgeEntryOf<T>(
  result: CivicDataReadResult<T>,
  recordClass: RoutineRecordClass,
  scope: string,
  store?: CivicDataReadStore,
): PromotedEdgeEntry<T> | null {
  if (result.kind === "NOT_RECORDED") return { kind: "NOT_RECORDED", recordClass, scope };
  if (result.kind !== "PROMOTED") return null;
  const proven = provenPointersOf(store).get(projectionKey(recordClass, scope));
  if (!proven || proven.projection.versionId !== result.projection.versionId) return null;
  const attested = attestationOf(recordClass, scope, result.projection, proven.candidate);
  return attested === null ? null : { kind: "PROMOTED", projection: result.projection, attested };
}

/** Entries whose payload already hashed to its attestation in this process (each edge value is immutable). */
const verifiedEdgeEntries = new WeakSet<object>();

function promotedEdgeIssue(
  recordClass: RoutineRecordClass,
  scope: string,
  entry: Extract<PromotedEdgeEntry<unknown>, { kind: "PROMOTED" }>,
): string | null {
  const { projection, attested } = entry;
  if (projection.key !== projectionKey(recordClass, scope) || projection.recordClass !== recordClass || projection.scope !== scope) {
    return "the edge copy names another class or scope";
  }
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
  return null;
}

/** The reader's side: the typed read an edge entry stands for, measured at `now`. Never opens a store. */
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
  /**
   * Explicitly permits a bundled fixture outside production when the store is
   * either unconfigured or has answered that no canonical pointer exists.
   * Production never consults the fixture: an absent pointer is an authority
   * gap, not permission to reopen Git as mutable runtime truth.
   */
  readonly allowUnconfiguredBootstrap?: boolean;
}

interface CachedPromotion {
  readonly expiresAt: number;
  readonly projection: PromotedProjection;
  readonly candidate: CandidateVersionRecord;
}

const cache = new Map<string, CachedPromotion | { readonly expiresAt: number; readonly projection: null }>();

/**
 * **Proven versions, keyed by the IMMUTABLE versionId (RULING 288's "attest,
 * never re-run", made in-process).**
 *
 * A promoted version's candidate bytes and promotion payload never change once
 * written: the store admits `VALIDATED → PROMOTED` only, re-promoting a promoted
 * row is a no-op, and CHECK constraints tie the pointer payload and the durable
 * hashes to the versionId. So a versionId that `promotionProofIssue` has cleared
 * once is cleared for the life of this instance. This memo lets a pointer that
 * has NOT moved skip the second candidate fetch (the 1.77 MB envelope haul on a
 * dense meetings read) AND the proof's ~10 canonical passes + two sha256 — the
 * dominant cost of a cache-miss — and serve the already-proven candidate.
 *
 * It never weakens the proof and never serves stale data. A versionId is entered
 * ONLY after the full proof returned `null` (GOOD) for it; the pointer is ALWAYS
 * re-read, so a promotion that advanced the pointer is a memo MISS that fetches
 * and re-proves the new version; and a `bypassCache` caller (the verification
 * paths) skips the memo entirely and always re-proves. Cleared alongside `cache`.
 */
const provenByVersion = new Map<string, { projection: PromotedProjection; candidate: CandidateVersionRecord }>();

/**
 * **The pointer each store last proved, per scope: check the version before
 * fetching unchanged contents.**
 *
 * A promotion's payload is immutable per version. The database refuses to
 * rewrite a pointer in place (`civic_data_promotions_no_delete_or_rewrite`)
 * and requires its payload and receipt to equal that exact candidate's read
 * model and receipt (`civic_data_promotions_exact_candidate_proof`), and the
 * candidate itself is immutable evidence. So when a scope's cached result
 * expires, the Reader first asks which version the pointer names (identity
 * columns only); an unmoved pointer is served from the proof this process
 * already made, and only a moved pointer fetches and re-proves. Until
 * 2026-09-23 a warm process re-read every whole payload each time its 30 s
 * scope cache expired (registry 3.9 MB, NJ roll calls 8.8 MB, all 84 meeting
 * partitions 7.3 MB) to learn that nothing had changed.
 *
 * Keyed by the store it was proved against (the process's own production
 * store is `DEFAULT_STORE`), so no store is ever served another's proof.
 * `bypassCache` (every verification path) never consults it.
 */
const DEFAULT_STORE: object = {};

/**
 * **One read per cold scope, however many callers ask at once.** A page asks
 * for the same scope from several places in the same render (the ballot page's
 * division lookup, its preloads and its incumbency checks all want the
 * registry). On a cold process each one found the cache empty and downloaded
 * the whole scope itself: on an isolated copy of production (2026-09-23) one
 * fresh instance serving its first ballot page read the registry's promotion,
 * candidate and trusted-LKG predecessor (about 29 MB) two or three times over.
 * A caller that finds a read of its scope already in flight from the same store
 * now waits for it and is served the version that read proved; if that read
 * proved nothing, it reads for itself. `bypassCache` (every verification
 * path) never shares a read.
 */
type ProvenPair = { projection: PromotedProjection; candidate: CandidateVersionRecord };
let inflight = new WeakMap<object, Map<string, Promise<ProvenPair | null>>>();

function inflightOf(store: CivicDataReadStore | undefined): Map<string, Promise<ProvenPair | null>> {
  const scope = store ?? DEFAULT_STORE;
  let flights = inflight.get(scope);
  if (flights === undefined) {
    flights = new Map();
    inflight.set(scope, flights);
  }
  return flights;
}
let provenPointers = new WeakMap<object, Map<string, { projection: PromotedProjection; candidate: CandidateVersionRecord }>>();

function provenPointersOf(store: CivicDataReadStore | undefined): Map<string, { projection: PromotedProjection; candidate: CandidateVersionRecord }> {
  const scope = store ?? DEFAULT_STORE;
  let pointers = provenPointers.get(scope);
  if (pointers === undefined) {
    pointers = new Map();
    provenPointers.set(scope, pointers);
  }
  return pointers;
}

/** A proven projection with the newest confirmation a fresh identity read carried (or none). */
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

/**
 * Whether a synchronous reader may seed its bundled test fixture. Both the
 * environment and authority-state rules live here so one adapter cannot
 * quietly treat production or a real store failure as permission to reopen
 * tracked data.
 */
export function maySeedFixture(
  result: CivicDataReadResult<unknown>,
  env: CivicDataFixtureEnvironment = process.env,
): boolean {
  return mayUseTestFixture(env) && (result.kind === "NOT_RECORDED" || (
    result.kind === "STORE_UNREACHABLE" &&
    (result.code === "STORE_NOT_CONFIGURED" || result.code === "READ_NOT_INITIALIZED")
  ));
}

/**
 * Read the one canonical pointer without consulting a bundled file.
 *
 * `NOT_RECORDED` means the store answered and no pointer exists.
 * `STORE_UNREACHABLE` means we could not establish that fact. Callers may
 * bootstrap only from the former; a database error never becomes old data.
 */
export async function readPromotedCivicData<T>(
  recordClass: RoutineRecordClass,
  scope: string,
  options: PromotedCivicDataReadOptions = {},
): Promise<CivicDataReadResult<T>> {
  const now = options.now ?? new Date().toISOString();
  // The reader edge's copy answers without opening the store (and without any cache).
  if (options.edge !== undefined) return readPromotedFromEdge<T>(recordClass, scope, options.edge, now, options.maxAgeMs);
  const injected = options.store !== undefined;
  if (!injected && !options.bypassCache) {
    const edge = currentPromotedEdge(recordClass, scope);
    if (edge !== null) return readPromotedFromEdge<T>(recordClass, scope, edge.value, now, options.maxAgeMs);
    refuseDatabaseInEdgeOnlyContext(`${recordClass}:${scope}`);
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
  const held = !injected && !options.bypassCache ? cache.get(key) : undefined;
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

  const flights = inflightOf(options.store);
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
    // A PROMOTED load has just recorded the pair it proved for this store.
    settle(result.kind === "PROMOTED" ? provenPointersOf(options.store).get(key) ?? null : null);
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
  let observedProjection: PromotedProjection<T> | null = null;
  try {
    const store = options.store ?? new PostgresRoutineDataStore();
    // Version before contents: an unmoved pointer this store already proved is
    // served from that proof (see `provenPointers`); only a moved one is read.
    const known = options.bypassCache ? undefined : provenPointersOf(options.store).get(key);
    if (known !== undefined && typeof store.readPromotionIdentity === "function") {
      const identity = await store.readPromotionIdentity(recordClass, scope);
      if (identity !== null && samePointer(identity, known.projection)) {
        // The version is unchanged; its newest confirmation comes with the identity.
        const projection = withLatestConfirmation(known.projection, identity);
        if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate: known.candidate });
        return promotedResult(projection as PromotedProjection<T>, known.candidate, now, options.maxAgeMs);
      }
    }
    const projection = await store.readPromotion<T>(recordClass, scope);
    if (projection === null) {
      if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection: null });
      return {
        kind: "NOT_RECORDED",
        value: null,
        metadata: emptyMetadata(recordClass, scope),
        detail: `The routine civic-data store answered and holds no canonical pointer for ${key}.`,
      };
    }
    observedProjection = projection;
    // The supervisor proved this exact version in this pass: the pointer names
    // it and its payload hashes to the proven payload, so the candidate is not
    // read again. The attested record stays local to this read and its scope
    // cache; it never enters the proven-version memo.
    if (!options.bypassCache && options.attested && attestationHolds(options.attested, recordClass, scope, projection)) {
      const candidate = attestedCandidate(options.attested, projection);
      if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate });
      return promotedResult(projection, candidate, now, options.maxAgeMs);
    }
    // Attest, never re-run (RULING 288): if this exact version is already proven
    // GOOD in this instance, reuse its candidate — skip the second fetch and the
    // whole proof — and refresh the scope cache. The pointer was just read
    // fresh, so a promotion that advanced the pointer is a memo MISS below.
    // `bypassCache` (the verification paths) opts out and always re-proves.
    if (!options.bypassCache) {
      const proven = provenByVersion.get(projection.versionId);
      if (proven) {
        if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate: proven.candidate });
        provenPointersOf(options.store).set(key, { projection, candidate: proven.candidate });
        return promotedResult(projection, proven.candidate, now, options.maxAgeMs);
      }
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
      if (!injected) cache.set(key, { expiresAt: Date.now() + TTL_MS, projection, candidate });
      if (!options.bypassCache) {
        provenByVersion.set(projection.versionId, { projection, candidate });
        provenPointersOf(options.store).set(key, { projection, candidate });
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

/**
 * Read many scopes from one record class without weakening any per-pointer
 * proof. Production performs at most one pointer query and one candidate
 * query for every uncached scope. Stores exposing only the narrow scalar door
 * retain the original behavior, which keeps focused adapters and tests small.
 */
export async function readPromotedCivicDataBatch<T>(
  recordClass: RoutineRecordClass,
  scopes: readonly string[],
  options: PromotedCivicDataReadOptions = {},
): Promise<readonly CivicDataReadResult<T>[]> {
  // An edge entry answers one pointer; a batch never takes one.
  if (options.edge !== undefined) throw new Error("A batch civic-data read takes no reader edge entry.");
  if (scopes.length === 0) return [];
  const injected = options.store !== undefined;
  if (!injected && !options.bypassCache) {
    const edgeScopes = new Set(scopes.filter((scope) => currentPromotedEdge(recordClass, scope) !== null));
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

  const store = options.store ?? new PostgresRoutineDataStore();
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

  // Version before contents (see `provenPointers`): scopes whose pointer has
  // not moved since this store proved it are served from that proof, and only
  // the rest are read whole. A failed identity read decides nothing; those
  // scopes take the ordinary whole read below.
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
    // Attest, never re-run (RULING 288): only fetch candidate envelopes for
    // versions NOT already proven in this instance. On a steady meetings read
    // where no pointer has moved, this fetches ZERO candidates — the ~1.77 MB
    // envelope haul and every partition's proof are skipped, and the value is
    // served from the freshly-read pointer + the memoised candidate. A pointer
    // that has moved names a new versionId, which is a memo miss fetched and
    // re-proved here. `bypassCache` (verification) opts out of the memo entirely.
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
      // Proven-version reuse (RULING 288): the pointer was read fresh above; if
      // its version is already proven, serve the memoised candidate and skip the
      // per-partition proof. No candidate was fetched for it (filtered out of
      // `candidateIds`), so `candidatesById` will not hold it.
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

/** One scope's version as a proof run pinned it; null = the capture read no pointer. */
export interface PinnedCivicDataVersion {
  readonly scope: string;
  readonly versionId: string | null;
}

/** The pinned read also needs the append-only event log that dates a promotion. */
export type CivicDataPinnedReadStore = CivicDataReadStore & Pick<RoutineDataStore, "events">;

export interface ProvenCivicDataHistory<T> {
  /** Older, individually proven versions, newest first. Never includes current. */
  readonly versions: readonly Extract<CivicDataReadResult<T>, { readonly kind: "PROMOTED" }>[];
  /** True only when the durable pointer-move chain reaches bootstrap/no-version. */
  readonly complete: boolean;
  /** Exact next predecessor for a later page; null when the chain is complete or broken. */
  readonly nextVersionId: string | null;
  /** A failed read or proof is disclosed and never turned into an absence. */
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

/**
 * Normal Reader door for older versions of an already proven current pointer.
 * A pointer-move event names each predecessor; every predecessor is then
 * checked with the same GOOD receipt, hash, source and import proof used for
 * a current promotion. The proof-only pin admission above remains separate.
 */
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
    const store = options.store ?? new PostgresRoutineDataStore();
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

/**
 * **PROOF-ONLY exact-version read** (`lib/meetings/proof-pin.ts`, which admits
 * the pin only inside the Reader proof harness and never in a deployed build).
 * Nothing else calls this; an unpinned read never reaches it.
 *
 * It pins WHICH version a scope resolves to, never WHETHER that version is
 * proven. The live pointers are read and proven exactly as
 * `readPromotedCivicDataBatch` does. Where a pointer still names the pinned
 * version, that fully proven result is returned unchanged. Where it has moved
 * on, the pinned version is read by its immutable id and proven again:
 * candidate row, GOOD receipt, hashes, source authenticity and time order all
 * go through `promotionProofIssue`. The pointer that named it is rebuilt from
 * that same row, exactly as the atomic promotion door wrote it
 * (`store.ts#promote`). The durable event log must also show exactly one
 * "Atomic pointer <key> moved … to <version>." promotion, which dates it.
 * A store that could not be asked stays unanswered, and a version that fails
 * any proof stays PROMOTION_PROOF_INVALID. A pin never turns a failure into data.
 */
export async function readPinnedPromotedCivicDataBatch<T>(
  recordClass: RoutineRecordClass,
  pins: readonly PinnedCivicDataVersion[],
  options: Omit<PromotedCivicDataReadOptions, "store"> & { readonly store?: CivicDataPinnedReadStore } = {},
): Promise<readonly CivicDataReadResult<T>[]> {
  const now = options.now ?? new Date().toISOString();
  const live = await readPromotedCivicDataBatch<T>(recordClass, pins.map(({ scope }) => scope), options);
  let store: CivicDataPinnedReadStore | undefined = options.store;
  return Promise.all(pins.map(async (pin, index): Promise<CivicDataReadResult<T>> => {
    const current = live[index]!;
    if (
      current.kind === "STORE_UNREACHABLE" &&
      current.code !== "PROMOTION_PROOF_INVALID" &&
      current.code !== "PROMOTION_CANDIDATE_MISSING"
    ) return current;
    if (pin.versionId === null) {
      return {
        kind: "NOT_RECORDED",
        value: null,
        metadata: emptyMetadata(recordClass, pin.scope),
        detail: `The Reader proof pin recorded no canonical pointer for ${projectionKey(recordClass, pin.scope)} when it was captured; a pointer promoted since is outside this proof run.`,
      };
    }
    if (current.kind === "PROMOTED" && current.metadata.versionId === pin.versionId) return current;
    const key = projectionKey(recordClass, pin.scope);
    if (!options.bypassCache) {
      const proven = provenByVersion.get(pin.versionId);
      if (proven && proven.projection.key === key) {
        return promotedResult(proven.projection as PromotedProjection<T>, proven.candidate, now, options.maxAgeMs);
      }
    }
    let candidate: CandidateVersionRecord | null;
    let promotions: readonly { readonly at: string }[];
    let predecessor: CandidateVersionRecord | null = null;
    try {
      store ??= new PostgresRoutineDataStore();
      candidate = await readProofCandidate(store, pin.versionId);
      const moved = new RegExp(`^Atomic pointer ${escapeRegExp(key)} moved from \\S+ to ${escapeRegExp(pin.versionId)}\\.$`);
      promotions = candidate === null
        ? []
        : (await readPointerMoveEvents(store, pin.versionId)).filter((event) => moved.test(event.detail));
      const predecessorVersionId = trustedLkgPredecessorVersionId(candidate);
      if (predecessorVersionId !== null) predecessor = await store.readCandidate(predecessorVersionId);
    } catch (error) {
      return {
        kind: "STORE_UNREACHABLE",
        value: null,
        metadata: { ...emptyMetadata(recordClass, pin.scope), versionId: pin.versionId },
        code: "STORE_READ_FAILED",
        detail: `Reading pinned version ${pin.versionId} of ${key} failed (${error instanceof Error ? error.name : "unknown error"}). We could not ask the store.`,
      };
    }
    if (candidate === null) {
      return {
        kind: "STORE_UNREACHABLE",
        value: null,
        metadata: { ...emptyMetadata(recordClass, pin.scope), versionId: pin.versionId },
        code: "PROMOTION_CANDIDATE_MISSING",
        detail: `The Reader proof pin names ${pin.versionId} for ${key}, but its candidate/version row is missing.`,
      };
    }
    const projection: PromotedProjection<T> = {
      key,
      sourceId: candidate.candidate.sourceId,
      recordClass,
      scope: pin.scope,
      versionId: pin.versionId,
      lastKnownGoodVersionId: pin.versionId,
      promotedAt: promotions[0]?.at ?? "",
      payload: candidate.candidate.readModel as T,
      receipt: candidate.receipt as ValidationReceipt,
    };
    if (promotions.length !== 1) {
      return promotionProofInvalidResult(
        recordClass,
        pin.scope,
        projection,
        `the pinned version has ${promotions.length} durable atomic promotions of ${key}, not exactly one`,
      );
    }
    try {
      const result = resultFromPromotionProof(recordClass, pin.scope, projection, candidate, predecessor, now, options.maxAgeMs);
      // Attest, never re-run (RULING 288): a pinned version proven once is
      // proven for this process, so a proof run's later requests serve it from
      // the memo above instead of re-reading its candidate and event log. A
      // proof run once re-read every moved partition on every Ask request
      // (about 2,000 whole candidate reads in four minutes, 2026-09-24).
      // Only the proof harness admits a pin; bypassCache still re-proves.
      if (result.kind === "PROMOTED" && !options.bypassCache) provenByVersion.set(pin.versionId, { projection, candidate });
      return result;
    } catch (error) {
      return promotionProofInvalidResult(
        recordClass,
        pin.scope,
        projection,
        `proof evaluation failed (${error instanceof Error ? error.name : "unknown error"})`,
      );
    }
  }));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  const readModelHash = durableProjectionHash(candidate.readModel);
  if (
    readModelHash === null ||
    !candidate.normalization?.normalizedHash ||
    !SHA256.test(candidate.normalization.normalizedHash) ||
    candidate.normalization.normalizedHash !== readModelHash
  ) return "the candidate Reader projection does not match its durable normalized hash";
  const normalizedPayloadHash = durableProjectionHash(candidate.normalizedPayload);
  if (
    normalizedPayloadHash === null ||
    !candidate.normalization.normalizedPayloadHash ||
    !SHA256.test(candidate.normalization.normalizedPayloadHash) ||
    candidate.normalization.normalizedPayloadHash !== normalizedPayloadHash
  ) return "the candidate normalized evidence does not match its durable payload hash";
  if (!projectionReceipt || !candidateReceipt) return "the pointer or candidate receipt is malformed";
  if (projectionReceipt.decision !== "GOOD" || candidateReceipt.decision !== "GOOD") return "the pointer is not backed by a GOOD receipt";
  const sourceCheck = candidateReceipt.checks.find((check) => check.check === "SOURCE_AUTHENTICITY");
  if (candidate.bootstrapImport) {
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
  if (canonicalCivicDataJson(projection.payload) !== canonicalCivicDataJson(candidate.readModel)) return "the pointer payload differs from the validated candidate read model";
  const retrievedAt = Date.parse(candidate.retrieval?.retrievedAt ?? "");
  const validatedAt = Date.parse(projectionReceipt.validatedAt);
  const promotedAt = Date.parse(projection.promotedAt);
  if (![retrievedAt, validatedAt, promotedAt].every(Number.isFinite)) return "retrieval, validation, or promotion time is invalid";
  if (retrievedAt > validatedAt || validatedAt > promotedAt) return "retrieval, validation, and promotion times are out of order";
  return null;
}

function promotedResult<T>(
  projection: PromotedProjection<T>,
  candidate: CandidateVersionRecord,
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
  const temporal = temporalState({
    now,
    retrievedAt,
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

/**
 * Select bundled bootstrap only through the explicit non-production fixture
 * gate. An answered, absent production pointer stays NOT_RECORDED.
 */
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

/** Preserve the legacy preload return without duplicating fail-closed logic. */
export function promotedVersionOrThrow<T>(result: CivicDataReadResult<T>): string | null {
  if (result.kind === "STORE_UNREACHABLE") throw new CivicDataStoreUnavailableError(result);
  return result.kind === "PROMOTED" ? result.metadata.versionId : null;
}

export function clearPromotedReadModelCache(): void {
  cache.clear();
  provenByVersion.clear();
  provenPointers = new WeakMap();
  inflight = new WeakMap();
}
