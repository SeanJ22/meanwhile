import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { answerVotingSites } from "../lib/ballot/voting-answer.ts";
import { votingPlaceFromZip } from "../lib/ballot/voting-answer-geography.ts";
import { mergeVotingSourceRead, replaceVotingJurisdiction } from "../lib/ballot/voting-source-publication.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-04-northeast/";
const doors = JSON.parse(readFileSync(`${root}config-fragment.json`, "utf8")) as VotingSourceDoor[];
interface Capture { url: string; finalUrl: string; file: string; at: string; status: number; contentType: string; sha256: string; bytes: number }
const captures = JSON.parse(readFileSync(`${root}captures.json`, "utf8")) as Capture[];
const fetchSaved = (changes: Map<string, string> = new Map()): typeof fetch => async input => {
  const url = String(input), capture = captures.find(row => row.url === url || row.finalUrl === url);
  if (!capture) throw new Error(`Response not captured: ${url}`);
  const bytes = readFileSync(root + capture.file);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.sha256);
  assert.equal(bytes.length, capture.bytes);
  return new Response(changes.get(url) ?? bytes, { status: capture.status, headers: { "content-type": capture.contentType } });
};

test("New Jersey county source sections retain their county after the publisher reorders tables", async () => {
  const source = captures.find(row => row.file === "nj-dropboxes.html")!;
  const html = readFileSync(root + source.file, "utf8");
  const sections = [...html.matchAll(/<!-- Begin vote-drop-boxes-[^>]*-->[\s\S]*?<!-- End\s*vote-drop-boxes-[^>]*-->/g)].map(match => match[0]);
  assert.equal(sections.length, 21);
  let index = 0;
  const reordered = html.replace(/<!-- Begin vote-drop-boxes-[^>]*-->[\s\S]*?<!-- End\s*vote-drop-boxes-[^>]*-->/g, () => sections[sections.length - 1 - index++]!);
  assert.notEqual(reordered, html);
  for (const id of ["vs04-nj-atlantic-dropboxes", "vs04-nj-bergen-dropboxes", "vs04-nj-cumberland-dropboxes"]) {
    const door = doors.find(row => row.id === id)!;
    const before = await readVotingSource(door, { fetch: fetchSaved(), now: () => source.at });
    const after = await readVotingSource(door, { fetch: fetchSaved(new Map([[door.url, reordered]])), now: () => source.at });
    const values = (read: typeof before) => read.sites.map(site => ({ name: site.name, address: site.address, town: site.town, countyFips: site.countyFips })).sort((a, b) => a.address.localeCompare(b.address));
    assert.ok(before.sites.length > 0, id);
    assert.deepEqual(values(after), values(before), id);
    assert.ok(after.sites.every(site => site.countyFips === door.scope.countyFips), id);
    assert.equal(after.blanks.some(blank => ["access", "extraction"].includes(blank.reason)), false, id);
  }
});

test("Maryland's current statewide PDF yields the count printed for each county without crossing a county heading", async () => {
  const expected: Record<string, number> = { "24001": 1, "24003": 10, "24510": 9, "24005": 11, "24009": 3, "24011": 1, "24013": 3, "24015": 2, "24017": 3, "24019": 1, "24021": 5, "24023": 2, "24025": 4, "24027": 5, "24029": 1, "24031": 14, "24033": 13, "24035": 2, "24037": 3, "24039": 1, "24041": 1, "24043": 4, "24045": 2, "24047": 1 };
  const countyDoors = doors.filter(door => door.id.startsWith("vs04-md-"));
  assert.equal(countyDoors.length, 24);
  let total = 0;
  const capture = captures.find(row => row.file === "md-early-pdf.pdf")!;
  for (const door of countyDoors) {
    const read = await readVotingSource(door, { fetch: fetchSaved(), now: () => capture.at });
    assert.equal(read.sites.length, expected[door.scope.countyFips!], door.scope.name);
    assert.ok(read.sites.every(site => site.countyFips === door.scope.countyFips));
    assert.ok(read.sites.every(site => site.sources?.some(source => source.documentHash === capture.sha256 && source.documentUrl === capture.finalUrl)));
    assert.equal(read.blanks.some(blank => ["access", "extraction"].includes(blank.reason)), false, door.scope.name);
    total += read.sites.length;
  }
  assert.equal(total, 102);
});


test("Boston's shared facilities retain each ward and precinct assignment from their own source section", async () => {
  const door = doors.find(row => row.id === "vs04-ma-boston-polls")!;
  const capture = captures.find(row => row.file === "ma-boston-poll.html")!;
  const read = await readVotingSource(door, { fetch: fetchSaved(), now: () => capture.at });
  const site = read.sites.find(site => site.address === "539 Tremont Street")!;
  assert.ok(site, "Cyclorama polling facility is present");
  assert.deepEqual([...new Set(site.assignments?.map(assignment => assignment.ward))].sort(), ["4", "5"]);
  assert.ok(read.sites.every(site => site.assignments?.every(assignment => assignment.ward && assignment.precinct)));
  assert.equal(read.blanks.some(blank => ["access", "extraction"].includes(blank.reason)), false);
});


test("DC's official district-wide lists remain visible to ZIP readers through its county equivalent", async () => {
  let held: VotingSitesFile | null = null;
  for (const door of doors.filter(row => row.scope.state === "DC")) {
    const capture = captures.find(row => row.finalUrl === door.url)!;
    const read = await readVotingSource(door, { fetch: fetchSaved(), now: () => capture.at });
    const jurisdiction = mergeVotingSourceRead(held?.jurisdictions.find(row => row.ocdId === door.scope.ocdId), door, read, capture.at);
    held = replaceVotingJurisdiction(held, jurisdiction, capture.at);
  }
  assert.ok(held);
  const place = votingPlaceFromZip(["ocd-division/country:us/district:dc", "ocd-division/country:us/district:dc/county:district_of_columbia"]);
  assert.deepEqual(place.countyFips, ["11001"]);
  const answer = await answerVotingSites(held, place);
  const sites = answer.jurisdictions.flatMap(jurisdiction => jurisdiction.sites);
  assert.ok(sites.length > 0, "DC ZIP lookup must retain the saved official sites");
  assert.equal(sites.length, held.jurisdictions.flatMap(jurisdiction => jurisdiction.sites).length);
  assert.ok(sites.every(site => site.countyFips === "11001"));
});
