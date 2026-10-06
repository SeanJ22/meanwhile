import type { ArtifactRecord, ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { workerVaultResolver } from "../control-plane/workers/vault.ts";

/** A publication job resolves only the artifact identities it actually uses.
 * Keep all observations of each identity, in the original log order: an earlier
 * acquisition may have missing bytes while a later one is still held. The two
 * existing provenance validators share that bounded metadata read. Nothing is
 * cached across jobs, including a missing artifact or a failed lookup.
 */
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
        let records: readonly ArtifactRecord[];
        if (repos.artifacts.keysWhere) {
          const keys = await repos.artifacts.keysWhere(["artifactId"], id);
          records = (await Promise.all(keys.map(key => repos.artifacts.readWhere(key, ["artifactId"], id)))).flat();
        } else {
          // Legacy/test providers without filtered reads retain their exact
          // behavior. Postgres uses its existing artifact-id expression index.
          records = (await repos.artifacts.readAll()).filter(row => row.artifactId === id);
        }
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
