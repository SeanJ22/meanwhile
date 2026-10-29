import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { testDueKeys } from "./keys-test.ts";
import type { BriefProblem } from "../counts/problem-groups.ts";
import type { KeyView } from "./keys-model.ts";

export function keyProblems(keys: readonly KeyView[], at: string): readonly BriefProblem[] {
  return keys.flatMap(key => {
    const overdue = !key.testedAt || Date.parse(at) - Date.parse(key.testedAt) >= 86_400_000;
    if (key.working && !overdue) return [];
    return [{ key: `saved-key:${key.name}`, what: `${key.name}: ${overdue ? "the daily key check is overdue." : key.says}`,
      owner: "The team", next: `Open Settings and check the key used for ${key.purpose.toLowerCase()}.` }];
  });
}

/** Uses the same control-plane connection as Admin. No Admin request or Google session is involved. */
export async function keysRunnerPass(store: KeysStore = productionKeysStore(), at = new Date().toISOString()): Promise<void> {
  await testDueKeys(store, at);
  const keys = await store.list();
  await Promise.all(keys.map(async row => { await store.read(row.name, true, at); }));
}
