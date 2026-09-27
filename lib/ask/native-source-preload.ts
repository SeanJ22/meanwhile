import type { AuthorityFamily, ReaderManifest } from "../meetings/edge-artifacts.ts";

/** These families are unconditionally read by the existing grounded Ask route.
 * Start their immutable edge reads during cold module initialization, beside
 * engine loading. This neither enters request-local authority nor replaces the
 * route's manifest check, cache invalidation, validation or database fallback. */
export const NATIVE_ASK_ESSENTIAL_FAMILIES: readonly AuthorityFamily[] = [
  "census-districts", "registry-runtime", "federal-directory", "campaign-sites",
  "state-legislators", "meeting-outcomes", "comment-access",
];

export interface NativeAskEdgePreloader {
  readReaderManifest(): Promise<ReaderManifest | null>;
  ensureReaderAuthorityEdge(manifest: ReaderManifest, store: undefined, families: readonly AuthorityFamily[]): Promise<unknown>;
}

/** An optimization only: a missing or failed edge is retried by the normal
 * reader, which owns the actual answer and its failure attribution. No timers,
 * scheduled calls, model work, production writes or separate data cache. */
export async function preloadNativeAskSources(load: () => Promise<NativeAskEdgePreloader>): Promise<"ATTEMPTED" | "UNAVAILABLE" | "FAILED"> {
  try {
    const reader = await load();
    const manifest = await reader.readReaderManifest();
    if (manifest?.authorityArtifacts) {
      await reader.ensureReaderAuthorityEdge(manifest, undefined, NATIVE_ASK_ESSENTIAL_FAMILIES);
      // Per-family failures are still owned and reported by the canonical reader.
      return "ATTEMPTED";
    }
    return "UNAVAILABLE";
  } catch {
    // The route's ordinary read/fallback must remain available after a failed prefetch.
    return "FAILED";
  }
}
