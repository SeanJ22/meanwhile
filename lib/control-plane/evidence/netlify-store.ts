import { getStore, type Store } from "@netlify/blobs";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { contentHash } from "../ids.ts";
import { EvidenceStoreRefusal, objectClassOf, reconcileExistingObject, type EvidenceStore, type ObjectMeta, type StoredObject } from "./store.ts";

const ENVELOPE_FORMAT = "evidence-envelope@1";
export const VAULT_READ_TIMEOUT_MS = 20_000;

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  work.catch(()=>undefined);
  signal.throwIfAborted();
  let stop: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    stop = () => reject(signal.reason);
    signal.addEventListener("abort", stop, {once:true});
  });
  try { return await Promise.race([work, aborted]); }
  finally { if (stop) signal.removeEventListener("abort", stop); }
}

/** Read just the envelope's saved metadata, cancelling the page body behind it. */
async function envelopeMetadata(key: string, stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<Record<string, unknown>> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0, wanted = 4;
  try {
    while (received < wanted) {
      const next = await abortable(reader.read(), signal);
      if (next.done) throw new Error("truncated header");
      const bytes = next.value;
      chunks.push(bytes); received += bytes.length;
      if (wanted === 4 && received >= 4) {
        const prefix = new Uint8Array(4);
        let offset = 0;
        for (const chunk of chunks) { const take = Math.min(4-offset,chunk.length); prefix.set(chunk.subarray(0,take),offset); offset += take; if(offset===4)break; }
        wanted = 4 + new DataView(prefix.buffer).getUint32(0);
      }
    }
    const header = new Uint8Array(wanted);
    let offset = 0;
    for (const chunk of chunks) { const take = Math.min(wanted-offset,chunk.length); header.set(chunk.subarray(0,take),offset); offset += take; if(offset===wanted)break; }
    const metadata = JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(header.subarray(4))) as Record<string,unknown>;
    if(metadata===null || typeof metadata!=="object" || Array.isArray(metadata)) throw new Error("invalid header");
    return metadata;
  } catch (error) {
    if(signal.aborted) throw signal.reason;
    throw new EvidenceStoreRefusal(`Stored evidence envelope is unreadable at ${key}: ${error instanceof Error ? error.message : String(error)}`);
  } finally { void reader.cancel().catch(()=>undefined); reader.releaseLock(); }
}

/** Large metadata travels atomically with its bytes, outside Blobs' 2 KiB header. */
function encodeObject(bytes: Uint8Array, metadata: Record<string, unknown>) {
  const json = JSON.stringify(metadata);
  if ("netlify-blobs-metadata".length + 4 + Buffer.from(json).toString("base64").length <= 2 * 1024) {
    return { bytes, metadata };
  }
  const header = new TextEncoder().encode(json);
  const body = new Uint8Array(4 + header.length + bytes.length);
  new DataView(body.buffer).setUint32(0, header.length);
  body.set(header, 4);
  body.set(bytes, 4 + header.length);
  return { bytes: body, metadata: { format: ENVELOPE_FORMAT } };
}

function decodeObject(key: string, data: ArrayBuffer, metadata: Record<string, unknown>) {
  const bytes = new Uint8Array(data);
  if (metadata.format !== ENVELOPE_FORMAT) return { bytes, metadata };
  try {
    if (bytes.length < 4) throw new Error("missing header");
    const length = new DataView(data).getUint32(0);
    if (length > bytes.length - 4) throw new Error("truncated header");
    const header = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + length))) as Record<string, unknown>;
    if (header === null || typeof header !== "object" || Array.isArray(header)) throw new Error("invalid header");
    return { bytes: bytes.subarray(4 + length), metadata: header };
  } catch {
    throw new EvidenceStoreRefusal(`Stored evidence envelope is unreadable at ${key}`);
  }
}

/** The same evidence keys and metadata, held outside the runner's host. */
export class NetlifyEvidenceStore implements EvidenceStore {
  readonly durable = true;
  private readonly store: Store;
  private readonly requestSignals: AsyncLocalStorage<AbortSignal>;
  constructor(store: Store, requestSignals = new AsyncLocalStorage<AbortSignal>()) { this.store = store; this.requestSignals = requestSignals; }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    if (meta.custom?.tier === "RESTRICTED_RAW") throw new EvidenceStoreRefusal("RESTRICTED_RAW requires the existing restricted evidence provider");
    const bodySha256 = contentHash(bytes);
    if (bytes.byteLength !== meta.byteLength || objectClassOf(meta) === "IMMUTABLE_BODY" && bodySha256 !== meta.contentHash) {
      throw new EvidenceStoreRefusal(`Evidence bytes do not match metadata at ${key}`);
    }
    // An immutable no-op means these bytes are held, not just their metadata.
    // Rebuilt indexes keep the metadata-only path so a damaged old index can be replaced.
    let held: { meta: ObjectMeta; bytes?: Uint8Array } | null;
    if (objectClassOf(meta) === "IMMUTABLE_BODY") held = await this.get(key);
    else {
      const metadata = await this.head(key);
      held = metadata ? { meta: metadata } : null;
    }
    if (reconcileExistingObject(key, bytes, meta, held)) return;
    const encoded = encodeObject(bytes, { meta, bodySha256 });
    const result = await this.store.set(key, new Uint8Array(encoded.bytes).buffer, {
      metadata: encoded.metadata,
      ...(objectClassOf(meta) === "IMMUTABLE_BODY" ? { onlyIfNew: true } : {}),
    });
    if (!result.modified) {
      const raced = await this.get(key);
      if (!raced || !reconcileExistingObject(key, bytes, meta, raced)) throw new EvidenceStoreRefusal(`Concurrent evidence write did not settle at ${key}`);
    }
  }

  async head(key: string): Promise<ObjectMeta | null> {
    return (await this.describe(key))?.meta ?? null;
  }

  async describe(key: string, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<{ meta: ObjectMeta; bodySha256: string } | null> {
    return this.requestSignals.run(signal, () => abortable((async () => {
      const held = await this.store.getMetadata(key);
      if (held === null) return null;
      if (held.metadata.format !== ENVELOPE_FORMAT) return this.metadata(key, held.metadata);
      const object = await this.store.getWithMetadata(key, { type: "stream" });
      return object === null ? null : this.metadata(key, await envelopeMetadata(key, object.data, signal));
    })(), signal));
  }

  async get(key: string, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<StoredObject | null> {
    return this.requestSignals.run(signal, () => abortable((async () => {
    const held = await this.store.getWithMetadata(key, { type: "arrayBuffer" });
    if (held === null) return null;
    const { bytes, metadata } = decodeObject(key, held.data, held.metadata);
    const { meta, bodySha256 } = this.metadata(key, metadata);
    if (bytes.byteLength !== meta.byteLength || contentHash(bytes) !== bodySha256) throw new EvidenceStoreRefusal(`Stored evidence is corrupt at ${key}`);
    return { key, bytes, meta };
    })(), signal));
  }

  async stream(key: string, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<AsyncIterable<Uint8Array> | null> {
    const held = await this.requestSignals.run(signal, () => abortable(this.store.getWithMetadata(key, { type: "stream" }), signal));
    if (!held) return null;
    const metadataOf = this.metadata.bind(this);
    return (async function* () {
      const reader = held.data.getReader(), digest = createHash("sha256");
      let meta: ObjectMeta | undefined, bodySha256 = "", length = 0;
      let header = Buffer.alloc(0), wanted = held.metadata.format === ENVELOPE_FORMAT ? 4 : 0;
      if (!wanted) ({ meta, bodySha256 } = metadataOf(key, held.metadata));
      try {
        for (;;) {
          const next = await abortable(reader.read(), signal);
          if (next.done) break;
          let bytes = next.value;
          if (wanted) {
            let offset = 0;
            while (wanted && offset < bytes.byteLength) {
              const count = Math.min(wanted - header.byteLength, bytes.byteLength - offset);
              header = Buffer.concat([header, bytes.subarray(offset, offset + count)]); offset += count;
              if (header.byteLength !== wanted) continue;
              if (wanted === 4) {
                wanted = 4 + header.readUInt32BE(0);
                if (wanted <= 4 || wanted > 1024 * 1024) throw new EvidenceStoreRefusal(`Stored evidence envelope is unreadable at ${key}`);
              } else {
                ({ meta, bodySha256 } = metadataOf(key, JSON.parse(header.subarray(4).toString("utf8")) as Record<string, unknown>));
                wanted = 0; header = Buffer.alloc(0);
              }
            }
            bytes = bytes.subarray(offset);
          }
          if (bytes.byteLength) { digest.update(bytes); length += bytes.byteLength; yield bytes; }
        }
        if (wanted || !meta || length !== meta.byteLength || `sha256-${digest.digest("hex")}` !== bodySha256)
          throw new EvidenceStoreRefusal(`Stored evidence is corrupt at ${key}`);
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    })();
  }

  async list(prefix: string, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<string[]> {
    return this.requestSignals.run(signal, () => abortable((async () => {
    const keys: string[] = [];
    for await (const page of this.store.list({ prefix, paginate: true })) keys.push(...page.blobs.map(blob => blob.key));
    return keys.sort();
    })(), signal));
  }

  async directories(prefix: string): Promise<string[]> {
    const directories = new Set<string>();
    for await (const page of this.store.list({ prefix, directories: true, paginate: true })) {
      for (const directory of page.directories) {
        const key = directory.startsWith(prefix) ? directory : prefix + directory;
        directories.add(key.replace(/\/$/, ""));
      }
    }
    return [...directories].sort();
  }

  async visitKeys(prefix: string, visit: (key: string) => Promise<boolean|void>|boolean|void,
    signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<void> {
    await this.requestSignals.run(signal, () => abortable((async () => {
      for await (const page of this.store.list({ prefix, paginate: true })) {
        signal.throwIfAborted();
        for (const blob of page.blobs) if (await visit(blob.key) === false) return;
      }
    })(), signal));
  }

  private metadata(key: string, metadata: Record<string, unknown>): { meta: ObjectMeta; bodySha256: string } {
    const meta = metadata.meta as ObjectMeta | undefined;
    if (!meta || typeof meta.contentHash !== "string" || typeof meta.contentType !== "string" || !Number.isSafeInteger(meta.byteLength) || typeof metadata.bodySha256 !== "string") {
      throw new EvidenceStoreRefusal(`Stored evidence metadata is unreadable at ${key}`);
    }
    return { meta, bodySha256: metadata.bodySha256 };
  }
}

export function netlifyEvidenceStoreFromEnv(env: NodeJS.ProcessEnv = process.env): NetlifyEvidenceStore | null {
  if (env.WTP_VAULT_PROVIDER !== "netlify") return null;
  const siteID = env.WTP_BLOBS_SITE_ID?.trim(), token = env.WTP_BLOBS_TOKEN?.trim();
  if (!siteID || !token) throw new EvidenceStoreRefusal("Netlify vault requires WTP_BLOBS_SITE_ID and WTP_BLOBS_TOKEN from the host");
  const signals = new AsyncLocalStorage<AbortSignal>();
  const boundedFetch: typeof fetch = async (input, init) => {
    const deadline = signals.getStore() ?? AbortSignal.timeout(VAULT_READ_TIMEOUT_MS);
    const inherited = init?.signal ?? (input instanceof Request ? input.signal : null);
    const signal = inherited ? AbortSignal.any([inherited, deadline]) : deadline;
    // The SDK retries thrown fetch errors, including aborts. A non-retryable
    // failure response stops that loop; the read rejects with signal.reason.
    const expired = () => new Response(null, { status: 408, statusText: "Vault request aborted" });
    if (signal.aborted) return expired();
    try { return await fetch(input, { ...init, signal }); }
    catch (error) { if (signal.aborted) return expired(); throw error; }
  };
  return new NetlifyEvidenceStore(getStore({ name: env.WTP_VAULT_STORE ?? "meanwhile-evidence", siteID, token, consistency: "strong",fetch:boundedFetch }), signals);
}
