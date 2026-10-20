import assert from "node:assert/strict";
import test from "node:test";

import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";

import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskSelection } from "../lib/civic-data/runner.ts";
import type { Officeholder } from "../lib/officials/types.ts";
import { officeRecordsForHolder, openStatesUrl, OPEN_STATES_ORG, type MemberOfficeRecord } from "../lib/officials/member-offices.ts";

import { mergeStatePeople } from "../lib/state-rollcalls/legislators.ts";

const T0 = "2026-09-27T12:00:00.000Z";
const T1 = "2026-09-28T12:00:00.000Z";

function holder(id: string, name: string, chamber: "upper" | "lower", phone: string | null = null): Officeholder {
  return { id, name, officeTitle: chamber === "lower" ? "State Representative" : "State Senator", level: "STATE", termStart: "2025-01-01",
    termEnd: "2026-12-31", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null, phone, email: null, campaignUrl: null,
    photo: null, state: "AZ", chamber, provenance: { sourceUrl: "https://www.azleg.gov/MemberRoster/", sourceOrg: "Arizona State Legislature", collectedAt: T0, verifiedAt: T0 } } as unknown as Officeholder;
}

test("all distinct native district offices survive and a missing phone does not hide an address",()=>{
  const person={...holder("plural:az:a","Ana Lopez","lower"),offices:[{name:"district",address:"One Main St",sourceUrl:openStatesUrl("AZ"),collectedAt:T0},{name:"district",address:"Two Main St",phone:"520-900-0000",sourceUrl:openStatesUrl("AZ"),collectedAt:T0}]};
  const offices=officeRecordsForHolder(person);assert.equal(offices.length,2);assert.notEqual(offices[0].id,offices[1].id);assert.equal(offices[0].office.phone,null);
});
test("a native office email remains independently usable without an address or phone",()=>{
  const person={...holder("plural:az:a","Ana Lopez","lower"),offices:[{name:"district",email:"district@example.gov",sourceUrl:openStatesUrl("AZ"),collectedAt:T0}]};
  const [office]=officeRecordsForHolder(person);
  assert.equal(office.office.email,"district@example.gov");
  assert.equal(office.office.address,null);
});
test("a partial people refresh keeps earlier sourced offices when the optional office array is absent",()=>{
  const before={...holder("plural:az:a","Ana Lopez","lower"),offices:[{name:"district",email:"district@example.gov",sourceUrl:openStatesUrl("AZ"),collectedAt:T0}]};
  const roster={scope:"US-AZ",generatedAt:T0,officeholders:[before],divisions:[],unmatched:[]};
  const after=mergeStatePeople(roster,{...roster,generatedAt:T1,officeholders:[{...before,offices:[],provenance:{...before.provenance,collectedAt:T1}}]});
  assert.equal(after.officeholders[0].offices?.[0].email,"district@example.gov");
  assert.equal(after.officeholders[0].offices?.[0].collectedAt,T0);
});
test("a member office read from a reference publisher can never be marked official", () => {
  const record: MemberOfficeRecord = { id: "member-office:az-legislature:1:capitol:0", kind: "MEMBER_OFFICE", officeholderId: "az-legislature:1",
    officeKind: "CAPITOL", office: { address: "1700 W Washington St", city: "Phoenix", state: "AZ", zip: "85007", phone: null, lat: null, lng: null },
    sourceUrl: openStatesUrl("AZ"), sourceOrg: OPEN_STATES_ORG, official: true, collectedAt: T0 };
  const candidate = manualProjectionCandidate({ contractId: "member-offices", version: T0, sourceThrough: T0,
    sourceReceipt: { contractVersion: 1, reviewedAt: T0, reviewedBy: "test", sources: [{ requestedUrl: openStatesUrl("AZ"), finalUrl: openStatesUrl("AZ"),
      publisher: OPEN_STATES_ORG, sourceClass: "REFERENCE_PUBLISHER", retrievedAt: T0, httpStatus: 200, rawHash: "a".repeat(64), reviewedEvidence: "test bytes" }] },
    payload: { kind: "member-offices", records: [record as unknown as Record<string, unknown> & { id: string }] } });
  assert.ok(candidate.semantics.violations.some(violation => /cannot be marked official/.test(violation)));
});

test("the runner refreshes member offices daily with no owner step", () => {
  const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === "member-offices");
  assert.ok(task);
  assert.equal(task.ownerInvocation, undefined);
  assert.deepEqual(task.command, ["scripts/publish-member-offices.mts", "--promote"]);
  assert.equal(task.cadenceMs, 24 * 60 * 60_000);
  assert.equal(routineTaskSelection(["--only=member-offices"], AUTOMATIC_REFRESH_TASKS).ok, true);
  const contract = requiredManualProductionContract("member-offices");
  assert.equal(contract.recordClass, "CURATED_READER_RECORD");
});
