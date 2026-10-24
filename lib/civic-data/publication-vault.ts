import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { artifactRecords, workerVaultResolver } from "../control-plane/workers/vault.ts";

/** Keep every observation of each identity in log order: an earlier one may lack bytes a later one holds. Nothing is cached across jobs. */
export function publicationVaultReaders(repos: ControlPlaneRepositories, store: EvidenceStore, project = "freshness") {
  let keys: Promise<string[]> | undefined;
  const evidenceStore: EvidenceStore = {
    put: store.put.bind(store), get: store.get.bind(store), head: store.head.bind(store),
    list: prefix => prefix === `project/${project}/`
      ? keys ??= store.list(prefix) : store.list(prefix),
  };
  const readers = new Map<string, Promise<{
    readObject: ReturnType<typeof researchVaultResolver>;
    readEvidence: ReturnType<typeof workerVaultResolver>;
  }>>();
  const forArtifact = (id: string) => {
    let reading = readers.get(id);
    if (!reading) {
      reading = (async () => {
        const records = await artifactRecords(repos, id);
        const scoped = { ...repos, artifacts: { ...repos.artifacts, readAll: async () => records } };
        return {
          readObject: researchVaultResolver(scoped, evidenceStore, project, { snapshot: true }),
          readEvidence: workerVaultResolver(scoped, evidenceStore, project, { snapshot: true }),
        };
      })();
      readers.set(id, reading);
    }
    return reading;
  };
  return {
    readObject: async (id: string) => (await forArtifact(id)).readObject(id),
    readEvidence: async (id: string) => (await forArtifact(id)).readEvidence(id),
  };
}
