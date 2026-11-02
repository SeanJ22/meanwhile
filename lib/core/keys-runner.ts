import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { refreshSavedKeys } from "./keys-runtime.ts";
import { testDueKeys } from "./keys-test.ts";
import type { BriefProblem } from "../counts/problem-groups.ts";
import type { KeyView } from "./keys-model.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";

export function savedKeysLane(run: IndependentRuntimeLane["run"]): IndependentRuntimeLane {
  return { id: "saved-keys", everyMs: 60_000, budgetMs: 30_000, run };
}

export function keyProblems(keys: readonly KeyView[], at: string): readonly BriefProblem[] {
  return keys.flatMap(key => {
    const overdue = !key.testedAt || Date.parse(at) - Date.parse(key.testedAt) >= 86_400_000;
    if (key.working && !overdue) return [];
    return [{ key: `saved-key:${key.name}`, what: `${key.label}: ${overdue ? "the daily key check is overdue." : key.says}`,
      owner: "The team", next: `Open Settings and check the key used for ${key.purpose.toLowerCase()}.` }];
  });
}

let firstPass = true;

/** The standing reader refreshes directly from the control plane and opens changed versions. */
export async function keysRunnerPass(injected?: KeysStore, at = new Date().toISOString()): Promise<void> {
  if (!injected) await refreshSavedKeys("runner", true);
  const store = injected ?? productionKeysStore();
  if (!injected && firstPass) { for (const key of await store.list()) if (!key.working) await store.retest(key.name, at); firstPass = false; }
  await testDueKeys(store, at);
  // Explicit fixtures exercise the same direct read contract without connecting to a live runtime.
  if (injected) await Promise.all((await store.list()).map(async row => { await store.read(row.name, true, at); }));
}
