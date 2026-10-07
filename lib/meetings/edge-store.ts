import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReaderGeoArtifact, ReaderManifest } from "./edge-artifacts.ts";

export const READER_ARTIFACT_STORE_NAME = "reader-artifacts";
export const READER_MANIFEST_KEY = "reader/manifest.json";

export interface StoredManifest {
  readonly manifest: ReaderManifest;
  /** ETag to pin the next monotonic write to; null when the manifest is absent. */
  readonly etag: string | null;
}

export interface ReaderArtifactStore {
  readonly kind: "netlify-blobs" | "local-file";
  readManifest(): Promise<StoredManifest | null>;
  readArtifact(key: string): Promise<ReaderGeoArtifact | null>;
  writeArtifact(key: string, artifact: ReaderGeoArtifact): Promise<void>;
  /** Compare-and-set against `expectedEtag` (null = expect absent); modified:false when the stored ETag moved. */
  writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }>;
  readBytes(key: string): Promise<Uint8Array | null>;
  writeBytes(key: string, bytes: Uint8Array): Promise<void>;
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
    // Eventual consistency is correct for the reader: the CDN layer, not this
    // read, is the reader's hot path, and a <=60s-stale pointer is honest.
    const store = await this.store("eventual");
    const res = await store.getWithMetadata(READER_MANIFEST_KEY, { type: "json" });
    if (!res || res.data == null) return null;
    return { manifest: res.data as ReaderManifest, etag: res.etag ?? null };
  }

  async readArtifact(key: string): Promise<ReaderGeoArtifact | null> {
    const store = await this.store("eventual");
    const data = await store.get(key, { type: "json" });
    return (data as ReaderGeoArtifact | null) ?? null;
  }

  async writeArtifact(key: string, artifact: ReaderGeoArtifact): Promise<void> {
    // Content-addressed by sequence → immutable; a plain set is safe.
    const store = await this.store("strong");
    await store.setJSON(key, artifact);
  }

  async writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    // Strong consistency so the read-before-write and the CAS see the truth.
    const store = await this.store("strong");
    const result = await store.setJSON(
      READER_MANIFEST_KEY,
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

  async writeBytes(key: string, bytes: Uint8Array): Promise<void> {
    const store = await this.store("strong");
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    await store.set(key, buffer);
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
    const path = this.path(READER_MANIFEST_KEY);
    try {
      const manifest = JSON.parse(readFileSync(path, "utf8")) as ReaderManifest;
      return { manifest, etag: this.etagOf(path) };
    } catch {
      return null;
    }
  }

  async readArtifact(key: string): Promise<ReaderGeoArtifact | null> {
    try {
      return JSON.parse(readFileSync(this.path(key), "utf8")) as ReaderGeoArtifact;
    } catch {
      return null;
    }
  }

  async writeArtifact(key: string, artifact: ReaderGeoArtifact): Promise<void> {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(artifact));
  }

  async writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
  ): Promise<{ modified: boolean; etag: string | null }> {
    const path = this.path(READER_MANIFEST_KEY);
    const current = await this.readManifest();
    // Emulate the CAS the Blobs store enforces natively.
    if ((current?.etag ?? null) !== expectedEtag) return { modified: false, etag: current?.etag ?? null };
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(manifest));
    return { modified: true, etag: this.etagOf(path) };
  }

  async readBytes(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(readFileSync(this.path(key)));
    } catch {
      return null;
    }
  }

  async writeBytes(key: string, bytes: Uint8Array): Promise<void> {
    const path = this.path(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
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
