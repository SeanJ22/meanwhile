import { MemoryEvidenceStore } from "../../lib/control-plane/evidence/store.ts";
import { memoryWebsitePacing } from "../../lib/control-plane/website-pacing.ts";
import { runWithSourceFetch } from "../../lib/sources/fetch-source.ts";
import type { SourceFetchStore } from "../../lib/sources/fetch-source-state.ts";

export function withSourceTransport<T>(transport: typeof fetch | undefined, operation: () => T): T {
  const store: SourceFetchStore = { pacing: memoryWebsitePacing(), withLease: async (_key, operation) => operation(), read: async () => null, readEntryRequest: async () => null, record: async () => {} };
  return runWithSourceFetch({ vault: new MemoryEvidenceStore(), runtime: { store, transport } }, operation);
}
