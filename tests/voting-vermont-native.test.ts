import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { planVotingSourceBlanks } from "../lib/ballot/voting-source-blanks.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
const sourceDoor = (id: string): VotingSourceDoor => { const door = doors.find(door => door.id === id); assert.ok(door, id); return door; };
const fixture = (name: string) => new Uint8Array(readFileSync(`tests/fixtures/voting-sources/${name}`));
async function parse(id: string, file: string, contentType = "text/html") {
  const door = sourceDoor(id);
  const rows = await parseVotingCapture({ url: door.url, contentType, bytes: fixture(file) }, door);
  return { door, rows, ...votingRowsToSites(rows, door, { publisher: door.publisher, url: door.url }) };
}

test("Bennington's current official notice retains the day-before closing and own-town return rule", async () => {
  const { sites } = await parse("vt-bennington-drop-box-2026", "vt-bennington-nov3-original.html");
  assert.equal(sites.length, 1);
  const box = sites[0]!;
  assert.equal(box.address, "205 South Street, Bennington");
  assert.equal(box.hours, "until Monday, November 2nd at 4:30 PM");
  assert.match(box.rules![0]!.text, /Bennington voters ONLY/);
  assert.match(box.rules![0]!.text, /it will not be counted/);
  assert.equal(box.office?.phone, "802-442-1043");
  assert.equal(box.electionDate, "2026-11-03");
  for (const [id, name] of [["vt-bennington-polling-2026", "Bennington Firehouse"], ["vt-north-bennington-polling-2026", "Old Train Depot"]]) {
    const result = await parse(id!, "vt-bennington-nov3-original.html");
    assert.equal(result.sites[0]?.name, name);
    assert.equal(result.sites[0]?.hours, "7am-7pm");
    assert.equal(result.sites[0]?.days, "November 3rd, 2026");
  }
});

test("Arlington's original PDF retains the actual partial access notice without inventing normal hours or own-town rule", async () => {
  const { sites, door } = await parse("vt-arlington-drop-box-closure-2026", "vt-arlington-closure-original.pdf", "application/pdf");
  assert.equal(sites.length, 1);
  assert.equal(sites[0]!.address, "3828 VT Route 7A, Arlington, VT 05250");
  assert.match(sites[0]!.locationNotes!, /inside the front door/);
  assert.match(sites[0]!.locationNotes!, /checked daily during the closure/);
  assert.equal(sites[0]!.days, "October 20–23, 2026");
  assert.equal(sites[0]!.hours, undefined);
  assert.equal(sites[0]!.rules, undefined);
  const clerk = await parse("vt-arlington-clerk-contact", "vt-arlington-clerk-original.html");
  assert.equal(clerk.officeRows[0]?.office.phone, "802-375-2332");
  assert.equal(clerk.officeRows[0]?.office.email, "susan.paustian@arlingtonvermont.org");
  const blank = planVotingSourceBlanks({ electionDate: door.electionDate, places: [door.scope], doors: [door], reads: [{ doorId: door.id, sites, rules: [], sources: [], blanks: [], attempts: [], rawBodies: [] }] });
  assert.equal(blank[0]?.status, "open");
  assert.match(blank[0]!.owed, /Published hours/);
});

test("a changed PDF cannot keep stale configured location facts", async () => {
  const door = sourceDoor("vt-arlington-drop-box-closure-2026");
  await assert.rejects(parseVotingCapture({ url: door.url, contentType: "application/pdf", bytes: fixture("vt-arlington-closure-original.pdf") }, { ...door, extraction: { ...door.extraction, textAssertions: ["The publisher has explicitly changed this location"] } }), /no longer match/);
});

test("Albany remains an open named locality blank when the statewide source is closed", () => {
  const place = { state: "VT", ocdId: "ocd-division/country:us/state:vt/county:orleans/place:albany_town", name: "Albany town", countyFips: "50019", countySubdivisionGeoid: "5001900475" };
  const blanks = planVotingSourceBlanks({ electionDate: "2026-11-03", places: [place], doors: [], reads: [] });
  assert.equal(blanks.length, 1);
  assert.equal(blanks[0]!.status, "open");
  assert.match(blanks[0]!.owed, /Local election office contact for Albany town/);
  assert.ok(blanks[0]!.next.some(next => next.includes("local election office")));
  const manifest = JSON.parse(readFileSync("tests/fixtures/voting-sources/vt-native-capture.json", "utf8"));
  assert.ok(manifest.files.some((file: { url: string; httpStatus: number }) => file.url === "https://sos.vermont.gov/robots.txt" && file.httpStatus === 403));
});
