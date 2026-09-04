import { artifactId as deriveArtifactId, type Artifact } from "../evidence/artifact.ts";
import { readArtifact, type EvidenceStore } from "../evidence/store.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";

/** Resolve first-observation metadata, including partial acquisitions, without any retrieval. */
export function researchVaultResolver(repos: ControlPlaneRepositories, store: EvidenceStore, project: string) {
  return async (id: string): Promise<{artifact: Artifact; key: string; bytes: Uint8Array}> => {
    const records = (await repos.artifacts.readAll()).filter(a => a.artifactId === id);
    if (!records.length) throw new Error("RESEARCH_ARTIFACT_METADATA_MISSING");
    for (const record of records) {
      const acquiring = (await repos.attempts.mustRead(record.attemptId)).value;
      if (!["ACQUIRER", "SCOUT", "ADVERSARIAL_AUDITOR"].includes(acquiring.worker.role)) continue;
      for (const key of await store.list(`project/${project}/`)) {
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
          retentionPolicy: m.retentionPolicy as Artifact["retentionPolicy"] };
        return { artifact, key, bytes: (await readArtifact(store, project, artifact, "ACQUIRER")).bytes };
      }
    }
    throw new Error("RESEARCH_ARTIFACT_VAULT_IDENTITY_MISSING");
  };
}
