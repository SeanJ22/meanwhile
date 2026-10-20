import type { ControlPlaneRepositories } from "../control-plane/repository/types.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";
import { researchVaultResolver } from "../control-plane/workers/vault-object.ts";
import { workerVaultResolver } from "../control-plane/workers/vault.ts";
import { artifactVaultKeys } from "../control-plane/workers/vault-keys.ts";

/** Keep every observation of each identity in log order: an earlier one may lack bytes a later one holds. Nothing is cached across jobs. */
export function publicationVaultReaders(repos: ControlPlaneRepositories, store: EvidenceStore, project = "freshness") {
  let active: {id: string; readers: Promise<{
    readObject: ReturnType<typeof researchVaultResolver>;
    readEvidence: ReturnType<typeof workerVaultResolver>;
  }> } | undefined;
  const forArtifact = (id: string) => {
    if (active?.id !== id) {
      active = { id, readers: (async () => {
        const keys = await repos.artifacts.keysWhere(["artifactId"],id);
        const byKey = new Map<string, Awaited<ReturnType<typeof repos.artifacts.read>>>();
        for (const key of keys) byKey.set(key, await repos.artifacts.readWhere(key,["artifactId"],id));
        const records = [...byKey.values()].flat();
        let vaultKeys: Promise<string[]> | undefined;
        const scopedStore: EvidenceStore = {put:store.put.bind(store),get:store.get.bind(store),head:store.head.bind(store),
          list: async () => vaultKeys ??= artifactVaultKeys(store,project,records),
          visitKeys: async (_prefix,visit) => { for (const key of await (vaultKeys ??= artifactVaultKeys(store,project,records))) if (await visit(key)===false) break; } };
        const scoped = {...repos,artifacts:{...repos.artifacts, keysWhere:async()=>keys, readWhere:async(key:string)=>byKey.get(key)??[]}};
        return {
          readObject: researchVaultResolver(scoped, scopedStore, project, { snapshot: true }),
          readEvidence: workerVaultResolver(scoped, scopedStore, project, { snapshot: true }),
        };
      })() };
    }
    return active.readers;
  };
  return {
    readObject: async (id: string) => (await forArtifact(id)).readObject(id),
    readEvidence: async (id: string) => (await forArtifact(id)).readEvidence(id),
  };
}
