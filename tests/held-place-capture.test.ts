import assert from "node:assert/strict";
import test from "node:test";
import { projectHeldPlaceCapture } from "../lib/civic-data/held-place-capture.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import type { MeetingsSnapshot } from "../lib/meetings/snapshot.ts";
import type { HeldPlaceFamilies } from "../lib/civic-data/held-place-families.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { buildPlaceOwedList } from "../lib/coverage/place-owed.ts";
import { projectHeldGeography, readHeldPlaceGeography, type HeldGeographyRow } from "../lib/civic-data/held-place-geography.ts";
import type { Division } from "../lib/registry/types.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const neighbour = "ocd-division/country:us/state:az/county:pima";
const at = "2026-09-30T06:00:00.000Z";
const provenance = { sourceUrl: "https://cochise.az.gov/calendar", collectedAt: at };
const published = <T>(value: T) => ({ kind: "PROMOTED", value } as CivicDataReadResult<T>);
const registry = published({ registry: { bodies: [{ id: "shared-body", ocdId: county,
  alsoServesOcdIds: [neighbour], name: "Shared district board", bodyClass: "BOARD", provenance }] },
  bodyRosters: [{ bodyId: "shared-body", ...provenance, members: [{ id: "member", name: "Published Member",
    officeTitle: "Chair", websiteUrl: null }] }] } as unknown as RegistryRuntimeReadModel);
const meeting = { id: "meeting:one", bodyId: "shared-body", ocdId: county, title: "Board meeting",
  startsAt: "2026-10-01T02:00:00.000Z", timeZone: "America/Phoenix", startPrecision: "DAY",
  location: null, online: null, status: "SCHEDULED", provenance };
const meetings = published({ meetings: [meeting] } as unknown as MeetingsSnapshot);

test("held boundary provenance maps source, semantic version and effective use without URL-only credit", () => {
  const cd = "ocd-division/country:us/state:az/cd:6";
  const sl = "ocd-division/country:us/state:az/sldu:6";
  const meta = { type: "congressional_district", version: "cd:119", versionMeta: {
    key: "cd:119", type: "congressional_district", plan: "119th Congress", effectiveFor: "current representation",
    zctaTabulation: "2020", provenance: { sourceUrls: ["https://www2.census.gov/held.txt"],
      sourceDataset: "CENSUS_TAB20_REL2020", computedAt: at, sourceFiles: ["held.txt"], sourceChecksums: ["saved-hash"], method: "published relationship" },
  } };
  const row = { meta, grouping: { geoid: "0406", ocdId: null, label: "AZ Congressional District 6" } } as unknown as HeldGeographyRow;
  const held = projectHeldGeography([cd, sl, county], [], [row]);
  assert.deepEqual(held.held.map(f => [f.subjectId, f.checklistId]), [[cd, "GEO-03"]]);
  assert.equal(held.held[0].checkedAt, at, "projection does not advance the saved source clock");
  assert.deepEqual(held.held[0].value, { divisionId: cd, geoid: "0406", sourceDataset: "CENSUS_TAB20_REL2020",
    version: "cd:119", plan: "119th Congress", effectiveFor: "current representation" });
  const items = buildPlaceOwedList({ divisions: [{ id: cd, label: cd }], ...held, now: at });
  assert.equal(items.find(item => item.checklistId === "GEO-03" && item.subject.id === cd)?.state, "published");
  for (const field of ["key", "effectiveFor"] as const) {
    const missing = structuredClone(row);
    (missing.meta.versionMeta as unknown as Record<string, unknown>)[field] = "";
    assert.equal(projectHeldGeography([cd], [], [missing]).held.length, 0);
  }
  const countyRow = { ...row, meta: { ...row.meta, type: "county" }, grouping: { ...row.grouping, geoid: "04003" } } as HeldGeographyRow;
  const divisions = [{ ocdId: county, divisionType: "county", geoid: "04003" }] as Division[];
  assert.equal(projectHeldGeography([county], divisions, [countyRow]).held[0].subjectId, county);
  assert.equal(projectHeldGeography(["unrelated"], divisions, [countyRow]).held.length, 0);
});

test("geography quiet reads fetch only the pointer, and a changed or racing version cannot serve the old field", async () => {
  let version = "held-v1", payloadReads = 0, racing = false;
  const query = async (statements: readonly { text: string }[]) => {
    if (statements[0].text.startsWith("SELECT current_version_id")) return [[{ current_version_id: version }]];
    payloadReads++;
    return [[{ meta: {}, grouping: { $version: racing ? "raced" : version } }]];
  };
  const ids = ["ocd-division/country:us/state:az/cd:6"];
  await readHeldPlaceGeography(ids, [], query);
  await readHeldPlaceGeography(ids, [], query);
  assert.equal(payloadReads, 1);
  version = "held-v2";
  await readHeldPlaceGeography(ids, [], query);
  assert.equal(payloadReads, 2);
  version = "held-v3";
  racing = true;
  await assert.rejects(readHeldPlaceGeography(ids, [], query), /CIVIC_POINTER_CHANGED_DURING_READ/);
});

test("held Census status survives complementary projections without inventing governments for statistical areas", () => {
  const statuses = ["S", "F", "N", "I", "A", "E", null];
  const divisions = statuses.map((funcstat, i) => ({ ocdId: `${county}/place:area_${i}`,
    label: "Same label", divisionType: "place", funcstat }));
  assert.ok(registry.value);
  const model = { ...registry.value, registry: { ...registry.value.registry, divisions,
    bodies: [{ ...registry.value.registry.bodies[0], ocdId: divisions[0].ocdId, alsoServesOcdIds: [] }] } } as unknown as RegistryRuntimeReadModel;
  const capture = projectHeldPlaceCapture(divisions.map(d => d.ocdId), published(model), [], at);
  // A second projection contributes a field for the same division without
  // repeating its optional Census metadata (as the geography reader does).
  const geography = { id: divisions[0].ocdId, kind: "division" as const,
    divisionIds: [divisions[0].ocdId], label: "Boundary" };
  const input = { divisions: divisions.map(d => ({ id: d.ocdId, label: d.label })),
    subjects: [...capture.subjects, geography], held: capture.held, now: at };
  const rows = buildPlaceOwedList(input);
  for (const [i, status] of statuses.entries()) {
    const inventories = rows.filter(row => row.subject.id.startsWith(`${divisions[i].ocdId}#inventory:`));
    assert.equal(inventories.length, i < 4 ? 0 : 6, `status ${status} uses only the held classification`);
    assert.equal(rows.filter(row => row.subject.id === divisions[i].ocdId).length, 14, "geography remains owed");
  }
  assert.deepEqual(rows.find(row => row.subject.id === "shared-body" && row.checklistId === "GOV-01")?.held,
    capture.held.filter(field => field.subjectId === "shared-body"), "actual records remain even within statistical geography");
  assert.equal(capture.subjects.find(subject => subject.id === divisions[0].ocdId)?.funcstat, "S");
  const explicit = buildPlaceOwedList({ ...input,
    divisions: [{ id: divisions[0].ocdId, label: "Current input", funcstat: "A" }] });
  assert.equal(explicit.filter(row => row.subject.id.includes("#inventory:")).length, 6, "explicit input status takes precedence");
  const reversed = buildPlaceOwedList({ ...input, subjects: [geography, ...capture.subjects] });
  assert.deepEqual(reversed.map(row => [row.id, row.state, row.held]), rows.map(row => [row.id, row.state, row.held]));
});

test("held fields reach every served division without filling inventory or missing meeting fields", () => {
  const primary = projectHeldPlaceCapture([county], registry, [meetings], at);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [meetings], at);
  assert.deepEqual(secondary, primary, "a shared body serves either place regardless of the original ZIP/job");
  const ids = primary.held.map(field => field.checklistId);
  assert.deepEqual(ids, ["GOV-01", "OFF-04", "OFF-08", "MTG-05", "MTG-06", "MTG-10", "MTG-12"]);
  assert.ok(!ids.includes("OFF-01") && !ids.includes("OFF-05"));
  assert.ok(!ids.includes("MTG-03") && !ids.includes("MTG-16") && !ids.includes("MTG-07") && !ids.includes("MTG-08"));
  assert.equal(primary.held.find(field => field.checklistId === "MTG-06")?.freshUntil, "2026-09-30T07:00:00.000Z");
  assert.equal(projectHeldPlaceCapture(["unrelated-division"], registry, [meetings], at).held.length, 0);
});

test("registry bodies owe civic facts without duplicating product feature work, and retain held observations", () => {
  const capture = projectHeldPlaceCapture([county, neighbour], registry, [], at);
  const existing = { subjectId: "shared-body", checklistId: "ENG-07", state: "held" as const,
    sourceUrl: provenance.sourceUrl, checkedAt: at, freshUntil: "2026-10-01T06:00:00.000Z", value: "Existing observation" };
  const input = { divisions: [county, neighbour].map(id => ({ id, label: id })), ...capture, now: at };
  const rows = buildPlaceOwedList(input);
  const bodyRows = rows.filter(row => row.subject.id === "shared-body");
  assert.equal(capture.subjects.find(subject => subject.id === "shared-body")?.captureKind, "registry-body");
  assert.equal(bodyRows.length, 22, "all 14 government and 8 participation requirements stay open or captured");
  assert.ok(!bodyRows.some(row => row.checklistId.startsWith("ENG-")));
  assert.ok(bodyRows.some(row => row.checklistId === "GOV-08" && row.state === "missing"));
  assert.ok(bodyRows.some(row => row.checklistId === "PAR-02" && row.state === "missing"));
  assert.deepEqual(bodyRows.find(row => row.checklistId === "GOV-01")?.held,
    capture.held.filter(field => field.subjectId === "shared-body"));
  assert.deepEqual(bodyRows[0].subject.divisionIds, [county, neighbour]);
  const retained = buildPlaceOwedList({ ...input, held: [...capture.held, existing] });
  assert.deepEqual(retained.find(row => row.subject.id === "shared-body" && row.checklistId === "ENG-07")?.held, [existing]);
  const unresolved = buildPlaceOwedList({ ...input,
    subjects: [{ id: "unknown-body", kind: "body", divisionIds: [county], label: "Unknown body" }] });
  assert.equal(unresolved.filter(row => row.subject.id === "unknown-body" && row.checklistId.startsWith("ENG-")).length, 7);
  assert.equal(rows.filter(row => row.subject.id.includes("#inventory:")).length, 12);
});

test("sittings share calendar discovery work by body while every meeting keeps its own dates and documents", () => {
  const capture = projectHeldPlaceCapture([county, neighbour], registry, [published({ meetings: [
    meeting, { ...meeting, id: "meeting:two" }, { ...meeting, id: "meeting:other", bodyId: "another-body" },
    { ...meeting, id: "meeting:unresolved", bodyId: null },
  ] } as unknown as MeetingsSnapshot)], at);
  const owed = buildPlaceOwedList({ divisions: [county, neighbour].map(id => ({ id, label: id })), ...capture, now: at });
  for (const id of ["meeting:one", "meeting:two", "meeting:other"]) {
    assert.ok(!owed.some(row => row.subject.id === id && row.checklistId === "MTG-03"));
    assert.equal(owed.find(row => row.subject.id === id && row.checklistId === "MTG-06")?.state, "published");
    assert.equal(owed.find(row => row.subject.id === id && row.checklistId === "DOC-01")?.state, "missing");
  }
  const routes = owed.filter(row => row.checklistId === "MTG-03" && row.subject.captureKind === "body-calendar");
  assert.deepEqual(routes.map(row => row.subject.id).sort(), ["another-body#calendar", "shared-body#calendar"]);
  assert.deepEqual(routes.find(row => row.subject.id === "shared-body#calendar")?.subject.divisionIds, [county, neighbour]);
  assert.ok(routes.every(row => row.state === "missing"), "having a meeting never certifies calendar completeness");
  assert.ok(owed.some(row => row.subject.id === "meeting:unresolved" && row.checklistId === "MTG-03"), "an unknown body keeps its route work");
});

test("body rosters retain canonical legislative and local scope without borrowing meaning from titles", () => {
  const state = "ocd-division/country:us/state:oh";
  const territories = [
    `${state}/sldu:7`, `${state}/sldl:7`, `${state}/county:franklin`,
    `${state}/school_district:columbus`, "ocd-division/country:us/district:dc/place:ward_1",
    "ocd-division/country:us/territory:pr/place:ponce", state,
  ];
  const model = { registry: { bodies: territories.map((ocdId, i) => ({ id: `body:${i}`, ocdId,
    name: "Government body", bodyClass: "GOVERNING", provenance })) },
    bodyRosters: territories.map((_, i) => ({ bodyId: `body:${i}`, ...provenance,
      members: [{ id: `member:${i}`, name: "Published member", officeTitle: "President" }] })) } as unknown as RegistryRuntimeReadModel;
  const capture = projectHeldPlaceCapture(territories, published(model), [], at);
  const extra = { subjectId: "member:2", checklistId: "LEG-09", state: "published" as const,
    sourceUrl: provenance.sourceUrl, checkedAt: at, freshUntil: "2026-10-01T06:00:00.000Z", value: "Existing supported field" };
  const owed = buildPlaceOwedList({ divisions: territories.map(id => ({ id, label: id })), ...capture,
    held: [...capture.held, extra], now: at });
  const rows = (i: number) => owed.filter(row => row.subject.id === `member:${i}`);
  for (const i of [0, 1]) {
    assert.ok(rows(i).some(row => row.checklistId === "LEG-22"));
    assert.ok(!rows(i).some(row => /^(?:EXE|PRL)-/.test(row.checklistId)));
  }
  for (const i of [2, 3, 4, 5]) {
    assert.ok(rows(i).some(row => row.checklistId === "OFF-04" && row.state === "published"));
    assert.ok(rows(i).some(row => row.checklistId === "EXE-01"), "local executives remain possible");
    assert.ok(!rows(i).some(row => /^(?:LEG|PRL)-/.test(row.checklistId) && row.state === "missing"));
  }
  assert.equal(rows(2).find(row => row.checklistId === "LEG-09")?.state, "published", "retain actual held evidence");
  assert.ok(rows(6).some(row => row.checklistId === "PRL-01"), "an unresolved statewide role keeps its work");
  assert.equal(owed.filter(row => row.subject.id.includes("#inventory:")).length, territories.length * 6);
  assert.ok(capture.held.every(field => field.checkedAt === at), "classification does not refresh source clocks");
});

test("only published present fields count, and failed reads cannot look like empty holdings", () => {
  const timed = published({ meetings: [{ ...meeting, startPrecision: "MINUTE", online: { url: "https://cochise.az.gov/meeting" } }] } as unknown as MeetingsSnapshot);
  const result = projectHeldPlaceCapture([county], registry, [timed], at);
  assert.ok(result.held.some(field => field.checklistId === "MTG-07"));
  assert.ok(result.held.some(field => field.checklistId === "MTG-08"));
  const failure = { kind: "STORE_UNREACHABLE", metadata: { recordClass: "MEETING", scope: "held" } } as unknown as CivicDataReadResult<MeetingsSnapshot>;
  assert.throws(() => projectHeldPlaceCapture([county], registry, [failure], at), /HELD_PLACE_READ_FAILED/);
  const sitting = { meetingId: meeting.id, bodyId: meeting.bodyId, ocdId: county, bodyName: "Shared district board",
    startsAt: meeting.startsAt, sourceUrl: provenance.sourceUrl, extraction: "NOT_YET_PUBLISHED",
    extractionNote: "The official minutes cell reads Not available.",
    publication: { observedAt: at, agendaFile: null, minutesFile: null },
    publicationObservations: [{ meetingId: meeting.id, provenance: "FIRST_PARTY_PUBLISHER", report: "NOT_AVAILABLE",
      observedAt: at, observedUrl: provenance.sourceUrl, sourceOrg: "County", evidenceQuote: "Not available", routeId: "INSITE_CALENDAR" }] };
  const outcomes = published({ sittings: [sitting] } as unknown as OutcomeSnapshot);
  const absent = projectHeldPlaceCapture([county], registry, [meetings], at, {}, [outcomes]);
  assert.deepEqual(absent.held.filter(field => field.state === "unpublished").map(field => field.checklistId),
    ["DOC-01", "DOC-02", "DOC-03", "DOC-06"]);
  assert.ok(absent.held.filter(field => field.state === "unpublished").every(field => field.checkedAt === at),
    "reading an official absence retains its actual source clock");
  const later = projectHeldPlaceCapture([county], registry, [meetings], "2026-10-02T06:00:00.000Z", {}, [outcomes]);
  assert.equal(later.held.filter(field => field.state === "unpublished").length, 0, "expired findings reopen the blanks");
  const failed = published({ sittings: [{ ...sitting, extraction: "REQUEST_FAILED", publicationObservations: [] }] } as unknown as OutcomeSnapshot);
  assert.equal(projectHeldPlaceCapture([county], registry, [meetings], at, {}, [failed]).held.filter(field => field.state === "unpublished").length, 0,
    "an empty or failed read is not an official absence");
  const available = published({ sittings: [{ ...sitting, extraction: "RETRIEVED", publicationObservations: [
    ...sitting.publicationObservations, { ...sitting.publicationObservations[0], routeId: "WEB_API", report: "AVAILABLE", observedAt: "2026-09-30T05:59:59.000Z" },
  ] }] } as unknown as OutcomeSnapshot);
  assert.equal(projectHeldPlaceCapture([county], registry, [meetings], at, {}, [available]).held.filter(field => field.state === "unpublished").length, 0,
    "conflicting official surfaces stay open");
});

test("retained roster contacts keep separate values and their earlier source dates", () => {
  const older = "2026-08-01T00:00:00.000Z";
  const sourceUrl = "https://cochise.az.gov/old-roster";
  const contacts = published({ ...registry.value!, bodyRosters: [{ ...registry.value!.bodyRosters[0], members: [{
    ...registry.value!.bodyRosters[0].members[0], email: "office@cochise.az.gov", phone: "520-555-0100",
    websiteUrl: "https://cochise.az.gov/member", termNote: "Term ends in 2028",
    retainedFieldSources: { email: { sourceUrl, sourceOrg: "County", collectedAt: older },
      websiteUrl: { sourceUrl, sourceOrg: "County", collectedAt: older } },
  }] }] });
  const result = projectHeldPlaceCapture([county], contacts, [], at);
  const email = result.held.find(field => field.checklistId === "OFF-09" && (field.value as { email?: string }).email);
  const phone = result.held.find(field => field.checklistId === "OFF-09" && (field.value as { phone?: string }).phone);
  const profile = result.held.find(field => (field.value as { websiteUrl?: string }).websiteUrl);
  assert.equal(email?.checkedAt, older);
  assert.equal(email?.sourceUrl, sourceUrl);
  assert.equal(phone?.checkedAt, at);
  assert.equal(profile?.checkedAt, older);
  assert.ok(result.held.some(field => field.checklistId === "OFF-06"));
});

test("national seats and campaign totals reuse exact division and target joins across ZIPs", () => {
  const families = { rosters: [{ officeholders: [{ id: "official:1", name: "Official One", officeTitle: "Representative",
    provenance, termStart: "2025-01-03", termEnd: "2027-01-03", email: null, phone: null, contactFormUrl: null, partyLabel: null }],
    divisions: [{ officeholderId: "official:1", ocdId: county }, { officeholderId: "official:1", ocdId: neighbour }] }],
    funding: { candidates: [{ fecCandidateId: "H000001", principalCommitteeId: "C000001", cycle: 2026,
      name: "Official One", targetKeys: ["official:1"], provenance,
      totals: { receipts: 0, disbursements: 15, cashOnHand: 20, coverageEndDate: "2026-06-30" } },
      { fecCandidateId: "H000002", principalCommitteeId: "C000002", cycle: 2026, name: "Official One",
        targetKeys: ["unmatched-same-name"], provenance, totals: { receipts: 100 } }] } } as unknown as HeldPlaceFamilies;
  const primary = projectHeldPlaceCapture([county], registry, [], at, families);
  const secondary = projectHeldPlaceCapture([neighbour], registry, [], at, families);
  assert.deepEqual(primary, secondary);
  assert.ok(primary.held.some(field => field.subjectId === "official:1" && field.checklistId === "OFF-06"));
  const totals = primary.held.find(field => field.checklistId === "CAM-05");
  assert.equal((totals?.value as { amount: number }).amount, 0, "published zero remains a zero");
  assert.equal(primary.subjects.find(subject => subject.id.startsWith("fec:"))?.captureKind, "federal-campaign-finance");
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...primary, now: at });
  assert.ok(!owed.some(row => row.subject.id.startsWith("fec:") && ["CAM-14", "CAM-15"].includes(row.checklistId)));
  assert.ok(owed.some(row => row.subject.id.startsWith("fec:") && row.checklistId === "CAM-13"));
  assert.ok(!primary.subjects.some(subject => subject.id.includes("H000002")), "same name cannot bind another committee");
  assert.equal(projectHeldPlaceCapture(["other-county"], registry, [], at, families).held.length, 0);
});

test("ballot candidacies, filings and voting sites retain their exact place and publication meaning", () => {
  const state = "ocd-division/country:us/state:az";
  const families = { ballots: [{ election: { id: "az-election", date: "2026-11-03", state: "AZ", name: "General election" },
    contests: [{ id: "contest-1", title: "County Supervisor", ocdId: county, electionId: "az-election", voteFor: 1, termYears: 4, provenance }],
    candidacies: [{ id: "candidate-1", contestId: "contest-1", givenName: "Candidate", familyName: "One", incumbent: null, provenance }],
    measures: [] }],
    votingSites: { jurisdictions: [{ ocdId: county, name: "County", model: "VOTE_CENTER", election: "2026 General",
      sites: [{ id: "site-1", name: "Public hall", address: "1 Main Street" }], refusal: null, sourceUrl: provenance.sourceUrl, collectedAt: at },
      { ocdId: neighbour, sites: [], refusal: { wall: "unread" } }] },
    filings: [{ id: "filing-1", kind: "CANDIDATE_FILING_DOCUMENT", bodyId: "county-body", bodyName: "County",
      ocdId: county, jurisdictionName: "County", sourceUrl: provenance.sourceUrl, documentUrl: "https://cochise.az.gov/filing.pdf",
      collectedAt: at, verifiedAt: at, facts: { candidateName: "Filed Candidate", office: "Supervisor" } }],
    electionDates: [{ state: "AZ", electionDay: "2026-11-03", sourceUrl: provenance.sourceUrl,
      collectedAt: "2026-08-01", steps: [{ label: "Registration deadline", date: "2026-10-05", detail: "11:59 pm" }] }],
  } as unknown as HeldPlaceFamilies;
  const result = projectHeldPlaceCapture([county, state], registry, [], at, families);
  assert.ok(result.held.some(field => field.subjectId === "candidate-1" && field.checklistId === "CAN-02"));
  assert.ok(!result.held.some(field => field.checklistId === "ELE-07"), "filing and candidacy membership do not claim certification");
  assert.deepEqual(result.held.filter(field => field.subjectId === "filing-1").map(field => field.checklistId), ["CAN-01"]);
  assert.ok(result.held.some(field => field.checklistId === "ELE-09"));
  const deadline = result.held.find(field => field.checklistId === "ELE-08");
  assert.equal(deadline?.state, "held");
  assert.equal(deadline?.checkedAt, "2026-08-01");
  assert.ok(Date.parse(deadline!.freshUntil) < Date.parse(at), "adopted calendar is not newly checked by reading it");
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }, { id: state, label: "State" }], ...result, now: at });
  assert.deepEqual(owed.filter(row => row.subject.id === deadline!.subjectId).map(row => row.checklistId), ["ELE-08"]);
  assert.ok(owed.filter(row => row.subject.id === "candidate-1").every(row => row.checklistId.startsWith("CAN-")));
  assert.ok(owed.some(row => row.subject.id === `voting-sites:${county}` && row.checklistId === "ELE-22"), "actual site hours remain owed");
  const elsewhere = projectHeldPlaceCapture([neighbour], registry, [], at, families);
  assert.ok(!elsewhere.subjects.some(subject => subject.kind === "contest" || subject.kind === "deadline"));
});

test("canonical legislative roles reach the owed list without guessing from a person's title", () => {
  const state = "ocd-division/country:us/state:mo", district = `${state}/sldl:1`;
  const families = { rosters: [{ officeholders: [
    { id: "congress:test", name: "Federal Member", officeTitle: "Member", level: "FEDERAL", provenance },
    { id: "state:test", name: "State Member", officeTitle: "Member", level: "STATE", provenance },
    { id: "other:test", name: "Unknown Member", officeTitle: "State Senator", level: "LOCAL", provenance },
  ], divisions: [
    { officeholderId: "congress:test", ocdId: state },
    { officeholderId: "state:test", ocdId: district },
    { officeholderId: "other:test", ocdId: county },
  ] }] } as unknown as HeldPlaceFamilies;
  const capture = projectHeldPlaceCapture([state, district, county], registry, [], at, families);
  assert.equal(capture.subjects.find(s => s.id === "congress:test")?.captureKind, "federal-legislator");
  assert.equal(capture.subjects.find(s => s.id === "state:test")?.captureKind, "state-legislator");
  assert.equal(capture.subjects.find(s => s.id === "other:test")?.captureKind, undefined);
  const owed = buildPlaceOwedList({ divisions: [state, district, county].map(id => ({ id, label: id })), ...capture, now: at });
  assert.ok(!owed.some(row => row.subject.id === "state:test" && row.checklistId.startsWith("PRL-")));
  assert.ok(owed.some(row => row.subject.id === "congress:test" && row.checklistId === "PRL-01"));
});

test("unmatched state finance and unreported totals cannot fill published-money fields", () => {
  const makeRecord = (filingState: string, targetKeys: string[], totals: Record<string, unknown>) => ({ dataClass: "STATE_COMMITTEE",
    jurisdiction: "AZ", electionYear: 2026, registeredName: "Committee", candidateNameAsFiled: "Member",
    committeeId: "C1", agency: "Secretary of State", filingsUrl: provenance.sourceUrl, checkedAt: at,
    provenance: { ...provenance, verifiedAt: at }, filingState, targetKeys,
    match: { allThreeAgree: true }, totals,
  });
  const families = { stateMoney: [{ records: [makeRecord("FILED", ["member"], { receipts: 0, expenditures: null, cashOnHand: null, coveringPeriod: "2026 Q2" }),
    makeRecord("LEAD", ["member"], { receipts: 999 }), makeRecord("FILED", ["unknown-person"], { receipts: 888 })] }] } as unknown as HeldPlaceFamilies;
  const result = projectHeldPlaceCapture([county], registry, [], at, families);
  assert.equal(result.held.filter(field => field.checklistId === "CAM-05").length, 1);
  assert.equal((result.held.find(field => field.checklistId === "CAM-05")?.value as { amount: number }).amount, 0);
  assert.ok(!result.held.some(field => field.checklistId === "CAM-06" || field.checklistId === "CAM-07"));
  const owed = buildPlaceOwedList({ divisions: [{ id: county, label: "County" }], ...result, now: at });
  assert.ok(owed.some(row => row.subject.id.startsWith("state-money:") && row.checklistId === "CAM-14"));
  assert.ok(!owed.some(row => row.subject.id.startsWith("state-money:") && ["CAM-13", "CAM-15"].includes(row.checklistId)));
});
