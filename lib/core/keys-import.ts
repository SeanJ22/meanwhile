import { KEY_NAMES } from "./keys-model.ts";
import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { testDueKeys } from "./keys-test.ts";

/** Migration only: an existing saved key wins over a stale server setting. Removed after both runtimes migrate. */
export async function importExistingKeys(env: Readonly<Record<string, string | undefined>>, store: KeysStore = productionKeysStore(env),
  at = new Date().toISOString(), source: "runner" | "website" = "runner"): Promise<void> {
  const held = new Map((await store.list(true)).map(row => [row.name, row]));
  for (const [name, service] of Object.entries(KEY_NAMES)) {
    const value = env[name]?.trim();
    if (!value) continue;
    let existing = held.get(`${name}.${source}`) ?? held.get(name);
    if (!existing) {
      if (await store.save(name, value, service, at, true, source)) continue;
      // Another runtime may have won the insert with a different key under the same name.
      existing = (await store.list(true)).find(row => row.name === name);
      if (!existing) continue;
    }
    if (existing?.deleted || existing?.importedFrom.includes(source)) continue;
    if (existing.importedFrom.length === 0 || existing.importedFrom.includes("owner") || await store.read(existing.name) === value) {
      await store.markImported(existing.name, source);
    } else await store.save(`${name}.${source}`, value, service, at, true, source, { name: existing.name, version: existing.version });
  }
  await testDueKeys(store, at, undefined, undefined, source);
}
