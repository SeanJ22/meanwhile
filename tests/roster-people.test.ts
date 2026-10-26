import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { namesAgree, nameParts } from "../lib/ballot/incumbency.ts";
import { rosterPeople, sameRosterPerson, withRosterPeople } from "../lib/registry/roster-people.ts";
import { earlierRosterHoldersForBody, rosterHoldersForBody, divisionOcdIdForRosterHolder, type BodyRoster, type RosterMember } from "../lib/registry/body-rosters.ts";
import { getRegistryRuntimeReadModel, withRegistryRuntimeProjection, currentRosterMemberReaderDisposition } from "../lib/registry/runtime-read-model.ts";
import type { RegistryRuntimeReadModel } from "../lib/registry/runtime-data-plane.ts";
import { seatHolderById } from "../lib/registry/server.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";

const division = "ocd-division/country:us/state:az/county:pima";
const bodyId = `${division}#governing`;
const member = (id: string, name: string, officeTitle = "County Supervisor, District 2"): RosterMember => ({
  id, name, officeTitle, email: null, phone: null, termNote: null, websiteUrl: null,
});
const roster = (members: RosterMember[]): BodyRoster => ({ bodyId, bodyName: "Pima County Board of Supervisors",
  sourceUrl: "https://www.pima.gov/board", sourceOrg: "Pima County", collectedAt: "2026-10-01",
  partisanship: "PARTISAN", members });
function runtime(rosters: BodyRoster[]): RegistryRuntimeReadModel {
  const fixture = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/registry-transfer-import.json.gz", import.meta.url))).toString());
  return { ...fixture.projection.payload, bodyRosters: rosters, rosterReaderDispositions: [],
    officialCandidacies: { ...fixture.projection.payload.officialCandidacies, rows: [] } };
}

test("six Pima source rows become five people, retaining both Heinz IDs, contact, portrait, and sources", async () => {
  const old = member("roster:pima#2", "Dr. Matt Heinz");
  old.personId = "ocd-person/c3a16895-5a1f-438c-b45c-805c22cc35b9";
  old.websiteUrl = "https://www.pima.gov/District2";
  old.phone = "520-724-2702";
  const fresh = { ...member("legistar:pima:205", "Matt Heinz"), nativeIds: { legistar: ["pima:205"] },
    personId: "ocd-person/d48ab10a-ebf1-401a-9352-31f9ed6f1f0c",
    email: "matt.heinz@pima.gov", membershipSource: {
      sourceUrl: "https://pima.legistar.com/PersonDetail.aspx?ID=205", sourceOrg: "Pima County", collectedAt: "2026-10-20",
    } };
  const held = { ...runtime([roster([member("pima:1", "Rex Scott", "County Supervisor, District 1"), old,
    member("pima:3", "Jennifer Allen", "County Supervisor, District 3"),
    member("pima:4", "Steve Christy", "County Supervisor, District 4"),
    member("pima:5", "Andrés Cano", "County Supervisor, District 5"), fresh])]),
    rosterPhotos: { [fresh.id]: "/portraits/matt-heinz.jpg" }, officialPhotos: { photos: [] } };
  const original = JSON.stringify(held);
  await withRegistryRuntimeProjection(held, ["AZ"], async () => {
    const members = rosterHoldersForBody(bodyId);
    assert.equal(members.length, 5);
    const heinz = members.find(row => row.nativeIds?.reader?.includes(fresh.id))!;
    assert.equal(heinz.phone, old.phone);
    assert.equal(heinz.email, fresh.email);
    assert.equal(heinz.photoUrl, "/portraits/matt-heinz.jpg");
    assert.deepEqual(new Set(heinz.sourceHolders?.map(row => row.id)), new Set([old.id, fresh.id]));
    assert.equal(new Set(heinz.sourceHolders?.map(row => row.sourceUrl)).size, 2);
    assert.equal(divisionOcdIdForRosterHolder(fresh.id), division);
    assert.equal(currentRosterMemberReaderDisposition(fresh.id)?.canonicalId, old.id);
    assert.ok(readerPersonKeys(old.id).keys.includes(fresh.id));
    assert.ok(readerPersonKeys(fresh.id).keys.includes(old.id));
    assert.equal((await seatHolderById(fresh.id, "AZ"))?.id, old.id);
    assert.equal((await seatHolderById(old.id, "AZ"))?.id, old.id);
    assert.equal((await seatHolderById(fresh.id, "AZ"))?.photoUrl, heinz.photoUrl);
    assert.deepEqual((await seatHolderById(fresh.id, "AZ"))?.sourceHolders, heinz.sourceHolders);
    assert.equal(getRegistryRuntimeReadModel().bodyRosters[0].members.length, 5);
  });
  assert.equal(JSON.stringify(held), original);
});

test("the ballot's shared name comparison supplies middle-name matching and strips only published titles", () => {
  const examples = [["Matt J.", "Matt James", true], ["Matt", "Matt James", true],
    ["Matt James", "Matt Karl", false], ["Matthew", "Matt", false]] as const;
  for (const [a, b, expected] of examples) {
    assert.equal(namesAgree(nameParts(a, "Heinz"), nameParts(b, "Heinz")), expected);
    assert.equal(sameRosterPerson(member("a", `Dr. ${a} Heinz`), member("b", `${b} Heinz`), division), expected);
  }
});

test("known different people and numbered seats remain distinct", () => {
  const left = member("a", "Matt Heinz"), right = member("b", "Matt Heinz");
  assert.equal(sameRosterPerson({ ...left, personId: "person:a" }, { ...right, personId: "person:b" }, division), false);
  assert.equal(sameRosterPerson({ ...left, nativeIds: { official: ["1"] } }, { ...right, nativeIds: { official: ["2"] } }, division), false);
  assert.equal(sameRosterPerson(left, { ...right, officeTitle: "County Supervisor, District 3" }, division), false);
  assert.equal(sameRosterPerson(left, { ...right, officeTitle: "Mayor" }, division), false);
  assert.equal(rosterPeople(roster([left, { ...right, officeTitle: "County Supervisor, District 3" }])).members.length, 2);
  assert.equal(sameRosterPerson({ ...left, personId: "person:source-heinz" },
    { ...right, personId: "ocd-person/d48ab10a-ebf1-401a-9352-31f9ed6f1f0c" }, division), true,
  "an internal extraction key cannot contradict an identified publisher person");
});

test("an exact native identity can retain two published roles for one person", () => {
  const result = rosterPeople(roster([{ ...member("a", "Dr. Matt Heinz"), personId: "person:heinz" },
    { ...member("b", "Matt Heinz", "Vice Chair"), personId: "person:heinz" }]));
  assert.equal(result.members.length, 1);
  assert.equal(result.members[0].sourceMembers?.length, 2);
});

test("an omitted middle name cannot bridge conflicting named people", () => {
  const result = rosterPeople(roster([member("a", "Matt James Heinz"), member("b", "Matt Heinz"), member("c", "Matt Karl Heinz")]));
  assert.equal(result.members.length, 2);
  assert.ok(result.members.every(row => !(row.sourceMembers?.some(source => source.name === "Matt James Heinz") &&
    row.sourceMembers.some(source => source.name === "Matt Karl Heinz"))));
});

test("person merging never crosses bodies, and the runtime projection caches unchanged and merged records", () => {
  const members = [member("a", "Dr. Matt Heinz"), member("b", "Matt Heinz")];
  const source = runtime([roster(members), { ...roster([members[0]]), bodyId: "another-body" }]);
  const projected = withRosterPeople(source);
  assert.equal(projected.bodyRosters[0].members.length, 1);
  assert.equal(projected.bodyRosters[1].members.length, 1);
  assert.equal(withRosterPeople(source), projected);
  assert.equal(withRosterPeople(projected), projected);
  assert.equal(source.bodyRosters[0].members.length, 2);
  const untouched = runtime([roster([members[0]])]);
  assert.equal(withRosterPeople(untouched), untouched);
});

test("earlier reverse aliases cannot form a cycle after person merging", () => {
  const source = { ...runtime([roster([member("a", "Dr. Matt Heinz"), member("b", "Matt Heinz")])]),
    rosterReaderDispositions: [{ sourceId: "a", canonicalId: "b", state: "EXACT_DUPLICATE" as const, reason: "Earlier source identity" }] };
  const projected = withRosterPeople(source);
  assert.equal(projected.rosterReaderDispositions.find(row => row.sourceId === "a")?.state, "READER_ELIGIBLE");
  assert.equal(projected.rosterReaderDispositions.find(row => row.sourceId === "b")?.canonicalId, "a");
});

test("a complete newer official roster keeps older generic memberships as accessible history", async () => {
  const current = Array.from({ length: 7 }, (_, index) => ({ ...member(`current:${index}`, `Current Person${index}`, `Ward ${index + 1} Council Member`),
    membershipSource: { sourceUrl: "https://www.tucsonaz.gov/Government/Mayor-Council-and-City-Manager", sourceOrg: "City of Tucson", collectedAt: "2026-10-24" } }));
  const old = { ...member("earlier:person", "Earlier Member", "Member"), membershipSource: {
    sourceUrl: "https://www.tucsonaz.gov/Government/City-Information/City-Contacts", sourceOrg: "City of Tucson", collectedAt: "2026-10-22",
  } };
  const bodyId = "ocd-division/country:us/state:az/place:tucson#governing";
  const held = runtime([{ ...roster([...current, old]), bodyId }]);
  await withRegistryRuntimeProjection(held, ["AZ"], async () => {
    assert.equal(rosterHoldersForBody(bodyId).length, 7);
    assert.deepEqual(earlierRosterHoldersForBody(bodyId).map(row => row.id), [old.id]);
    assert.equal((await seatHolderById(old.id, "AZ"))?.name, old.name);
    assert.ok(readerPersonKeys(old.id).keys.includes(old.id));
  });
  assert.equal(held.bodyRosters[0].members.length, 8, "original source membership remains held");
});

test("a partial new roster or explicit older seat cannot be suppressed to fit a denominator", () => {
  const current = [member("a", "First Person", "District 1 Member"), member("b", "Second Person", "District 2 Member")]
    .map(row => ({ ...row, membershipSource: { sourceUrl: "https://example.gov/board", sourceOrg: "Official board", collectedAt: "2026-10-24" } }));
  const old = { ...member("old", "Earlier Person", "Member"), membershipSource: {
    sourceUrl: "https://example.gov/directory", sourceOrg: "Official board", collectedAt: "2026-10-22" } };
  assert.equal(rosterPeople(roster([...current, old]), 3).members.length, 3);
  assert.equal(rosterPeople(roster([...current, { ...old, officeTitle: "District 3 Member" }]), 2).members.length, 3);
  assert.equal(rosterPeople(roster([...current.map(row => ({ ...row, membershipSource: { ...row.membershipSource,
    sourceUrl: "https://unverified.example/board" } })), old]), 2).members.length, 3);
});
