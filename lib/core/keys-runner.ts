import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { testDueKeys } from "./keys-test.ts";
import type { BriefProblem } from "../counts/problem-groups.ts";
import type { KeyView } from "./keys-model.ts";
import { importExistingKeys } from "./keys-import.ts";
import { billingCollectorEnvironment } from "../control-plane/provider-billing-environment.ts";
import type { IndependentRuntimeLane } from "../ops/independent-runtime-pass.ts";

export function savedKeysLane(run: () => Promise<void>): IndependentRuntimeLane {
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

let checkFailuresAfterStart = true;

/** Uses the same control-plane connection as Admin. No Admin request or Google session is involved. */
export async function keysRunnerPass(store: KeysStore = productionKeysStore(), at = new Date().toISOString()): Promise<void> {
  if (process.env.WTP_RUNTIME_MODE === "production") {
    const env = billingCollectorEnvironment();
    if (!env.GH_TOKEN && !env.GITHUB_TOKEN && !(await store.list(true)).some(row => row.name === "GH_TOKEN" || row.name === "GITHUB_TOKEN")) {
      const { runtimeGithubCredential } = await import("../ops/runtime-release-handoff.ts");
      env.GH_TOKEN = runtimeGithubCredential({ root: process.cwd(), env }) ?? undefined;
    }
    await importExistingKeys(env, store, at);
    if (checkFailuresAfterStart) {
      for (const row of await store.list()) if (!row.working) await store.retest(row.name, at);
      checkFailuresAfterStart = false;
    }
  }
  await testDueKeys(store, at);
  const keys = await store.list();
  await Promise.all(keys.map(async row => { await store.read(row.name, true, at); }));
}
