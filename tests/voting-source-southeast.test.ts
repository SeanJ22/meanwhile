import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVotingCapture, readVotingSource, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { decodeVotingBytes, sourceText, votingArchiveMember, xlsxVotingTables } from "../lib/ballot/voting-source-tables.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import { votingSupersededSources } from "../scripts/fetch-voting-sites.mts";
import { mergeVotingSourceRead, replaceVotingJurisdiction } from "../lib/ballot/voting-source-publication.ts";

const root = "tests/fixtures/voting-sources/vs-04-southeast/";
const fixture = (name: string) => new Uint8Array(readFileSync(root + name));
const configured = JSON.parse(readFileSync(root + "config-fragment.json", "utf8")) as VotingSourceDoor[];
const door = (id: string) => configured.find(row => row.id === id)!;

test("November's published North Carolina file replaces March without losing a fallback before publication", async () => {
  const current = door("nc-statewide-polling-general-2026");
  const source = { publisher: current.publisher, url: current.url };
  const rows = await parseVotingCapture({ url: current.url, contentType: "text/csv", bytes: fixture("nc-november-polling.txt") }, current);
  const parsed = votingRowsToSites(rows, current, source);
  const at = "2026-10-21T05:00:00.000Z";
  const read = { doorId: current.id, sites: parsed.sites, sources: [source], rules: [], blanks: [], attempts: [], rawBodies: [] };
  const holding = replaceVotingJurisdiction(null, mergeVotingSourceRead(undefined, current, read, at), at);
  const primary = JSON.parse(readFileSync("tests/fixtures/voting-sources/nc-primary-door.json", "utf8")) as VotingSourceDoor;
  assert.ok(votingSupersededSources([current], holding).has(primary.url));
  assert.equal(votingSupersededSources([current], null).size, 0);
  const earlier = structuredClone(holding);
  for (const jurisdiction of earlier.jurisdictions) for (const site of jurisdiction.sites) site.electionDate = undefined;
  assert.equal(votingSupersededSources([current], earlier).size, 0, "an unverified current-election association cannot retire a fallback");
});

test("a configured election absent from the saved record cannot assign an election date", () => {
  const config: VotingSourceDoor = { ...door("nc-statewide-polling-general-2026"), extraction: {
    constants: { election: "Protocol 2026 General Election" },
  }, electionAssociationVerified: false };
  const result = votingRowsToSites([{ name: "Protocol location", address: "10 Protocol Road" }], config, { publisher: config.publisher, url: config.url });
  assert.equal(result.sites.length, 1);
  assert.equal(result.sites[0]!.electionDate, undefined);
  assert.ok(result.missingRows.some(text => text.includes("configured election is absent")));
});

test("government location names retain Spanish accents encoded as HTML entities", () => {
  assert.equal(sourceText("Espa&ntilde;ola / PE&Ntilde;A / Jos&eacute; / Do&ntilde;a Ana"), "Española / PEÑA / José / Doña Ana");
});

test("Virginia's namespaced SpreadsheetML with implicit coordinates preserves all precinct columns", async () => {
  const current = door("va-statewide-polling-general-2026");
  const bytes = fixture("va-november-polling.xlsx");
  const tables = xlsxVotingTables(bytes);
  assert.equal(tables[0]!.rows.length, 2817);
  assert.equal(tables[0]!.headers.length, 21);
  const rows = await parseVotingCapture({ url: current.url, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", bytes }, current);
  const read = votingRowsToSites(rows, current, { publisher: current.publisher, url: current.url });
  assert.equal(read.sites.length, 2651);
  const ashland = read.sites.find(row => row.name === "Ashland Town Hall")!;
  assert.equal(ashland.address, "121 Thompson St., Ashland, VA, 23005-2081");
  assert.equal(ashland.room, "Council Chambers");
  assert.equal(ashland.countyName, "Hanover County");
  assert.equal(ashland.electionDate, "2026-11-03");
  assert.equal(read.missingRows.length, 0);
});

test("North Carolina's NUL placeholder cannot make the statewide polling publication invalid JSONB", async () => {
  const current = door("nc-statewide-polling-general-2026");
  const bytes = fixture("nc-november-polling.txt");
  const hashBefore = createHash("sha256").update(bytes).digest("hex");
  assert.ok(new TextDecoder("utf-16le").decode(bytes).includes("\u0000"));
  const rows = await parseVotingCapture({ url: current.url, contentType: "text/csv", bytes }, current);
  const read = votingRowsToSites(rows, current, { publisher: current.publisher, url: current.url });
  const polk = read.sites.find(row => row.address.startsWith("61 W POLK ST"))!;
  assert.ok(polk);
  assert.equal(polk.address, "61 W POLK ST, NC, 28133");
  assert.equal(read.sites.length, 2610);
  assert.ok(!JSON.stringify(read.sites).includes("\\u0000"));
  assert.ok(!decodeVotingBytes(bytes).includes("\u0000"));
  assert.equal(createHash("sha256").update(bytes).digest("hex"), hashBefore, "original evidence bytes remain exact");
});

test("West Virginia's paired location/date rows retain all 55 counties and individual satellite dates", async () => {
  const current = door("wv-statewide-early-general-2026");
  const rows = await parseVotingCapture({ url: current.url, contentType: "text/html", bytes: fixture("wv-early-locations.html") }, current);
  const read = votingRowsToSites(rows, current, { publisher: current.publisher, url: current.url });
  assert.equal(read.sites.length, 99);
  assert.equal(new Set(read.sites.map(site => site.countyName)).size, 55);
  assert.equal(read.missingRows.length, 0);
  const vienna = read.sites.find(site => site.name === "Vienna Community Building")!;
  assert.equal(vienna.days, "Oct. 27–31, 2026");
  assert.match(vienna.hours!, /Mon–Fri.*Saturday/);
  assert.ok(!read.sites.some(site => /Open:/.test(site.name)), "date-only continuation rows are not facilities");
});

test("a saved official archive supplies real PDF members and retains the archive evidence hash", async () => {
  const bytes = fixture("fl-early-ballot-intake.zip");
  const member = "ALA - EV and Secure Ballot Intake Station Locations - 2026 GE.pdf";
  assert.equal(new TextDecoder().decode(votingArchiveMember(bytes, member).slice(0, 4)), "%PDF");
  assert.throws(() => votingArchiveMember(bytes, "not-a-published-member.pdf"), /member is missing/);
  const current: VotingSourceDoor = { ...door("wv-statewide-early-general-2026"), id: "fl-archive", shape: "file",
    url: "https://dos.fl.gov/media/711428/20261002-ev-and-secure-ballot-intake-station-locations-2026-ge.zip",
    scope: { state: "FL", ocdId: "ocd-division/country:us/state:fl/county:alachua", name: "Alachua County", countyFips: "12001" },
    extraction: { format: "pdf", archiveMember: member, kind: "EARLY_VOTING",
      pdfBlocks: { heading: "^Location Name$", end: "^Days of Operation$", pageExclude: "Other Secure Ballot Intake Locations",
        columns: { name: "^Location Name$", locationType: "^Location Type$", address: "^Address$", timezone: "^Time Zone$", intake: "^(?:Box|Intake Station)$" } } } };
  const rows = await parseVotingCapture({ url: current.url, contentType: "application/zip", bytes }, current);
  const read = votingRowsToSites(rows, current, { publisher: "Florida Division of Elections", url: current.url });
  assert.equal(read.sites.length, 8);
  assert.equal(read.sites[0]!.name, "EV1 - SOE Office");
  assert.equal(read.sites[0]!.address, "515 North Main Street, Gainesville, Florida 32601");
  assert.equal(read.sites[0]!.sources![0]!.documentHash, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(read.sites[0]!.sources![0]!.documentUrl, current.url);
});

test("Florida's current General PDF title follows visual headings rather than old object-order schedule dates", async () => {
  const current = door("fl-alachua-early-general-2026");
  const bytes = fixture("fl-early-ballot-intake.zip");
  const rows = await parseVotingCapture({ url: current.url, contentType: "application/zip", bytes }, current);
  assert.ok(rows.every(row => (row.__verifiedConstants as string[]).includes("election")), "the configured General election is printed in the saved PDF");
  const captures = JSON.parse(readFileSync(root + "manifest.json", "utf8")) as { url: string; finalUrl?: string; file: string; status: number; contentType: string; capturedAt: string }[];
  const read = await readVotingSource(current, { now: () => captures.find(capture => capture.url === current.url)!.capturedAt,
    fetch: async input => {
      const capture = captures.find(capture => capture.url === String(input) || capture.finalUrl === String(input));
      assert.ok(capture, `No captured response for ${String(input)}`);
      return new Response(fixture(capture.file), { status: capture.status, headers: { "content-type": capture.contentType } });
    } });
  assert.equal(read.sites.length, 8);
  assert.match(read.fileTitle!, /2026 General Election/i);
  assert.doesNotMatch(read.fileTitle!, /October 19|October 29|Start Time|End Time/);
  assert.ok(read.sites.every(site => site.electionDate === "2026-11-03"));
  assert.ok(!read.blanks.some(blank => blank.reason === "earlier-election"));
});

test("Cobb's complete public PDF retains precinct rows above and below repeated page headers", async () => {
  const current = door("ga-cobb-public-precincts-2026");
  const rows = await parseVotingCapture({ url: current.url, contentType: "application/pdf", bytes: fixture("ga-cobb-precincts.pdf") }, current);
  const read = votingRowsToSites(rows, current, { publisher: current.publisher, url: current.url });
  assert.equal(rows.length, 148);
  assert.equal(read.sites.length, 132);
  assert.equal(read.missingRows.length, 0);
  const precincts = read.sites.flatMap(site => site.precincts ?? []);
  assert.equal(new Set(precincts).size, 148);
  assert.ok(precincts.every(precinct => /^[A-Z]{2}\d[A-Z0-9]$/.test(precinct)));
  for (const code of ["SN2A", "PS3A", "MA4A", "SO03", "SN3A", "SO02", "TM01", "MA3B"]) assert.ok(precincts.includes(code), `Missing the published ${code} precinct`);
  assert.equal(read.sites.find(site => site.precincts?.includes("SN2A"))!.address, "1275 CHURCH ST, SMYRNA GA 30080");
});
