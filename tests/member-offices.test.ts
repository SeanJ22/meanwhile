import assert from "node:assert/strict";
import test from "node:test";

import { officialStateLegislatorsCandidate } from "../lib/civic-data/candidate-builders.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { manualProjectionCandidate } from "../lib/civic-data/manual-projections.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { requiredManualProductionContract } from "../lib/civic-data/manual-contracts.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { routineTaskSelection } from "../lib/civic-data/runner.ts";
import { promotedEdgePointers } from "../lib/civic-data/promoted-edge-publication.ts";
import { READER_BALLOT_AUTHORITY_FAMILIES } from "../lib/meetings/edge-serving.ts";
import type { Officeholder, OfficeholderDivision } from "../lib/officials/types.ts";
import { memberOfficeRecords, openStatesUrl, OPEN_STATES_ORG, type MemberOfficeRecord } from "../lib/officials/member-offices.ts";
import { publishMemberOffices } from "../lib/officials/member-offices-publication.ts";
import { currentMemberOffices, refreshMemberOfficesFromPromoted } from "../lib/officials/member-offices-read.ts";
import { officialStateLegislatorTargetByScope, officialStateOfficeholderId } from "../lib/state-rollcalls/authority.ts";

const T0 = "2026-09-27T12:00:00.000Z";
const T1 = "2026-09-28T12:00:00.000Z";
const T2 = "2026-09-29T12:00:00.000Z";

const HEADER = "id,name,current_party,current_district,current_chamber,given_name,family_name,gender,email,biography,birth_date,death_date,image,links,sources,capitol_address,capitol_voice,capitol_fax,district_address,district_voice,district_fax";
function csvRow(input: { id: string; name: string; district: string; chamber: "upper" | "lower"; capitol?: string; capitolVoice?: string; district_address?: string; districtVoice?: string }): string {
  const cell = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [input.id, input.name, "Democratic", input.district, input.chamber, "", "", "", "", "", "", "", "", "", "",
    input.capitol ?? "", input.capitolVoice ?? "", "", input.district_address ?? "", input.districtVoice ?? "", ""].map(cell).join(",");
}

function holder(id: string, name: string, chamber: "upper" | "lower", phone: string | null = null): Officeholder {
  return { id, name, officeTitle: chamber === "lower" ? "State Representative" : "State Senator", level: "STATE", termStart: "2025-01-01",
    termEnd: "2026-12-31", birthDate: null, partyLabel: null, websiteUrl: null, contactFormUrl: null, phone, email: null, campaignUrl: null,
    photo: null, state: "AZ", chamber, provenance: { sourceUrl: "https://www.azleg.gov/MemberRoster/", sourceOrg: "Arizona State Legislature", collectedAt: T0, verifiedAt: T0 } } as unknown as Officeholder;
}

test("an Open States office joins its member by seat and family name; the legislature's own capitol phone wins", () => {
  const officeholders = [
    holder("az-legislature:lopez", "Ana Lopez", "lower", "(602) 926-1111"),
    holder("az-legislature:reed", "Tom Reed", "lower"),
    holder("az-legislature:kim", "Grace Kim", "upper"),
  ];
  const divisions: OfficeholderDivision[] = [
    { officeholderId: "az-legislature:lopez", ocdId: "ocd-division/country:us/state:az/sldl:5", bodyId: null },
    { officeholderId: "az-legislature:reed", ocdId: "ocd-division/country:us/state:az/sldl:5", bodyId: null },
    { officeholderId: "az-legislature:kim", ocdId: "ocd-division/country:us/state:az/sldu:7", bodyId: null },
  ] as OfficeholderDivision[];
  const csv = [HEADER,
    csvRow({ id: "ocd-person/1", name: "Ana Lopez", district: "5", chamber: "lower", capitol: "1700 W Washington St, Room 111, Phoenix, AZ 85007", capitolVoice: "602-555-0000",
      district_address: "10 Main St, Tucson, AZ 85701", districtVoice: "520-555-0101" }),
    csvRow({ id: "ocd-person/2", name: "Tom Reed", district: "05", chamber: "lower", capitol: "1700 W Washington St, Room 222, Phoenix, AZ 85007", capitolVoice: "602-555-0222" }),
    // Same seat, a family name no roster member carries: never attached to the district's other members.
    csvRow({ id: "ocd-person/3", name: "Mary Unknown", district: "5", chamber: "lower", capitol: "1700 W Washington St, Phoenix, AZ 85007", capitolVoice: "602-555-0333" }),
    // A real family name in the wrong chamber: no member holds that seat.
    csvRow({ id: "ocd-person/4", name: "Grace Kim", district: "7", chamber: "lower", capitolVoice: "602-555-0444" }),
    csvRow({ id: "ocd-person/5", name: "Grace Kim", district: "7", chamber: "upper", capitolVoice: "602-555-0555" }),
  ].join("\n");

  const { records, unmatched } = memberOfficeRecords({ state: "AZ", csv, collectedAt: T0, officials: { officeholders, divisions } });
  const lopez = records.filter(row => row.officeholderId === "az-legislature:lopez");
  assert.deepEqual(lopez.map(row => row.officeKind), ["CAPITOL", "DISTRICT"]);
  assert.equal(lopez[0]!.office.phone, "(602) 926-1111", "the roster's own capitol phone wins");
  assert.deepEqual([lopez[0]!.office.address, lopez[0]!.office.city, lopez[0]!.office.state, lopez[0]!.office.zip],
    ["1700 W Washington St, Room 111", "Phoenix", "AZ", "85007"]);
  assert.equal(lopez[1]!.office.phone, "520-555-0101", "a district office keeps Open States' phone");
  // Two members of one district, told apart by name.
  const reed = records.filter(row => row.officeholderId === "az-legislature:reed");
  assert.equal(reed.length, 1);
  assert.equal(reed[0]!.office.address, "1700 W Washington St, Room 222");
  assert.equal(reed[0]!.office.phone, "602-555-0222");
  assert.deepEqual(records.filter(row => row.officeholderId === "az-legislature:kim").map(row => row.office.phone), ["602-555-0555"]);
  assert.ok(records.every(row => row.official === false && row.sourceUrl === openStatesUrl("AZ") && row.sourceOrg === OPEN_STATES_ORG));
  assert.ok(!records.some(row => row.office.phone === "602-555-0333" || row.office.phone === "602-555-0444"), "an unmatched member's office is never attached");
  assert.deepEqual(unmatched, ["Mary Unknown (lower 5)", "Grace Kim (lower 7)"]);
});

/** The official Arizona roster, promoted: 60 House and 30 Senate members, two House members per district. */
async function seedAzRoster(store: MemoryRoutineDataStore, named: Readonly<Record<number, { name: string; phone?: string }>>) {
  const target = officialStateLegislatorTargetByScope("US-AZ")!;
  const officeholders = Array.from({ length: 90 }, (_, index) => {
    const chamber = index < 60 ? "lower" as const : "upper" as const;
    return { ...holder(officialStateOfficeholderId(target.sourceId, `az-${index + 1}`), named[index]?.name ?? `Official Member${index + 1}`, chamber, named[index]?.phone ?? null) };
  });
  const divisions = officeholders.map((row, index) => ({ officeholderId: row.id, bodyId: null,
    ocdId: `ocd-division/country:us/state:az/sld${row.chamber === "lower" ? "l" : "u"}:${(index < 60 ? index % 30 : index - 60) + 1}` }));
  const candidate = officialStateLegislatorsCandidate({ sourceId: target.sourceId, jurisdiction: "US-AZ", rawBodies: ["official AZ roster"],
    requestedUrl: target.probeUrl, finalUrl: target.probeUrl, httpStatus: 200, retrievedAt: T0, term: "2025-2026", expectedTerm: "2025-2026",
    declaredTotal: officeholders.length, roster: { scope: "AZ", generatedAt: T0, officeholders, divisions, unmatched: [] } });
  const outcome = await processRegisteredRoutineCandidate(store, target.contractId, candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  return officeholders;
}

test("the daily refresh publishes every joined office in one version, keeps gap states as gaps, and reads back for the member", async () => {
  const store = new MemoryRoutineDataStore();
  // Index 4 and 34 both sit in House district 5.
  const roster = await seedAzRoster(store, { 4: { name: "Ana Lopez", phone: "(602) 926-1111" }, 34: { name: "Tom Reed" }, 60: { name: "Grace Kim" } });
  const [lopez, reed, kim] = [roster[4]!, roster[34]!, roster[60]!];
  const azCsv = (reedPhone: string) => [HEADER,
    csvRow({ id: "ocd-person/1", name: "Ana Lopez", district: "5", chamber: "lower", capitol: "1700 W Washington St, Room 111, Phoenix, AZ 85007", capitolVoice: "602-555-0000",
      district_address: "10 Main St, Tucson, AZ 85701", districtVoice: "520-555-0101" }),
    csvRow({ id: "ocd-person/2", name: "Tom Reed", district: "5", chamber: "lower", capitol: "1700 W Washington St, Room 222, Phoenix, AZ 85007", capitolVoice: reedPhone }),
    csvRow({ id: "ocd-person/3", name: "Mary Unknown", district: "5", chamber: "lower", capitolVoice: "602-555-0333" }),
    csvRow({ id: "ocd-person/5", name: "Grace Kim", district: "1", chamber: "upper", capitol: "1700 W Washington St, Phoenix, AZ 85007", capitolVoice: "602-555-0555" }),
  ].join("\n");
  const fetched: string[] = [];
  const fetchCsv = (csv: string) => async (url: string) => {
    fetched.push(url);
    if (url === openStatesUrl("AZ")) return csv;
    throw new Error("HTTP 503 for " + url);
  };

  const first = await publishMemberOffices({ store, now: T0, fetchCsv: fetchCsv(azCsv("602-555-0222")) });
  assert.ok(first.promotedVersionId, JSON.stringify(first.gaps));
  assert.equal(first.records, 4);
  assert.equal(first.outcome?.candidate.state, "PROMOTED");
  // New Jersey has no official roster here: a gap, never a failure, and its file is not fetched.
  assert.ok(first.gaps.some(gap => gap.key === "NJ" && gap.detail.startsWith("ROSTER_UNAVAILABLE")), JSON.stringify(first.gaps));
  assert.ok(!fetched.includes(openStatesUrl("NJ")));
  assert.ok(first.gaps.some(gap => gap.key === "AZ:unmatched" && gap.detail.includes("Mary Unknown")));
  // The receipt names Open States' exact bytes as a reference publisher.
  const sources = first.outcome!.candidate.candidate.retrieval.manualSourceReceipt!.sources;
  assert.deepEqual(sources.map(source => [source.finalUrl, source.sourceClass, source.publisher]), [[openStatesUrl("AZ"), "REFERENCE_PUBLISHER", OPEN_STATES_ORG]]);
  assert.match(sources[0]!.rawHash, /^[a-f0-9]{64}$/);

  await refreshMemberOfficesFromPromoted({ store, now: T0, bypassCache: true });
  const offices = currentMemberOffices(lopez.id);
  assert.deepEqual(offices.map(row => [row.officeKind, row.office.phone]), [["CAPITOL", "(602) 926-1111"], ["DISTRICT", "520-555-0101"]]);
  assert.deepEqual(currentMemberOffices(reed.id).map(row => row.office.address), ["1700 W Washington St, Room 222"]);
  assert.equal(currentMemberOffices(kim.id).length, 1);
  assert.deepEqual(currentMemberOffices(roster[5]!.id), [], "a member with no Open States office shows none");

  // An unchanged day confirms the held version instead of promoting a copy.
  const second = await publishMemberOffices({ store, now: T1, fetchCsv: fetchCsv(azCsv("602-555-0222")) });
  assert.equal(second.promotedVersionId, first.promotedVersionId);
  assert.ok(second.outcome?.confirmed, "an unchanged re-read is confirmed on the pointed version");

  // A changed office promotes; the change reads back.
  const third = await publishMemberOffices({ store, now: T2, fetchCsv: fetchCsv(azCsv("602-555-9999")) });
  assert.ok(third.promotedVersionId && third.promotedVersionId !== first.promotedVersionId);
  await refreshMemberOfficesFromPromoted({ store, now: T2, bypassCache: true });
  assert.deepEqual(currentMemberOffices(reed.id).map(row => row.office.phone), ["602-555-9999"]);

  // Every source unavailable: nothing publishable, and the prior version stays live.
  const failed = await publishMemberOffices({ store, now: T2, fetchCsv: async () => { throw new Error("offline"); } });
  assert.equal(failed.candidateId, null);
  assert.ok(failed.gaps.some(gap => gap.key === "AZ" && gap.detail.startsWith("SOURCE_UNAVAILABLE")));
  const contract = requiredManualProductionContract("member-offices");
  assert.equal((await store.readPromotion(contract.recordClass, contract.scope))?.versionId, third.promotedVersionId);
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

test("the runner refreshes member offices daily with no owner step, and the reader edge carries them", () => {
  const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === "member-offices");
  assert.ok(task);
  assert.equal(task.ownerInvocation, undefined);
  assert.deepEqual(task.command, ["scripts/publish-member-offices.mts", "--promote"]);
  assert.equal(task.cadenceMs, 24 * 60 * 60_000);
  assert.equal(routineTaskSelection(["--only=member-offices"], AUTOMATIC_REFRESH_TASKS).ok, true);
  const contract = requiredManualProductionContract("member-offices");
  assert.deepEqual(promotedEdgePointers()["member-offices"].map(row => [row.recordClass, row.scope]), [[contract.recordClass, contract.scope]]);
  assert.ok(READER_BALLOT_AUTHORITY_FAMILIES.includes("member-offices"));
});
