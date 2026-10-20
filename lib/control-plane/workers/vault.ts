import type { ControlPlaneRepositories } from "../repository/types.ts";
import { artifactId as deriveArtifactId, type Artifact } from "../evidence/artifact.ts";
import { readForParser, type EvidenceStore, type ObjectMeta } from "../evidence/store.ts";
import type { ParserInput } from "../evidence/parser-boundary.ts";
import { readArtifactsById } from "./scoped-history.ts";
import { artifactVaultKeys } from "./vault-keys.ts";

/** The acquiring roles whose bytes may reach a worker. */
const WORKER_READABLE_ROLES = ["ACQUIRER", "SCOUT", "DETECTIVE", "ADVERSARIAL_AUDITOR"];

/**
 * Resolves by held identity; cannot acquire or invent an acquisition record.
 * An artifact id names content, so several records can carry one: each complete
 * record is tried in log order, and the first whose Attempt may hand bytes to a
 * worker and whose bytes the vault holds is read. The ParserInput names that
 * Attempt, so extraction is attributed to the acquisition whose bytes it parsed.
 */
export function workerVaultResolver(repos: ControlPlaneRepositories, store: EvidenceStore, project: string, options: { readonly snapshot?: boolean } = {}) {
  // Only an explicitly bounded projection pass freezes its input index. Normal
  // acquisition workers keep seeing newly appended records on every invocation.
  const snapshotHeads = new Map<string, Promise<ObjectMeta | null>>();
  const resolved = new Map<string, Promise<ParserInput>>();
  const resolve = async (artifactId: string): Promise<ParserInput> => {
    const records = (await readArtifactsById(repos, artifactId)).filter(record => !record.partial);
    if (records.length === 0) throw new Error(`WORKER_ARTIFACT_MISSING_OR_PARTIAL:${artifactId}`);
    const keys = await artifactVaultKeys(store, project, records);
    if (!keys.length) throw new Error("WORKER_ARTIFACT_NOT_IN_VAULT");
    const heads = options.snapshot ? snapshotHeads : new Map<string, Promise<ObjectMeta | null>>();
    let admitted = false;
    for (const record of records) {
      const acquiringAttempt = (await repos.attempts.mustRead(record.attemptId)).value;
      if (!WORKER_READABLE_ROLES.includes(acquiringAttempt.worker.role)) continue;
      admitted = true;
      for (const key of keys) {
        if (!heads.has(key)) heads.set(key, store.head(key));
        const meta = await heads.get(key);
        if (!meta || meta.contentHash !== record.contentHash) continue;
        const m = meta.custom;
        if (!m || m.tier !== record.tier || deriveArtifactId(record.tier, meta.contentHash) !== artifactId ||
            m.attemptId !== record.attemptId || m.canonicalUrl !== record.canonicalUrl) continue;
        const artifact: Artifact = {
          id: artifactId, tier: record.tier, contentHash: record.contentHash, byteLength: record.byteLength,
          contentType: record.contentType, canonicalUrl: record.canonicalUrl, retrievalUrl: m.retrievalUrl ?? record.canonicalUrl,
          retrievedAt: m.retrievedAt, httpStatus: Number(m.httpStatus), headers: {}, sourceId: m.sourceId,
          methodRouteId: m.methodRouteId, workItemId: m.workItemId, attemptId: m.attemptId,
          permission: m.permission as Artifact["permission"], transport: m.transport as Artifact["transport"],
          retentionPolicy: m.retentionPolicy as Artifact["retentionPolicy"],
          ...(m.extraction ? { extraction: JSON.parse(m.extraction) as Artifact["extraction"] } : {}),
        };
        return (await readForParser(store, project, artifact)).input;
      }
    }
    throw new Error(admitted ? "WORKER_ARTIFACT_NOT_IN_VAULT" : "WORKER_ARTIFACT_PROVENANCE_REFUSED");
  };
  return (artifactId: string) => {
    if (!options.snapshot) return resolve(artifactId);
    if (!resolved.has(artifactId)) resolved.set(artifactId, resolve(artifactId));
    return resolved.get(artifactId)!;
  };
}
