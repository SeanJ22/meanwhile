import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { failedAcquisitionCandidate, normalizedHash } from "../lib/civic-data/candidate-builders.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import { manualCandidateContractIssue, processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import {
  PIMA_LOCAL_FINANCE_CONTRACT,
  STATE_CAMPAIGN_FINANCE_SOURCES,
  pimaCampaignFinanceCandidate,
  stateCampaignFinanceCandidate,
  stateCampaignFinanceMembers,
  type StateCampaignFinanceJurisdiction,
} from "../lib/funding/data-plane.ts";
import {
  readStateMoneyProjection,
  readStateMoneyProjections,
  refreshStateMoneyFromPromoted,
  resetStateMoneyCache,
  stateMoneyForTarget,
  stateMoneyProofInventory,
} from "../lib/funding/state-snapshot.ts";
import type { CivicDataReadStore } from "../lib/civic-data/read-model.ts";
import type { CandidateVersionRecord, PromotedProjection, RoutineRecordClass } from "../lib/civic-data/types.ts";
import { computeSplit, type StateMoneySnapshot } from "../lib/funding/state-money.ts";
import {
  azPimaHeld,
  azPimaTransactions,
  clearAzPimaFinanceProjectionForTest,
  refreshAzPimaFinanceFromPromoted,
  type AzPimaHeld,
  type AzPimaTransactions,
} from "../lib/control-plane/campaign-finance/held-records.ts";

const ROOT = process.cwd();
const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T13:00:00.000Z";
const URLS: Record<StateCampaignFinanceJurisdiction, string> = {
  AZ: "https://seethemoney.az.gov/Reporting/GetNEWTableData/",
  NH: "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails",
  NJ: "https://www.njelecefilesearch.com/SearchEntityByLocation",
};

function fixture(state: StateCampaignFinanceJurisdiction): StateMoneySnapshot {
  return JSON.parse(readFileSync(join(ROOT, "data", "states", state.toLowerCase(), "funding", `state-money-${state.toLowerCase()}-2026.json`), "utf8")) as StateMoneySnapshot;
}

function boundedSnapshot(state: StateCampaignFinanceJurisdiction): StateMoneySnapshot {
  const source = fixture(state);
  const record = structuredClone(source.records.find((row) => row.filingState === "FILED") ?? source.records[0]);
  const records = [record];
  const split = computeSplit(records, 1);
  return {
    ...source,
    records,
    split,
    byJurisdiction: {
      [state]: {
        inScope: 1,
        filed: split.filed,
        noReports: split.noReportsOnFile,
        lead: split.lead,
      },
    },
  };
}

function stateCandidate(state: StateCampaignFinanceJurisdiction, at = T0, raw = `official-${state}`) {
  const snapshot = boundedSnapshot(state);
  return stateCampaignFinanceCandidate({
    jurisdiction: state,
    snapshot,
    rawBodies: [raw],
    requestedUrl: URLS[state],
    finalUrl: URLS[state],
    retrievedAt: at,
    query: `deterministic bounded ${state} filing projection`,
    paginationComplete: true,
    declaredTotal: 1,
  });
}

test("AZ, NH, and NJ finance candidates bind exact source/class/scope and promote with record-level receipts", async () => {
  for (const state of Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[]) {
    const store = new MemoryRoutineDataStore();
    const candidate = stateCandidate(state);
    const contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
    assert.deepEqual(candidate.sourceProjectionEvidence, {
      kind: "SOURCE_PROJECTION_CONTRACT",
      sourceId: contract.sourceId,
      recordClass: "STATE_CAMPAIGN_FINANCE",
      scope: contract.scope,
    });
    assert.equal(manualCandidateContractIssue(contract.contractId, candidate), null);
    const outcome = await processRegisteredManualCandidate(store, contract.contractId, candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED");
    assert.equal(outcome.promoted?.versionId, candidate.id);
    assert.equal(outcome.readerReadback?.status, "PASS");
    assert.equal(outcome.readerReadback?.versionId, candidate.id);
    assert.equal(outcome.candidate.candidate.changeSet?.added.length, 1);
    assert.equal(outcome.candidate.candidate.changeSet?.changed.length, 0);
    assert.deepEqual((await store.events(candidate.id)).map((event) => event.state), ["FETCHED", "NORMALIZED", "VALIDATED", "PROMOTED", "PROMOTED"]);
  }
});

test("an official filing resolves the same candidacy's gap without treating it as an unexplained disappearance", () => {
  const base = fixture("AZ");
  const gap = base.records.find(record => record.filingState === "OURS_GAP" && record.targetKeys.length === 1);
  const filed = base.records.find(record => record.filingState === "FILED" && record.committeeId);
  assert.ok(gap && filed);
  const snapshot = (record: StateMoneySnapshot["records"][number]): StateMoneySnapshot => {
    const records = [record];
    const split = computeSplit(records, 1);
    return { ...base, records, split, byJurisdiction: { AZ: { inScope: 1, filed: split.filed,
      noReports: split.noReportsOnFile, lead: split.lead } } };
  };
  const prior = snapshot(gap);
  const resolved = snapshot({ ...filed, targetKeys: gap.targetKeys });
  const build = (next: StateMoneySnapshot) => stateCampaignFinanceCandidate({ jurisdiction: "AZ", snapshot: next,
    rawBodies: ["official-AZ"], requestedUrl: URLS.AZ, finalUrl: URLS.AZ, retrievedAt: T1,
    query: "bounded official filing projection", paginationComplete: true, declaredTotal: null });
  const successor = build(resolved);
  const check = (next: StateMoneySnapshot) => validateRoutineCandidate({ ...build(next),
    changeSet: candidateChangeSet(build(next), prior) }, null, T1).receipt.checks
    .find(row => row.code === "STATE_FINANCE_GAPS_RESOLVED_BY_OFFICIAL_FILINGS" ||
      row.code === "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED");
  assert.deepEqual(candidateChangeSet(successor, prior).removed.map(row => row.key), stateCampaignFinanceMembers(prior).map(row => row.key));
  assert.equal(check(resolved)?.verdict, "PASS");
  assert.equal(check(snapshot(filed))?.code, "INCOMPLETE_HORIZON_REMOVAL_UNEXPLAINED");
});

test("a bad state candidate and a failed source attempt preserve the prior GOOD pointer", async () => {
  const store = new MemoryRoutineDataStore();
  const good = stateCandidate("AZ");
  await processRegisteredManualCandidate(store, "az-sos-campaign-finance", good, T0);

  const invalid = stateCandidate("AZ", T1, "invalid-successor");
  const invalidRecord = (invalid.readModel as StateMoneySnapshot).records[0];
  const bad = {
    ...invalid,
    id: `${invalid.id}-bad`,
    semantics: { ...invalid.semantics, violations: ["official totals did not reconcile"] },
    dependentChecks: invalid.dependentChecks.map((check) => ({ ...check, passed: false })),
  };
  assert.ok(invalidRecord);
  const refused = await processRegisteredManualCandidate(store, "az-sos-campaign-finance", bad, T1);
  assert.equal(refused.promoted, null);
  assert.notEqual(refused.candidate.state, "PROMOTED");
  assert.equal((await store.readPromotion("STATE_CAMPAIGN_FINANCE", STATE_CAMPAIGN_FINANCE_SOURCES.AZ.scope))?.versionId, good.id);

  const failed = failedAcquisitionCandidate({
    sourceId: STATE_CAMPAIGN_FINANCE_SOURCES.AZ.sourceId,
    recordClass: "STATE_CAMPAIGN_FINANCE",
    scope: STATE_CAMPAIGN_FINANCE_SOURCES.AZ.scope,
    requestedUrl: URLS.AZ,
    attemptedAt: "2026-09-08T14:00:00.000Z",
    failureDetail: "official publisher unavailable",
    parserVersion: STATE_CAMPAIGN_FINANCE_SOURCES.AZ.parserVersion,
  });
  const failure = await processRegisteredManualCandidate(store, "az-sos-campaign-finance", failed, failed.retrieval.retrievedAt);
  assert.equal(failure.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("STATE_CAMPAIGN_FINANCE", STATE_CAMPAIGN_FINANCE_SOURCES.AZ.scope))?.versionId, good.id);
});

test("state Reader follows promoted pointers and never selects a tracked fixture after store failure", async () => {
  resetStateMoneyCache();
  const store = new MemoryRoutineDataStore();
  const good = stateCandidate("AZ");
  await processRegisteredManualCandidate(store, "az-sos-campaign-finance", good, T0);
  const reads = await readStateMoneyProjections({ store, bypassCache: true, now: T0 });
  assert.equal(reads.get("AZ")?.kind, "PROMOTED");
  const target = (good.readModel as StateMoneySnapshot).records[0].targetKeys[0];
  assert.ok(target);
  assert.equal(stateMoneyForTarget(target)[0]?.committeeId, (good.readModel as StateMoneySnapshot).records[0].committeeId);

  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { throw new Error("must not follow a missing pointer"); },
  };
  const failedReads = await readStateMoneyProjections({ store: brokenStore, bypassCache: true, now: T1 });
  assert.ok([...failedReads.values()].every((read) => read.kind === "STORE_UNREACHABLE"));
  assert.throws(() => stateMoneyForTarget(target), /Canonical state-money holding unavailable/);
});

test("documentary state-money proof inventory binds every promoted authority and fails closed otherwise", async () => {
  resetStateMoneyCache();
  assert.throws(() => stateMoneyProofInventory(), /AZ state campaign-finance Reader proof authority is STORE_UNREACHABLE/);

  const store = new MemoryRoutineDataStore();
  const candidates = (Object.keys(STATE_CAMPAIGN_FINANCE_SOURCES) as StateCampaignFinanceJurisdiction[])
    .map((state) => stateCandidate(state));
  for (const candidate of candidates) {
    const contract = STATE_CAMPAIGN_FINANCE_SOURCES[(candidate.readModel as StateMoneySnapshot).records[0]!.jurisdiction];
    await processRegisteredManualCandidate(store, contract.contractId, candidate, T0);
  }
  await readStateMoneyProjections({ store, bypassCache: true, now: T0 });
  const inventory = stateMoneyProofInventory();
  assert.deepEqual(
    inventory.targetKeys,
    [...new Set(candidates.flatMap((candidate) =>
      (candidate.readModel as StateMoneySnapshot).records.flatMap((record) => record.targetKeys)
    ))].sort(),
  );
  assert.deepEqual(
    inventory.readbacks.map(({ state, kind, scope, sourceId, versionId }) => ({ state, kind, scope, sourceId, versionId })),
    candidates.map((candidate) => {
      const state = (candidate.readModel as StateMoneySnapshot).records[0]!.jurisdiction;
      const contract = STATE_CAMPAIGN_FINANCE_SOURCES[state];
      return { state, kind: "PROMOTED", scope: contract.scope, sourceId: contract.sourceId, versionId: candidate.id };
    }).sort((left, right) => left.state.localeCompare(right.state)),
  );

  const onlyAz = new MemoryRoutineDataStore();
  const az = stateCandidate("AZ");
  await processRegisteredManualCandidate(onlyAz, STATE_CAMPAIGN_FINANCE_SOURCES.AZ.contractId, az, T0);
  await readStateMoneyProjections({ store: onlyAz, bypassCache: true, now: T0 });
  assert.throws(() => stateMoneyProofInventory(), /NH state campaign-finance Reader proof authority is NOT_RECORDED/);
});

test("one invalid state projection cannot suppress or erase another state's Reader", async () => {
  resetStateMoneyCache();
  const store = new MemoryRoutineDataStore();
  const az = stateCandidate("AZ");
  const nh = stateCandidate("NH");
  await processRegisteredManualCandidate(store, "az-sos-campaign-finance", az, T0);
  await processRegisteredManualCandidate(store, "nh-sos-campaign-finance", nh, T0);

  const corruptAzSnapshot = (value: unknown): StateMoneySnapshot => {
    const snapshot = structuredClone(value) as StateMoneySnapshot;
    const first = snapshot.records[0];
    assert.ok(first);
    return { ...snapshot, records: [{ ...first, jurisdiction: "NH" }] };
  };
  const corruptAzStore: CivicDataReadStore = {
    async readPromotion<T = unknown>(recordClass: RoutineRecordClass, scope: string): Promise<PromotedProjection<T> | null> {
      const projection = await store.readPromotion<T>(recordClass, scope);
      if (!projection || scope !== STATE_CAMPAIGN_FINANCE_SOURCES.AZ.scope) return projection;
      return { ...projection, payload: corruptAzSnapshot(projection.payload) as T };
    },
    async readCandidate(candidateId: string): Promise<CandidateVersionRecord | null> {
      const candidate = await store.readCandidate(candidateId);
      if (!candidate || candidateId !== az.id) return candidate;
      return {
        ...candidate,
        candidate: {
          ...candidate.candidate,
          normalization: {
            ...candidate.candidate.normalization,
            normalizedHash: normalizedHash(corruptAzSnapshot(candidate.candidate.readModel)),
          },
          readModel: corruptAzSnapshot(candidate.candidate.readModel),
        },
      };
    },
  };

  const azRead = await readStateMoneyProjection("AZ", { store: corruptAzStore, bypassCache: true, now: T1 });
  assert.equal(azRead.kind, "PROJECTION_INVALID");
  if (azRead.kind === "PROJECTION_INVALID") assert.equal(azRead.code, "PROJECTION_CONTRACT_INVALID");

  const versions = await refreshStateMoneyFromPromoted({ store: corruptAzStore, bypassCache: true, now: T1 });
  assert.match(versions ?? "", new RegExp(nh.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  const nhTarget = (nh.readModel as StateMoneySnapshot).records[0]?.targetKeys[0];
  const azTarget = (az.readModel as StateMoneySnapshot).records[0]?.targetKeys[0];
  assert.ok(nhTarget);
  assert.ok(azTarget);
  assert.equal(stateMoneyForTarget(nhTarget)[0]?.jurisdiction, "NH");
  assert.throws(() => stateMoneyForTarget(azTarget), /unavailable for AZ \(PROJECTION_INVALID\)/);
});

test("Pima filing index and transactions promote together; a capped successor preserves LKG", async () => {
  clearAzPimaFinanceProjectionForTest();
  const held = JSON.parse(readFileSync(join(ROOT, "data/states/az/campaign-finance/az-pima-2026-held.json"), "utf8")) as AzPimaHeld;
  const transactions = JSON.parse(readFileSync(join(ROOT, "data/states/az/campaign-finance/az-pima-2026-transactions.json"), "utf8")) as AzPimaTransactions;
  const store = new MemoryRoutineDataStore();
  const url = "https://ecf-api.easyvoteapp.com/filer/documentsearch/19626734-D3E9-449C-BB5D-EDB9C0034907";
  const good = pimaCampaignFinanceCandidate({ held, transactions, rawBodies: ["tenant", "filers", "contributions", "distributions"], requestedUrl: url, finalUrl: url, retrievedAt: T0 });
  assert.deepEqual(good.sourceProjectionEvidence, {
    kind: "SOURCE_PROJECTION_CONTRACT",
    sourceId: PIMA_LOCAL_FINANCE_CONTRACT.sourceId,
    recordClass: "LOCAL_CAMPAIGN_FINANCE",
    scope: PIMA_LOCAL_FINANCE_CONTRACT.scope,
  });
  const promoted = await processRegisteredManualCandidate(store, "az-pima-local-finance", good, T0);
  assert.equal(promoted.candidate.state, "PROMOTED");
  assert.equal(promoted.readerReadback?.status, "PASS");
  assert.ok((promoted.candidate.candidate.changeSet?.added.length ?? 0) > 1_000);
  assert.equal(await refreshAzPimaFinanceFromPromoted({ store, bypassCache: true, now: T0 }), good.id);
  assert.equal(azPimaHeld().committeeRegisterCountyPortal.length, held.committeeRegisterCountyPortal.length);
  assert.equal(azPimaTransactions().contributions.length, transactions.contributions.length);

  const cappedTransactions: AzPimaTransactions = {
    ...structuredClone(transactions),
    reconciliation: { ...structuredClone(transactions.reconciliation), capSuspected: true },
  };
  const capped = pimaCampaignFinanceCandidate({ held, transactions: cappedTransactions, rawBodies: ["tenant-2", "filers-2", "contributions-2", "distributions-2"], requestedUrl: url, finalUrl: url, retrievedAt: T1 });
  const refused = await processRegisteredManualCandidate(store, "az-pima-local-finance", capped, T1);
  assert.equal(refused.promoted, null);
  assert.equal((await store.readPromotion("LOCAL_CAMPAIGN_FINANCE", PIMA_LOCAL_FINANCE_CONTRACT.scope))?.versionId, good.id);
});

test("finance contracts are owner-only and executable paths cannot write tracked runtime truth", () => {
  const ids = new Set(["az-sos-campaign-finance", "nh-sos-campaign-finance", "nj-elec-campaign-finance", "az-pima-local-finance"]);
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ids.has(contract.id));
  assert.equal(contracts.length, 4);
  assert.ok(contracts.every((contract) => contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY"));
  assert.ok(contracts.every((contract) => !Object.hasOwn(contract, "cadence") && !Object.hasOwn(contract, "retry")));

  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
  const expectedContracts: Record<string, string> = {
    "money:az": "az-sos-campaign-finance",
    "money:nh": "nh-sos-campaign-finance",
    "money:nj": "nj-elec-campaign-finance",
    "money:az:pima": "az-pima-local-finance",
  };
  for (const [key, contractId] of Object.entries(expectedContracts)) {
    assert.equal(
      pkg.scripts[key],
      `node scripts/installed-runtime-command.mjs manual-promote --contract=${contractId}`,
    );
  }
  for (const path of contracts.map((contract) => contract.command[0])) {
    const source = readFileSync(join(ROOT, path), "utf8");
    assert.doesNotMatch(source, /\b(?:writeFileSync|appendFileSync|createWriteStream)\s*\(/, path);
    assert.doesNotMatch(source, /\bprocess\.exit\s*\(/, path);
  }

  const az = readFileSync(join(ROOT, "scripts/state-money-az.mts"), "utf8");
  const nh = readFileSync(join(ROOT, "scripts/state-money-nh.mts"), "utf8");
  const nj = readFileSync(join(ROOT, "scripts/state-money-nj.mts"), "utf8");
  assert.doesNotMatch(az, /readFileSync\([^)]*az-2026-candidate-registry/);
  assert.match(az, /readAzBallotProjection/);
  assert.doesNotMatch(nh, /readFileSync\([^)]*nh-merrimack-2026/);
  assert.match(nh, /readNhBallotProjection/);
  assert.doesNotMatch(nj, /readFileSync\([^)]*nj-morris-2026/);
  assert.match(nj, /readNjMorrisFiling/);
});
