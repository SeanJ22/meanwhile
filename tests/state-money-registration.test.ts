import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stateCampaignFinanceRegistration, stateCampaignFinanceSources, type StateCampaignFinanceRegistration } from "../lib/funding/data-plane.ts";
import { directFundingTargetPlan } from "../lib/funding/target-authorities.ts";
import { readStateMoneyProjections, settleStateMoneyReads } from "../lib/funding/state-snapshot.ts";
import { generateStateMoneyRegistrations, holdsStateCampaignReports } from "../scripts/state-money-registrations.mts";

function temporary(t: test.TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "s16-money-registration-"));
  t.after(() => { assert.equal(dirname(resolve(root)), resolve(tmpdir())); rmSync(root, { recursive: true, force: true }); });
  return root;
}
function put(root: string, path: string, value: string) { const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, value); }
const registration = (state: string): StateCampaignFinanceRegistration => ({
  jurisdiction: state, cycle: 2028, contractId: `${state.toLowerCase()}-campaign-finance`, sourceId: `${state.toLowerCase()}-campaign-finance`,
  scope: `US-${state}:campaign-finance:2028`, parserVersion: "state-money/1",
  agencies: [{ name: "TEST FICTIONAL FILING OFFICE", url: "https://test-office.gov", recordsHeld: "State Campaign Finance Reports", page: 1, row: 1 }],
  source: { url: "https://test-source.gov/directory.pdf", dataset: "TEST FIXTURE", sha256: "a".repeat(64), archiveSha256: "b".repeat(64) },
});

test("adding a sourced state registration is a data step on the same existing reader", t => {
  const root = temporary(t), sources = stateCampaignFinanceSources(root);
  put(root, "data/states/tn/funding/source-registration.json", JSON.stringify(registration("TN")));
  put(root, "data/states/nj/funding/source-registration.json", "UNREAD SIBLING");
  assert.equal(sources.TN.scope, "US-TN:campaign-finance:2028");
  assert.equal(Object.hasOwn(sources, "TX"), false);
  put(root, "data/states/tx/funding/source-registration.json", JSON.stringify(registration("TX")));
  assert.equal(Object.hasOwn(sources, "TX"), true);
  assert.equal(sources.TX.jurisdiction, "TX");
  assert.deepEqual(Object.keys(sources), ["NJ", "TN", "TX"]);
  assert.throws(() => sources.NJ, /JSON/);
  assert.throws(() => stateCampaignFinanceRegistration("../tn", root), /UNRECORDED/);
  put(root, "data/states/tx/funding/source-registration.json", JSON.stringify(registration("TN")));
  assert.throws(() => sources.TX, /STATE_MONEY_REGISTRATION_INVALID:TX/);
});

test("one selected nonpilot state pointer is read; a country preload does no implicit I/O", async () => {
  const calls: string[] = [];
  const store = { readPromotion: async (_recordClass: unknown, scope: string) => { calls.push(scope); return null; },
    readCandidate: async () => { throw new Error("a missing pointer has no candidate"); } };
  const options = { store, bypassCache: true, now: "2026-10-01T00:00:00Z" };
  assert.equal((await readStateMoneyProjections(["TN"], options)).get("TN")?.kind, "NOT_RECORDED");
  assert.deepEqual(calls, ["US-TN:campaign-finance:2026"]);
  calls.length = 0;
  assert.equal((await readStateMoneyProjections([], options)).size, 0);
  assert.equal(await settleStateMoneyReads(), null);
  assert.deepEqual(calls, []);
  for (const state of ["tn", "pa", "tx", "dc", "co"]) {
    assert.equal(directFundingTargetPlan(`ballot-${state}-any-county:school-board:test-person`).state, state.toUpperCase());
  }
});

test("held-directory generator preserves source identities and rejects federal-only reports", async t => {
  const root = temporary(t);
  put(root, "data/reference/acs5_2024_b01003_state.csv", "state_fips,name,population,margin_of_error\n47,Tennessee,1,\n36,New York,1,\n");
  put(root, "data/reference/fec_combined_federal_state_disclosure_directory.csv", "jurisdiction,office,records_held,url,email,phone,directory_page\nTENNESSEE,TEST OFFICE,State Campaign Finance Reports,https://test-tn.gov,,,5\nNEW YORK,TEST OFFICE,Local Campaign Disclosure Reports,https://test-ny.gov,,,7\nNEW YORK,FEDERAL ELECTION COMMISSION,Federal Campaign Finance Reports,https://www.fec.gov,,,8\n");
  put(root, "data/reference/fec_combined_federal_state_disclosure_directory.md", `Source document: https://test-source.gov/directory.pdf\nSHA-256: ${"c".repeat(64)}\n`);
  put(root, "data/states/ny/funding/source-registration.json", JSON.stringify({ ...registration("NY"), sourceId: "existing-data-identity", contractId: "existing-data-identity" }));
  await generateStateMoneyRegistrations(root, ["TN", "NY"], 2028);
  const held = stateCampaignFinanceRegistration("NY", root);
  assert.equal(held.sourceId, "existing-data-identity");
  assert.equal(held.agencies.length, 1); assert.equal(held.agencies[0].row, 2); assert.equal(held.agencies[0].page, 7);
  assert.equal(held.source.archiveSha256, "c".repeat(64)); assert.match(held.source.sha256, /^[a-f0-9]{64}$/);
  assert.equal(holdsStateCampaignReports("Federal Campaign Finance Reports; Personal Financial Reports"), false);
  assert.equal(holdsStateCampaignReports("Federal Campaign Finance Reports; State Campaign Finance Reports"), true);
});
