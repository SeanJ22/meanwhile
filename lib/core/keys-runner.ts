import { productionKeysStore, type KeysStore } from "./keys-store.ts";
import { testDueKeys } from "./keys-test.ts";
import type { BriefProblem } from "../counts/problem-groups.ts";
import type { KeyView } from "./keys-model.ts";
import { importRuntimeKeys } from "./keys-import.ts";
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

let firstPass = true;

/** Uses the same control-plane connection as Admin. No Admin request or Google session is involved. */
export async function keysRunnerPass(store: KeysStore = productionKeysStore(), at = new Date().toISOString(), dependencies: {
  readonly env?: NodeJS.ProcessEnv; readonly github?: () => string | null;
  readonly report?: Parameters<typeof importRuntimeKeys>[4];
} = {}): Promise<void> {
  if ((dependencies.env ?? process.env).WTP_RUNTIME_MODE === "production") {
    const env = dependencies.env ?? billingCollectorEnvironment();
    const savedGithub = (await store.list(true)).find(row => row.name === "GH_TOKEN");
    if (!env.GH_TOKEN?.trim() && savedGithub && !savedGithub.deleted) env.GH_TOKEN = await store.read("GH_TOKEN");
    if (!env.GH_TOKEN?.trim() && !savedGithub) {
      delete env.GH_TOKEN; if (!env.GITHUB_TOKEN?.trim()) delete env.GITHUB_TOKEN;
      const { runtimeGithubCredential } = await import("../ops/runtime-release-handoff.ts");
      env.GH_TOKEN = dependencies.github ? dependencies.github() ?? undefined : runtimeGithubCredential({ root: process.cwd(), env }) ?? undefined;
    }
    await importRuntimeKeys(env, "runner", at, store, dependencies.report);
    if (firstPass) { for (const key of await store.list()) if (!key.working) await store.retest(key.name, at); firstPass = false; }
  }
  await testDueKeys(store, at);
  const keys = await store.list();
  await Promise.all(keys.map(async row => { await store.read(row.name, true, at); }));
}
