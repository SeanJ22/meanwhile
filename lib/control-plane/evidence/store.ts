import { createHash } from "node:crypto";
import {
  RestrictedArtifactRefused,
  parserMayRead,
  type Artifact,
  type ArtifactDerivation,
} from "./artifact.ts";
import { contentHash } from "../ids.ts";
import { issueParserInput, type ParserInput } from "./parser-boundary.ts";

export const OBJECT_CLASSES = [

  "IMMUTABLE_BODY",

  "MUTABLE_INDEX",
] as const;
export type ObjectClass = (typeof OBJECT_CLASSES)[number];

export interface ObjectMeta {
  readonly contentType: string;
  readonly contentHash: string;
  readonly byteLength: number;

  readonly objectClass?: ObjectClass;

  readonly custom?: Readonly<Record<string, string>>;
}

export function objectClassOf(meta: ObjectMeta): ObjectClass {
  return meta.objectClass ?? "IMMUTABLE_BODY";
}

export interface StoredObjectStream {
  readonly key: string;
  readonly body: ReadableStream<Uint8Array>;
  readonly meta: ObjectMeta;
}

export interface StoredObject {
  readonly key: string;
  readonly bytes: Uint8Array;
  readonly meta: ObjectMeta;
}

export async function abortableEvidenceRead<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(() => undefined);
  signal.throwIfAborted();
  let stop: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, { once: true });
  });
  try { return await Promise.race([work, aborted]); }
  finally { if (stop) signal.removeEventListener("abort", stop); }
}

export function checkedEvidenceBody(key: string, body: ReadableStream<Uint8Array>, meta: ObjectMeta,
  bodySha256: string, signal?: AbortSignal): ReadableStream<Uint8Array> {
  const reader = body.getReader(), hash = createHash("sha256");
  let received = 0, closed = false;
  const close = () => { if (!closed) { closed = true; reader.releaseLock(); } };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await (signal ? abortableEvidenceRead(reader.read(), signal) : reader.read());
        if (next.done) {
          if (received !== meta.byteLength || `sha256-${hash.digest("hex")}` !== bodySha256) throw new EvidenceStoreRefusal(`Stored evidence is corrupt at ${key}`);
          close(); controller.close(); return;
        }
        received += next.value.byteLength;
        if (received > meta.byteLength) throw new EvidenceStoreRefusal(`Stored evidence is corrupt at ${key}`);
        hash.update(next.value); controller.enqueue(next.value);
      } catch (error) {
        await reader.cancel(error).catch(() => undefined); close(); controller.error(error);
      }
    },
    async cancel(reason) { await reader.cancel(reason).catch(() => undefined); close(); },
  }, { highWaterMark: 0 });
}

export interface EvidenceStore {
  put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  stream(key: string): Promise<StoredObjectStream | null>;
  head(key: string): Promise<ObjectMeta | null>;

  list(prefix: string): Promise<string[]>;
}

const EXTENSIONS: Readonly<Record<string, string>> = {
  "text/html": "html",
  "application/xhtml+xml": "html",
  "application/json": "json",
  "application/x-ndjson": "ndjson",
  "text/json": "json",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/pdf": "pdf",
  "application/xml": "xml",
  "text/xml": "xml",
  "application/rss+xml": "xml",
  "text/calendar": "ics",
};

export function extensionFor(contentType: string): string {
  return EXTENSIONS[contentType.split(";")[0].trim().toLowerCase()] ?? "bin";
}

export function datePath(isoInstant: string): string {
  const t = Date.parse(isoInstant);
  if (Number.isNaN(t)) throw new EvidenceStoreRefusal(`retrievedAt is not an instant: ${isoInstant}`);
  const d = new Date(t);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}/${mm}/${dd}`;
}

export function workItemPrefix(project: string, artifact: Artifact): string {
  return (
    `project/${project}/source/${artifact.sourceId}/` +
    `${datePath(artifact.retrievedAt)}/${artifact.workItemId}/`
  );
}

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

export function manifestKey(project: string, artifact: Artifact): string {
  return `${workItemPrefix(project, artifact)}manifest.json`;
}

export class EvidenceStoreRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceStoreRefusal";
  }
}

export const IMMUTABLE_IDENTITY_FIELDS: readonly string[] = [
  "tier",
  "sourceId",
  "workItemId",
  "retentionPolicy",
  "extraction",
];

export const ATTEMPT_SCOPED_FIELDS: readonly string[] = [
  "attemptId",
  "methodRouteId",
  "retrievedAt",
  "httpStatus",
  "permission",
  "transport",
  "canonicalUrl",
  "retrievalUrl",
];

export interface MetaConflict {
  readonly field: string;
  readonly stored: string;
  readonly offered: string;
}

function contentTypeEssence(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}

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

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

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
    throw new EvidenceStoreRefusal(
      `Key ${key} already holds ${stored.meta.byteLength} byte(s) recorded as ` +
        `${stored.meta.contentHash}, and the offered bytes carry identical metadata while ` +
        "differing byte-for-byte. The metadata is not the evidence; the bytes are.",
    );
  }

  return true;
}

export interface EvidenceManifest {
  readonly project: string;
  readonly workItemId: string;
  readonly artifacts: readonly Artifact[];
  readonly derivations: readonly ArtifactDerivation[];
  readonly updatedAt: string;
}

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

export const EVIDENCE_ROLES = ["ACQUIRER", "PARSER", "AUDITOR", "PUBLISHER"] as const;
export type EvidenceRole = (typeof EVIDENCE_ROLES)[number];

export const RESTRICTED_READERS: readonly EvidenceRole[] = ["ACQUIRER", "AUDITOR"];

export function mayReadTier(role: EvidenceRole, artifact: Artifact): boolean {
  if (parserMayRead(artifact)) return true;
  return RESTRICTED_READERS.includes(role);
}

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

export interface ArtifactRead {
  readonly artifact: Artifact;
  readonly bytes: Uint8Array;
  readonly text: string;

  readonly substitutedForArtifactId?: string;

  readonly refusal?: string;
}

export interface ReadOptions {
  readonly derivatives?: ReadonlyMap<string, Artifact>;
}

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

export async function readForParser(
  store: EvidenceStore,
  project: string,
  artifact: Artifact,
  options: ReadOptions = {},
): Promise<{ input: ParserInput; read: ArtifactRead }> {
  const read = await readArtifact(store, project, artifact, "PARSER", options);
  const input = issueParserInput(read.artifact, read.text);
  return { input, read };
}

export class MemoryEvidenceStore implements EvidenceStore {
  readonly durable: boolean;

  private readonly objects: Map<string, StoredObject>;

  constructor() {
    this.durable = false;
    this.objects = new Map();
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    const existing = this.objects.get(key) ?? null;
    if (reconcileExistingObject(key, bytes, meta, existing)) return;

    this.objects.set(key, { key, bytes: Uint8Array.from(bytes), meta });
  }

  async get(key: string): Promise<StoredObject | null> {
    const found = this.objects.get(key);
    return found ? { key, bytes: Uint8Array.from(found.bytes), meta: found.meta } : null;
  }

  async stream(key: string): Promise<StoredObjectStream | null> {
    const found = this.objects.get(key);
    if (!found) return null;
    let offset = 0;
    return { key, meta: found.meta, body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset === found.bytes.byteLength) { controller.close(); return; }
        const end = Math.min(offset + 64 * 1024, found.bytes.byteLength);
        controller.enqueue(found.bytes.slice(offset, end)); offset = end;
      },
    }, { highWaterMark: 0 }) };
  }

  async head(key: string): Promise<ObjectMeta | null> {
    return this.objects.get(key)?.meta ?? null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  get size(): number {
    return this.objects.size;
  }
}

export function assertDurable(store: EvidenceStore, context: string): void {
  if ((store as { durable?: boolean }).durable === false) {
    throw new EvidenceStoreRefusal(
      `${context} requires a durable evidence store and was handed an in-memory ` +
        "test double. Bytes written here are lost when the process exits, and " +
        "evidence that does not survive the process is not evidence.",
    );
  }
}
