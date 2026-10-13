import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyVotingChangeNotices, arcgisVotingRows, fingerprintVotingPlatform, parseVotingCapture, readVotingSource, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { votingFetchSession } from "../lib/ballot/voting-source-fetch.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/voting-sources/${name}`));
const NC: VotingSourceDoor = { id: "nc-early", publisher: "North Carolina State Board of Elections", url: "https://vt.ncsbe.gov/OSSite?handler=StatewideList", shape: "file", covers: ["EARLY_VOTING"], scope: { state: "NC", ocdId: "ocd-division/country:us/state:nc", name: "North Carolina" }, electionDate: "2026-11-03", electionPageUrl: "https://vt.ncsbe.gov/EVSite/", extraction: { format: "tsv", headers: ["election", "county", "flag", "name", "street", "cityStateZip", "day", "hours"], columns: { name: "name", address: ["street", "cityStateZip"], days: "day", hours: "hours", election: "election" } } };
const source = { publisher: NC.publisher, url: NC.url };

test("real statewide early-voting file retains every site's published day and hours", async () => {
  const rows = await parseVotingCapture({ url: NC.url, contentType: "text/tab-separated-values", bytes: fixture("nc-early-voting-2026-excerpt.tsv") }, NC);
  assert.equal(rows.length, 136);
  const { sites } = votingRowsToSites(rows, NC, source);
  assert.equal(sites.length, 8);
  const elmira = sites.find(s => s.name === "ELMIRA COMMUNITY CENTER")!;
  assert.equal(elmira.address, "810 WICKER ST, BURLINGTON, NC 27217");
  assert.match(elmira.hours!, /10\/15\/2026: 8:00AM - 7:30PM/);
  assert.match(elmira.hours!, /10\/18\/2026: Closed/);
  assert.match(elmira.hours!, /10\/31\/2026/);
  assert.ok(sites.every(s => s.kind === "EARLY_VOTING" && s.electionDate === "2026-11-03"));
});

test("official rendered HTML tables retain early voting, drop boxes and publisher return rules", async () => {
  const door: VotingSourceDoor = { ...NC, id: "nd-tables", url: "https://vip.sos.nd.gov/Precincts.aspx?eid=348", shape: "list-page", covers: ["ELECTION_DAY", "EARLY_VOTING", "DROP_BOX"], extraction: { format: "html", columns: { address: ["Address", "City", "State", "Zip Code", "ZipCode"] } } };
  const rows = await parseVotingCapture({ url: door.url, contentType: "text/html", bytes: fixture("nd-2026-official-tables.html") }, door);
  const { sites } = votingRowsToSites(rows, door, { publisher: "North Dakota Secretary of State", url: door.url });
  assert.ok(sites.some(s => s.kind === "EARLY_VOTING"));
  const drop = sites.find(s => s.name === "Barnes County Courthouse (Dropbox)")!;
  assert.equal(drop.kind, "DROP_BOX");
  assert.match(drop.hours!, /north side of Courthouse entry available 24\/7/);
  assert.match(drop.hours!, /7:00 pm on Tuesday, November 3, 2026/);
  assert.equal(drop.office?.phone, "(701) 845-8500 Ext. 6666");
});

test("one voterfocus fingerprint parses saved official facts from multiple counties", async () => {
  for (const county of ["bradford", "okaloosa"]) {
    const door = { ...NC, id: county, shape: "vendor-platform" as const, url: `https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=${county}`, extraction: { format: "json" as const, jsonPath: "sites" }, covers: ["ELECTION_DAY" as const] };
    assert.equal(fingerprintVotingPlatform(door.url), "voterfocus");
    const rows = await parseVotingCapture({ url: door.url, contentType: "application/json", bytes: fixture(`voterfocus-${county}-normalized.json`) }, door);
    const sites = votingRowsToSites(rows, door, source).sites;
    assert.ok(sites.length > 5); assert.ok(sites.every(s => s.name && s.address && s.precinct));
  }
});

test("identity-locked and unrequested address routes send no request", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async () => { calls++; throw new Error("No request is permitted"); };
  const identity = await readVotingSource({ ...NC, shape: "identity-locked-lookup" }, { fetch: fetcher });
  assert.equal(identity.blanks[0]?.reason, "access");
  await readVotingSource({ ...NC, shape: "address-lookup" }, { fetch: fetcher });
  assert.equal(calls, 0);
});

test("robots-disallowed source stays an open blank without requesting the blocked page", async () => {
  const requests: string[] = [];
  const result = await readVotingSource(NC, { fetch: async input => { requests.push(String(input)); return new Response("User-agent: *\nDisallow: /OSSite", { headers: { "content-type": "text/plain" } }); } });
  assert.deepEqual(requests, ["https://vt.ncsbe.gov/robots.txt"]);
  assert.equal(result.sites.length, 0); assert.match(result.blanks[0]!.tried.join(" "), /DISALLOWED/);
});

test("all ArcGIS object-ID batches are acquired without transfer-limit truncation", async () => {
  // Protocol envelope uses actual rows from the committed official statewide file.
  const factualRows = await parseVotingCapture({ url: NC.url, contentType: "text/tab-separated-values", bytes: fixture("nc-early-voting-2026-excerpt.tsv") }, NC);
  const calls: URL[] = [];
  const runtime = { fetch: (async input => {
    const url = new URL(String(input)); calls.push(url);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    if (url.searchParams.has("returnIdsOnly")) return Response.json({ objectIds: factualRows.map((_, i) => i + 1) });
    const ids = url.searchParams.get("objectIds")!.split(",").map(Number);
    if (ids.length > 50) return Response.json({ exceededTransferLimit: true, features: [] });
    return Response.json({ features: ids.map(id => ({ attributes: factualRows[id - 1] })) });
  }) as typeof fetch };
  const rows = await arcgisVotingRows("https://vt.ncsbe.gov/arcgis/rest/services/locations/FeatureServer/0", votingFetchSession(runtime));
  assert.deepEqual(rows, factualRows);
  assert.ok(calls.filter(url => url.searchParams.has("objectIds")).length > 2);
});

test("newest notice wins per field while every notice remains cited", async () => {
  const rows = await parseVotingCapture({ url: NC.url, contentType: "text/tab-separated-values", bytes: fixture("nc-early-voting-2026-excerpt.tsv") }, NC);
  const sites = votingRowsToSites(rows, NC, source).sites;
  const changed = applyVotingChangeNotices(sites, [
    { publishedAt: "2026-10-12", source: { ...source, url: `${NC.url}&notice=2` }, match: { id: sites[0]!.id }, changes: { hours: "Published replacement hours" } },
    { publishedAt: "2026-10-11", source: { ...source, url: `${NC.url}&notice=1` }, match: { id: sites[0]!.id }, changes: { hours: "Earlier replacement hours", room: "Published replacement room" } },
  ]);
  assert.equal(changed[0]!.hours, "Published replacement hours"); assert.equal(changed[0]!.room, "Published replacement room"); assert.equal(changed[0]!.sources?.length, 3);
});


test("the shared voterfocus card reader reads real precinct directory text, not just normalized JSON", async () => {
  for (const [county, count] of [["okaloosa", 52], ["bradford", 13]] as const) {
    const door: VotingSourceDoor = { ...NC, id: county, url: `https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=${county}`, shape: "vendor-platform", platform: "voterfocus", extraction: { format: "html" }, covers: ["ELECTION_DAY"] };
    const rows = await parseVotingCapture({ url: door.url, contentType: "text/html", bytes: fixture(`voterfocus-${county}-official-extract.txt`) }, door);
    assert.equal(rows.length, count);
    assert.ok(votingRowsToSites(rows, door, source).sites.every(site => site.precinct && site.name && site.address));
  }
});

test("an address lookup cannot forward a reader's address through a redirect to another host", async () => {
  const requests: string[] = [];
  const door: VotingSourceDoor = { ...NC, shape: "address-lookup", extraction: { addressFields: { street: "streetName" } } };
  const read = await readVotingSource(door, { readerAddress: { address: "810 Wicker St", street: "Wicker St" }, fetch: async input => {
    const url = new URL(String(input)); requests.push(url.href);
    if (url.pathname === "/robots.txt") return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
    return new Response(null, { status: 302, headers: { location: "https://example.org/redirect-target" } });
  } });
  assert.equal(requests.length, 2);
  assert.ok(requests.every(url => new URL(url).hostname === "vt.ncsbe.gov"));
  assert.match(requests[1]!, /streetName=Wicker\+St/);
  assert.match(read.blanks[0]!.tried.join(" "), /address was not forwarded/);
  assert.equal(read.sources.length, 0);
});
