import type { EvidenceStore } from "../evidence/store.ts";
import type { ArtifactRecord } from "../repository/types.ts";

/** Legacy identities lack a saved object key. Scan the small key index a page at a time, retaining this work's matches only. */
export async function artifactVaultKeys(store: EvidenceStore, project: string, records: readonly ArtifactRecord[]): Promise<string[]> {
  const suffixes = records.map(record => `/${record.workItemId}/${record.contentHash}.`);
  const keys: string[] = [];
  const visit = (key: string) => { if (suffixes.some(suffix => key.includes(suffix)) && !key.endsWith(".meta.json")) keys.push(key); };
  if (store.visitKeys) await store.visitKeys(`project/${project}/`, visit);
  else for (const key of await store.list(`project/${project}/`)) visit(key);
  return keys.sort();
}
