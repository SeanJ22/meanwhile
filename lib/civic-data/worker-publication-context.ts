import { readPublicationSourcePolicy } from "../control-plane/promotion/source-settings.ts";
import { join } from "node:path";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import { publicationVaultReaders } from "./publication-vault.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { Artifact } from "../control-plane/evidence/artifact.ts";
import { datePath, readForParser, type EvidenceStore } from "../control-plane/evidence/store.ts";
import type { WorkerPublicationCapture } from "./worker-roster-publication.ts";
import type { CapturedFinanceResponse } from "../funding/campaign-finance.ts";

export async function workerPublicationContext(now: string, existingRepos?: ControlPlaneRepositories) {
  const connection = controlPlaneUrlFromEnv();
  if (!existingRepos && !connection) throw new Error("WORKER_PUBLICATION_CONTROL_PLANE_UNAVAILABLE");
  const repos = existingRepos ?? await createPgRepositories(connection!, now, { skipBootstrap: true });
  const sourcePolicy = await readPublicationSourcePolicy(repos);
  const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
  const { readObject, readEvidence } = publicationVaultReaders(repos, vault);
  return { repos, readSavedFinanceResponse: async (id: string): Promise<CapturedFinanceResponse> => {
    const { artifact, bytes } = await readObject(id);
    const partial = artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC" || artifact.extraction?.complete === false;
    return { url: artifact.canonicalUrl, bytes: Buffer.from(bytes), retrievedAt: artifact.retrievedAt,
      rawHash: artifact.contentHash.replace(/^sha256-/, ""), publisher: artifact.sourceId,
      httpStatus: artifact.httpStatus, transport: artifact.transport, partial, sourcePolicy,
      complete: !partial && artifact.transport === "REACHABLE" && artifact.httpStatus !== null && artifact.httpStatus >= 200 && artifact.httpStatus < 300 };
  }, readCapture: async (id: string, records: readonly WorkerResultRecord[]) => {
    const [{ artifact }, input] = await Promise.all([readObject(id), readEvidence(id)]);
    const evidence = evidenceProjection(input);
    const observations = records.flatMap(record => {
      const result = record.result;
      return result.role === "ACQUIRER" && result.verdict === "ACQUIRED"
        ? result.walk.filter(step => step.rung === result.source.retrieval && step.target === evidence.canonicalUrl &&
          step.transport === "REACHABLE" && step.outcome === "WALKED_AND_FOUND" && step.artifactIds.includes(id)).map(step => step.at) : [];
    });
    return { evidence, sourcePolicy, observedAt: [evidence.retrievedAt, ...observations].sort().at(-1)!, httpStatus: artifact.httpStatus,
      transport: artifact.transport, partial: artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC" || artifact.extraction?.complete === false };
  } };
}

export function heldCaptureReader(store: EvidenceStore, project = "freshness") {
  const listed = new Map<string, Promise<string[]>>();
  return async (record: ArtifactRecord): Promise<WorkerPublicationCapture | null> => {
    const host = /^https?:\/\/([^/?#:]+)/i.exec(record.canonicalUrl)?.[1]?.toLowerCase();
    if (!host) return null;
    const recorded = Date.parse(record.recordedAt);
    for (const day of [0, -1, 1].map(offset => datePath(new Date(recorded + offset * 86_400_000).toISOString()))) {
      const prefix = `project/${project}/source/${host}/${day}/${record.workItemId}/`;
      if (!listed.has(prefix)) listed.set(prefix, store.list(prefix).catch(() => []));
      const key = (await listed.get(prefix)!).find(k => k.startsWith(`${prefix}${record.contentHash}.`) && !k.endsWith(".meta.json"));
      if (!key) continue;
      const object = await store.get(key);
      const m = object?.meta.custom;
      if (!object || !m || object.meta.contentHash !== record.contentHash) return null;
      if (m.tier !== record.tier || m.canonicalUrl !== record.canonicalUrl || record.partial) return null;
      const artifact: Artifact = { id: record.artifactId, tier: record.tier, contentHash: record.contentHash, byteLength: record.byteLength,
        contentType: record.contentType, canonicalUrl: record.canonicalUrl, retrievalUrl: m.retrievalUrl ?? record.canonicalUrl,
        retrievedAt: m.retrievedAt ?? record.recordedAt, httpStatus: Number(m.httpStatus), headers: {}, sourceId: m.sourceId,
        methodRouteId: m.methodRouteId, workItemId: m.workItemId, attemptId: m.attemptId,
        permission: m.permission as Artifact["permission"], transport: m.transport as Artifact["transport"],
        retentionPolicy: m.retentionPolicy as Artifact["retentionPolicy"],
        ...(m.extraction ? { extraction: JSON.parse(m.extraction) as Artifact["extraction"] } : {}) };
      try {
        const { input } = await readForParser(store, project, artifact);
        return { evidence: evidenceProjection(input), observedAt: artifact.retrievedAt,
          httpStatus: artifact.httpStatus, transport: artifact.transport,
          partial: artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC" || artifact.extraction?.complete === false };
      } catch { return null; }
    }
    return null;
  };
}

export function localHeldCaptureReader() {
  return heldCaptureReader(new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR)));
}

export async function publicationCaptureReaders(repos: Pick<import("../control-plane/repository/types.ts").ControlPlaneRepositories, "adminConfig">,
  readCapture: (id: string, results: readonly WorkerResultRecord[]) => Promise<WorkerPublicationCapture>,
  readHeld: (record: ArtifactRecord) => Promise<WorkerPublicationCapture | null> = localHeldCaptureReader()) {
  const sourcePolicy = await readPublicationSourcePolicy(repos);
  return {
    readCapture: async (id: string, results: readonly WorkerResultRecord[]) => ({ ...await readCapture(id, results), sourcePolicy }),
    readHeld: async (record: ArtifactRecord) => { const capture = await readHeld(record); return capture ? { ...capture, sourcePolicy } : null; },
  };
}
