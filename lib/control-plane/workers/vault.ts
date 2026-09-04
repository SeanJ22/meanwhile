import type { ControlPlaneRepositories } from "../repository/types.ts";
import { artifactId as deriveArtifactId, type Artifact } from "../evidence/artifact.ts";
import { readForParser, type EvidenceStore } from "../evidence/store.ts";
import type { ParserInput } from "../evidence/parser-boundary.ts";

/** Resolves by held identity; cannot acquire and cannot invent an acquisition record. */
export function workerVaultResolver(repos: ControlPlaneRepositories, store: EvidenceStore, project: string) {
  return async (artifactId: string): Promise<ParserInput> => {
    const record = (await repos.artifacts.readAll()).find(a => a.artifactId === artifactId);
    if (!record || record.partial) throw new Error("WORKER_ARTIFACT_MISSING_OR_PARTIAL");
    const acquiringAttempt = (await repos.attempts.mustRead(record.attemptId)).value;
    if (!["ACQUIRER", "SCOUT", "ADVERSARIAL_AUDITOR"].includes(acquiringAttempt.worker.role)) throw new Error("WORKER_ARTIFACT_PROVENANCE_REFUSED");
    for (const key of await store.list(`project/${project}/`)) {
      const meta = await store.head(key);
      if (!meta || meta.contentHash !== record.contentHash) continue;
      const m = meta.custom;
      if (!m || m.tier !== record.tier || deriveArtifactId(record.tier, meta.contentHash) !== artifactId ||
          m.attemptId !== record.attemptId || m.canonicalUrl !== record.canonicalUrl) continue;
      const artifact: Artifact = {
        id: artifactId, tier: record.tier, contentHash: record.contentHash, byteLength: record.byteLength,
        contentType: record.contentType, canonicalUrl: record.canonicalUrl, retrievalUrl: record.canonicalUrl,
        retrievedAt: m.retrievedAt, httpStatus: Number(m.httpStatus), headers: {}, sourceId: m.sourceId,
        methodRouteId: m.methodRouteId, workItemId: m.workItemId, attemptId: m.attemptId,
        permission: m.permission as Artifact["permission"], transport: m.transport as Artifact["transport"],
        retentionPolicy: m.retentionPolicy as Artifact["retentionPolicy"],
      };
      return (await readForParser(store, project, artifact)).input;
    }
    throw new Error("WORKER_ARTIFACT_NOT_IN_VAULT");
  };
}
