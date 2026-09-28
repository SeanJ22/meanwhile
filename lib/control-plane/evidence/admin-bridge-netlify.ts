import { ADMIN_EVIDENCE_STORE_NAME, type AdminEvidenceBlob, type AdminEvidenceCopy, type AdminEvidenceRemote } from "./admin-bridge.ts";

/** Separate site-wide private namespace. Never use the public reader-artifacts store. */
export class NetlifyAdminEvidenceRemote implements AdminEvidenceRemote {
  constructor(private readonly credentials: { readonly siteID?: string; readonly token?: string } = {}) {}

  private async store() {
    const { getStore } = await import("@netlify/blobs");
    const base = { name: ADMIN_EVIDENCE_STORE_NAME, consistency: "strong" as const };
    return this.credentials.siteID && this.credentials.token
      ? getStore({ ...base, siteID: this.credentials.siteID, token: this.credentials.token })
      : getStore(base);
  }

  async read(key: string): Promise<AdminEvidenceBlob | null> {
    const stored = await (await this.store()).getWithMetadata(key, { type: "arrayBuffer" });
    if (!stored || stored.data == null) return null;
    // The remote metadata is untrusted until verifyAdminEvidenceBlob checks every field.
    const copy = stored.metadata as unknown as AdminEvidenceCopy | undefined;
    if (!copy) throw new Error("ADMIN_EVIDENCE_METADATA_MISSING");
    return { bytes: new Uint8Array(stored.data as ArrayBuffer), copy };
  }

  async create(key: string, blob: AdminEvidenceBlob): Promise<boolean> {
    const buffer = new ArrayBuffer(blob.bytes.byteLength);
    new Uint8Array(buffer).set(blob.bytes);
    const result = await (await this.store()).set(key, buffer, { onlyIfNew: true, metadata: { ...blob.copy } });
    return result.modified;
  }
}
