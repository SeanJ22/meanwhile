import type { ControlPlaneRepositories } from "../repository/types.ts";
import { artifactId as deriveArtifactId, type Artifact } from "../evidence/artifact.ts";
import { readForParser, type EvidenceStore, type ObjectMeta } from "../evidence/store.ts";
import type { ParserInput } from "../evidence/parser-boundary.ts";

/** The acquiring roles whose bytes may reach a worker. */
const WORKER_READABLE_ROLES = ["ACQUIRER", "SCOUT", "ADVERSARIAL_AUDITOR"];

/**
 * Resolves by held identity; cannot acquire and cannot invent an acquisition record.
 *
 * An artifact id names content (tier and hash), so several records can carry one:
 * the same bytes retrieved by two Attempts, or for two work items. Each complete
 * record is tried in log order, and the first whose acquiring Attempt may hand
 * bytes to a worker and whose held identity the vault holds is read. Binding only
 * the first record refused bytes the vault held under a later record whenever the
 * first record's bytes were never vaulted (2026-09-23: 13 records over 10 ids
 * after the vault restore). The ParserInput names the Attempt whose bytes it read.
 */
export function workerVaultResolver(repos: ControlPlaneRepositories, store: EvidenceStore, project: string) {
  return async (artifactId: string): Promise<ParserInput> => {
    const records = (await repos.artifacts.readAll()).filter(a => a.artifactId === artifactId && !a.partial);
    if (records.length === 0) throw new Error("WORKER_ARTIFACT_MISSING_OR_PARTIAL");
    let keys: string[] | null = null;
    const heads = new Map<string, ObjectMeta | null>();
    let admitted = false;
    for (const record of records) {
      const acquiringAttempt = (await repos.attempts.mustRead(record.attemptId)).value;
      if (!WORKER_READABLE_ROLES.includes(acquiringAttempt.worker.role)) continue;
      admitted = true;
      keys ??= await store.list(`project/${project}/`);
      for (const key of keys) {
        if (!heads.has(key)) heads.set(key, await store.head(key));
        const meta = heads.get(key);
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
    }
    throw new Error(admitted ? "WORKER_ARTIFACT_NOT_IN_VAULT" : "WORKER_ARTIFACT_PROVENANCE_REFUSED");
  };
}
