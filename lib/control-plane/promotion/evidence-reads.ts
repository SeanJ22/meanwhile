import type { Attempt } from "../attempt.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";

export interface PromotionEvidenceRepositories extends ControlPlaneRepositories {
  readonly artifactsForPromotion?: (artifactIds: readonly string[], canonicalUrls: readonly string[]) => Promise<readonly ArtifactRecord[]>;
  readonly acquisitionAttemptsForArtifacts?: (artifactIds: readonly string[]) => Promise<readonly Attempt[]>;
}

/** Preserve the full relevant history; a newest-N lookup would erase evidence. */
export async function readPromotionArtifacts(repos: PromotionEvidenceRepositories,
  artifactIds: readonly string[], canonicalUrls: readonly string[] = []): Promise<readonly ArtifactRecord[]> {
  return promotionArtifactReader(repos)(artifactIds, canonicalUrls);
}

/** One job-local fallback snapshot for a provider awaiting River's SQL hook. */
export function promotionArtifactReader(repos: PromotionEvidenceRepositories) {
  let fallback: Promise<readonly ArtifactRecord[]> | undefined;
  return async (artifactIds: readonly string[], canonicalUrls: readonly string[] = []): Promise<readonly ArtifactRecord[]> => {
  const ids = [...new Set(artifactIds)];
  const urls = [...new Set(canonicalUrls)];
  if (!ids.length && !urls.length) return [];
  if (repos.artifactsForPromotion) {
    const selected = await repos.artifactsForPromotion(ids, urls);
    if (!urls.length) return selected;
    // A content id may have observations under several URLs. The context's
    // last-observation lookup must see the same row as the full log did.
    return repos.artifactsForPromotion([...new Set([...ids, ...selected.map(row => row.artifactId)])], []);
  }
  // File/memory/legacy providers have no network transfer. Keep their exact log
  // order, including multiple observations of a content-addressed artifact.
  const all = await (fallback ??= repos.artifacts.readAll());
  const selectedIds = new Set([...ids, ...all.filter(row => urls.includes(row.canonicalUrl)).map(row => row.artifactId)]);
  return all.filter(row => selectedIds.has(row.artifactId));
  };
}

export async function readAcquisitionAttempts(repos: PromotionEvidenceRepositories, artifactIds: readonly string[]): Promise<readonly Attempt[]> {
  const ids = [...new Set(artifactIds)];
  if (!ids.length) return [];
  if (repos.acquisitionAttemptsForArtifacts) return repos.acquisitionAttemptsForArtifacts(ids);
  return (await repos.attempts.listWhere(["worker", "role"], "ACQUIRER")).map(row => row.value)
    .filter(row => row.outcome === "COMPLETED" && row.artifactIds.some(id => ids.includes(id)));
}

/** Reuse the parent's repositories; never keep a job's evidence across jobs. */
export async function readPromotionRows<T>(repo: {
  readMany?(ids: readonly string[]): Promise<readonly { id: string; value: T }[]>;
  read(id: string): Promise<{ id: string; value: T } | null>;
}, ids: readonly string[]): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  if (!unique.length) return new Map();
  if (repo.readMany) return new Map((await repo.readMany(unique)).map(row => [row.id, row.value]));
  const out = new Map<string, T>();
  for (let at = 0; at < unique.length; at += 16) {
    for (const row of await Promise.all(unique.slice(at, at + 16).map(id => repo.read(id)))) {
      if (row) out.set(row.id, row.value);
    }
  }
  return out;
}
