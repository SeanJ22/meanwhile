import { resolveReaderArtifactStore } from "./edge-store.ts";

/**
 * Admin observation of the reader edge serving layer — the manifest the CDN
 * serves readers from. It makes publication lag and a stalled/absent publisher
 * visible: the manifest's own freshness, the per-scope artifact counts, and
 * (compared against the DB prepared snapshot elsewhere in the panel) whether the
 * edge is behind the authoritative data. A missing manifest is an explicit
 * first-seed/rollout condition, never a silent zero; an unreachable store is
 * never read as "no data".
 */
export type ReaderEdgeObservation =
  | { readonly kind: "NOT_CONFIGURED"; readonly detail: string }
  | { readonly kind: "STORE_UNREACHABLE"; readonly detail: string }
  | { readonly kind: "ABSENT"; readonly storeKind: string; readonly detail: string }
  | {
      readonly kind: "PUBLISHED";
      readonly storeKind: string;
      readonly sequence: number;
      readonly generatedAt: string;
      readonly ageMinutes: number | null;
      readonly scopes: readonly { readonly scope: string; readonly meetingCount: number; readonly generatedAt: string }[];
      readonly totalMeetings: number;
      readonly sourceThrough: string | null;
      readonly promotedThrough: string | null;
      /** The large authority-family edge artifacts the manifest points at. */
      readonly authorityArtifacts: readonly { readonly family: string; readonly version: string }[];
    };

export async function readReaderEdgeObservation(
  now: string = new Date().toISOString(),
): Promise<ReaderEdgeObservation> {
  const store = resolveReaderArtifactStore();
  if (!store) {
    return {
      kind: "NOT_CONFIGURED",
      detail:
        "No reader edge store is configured (no Netlify Blobs credentials and no local artifact dir). The reader is serving from the DB prepared row; publish the edge artifacts to move the hot path to the CDN.",
    };
  }
  let stored;
  try {
    stored = await store.readManifest();
  } catch (error) {
    return { kind: "STORE_UNREACHABLE", detail: error instanceof Error ? error.message : String(error) };
  }
  if (!stored) {
    return {
      kind: "ABSENT",
      storeKind: store.kind,
      detail: "No reader manifest is published yet (initial rollout). The reader falls back to the DB prepared row until the runner publishes one.",
    };
  }
  const manifest = stored.manifest;
  const genMs = Date.parse(manifest.generatedAt);
  const nowMs = Date.parse(now);
  const ageMinutes =
    Number.isFinite(genMs) && Number.isFinite(nowMs) ? Math.max(0, Math.round((nowMs - genMs) / 60_000)) : null;
  return {
    kind: "PUBLISHED",
    storeKind: store.kind,
    sequence: manifest.sequence,
    generatedAt: manifest.generatedAt,
    ageMinutes,
    scopes: manifest.scopes.map((s) => ({ scope: s.scope, meetingCount: s.meetingCount, generatedAt: s.generatedAt })),
    totalMeetings: manifest.scopes.reduce((n, s) => n + s.meetingCount, 0),
    sourceThrough: manifest.sourceThrough,
    promotedThrough: manifest.promotedThrough,
    authorityArtifacts: Object.entries(manifest.authorityArtifacts ?? {}).map(([family, ref]) => ({
      family,
      version: (ref as { version: string }).version,
    })),
  };
}
