import { getStore } from "@netlify/blobs";
import { READER_ARTIFACT_STORE_NAME } from "../meetings/edge-store.ts";
import { purgeReaderCacheTags } from "../meetings/edge-serving.ts";
import { projectLinkHealth, readLinkHealth, type ReaderLinkHealth } from "../design/link-health.ts";

export const READER_LINK_HEALTH_TAG = "reader-link-health";
const KEY = "reader/link-health.json";
export interface LinkHealthEdgeStore {
  read(): Promise<{ snapshot: ReaderLinkHealth; etag: string } | null>;
  write(snapshot: ReaderLinkHealth, etag: string | null): Promise<boolean>;
}
/** Separate pointer in the existing Reader store; no control-plane read on Reader. */
export function linkHealthEdgeStore(): LinkHealthEdgeStore {
  const siteID = process.env.NETLIFY_SITE_ID || process.env.NETLIFY_BLOBS_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN || process.env.NETLIFY_BLOBS_TOKEN;
  const store = getStore({ name: READER_ARTIFACT_STORE_NAME, consistency: "strong", ...(siteID && token ? { siteID, token } : {}) });
  return {
    async read() {
      const result = await store.getWithMetadata(KEY, { type: "json" });
      if (!result?.data) return null;
      const snapshot = readLinkHealth(result.data);
      if (!snapshot || !result.etag) throw new Error("Invalid Reader link-health snapshot");
      return { snapshot, etag: result.etag };
    },
    async write(snapshot, etag) {
      return (await store.setJSON(KEY, snapshot, etag === null ? { onlyIfNew: true } : { onlyIfMatch: etag })).modified;
    },
  };
}

/** Bank calls after DB-51 records real results; a stale sweep cannot replace a newer one. */
export async function publishReaderLinkHealth(results: Parameters<typeof projectLinkHealth>[1], sweptAt: string,
  options: { store?: LinkHealthEdgeStore; purge?: (tags: readonly string[]) => Promise<unknown> } = {},
): Promise<boolean> {
  const store = options.store ?? linkHealthEdgeStore();
  for (let attempt = 0; attempt < 3; attempt++) {
    const held = await store.read();
    if (held && Date.parse(held.snapshot.sweptAt) > Date.parse(sweptAt)) return false;
    const snapshot = projectLinkHealth(held?.snapshot ?? null, results, sweptAt);
    if (held && held.snapshot.sweptAt === sweptAt) {
      if (JSON.stringify(held.snapshot) !== JSON.stringify(snapshot)) throw new Error("Conflicting link sweep at one timestamp");
      await (options.purge ?? purgeReaderCacheTags)([READER_LINK_HEALTH_TAG]);
      return true;
    }
    if (await store.write(snapshot, held?.etag ?? null)) {
      await (options.purge ?? purgeReaderCacheTags)([READER_LINK_HEALTH_TAG]);
      return true;
    }
  }
  return false;
}
