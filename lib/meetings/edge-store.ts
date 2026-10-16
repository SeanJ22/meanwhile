import { createHash, randomUUID } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReaderAuthorityManifest, ReaderGeoArtifact, ReaderManifest } from "./edge-artifacts.ts";

export const READER_ARTIFACT_STORE_NAME = "reader-artifacts";
export const READER_MANIFEST_KEY = "reader/manifest.json";
const READER_AUTHORITY_MANIFEST_KEY = "reader/authority-manifest.json";

export interface StoredManifest {
  readonly manifest: ReaderManifest;
  /** ETag to pin the next monotonic write to; null when the manifest is absent. */
  readonly etag: string | null;
}

interface StoredAuthorityManifest {
  readonly manifest: ReaderAuthorityManifest;
  readonly etag: string | null;
}

export interface ReaderArtifactStore {
  readonly kind: "netlify-blobs" | "local-file";
  readManifest(): Promise<StoredManifest | null>;
  readAuthorityManifest(): Promise<StoredAuthorityManifest | null>;
  readArtifact(key: string): Promise<ReaderGeoArtifact | null>;
  /** Store complete bytes once, under their digest; never overwrite a serving artifact. */
  putImmutable(bytes: Uint8Array, suffix: "json" | "json.gz"): Promise<string>;
  /** Compare-and-set against `expectedEtag` (null = expect absent); modified:false when the stored ETag moved. */
  writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }>;
  writeAuthorityManifest(
    manifest: ReaderAuthorityManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }>;
  readBytes(key: string): Promise<Uint8Array | null>;
}

function immutableKey(bytes: Uint8Array, suffix: "json" | "json.gz"): string {
  return `reader/artifacts/${createHash("sha256").update(bytes).digest("hex")}.${suffix}`;
}

function sameBytes(actual: Uint8Array | null, expected: Uint8Array): void {
  if (actual === null || !Buffer.from(actual).equals(Buffer.from(expected))) throw new Error("READER_IMMUTABLE_ARTIFACT_CONFLICT");
}

interface NetlifyBlobsOptions {
  readonly siteID?: string;
  readonly token?: string;
}

export class NetlifyBlobsArtifactStore implements ReaderArtifactStore {
  readonly kind = "netlify-blobs" as const;
  private readonly options: NetlifyBlobsOptions;

  constructor(options: NetlifyBlobsOptions = {}) {
    this.options = options;
  }

  private async store(consistency: "strong" | "eventual") {
    // Imported lazily so the local/test path never loads the Netlify client.
    const { getStore } = await import("@netlify/blobs");
    const base = { name: READER_ARTIFACT_STORE_NAME, consistency } as const;
    return this.options.siteID && this.options.token
      ? getStore({ ...base, siteID: this.options.siteID, token: this.options.token })
      : getStore(base);
  }

  async readManifest(): Promise<StoredManifest | null> {
    return this.readManifestAt<ReaderManifest>(READER_MANIFEST_KEY);
  }

  async readAuthorityManifest(): Promise<StoredAuthorityManifest | null> {
    return this.readManifestAt<ReaderAuthorityManifest>(READER_AUTHORITY_MANIFEST_KEY);
  }

  private async readManifestAt<T>(key: string): Promise<{ manifest: T; etag: string | null } | null> {
    const store = await this.store("eventual");
    const res = await store.getWithMetadata(key, { type: "json" });
    if (!res || res.data == null) return null;
    return { manifest: res.data as T, etag: res.etag ?? null };
  }

  async readArtifact(key: string): Promise<ReaderGeoArtifact | null> {
    const store = await this.store("eventual");
    const data = await store.get(key, { type: "json" });
    return (data as ReaderGeoArtifact | null) ?? null;
  }

  async writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    return this.writeManifestAt(READER_MANIFEST_KEY, manifest, expectedEtag);
  }

  async writeAuthorityManifest(
    manifest: ReaderAuthorityManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    return this.writeManifestAt(READER_AUTHORITY_MANIFEST_KEY, manifest, expectedEtag);
  }

  private async writeManifestAt(
    key: string,
    manifest: ReaderManifest | ReaderAuthorityManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    const store = await this.store("strong");
    const result = await store.setJSON(
      key,
      manifest,
      expectedEtag === null ? { onlyIfNew: true } : { onlyIfMatch: expectedEtag },
    );
    return { modified: result.modified, etag: result.etag ?? null };
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    const store = await this.store("eventual");
    const buf = (await store.get(key, { type: "arrayBuffer" })) as ArrayBuffer | null;
    return buf ? new Uint8Array(buf) : null;
  }

  async putImmutable(bytes: Uint8Array, suffix: "json" | "json.gz"): Promise<string> {
    const key = immutableKey(bytes, suffix);
    const store = await this.store("strong");
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const result = await store.set(key, buffer, { onlyIfNew: true });
    if (!result.modified) {
      const held = await store.get(key, { type: "arrayBuffer" });
      sameBytes(held === null ? null : new Uint8Array(held), bytes);
    }
    return key;
  }
}

export class LocalFileArtifactStore implements ReaderArtifactStore {
  readonly kind = "local-file" as const;
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  private path(key: string): string {
    return join(this.root, key);
  }

  private etagOf(path: string): string {
    return createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
  }

  async readManifest(): Promise<StoredManifest | null> {
    return this.readManifestAt<ReaderManifest>(READER_MANIFEST_KEY);
  }

  async readAuthorityManifest(): Promise<StoredAuthorityManifest | null> {
    return this.readManifestAt<ReaderAuthorityManifest>(READER_AUTHORITY_MANIFEST_KEY);
  }

  private async readManifestAt<T>(key: string): Promise<{ manifest: T; etag: string | null } | null> {
    const path = this.path(key);
    try {
      const bytes = readFileSync(path);
      const manifest = JSON.parse(bytes.toString("utf8")) as T;
      return { manifest, etag: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readArtifact(key: string): Promise<ReaderGeoArtifact | null> {
    try {
      return JSON.parse(readFileSync(this.path(key), "utf8")) as ReaderGeoArtifact;
    } catch {
      return null;
    }
  }

  async writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    return this.writeManifestAt(READER_MANIFEST_KEY, manifest, expectedEtag);
  }

  async writeAuthorityManifest(
    manifest: ReaderAuthorityManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    return this.writeManifestAt(READER_AUTHORITY_MANIFEST_KEY, manifest, expectedEtag);
  }

  private async writeManifestAt(
    key: string,
    manifest: ReaderManifest | ReaderAuthorityManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    const lock = `${path}.lock`;
    let descriptor: number | undefined;
    for (let attempt = 0; attempt < 200; attempt++) {
      try { descriptor = openSync(lock, "wx"); writeFileSync(descriptor, String(process.pid)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        try {
          const pid = Number(readFileSync(lock, "utf8"));
          if (Number.isSafeInteger(pid) && pid > 0) {
            try { process.kill(pid, 0); }
            catch (held) { if ((held as NodeJS.ErrnoException).code === "ESRCH") unlinkSync(lock); }
          }
        } catch { /* Another writer may already have released the lock. */ }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    }
    if (descriptor === undefined) throw new Error("READER_MANIFEST_BUSY");
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      let etag: string | null;
      try { etag = this.etagOf(path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; etag = null; }
      if (etag !== expectedEtag) return { modified: false, etag };
      writeFileSync(temporary, JSON.stringify(manifest), { flag: "wx" });
      renameSync(temporary, path);
      return { modified: true, etag: this.etagOf(path) };
    } finally {
      closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* The atomic rename consumed it. */ }
      unlinkSync(lock);
    }
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(readFileSync(this.path(key)));
    } catch {
      return null;
    }
  }

  async putImmutable(bytes: Uint8Array, suffix: "json" | "json.gz"): Promise<string> {
    const key = immutableKey(bytes, suffix);
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, bytes, { flag: "wx" });
    try {
      try { linkSync(temporary, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        sameBytes(new Uint8Array(readFileSync(path)), bytes);
      }
    } finally { unlinkSync(temporary); }
    return key;
  }
}

export function resolveReaderArtifactStore(): ReaderArtifactStore | null {
  const localDir = process.env.WTP_READER_EDGE_DIR?.trim();
  if (localDir) return new LocalFileArtifactStore(localDir);
  // On Netlify the reader gets credentials automatically; off Netlify with no
  // local dir there is no reader store, and the caller falls back to the DB.
  if (process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT || process.env.NETLIFY_SITE_ID) {
    return new NetlifyBlobsArtifactStore();
  }
  return null;
}

export function resolveReaderArtifactWriteStore(): ReaderArtifactStore | null {
  const localDir = process.env.WTP_READER_EDGE_DIR?.trim();
  if (localDir) return new LocalFileArtifactStore(localDir);
  const siteID = process.env.NETLIFY_SITE_ID?.trim() || process.env.NETLIFY_BLOBS_SITE_ID?.trim();
  const token = process.env.NETLIFY_BLOBS_TOKEN?.trim() || process.env.NETLIFY_API_TOKEN?.trim();
  if (siteID && token) return new NetlifyBlobsArtifactStore({ siteID, token });
  return null;
}
