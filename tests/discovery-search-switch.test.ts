/**
 * **PAID DISCOVERY SEARCH IS THE OWNER'S SWITCH, AND THE RUNNER OBEYS IT.**
 * (NS28, decided 2026-09-24: meetings discovery is always on; paid search stays
 * off until the owner turns it on in Admin.)
 *
 * What these tests hold:
 *
 * - **Off until he says so.**
 *   - A fresh control plane, a never-decided row, a malformed decision and a
 *     corrupt row all read OFF.
 *   - Only an explicit `true` reads ON.
 * - **An owner decision, said twice to turn on, recorded durably.**
 *   - `config.setDiscoverySearch` is OWNER_DECISION_REQUIRED.
 *   - Turning it on without a confirmation writes nothing.
 *   - The decision carries who and when, and the receipt that made it.
 *   - It leaves the row's other decisions standing.
 * - **The runner obeys it.**
 *   - At cycle start the runner reads the switch from the row it reads the
 *     ceiling from.
 *   - It builds no search step unless the switch is on.
 *   - It names the switch in its record.
 *   - Meetings discovery is on unless the kill switch says off.
 * - **The console posts it.** The switch sits on the search line of the Money
 *   screen, and turning it on posts the confirmation.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { receiptIdFor, type ActionRequest } from "@/lib/control-plane/gateway/contract.ts";
import { submit } from "@/lib/control-plane/gateway/gateway.ts";
import { lookupAction, type GatewayDeps } from "@/lib/control-plane/gateway/registry.ts";
import {
  ADMIN_CONFIG_ID,
  defaultAdminConfig,
  discoverySearchEnabled,
  withDiscoverySearch,
  withFleetSpendCeiling,
  type AdminConfig,
} from "@/lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import type { ControlPlaneRepositories } from "@/lib/control-plane/repository/types.ts";

const ROOT = process.cwd();
const NOW = "2026-09-24T16:00:00.000Z";

function deps(repos: ControlPlaneRepositories): GatewayDeps {
  let ms = Date.parse(NOW);
  return {
    repos,
    now: () => {
      const at = new Date(ms).toISOString();
      ms += 1000;
      return at;
    },
    currentStateVersion: "world-1",
    codeSha: null,
    recordReview: null,
  };
}

function ask(input: Record<string, unknown>, idempotencyKey: string, over: Partial<ActionRequest> = {}): ActionRequest {
  return {
    type: "config.setDiscoverySearch",
    subject: "paid discovery search",
    input,
    stateVersion: "world-1",
    idempotencyKey,
    caller: "OWNER_SESSION",
    actorRef: "adm_test-session",
    ...over,
  };
}

test("OFF UNTIL HE SAYS SO: a fresh store, a never-decided row, a malformed decision and a corrupt row all read off", async () => {
  assert.equal(discoverySearchEnabled(null), false, "no row at all");
  assert.equal(discoverySearchEnabled(defaultAdminConfig()), false, "a row that never decided");
  assert.equal(defaultAdminConfig().discoverySearch, undefined, "a default is not a decision");
  const malformed = { ...defaultAdminConfig(), discoverySearch: { enabled: "yes" } } as unknown as AdminConfig;
  assert.equal(discoverySearchEnabled(malformed), false, "only an explicit true is on");
  const decided = withDiscoverySearch(defaultAdminConfig(), { enabled: true, decidedAt: NOW, decidedBy: "adm_x", receiptId: "r1" });
  assert.equal(discoverySearchEnabled(decided), true);
  assert.equal(discoverySearchEnabled(withDiscoverySearch(decided, { enabled: false, decidedAt: NOW, decidedBy: "adm_x", receiptId: "r2" })), false);

  const withCeiling = withFleetSpendCeiling(defaultAdminConfig(), { rollingCeilingUsd: 40, previousUsd: 25, decidedAt: NOW, decidedBy: "adm_x", receiptId: "c1" });
  const both = withDiscoverySearch(withCeiling, { enabled: true, decidedAt: NOW, decidedBy: "adm_x", receiptId: "r3" });
  assert.equal(both.fleetSpendCeiling?.rollingCeilingUsd, 40, "the row's other decisions stand");
  assert.equal(both.apiFallback.enabled, false);
});

test("AN OWNER DECISION, SAID TWICE TO TURN ON, RECORDED DURABLY", async () => {
  assert.equal(lookupAction("config.setDiscoverySearch")?.definition.authority, "OWNER_DECISION_REQUIRED");
  const repos = createMemoryRepositories();

  const unconfirmed = await submit(ask({ enabled: "true" }, "discovery-search-01"), deps(repos));
  assert.equal(unconfirmed.ok, false);
  assert.equal(unconfirmed.receipt.refusal, "INVALID_INPUT");
  assert.match(unconfirmed.receipt.says, /explicit confirmation/i);
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null, "an unconfirmed request wrote the policy");

  const agent = await submit(ask({ enabled: "true", confirmed: "true" }, "discovery-search-02", { caller: "AGENT" }), deps(repos));
  assert.equal(agent.ok, false, "an agent may not turn paid search on");
  assert.equal(await repos.adminConfig.read(ADMIN_CONFIG_ID), null);

  const on = await submit(ask({ enabled: "true", confirmed: "true" }, "discovery-search-03"), deps(repos));
  assert.equal(on.ok, true, on.receipt.says);
  const stored = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(stored?.value.discoverySearch?.enabled, true);
  assert.equal(stored?.value.discoverySearch?.decidedBy, "adm_test-session");
  assert.equal(stored?.value.discoverySearch?.receiptId, receiptIdFor("config.setDiscoverySearch", "discovery-search-03"));
  assert.equal(discoverySearchEnabled(stored?.value ?? null), true);
  assert.match(on.receipt.says, /inside the runner's per-cycle and per-day caps/);
  assert.match(on.receipt.says, /next cycle/);

  const off = await submit(ask({ enabled: "false" }, "discovery-search-04"), deps(repos));
  assert.equal(off.ok, true, off.receipt.says);
  const after = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(after?.value.discoverySearch?.enabled, false);
  assert.equal(after?.revision, 2, "turning it off replaced the row it turned on");
  assert.match(off.receipt.says, /free site walks continue/);
});

test("A CORRUPT ROW NEVER TURNS PAID SEARCH ON, and turning it off over one writes a real row", async () => {
  const repos = createMemoryRepositories();
  await repos.adminConfig.put(ADMIN_CONFIG_ID, { nonsense: true } as unknown as AdminConfig, NOW);
  const outcome = await submit(ask({ enabled: "false" }, "discovery-search-05"), deps(repos));
  assert.equal(outcome.ok, true, outcome.receipt.says);
  const stored = await repos.adminConfig.read(ADMIN_CONFIG_ID);
  assert.equal(stored?.value.discoverySearch?.enabled, false);
});

test("THE RUNNER OBEYS IT: the switch is read at cycle start, no search step is built unless it is on, and discovery is on unless killed", () => {
  const runner = readFileSync(join(ROOT, "scripts/freshness-shadow.mts"), "utf8");
  assert.match(runner, /discoverySearchOn = discoverySearchEnabled\(config\);/, "read from the config row");
  const read = runner.indexOf("discoverySearchOn = discoverySearchEnabled(config);");
  const phase = runner.indexOf("meetingsDiscovery = await runMeetingsDiscovery(repos, {");
  assert.ok(read > 0 && phase > read, "the switch is read before the discovery phase");
  assert.match(runner, /const searchBudget = !discoverySearchOn \? null : durableSearchBudget\(\{/, "no budget, and no ledger write, while off");
  assert.match(runner, /const discoverySearch = searchBudget === null \? null : makeDiscoverySearch\(\{/, "no search step while off");
  assert.match(runner, /ownerSwitch: discoverySearchDecision,/, "the record names the switch");
  assert.match(runner, /const MEETINGS_DISCOVERY_ENABLED = process\.env\.WTP_MEETINGS_DISCOVERY !== "off";/, "on unless the kill switch says off");
});

test("THE CONSOLE POSTS IT: the switch rides the search line, and turning it on posts the confirmation", () => {
  const controls = readFileSync(join(ROOT, "app/(admin)/_mw/money-controls.tsx"), "utf8");
  assert.match(controls, /export function DiscoverySearchSwitch\(/);
  assert.match(controls, /"config\.setDiscoverySearch",\s*"paid discovery search",\s*enabled \? \{ enabled: true, confirmed: true \} : \{ enabled: false \}/);
  const screen = readFileSync(join(ROOT, "app/(admin)/_mw/screens/money.tsx"), "utf8");
  assert.match(screen, /searchSwitch=\{r\.key === "ledger-search" \? searchSwitch : null\}/, "only the search line carries it");
  assert.match(screen, /on: discoverySearchEnabled\(base\.adminConfig\)/, "the page reads the same row the runner reads");
});
