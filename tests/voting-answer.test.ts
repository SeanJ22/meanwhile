import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { answerVotingSites, projectVotingJurisdiction, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { narrowingFor, votingSitesForDisplay, type VotingJurisdiction, type VotingSite, type VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const read = (file: string) => JSON.parse(readFileSync(new URL(`./fixtures/voting-sources/${file}`, import.meta.url), "utf8"));
const official = { publisher: "Okaloosa County Supervisor of Elections", url: "https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=okaloosa", checkedAt: "2026-10-13" };
const sites: VotingSite[] = read("voterfocus-okaloosa-normalized.json").sites.map((site: { name: string; address: string; precinct: string }) => ({ ...site,
  id: `okaloosa-${site.precinct}`, kind: "ELECTION_DAY", room: null, lat: null, lng: null, election: null, serves: site.precinct, countyFips: "12091", sources: [official] }));
const jurisdiction: VotingJurisdiction = { ocdId: "ocd-division/country:us/state:fl/county:okaloosa", name: "Okaloosa County", state: "FL", countyFips: "12091",
  model: "ASSIGNED", election: null, sites, sourceOrg: official.publisher, sourceUrl: official.url, collectedAt: official.checkedAt, refusal: null };
const file: VotingSitesFile = { generatedAt: "2026-10-13", jurisdictions: [jurisdiction] };
const place: VotingReaderPlace = { precision: "ADDRESS", point: { lat: 30.803, lng: -86.68 }, divisionIds: [jurisdiction.ocdId], states: ["FL"], countyFips: ["12091"],
  countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };

const lookup = (shape: VotingSourceDoor["shape"]): VotingSourceDoor => ({ id: shape, publisher: official.publisher, url: "https://www.voteokaloosa.gov/lookup", shape,
  covers: ["ELECTION_DAY"], scope: { state: "FL", ocdId: jurisdiction.ocdId, name: jurisdiction.name, countyFips: "12091" }, electionDate: "2026-11-03",
  electionPageUrl: "https://www.voteokaloosa.gov/", extraction: { addressFields: { address: "address" } } });

test("VS-01 real county rows preserve precinct names; one loaded place never proves assignment", () => {
  const result = projectVotingJurisdiction(jurisdiction, place);
  assert.ok(result.sites.some(site => site.name === "Baker Area Recreation Bldg" && site.address === "5503 HWY 4 Baker, FL 32531"));
  assert.equal(result.narrowing.kind, "REFUSED");
  assert.equal(narrowingFor({ ...jurisdiction, sites: sites.slice(0, 1) }).kind, "REFUSED");
});

test("VS-01 published precinct matching narrows a county directory; a ZIP never assigns its centroid precinct", () => {
  const resolved = { ...place, precincts: [{ name: "Precinct 01", countyFips: "12091", kind: "CENSUS_2020_VTD" as const }] };
  const result = projectVotingJurisdiction(jurisdiction, resolved);
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0].name, "Baker Area Recreation Bldg");
  assert.equal(result.narrowing.kind, "EXACT");
  const zip = projectVotingJurisdiction(jurisdiction, { ...resolved, precision: "ZIP" });
  assert.equal(zip.sites.length, sites.length);
  assert.equal(zip.narrowing.kind, "REFUSED");
});

test("VS-01 held precinct records answer without making official or Google requests", async () => {
  const previous = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("A reader must never fetch a source after geocoding"); };
  try {
    const answer = await answerVotingSites({ ...file, jurisdictions: [{ ...jurisdiction, addressLookups: [lookup("address-lookup"), lookup("identity-locked-lookup")] }] }, place);
    assert.equal(requests, 0);
    assert.equal(answer.jurisdictions[0].sites.length, sites.length);
    assert.equal(answer.jurisdictions[0].addressLookups, undefined);
    assert.equal(answer.googleFallback, undefined);
    const gap = await answerVotingSites({ ...file, jurisdictions: [{ ...jurisdiction, sites: [] }] }, place);
    assert.equal(gap.outsideCoverage, true, "an office or source record is not voting-site coverage");
  } finally { globalThis.fetch = previous; }
});

test("VS-01 no-drop-box rule carries legal return routes from the state source", async () => {
  const sample = read("al-absentee-return-rule.json");
  const al: VotingJurisdiction = { ...jurisdiction, ocdId: "ocd-division/country:us/state:al", state: "AL", countyFips: undefined, name: "Alabama", sites: [],
    rules: [{ text: sample.rule, source: { publisher: sample.publisher, url: sample.url } }, { text: sample.returnDeadline, source: { publisher: sample.publisher, url: sample.url } }] };
  const answer = await answerVotingSites({ ...file, jurisdictions: [al] }, { ...place, states: ["AL"], divisionIds: [al.ocdId], countyFips: [] });
  assert.match(answer.jurisdictions[0].rules![0].text, /personal hand delivery to the absentee election manager/);
  assert.match(answer.jurisdictions[0].rules![0].text, /do not include unattended ballot drop boxes/);
  assert.equal(answer.googleFallback, undefined);
});

test("VS-01 Puerto Rico no-general-election answer is sourced data and retains unresolved special-election scope", async () => {
  const sample = read("pr-election-calendar.json");
  const pr: VotingJurisdiction = { ...jurisdiction, ocdId: "ocd-division/country:us/territory:pr", state: "PR", countyFips: undefined, name: "Puerto Rico", sites: [], office: sample.office,
    publication: { status: "NO_GENERAL_ELECTION", text: "Puerto Rico has no general election on November 3, 2026.", source: { publisher: sample.publisher, url: sample.url },
      specialElections: ["The election office lists a 2026 Cataño special election; its applicability on November 3 is still being gathered."] } };
  const answer = await answerVotingSites({ ...file, jurisdictions: [pr] }, { ...place, states: ["PR"], divisionIds: [pr.ocdId], countyFips: [] });
  assert.match(answer.jurisdictions[0].modelSentence, /no general election on November 3, 2026/);
  assert.equal(answer.jurisdictions[0].office?.phone, "787-777-8682");
  assert.match(answer.jurisdictions[0].narrowing.sentence, /still being gathered/);
});

test("VS-01 all-mail ordering puts ballot returns first without dropping sites", () => {
  const input = { ...jurisdiction, allMail: true, sites: [{ ...sites[0], kind: "EARLY_VOTING" as const }, { ...sites[1], kind: "VOTE_CENTER" as const }, { ...sites[2], kind: "DROP_BOX" as const }] };
  assert.deepEqual(votingSitesForDisplay(input, null).map(row => row.site.kind), ["DROP_BOX", "VOTE_CENTER", "EARLY_VOTING"]);
});

test("VS-01 Texas identity-locked state answers from the official El Paso county list without identity inputs", async () => {
  const identity = read("tx-identity-locked-lookup.json");
  const body = readFileSync(new URL("./fixtures/voting-sources/tx-el-paso-vote-centers-official-extract.txt", import.meta.url), "utf8");
  const first = /【51†([^】]+)】\n([^\n]+)\n([^\n]+)/.exec(body)!;
  assert.ok(first);
  const hours = /All Vote Centers will be open from ([^\n]+)/.exec(body)?.[1];
  assert.match(body, /All Vote Centers will be open from 7:00 a\.m\. to 7:00 p\.m\./);
  const county: VotingJurisdiction = { ...jurisdiction, state: "TX", countyFips: "48141", ocdId: "ocd-division/country:us/state:tx/county:el_paso", name: "El Paso County", model: "VOTE_CENTER",
    sourceOrg: "El Paso County Elections Department", sourceUrl: "https://epcountyvotes.com/voter-information/election-day-vote-centers",
    sites: [{ ...sites[0], id: "el-paso-agua-dulce", name: first[1], address: first[2], room: first[3], hours, countyFips: "48141", kind: "VOTE_CENTER", precinct: undefined, serves: null }],
    addressLookups: [{ ...lookup("identity-locked-lookup"), publisher: identity.publisher, url: identity.lookupUrl, scope: { state: "TX", ocdId: "ocd-division/country:us/state:tx", name: "Texas" } }] };
  const answer = await answerVotingSites({ ...file, jurisdictions: [county] }, { ...place, states: ["TX"], countyFips: ["48141"], divisionIds: [county.ocdId] });
  assert.equal(answer.jurisdictions[0].sites[0].name, "Agua Dulce Community Center");
  assert.equal(answer.jurisdictions[0].sites[0].address, "15371 Kentwood Ave. 79928");
  assert.equal(answer.jurisdictions[0].sites[0].hours, "7:00 a.m. to 7:00 p.m.");
  assert.equal(answer.jurisdictions[0].narrowing.kind, "NOT_NEEDED");
});

test("VS-01 a statewide row with no published locality never implies statewide eligibility", () => {
  const row = { ...jurisdiction, ocdId: "ocd-division/country:us/state:fl", countyFips: undefined,
    sites: [{ ...sites[0], countyFips: undefined, town: "Baker" }] };
  assert.equal(projectVotingJurisdiction(row, place).sites.length, 0);
  const namedCounty = { ...row, sites: [{ ...row.sites[0], countyName: "Okaloosa" }] };
  assert.equal(projectVotingJurisdiction(namedCounty, { ...place, countyNames: ["Okaloosa County"] }).sites.length, 1);
  assert.equal(projectVotingJurisdiction(namedCounty, { ...place, countyNames: ["Bradford County"] }).sites.length, 0);
});
