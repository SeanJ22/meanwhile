import { artifactId as deriveArtifactId, type Artifact } from "../evidence/artifact.ts";
import { readArtifact, type EvidenceStore } from "../evidence/store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readArtifactsById } from "./scoped-history.ts";
import { artifactVaultKeys } from "./vault-keys.ts";

/** Resolve first-observation metadata, including partial acquisitions, without any retrieval. */
export function researchVaultResolver(repos: ControlPlaneRepositories, store: EvidenceStore, project: string, options: { readonly snapshot?: boolean } = {}) {
  const resolved = new Map<string, Promise<{ artifact: Artifact; key: string; bytes: Uint8Array }>>();
  const resolve = async (id: string): Promise<{artifact: Artifact; key: string; bytes: Uint8Array}> => {
    const records = await readArtifactsById(repos, id);
    if (!records.length) throw new Error("RESEARCH_ARTIFACT_METADATA_MISSING");
    const keys = await artifactVaultKeys(store, project, records);
    // No local/remote bytes means acquisition is owed. Do not query every
    // historical acquiring Attempt to rediscover the same absent object.
    if (!keys.length) throw new Error("RESEARCH_ARTIFACT_VAULT_IDENTITY_MISSING");
    for (const record of records) {
      const acquiring = (await repos.attempts.mustRead(record.attemptId)).value;
      if (!["ACQUIRER", "SCOUT", "DETECTIVE", "ADVERSARIAL_AUDITOR"].includes(acquiring.worker.role)) continue;
      for (const key of keys) {
        const meta = await store.head(key);
        const m = meta?.custom;
        if (!meta || !m || meta.contentHash !== record.contentHash || m.workItemId !== record.workItemId ||
          m.attemptId !== record.attemptId || m.canonicalUrl !== record.canonicalUrl || m.tier !== record.tier ||
          deriveArtifactId(record.tier, record.contentHash) !== id) continue;
        const artifact: Artifact = { id, tier: record.tier, contentHash: record.contentHash, byteLength: record.byteLength,
          contentType: record.contentType, canonicalUrl: record.canonicalUrl, retrievalUrl: m.retrievalUrl ?? record.canonicalUrl,
          retrievedAt: m.retrievedAt, httpStatus: Number(m.httpStatus), headers: {}, sourceId: m.sourceId,
          methodRouteId: m.methodRouteId, workItemId: m.workItemId, attemptId: m.attemptId,
          permission: m.permission as Artifact["permission"], transport: m.transport as Artifact["transport"],
          retentionPolicy: m.retentionPolicy as Artifact["retentionPolicy"],
          ...(m.extraction ? { extraction: JSON.parse(m.extraction) as Artifact["extraction"] } : {}) };
        return { artifact, key, bytes: (await readArtifact(store, project, artifact, "ACQUIRER")).bytes };
      }
    }
    throw new Error("RESEARCH_ARTIFACT_VAULT_IDENTITY_MISSING");
  };
  return (id: string) => {
    if (!options.snapshot) return resolve(id);
    // Rejections are shared too: another observation of the same content
    // cannot make missing bytes appear within this fixed evidence pass.
    if (!resolved.has(id)) resolved.set(id, resolve(id));
    return resolved.get(id)!;
  };
}
