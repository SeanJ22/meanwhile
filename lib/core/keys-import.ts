import { KEY_NAMES } from "./keys-model.ts";
import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { testDueKeys } from "./keys-test.ts";

/** Migration only: an existing saved key wins over a stale server setting. Removed after both runtimes migrate. */
export async function importExistingKeys(env: NodeJS.ProcessEnv, store: KeysStore = productionKeysStore(env),
  at = new Date().toISOString(), source: "runner" | "website" = "runner"): Promise<void> {
  const held = new Map((await store.list(true)).map(row => [row.name, row]));
  for (const [name, service] of Object.entries(KEY_NAMES)) {
    const value = env[name]?.trim();
    if (!value) continue;
    const existing = held.get(`${name}.${source}`) ?? held.get(name);
    if (existing?.deleted || existing?.importedFrom.includes(source)) continue;
    if (existing && (existing.importedFrom.length === 0 || await store.read(existing.name) === value)) {
      await store.markImported(existing.name, source);
    } else await store.save(existing ? `${name}.${source}` : name, value, service, at, true, source);
  }
  await testDueKeys(store, at);
}
