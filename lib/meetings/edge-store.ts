import { createHash, randomUUID } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReaderAuthorityManifest, ReaderGeoArtifact, ReaderManifest } from "./edge-artifacts.ts";
import { immutableKey, sameBytes, NetlifyBlobsArtifactStore, READER_MANIFEST_KEY, READER_AUTHORITY_MANIFEST_KEY, resolveReaderBlobWriteStore } from "./edge-blob-store.ts";

export interface StoredManifest {
  readonly manifest: ReaderManifest;
  /** ETag to pin the next monotonic write to; null when the manifest is absent. */
  readonly etag: string | null;
}

export interface StoredAuthorityManifest {
  readonly manifest: ReaderAuthorityManifest;
  readonly etag: string | null;
}

export interface ReaderArtifactStore {
  readonly kind: "netlify-blobs" | "local-file";
  readManifest(key?: string): Promise<StoredManifest | null>;
  readAuthorityManifest(): Promise<StoredAuthorityManifest | null>;
  readArtifact(key: string): Promise<ReaderGeoArtifact | null>;
  /** Store complete bytes once, under their digest; never overwrite a serving artifact. */
  putImmutable(bytes: Uint8Array, suffix: "json" | "json.gz"): Promise<string>;
  /** Compare-and-set against `expectedEtag` (null = expect absent); modified:false when the stored ETag moved. */
  writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
    key?: string,
  ): Promise<{ modified: boolean; etag: string | null }>;
  writeAuthorityManifest(manifest: ReaderAuthorityManifest, expectedEtag: string | null): Promise<{ modified: boolean; etag: string | null }>;
  readBytes(key: string): Promise<Uint8Array | null>;
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

  async readManifest(key: string = READER_MANIFEST_KEY): Promise<StoredManifest | null> {
    return this.readManifestAt<ReaderManifest>(key);
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
    key: string = READER_MANIFEST_KEY,
  ): Promise<{ modified: boolean; etag: string | null }> {
    return this.writeManifestAt(key, manifest, expectedEtag);
  }

  async writeAuthorityManifest(manifest: ReaderAuthorityManifest, expectedEtag: string | null) {
    return this.writeManifestAt(READER_AUTHORITY_MANIFEST_KEY, manifest, expectedEtag);
  }

  private async writeManifestAt(key: string, manifest: ReaderManifest | ReaderAuthorityManifest, expectedEtag: string | null) {
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
  return resolveReaderBlobWriteStore();
}
