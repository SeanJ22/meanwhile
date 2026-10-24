import assert from "node:assert/strict";
import test from "node:test";
import type { BallotSet, Candidacy, Contest } from "../lib/ballot/types.ts";
import { sameSeatDiscriminators } from "../lib/officials/office-seat.ts";
import { officialCandidacySeatMatches, reconcileOfficialCandidacies,
  registryRuntimeProjectionIssues, type OfficialCandidacyBridge, type OfficialCandidacyBridgeRow, type RegistryRuntimeCarton } from "../lib/registry/runtime-data-plane.ts";

const division = "ocd-division/country:us/state:az";
const provenance = { sourceUrl: "https://elections.example.gov/candidates", sourceOrg: "State election authority",
  collectedAt: "2026-10-24T12:00:00Z", verifiedAt: null };
const bridge: OfficialCandidacyBridge = { formatVersion: 1, rule: "EXACT_SEAT_CONSERVATIVE_NAME_OFFLINE_UNIQUE", rows: [] };
const holder = (id: string, name: string, officeTitle: string): OfficialCandidacyBridgeRow["holder"] => ({
  id, name, officeTitle, divisions: [division], authority: "REGISTRY_STATEWIDE_EXECUTIVE",
  sourceUrl: `https://state.example.gov/officials/${id}`,
});
const contest = (id: string, title: string): Contest => ({ id, electionId: "az-general", ocdId: division,
  divisionVintage: "2026", title, type: "CANDIDACY", voteFor: 1, termYears: 4, scopeNote: null,
  candidateListComplete: true, provenance });
const candidate = (id: string, contestId: string, name: string): Candidacy => ({ id, contestId,
  givenName: "", familyName: name, partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance });
const ballot = (contests: Contest[], candidacies: Candidacy[]): BallotSet => ({
  election: { id: "az-general", state: "AZ", name: "General election", date: "2026-11-03" },
  contests, candidacies, measures: [], absences: [],
});

test("a verified person link carries records when a roster omits position detail, without proving exact-seat incumbency", () => {
  const district = "ocd-division/country:us/state:wa/sldl:24";
  const official = { ...holder("held:person", "Steve Tharinger", "State Representative"),
    divisions: [district], authority: "STATE_PEOPLE" as const, officialProfileUrl: "https://leg.wa.gov/people/steve-tharinger/" };
  const race = { ...contest("house-position-2", "State Representative Pos. 2, Legislative District 24"), ocdId: district };
  const input = ballot([race], [candidate("source:tharinger", race.id, official.name)]);
  const joined = reconcileOfficialCandidacies({ bridge, ballots: [input], holders: [official] });
  assert.equal(joined.rows[0].status, "RESOLVED");
  assert.equal(officialCandidacySeatMatches(joined.rows[0]), true);
  assert.equal(joined.rows[0].candidacy?.personId, official.id);
  assert.equal(sameSeatDiscriminators(race.title, official.officeTitle, district), false,
    "the independent incumbency check still needs the exact position");
  const conflicting = { ...official, officeTitle: "State Representative Position 1, District 24" };
  assert.ok(!reconcileOfficialCandidacies({ bridge, ballots: [input], holders: [conflicting] }).rows.some(row => row.status === "RESOLVED"));
  const wrongDistrict = { ...race, title: "State Representative Pos. 2, Legislative District 25" };
  assert.ok(!reconcileOfficialCandidacies({ bridge, ballots: [ballot([wrongDistrict], input.candidacies)], holders: [official] }).rows.some(row => row.status === "RESOLVED"));
});

test("source aliases retain one same-seat person connection on the next reconciliation", () => {
  const official = holder("governor-person", "Katie Hobbs", "Governor");
  const first = candidate("source-a:hobbs", "governor-a", "Katie Hobbs");
  const next = { ...candidate("source-b:hobbs", "governor-b", "Katie Hobbs"),
    aliases: [first.id, "governor-a|Katie Hobbs"] };
  const inputs = [ballot([contest("governor-a", "Governor")], [first]),
    ballot([contest("governor-b", "Governor")], [next])];
  const joined = reconcileOfficialCandidacies({ bridge, ballots: inputs, holders: [official] });
  const row = joined.rows[0];
  assert.equal(row.status, "RESOLVED");
  assert.equal(officialCandidacySeatMatches(row), true);
  assert.equal(row.candidacy?.personId, official.id);
  assert.deepEqual(new Set([row.candidacy!.candidacyId, ...row.candidacy!.aliases!]),
    new Set([first.id, next.id, "governor-a|Katie Hobbs", "governor-b|Katie Hobbs"]));
  assert.deepEqual(reconcileOfficialCandidacies({ bridge: joined, ballots: inputs, holders: [official] }), joined);
});

test("a ticket connects both people separately, and a joint target remains the lead's alias", () => {
  const leadHolder = holder("governor-person", "Katie Hobbs", "Governor");
  const mateHolder = holder("lieutenant-person", "John Giles", "Lieutenant Governor");
  const mate = { ...candidate("source:mate", "lieutenant", "John Giles"), office: "Lieutenant Governor" };
  const lead = { ...candidate("source:lead", "governor", "Katie Hobbs"),
    aliases: ["governor|Katie Hobbs", "governor|Katie Hobbs / John Giles"],
    ticket: { id: "governor-ticket", runningMate: mate, provenance } };
  const input = ballot([contest("governor", "Governor / Lieutenant Governor")], [lead]);
  const joined = reconcileOfficialCandidacies({ bridge, ballots: [input], holders: [leadHolder, mateHolder] });
  const leadRow = joined.rows.find(row => row.holder.id === leadHolder.id)!;
  const mateRow = joined.rows.find(row => row.holder.id === mateHolder.id)!;
  assert.equal(officialCandidacySeatMatches(leadRow), true);
  assert.equal(officialCandidacySeatMatches(mateRow), true);
  assert.equal(leadRow.candidacy?.candidateName, "Katie Hobbs");
  assert.equal(mateRow.candidacy?.candidateName, "John Giles");
  assert.equal(leadRow.candidacy?.candidacyId, lead.id);
  assert.equal(mateRow.candidacy?.candidacyId, mate.id);
  assert.ok(leadRow.candidacy?.aliases?.includes("governor|Katie Hobbs / John Giles"));
  assert.ok(!mateRow.candidacy?.aliases?.includes("governor|Katie Hobbs / John Giles"));
});

test("a name prefix or an unsupported person id never joins a different person or office", () => {
  const official = holder("person:1", "Sally Ann Gonzales", "State Senator");
  const wrongOffice = { ...candidate("candidate:1", "house", "Sally Ann Gonzales"), personId: official.id };
  assert.equal(reconcileOfficialCandidacies({ bridge, ballots: [ballot([contest("house", "State Representative")], [wrongOffice])],
    holders: [official] }).rows.length, 0);
  const other = holder("person:2", "John Example", "Governor");
  const prefix = candidate("candidate:2", "governor", "Johnny Example");
  const joined = reconcileOfficialCandidacies({ bridge, ballots: [ballot([contest("governor", "Governor")], [prefix])], holders: [other] });
  assert.equal(joined.rows[0].status, "NO_APPLICABLE_CANDIDACY");
});

test("an official joint name cell links two people without losing the lead office", () => {
  const lead = holder("governor-person", "Katie Hobbs", "Governor");
  const mate = holder("lieutenant-person", "John Giles", "Lieutenant Governor");
  const input = ballot([contest("joint", "Governor and Lieutenant Governor")],
    [candidate("joint-candidate", "joint", "Katie Hobbs / John Giles")]);
  const joined = reconcileOfficialCandidacies({ bridge, ballots: [input], holders: [lead, mate] });
  assert.equal(joined.rows.length, 2);
  assert.ok(joined.rows.every(officialCandidacySeatMatches));
  assert.deepEqual(joined.rows.map(row => row.candidacy?.candidateName), ["Katie Hobbs", "John Giles"]);
  assert.equal(joined.rows[0].candidacy?.candidacyId, "joint-candidate");
  assert.equal(joined.rows[1].candidacy?.candidacyId, "joint-candidate:running-mate");
});

test("a later complete empty list retires a former same-seat candidate connection", () => {
  const official = holder("governor-person", "Katie Hobbs", "Governor");
  const first = ballot([contest("governor", "Governor")], [candidate("source:lead", "governor", "Katie Hobbs")]);
  const joined = reconcileOfficialCandidacies({ bridge, ballots: [first], holders: [official] });
  const empty = ballot([contest("governor", "Governor")], []);
  empty.election = { ...empty.election, date: "2028-11-07" };
  const next = reconcileOfficialCandidacies({ bridge: joined, ballots: [first, empty], holders: [official] });
  assert.equal(next.rows[0].status, "NO_APPLICABLE_CANDIDACY");
  assert.equal(next.rows[0].candidacy, null);
});

test("an existing sourced nickname relationship survives refresh, while a successor cannot inherit it", () => {
  const official = holder("governor-person", "Chris Example", "Governor");
  const input = ballot([contest("governor", "Governor")], [candidate("source:lead", "governor", "Christopher John Example")]);
  const committed: OfficialCandidacyBridge = { ...bridge, rows: [{ holder: official, status: "RESOLVED", candidacy: {
    candidacyId: "source:lead", contestId: "governor", contestTitle: "Governor", divisionId: division,
    electionId: input.election.id, candidateName: "Christopher John Example", sourceUrl: provenance.sourceUrl,
  }, reason: "The two saved official sources verify this person in this exact seat.", unresolvedCandidacyIds: [] }] };
  const next = reconcileOfficialCandidacies({ bridge: committed, ballots: [input], holders: [official] });
  assert.equal(next.rows[0].status, "RESOLVED");
  assert.equal(officialCandidacySeatMatches(next.rows[0]), true);
  assert.ok(next.rows[0].candidacy?.aliases?.includes("governor|Christopher John Example"));
  const repeatedMembership = reconcileOfficialCandidacies({ bridge: committed, ballots: [input],
    holders: [{ ...official, divisions: [division, division, division] }] });
  assert.equal(repeatedMembership.rows[0].status, "RESOLVED", "several memberships in one division keep the same person link");
  const changed = reconcileOfficialCandidacies({ bridge: committed, ballots: [input],
    holders: [{ ...official, name: "A Different Person" }] });
  assert.equal(changed.rows[0].status, "NO_APPLICABLE_CANDIDACY");
  assert.equal(changed.rows[0].candidacy, null);
});

test("official source slots and a reference feed with its official profile retain one committed governor", () => {
  const rich = holder("statewide:az/governor", "Katie Hobbs", "Governor");
  const national = { ...holder("statewide:az/hash", "Katie Hobbs", "Governor"), sourceUrl: "https://www.usa.gov/states/arizona" };
  const reference = { ...holder("plural:az:hobbs", "Katie Hobbs", "Governor"), authority: "STATE_PEOPLE" as const,
    personId: "plural:hobbs", nativeIds: { plural: ["hobbs"] },
    sourceUrl: "https://raw.githubusercontent.com/openstates/people/revision/data/az/executive/Katie-Hobbs.yml",
    officialProfileUrl: "https://azgovernor.gov/" };
  const input = ballot([contest("governor", "Governor")], [candidate("source:lead", "governor", "Katie Hobbs")]);
  const committed = reconcileOfficialCandidacies({ bridge, ballots: [input], holders: [rich] });
  const joined = reconcileOfficialCandidacies({ bridge: committed, ballots: [input], holders: [national, rich, reference] });
  assert.equal(joined.rows.length, 3);
  assert.ok(joined.rows.every(row => row.status === "RESOLVED" && officialCandidacySeatMatches(row)));
  assert.deepEqual(new Set(joined.rows.map(row => row.holder.id)), new Set([rich.id, national.id, reference.id]));
  assert.ok(joined.rows.every(row => row.candidacy?.personId === rich.id));
  const next = reconcileOfficialCandidacies({ bridge: { ...joined, rows: [...joined.rows].reverse() },
    ballots: [input], holders: [reference, national, rich] });
  assert.ok(next.rows.every(row => row.candidacy?.personId === rich.id), "source order cannot change the committed person on the next run");
  const model = { formatVersion: 1, registry: { divisions: [], bodies: [] },
    statewideExecutives: [rich, national].map(row => ({ stateOcdId: division, holder: row, sourceUrl: row.sourceUrl,
      sourceOrg: "Official publisher", collectedAt: provenance.collectedAt, verification: "PAGE_FETCHED" })),
    officialCandidacies: joined, officialPhotos: { photos: [] }, rosterPhotos: {} } as unknown as RegistryRuntimeCarton;
  assert.ok(!registryRuntimeProjectionIssues(model).includes("OFFICIAL_CANDIDACY_ID_INVALID_OR_DUPLICATED"));
  const noOfficialProfile = reconcileOfficialCandidacies({ bridge: committed, ballots: [input],
    holders: [national, rich, { ...reference, officialProfileUrl: undefined }] });
  assert.ok(noOfficialProfile.rows.every(row => row.status === "IDENTITY_UNRESOLVED"), "a reference name without an official profile cannot collapse a current holder");
  const conflict = { ...model, officialCandidacies: { ...joined, rows: joined.rows.map((row, index) => ({ ...row,
    holder: { ...row.holder, nativeIds: { "official-person": [String(index)] } } })) } };
  assert.ok(registryRuntimeProjectionIssues(conflict).includes("OFFICIAL_CANDIDACY_ID_INVALID_OR_DUPLICATED"));
});

test("same-name native conflicts and multi-member offices do not become duplicate executive identities", () => {
  const input = ballot([contest("governor", "Governor")], [candidate("source:lead", "governor", "Katie Hobbs")]);
  const first = { ...holder("holder:one", "Katie Hobbs", "Governor"), nativeIds: { "official-person": ["one"] } };
  const second = { ...holder("holder:two", "Katie Hobbs", "Governor"), nativeIds: { "official-person": ["two"] } };
  assert.ok(reconcileOfficialCandidacies({ bridge, ballots: [input], holders: [first, second] }).rows
    .every(row => row.status === "IDENTITY_UNRESOLVED"));
  const representatives = [holder("holder:one", "A Person", "State Representative"),
    holder("holder:two", "A Person", "State Representative")];
  const house = ballot([contest("house", "State Representative")], [candidate("house:person", "house", "A Person")]);
  assert.ok(reconcileOfficialCandidacies({ bridge, ballots: [house], holders: representatives }).rows
    .every(row => row.status === "IDENTITY_UNRESOLVED"));
});
