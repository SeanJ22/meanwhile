import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  STATE_CAMPAIGN_FINANCE_SOURCES,
  stateCampaignFinanceCandidate,
  type StateCampaignFinanceJurisdiction,
} from "../lib/funding/data-plane.ts";
import {
  refreshStateMoneyFromPromoted,
  resetStateMoneyCache,
} from "../lib/funding/state-snapshot.ts";
import type { StateMoneySnapshot } from "../lib/funding/state-money.ts";
import { stateMoneyAskProof } from "../scripts/lib/reader-ask-money-proof.ts";

const PROMOTED_AT = "2026-09-08T12:00:00.000Z";
const SOURCE_URLS: Readonly<Record<StateCampaignFinanceJurisdiction, string>> = {
  AZ: "https://seethemoney.az.gov/Reporting/GetNEWTableData/",
  NH: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails",
  NJ: "https://www.njelecefilesearch.com/SearchEntityByLocation",
};

function stateMoneyFixture(state: StateCampaignFinanceJurisdiction): StateMoneySnapshot {
  return JSON.parse(readFileSync(join(
    process.cwd(),
    "data",
    "states",
    state.toLowerCase(),
    "funding",
    `state-money-${state.toLowerCase()}-2026.json`,
  ), "utf8")) as StateMoneySnapshot;
}

async function installPromotedStateMoneyAuthority(): Promise<void> {
  const store = new MemoryRoutineDataStore();
  for (const state of Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]) {
    const snapshot = stateMoneyFixture(state);
    const candidate = stateCampaignFinanceCandidate({
      jurisdiction: state,
      snapshot,
      rawBodies: [JSON.stringify(snapshot)],
      requestedUrl: SOURCE_URLS[state],
      finalUrl: SOURCE_URLS[state],
      retrievedAt: `${snapshot.collectedAt}T00:00:00.000Z`,
      query: `deterministic complete ${state} state campaign-finance test projection`,
      paginationComplete: true,
      declaredTotal: snapshot.records.length,
    });
    const outcome = await processRegisteredManualCandidate(
      store,
      STATE_CAMPAIGN_FINANCE_SOURCES[state].contractId,
      candidate,
      PROMOTED_AT,
    );
    assert.equal(outcome.candidate.state, "PROMOTED");
  }
  await refreshStateMoneyFromPromoted({ store, bypassCache: true, now: PROMOTED_AT });
}

test("every current eligible state-money target survives the actual Ask route with exact totals, provenance, gap states and counts", async (t) => {
  resetStateMoneyCache();
  t.after(() => resetStateMoneyCache());
  await installPromotedStateMoneyAuthority();
  const result = await stateMoneyAskProof();
  assert.ok(result.proofs.length >= 297);
  assert.ok(result.proofs.some((proof) => proof.expectedFinance.some((record) => record.filingState === "OURS_GAP")));
  assert.deepEqual(result.proofs.filter((proof) => proof.status !== "PROVEN").map((proof) => ({ target: proof.target, missing: proof.missing, unexpected: proof.unexpected, countAgrees: proof.countAgrees })), []);
  const hobbs = result.proofs.find((proof) => proof.target === "ballot-az-pima:governor:hobbs-katie")!;
  const held = hobbs.returnedRecords.find((record) => record.finance?.filingState === "FILED")!;
  assert.equal(held.finance?.totals.receipts, 11109719.95);
  assert.equal(held.finance?.totals.expenditures, 14355612.69);
  const biggs = result.proofs.find((proof) => proof.target === "ballot-az-pima:governor:biggs-andy")!;
  assert.ok(biggs.returnedRecords.every((record) => record.canonicalSubjectId !== hobbs.target));
});
