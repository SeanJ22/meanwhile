/**
 * `EvidenceStore` over a local content-addressed filesystem root (`durable = true`).
 *
 *   1. Writes are atomic: temp name in the same directory, then `rename`.
 *   2. The sidecar `<key>.meta.json` is the commit point, written after the
 *      body; an object without one does not exist to `head`, `get` or `list`.
 *   3. `get` re-verifies the digest against the sidecar; corruption is a failed
 *      read naming both digests.
 *   4. Immutability is enforced here too, via `reconcileExistingObject`.
 *
 * `RESTRICTED_RAW` is refused by name unless a `RestrictedEvidenceProvider`
 * declaring encryption at rest and access control is supplied.
 *
 * No clock is read. The temp-file suffix is random and never persisted.
 */

import { netlifyEvidenceStoreFromEnv } from "./netlify-store.ts";
import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

import { contentHash } from "../ids.ts";
import type { ArtifactTier } from "./artifact.ts";
import {
  EvidenceStoreRefusal,
  objectClassOf,
  reconcileExistingObject,
  type EvidenceStore,
  type ObjectMeta,
  type StoredObject,
} from "./store.ts";

/** ------------------------------------------------- the restricted seam */

/**
 * The seam a substrate fit for quarantined bytes implements: the four
 * `EvidenceStore` verbs plus declarations about the substrate. The declarations
 * are the implementer's claims; this module refuses anything that does not
 * make them.
 */
export interface RestrictedEvidenceProvider {
  /** A stable, non-secret identifier for the substrate. Never a credential. */
  readonly providerId: string;
  /** Does the substrate encrypt bodies at rest? */
  readonly encryptedAtRest: boolean;
  /** Does the substrate gate reads on an identity this process does not hold by default? */
  readonly accessControlled: boolean;
  put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  head(key: string): Promise<ObjectMeta | null>;
  list(prefix: string): Promise<string[]>;
}

/**
 * A `RESTRICTED_RAW` body was offered to a substrate that cannot hold one: a
 * missing activation, not a bad retrieval. The message never names a
 * credential, class or fingerprint.
 */
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

/** A key that cannot be mapped onto a path inside the root. */
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

/** The bytes on disk are not the bytes that were written. */
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

/** ------------------------------------------------------ key -> path */

/** The sidecar suffix. A key ending in it is refused, so the two spaces cannot collide. */
export const SIDECAR_SUFFIX = ".meta.json";

/** In-flight writes. Excluded from `list`, and never renamed to a real key. */
const TEMP_PREFIX = ".wtp-evidence-tmp-";

/**
 * Map a key onto a relative path, or refuse it by name. Every traversal case is
 * refused explicitly; the final containment check stays as a backstop.
 */
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

/**
 * Percent-encodes what a Windows path segment cannot hold (`<>:"|?*`, control
 * characters, a trailing `.` or space) and `%` itself, so the mapping reverses.
 * A segment holding none of them maps to itself.
 */
const UNSAFE_IN_PATH_SEGMENT = /[<>:"|?*%\u0001-\u001f]|[. ]$/g;

export function encodePathSegment(segment: string): string {
  return segment.replace(UNSAFE_IN_PATH_SEGMENT, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

/** The key segment a name on disk encodes: the inverse of {@link encodePathSegment}. */
export function decodePathSegment(name: string): string {
  return name.replace(/%([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

/** ---------------------------------------------------------- the sidecar */

/**
 * What sits beside every body. `meta` answers `head` without reading bytes.
 * `bodySha256` is what this store hashed and what `get` verifies;
 * `meta.contentHash` is the caller's claim (for a manifest it is
 * `manifest:<workItemId>`, which no bytes hash to).
 */
interface Sidecar {
  readonly key: string;
  readonly meta: ObjectMeta;
  readonly bodySha256: string;
  readonly bodyBytes: number;
}

/** ------------------------------------------------------- the adapter */

export interface DurableEvidenceStoreOptions {
  /** Null selects the local source during an explicit transfer. */
  readonly remote?: EvidenceStore | null;
  /** The substrate for `RESTRICTED_RAW` bodies. Absent, this store refuses them by name. */
  readonly restricted?: RestrictedEvidenceProvider;
}

/**
 * `EvidenceStore` over a local content-addressed filesystem root. The root is
 * a constructor parameter only: no environment variable or default path.
 */
export class DurableEvidenceStore implements EvidenceStore {
  /** Read by `assertDurable`. */
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

  /** The absolute body path for a key, refusing anything that would leave the root. */
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
      /* A sidecar that exists and cannot be read is a failed read, never an absent object. */
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

  /**
   * Is this object's tier one the plain filesystem root may hold? An object with
   * no declared tier is unrestricted; a `RESTRICTED_RAW` artifact always
   * carries its tier.
   */
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

  /**
   * Write body then sidecar, each through a temp name and a `rename`.
   *
   * On Windows, a rename onto a destination another process is renaming onto
   * fails with `EPERM`/`EACCES`/`EEXIST`. A lost rename consults the mandatory
   * `acceptExisting`: an equivalent object already there means the other writer
   * won; otherwise the error is rethrown.
   */
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
        // The other writer won the race with an equivalent object. Nothing to do.
      }
    } finally {
      // Cleanup after a failure, which would otherwise leave a temp file behind.
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

    /*
     * The content address is verified at the provider boundary too. A
     * `MUTABLE_INDEX` is exempt: its `contentHash` names the obligation, and
     * `bodySha256` is what a read verifies.
     */
    if (objectClass === "IMMUTABLE_BODY" && meta.contentHash !== offeredSha) {
      throw new EvidenceStoreRefusal(
        `Key ${key} was offered ${bytes.byteLength} byte(s) hashing to ${offeredSha} under ` +
          `metadata recording ${meta.contentHash}. The object name IS the hash, so these ` +
          "bytes would be stored at the address of a body they are not.",
      );
    }

    const existing = await this.readSidecar(key);
    if (existing) {
      // The shared rule, so this adapter and the in-memory double agree on "already there".
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

    /* A lost body rename is accepted only when the body already there hashes the same. */
    await this.atomicWrite(bodyPath, bytes, (existing) => contentHash(existing) === offeredSha);
    await this.readBody(key, offeredSha, bytes.byteLength);

    /* The sidecar is the commit point and is written second. */
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
        ? /* No acceptance for a rebuilt index: two racing rebuilds genuinely disagree. */
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

  /**
   * Read, recomputing the digest against the sidecar. A body with no sidecar is
   * an incomplete write and returns `null`; a sidecar with no body is a failed read.
   */
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

  /** Committed keys under a prefix, sorted. Orphan bodies and temp files are never listed. */
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
      // An absent root is an empty store; every other errno is a failed read.
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }

    const found: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(TEMP_PREFIX)) continue;
      /* A name on disk encodes its key segment (`encodePathSegment`); the key is always the decoded one. */
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

/**
 * An in-memory `RestrictedEvidenceProvider` for tests only. Its declarations are
 * constructor parameters; it has no `durable` and never satisfies `assertDurable`.
 */
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

  async head(key: string): Promise<ObjectMeta | null> {
    return this.objects.get(key)?.meta ?? null;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
  }

  /** Test affordance only. */
  get size(): number {
    return this.objects.size;
  }
}
