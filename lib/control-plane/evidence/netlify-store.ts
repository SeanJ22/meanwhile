import { getStore, type Store } from "@netlify/blobs";
import { AsyncLocalStorage } from "node:async_hooks";
import { contentHash } from "../ids.ts";
import { abortableEvidenceRead, checkedEvidenceBody, EvidenceStoreRefusal, objectClassOf, reconcileExistingObject, type EvidenceStore, type ObjectMeta, type StoredObject, type StoredObjectStream } from "./store.ts";

const ENVELOPE_FORMAT = "evidence-envelope@1";
export const VAULT_READ_TIMEOUT_MS = 20_000;

async function decodeEnvelope(key: string, body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let closed = false;
  const close = () => { if (!closed) { closed = true; reader.releaseLock(); } };
  const take = async (length: number) => {
    const bytes = new Uint8Array(length);
    let offset = 0;
    while (offset < length) {
      if (!pending.byteLength) {
        const next = await abortableEvidenceRead(reader.read(), signal);
        if (next.done) throw new Error("truncated header");
        pending = next.value;
      }
      const count = Math.min(length - offset, pending.byteLength);
      bytes.set(pending.subarray(0, count), offset);
      offset += count; pending = pending.subarray(count);
    }
    return bytes;
  };
  try {
    const prefix = await take(4), length = new DataView(prefix.buffer).getUint32(0);
    if (length > 16 * 1024 * 1024) throw new Error("oversized header");
    const metadata = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await take(length))) as Record<string, unknown>;
    if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("invalid header");
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          if (pending.byteLength) { const chunk = pending; pending = new Uint8Array(0); controller.enqueue(chunk); return; }
          const next = await abortableEvidenceRead(reader.read(), signal);
          if (next.done) { close(); controller.close(); } else controller.enqueue(next.value);
        } catch (error) { await reader.cancel(error).catch(() => undefined); close(); controller.error(error); }
      },
      async cancel(reason) { pending = new Uint8Array(0); await reader.cancel(reason).catch(() => undefined); close(); },
    }, { highWaterMark: 0 });
    return { metadata, body: stream };
  } catch (error) {
    await reader.cancel(error).catch(() => undefined); close();
    if (signal.aborted) throw signal.reason;
    throw new EvidenceStoreRefusal(`Stored evidence envelope is unreadable at ${key}: ${error instanceof Error ? error.message : String(error)}`);
  }
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
    return this.requestSignals.run(signal, () => abortableEvidenceRead((async () => {
      const held = await this.store.getMetadata(key);
      if (held === null) return null;
      if (held.metadata.format !== ENVELOPE_FORMAT) return this.metadata(key, held.metadata);
      const object = await this.store.getWithMetadata(key, { type: "stream" });
      if (object === null) return null;
      const decoded = await decodeEnvelope(key, object.data, signal);
      try { return this.metadata(key, decoded.metadata); }
      finally { await decoded.body.cancel(); }
    })(), signal));
  }

  async stream(key: string, signal?: AbortSignal): Promise<StoredObjectStream | null> {
    const controller = new AbortController(), deadline = signal ?? controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => { if (timer) clearTimeout(timer); timer = undefined; };
    const resume = () => {
      if (!signal) { pause(); timer = setTimeout(() => controller.abort(new Error("Vault read timed out")), VAULT_READ_TIMEOUT_MS); timer.unref(); }
    };
    resume();
    try {
      return await this.requestSignals.run(deadline, () => abortableEvidenceRead((async () => {
        const held = await this.store.getWithMetadata(key, { type: "stream" });
        if (held === null) return null;
        const decoded = held.metadata.format === ENVELOPE_FORMAT
          ? await decodeEnvelope(key, held.data, deadline) : { body: held.data, metadata: held.metadata };
        try {
          const { meta, bodySha256 } = this.metadata(key, decoded.metadata);
          const reader = decoded.body.getReader();
          let closed = false;
          const close = () => { pause(); if (!closed) { closed = true; reader.releaseLock(); } };
          const body = new ReadableStream<Uint8Array>({
            async pull(target) {
              resume();
              try {
                const next = await abortableEvidenceRead(reader.read(), deadline);
                if (next.done) { close(); target.close(); } else target.enqueue(next.value);
              } catch (error) { await reader.cancel(error).catch(() => undefined); close(); target.error(error); }
              finally { pause(); }
            },
            async cancel(reason) { await reader.cancel(reason).catch(() => undefined); close(); },
          }, { highWaterMark: 0 });
          return { key, meta, body: checkedEvidenceBody(key, body, meta, bodySha256, deadline) };
        } catch (error) { await decoded.body.cancel(error).catch(() => undefined); throw error; }
      })(), deadline));
    } finally { pause(); }
  }

  async get(key: string, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<StoredObject | null> {
    const object = await this.stream(key, signal);
    if (!object) return null;
    const bytes = new Uint8Array(object.meta.byteLength), reader = object.body.getReader();
    let offset = 0;
    try {
      for (;;) {
        const next = await reader.read();
        if (next.done) return { key, bytes, meta: object.meta };
        bytes.set(next.value, offset); offset += next.value.byteLength;
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  }

  async list(prefix: string, signal = AbortSignal.timeout(VAULT_READ_TIMEOUT_MS)): Promise<string[]> {
    return this.requestSignals.run(signal, () => abortableEvidenceRead((async () => {
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

  private metadata(key: string, metadata: Record<string, unknown>): { meta: ObjectMeta; bodySha256: string } {
    const meta = metadata.meta as ObjectMeta | undefined;
    if (!meta || typeof meta.contentHash !== "string" || typeof meta.contentType !== "string" || !Number.isSafeInteger(meta.byteLength) || meta.byteLength < 0 || typeof metadata.bodySha256 !== "string") {
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
