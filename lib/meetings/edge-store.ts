import { createHash, randomUUID } from "node:crypto";
import { closeSync, linkSync, mkdirSync, openSync, readFileSync, readSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { ReaderGeoArtifact, ReaderManifest } from "./edge-artifacts.ts";

export const READER_ARTIFACT_STORE_NAME = "reader-artifacts";
export const READER_MANIFEST_KEY = "reader/manifest.json";

export interface StoredManifest {
  readonly manifest: ReaderManifest;
  /** ETag to pin the next monotonic write to; null when the manifest is absent. */
  readonly etag: string | null;
}

export interface ReaderPublicationIdentity {
  readonly fingerprint: string;
  readonly sequence: number;
}

function publicationIdentity(fingerprint: unknown, sequence: unknown): ReaderPublicationIdentity | null {
  return typeof fingerprint === "string" && /^[a-f0-9]{64}$/.test(fingerprint) &&
    typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0
    ? { fingerprint, sequence } : null;
}

export interface ReaderArtifactStore {
  readonly kind: "netlify-blobs" | "local-file";
  readonly state?: string;
  readManifest(state?: string): Promise<StoredManifest | null>;
  readPublicationIdentity(state?: string): Promise<ReaderPublicationIdentity | null>;
  readArtifact(key: string): Promise<ReaderGeoArtifact | null>;
  /** Store complete bytes once, under their digest; never overwrite a serving artifact. */
  putImmutable(bytes: Uint8Array, suffix: "json" | "json.gz"): Promise<string>;
  /** Compare-and-set against `expectedEtag` (null = expect absent); modified:false when the stored ETag moved. */
  writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
    state?: string,
  ): Promise<{ modified: boolean; etag: string | null }>;
  readBytes(key: string): Promise<Uint8Array | null>;
  readMeetingState(id: string): Promise<string | null>;
  writeMeetingStates(ids: readonly string[], state: string): Promise<void>;
}

export function readerManifestKey(state?: string): string {
  if (state === undefined) return READER_MANIFEST_KEY;
  const selected = state.replace(/^US-/i, "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(selected)) throw new Error("READER_STATE_INVALID");
  return `reader/states/${selected}/manifest.json`;
}

const meetingStateKey = (id: string): string => `reader/meeting-states/${createHash("sha256").update(id).digest("hex")}.json`;

export function scopedReaderArtifactStore(base: ReaderArtifactStore, state: string): ReaderArtifactStore {
  readerManifestKey(state);
  const selected = state.replace(/^US-/i, "").toUpperCase();
  return {
    kind: base.kind, state: selected,
    readManifest: (requested = selected) => base.readManifest(requested),
    readPublicationIdentity: (requested = selected) => base.readPublicationIdentity(requested),
    writeManifest: (manifest,etag) => base.writeManifest(manifest,etag,selected),
    readArtifact: key => base.readArtifact(key), putImmutable: (bytes,suffix) => base.putImmutable(bytes,suffix),
    readBytes: key => base.readBytes(key), readMeetingState: id => base.readMeetingState(id),
    writeMeetingStates: (ids,scope) => base.writeMeetingStates(ids,scope),
  };
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

  async readManifest(state?: string): Promise<StoredManifest | null> {
    // Eventual consistency is correct for the reader: the CDN layer, not this
    // read, is the reader's hot path, and a <=60s-stale pointer is honest.
    const store = await this.store("eventual");
    const res = await store.getWithMetadata(readerManifestKey(state), { type: "json" });
    if (!res || res.data == null) return null;
    return { manifest: res.data as ReaderManifest, etag: res.etag ?? null };
  }

  async readPublicationIdentity(state?: string): Promise<ReaderPublicationIdentity | null> {
    const store = await this.store("strong");
    const held = await store.getMetadata(readerManifestKey(state));
    return publicationIdentity(held?.metadata.publicationFingerprint, held?.metadata.publicationSequence);
  }

  async readArtifact(key: string): Promise<ReaderGeoArtifact | null> {
    const store = await this.store("eventual");
    const data = await store.get(key, { type: "json" });
    return (data as ReaderGeoArtifact | null) ?? null;
  }

  async writeManifest(
    manifest: ReaderManifest,
    expectedEtag: string | null,
    state?: string,
  ): Promise<{ modified: boolean; etag: string | null }> {
    // Strong consistency so the read-before-write and the CAS see the truth.
    const store = await this.store("strong");
    const result = await store.setJSON(
      readerManifestKey(state),
      manifest,
      { ...(expectedEtag === null ? { onlyIfNew: true } : { onlyIfMatch: expectedEtag }),
        metadata: { ...(manifest.publicationFingerprint ? { publicationFingerprint: manifest.publicationFingerprint } : {}),
          publicationSequence: manifest.sequence } },
    );
    return { modified: result.modified, etag: result.etag ?? null };
  }

  async readMeetingState(id: string): Promise<string | null> {
    const store = await this.store("eventual");
    const row = await store.get(meetingStateKey(id), { type: "json" }) as { state?: string } | null;
    return row?.state && /^[A-Z]{2}$/.test(row.state) ? row.state : null;
  }

  async writeMeetingStates(ids: readonly string[], state: string): Promise<void> {
    readerManifestKey(state);
    const store = await this.store("strong");
    for (let offset = 0; offset < ids.length; offset += 16) await Promise.all(ids.slice(offset,offset+16)
      .map(id => store.setJSON(meetingStateKey(id), { state: state.replace(/^US-/i, "").toUpperCase() })));
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

  async readManifest(state?: string): Promise<StoredManifest | null> {
    const path = this.path(readerManifestKey(state));
    try {
      const bytes = readFileSync(path);
      const manifest = JSON.parse(bytes.toString("utf8")) as ReaderManifest;
      return { manifest, etag: createHash("sha256").update(bytes).digest("hex").slice(0, 16) };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async readPublicationIdentity(state?: string): Promise<ReaderPublicationIdentity | null> {
    let descriptor: number | undefined;
    try {
      descriptor = openSync(this.path(readerManifestKey(state)), "r");
      const bytes = Buffer.alloc(256);
      const length = readSync(descriptor, bytes, 0, bytes.length, 0);
      const header = /^\{"publicationFingerprint":"([a-f0-9]{64})","sequence":(\d+)(?:,|\})/.exec(bytes.toString("utf8", 0, length));
      return header ? publicationIdentity(header[1], Number(header[2])) : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    } finally { if (descriptor !== undefined) closeSync(descriptor); }
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
    state?: string,
  ): Promise<{ modified: boolean; etag: string | null }> {
    const path = this.path(readerManifestKey(state));
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
      // A bounded header read answers publication checks without loading meeting IDs.
      const { publicationFingerprint, sequence, ...contents } = manifest;
      writeFileSync(temporary, JSON.stringify({ publicationFingerprint, sequence, ...contents }), { flag: "wx" });
      renameSync(temporary, path);
      return { modified: true, etag: this.etagOf(path) };
    } finally {
      closeSync(descriptor);
      try { unlinkSync(temporary); } catch { /* The atomic rename consumed it. */ }
      unlinkSync(lock);
    }
  }

  async readMeetingState(id: string): Promise<string | null> {
    try {
      const row = JSON.parse(readFileSync(this.path(meetingStateKey(id)),"utf8")) as { state?: string };
      return row.state && /^[A-Z]{2}$/.test(row.state) ? row.state : null;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
  }

  async writeMeetingStates(ids: readonly string[], state: string): Promise<void> {
    readerManifestKey(state);
    for (const id of ids) {
      const path = this.path(meetingStateKey(id)), temporary = `${path}.${randomUUID()}.tmp`;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(temporary,JSON.stringify({ state: state.replace(/^US-/i, "").toUpperCase() }),{ flag: "wx" });
      renameSync(temporary,path);
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
