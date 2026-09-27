import { join } from "node:path";
import { controlPlaneUrlFromEnv, createPgRepositories } from "../control-plane/repository/pg-store.ts";
import { DurableEvidenceStore } from "../control-plane/evidence/durable-store.ts";
import { VAULT_DIR } from "../control-plane/scheduler/vault.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { workerVaultResolver } from "../control-plane/workers/vault.ts";
import { evidenceProjection } from "../control-plane/workers/evidence-projection.ts";
import type { WorkerResultRecord } from "../control-plane/workers/types.ts";

/** Server-side publisher reads the same durable evidence used by the workers. */
export async function workerPublicationContext(now: string) {
  const connection = controlPlaneUrlFromEnv();
  if (!connection) throw new Error("WORKER_PUBLICATION_CONTROL_PLANE_UNAVAILABLE");
  const repos = await createPgRepositories(connection, now, { skipBootstrap: true });
  const vault = new DurableEvidenceStore(join(process.cwd(), ...VAULT_DIR));
  const readObject = researchVaultResolver(repos, vault, "freshness");
  const readEvidence = workerVaultResolver(repos, vault, "freshness", { snapshot: true });
  return { repos, readCapture: async (id: string, records: readonly WorkerResultRecord[]) => {
    const [{ artifact }, input] = await Promise.all([readObject(id), readEvidence(id)]);
    const evidence = evidenceProjection(input);
    const observations = records.flatMap(record => {
      const result = record.result;
      return result.role === "ACQUIRER" && result.verdict === "ACQUIRED"
        ? result.walk.filter(step => step.rung === result.source.retrieval && step.target === evidence.canonicalUrl &&
          step.transport === "REACHABLE" && step.outcome === "WALKED_AND_FOUND" && step.artifactIds.includes(id)).map(step => step.at) : [];
    });
    return { evidence, observedAt: [evidence.retrievedAt, ...observations].sort().at(-1)!, httpStatus: artifact.httpStatus,
      transport: artifact.transport, partial: artifact.httpStatus === 206 || artifact.retentionPolicy === "DIAGNOSTIC" || artifact.extraction?.complete === false };
  } };
}
