import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { discoverVotingDoors } from "../lib/ballot/voting-source-discovery.ts";
import { answerVotingSites, type VotingReaderPlace } from "../lib/ballot/voting-answer.ts";
import { combineVotingSourceReads, mergeVotingSourceRead, replaceVotingJurisdiction } from "../lib/ballot/voting-source-publication.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { isOfficialSource } from "../lib/civic-data/source-authority.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-04-territories/";
const doors = JSON.parse(readFileSync(root + "config-fragment.json", "utf8")) as VotingSourceDoor[];
interface Capture { file: string; url: string; httpStatus?: number; contentType?: string; savedBytes?: number; savedSha256?: string; rawSha256?: string; redactions?: number; error?: string }
const manifest = JSON.parse(readFileSync(root + "manifest.json", "utf8")) as Capture[];
const replay: typeof fetch = async input => {
  const capture = manifest.find(row => row.url === String(input) && row.httpStatus !== undefined);
  if (!capture) return new Response("Not in this saved source set", { status: 404 });
  return new Response(readFileSync(root + capture.file), { status: capture.httpStatus, headers: { "content-type": capture.contentType ?? "application/octet-stream" } });
};
const get = (id: string) => doors.find(door => door.id === id)!;
const runtime = { fetch: replay, now: () => "2026-10-21T04:31:00.000Z" };

test("fresh FEC authority covers every territory chief office, including the CNMI public list", () => {
  for (const state of ["AS", "GU", "MP", "VI"]) {
    const door = get(`fec-${state.toLowerCase()}-chief`);
    assert.equal(door.scope.state, state);
    assert.equal(isOfficialSource(door.url, door.officialLinkingPage), true);
    assert.ok(readFileSync(root + "fec-offices.html", "utf8").includes(door.officialLinkingPage!.html));
  }
  assert.equal(isOfficialSource(get("mp-election-day-saipan-2026").url, get("mp-election-day-saipan-2026").officialLinkingPage), true);
});

test("CNMI public script records preserve individual precincts, village locations, dates, hours and publisher points", async () => {
  const pollingReads = await Promise.all(["saipan", "tinian", "rota"].map(id => readVotingSource(get(`mp-election-day-${id}-2026`), runtime)));
  const earlyReads = await Promise.all(["saipan", "tinian", "rota"].map(id => readVotingSource(get(`mp-early-voting-${id}-2026`), runtime)));
  const polling = { sites: pollingReads.flatMap(read => read.sites), blanks: pollingReads.flatMap(read => read.blanks) };
  const early = { sites: earlyReads.flatMap(read => read.sites), blanks: earlyReads.flatMap(read => read.blanks) };
  assert.equal(polling.sites.length, 12);
  assert.equal(early.sites.length, 3);
  assert.deepEqual(polling.blanks, []);
  assert.deepEqual(early.blanks, []);
  assert.deepEqual(polling.sites.find(site => site.name === "Dandan Middle School Cafeteria")?.precincts, ["1B-1", "1B-2"]);
  assert.equal(polling.sites.find(site => site.name === "Hopwood Junior High School Cafeteria")?.precinct, "1A");
  assert.ok(polling.sites.every(site => site.electionDate === "2026-11-03" && site.hours === "7:00 AM – 7:00 PM ChST"));
  assert.equal(polling.sites.find(site => site.name === "Rota NMC, Room B-1")?.lng, 145.1616679051474);
  assert.ok(!polling.sites.some(site => site.name === "Alamagan, Pagan and Agrigan"), "a combined island entry does not supply individual facilities");
  assert.ok(early.sites.every(site => site.days === "2026-10-27 to 2026-11-02" && site.hours === "8:30 AM – 4:00 PM ChST"));
  assert.ok([...polling.sites, ...early.sites].every(site => site.sources?.every(source => source.documentHash && source.documentUrl === get("mp-election-day-saipan-2026").url)));
  const discovery = await discoverVotingDoors(get("mp-election-day-saipan-2026"), runtime);
  assert.equal(discovery.sources[0]?.disposition.kind, "DOOR", "the unrelated Joomla login footer does not close a public polling list");
  assert.equal(discovery.sources[0]?.disposition.family, "voting");
});

test("USVI current early voting has three published physical locations and distinct St. John hours", async () => {
  const reads = await Promise.all(["st-croix", "st-thomas", "st-john"].map(id => readVotingSource(get(`vi-early-${id}-2026`), runtime)));
  assert.ok(reads.every(read => read.sites.length === 1 && read.blanks.length === 0));
  const sites = reads.flatMap(read => read.sites);
  assert.deepEqual(sites.map(site => site.address), ["Sunny Isle Shopping Center Unit 26", "Lockhart Gardens (above Banco Popular)", "The Market Place Suite II"]);
  assert.deepEqual(sites.map(site => site.hours), ["9:00 AM to 6:00 PM", "9:00 AM to 6:00 PM", "9:00 AM to 4:00 PM"]);
  assert.ok(sites.every(site => site.electionDate === "2026-11-03" && site.days?.includes("October 31, 2026")));
});

test("USVI newer current-election notice retains eleven facility/island locations, including Tutu Park Mall", async () => {
  const reads = await Promise.all(["st-croix", "st-thomas", "st-john"].map(id => readVotingSource(get(`vi-general-${id}-2026`), runtime)));
  assert.deepEqual(reads.map(read => read.sites.length), [5, 4, 2]);
  assert.ok(reads.every(read => read.blanks.length === 0));
  const sites = reads.flatMap(read => read.sites);
  assert.ok(sites.every(site => site.electionDate === "2026-11-03" && site.kind === "VOTE_CENTER"));
  assert.ok(sites.some(site => site.name === "TUTU PARK MALL (OPPOSITE OF CARLOS FURNITURE)" && site.countyFips === "78030"));
  assert.ok(sites.some(site => site.name === "GUY BENJAMIN COMMUNITY CENTER" && site.countyFips === "78020"));
  assert.ok(sites.some(site => site.name === "ST. DUNSTAN’S EPISCOPAL SCHOOL AUDITORIUM" && site.countyFips === "78010"));
  assert.ok(sites.every(site => site.hours === undefined), "hours absent from the election notices remain absent");
});

test("MP and VI held answers return each island's sites and exclude other islands", async () => {
  const initial: VotingReaderPlace = { precision: "ZIP", point: null, divisionIds: [], states: [], countyFips: [], countyNames: [], countySubdivisionGeoids: [], towns: [], wards: [], aiannhGeoids: [], precincts: [] };
  for (const [state, counts] of [["MP", { "69110": 11, "69100": 2, "69120": 2 }], ["VI", { "78010": 6, "78030": 5, "78020": 3 }]] as const) {
    let file: VotingSitesFile | null = null;
    const groups = new Map<string, VotingSourceDoor[]>();
    for (const door of doors.filter(door => door.scope.state === state && door.covers.length)) {
      const key = `${door.url}#${door.scope.ocdId}`;
      groups.set(key, [...groups.get(key) ?? [], door]);
    }
    for (const mappings of groups.values()) {
      const door = mappings[0]!;
      const read = combineVotingSourceReads(await Promise.all(mappings.map(mapping => readVotingSource(mapping, runtime))));
      const prior = file?.jurisdictions.find(jurisdiction => jurisdiction.ocdId === door.scope.ocdId);
      file = replaceVotingJurisdiction(file, mergeVotingSourceRead(prior, door, read, runtime.now()), runtime.now());
    }
    assert.ok(file);
    for (const [countyFips, count] of Object.entries(counts)) {
      const answer = await answerVotingSites(file, { ...initial, states: [state], countyFips: [countyFips] });
      const sites = answer.jurisdictions.flatMap(jurisdiction => jurisdiction.sites);
      assert.equal(answer.outsideCoverage, false, `${state} ${countyFips}`);
      assert.equal(sites.length, count, `${state} ${countyFips}`);
      assert.ok(sites.every(site => site.countyFips === countyFips));
    }
  }
});

test("territory source bytes retain capture provenance and redaction hashes", () => {
  for (const capture of manifest.filter(row => !row.error)) {
    const bytes = readFileSync(root + capture.file);
    assert.equal(bytes.length, capture.savedBytes, capture.file);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.savedSha256, capture.file);
    if (!capture.redactions) assert.equal(capture.rawSha256, capture.savedSha256, capture.file);
  }
});
