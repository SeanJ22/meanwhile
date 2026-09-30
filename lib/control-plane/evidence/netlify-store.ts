import { getStore, type Store } from "@netlify/blobs";
import { contentHash } from "../ids.ts";
import { EvidenceStoreRefusal, objectClassOf, reconcileExistingObject, type EvidenceStore, type ObjectMeta, type StoredObject } from "./store.ts";

/** The same evidence keys and metadata, held outside the runner's host. */
export class NetlifyEvidenceStore implements EvidenceStore {
  readonly durable = true;
  private readonly store: Store;
  constructor(store: Store) { this.store = store; }

  async put(key: string, bytes: Uint8Array, meta: ObjectMeta): Promise<void> {
    if (meta.custom?.tier === "RESTRICTED_RAW") throw new EvidenceStoreRefusal("RESTRICTED_RAW requires the existing restricted evidence provider");
    const bodySha256 = contentHash(bytes);
    if (bytes.byteLength !== meta.byteLength || objectClassOf(meta) === "IMMUTABLE_BODY" && bodySha256 !== meta.contentHash) {
      throw new EvidenceStoreRefusal(`Evidence bytes do not match metadata at ${key}`);
    }
    const held = await this.head(key);
    if (reconcileExistingObject(key, bytes, meta, held ? { meta: held } : null)) return;
    const result = await this.store.set(key, new Uint8Array(bytes).buffer, {
      metadata: { meta, bodySha256 },
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

  async describe(key: string): Promise<{ meta: ObjectMeta; bodySha256: string } | null> {
    const held = await this.store.getMetadata(key);
    return held === null ? null : this.metadata(key, held.metadata);
  }

  async get(key: string): Promise<StoredObject | null> {
    const held = await this.store.getWithMetadata(key, { type: "arrayBuffer" });
    if (held === null) return null;
    const { meta, bodySha256 } = this.metadata(key, held.metadata);
    const bytes = new Uint8Array(held.data);
    if (bytes.byteLength !== meta.byteLength || contentHash(bytes) !== bodySha256) throw new EvidenceStoreRefusal(`Stored evidence is corrupt at ${key}`);
    return { key, bytes, meta };
  }

  async list(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    for await (const page of this.store.list({ prefix, paginate: true })) keys.push(...page.blobs.map(blob => blob.key));
    return keys.sort();
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
  return new NetlifyEvidenceStore(getStore({ name: env.WTP_VAULT_STORE ?? "meanwhile-evidence", siteID, token, consistency: "strong" }));
}
