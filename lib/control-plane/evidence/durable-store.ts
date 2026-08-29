/**
 * THE EVIDENCE PLANE, PART FOUR — THE FIRST DURABLE ADAPTER.
 *
 * ## What this is, and what the design said it would be
 *
 * The technical design says *"the evidence vault is not a second asset store; it
 * extends the content-addressed store `lib/ops/asset-remote.ts` already
 * operates"*. Reading that module rather than the sentence about it changes what
 * can honestly be built on it:
 *
 *   - `lib/ops/asset-remote.ts` is a **READ path**. `fetchAssetFromRemote` GETs
 *     from `https://raw.githubusercontent.com/SeanJ22/wtp-assets/main` and
 *     verifies the bytes against the hash they were requested under. There is no
 *     write verb in it, from this process or any other.
 *   - The store it reads is **PUBLIC**, and RULING 117 says that is the correct
 *     posture *for that store* — everything in it was already published by a
 *     government body or under an open licence, so there is nothing to protect.
 *
 * What it shares with the vault is the discipline, and that is the part worth
 * inheriting: **the name of the object IS the hash of its correct contents**, so
 * a read verifies for free and a 200 that is not the thing is not a document.
 * What it cannot supply is a write path or a private one.
 *
 * So this adapter implements `EvidenceStore` over a **local content-addressed
 * filesystem root** — the same substrate class every canonical store in this
 * repository already uses — with `durable = true`. It is the smallest thing that
 * is honestly durable: bytes that survive the process, verified on the way in and
 * again on the way out.
 *
 * ## FOUR PROPERTIES, EACH ONE CLOSING A SPECIFIC FAILURE
 *
 *   1. **The write is ATOMIC.** Body to a temp name in the same directory, then
 *      `rename`. A process killed mid-write leaves a temp file, never a truncated
 *      body at the real key — and a truncated body at a real key is the worst
 *      outcome available here, because it reads back as evidence, hashes to
 *      nothing anyone recorded, and is indistinguishable from a publisher having
 *      served something different.
 *   2. **The sidecar is the COMMIT POINT.** `<key>.meta.json` is written after
 *      the body, and an object without one does not exist as far as `head`, `get`
 *      and `list` are concerned. A crash between the two leaves an orphan body
 *      that is garbage rather than a half-declared artifact, and the next `put`
 *      of that key renames over it atomically.
 *   3. **`get` RE-VERIFIES.** Every read recomputes the digest of the bytes on
 *      disk and compares it with what the sidecar recorded at write time. Silent
 *      corruption — a bad sector, a partial restore, a file replaced under the
 *      same name — is a FAILED READ that names the corruption and both digests.
 *      It is never a returned body and never an empty document.
 *   4. **The immutability contract is enforced HERE TOO**, through the same
 *      `reconcileExistingObject` the in-memory double uses. A rule that lived
 *      only in `putArtifact` would be bypassed by the first caller that held a
 *      store reference, and the store reference is what every provider hands out.
 *
 * ## `RESTRICTED_RAW` IS REFUSED, BY NAME, AND THE TIER IS NOT WEAKENED
 *
 * The design's own words for the quarantined tier are *"encrypted,
 * access-controlled, excluded from git, logs and prompts"*. A plain filesystem
 * root is none of the first two, and the public asset store is the opposite of
 * both. There are two ways to make the tier fit a substrate that cannot hold it:
 * weaken the tier, or refuse the write. Weakening the tier is how PR #217
 * happens again with a record saying it did not.
 *
 * So this adapter **refuses a `RESTRICTED_RAW` artifact by name** unless it was
 * constructed with a `RestrictedEvidenceProvider` — the seam an encrypted,
 * access-controlled substrate implements — and the refusal names the missing
 * activation rather than pretending the tier does not exist. A provider that
 * declares it is NOT encrypted at rest or NOT access-controlled is refused by the
 * same rule, so the seam cannot be satisfied by re-wrapping this class in a
 * different name.
 *
 * ## TIME AND ENTROPY
 *
 * No clock is read. Nothing here stamps a document; the only timestamps that
 * reach disk are the ones the caller already put in the artifact. The temp-file
 * suffix uses `randomBytes` and is never persisted, never compared and never part
 * of any identity — a name that exists for the duration of one `rename`.
 */

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
 * THE SEAM A SUBSTRATE FIT FOR QUARANTINED BYTES IMPLEMENTS.
 *
 * Narrow on purpose: the four verbs `EvidenceStore` already has, plus two
 * DECLARATIONS about the substrate. The declarations are the point. Without them
 * "has a restricted provider" would mean "somebody passed an object", and the
 * cheapest object to pass is another plain filesystem store — which is precisely
 * the substitution the refusal exists to prevent.
 *
 * The declarations are claims by the implementer, not proofs. This module cannot
 * verify that a remote KMS actually encrypts; what it can do is refuse to write
 * quarantined bytes to something that does not even claim to, and make the claim
 * a visible line of code in whatever implements this rather than an assumption
 * living in a comment. The real proof belongs to the provider's own tests.
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
 * A `RESTRICTED_RAW` body was offered to a substrate that cannot hold one.
 *
 * A named subclass so a caller can tell it from every other refusal in this
 * module. "This store will not take these bytes" and "these bytes are wrong" are
 * opposite diagnoses: the first is an activation the project has not done yet and
 * is fixed by configuration, the second is a defect in the retrieval. Collapsing
 * them would have somebody re-walk a route to fix a missing provider.
 *
 * The message names the ARTIFACT and the MISSING ACTIVATION. It never names a
 * credential, a class or a fingerprint — this refusal is read wherever writes are
 * logged, and a refusal about credential-bearing bytes has no business hinting at
 * what they contain.
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
 * MAP A KEY ONTO A RELATIVE PATH, OR REFUSE IT BY NAME.
 *
 * Object keys contain `/` and the natural mapping is nested directories. That
 * mapping is also the classic path-traversal hole, so every refusal is explicit
 * rather than left to `path.resolve` to sort out — `resolve` is happy to leave
 * the root and would do so silently.
 *
 * The final containment check is kept even though every listed rule above it
 * already prevents escape. It costs one comparison and it is the check that still
 * holds if one of the rules is ever loosened.
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

  return segments.join(sep);
}

/** ---------------------------------------------------------- the sidecar */

/**
 * WHAT SITS BESIDE EVERY BODY.
 *
 * `meta` answers `head` without transferring bytes — the verb a retention sweep
 * and an integrity check use, and the reason neither has to read a megabyte of
 * HTML to answer a question about it.
 *
 * `bodySha256` is recorded SEPARATELY from `meta.contentHash` and is what `get`
 * verifies against. They are the same value for an `IMMUTABLE_BODY`, and they are
 * deliberately two fields: `meta.contentHash` is the caller's CLAIM about the
 * artifact, and `bodySha256` is what this store actually hashed on the way in.
 * The manifest is the case that proves they are different questions — its
 * `contentHash` is `manifest:<workItemId>`, which no bytes will ever hash to, and
 * without a separate recorded digest a rebuilt index would be the one object in
 * the store that no read could verify.
 */
interface Sidecar {
  readonly key: string;
  readonly meta: ObjectMeta;
  readonly bodySha256: string;
  readonly bodyBytes: number;
}

/** ------------------------------------------------------- the adapter */

export interface DurableEvidenceStoreOptions {
  /**
   * The substrate for `RESTRICTED_RAW` bodies. Absent means this store refuses
   * them by name — which is the correct behaviour and not a degraded one.
   */
  readonly restricted?: RestrictedEvidenceProvider;
}

/**
 * `EvidenceStore` OVER A LOCAL CONTENT-ADDRESSED FILESYSTEM ROOT.
 *
 * `durable` is `true`, so `assertDurable` passes — and that claim is the reason
 * every property above is enforced rather than described. A store that says it is
 * durable and loses a body on a crash is worse than the in-memory double, because
 * the double is honest about what it is.
 *
 * The root is a constructor parameter and nothing else. No environment variable
 * is consulted, no default path is invented, and no directory is chosen from a
 * clock or a run id. A store that picks its own location is a store two processes
 * can disagree about, and the disagreement shows up as missing evidence.
 */
export class DurableEvidenceStore implements EvidenceStore {
  /** Read by `assertDurable`. True, and every property above is why. */
  readonly durable: boolean;

  readonly root: string;

  private readonly restricted: RestrictedEvidenceProvider | null;

  constructor(root: string, options: DurableEvidenceStoreOptions = {}) {
    if (typeof root !== "string" || root.trim().length === 0) {
      throw new EvidenceStoreRefusal(
        "DurableEvidenceStore requires an explicit root directory. A store that invents its " +
          "own location is a store two processes can disagree about, and the disagreement " +
          "reads back as missing evidence rather than as a misconfiguration.",
      );
    }
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
      /*
       * A sidecar that exists and cannot be read is NOT an absent object. EACCES,
       * EISDIR and EIO all mean "this store cannot answer the question", and
       * answering "no such key" would turn a broken store into a fact about the
       * evidence — the exact substitution CLAUDE.md forbids.
       */
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
   * Is this object's tier one the plain filesystem root may hold?
   *
   * Read from `custom.tier`, which `artifactMeta` always sets. An object with NO
   * declared tier is treated as unrestricted — it is the manifest and the
   * ordinary-body case — and that is safe in the one direction that matters: a
   * `RESTRICTED_RAW` artifact always carries its tier, because `putArtifact`
   * copies it from the artifact and the artifact cannot be built without one.
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
   * `rename` within one directory is the atomic primitive every filesystem this
   * runs on provides. Writing the body directly would leave a partial file at the
   * real key on a crash, and a partial file at a real key reads back as evidence.
   *
   * ## THE LOST RACE IS NOT A FAILURE, AND ON WINDOWS IT IS NOT RARE
   *
   * POSIX `rename` replaces an existing destination atomically and two workers
   * racing the same retrieval simply both succeed. **Windows does not.**
   * `MoveFileExW` refuses with `EPERM`/`EACCES`/`EEXIST` when another process is
   * renaming onto the same destination at that instant — and this project's
   * primary development platform is Windows, so the failure is the ordinary case
   * rather than a curiosity. It was found by the concurrent-put test and not by
   * reasoning, which is why that test exists.
   *
   * Rethrowing would make two workers racing one retrieval — the exact scenario
   * the content address exists to make safe — an error on one of them. So a lost
   * rename consults `acceptExisting`: when the object now at the destination is
   * EQUIVALENT to the one being written, the other writer won and this write is
   * complete. When it is not, the error is rethrown unchanged. The predicate is
   * mandatory at the call site rather than defaulted, because "accept whatever is
   * there" is the one thing this store must never do.
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
      // A no-op after a successful rename; the cleanup that matters is the one
      // after a failure, which would otherwise leave a temp file behind forever.
      await rm(temp, { force: true }).catch(() => undefined);
    }
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    const provider = this.restrictedRouting(key, meta);
    if (provider) return provider.put(key, bytes, meta);

    const bodyPath = this.bodyPath(key);
    const offeredSha = contentHash(bytes);
    const objectClass = objectClassOf(meta);

    /*
     * The content address is verified at the PROVIDER boundary as well as in
     * `putArtifact`. A rule enforced only by the helper is bypassed by the first
     * caller holding a store reference, and the store reference is what every
     * provider hands out. A `MUTABLE_INDEX` is exempt by construction: its
     * `contentHash` names the obligation, not the bytes, and `bodySha256` is what
     * a read of it verifies against.
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
      // The shared rule, so this adapter and the in-memory double cannot come to
      // disagree about what "already there" means.
      const noop = reconcileExistingObject(key, bytes, meta, { meta: existing.meta });
      if (objectClass === "IMMUTABLE_BODY") {
        if (existing.bodySha256 !== offeredSha) {
          throw new EvidenceStoreRefusal(
            `Key ${key} already holds bytes hashing to ${existing.bodySha256} and the offered ` +
              `bytes hash to ${offeredSha}. An evidence key holds one body for the whole of ` +
              "its life; the stored body is the one already cited and it is not replaced.",
          );
        }
        if (noop) return;
      }
    }

    /*
     * A lost body rename is accepted only when the body already there hashes to
     * the same value — which is the definition of the same object at this key, and
     * is the only thing that makes a concurrent write of one retrieval safe.
     */
    await this.atomicWrite(bodyPath, bytes, (existing) => contentHash(existing) === offeredSha);

    /*
     * THE SIDECAR IS THE COMMIT POINT and is written second. A crash between the
     * two leaves an orphan body that `head`, `get` and `list` all treat as absent
     * — garbage rather than a half-declared artifact.
     */
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
        ? /*
           * NO acceptance for a rebuilt index. Two rebuilds racing one manifest
           * genuinely disagree about its contents — accepting whichever landed
           * first would silently drop an artifact from the obligation's index,
           * and a replay reading it would find one fewer body than exists.
           */
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
    const sidecar = await this.readSidecar(key);
    return sidecar ? sidecar.meta : null;
  }

  /**
   * READ, AND PROVE THE BYTES ARE THE BYTES.
   *
   * The digest is recomputed on every read and compared with what the sidecar
   * recorded at write time. This is `fetchAssetFromRemote`'s discipline applied
   * where it costs even less: a store that verified only on the way in would
   * still hand back a body a bad sector had rewritten, and a parse of the wrong
   * bytes is a false claim about a government that nothing downstream can detect.
   *
   * A body with no sidecar is an INCOMPLETE WRITE, and it returns `null` — the
   * object was never committed. A sidecar with no body is a failed read and says
   * so, because something did commit and the body is gone.
   */
  async get(key: string): Promise<StoredObject | null> {
    if (this.restricted) {
      const fromProvider = await this.restricted.get(key);
      if (fromProvider) return fromProvider;
    }

    const sidecar = await this.readSidecar(key);
    if (!sidecar) return null;

    const bodyPath = this.bodyPath(key);
    let bytes: Buffer;
    try {
      bytes = await readFile(bodyPath);
    } catch (cause) {
      throw new EvidenceStoreRefusal(
        `Key ${key} has committed metadata recording ${sidecar.bodyBytes} byte(s) and its ` +
          `body could not be read (${(cause as NodeJS.ErrnoException).code ?? "unknown"}). ` +
          "A missing body under a committed sidecar is a failed read, never an empty document.",
      );
    }

    const actual = contentHash(bytes);
    if (actual !== sidecar.bodySha256) {
      throw new EvidenceCorrupted(key, sidecar.bodySha256, actual, bytes.byteLength);
    }

    return { key, bytes: new Uint8Array(bytes), meta: sidecar.meta };
  }

  /**
   * Keys under a prefix, in lexicographic order.
   *
   * Only COMMITTED objects are listed: the walk enumerates sidecars and derives
   * the key from each, so an orphan body from an interrupted write is invisible
   * and a temp file is never mistaken for evidence. Sorted, so a test asserting
   * key order asserts the design rather than the order a directory happened to be
   * read in — which differs between filesystems.
   */
  async list(prefix: string): Promise<string[]> {
    const keys = await this.walk(this.root, "");
    if (this.restricted) keys.push(...(await this.restricted.list(prefix)));
    return [...new Set(keys.filter((k) => k.startsWith(prefix)))].sort();
  }

  private async walk(directory: string, keyPrefix: string): Promise<string[]> {
    let entries: Dirent[];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (cause) {
      // An absent root is an EMPTY store, which is a true statement about a store
      // nothing has been written to yet. Every other errno is a failed read and
      // is thrown, because "this store cannot answer" is never "there is nothing".
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }

    const found: string[] = [];
    for (const entry of entries) {
      const name = entry.name;
      if (name.startsWith(TEMP_PREFIX)) continue;
      const childKey = keyPrefix ? `${keyPrefix}/${name}` : name;
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
 * AN IN-MEMORY `RestrictedEvidenceProvider`, FOR TESTS AND FOR NOTHING ELSE.
 *
 * It exists so the SEAM can be exercised — that a `RESTRICTED_RAW` body routes to
 * the provider and never touches the filesystem root — without pretending the
 * project has an encrypted substrate. Its declarations are constructor
 * parameters, so a test can also assert the refusal a provider that declares
 * `encryptedAtRest: false` receives.
 *
 * `durable` is deliberately absent: this is not durability and must never satisfy
 * `assertDurable` on its own.
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
