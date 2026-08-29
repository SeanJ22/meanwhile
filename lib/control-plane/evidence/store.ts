/**
 * THE EVIDENCE PLANE, PART TWO — THE VAULT.
 *
 * ## Why an interface and not an implementation
 *
 * The durable store is object storage: S3, R2, B2, Netlify Blobs, anything with
 * `put`/`get`/`head`/`list` over an immutable key space. Which one is an
 * operational decision that will be made, remade and migrated. What must NOT
 * change with it is the key shape, the immutability rule and the access rule,
 * because those are what make an artifact citable and what keep a quarantined
 * body away from a parser.
 *
 * So the provider is an interface with exactly the four verbs every candidate
 * has, and everything the control plane relies on lives above it. A migration
 * then changes one class and no rule.
 *
 * ## THE KEY SHAPE IS PART OF THE DESIGN
 *
 *     project/<project>/source/<sourceId>/<yyyy>/<mm>/<dd>/<workItemId>/<contentHash>.<ext>
 *
 * Every segment earns its place, and the ORDER is the load-bearing part:
 *
 *   - `project` first, so one bucket can hold more than one project and a
 *     lifecycle rule or a deletion can be scoped to one without a scan.
 *   - `source` next, because a licence, a retention limit and a takedown all
 *     arrive per publisher. `list("project/x/source/legistar/")` is the answer
 *     to "what do we hold from this source", with no index to fall out of date.
 *   - the date, split into three segments, because storage lifecycle rules are
 *     prefix rules. `RESTRICTED_SHORT` expiry is a prefix policy or it is a
 *     cron job that eventually stops running.
 *   - `workItemId`, so the evidence for one obligation is contiguous and a
 *     replay reads one prefix.
 *   - `contentHash` as the OBJECT NAME, which makes the key space immutable by
 *     construction. The same bytes always land on the same key, so a re-run
 *     overwrites nothing and duplicates nothing, and a key can never be quietly
 *     reused for different content. **A key that could hold two different bodies
 *     over its life is a citation that stops being true without saying so.**
 *
 * The `.<ext>` suffix is a courtesy to humans and to content sniffing; the hash
 * is the identity.
 *
 * A `manifest.json` sits beside the bodies at the work-item prefix. It is the
 * per-obligation index — which artifacts, which tiers, which derivations — so
 * that a replay does not have to reconstruct relationships by listing and
 * guessing.
 *
 * ## `MemoryEvidenceStore` IS A TEST DOUBLE AND SAYS SO
 *
 * It is deterministic, ordered, and holds everything in a `Map`. **It provides
 * no durability of any kind.** It is here so the rules above can be tested
 * without a network, a bucket or a credential — never as a fallback a production
 * path can silently land on. `assertDurable` exists to make that unmissable.
 */

import {
  RestrictedArtifactRefused,
  parserMayRead,
  type Artifact,
  type ArtifactDerivation,
} from "./artifact.ts";
import { issueParserInput, type ParserInput } from "./parser-boundary.ts";

/** ------------------------------------------------------ the provider */

export interface ObjectMeta {
  readonly contentType: string;
  readonly contentHash: string;
  readonly byteLength: number;
  /** Small, flat, non-sensitive. **Never a credential value, ever.** */
  readonly custom?: Readonly<Record<string, string>>;
}

export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly meta: ObjectMeta;
}

/**
 * S3-compatible semantics, four verbs, no more.
 *
 * `head` returns metadata without transferring bytes — the verb an integrity
 * check and a retention sweep use, and the reason neither has to download a
 * megabyte of HTML to answer a question about it.
 */
export interface EvidenceStore {
  put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectMeta | null>;
  /** Keys under a prefix, in lexicographic order. */
  list(prefix: string): Promise<string[]>;
}

/** ------------------------------------------------------------ keys */

const EXTENSIONS: Readonly<Record<string, string>> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/json": "json",
  "text/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/rss+xml": "xml",
  "text/calendar": "ics",
};

/** The filename suffix for a content type. Unknown types get `bin`, never a guess. */
export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

/** `yyyy/mm/dd` from an ISO instant, in UTC. Local time would shard by traveller. */
export function datePath(isoInstant: string): string {
  const t = Date.parse(isoInstant);
  if (Number.isNaN(t)) throw new EvidenceStoreRefusal(`retrievedAt is not an instant: ${isoInstant}`);
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}/${mm}/${dd}`;
}

/** The prefix that holds every artifact for one obligation on one day. */
export function workItemPrefix(project: string, artifact: Artifact): string {
  return (
    `project/${project}/source/${artifact.sourceId}/` +
    `${datePath(artifact.retrievedAt)}/${artifact.workItemId}/`
  );
}

/** The immutable, content-addressed key for one artifact's bytes. */
export function objectKey(project: string, artifact: Artifact): string {
  if (!artifact.contentHash || !/^sha256-[0-9a-f]{64}$/.test(artifact.contentHash)) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id || "<no id>"} has no usable contentHash ` +
        `(${JSON.stringify(artifact.contentHash ?? null)}). The key IS the hash, so an ` +
        "artifact without one cannot be stored, cited, deduplicated or replayed.",
    );
  }
  return (
    workItemPrefix(project, artifact) +
    `${artifact.contentHash}.${extensionFor(artifact.contentType)}`
  );
}

/** The per-obligation index that sits beside the bodies. */
export function manifestKey(project: string, artifact: Artifact): string {
  return `${workItemPrefix(project, artifact)}manifest.json`;
}

export class EvidenceStoreRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceStoreRefusal";
  }
}

/** ------------------------------------------------------- the manifest */

export interface EvidenceManifest {
  readonly project: string;
  readonly workItemId: string;
  readonly artifacts: readonly Artifact[];
  readonly derivations: readonly ArtifactDerivation[];
  readonly updatedAt: string;
}

/**
 * Rebuild the manifest for one work item.
 *
 * Deterministic ordering by artifact id, so two runs over the same evidence
 * produce byte-identical manifests and a diff means something changed rather
 * than that a Map iterated differently.
 */
export function buildManifest(
  project: string,
  workItemId: string,
  artifacts: readonly Artifact[],
  now: string,
): EvidenceManifest {
  const mine = artifacts.filter((a) => a.workItemId === workItemId);
  const sorted = [...mine].sort((a, b) => a.id.localeCompare(b.id));
  return {
    project,
    workItemId,
    artifacts: sorted,
    derivations: sorted.flatMap((a) => (a.derivation ? [a.derivation] : [])),
    updatedAt: now,
  };
}

/** ------------------------------------------------------------ roles */

/**
 * WHO IS ASKING. Access is decided by role and tier, never by caller identity.
 *
 * `ACQUIRER` writes the bytes and is the only role that ever holds a network
 * capability. `AUDITOR` may read a quarantined body because answering "did we
 * really redact that" is exactly what an audit is for. `PARSER` may not, and
 * `PUBLISHER` — anything that puts text in front of a reader — may not either.
 */
export const EVIDENCE_ROLES = ["ACQUIRER", "PARSER", "AUDITOR", "PUBLISHER"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/** The roles cleared to read `RESTRICTED_RAW` bytes. Deliberately two. */
export const RESTRICTED_READERS: readonly EvidenceRole[] = ["ACQUIRER", "AUDITOR"];

export function mayReadTier(role: EvidenceRole, artifact: Artifact): boolean {
  // `parserMayRead` states the tier half of the rule once, in `artifact.ts`, so
  // the two modules cannot come to disagree about what a parser is entitled to.
  if (parserMayRead(artifact)) return true;
  return RESTRICTED_READERS.includes(role);
}

/** ------------------------------------------------------------ writes */

/**
 * Store one artifact's bytes at its content-addressed key.
 *
 * The put is a no-op when the object is already present with the same hash. That
 * is not an optimisation: re-storing under a content address must be idempotent
 * or two workers racing the same retrieval produce two writes of the same bytes
 * and one of them is arbitrarily "the" write.
 */
export async function putArtifact(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  bytes: Uint8Array,
): Promise<{ key: string; written: boolean }> {
  const key = objectKey(project, artifact);

  if (bytes.byteLength !== artifact.byteLength) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id} records ${artifact.byteLength} bytes and ${bytes.byteLength} ` +
        "were offered. The recorded length is part of the evidence.",
    );
  }

  const existing = await store.head(key);
  if (existing) return { key, written: false };

  await store.put(key, bytes, {
    contentType: artifact.contentType,
    contentHash: artifact.contentHash,
    byteLength: artifact.byteLength,
    custom: {
      tier: artifact.tier,
      sourceId: artifact.sourceId,
      methodRouteId: artifact.methodRouteId,
      workItemId: artifact.workItemId,
      attemptId: artifact.attemptId,
      retentionPolicy: artifact.retentionPolicy,
      permission: artifact.permission,
      transport: artifact.transport,
      canonicalUrl: artifact.canonicalUrl,
      retrievedAt: artifact.retrievedAt,
      httpStatus: String(artifact.httpStatus),
    },
  });
  return { key, written: true };
}

/** Write the per-obligation index. Pretty-printed so a diff is readable. */
export async function putManifest(
  store: EvidenceStore,
  project: string,
  representative: Artifact,
  manifest: EvidenceManifest,
): Promise<string> {
  const key = manifestKey(project, representative);
  const bytes = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);
  await store.put(key, bytes, {
    contentType: "application/json",
    contentHash: `manifest:${manifest.workItemId}`,
    byteLength: bytes.byteLength,
  });
  return key;
}

/** ------------------------------------------------------------- reads */

export interface ArtifactRead {
  /** The artifact whose bytes are returned — NOT necessarily the one asked for. */
  readonly artifact: Artifact;
  readonly bytes: Uint8Array;
  readonly text: string;
  /**
   * Set when a `RESTRICTED_RAW` request was answered with its derivative. The
   * substitution is REPORTED rather than performed silently: a parser output
   * attributed to the raw when it was produced from the sanitized body is an
   * attribution that cannot be replayed.
   */
  readonly substitutedForArtifactId?: string;
  /** The refusal, in words, when a substitution happened. Names no credential. */
  readonly refusal?: string;
}

export interface ReadOptions {
  /** rawArtifactId -> the sanitized derivative made from it. */
  readonly derivatives?: ReadonlyMap<string, Artifact>;
}

/**
 * READ AN ARTIFACT AS A ROLE.
 *
 * The one rule that matters: **a `PARSER` handed a `RESTRICTED_RAW` artifact is
 * refused by name.** If a sanitized derivative is known it is read instead and
 * the substitution is reported; if none exists the read throws
 * `RestrictedArtifactRefused`, which is a claim about the reader and never about
 * the record. A parser that received the quarantined body would put a live
 * third-party credential into extracted fields, log lines and summaries — the
 * PR #217 class, one layer downstream of where it was caught.
 */
export async function readArtifact(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  asRole: EvidenceRole,
  options: ReadOptions = {},
): Promise<ArtifactRead> {
  let target = artifact;
  let substitutedFor: string | undefined;
  let refusal: string | undefined;

  if (!mayReadTier(asRole, artifact)) {
    const derivative = options.derivatives?.get(artifact.id) ?? null;
    if (!derivative) throw new RestrictedArtifactRefused(artifact.id, asRole, null);
    refusal = new RestrictedArtifactRefused(artifact.id, asRole, derivative.id).message;
    substitutedFor = artifact.id;
    target = derivative;
  }

  const key = objectKey(project, target);
  const object = await store.get(key);
  if (!object) {
    throw new EvidenceStoreRefusal(
      `Artifact ${target.id} is recorded at ${key} and the store does not hold it. ` +
        "A missing body is a failed read, never an empty document.",
    );
  }

  return {
    artifact: target,
    bytes: object.bytes,
    text: new TextDecoder().decode(object.bytes),
    ...(substitutedFor ? { substitutedForArtifactId: substitutedFor } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/**
 * Read as a parser and get a branded `ParserInput` back.
 *
 * This is the only path from the vault into a parser. It composes the tier rule
 * with the brand from `parser-boundary.ts`, so the substitution and the
 * construction happen in one place and a caller cannot do the first without the
 * second.
 */
export async function readForParser(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  options: ReadOptions = {},
): Promise<{ input: ParserInput; read: ArtifactRead }> {
  const read = await readArtifact(store, project, artifact, "PARSER", options);
  // `read.artifact` is already the derivative where a substitution happened, so
  // this call cannot refuse — and it is still made, because the brand is what
  // the parser signature requires and the hash check is what the brand certifies.
  const input = issueParserInput(read.artifact, read.text);
  return { input, read };
}

/** ------------------------------------------------- the test double */

/**
 * **A TEST DOUBLE. NOT PRODUCTION DURABILITY. NOT ANY DURABILITY.**
 *
 * Everything lives in one `Map` in one process and is gone when it exits. It
 * exists so the key shape, the idempotent put and the access rules can be
 * exercised without a bucket or a credential, and it is deterministic — `list`
 * sorts — so a test asserting key order asserts the design and not V8's
 * insertion order.
 *
 * `durable` is `false` and `assertDurable` reads it. A production path that
 * reaches this class fails loudly rather than appearing to store evidence.
 */
export class MemoryEvidenceStore implements EvidenceStore {
  /** Read by `assertDurable`. Always false here, and that is the point. */
  readonly durable: boolean;

  private readonly objects: Map<string, StoredObject>;

  constructor() {
    this.durable = false;
    this.objects = new Map();
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    // A copy, so a caller mutating its buffer afterwards cannot rewrite stored
    // evidence — the one way an in-memory double diverges dangerously from a
    // real object store, where the bytes have already left the process.
    this.objects.set(key, { key, bytes: Uint8Array.from(bytes), meta });
  }

  async get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return found ? { key, bytes: Uint8Array.from(found.bytes), meta: found.meta } : null;
  }

  async head(key: string): Promise<ObjectMeta | null> {
    return this.objects.get(key)?.meta ?? null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  /** Test affordance only. Never a production read path. */
  get size(): number {
    return this.objects.size;
  }
}

/** Refuse a non-durable store where evidence is actually meant to persist. */
export function assertDurable(store: EvidenceStore, context: string): void {
  if ((store as { durable?: boolean }).durable === false) {
    throw new EvidenceStoreRefusal(
      `${context} requires a durable evidence store and was handed an in-memory ` +
        "test double. Bytes written here are lost when the process exits, and " +
        "evidence that does not survive the process is not evidence.",
    );
  }
}
