import { createHash } from "node:crypto";
import type { ReaderAuthorityManifest, ReaderGeoArtifact, ReaderManifest } from "./edge-artifacts.ts";
import type { ReaderArtifactStore, StoredAuthorityManifest, StoredManifest } from "./edge-store.ts";

export const READER_ARTIFACT_STORE_NAME = "reader-artifacts";
export const READER_MANIFEST_KEY = "reader/manifest.json";
export const READER_AUTHORITY_MANIFEST_KEY = "reader/authority-manifest.json";

export function immutableKey(bytes: Uint8Array, suffix: "json" | "json.gz"): string {
  return `reader/artifacts/${createHash("sha256").update(bytes).digest("hex")}.${suffix}`;
}

export function sameBytes(actual: Uint8Array | null, expected: Uint8Array): void {
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

  async readManifest(key: string = READER_MANIFEST_KEY): Promise<StoredManifest | null> {
    return this.readManifestAt<ReaderManifest>(key);
  }

  async readAuthorityManifest(): Promise<StoredAuthorityManifest | null> {
    return this.readManifestAt<ReaderAuthorityManifest>(READER_AUTHORITY_MANIFEST_KEY);
  }

  private async readManifestAt<T>(key: string): Promise<{ manifest: T; etag: string | null } | null> {
    // Eventual consistency is correct for the reader: the CDN layer, not this
    // read, is the reader's hot path, and a <=60s-stale pointer is honest.
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
    key: string = READER_MANIFEST_KEY,
  ): Promise<{ modified: boolean; etag: string | null }> {
    return this.writeManifestAt(key, manifest, expectedEtag);
  }

  async writeAuthorityManifest(manifest: ReaderAuthorityManifest, expectedEtag: string | null) {
    return this.writeManifestAt(READER_AUTHORITY_MANIFEST_KEY, manifest, expectedEtag);
  }

  private async writeManifestAt(key: string, manifest: ReaderManifest | ReaderAuthorityManifest, expectedEtag: string | null) {
    // Strong consistency so the read-before-write and the CAS see the truth.
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

export function resolveReaderBlobWriteStore(): ReaderArtifactStore | null {
  const siteID = process.env.NETLIFY_SITE_ID?.trim() || process.env.NETLIFY_BLOBS_SITE_ID?.trim();
  const token = process.env.NETLIFY_BLOBS_TOKEN?.trim() || process.env.NETLIFY_API_TOKEN?.trim();
  return siteID && token ? new NetlifyBlobsArtifactStore({ siteID, token }) : null;
}

export async function purgeReaderCacheTags(
  tags: readonly string[],
): Promise<{ readonly purged: boolean; readonly detail?: string }> {
  const siteID = process.env.NETLIFY_SITE_ID?.trim() || process.env.NETLIFY_BLOBS_SITE_ID?.trim();
  const token = process.env.NETLIFY_API_TOKEN?.trim() || process.env.NETLIFY_BLOBS_TOKEN?.trim();
  if (!siteID || !token || tags.length === 0) return { purged: false, detail: "no purge credentials or tags" };
  try {
    const res = await fetch("https://api.netlify.com/api/v1/purge", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ site_id: siteID, cache_tags: [...tags] }),
    });
    return res.ok ? { purged: true } : { purged: false, detail: `purge HTTP ${res.status}` };
  } catch (error) {
    return { purged: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export const READER_MANIFEST_CACHE_TAG = "reader-manifest";
