import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { decodeVotingBytes, sourceText, votingArchiveMember, xlsxVotingTables } from "../lib/ballot/voting-source-tables.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-04-southeast/";
const fixture = (name: string) => new Uint8Array(readFileSync(root + name));
const configured = JSON.parse(readFileSync(root + "config-fragment.json", "utf8")) as VotingSourceDoor[];
const door = (id: string) => configured.find(row => row.id === id)!;

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
