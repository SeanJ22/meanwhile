/**
 * The evidence vault: an `EvidenceStore` interface with the four object-storage
 * verbs, and the key shape, immutability rule and access rule above it.
 *
 *     project/<project>/source/<sourceId>/<yyyy>/<mm>/<dd>/<workItemId>/<contentHash>.<ext>
 *
 * The segment order makes per-project, per-source, per-day (retention) and
 * per-obligation (replay) operations prefix rules. The hash is the identity;
 * the extension is a courtesy.
 *
 * Guarantee: immutability and content identity within the scoped namespace.
 * One key holds one body for its whole life. Identical bytes under different
 * work-item, source or date prefixes are stored separately, on purpose.
 * `putArtifact` re-hashes the offered bytes and refuses a key holding an
 * incompatible object.
 *
 * A `manifest.json` per work item is the one rebuilt object, declared via
 * `ObjectMeta.objectClass = "MUTABLE_INDEX"`; undeclared means `IMMUTABLE_BODY`.
 *
 * `MemoryEvidenceStore` is a non-durable test double that refuses at least as
 * much as production does; `assertDurable` keeps it off production paths.
 */

import {
  RestrictedArtifactRefused,
  parserMayRead,
  type Artifact,
  type ArtifactDerivation,
} from "./artifact.ts";
import { contentHash } from "../ids.ts";
import { issueParserInput, type ParserInput } from "./parser-boundary.ts";

/** ------------------------------------------------------ the provider */

/** Whether this object may ever be rewritten, declared rather than guessed. */
export const OBJECT_CLASSES = [
  /** Evidence. Written once, never rewritten. The default when nothing is said. */
  "IMMUTABLE_BODY",
  /** A rebuilt index (`manifest.json`). Nothing cites it as evidence. */
  "MUTABLE_INDEX",
] as const;
export type ObjectClass = (typeof OBJECT_CLASSES)[number];

export interface ObjectMeta {
  readonly contentType: string;
  readonly contentHash: string;
  readonly byteLength: number;
  /** Absent means `IMMUTABLE_BODY`. Silence fails closed, never open. */
  readonly objectClass?: ObjectClass;
  /** Small, flat, non-sensitive. **Never a credential value, ever.** */
  readonly custom?: Readonly<Record<string, string>>;
}

/** The declared class, with the fail-closed default applied in one place. */
export function objectClassOf(meta: ObjectMeta): ObjectClass {
  return meta.objectClass ?? "IMMUTABLE_BODY";
}

export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly meta: ObjectMeta;
}

/** S3-compatible semantics, four verbs. `head` returns metadata without transferring bytes. */
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

/** ------------------------------------------- immutability, enforced */

/**
 * Which `custom` fields are immutable identity:
 *
 *   - `tier`: decides who may read the bytes; relabelling a `RESTRICTED_RAW`
 *     key would hand parsers the quarantined body.
 *   - `sourceId`, `workItemId`: key segments; metadata must agree with the key.
 *   - `retentionPolicy`: decides when the bytes are destroyed.
 *
 * Not compared (facts about one execution, first writer wins): `attemptId`,
 * `methodRouteId`, `retrievedAt`, `httpStatus`, `permission`, `transport`,
 * `canonicalUrl`, `retrievalUrl`. Unrecognised `custom` keys are neither
 * compared nor printed.
 */
export const IMMUTABLE_IDENTITY_FIELDS: readonly string[] = [
  "tier",
  "sourceId",
  "workItemId",
  "retentionPolicy",
  "extraction",
];

export interface MetaConflict {
  /** The field that disagreed. Always one of the named sets above. */
  readonly field: string;
  readonly stored: string;
  readonly offered: string;
}

/** The content type without parameters: `text/html` and `text/html; charset=utf-8` are the same bytes. */
function contentTypeEssence(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

/**
 * Is the offered object the same object already at this key? Returns the first
 * disagreement in a fixed order, or `null`. The class check comes first: a
 * write that reclassifies a body as a mutable index is refused outright.
 */
export function objectIncompatibility(
  stored: ObjectMeta,
  offered: ObjectMeta,
): MetaConflict | null {
  const storedClass = objectClassOf(stored);
  const offeredClass = objectClassOf(offered);
  if (storedClass !== offeredClass) {
    return { field: "objectClass", stored: storedClass, offered: offeredClass };
  }

  const storedType = contentTypeEssence(stored.contentType);
  const offeredType = contentTypeEssence(offered.contentType);
  if (storedType !== offeredType) {
    return { field: "contentType", stored: storedType, offered: offeredType };
  }

  // The content hash binds for both classes; a manifest's (`manifest:<workItemId>`)
  // keeps one obligation's index off another's.
  if (stored.contentHash !== offered.contentHash) {
    return { field: "contentHash", stored: stored.contentHash, offered: offered.contentHash };
  }

  if (storedClass === "MUTABLE_INDEX") return null;

  if (stored.byteLength !== offered.byteLength) {
    return {
      field: "byteLength",
      stored: String(stored.byteLength),
      offered: String(offered.byteLength),
    };
  }

  for (const field of IMMUTABLE_IDENTITY_FIELDS) {
    const a = stored.custom?.[field];
    const b = offered.custom?.[field];
    if (a !== b) {
      return { field: `custom.${field}`, stored: a ?? "<absent>", offered: b ?? "<absent>" };
    }
  }

  return null;
}

/** The refusal, in words, naming the field and both values. */
export function immutabilityRefusal(key: string, conflict: MetaConflict): EvidenceStoreRefusal {
  const extra =
    conflict.field === "custom.tier"
      ? " Two tiers cannot share one key: the tier decides who may read the bytes, and " +
        "the second write would change the readership of a body already cited under the first."
      : "";
  return new EvidenceStoreRefusal(
    `Key ${key} already holds an object and the offered one is not the same object: ` +
      `${conflict.field} is ${JSON.stringify(conflict.stored)} in the stored object and ` +
      `${JSON.stringify(conflict.offered)} in the offered one. An evidence key holds one ` +
      `body for the whole of its life — a key that could hold two different bodies is a ` +
      `citation that stops being true without saying so.${extra}`,
  );
}

/** Byte-for-byte, without allocating a copy or leaking timing on evidence bytes. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The provider-level immutability rule, shared by every `EvidenceStore`.
 * Returns `true` for a no-op (identical object present), `false` to proceed,
 * and throws when the key holds something else.
 */
export function reconcileExistingObject(
  key: string,
  offeredBytes: Uint8Array,
  offeredMeta: ObjectMeta,
  stored: { readonly meta: ObjectMeta; readonly bytes?: Uint8Array } | null,
): boolean {
  if (!stored) return false;

  const conflict = objectIncompatibility(stored.meta, offeredMeta);
  if (conflict) throw immutabilityRefusal(key, conflict);

  if (objectClassOf(offeredMeta) === "MUTABLE_INDEX") return false;

  if (stored.bytes && !sameBytes(stored.bytes, offeredBytes)) {
    /* Matching metadata over different bytes: the stored body wins and the write is refused. */
    throw new EvidenceStoreRefusal(
      `Key ${key} already holds ${stored.meta.byteLength} byte(s) recorded as ` +
        `${stored.meta.contentHash}, and the offered bytes carry identical metadata while ` +
        "differing byte-for-byte. The metadata is not the evidence; the bytes are.",
    );
  }

  return true;
}

/** ------------------------------------------------------- the manifest */

export interface EvidenceManifest {
  readonly project: string;
  readonly workItemId: string;
  readonly artifacts: readonly Artifact[];
  readonly derivations: readonly ArtifactDerivation[];
  readonly updatedAt: string;
}

/** Rebuild the manifest for one work item, ordered by artifact id so output is byte-stable. */
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
 * Who is asking; access is by role and tier. `AUDITOR` may read a quarantined
 * body; `PARSER` and `PUBLISHER` may not.
 */
export const EVIDENCE_ROLES = ["ACQUIRER", "PARSER", "AUDITOR", "PUBLISHER"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

/** The roles cleared to read `RESTRICTED_RAW` bytes. Deliberately two. */
export const RESTRICTED_READERS: readonly EvidenceRole[] = ["ACQUIRER", "AUDITOR"];

export function mayReadTier(role: EvidenceRole, artifact: Artifact): boolean {
  // `parserMayRead` in `artifact.ts` states the tier half of the rule.
  if (parserMayRead(artifact)) return true;
  return RESTRICTED_READERS.includes(role);
}

/** ------------------------------------------------------------ writes */

/** The object metadata for one artifact. One place, so a re-put compares like with like. */
export function artifactMeta(artifact: Artifact): ObjectMeta {
  return {
    contentType: artifact.contentType,
    contentHash: artifact.contentHash,
    byteLength: artifact.byteLength,
    objectClass: "IMMUTABLE_BODY",
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
      retrievalUrl: artifact.retrievalUrl,
      retrievedAt: artifact.retrievedAt,
      httpStatus: String(artifact.httpStatus),
      ...(artifact.extraction ? { extraction: JSON.stringify(artifact.extraction) } : {}),
    },
  };
}

/**
 * Store one artifact's bytes at its content-addressed key. Checks, in order:
 * the offered length is the recorded length; the bytes re-hash to
 * `artifact.contentHash`; an occupied key holds the same object
 * (`objectIncompatibility`). An identical re-put is a no-op, so concurrent
 * writers of one retrieval converge on one object.
 */
async function requireDocumentOriginal(store: EvidenceStore, project: string, artifact: Artifact): Promise<void> {
  if (artifact.tier !== "EXTRACTED_DERIVED") return;
  const extraction = artifact.extraction;
  if (!extraction || extraction.parent.tier !== "RAW" || extraction.parent.canonicalUrl !== artifact.canonicalUrl ||
    extraction.parent.workItemId !== artifact.workItemId || !Number.isSafeInteger(extraction.pages) || extraction.pages < 1 ||
    extraction.version !== "pdf-transcription/1" || !["PDF_TEXT", "PDF_TABLES"].includes(extraction.kind)) {
    throw new EvidenceStoreRefusal("DOCUMENT_EXTRACTION_PROVENANCE_INVALID");
  }
  const parent = await store.get(objectKey(project, extraction.parent));
  if (!parent || contentHash(parent.bytes) !== extraction.parent.contentHash || parent.meta.custom?.tier !== "RAW" ||
    parent.meta.custom?.canonicalUrl !== artifact.canonicalUrl || parent.meta.custom?.sourceId !== artifact.sourceId ||
    parent.meta.custom?.workItemId !== artifact.workItemId) throw new EvidenceStoreRefusal("DOCUMENT_EXTRACTION_ORIGINAL_MISSING");
}

export async function putArtifact(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  bytes: Uint8Array,
): Promise<{ key: string; written: boolean }> {
  const key = objectKey(project, artifact);

  await requireDocumentOriginal(store, project, artifact);

  if (bytes.byteLength !== artifact.byteLength) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id} records ${artifact.byteLength} bytes and ${bytes.byteLength} ` +
        "were offered. The recorded length is part of the evidence.",
    );
  }

  const offeredHash = contentHash(bytes);
  if (offeredHash !== artifact.contentHash) {
    throw new EvidenceStoreRefusal(
      `Artifact ${artifact.id} records ${artifact.contentHash} and the offered bytes hash ` +
        `to ${offeredHash}. The key IS the hash, so storing these bytes would put them at ` +
        `the address of a body they are not, and every citation of ${key} would repeat a ` +
        "false claim this store created.",
    );
  }

  const meta = artifactMeta(artifact);
  const existing = await store.get(key);
  if (existing) {
    const conflict = objectIncompatibility(existing.meta, meta);
    if (conflict) throw immutabilityRefusal(key, conflict);
    if (existing.bytes.byteLength !== artifact.byteLength || contentHash(existing.bytes) !== offeredHash) {
      throw new EvidenceStoreRefusal(`Key ${key} has metadata for artifact ${artifact.id}, but its stored bytes do not match. A failed body is never reused.`);
    }
    return { key, written: false };
  }

  await store.put(key, bytes, meta);
  return { key, written: true };
}

/**
 * Write the per-obligation index, pretty-printed. The one write allowed to
 * replace what is there, declared as `MUTABLE_INDEX`. Its `contentHash`
 * (`manifest:<workItemId>`) is still compared.
 */
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
    objectClass: "MUTABLE_INDEX",
  });
  return key;
}

/** ------------------------------------------------------------- reads */

export interface ArtifactRead {
  /** The artifact whose bytes are returned — NOT necessarily the one asked for. */
  readonly artifact: Artifact;
  readonly bytes: Uint8Array;
  readonly text: string;
  /** Set when a `RESTRICTED_RAW` request was answered with its derivative; the substitution is reported. */
  readonly substitutedForArtifactId?: string;
  /** The refusal, in words, when a substitution happened. Names no credential. */
  readonly refusal?: string;
}

export interface ReadOptions {
  /** rawArtifactId -> the sanitized derivative made from it. */
  readonly derivatives?: ReadonlyMap<string, Artifact>;
}

/**
 * Read an artifact as a role. A `PARSER` handed a `RESTRICTED_RAW` artifact
 * reads its known sanitized derivative (reported), or gets
 * `RestrictedArtifactRefused`.
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

  if (target.tier === "EXTRACTED_DERIVED") {
    if (object.meta.custom?.extraction !== JSON.stringify(target.extraction)) throw new EvidenceStoreRefusal("DOCUMENT_EXTRACTION_METADATA_MISMATCH");
    await requireDocumentOriginal(store, project, target);
  }

  return {
    artifact: target,
    bytes: object.bytes,
    text: new TextDecoder().decode(object.bytes),
    ...(substitutedFor ? { substitutedForArtifactId: substitutedFor } : {}),
    ...(refusal ? { refusal } : {}),
  };
}

/** Read as a parser and get a branded `ParserInput` back: the only path from the vault into a parser. */
export async function readForParser(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  options: ReadOptions = {},
): Promise<{ input: ParserInput; read: ArtifactRead }> {
  const read = await readArtifact(store, project, artifact, "PARSER", options);
  // `read.artifact` is already the derivative where substituted, so this cannot refuse; it still brands the input.
  const input = issueParserInput(read.artifact, read.text);
  return { input, read };
}

/** ------------------------------------------------- the test double */

/**
 * A test double: one in-process `Map`, no durability. `durable` is `false`.
 * Deterministic (`list` sorts) and refuses an occupied key by the shared rule.
 */
export class MemoryEvidenceStore implements EvidenceStore {
  /** Read by `assertDurable`. */
  readonly durable: boolean;

  private readonly objects: Map<string, StoredObject>;

  constructor() {
    this.durable = false;
    this.objects = new Map();
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    const existing = this.objects.get(key) ?? null;
    // Shared with the durable adapter. True for a proven no-op; throws when the key holds something else.
    if (reconcileExistingObject(key, bytes, meta, existing)) return;

    // A copy, so a caller mutating its buffer cannot rewrite stored evidence.
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
