import { netlifyEvidenceStoreFromEnv } from "./netlify-store.ts";
import { randomBytes } from "node:crypto";
import { createReadStream, type Dirent } from "node:fs";
import { Readable } from "node:stream";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { contentHash } from "../ids.ts";
import type { ArtifactTier } from "./artifact.ts";
import {
  checkedEvidenceBody,
  EvidenceStoreRefusal,
  objectClassOf,
  reconcileExistingObject,
  type EvidenceStore,
  type ObjectMeta,
  type StoredObject,
  type StoredObjectStream,
} from "./store.ts";

export interface RestrictedEvidenceProvider {
  readonly providerId: string;

  readonly encryptedAtRest: boolean;

  readonly accessControlled: boolean;
  put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  stream(key: string): Promise<StoredObjectStream | null>;
  head(key: string): Promise<ObjectMeta | null>;
  list(prefix: string): Promise<string[]>;
}

export class RestrictedDurabilityUnavailable extends EvidenceStoreRefusal {
  readonly key: string;
  readonly providerId: string | null;
  readonly missing: readonly string[];

  constructor(key: string, providerId: string | null, missing: readonly string[]) {
    super(
      `Key ${key} carries a RESTRICTED_RAW body and ` +
        (providerId === null
          ? "this store was constructed without a RestrictedEvidenceProvider. "
          : `provider ${providerId} does not supply: ${missing.join(", ")}. `) +
        "A RESTRICTED_RAW body is encrypted and access-controlled or it is not stored. " +
        "The tier is not weakened to fit the substrate — a quarantined body written to a " +
        "plain or public store is the PR #217 class with a record saying it was contained. " +
        `Missing activation: ${missing.join(", ")}.`,
    );
    this.name = "RestrictedDurabilityUnavailable";
    this.key = key;
    this.providerId = providerId;
    this.missing = [...missing];
  }
}

export class UnsafeEvidenceKey extends EvidenceStoreRefusal {
  readonly key: string;
  readonly reason: string;

  constructor(key: string, reason: string) {
    super(
      `Key ${JSON.stringify(key)} cannot be mapped onto a path under the evidence root: ` +
        `${reason}. A key is a name inside the namespace, never an instruction about the ` +
        "filesystem, and a store that resolved one outside its root would read and write " +
        "wherever the caller pointed it.",
    );
    this.name = "UnsafeEvidenceKey";
    this.key = key;
    this.reason = reason;
  }
}

export class EvidenceCorrupted extends EvidenceStoreRefusal {
  readonly key: string;
  readonly recordedHash: string;
  readonly actualHash: string;

  constructor(key: string, recordedHash: string, actualHash: string, byteLength: number) {
    super(
      `Key ${key} holds ${byteLength} byte(s) hashing to ${actualHash}, and the sidecar ` +
        `records ${recordedHash}. The bytes on disk are not the bytes that were written. ` +
        "This is a FAILED READ: a corrupted body is never returned and never reported as " +
        "an empty document, because a parse of the wrong bytes is a false claim about a " +
        "government that nothing downstream could ever detect.",
    );
    this.name = "EvidenceCorrupted";
    this.key = key;
    this.recordedHash = recordedHash;
    this.actualHash = actualHash;
  }
}

export const SIDECAR_SUFFIX = ".meta.json";

const TEMP_PREFIX = ".wtp-evidence-tmp-";

export function keyToRelativePath(key: string): string {
  if (typeof key !== "string" || key.length === 0) {
    throw new UnsafeEvidenceKey(String(key), "the key is empty");
  }
  if (key.includes(String.fromCharCode(0))) {
    throw new UnsafeEvidenceKey(key, "the key contains a NUL byte");
  }
  if (key.includes("\\")) {
    throw new UnsafeEvidenceKey(key, "the key contains a backslash, which is a separator here");
  }
  if (key.startsWith("/")) {
    throw new UnsafeEvidenceKey(key, "the key is an absolute path");
  }
  if (key.endsWith(SIDECAR_SUFFIX)) {
    throw new UnsafeEvidenceKey(
      key,
      `the key ends in ${SIDECAR_SUFFIX}, which is where this store keeps another key's ` +
        "metadata — one object would silently become another object's sidecar",
    );
  }

  const segments = key.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      throw new UnsafeEvidenceKey(key, "the key has an empty path segment");
    }
    if (segment === "." || segment === "..") {
      throw new UnsafeEvidenceKey(key, `the key has a ${JSON.stringify(segment)} segment`);
    }
    if (/^[A-Za-z]:/.test(segment)) {
      throw new UnsafeEvidenceKey(key, "the key has a drive-letter segment");
    }
    if (segment.startsWith(TEMP_PREFIX)) {
      throw new UnsafeEvidenceKey(
        key,
        "the key has a segment reserved for in-flight writes and would be invisible to list()",
      );
    }
  }

  return segments.map(encodePathSegment).join(sep);
}

const UNSAFE_IN_PATH_SEGMENT = /[<>:"|?*%\u0001-\u001f]|[. ]$/g;

export function encodePathSegment(segment: string): string {
  return segment.replace(UNSAFE_IN_PATH_SEGMENT, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

export function decodePathSegment(name: string): string {
  return name.replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

interface Sidecar {
  readonly key: string;
  readonly meta: ObjectMeta;
  readonly bodySha256: string;
  readonly bodyBytes: number;
}

export interface DurableEvidenceStoreOptions {
  readonly remote?: EvidenceStore | null;

  readonly restricted?: RestrictedEvidenceProvider;
}

export class DurableEvidenceStore implements EvidenceStore {
  readonly durable: boolean;

  readonly root: string;

  private readonly restricted: RestrictedEvidenceProvider | null;
  private readonly remote: EvidenceStore | null;

  constructor(root: string, options: DurableEvidenceStoreOptions = {}) {
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new EvidenceStoreRefusal(
        "DurableEvidenceStore requires an explicit root directory. A store that invents its " +
          "own location is a store two processes can disagree about, and the disagreement " +
          "reads back as missing evidence rather than as a misconfiguration.",
      );
    }
    this.remote = options.remote === undefined ? netlifyEvidenceStoreFromEnv() : options.remote;
    this.durable = true;
    this.root = resolve(root);
    this.restricted = options.restricted ?? null;
  }

  private bodyPath(key: string): string {
    const relative = keyToRelativePath(key);
    const absolute = resolve(this.root, relative);
    if (absolute !== this.root && !absolute.startsWith(this.root + sep)) {
      throw new UnsafeEvidenceKey(key, "the resolved path is outside the evidence root");
    }
    return absolute;
  }

  private sidecarPath(key: string): string {
    return `${this.bodyPath(key)}${SIDECAR_SUFFIX}`;
  }

  private async readSidecar(key: string): Promise<Sidecar | null> {
    let text: string;
    try {
      text = await readFile(this.sidecarPath(key), "utf8");
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;

      throw new EvidenceStoreRefusal(
        `The metadata for key ${key} exists and could not be read ` +
          `(${(cause as NodeJS.ErrnoException).code ?? "unknown"}). A failed read is a FAILED ` +
          "READ, never an absent object.",
      );
    }

    try {
      return JSON.parse(text) as Sidecar;
    } catch (cause) {
      throw new EvidenceStoreRefusal(
        `The metadata for key ${key} is present and is not parseable JSON: ` +
          `${(cause as Error).message}. An unreadable sidecar is a failed read, never an ` +
          "object that was never written.",
      );
    }
  }

  private restrictedRouting(key: string, meta: ObjectMeta): RestrictedEvidenceProvider | null {
    const tier = meta.custom?.tier as ArtifactTier | undefined;
    if (tier !== "RESTRICTED_RAW") return null;

    if (this.restricted === null) {
      throw new RestrictedDurabilityUnavailable(key, null, [
        "a RestrictedEvidenceProvider (encrypted at rest, access-controlled)",
      ]);
    }

    const missing: string[] = [];
    if (!this.restricted.encryptedAtRest) missing.push("encryption at rest");
    if (!this.restricted.accessControlled) missing.push("access control");
    if (missing.length > 0) {
      throw new RestrictedDurabilityUnavailable(key, this.restricted.providerId, missing);
    }
    return this.restricted;
  }

  private async atomicWrite(
    absolutePath: string,
    bytes: Uint8Array,
    acceptExisting: ((existing: Buffer) => boolean) | null,
  ): Promise<void> {
    const directory = dirname(absolutePath);
    await mkdir(directory, { recursive: true });
    const temp = join(directory, `${TEMP_PREFIX}${randomBytes(12).toString("hex")}`);
    try {
      await writeFile(temp, bytes);
      try {
        await rename(temp, absolutePath);
      } catch (cause) {
        if (!acceptExisting) throw cause;
        const existing = await readFile(absolutePath).catch(() => null);
        if (existing === null || !acceptExisting(existing)) throw cause;
      }
    } finally {
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    const provider = this.restrictedRouting(key, meta);
    if (provider) return provider.put(key, bytes, meta);
    if (this.remote) return this.remote.put(key, bytes, meta);

    const bodyPath = this.bodyPath(key);
    const offeredSha = contentHash(bytes);
    const objectClass = objectClassOf(meta);

    if (objectClass === "IMMUTABLE_BODY" && meta.contentHash !== offeredSha) {
      throw new EvidenceStoreRefusal(
        `Key ${key} was offered ${bytes.byteLength} byte(s) hashing to ${offeredSha} under ` +
          `metadata recording ${meta.contentHash}. The object name IS the hash, so these ` +
          "bytes would be stored at the address of a body they are not.",
      );
    }

    const existing = await this.readSidecar(key);
    if (existing) {
      const noop = reconcileExistingObject(key, bytes, meta, { meta: existing.meta });
      if (objectClass === "IMMUTABLE_BODY") {
        if (existing.bodySha256 !== offeredSha) {
          throw new EvidenceStoreRefusal(
            `Key ${key} already holds bytes hashing to ${existing.bodySha256} and the offered ` +
              `bytes hash to ${offeredSha}. An evidence key holds one body for the whole of ` +
              "its life; the stored body is the one already cited and it is not replaced.",
          );
        }
        if (noop) {
          await this.readBody(key, existing.bodySha256, existing.bodyBytes);
          return;
        }
      }
    }

    await this.atomicWrite(bodyPath, bytes, (existing) => contentHash(existing) === offeredSha);
    await this.readBody(key, offeredSha, bytes.byteLength);

    const sidecar: Sidecar = {
      key,
      meta,
      bodySha256: offeredSha,
      bodyBytes: bytes.byteLength,
    };
    await this.atomicWrite(
      `${bodyPath}${SIDECAR_SUFFIX}`,
      new TextEncoder().encode(`${JSON.stringify(sidecar, null, 2)}\n`),
      objectClass === "MUTABLE_INDEX"
        ?
          null
        : (existing) => {
            try {
              return (JSON.parse(existing.toString("utf8")) as Sidecar).bodySha256 === offeredSha;
            } catch {
              return false;
            }
          },
    );
  }

  async head(key: string): Promise<ObjectMeta | null> {
    if (this.restricted) {
      const fromProvider = await this.restricted.head(key);
      if (fromProvider) return fromProvider;
    }
    if (this.remote) return this.remote.head(key);
    return (await this.get(key))?.meta ?? null;
  }

  async get(key: string): Promise<StoredObject | null> {
    if (this.restricted) {
      const fromProvider = await this.restricted.get(key);
      if (fromProvider) return fromProvider;
    }

    if (this.remote) return this.remote.get(key);
    const sidecar = await this.readSidecar(key);
    if (!sidecar) return null;

    const bytes = await this.readBody(key, sidecar.bodySha256, sidecar.bodyBytes);
    return { key, bytes: new Uint8Array(bytes), meta: sidecar.meta };
  }

  async stream(key: string): Promise<StoredObjectStream | null> {
    if (this.restricted) {
      const fromProvider = await this.restricted.stream(key);
      if (fromProvider) return fromProvider;
    }
    if (this.remote) return this.remote.stream(key);
    const sidecar = await this.readSidecar(key);
    if (!sidecar) return null;
    if (sidecar.meta.byteLength !== sidecar.bodyBytes) throw new EvidenceStoreRefusal(`Stored evidence metadata is corrupt at ${key}`);
    const body = Readable.toWeb(createReadStream(this.bodyPath(key), { highWaterMark: 64 * 1024 })) as ReadableStream<Uint8Array>;
    return { key, meta: sidecar.meta, body: checkedEvidenceBody(key, body, sidecar.meta, sidecar.bodySha256) };
  }

  private async readBody(key: string, recordedHash: string, byteLength: number): Promise<Buffer> {
    const bodyPath = this.bodyPath(key);
    let bytes: Buffer;
    try {
      bytes = await readFile(bodyPath);
    } catch (cause) {
      throw new EvidenceStoreRefusal(
        `Key ${key} records ${byteLength} byte(s) and its ` +
          `body could not be read (${(cause as NodeJS.ErrnoException).code ?? "unknown"}). ` +
          "A missing or unreadable body is a failed read, never an empty document.",
      );
    }

    const actual = contentHash(bytes);
    if (actual !== recordedHash) {
      throw new EvidenceCorrupted(key, recordedHash, actual, bytes.byteLength);
    }
    if (bytes.byteLength !== byteLength) throw new EvidenceStoreRefusal(`Key ${key} records ${byteLength} byte(s), but holds ${bytes.byteLength}.`);
    return bytes;
  }

  async list(prefix: string): Promise<string[]> {
    const keys = this.remote ? await this.remote.list(prefix) : await this.walk(this.root, "");
    if (this.restricted) keys.push(...(await this.restricted.list(prefix)));
    return [...new Set(keys.filter((k) => k.startsWith(prefix)))].sort();
  }

  private async walk(directory: string, keyPrefix: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }

    const found: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(TEMP_PREFIX)) continue;

      const childKey = keyPrefix ? `${keyPrefix}/${decodePathSegment(name)}` : decodePathSegment(name);
      if (entry.isDirectory()) {
        found.push(...(await this.walk(join(directory, name), childKey)));
      } else if (name.endsWith(SIDECAR_SUFFIX)) {
        found.push(childKey.slice(0, -SIDECAR_SUFFIX.length));
      }
    }
    return found;
  }
}

export class InMemoryRestrictedProvider implements RestrictedEvidenceProvider {
  readonly providerId: string;
  readonly encryptedAtRest: boolean;
  readonly accessControlled: boolean;

  private readonly objects: Map<string, StoredObject>;

  constructor(
    options: {
      providerId?: string;
      encryptedAtRest?: boolean;
      accessControlled?: boolean;
    } = {},
  ) {
    this.providerId = options.providerId ?? "in-memory-restricted-test-double";
    this.encryptedAtRest = options.encryptedAtRest ?? true;
    this.accessControlled = options.accessControlled ?? true;
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
