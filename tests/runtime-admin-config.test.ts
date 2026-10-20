import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_CONFIG_ID, adminConfigForPaidWork, defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readRuntimeAdminConfig } from "../lib/control-plane/runtime-admin-config.ts";
import { runnerControlReader } from "../scripts/pilot-runtime-control.mts";

const NOW = "2026-10-20T18:00:00.000Z";

test("runner controls preserve owner policy while leaving retained country payloads in the store", async () => {
  const repos = createMemoryRepositories();
  const policy = { ...defaultAdminConfig(NOW), settings: { "fact.window-hours": 24 },
    fleetSpendCeiling: { rollingCeilingUsd: 12, previousUsd: 50, decidedAt: NOW, decidedBy: "owner", receiptId: "ceiling" },
    discoverySearch: { enabled: false, decidedAt: NOW, decidedBy: "owner", receiptId: "search" },
    placeTargets: [], expansionScopes: [], dataSwitches: [] };
  const history = Array.from({ length: 10_000 }, (_, id) => ({ id, text: "retained country history" }));
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...policy, fixList: history, updates: history, methodStandings: history,
    settingHistory: history, latestBrief: { body: history }, routineRefreshRequests: history, routineDueRequests: history } as unknown as AdminConfig, NOW);
  repos.adminConfig.read = async () => { throw new Error("whole config should never be transferred"); };
  repos.adminConfig.mustRead = async () => { throw new Error("whole config should never be transferred"); };
  const read = runnerControlReader("unused", repos, { query: async () => [{ research: [], windows: [], config: "1", state: "1" }] });
  assert.deepEqual((await read.read()).config?.value, policy);
  const setting = await readRuntimeAdminConfig(repos, ["settings"]);
  assert.deepEqual(setting?.value, { ...defaultAdminConfig(NOW), settings: policy.settings });
  assert.equal(adminConfigForPaidWork({ row: (await read.read()).config }).config?.fleetSpendCeiling?.rollingCeilingUsd, 12);
  assert.deepEqual((await repos.adminConfig.readNarrowed(ADMIN_CONFIG_ID, { fixList: true }))?.value, { fixList: history },
    "runtime reads must not overwrite or trim the retained owner record");
});

test("runtime policy reads preserve absent, malformed and unreadable paid-work decisions", async () => {
  const repos = createMemoryRepositories();
  assert.equal(await readRuntimeAdminConfig(repos), null);
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { ...defaultAdminConfig(NOW), apiFallback: { enabled: "invalid" } } as unknown as AdminConfig, NOW);
  assert.match(adminConfigForPaidWork({ row: await readRuntimeAdminConfig(repos) }).holdPaidWork ?? "", /not a valid config/);
  repos.adminConfig.readNarrowed = async () => { throw new Error("policy socket closed"); };
  await assert.rejects(readRuntimeAdminConfig(repos), /policy socket closed/);
});
