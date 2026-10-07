import { isRenderable } from "../lib/funding/state-money-reader.ts";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { campaignMoneyApiAnswer, campaignMoneyForTarget, currentOfficialIdentity, currentOfficialIdentityStatus, resolvedCandidacyForOfficial, officialFinanceIdentityMatches } from "../lib/funding/campaign-money.ts";
import { ROSTER_READER_DISPOSITIONS } from "../lib/registry/body-rosters.ts";
import { stateMoneyForCard } from "../lib/funding/nominee-money.ts";
import { fundingAnswerForTarget } from "../lib/funding/display.ts";
import { getFundingSnapshot, refreshFundingFromPromoted } from "../lib/funding/snapshot.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { type StateMoneyRecord } from "../lib/funding/state-money.ts";
import { resetStateMoneyCache, stateMoneyForTarget } from "../lib/funding/state-snapshot.ts";
import { resetAzIdentityCache } from "../lib/identity/az-2026.ts";
import { getRegistryRuntimeReadModel } from "../lib/registry/runtime-read-model.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();
await refreshFundingFromPromoted({ store: new MemoryRoutineDataStore() });
const bridge = getRegistryRuntimeReadModel().officialCandidacies;

const hobbsKey = "ballot-az-pima:governor:hobbs-katie";
const hobbs = stateMoneyForTarget(hobbsKey)[0];

test("official finance identity bridge is carried by the canonical registry projection", () => {
  assert.equal(bridge.formatVersion, 1);
  assert.equal(bridge.rule, "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE");
  assert.ok(bridge.rows.length > 800);
  assert.ok(bridge.rows.every((row) => !('sourcePath' in row.holder)));
});

test("exact duplicate roster aliases preserve the canonical finance answer and requested identity", () => {
  const aliases = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "EXACT_DUPLICATE");
  assert.ok(aliases.length > 0);
  for (const row of aliases) {
    assert.ok(row.canonicalId);
    const actual = campaignMoneyForTarget(row.sourceId);
    const expected = campaignMoneyForTarget(row.canonicalId);
    assert.equal(actual.requestedTargetKey, row.sourceId);
    assert.deepEqual({ ...actual, requestedTargetKey: row.canonicalId }, expected);
    assert.deepEqual(campaignMoneyApiAnswer(row.sourceId), campaignMoneyApiAnswer(row.canonicalId));
    assert.deepEqual(currentOfficialIdentity(row.sourceId), currentOfficialIdentity(row.canonicalId));
    assert.deepEqual(resolvedCandidacyForOfficial(row.sourceId), resolvedCandidacyForOfficial(row.canonicalId));
  }
});

test("malformed roster person identities remain unresolved before any finance fallback", () => {
  const rows = ROSTER_READER_DISPOSITIONS.filter(row => row.state === "IDENTITY_UNRESOLVED");
  assert.ok(rows.length > 0);
  for (const row of rows) {
    const actual = campaignMoneyForTarget(row.sourceId);
    assert.equal(actual.requestedTargetKey, row.sourceId);
    assert.equal(actual.officialIdentity, "IDENTITY_UNRESOLVED");
    assert.deepEqual(actual.federal, { kind: "none" });
    assert.deepEqual(actual.state.records, []);
    assert.equal(currentOfficialIdentityStatus(row.sourceId), "IDENTITY_UNRESOLVED");
    assert.equal(currentOfficialIdentity(row.sourceId), null);
    assert.equal(resolvedCandidacyForOfficial(row.sourceId), null);
    assert.equal(campaignMoneyApiAnswer(row.sourceId).kind, "identity-unresolved");
  }
});

test("Katie Hobbs ballot, official API, and shared Ask selector use one canonical record", () => {
  const ballot = stateMoneyForCard("ballot-az-pima:governor|Katie Hobbs", "ballot-az-pima:governor");
  const official = campaignMoneyForTarget("statewide:az/governor");
  assert.equal(ballot.resolvedTargetKey, hobbsKey);
  assert.equal(official.state.resolvedTargetKey, hobbsKey);
  assert.deepEqual(official.state.records, ballot.records);
  assert.deepEqual(campaignMoneyForTarget(hobbsKey).state.records, ballot.records);
  assert.equal(hobbs.totals.receipts, 11_109_719.95);
  assert.equal(hobbs.totals.expenditures, 14_355_612.69);
  const api = campaignMoneyApiAnswer("statewide:az/governor");
  assert.equal(api.kind, "state");
  if (api.kind === "state") assert.deepEqual(api.data.records, ballot.records);
});

test("every resolved official, including NJ county and NH governor, preserves its full canonical finance answer", () => {
  const rows = bridge.rows.filter(row => row.status === "RESOLVED");
  assert.ok(rows.some(row => row.holder.id === "roster:morris#6"));
  assert.ok(rows.some(row => row.holder.id === "statewide:nh/governor"));
  for (const row of rows) {
    assert.ok(row.candidacy);
    const official = campaignMoneyForTarget(row.holder.id);
    assert.equal(official.officialIdentity, "RESOLVED", row.holder.id);
    assert.deepEqual(official.state.records, stateMoneyForTarget(row.candidacy.candidacyId), row.holder.id);
  }
});

test("a candidacy for another office stays explicitly identified as that candidacy", () => {
  const yee = campaignMoneyForTarget("statewide:az/state-treasurer");
  assert.equal(yee.state.resolvedTargetKey, "ballot-az-pima:superintendent:yee-kimberly");
  assert.ok(yee.state.records.every(r => /Superintendent/i.test(r.match.officeOnBallot ?? "")));
});

test("federal officeholders' held state candidacies project without inventing federal records", () => {
  for (const [officialId, candidacyId] of [
    ["congress:B001302", "ballot-az-pima:governor:biggs-andy"],
    ["congress:S001183", "ballot-az-pima:governor:schweikert-david"],
  ]) {
    const answer = campaignMoneyApiAnswer(officialId);
    assert.equal(answer.kind, "state", officialId);
    assert.equal(fundingAnswerForTarget(officialId).kind, "none");
    if (answer.kind !== "state") continue;
    assert.equal(answer.data.resolvedTargetKey, candidacyId);
    assert.deepEqual(answer.data.records, stateMoneyForTarget(candidacyId));
    assert.ok(answer.data.records.every(r => /Governor/i.test(r.match.officeOnBallot ?? "")));
  }
  assert.equal(campaignMoneyForTarget("congress:B001325").state.records.length, 0, "Sheri Biggs cannot inherit Andy Biggs' candidacy");
});

test("wrong-candidate and unlinked-official targets never inherit Katie Hobbs money", () => {
  for (const key of ["statewide:nj/governor", "statewide:az/not-a-person", "ballot-az-pima:governor|Another Person", "ballot-az-pima:governor:biggs-andy"]) {
    assert.ok(campaignMoneyForTarget(key).state.records.every(r => !r.targetKeys.includes(hobbsKey)), key);
  }
});

test("a reused officeholder slot, changed office, or changed jurisdiction fails the committed identity", () => {
  const row = bridge.rows.find(row => row.holder.id === "statewide:az/governor")!;
  assert.equal(officialFinanceIdentityMatches(row, row.holder), true);
  assert.equal(officialFinanceIdentityMatches(row, { ...row.holder, name: "Another Person" }), false);
  assert.equal(officialFinanceIdentityMatches(row, { ...row.holder, officeTitle: "Treasurer" }), false);
  assert.equal(officialFinanceIdentityMatches(row, { ...row.holder, divisions: ["ocd-division/country:us/state:nj"] }), false);
  assert.equal(officialFinanceIdentityMatches(row, null), false);
});

test("unverified extraction PASS and Auditor INCONCLUSIVE do not promote money", () => {
  const acquisition = { ...hobbs, provenance: { ...hobbs.provenance, verifiedAt: null }, validationStatus: "PASS", auditResult: "INCONCLUSIVE" };
  assert.equal(isRenderable(acquisition), false);
  assert.equal(isRenderable({ ...hobbs, match: { ...hobbs.match, allThreeAgree: false } }), false);
  assert.equal(isRenderable({ ...hobbs, filingState: "LEAD" }), false);
  assert.equal(isRenderable({ ...hobbs, dataClass: "ACQUISITION" } as unknown as StateMoneyRecord), false);
  assert.equal(isRenderable({ ...hobbs, filingState: "OURS_GAP", ourGap: { whatIsMissing: "Unresolved identity", nextDue: null, nextDueName: null } }), false);
});

test("every eligible normalized record survives the shared canonical target projection; leads stay withheld", () => {
  for (const st of ["az", "nj", "nh"]) {
    const snapshot = JSON.parse(readFileSync(`data/states/${st}/funding/state-money-${st}-2026.json`, "utf8")) as { records: StateMoneyRecord[] };
    for (const record of snapshot.records) for (const key of record.targetKeys) {
      const rows = campaignMoneyForTarget(key).state.records;
      assert.equal(rows.some(r => JSON.stringify(r) === JSON.stringify(record)), isRenderable(record), `${st}:${key}:${record.filingState}`);
    }
  }
});

test("federal finance answer remains identical for every existing FEC target", () => {
  for (const row of getFundingSnapshot().candidates) for (const key of row.targetKeys) {
    assert.deepEqual(campaignMoneyForTarget(key).federal, fundingAnswerForTarget(key), key);
  }
});

test("the canonical federal contest cannot manufacture an Arizona state-finance gap", () => {
  const money = campaignMoneyForTarget("ballot-az-pima:us-house-7|Adelita Grijalva");
  assert.equal(money.federal.kind, "funding");
  assert.equal(money.state.resolution, "FEDERAL_NOT_APPLICABLE");
  assert.deepEqual(money.state.records, []);
});

test("a missing deployed normalized holding raises a failed read even if staged evidence exists", () => {
  const root = process.cwd();
  const isolated = mkdtempSync(join(tmpdir(), "reader-finance-trace-"));
  try {
    mkdirSync(join(isolated, "data", "states", "az", "candidates"), { recursive: true });
    writeFileSync(join(isolated, "data", "states", "az", "candidates", "staged.json"), JSON.stringify({ records: [hobbs] }));
    process.chdir(isolated);
    resetStateMoneyCache();
    assert.throws(() => stateMoneyForTarget(hobbsKey), /Canonical state-money holding unavailable/);
  } finally {
    process.chdir(root);
    resetStateMoneyCache();
    rmSync(isolated, { recursive: true, force: true });
  }
});

test("a missing canonical ballot identity projection cannot become a display-key funding absence", () => {
  const root = process.cwd();
  const isolated = mkdtempSync(join(tmpdir(), "reader-finance-identity-"));
  try {
    process.chdir(isolated);
    resetAzIdentityCache();
    assert.throws(
      () => stateMoneyForCard("ballot-az-pima:governor|Katie Hobbs", "ballot-az-pima:governor"),
      /ENOENT.*az-pima-2026\.json|identity holding unavailable/,
    );
  } finally {
    process.chdir(root);
    resetAzIdentityCache();
    rmSync(isolated, { recursive: true, force: true });
  }
});
