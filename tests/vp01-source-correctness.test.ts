import "./helpers/linking-copies.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { projectVotingJurisdiction, votingJurisdictionCovers, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { mailingOnlyVotingAddress } from "../lib/ballot/voting-site-address.ts";
import { readVotingSource, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import type { VotingJurisdiction } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
const protocol: VotingSourceDoor = { id: "protocol", publisher: "Protocol election authority", url: "https://protocol.example.gov/polls",
  scope: { state: "NH", name: "Protocol county", ocdId: "ocd-division/country:us/state:nh/county:protocol", countyFips: "33013" },
  shape: "list-page", covers: ["EARLY_VOTING"], electionDate: "2026-11-03", electionPageUrl: "https://protocol.example.gov/polls" };
const source = { publisher: protocol.publisher, url: protocol.url };
const jurisdiction = (door: VotingSourceDoor): VotingJurisdiction => ({ ...door.scope, model: "ASSIGNED", election: null, sites: [],
  sourceOrg: door.publisher, sourceUrl: door.url, collectedAt: "2026-10-27", refusal: null, matchingUnit: door.matchingUnit });
const place = (state: string, countyFips: string): VotingReaderPlace => ({ precision: "ADDRESS", point: null, states: [state], countyFips: [countyFips],
  towns: [], wards: [], countySubdivisionGeoids: [], aiannhGeoids: [], divisionIds: [], precincts: [] });

test("every configured town jurisdiction stays inside its town when a county FIPS is also present", () => {
  const townDoors = doors.filter(door => /\/(?:place|cousub):/.test(door.scope.ocdId));
  assert.ok(townDoors.some(door => door.id === "vs04-nh-new-london"));
  for (const door of townDoors) {
    const local = jurisdiction(door), reader = place(door.scope.state, door.scope.countyFips!);
    assert.equal(votingJurisdictionCovers(local, { ...reader, towns: ["Another town"] }), false, door.id);
    assert.equal(votingJurisdictionCovers(local, reader), false, `${door.id}: unresolved town`);
    const town = /\/(?:place|cousub):([^/]+)/.exec(door.scope.ocdId)![1]!.replaceAll("_", " ");
    assert.equal(votingJurisdictionCovers(local, { ...reader, towns: [town], divisionIds: [door.scope.ocdId],
      countySubdivisionGeoids: door.scope.countySubdivisionGeoid ? [door.scope.countySubdivisionGeoid] : [] }), true, door.id);
  }
});

test("town and ward service areas require resolved membership, while countywide early voting can be in a different physical town", () => {
  const reader = place("NH", "33013");
  const site = { id: "protocol", name: "Protocol site", address: "Protocol physical address", room: null, lat: null, lng: null,
    kind: "EARLY_VOTING" as const, election: null, serves: null, town: "Protocol town", countyFips: "33013" };
  const local = { ...jurisdiction(protocol), sites: [site] };
  assert.equal(projectVotingJurisdiction({ ...local, matchingUnit: "TOWN" }, reader).sites.length, 0);
  assert.equal(projectVotingJurisdiction({ ...local, matchingUnit: "TOWN" }, { ...reader, towns: [site.town] }).sites.length, 1);
  assert.equal(projectVotingJurisdiction({ ...local, matchingUnit: "WARD", sites: [{ ...site, ward: "2" }] }, reader).sites.length, 0);
  const shared = { ...site, kind: "ELECTION_DAY" as const, ward: "2", assignments: ["1", "2"].map(ward => ({ precinct: ward, ward, source })) };
  const wardOne = { precinct: "1", ward: "1", kind: "OFFICIAL_PRECINCT" as const, source, geometry: { type: "Polygon", coordinates: [[[-72, 43], [-71, 43], [-71, 44], [-72, 43]]] } };
  assert.equal(projectVotingJurisdiction({ ...local, matchingUnit: "WARD", sites: [shared], boundaries: [wardOne] }, { ...reader, point: { lat: 43.2, lng: -71.5 } }).narrowing.kind, "EXACT", "a polling place serving several wards matches each ward's polygon");
  assert.equal(projectVotingJurisdiction({ ...local, matchingUnit: "COUNTY" }, { ...reader, towns: ["Another town"] }).sites.length, 1);
  const ward = { ...local, ocdId: `${local.ocdId}/ward:2` };
  assert.equal(votingJurisdictionCovers(ward, { ...reader, wards: ["1"] }), false);
  assert.equal(votingJurisdictionCovers(ward, { ...reader, wards: ["2"] }), true);
  const precinct = { ...local, ocdId: `${local.ocdId}/precinct:3` };
  assert.equal(votingJurisdictionCovers(precinct, { ...reader, precincts: [{ name: "4", kind: "OFFICIAL_PRECINCT" }] }), false);
  assert.equal(votingJurisdictionCovers(precinct, { ...reader, precincts: [{ name: "3", kind: "OFFICIAL_PRECINCT" }] }), true);
});

test("a county list cannot stand in for an address assignment; a shared early-voting schedule remains usable", () => {
  const reader = { ...place("NH", "33013"), point: { lat: 43.2, lng: -71.5 }, towns: ["Reader town"] };
  const site = { id: "another-town", name: "Protocol site", address: "Protocol physical address", room: null, lat: null, lng: null,
    kind: "ELECTION_DAY" as const, election: null, serves: "2", town: "Another town", countyFips: "33013", matchingUnit: "COUNTY" as const,
    precinct: "2", sources: [source] };
  const local = { ...jurisdiction(protocol), sites: [site] };
  assert.equal(projectVotingJurisdiction(local, reader).sites.length, 0);
  const shared = { ...site, kinds: ["ELECTION_DAY" as const, "EARLY_VOTING" as const], schedules: [
    { kind: "ELECTION_DAY" as const, hours: "Day hours", source }, { kind: "EARLY_VOTING" as const, hours: "Early hours", source }] };
  const projected = projectVotingJurisdiction({ ...local, sites: [shared] }, reader);
  assert.deepEqual(projected.sites[0]?.kinds, ["EARLY_VOTING"]);
  assert.equal(projected.sites[0]?.hours, "Early hours");
  assert.equal(projected.sites[0]?.precinct, undefined);
  const assigned = projectVotingJurisdiction({ ...local, assignedSiteIds: [site.id] }, reader);
  assert.equal(assigned.sites[0]?.id, site.id);
  assert.equal(assigned.narrowing.kind, "EXACT");
  assert.equal(projectVotingJurisdiction({ ...local, assignedSiteIds: [site.id] }, { ...reader, precision: "ZIP" }).sites.length, 0);
});

test("a Census 2020 district name needs a current-election source assignment before showing an Election Day site", () => {
  const reader = { ...place("NH", "33013"), point: { lat: 43.2, lng: -71.5 },
    precincts: [{ name: "Precinct 2", kind: "CENSUS_2020_VTD" as const }] };
  const site = { id: "protocol", name: "Protocol site", address: "Protocol physical address", room: null, lat: null, lng: null,
    kind: "ELECTION_DAY" as const, election: null, serves: "2", countyFips: "33013", precinct: "2", sources: [source] };
  const local = { ...jurisdiction(protocol), electionDate: "2026-11-03", sites: [site] };
  assert.equal(projectVotingJurisdiction(local, reader).sites.length, 0, "undated precinct rows do not prove a current assignment");
  assert.equal(projectVotingJurisdiction({ ...local, sites: [{ ...site, electionDate: "2024-11-05" }] }, reader).sites.length, 0);
  const current = projectVotingJurisdiction({ ...local, sites: [{ ...site, electionDate: "2026-11-03" }] }, reader);
  assert.equal(current.sites.length, 1);
  assert.equal(current.narrowing.kind, "EXACT");
  assert.match(current.narrowing.sentence, /Census 2020/);
});

test("published row kinds and configured source kinds cannot inherit a different table's kind", () => {
  const row = { name: "Protocol site", address: "Protocol physical address" };
  for (const [kind, expected] of [["Election Day", "ELECTION_DAY"], ["ELECTION_DAY", "ELECTION_DAY"], ["Advance voting", "EARLY_VOTING"],
    ["In-person absentee", "EARLY_VOTING"], ["Vote centre", "VOTE_CENTER"], ["Mobile early voting", "MOBILE"], ["Drop box", "DROP_BOX"]]) {
    assert.equal(votingRowsToSites([{ ...row, kind }], protocol, source).sites[0]?.kind, expected, kind);
  }
  const configured = { ...protocol, extraction: { kind: "ELECTION_DAY" as const } };
  assert.equal(votingRowsToSites([{ ...row, __tableTitle: "Early voting" }], configured, source).sites[0]?.kind, "ELECTION_DAY");
});

test("postal-only delivery addresses are never voting locations in source parsing or held answers", () => {
  for (const address of ["PO Box 123", "P.O. Box 123", "P O Box 123", "Post Office Box 123", "POB 123", "POBox123", "POB123", "General Delivery"]) {
    assert.equal(mailingOnlyVotingAddress(address), true, address);
    assert.equal(votingRowsToSites([{ name: "Protocol site", address }], protocol, source).sites.length, 0, address);
    assert.equal(projectVotingJurisdiction({ ...jurisdiction(protocol), sites: [{ id: "mail", name: "Protocol office", address,
      room: null, lat: null, lng: null, kind: "ELECTION_DAY", election: null, serves: null }] }, place("NH", "33013")).sites.length, 0, address);
  }
  assert.equal(mailingOnlyVotingAddress("10 Post Office Road"), false);
});

test("all 24 Maryland jurisdictions keep the official PDF's early dates and complete hours range", async () => {
  const bytes = new Uint8Array(readFileSync("tests/fixtures/voting-sources/vs-04-northeast/md-early-pdf.pdf"));
  const md = doors.filter(door => door.id.startsWith("vs04-md-"));
  assert.equal(md.length, 24);
  let count = 0;
  for (const door of md) {
    const result = await readVotingSource(door, { fetch: async input => String(input).endsWith("robots.txt")
      ? new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } })
      : new Response(new Uint8Array(bytes), { headers: { "content-type": "application/pdf" } }), now: () => "2026-10-27T00:00:00.000Z" });
    assert.ok(result.sites.length, door.id);
    for (const site of result.sites) {
      assert.equal(site.kind, "EARLY_VOTING", door.id);
      assert.equal(site.hours, "between 7 am and 8 pm", door.id);
      assert.match(site.days!, /October 22.*October 29/, door.id);
      assert.equal(site.countyFips, door.scope.countyFips, door.id);
    }
    count += result.sites.length;
  }
  assert.equal(count, 102);
});
