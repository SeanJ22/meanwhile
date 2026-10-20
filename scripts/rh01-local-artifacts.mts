/** Disposable artifacts for read-only runner measurements; no publication backend is reachable here. */
import { AsyncLocalStorage } from "node:async_hooks";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, lstat, mkdir, open, opendir, readFile, realpath, rm } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { RestrictedEvidenceProvider } from "../lib/control-plane/evidence/durable-store.ts";
import type { EvidenceRole, ObjectMeta, StoredObject } from "../lib/control-plane/evidence/store.ts";

const custody = new AsyncLocalStorage<EvidenceRole>();
const magic = Buffer.from("RH01R001");
const suffix = ".rh01-restricted";
interface Envelope { readonly key: string; readonly meta: ObjectMeta; readonly nonce: string; readonly tag: string; readonly mac: string }
interface NativeEvidenceRules {
  readonly keyToRelativePath: (key: string) => string;
  readonly reconcileExistingObject: (key: string, bytes: Uint8Array, meta: ObjectMeta, existing: Pick<StoredObject, "meta">) => boolean;
}
const digest = (bytes: Uint8Array) => `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
const envelopeMac = (key: Uint8Array, header: Envelope) => createHmac("sha256", key)
  .update(JSON.stringify({ key: header.key, meta: header.meta, nonce: header.nonce, tag: header.tag })).digest();
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export async function prepareMeasurementArtifacts(directory: string): Promise<Record<string, string>> {
  const root = await realpath(directory), restricted = join(root, "private-restricted-evidence");
  await mkdir(restricted, { mode: 0o700 });
  const key = await open(join(restricted, "key"), "wx", 0o600);
  try { await key.writeFile(randomBytes(32)); } finally { await key.close(); }
  await mkdir(join(restricted, "objects"), { mode: 0o700 });
  return { WTP_READER_EDGE_DIR: join(root, "reader-edge"), WTP_RH01_RESTRICTED_EVIDENCE_DIRECTORY: restricted };
}

/** Only native artifact custody operations grant a body-read identity; ordinary store reads carry none. */
export function withRestrictedMeasurementCustody<T>(role: EvidenceRole, work: () => Promise<T>): Promise<T> {
  return custody.run(role, work);
}

class PrivateRestrictedEvidence implements RestrictedEvidenceProvider {
  readonly providerId = "rh01-private-local-aes256gcm";
  readonly encryptedAtRest = true;
  readonly accessControlled = true;
  constructor(private readonly directory: string, private readonly rules: NativeEvidenceRules) {}

  private async key(): Promise<Buffer> {
    const directory = await lstat(this.directory), path = join(this.directory, "key"), metadata = await lstat(path);
    if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077) !== 0 ||
      !metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0 ||
      (process.getuid && (directory.uid !== process.getuid() || metadata.uid !== process.getuid())))
      throw Error("RH01_RESTRICTED_PRIVATE_CUSTODY_REQUIRED");
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try { const key = await file.readFile(); if (key.byteLength !== 32) throw Error("RH01_RESTRICTED_KEY_INVALID"); return key; }
    finally { await file.close(); }
  }

  private path(key: string): string {
    const path = resolve(this.directory, "objects", this.rules.keyToRelativePath(key) + suffix);
    if (!path.startsWith(join(this.directory, "objects") + sep)) throw Error("RH01_RESTRICTED_KEY_ESCAPED");
    return path;
  }

  private async envelope(key: string): Promise<{ header: Envelope; offset: number } | null> {
    let file;
    try { file = await open(this.path(key), constants.O_RDONLY | constants.O_NOFOLLOW); }
    catch (error) { if (missing(error)) return null; throw error; }
    try {
      const prefix = Buffer.alloc(magic.byteLength + 4);
      if ((await file.read(prefix, 0, prefix.byteLength, 0)).bytesRead !== prefix.byteLength ||
        !prefix.subarray(0, magic.byteLength).equals(magic)) throw Error("RH01_RESTRICTED_ENVELOPE_INVALID");
      const length = prefix.readUInt32BE(magic.byteLength);
      if (!length || length > 64 * 1024) throw Error("RH01_RESTRICTED_ENVELOPE_INVALID");
      const bytes = Buffer.alloc(length);
      if ((await file.read(bytes, 0, length, prefix.byteLength)).bytesRead !== length) throw Error("RH01_RESTRICTED_ENVELOPE_INVALID");
      const header = JSON.parse(bytes.toString("utf8")) as Envelope;
      if (header.key !== key || header.meta?.custom?.tier !== "RESTRICTED_RAW" ||
        !/^[a-f0-9]{24}$/.test(header.nonce) || !/^[a-f0-9]{32}$/.test(header.tag) || !/^[a-f0-9]{64}$/.test(header.mac)) throw Error("RH01_RESTRICTED_ENVELOPE_INVALID");
      const encryptionKey = await this.key();
      try { if (!timingSafeEqual(envelopeMac(encryptionKey, header), Buffer.from(header.mac, "hex"))) throw Error("RH01_RESTRICTED_METADATA_CORRUPT"); }
      finally { encryptionKey.fill(0); }
      return { header, offset: prefix.byteLength + length };
    } finally { await file.close(); }
  }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    if (meta.custom?.tier !== "RESTRICTED_RAW" || (meta.objectClass ?? "IMMUTABLE_BODY") !== "IMMUTABLE_BODY" ||
      bytes.byteLength !== meta.byteLength || digest(bytes) !== meta.contentHash) throw Error("RH01_RESTRICTED_OBJECT_INVALID");
    const existing = await this.get(key);
    if (existing) { this.rules.reconcileExistingObject(key, bytes, meta, existing); return; }
    const encryptionKey = await this.key(), nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify({ key, meta })));
    const encrypted = cipher.update(bytes), final = cipher.final();
    const envelope: Envelope = { key, meta, nonce: nonce.toString("hex"), tag: cipher.getAuthTag().toString("hex"), mac: "" };
    const header = Buffer.from(JSON.stringify({ ...envelope, mac: envelopeMac(encryptionKey, envelope).toString("hex") }));
    encryptionKey.fill(0);
    const prefix = Buffer.alloc(magic.byteLength + 4); magic.copy(prefix); prefix.writeUInt32BE(header.byteLength, magic.byteLength);
    const path = this.path(key), directory = dirname(path), temporary = path + `.${randomBytes(12).toString("hex")}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await chmod(directory, 0o700);
    try {
      const file = await open(temporary, "wx", 0o600);
      try { await file.writeFile(prefix); await file.writeFile(header); await file.writeFile(encrypted); await file.writeFile(final); }
      finally { await file.close(); }
      try { await link(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const raced = await this.get(key);
        if (!raced) throw Error("RH01_RESTRICTED_COMMIT_MISSING");
        this.rules.reconcileExistingObject(key, bytes, meta, raced);
      }
    } finally { await rm(temporary, { force: true }); }
  }

  async get(key: string): Promise<StoredObject | null> {
    const envelope = await this.envelope(key); if (!envelope) return null;
    if (!["ACQUIRER", "AUDITOR"].includes(custody.getStore() ?? "")) throw Error("RH01_RESTRICTED_BODY_IDENTITY_REQUIRED");
    const encryptionKey = await this.key(), { header, offset } = envelope;
    const saved = await readFile(this.path(key)), decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(header.nonce, "hex"));
    decipher.setAAD(Buffer.from(JSON.stringify({ key, meta: header.meta })));
    decipher.setAuthTag(Buffer.from(header.tag, "hex"));
    let bytes: Buffer;
    try { bytes = Buffer.concat([decipher.update(saved.subarray(offset)), decipher.final()]); }
    finally { encryptionKey.fill(0); }
    if (bytes.byteLength !== header.meta.byteLength || digest(bytes) !== header.meta.contentHash) throw Error("RH01_RESTRICTED_BODY_CORRUPT");
    return { key, bytes, meta: header.meta };
  }

  async stream(key: string): Promise<AsyncIterable<Uint8Array> | null> {
    const object = await this.get(key); if (!object) return null;
    return (async function* () { yield object.bytes; })();
  }
  async head(key: string): Promise<ObjectMeta | null> { return (await this.envelope(key))?.header.meta ?? null; }
  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const walk = async (directory: string, parent: string): Promise<void> => {
      let entries;
      try { entries = await opendir(directory); } catch (error) { if (missing(error)) return; throw error; }
      for await (const entry of entries) {
        const key = parent ? `${parent}/${decodeURIComponent(entry.name)}` : decodeURIComponent(entry.name);
        if (entry.isDirectory()) { if (prefix.startsWith(key + "/") || key.startsWith(prefix)) await walk(join(directory, entry.name), key); }
        else if (entry.isFile() && entry.name.endsWith(suffix)) {
          const actual = key.slice(0, -suffix.length);
          if (actual.startsWith(prefix) && await this.envelope(actual)) keys.push(actual);
        }
      }
    };
    await walk(join(this.directory, "objects"), ""); return keys.sort();
  }
}

export function restrictedMeasurementProvider(rules: NativeEvidenceRules): RestrictedEvidenceProvider | undefined {
  const directory = process.env.WTP_RH01_RESTRICTED_EVIDENCE_DIRECTORY;
  return directory ? new PrivateRestrictedEvidence(resolve(directory), rules) : undefined;
}
