import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVotingCapture, readVotingSource, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { addCensusVotingGeographies, votingInputZip } from "../lib/ballot/voting-answer-geography.ts";
import { parseCensusPoint } from "../lib/geo/census-geocoder.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import type { VotingExtraction, VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import type { VotingJurisdiction } from "../lib/ballot/voting-sites.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/voting-sources/${name}`, import.meta.url));
const source = { publisher: "Montana Secretary of State", url: "https://sosmt.gov/docs/23/elections/77688/2026-polling-location-satellite-office-general-final", checkedAt: "2026-10-13" };
const configs: Record<string, VotingExtraction> = {
  polling: { format: "xlsx", sheet: "Polling Places", headerRow: 3, kind: "ELECTION_DAY", columns: { countyName: "County", name: "Polling Place Location",
    address: ["Polling Place Address", "Polling Place City", "Polling Place Zip"], precinct: "Precinct Number", hours: "Polling Place Hours" }, constants: { election: "2026 General Election" } },
  satellite: { format: "xlsx", sheet: "Satellite", headerRow: 3, kind: "SATELLITE", columns: { countyName: "County", name: "Satellite Location/Alternate Election Office", address: "Satellite Location/Alternate Election Office",
    days: "Satellite Days\r\n(Absentee Period)", hours: "Satellite Hours\r\n(Absentee Period)", tribalNation: "Tribe", reservation: "Reservation" }, constants: { election: "2026 General Election" } },
};
async function jurisdiction(kind: keyof typeof configs): Promise<VotingJurisdiction> {
  const door: VotingSourceDoor = { id: `mt-native-${kind}`, publisher: source.publisher, url: source.url, shape: "file", covers: [kind === "polling" ? "ELECTION_DAY" : "SATELLITE"],
    scope: { state: "MT", ocdId: "ocd-division/country:us/state:mt", name: "Montana" }, electionDate: "2026-11-03", electionPageUrl: "https://sosmt.gov/elections/", extraction: configs[kind] };
  const rows = await parseVotingCapture({ url: source.url, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes: fixture("mt-2026-polling-satellite.xlsx") }, door);
  const { sites } = votingRowsToSites(rows, door, source);
  return { ocdId: door.scope.ocdId, state: "MT", name: "Montana", model: "ASSIGNED", sites, election: "2026 General Election", electionDate: "2026-11-03",
    sourceOrg: source.publisher, sourceUrl: source.url, collectedAt: source.checkedAt, refusal: null };
}
const initial: VotingReaderPlace = { precision: "ADDRESS", point: null, divisionIds: [], states: [], countyFips: [], countyNames: [], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };

test("VS-01 native Census address and 2020 VTD resolve the native statewide spreadsheet to Dillon church", async () => {
  const current = JSON.parse(fixture("census-dillon-geographies-native.json").toString());
  const historical = JSON.parse(fixture("census-dillon-2020-geographies-native.json").toString());
  const point = parseCensusPoint(current);
  assert.ok(point);
  const place = addCensusVotingGeographies(addCensusVotingGeographies({ ...initial, point }, current), historical, "CENSUS_2020");
  assert.deepEqual(place.countyFips, ["30001"]);
  assert.ok(place.countySubdivisionGeoids.includes("3000190924"));
  assert.equal(place.precincts[0].name, "PRECINCT 12", "this actual church address is not evidence of precinct 1");
  const j = await jurisdiction("polling");
  const answer = await answerVotingSites({ generatedAt: "2026-10-13", jurisdictions: [j] }, place);
  assert.equal(answer.jurisdictions[0].narrowing.kind, "EXACT");
  assert.equal(answer.jurisdictions[0].sites.length, 1);
  assert.equal(answer.jurisdictions[0].sites[0].name, "LUTHERAN CHURCH - CENTRAL");
  assert.equal(answer.jurisdictions[0].sites[0].address, "715 E BANNACK, DILLON, 59725");
  assert.equal(answer.jurisdictions[0].sites[0].hours, "7:00 am - 8:00 pm");
});

test("VS-01 given Beaverhead precinct 1 uses the same native church row without substituting another precinct", async () => {
  const j = await jurisdiction("polling");
  const site = j.sites.find(site => site.countyName === "Beaverhead" && site.precincts?.includes("1"));
  assert.ok(site);
  assert.equal(site.name, "LUTHERAN CHURCH - CENTRAL");
  assert.equal(site.address, "715 E BANNACK, DILLON, 59725");
  assert.equal(site.hours, "7:00 am - 8:00 pm");
});

test("VS-01 native satellite workbook preserves Crow office days, hours, lunch closure and nation", async () => {
  const j = await jurisdiction("satellite");
  const answer = await answerVotingSites({ generatedAt: "2026-10-13", jurisdictions: [j] }, { ...initial, precision: "ZIP", states: ["MT"], countyNames: ["Big Horn County"], countyFips: ["30003"] });
  const site = answer.jurisdictions[0].sites.find(site => site.name.includes("Little Big Horn College"));
  assert.ok(site);
  assert.match(site.address, /8645 S\. Weaver Dr\., Crow Agency, MT/);
  assert.equal(site.days, "Oct. 7th, 8th, 14th, 15th, 21st, 22nd, 28th, & 29th");
  assert.equal(site.hours, "10 a.m. to 5 p.m., Closed for lunch from 1-2 p.m.");
  assert.equal(site.tribalNation, "Crow Nation");
  assert.equal(site.reservation, "Crow");
  assert.equal(votingInputZip("8645 S. Weaver Dr., Crow Agency, MT 59022"), "59022");
  assert.equal(parseCensusPoint(JSON.parse(fixture("census-crow-no-match-native.json").toString())), null);
});

test("VS-01 native statewide workbook shows a reader only their county's site debts and statewide work", async () => {
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const door = { ...doors.find(item => item.id === "mt-statewide-polling-2026")!, electionAssociationVerified: false };
  const beaverhead = { state: "MT", ocdId: "ocd-division/country:us/state:mt/county:beaverhead", name: "Beaverhead County", countyFips: "30001" };
  const bigHorn = { state: "MT", ocdId: "ocd-division/country:us/state:mt/county:big_horn", name: "Big Horn County", countyFips: "30003" };
  const bytes = fixture("mt-2026-polling-satellite.xlsx");
  const read = await readVotingSource(door, {
    fetch: async input => new URL(String(input)).pathname === "/robots.txt" ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } }) : new Response(bytes, { headers: { "content-type": "application/octet-stream" } }),
    resolveScope: label => label === "Beaverhead" ? beaverhead : label === "Big Horn" ? bigHorn : null,
    resolveCountyFips: name => name === "Beaverhead" ? "30001" : name === "Big Horn" ? "30003" : null,
    geocode: async () => null,
  });
  assert.ok(read.blanks.some(blank => blank.scope.countyFips === "30003" && blank.reason === "geocode"), "native Big Horn rows create their own scoped work");
  const j: VotingJurisdiction = { ...door.scope, model: "UNKNOWN", election: null, sites: read.sites, blanks: read.blanks, sourceOrg: door.publisher, sourceUrl: door.url, collectedAt: "2026-10-13", refusal: null };
  const answer = await answerVotingSites({ generatedAt: "2026-10-13", jurisdictions: [j] }, { ...initial, precision: "ZIP", states: ["MT"], countyNames: ["Beaverhead"], countyFips: ["30001"], divisionIds: [beaverhead.ocdId] });
  const visible = answer.jurisdictions[0].blanks!;
  assert.ok(visible.some(blank => blank.scope.countyFips === "30001" && blank.reason === "geocode"));
  assert.ok(visible.some(blank => blank.scope.ocdId === door.scope.ocdId), "statewide source work stays visible");
  assert.ok(visible.every(blank => !blank.scope.countyFips || blank.scope.countyFips === "30001"), "a county reader must not see another county's debt");
});
