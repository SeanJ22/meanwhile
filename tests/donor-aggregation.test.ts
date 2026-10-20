import { installFundingFixture } from "./helpers/funding-fixture.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { getFundingSnapshot } from "../lib/funding/snapshot.ts";
import { campaignMoneyApiAnswer } from "../lib/funding/campaign-money.ts";
import { campaignMoneyEvidenceFor } from "../lib/ask/campaign-money.ts";
import { publicStateMoneyRecord } from "../lib/funding/state-money-reader.ts";
import { nativeStateMoneyRecord } from "../lib/funding/state-native.ts";
import { mayRenderFiledName, mayRenderFiledLocation } from "../lib/funding/donor-privacy.ts";
import type { ContributionRow } from "../lib/funding/types.ts";
const privateName = "PRIVATE DONOR CANARY", privateAddress = "919 PRIVATE HOME CANARY STREET";
const org = { dataClass: "FEC_CONTRIBUTOR", kind: "COMMITTEE_OR_ORGANIZATION", contributorName: "Filed PAC", amount: 100,
  receiptDate: "2026-09-01", city: privateAddress, state: "AZ", entityType: "PAC", lineNumber: "11C", committeeType: "N",
  organizationType: null, designation: null, contributorCommitteeId: "C00000001", streetAddress: privateAddress } as ContributionRow;
const individual: ContributionRow = { ...org, kind: "INDIVIDUAL", entityType: "IND", contributorName: privateName };

test("API/card DTO and Ask strip donor identities and all extra address fields at both finance hops", async () => {
  await installFundingFixture("AZ");
  const snapshot = getFundingSnapshot(), candidate = snapshot.candidates[0];
  candidate.topContributions = [org, individual, { ...individual, kind: "COMMITTEE_OR_ORGANIZATION", entityType: "CAN" }];
  snapshot.secondHop = [{ dataClass: "FEC_CONTRIBUTOR", committeeId: "C00000001", name: "Filed PAC", committeeType: "N",
    organizationType: null, designation: null, receipts: 500, topContributions: [org, individual], provenance: candidate.provenance }];
  const answer = campaignMoneyApiAnswer(candidate.targetKeys[0], undefined, { federal: true, state: false, identity: false });
  assert.equal(answer.kind, "funding");
  const serialized = await Response.json(answer).text();
  assert.doesNotMatch(serialized, /PRIVATE DONOR CANARY|PRIVATE HOME CANARY|streetAddress/);
  assert.match(serialized, /Filed PAC/);
  if (answer.kind === "funding") {
    assert.equal(answer.data.contributors.length, 1); assert.equal(answer.data.contributorGroups.individuals.length, 0);
    assert.equal(answer.data.secondHop.C00000001.topContributions.length, 1);
    const evidence = campaignMoneyEvidenceFor({ kind: "PERSON", id: candidate.targetKeys[0], name: candidate.name }, candidate.targetKeys[0], undefined,
      () => ({ requestedTargetKey: candidate.targetKeys[0], federal: answer, state: { records: [], resolution: "DIRECT_CANDIDACY_KEY", resolvedTargetKey: null }, officialIdentity: "NOT_OFFICIAL" }));
    assert.doesNotMatch(JSON.stringify(evidence), /PRIVATE DONOR CANARY|PRIVATE HOME CANARY/);
    assert.ok(answer.data.totals?.individualItemized !== undefined, "published individual totals remain usable");
  }
});

test("state finance DTO preserves native aggregate facts and cannot spread saved address extras", () => {
  const record = nativeStateMoneyRecord({ state: "NH", committeeId: "12", name: "Filed Committee", candidateName: "Public Candidate",
    office: "State Senate", year: 2028, receipts: 100, spent: null, period: "2028 election", sourceUrl: "https://cfs.sos.nh.gov/", agency: "NH SOS", observedAt: "2028-10-01" });
  const raw = { ...record, filingAddress: privateAddress, donors: [{ name: privateName, home: privateAddress }],
    totals: { ...record.totals, donorName: privateName }, provenance: { ...record.provenance, streetAddress: privateAddress } };
  const publicRecord = publicStateMoneyRecord(raw);
  assert.doesNotMatch(JSON.stringify(publicRecord), /PRIVATE DONOR CANARY|PRIVATE HOME CANARY|donorName|streetAddress|filingAddress/);
  assert.equal(publicRecord.totals.receipts, 100);
  assert.equal(mayRenderFiledName({ kind: "INDIVIDUAL" }), false);
  assert.equal(mayRenderFiledLocation({ kind: "INDIVIDUAL" }), false);
  assert.equal(mayRenderFiledName({ kind: "COMMITTEE_OR_ORGANIZATION" }), true);
});
