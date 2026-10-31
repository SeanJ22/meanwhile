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

/** Presence evidence lives in the existing owner log; no values or ciphertext are recorded. */
export async function importRuntimeKeys(env: Readonly<Record<string, string | undefined>>, source: "runner" | "website", at: string,
  store: KeysStore = productionKeysStore(env), write?: (record: import("../control-plane/owner-surface.ts").OwnerDigestRecord) => Promise<void>): Promise<void> {
  await importExistingKeys(env, store, at, source);
  const present = Object.keys(KEY_NAMES).filter(name => Boolean(env[name]?.trim())), absent = Object.keys(KEY_NAMES).filter(name => !env[name]?.trim());
  const { createHash } = await import("node:crypto");
  const id = `${source}:${createHash("sha256").update(JSON.stringify([KEY_NAMES, present])).digest("hex")}`;
  if (recorded.has(id)) return;
  const record = { formatVersion: 1, digestId: id, writtenAt: at, headline: `Saved-key copy from the ${source}`,
    lines: [`Present: ${present.join(", ")}`, `Absent: ${absent.join(", ")}`], cycleOk: null,
    testedSha: env.WTP_RUNTIME_AUTHORITY_SHA ?? env.COMMIT_REF ?? null };
  if (write) await write(record);
  else {
    const { createPgRepositories } = await import("../control-plane/repository/pg-store.ts");
    const repos = await createPgRepositories(env.WTP_CONTROL_PLANE_DATABASE_URL!, at, { skipBootstrap: true });
    await repos.ownerDigests.append(`keys-copy:${source}`, id, (await repos.ownerDigests.readEntry!(`keys-copy:${source}`, id))?.record ?? record, at);
  }
  recorded.add(id);
}
const recorded = new Set<string>();
