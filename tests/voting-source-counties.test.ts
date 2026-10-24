import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isOfficialSource } from "../lib/civic-data/source-authority.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { combineVotingSourceReads, mergeVotingSourceRead } from "../lib/ballot/voting-source-publication.ts";
import type { VotingSourceDoor, VotingSourceRead } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-07-counties";
const doors = JSON.parse(readFileSync(`${root}/config-fragment.json`, "utf8")) as VotingSourceDoor[];
interface Capture { url: string; finalUrl: string; file: string; status: number; contentType: string; savedHash: string; rawHash: string; storage: string; capturedAt: string; excerpt?: { of: string; bytes: number; method: string } }
const captures = JSON.parse(readFileSync(`${root}/captures.json`, "utf8")) as Capture[];
const bytes = (capture: Capture) => readFileSync(`${root}/${capture.file}`);
const now = "2026-10-23T12:00:00.000Z";
const fetcher: typeof fetch = async input => {
  const url = String(input);
  if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
  const capture = captures.find(capture => capture.url === url || capture.finalUrl === url);
  if (capture) return new Response(bytes(capture), { status: capture.status, headers: { "content-type": capture.contentType } });
  for (const county of ["nyc", "cuyahoga"]) {
    const path = `tests/fixtures/voting-sources/vs-07/expand-east-${county}-page.html`;
    const metadata = JSON.parse(readFileSync(`${path}.capture.json`, "utf8"));
    if (metadata.url === url || metadata.finalUrl === url) return new Response(readFileSync(path), { headers: { "content-type": metadata.contentType } });
  }
  return new Response(null, { status: 404 });
};

// Saved publisher bytes or trimmed excerpts of them; every excerpt names the full document's hash in the evidence store.
test("county doors retain native evidence, official authority chains, and exact county scopes", () => {
  assert.equal(new Set(doors.map(door => door.id)).size, doors.length);
  for (const capture of captures) {
    assert.equal(createHash("sha256").update(bytes(capture)).digest("hex"), capture.savedHash, capture.url);
    if (capture.storage === "RAW") assert.equal(capture.savedHash, capture.rawHash, capture.url);
    if (capture.storage === "TRIMMED_EXCERPT") assert.match(capture.excerpt?.of ?? "", /^[0-9a-f]{64}$/, capture.url);
    assert.ok(capture.capturedAt.startsWith("2026-10-23"), capture.url);
  }
  for (const door of doors) {
    assert.equal(isOfficialSource(door.url, door.officialLinkingPage), true, door.id);
    assert.equal(door.electionDate, "2026-11-03");
    for (let page = door.officialLinkingPage; page; page = page.linkingPage ?? undefined) {
      const capture = captures.find(capture => capture.url === page!.url || capture.finalUrl === page!.url);
      assert.ok(capture, page.url);
      assert.ok(bytes(capture).toString("utf8").includes(page.html), page.url);
    }
    assert.match(door.scope.countyFips!, /^\d{5}$/);
    assert.ok(captures.some(capture => capture.url === door.url), door.id);
  }
  for (const door of doors.filter(door => door.scope.state === "NY")) {
    assert.equal(door.model, "ASSIGNED");
    assert.equal(door.matchingUnit, "PRECINCT");
  }
  for (const door of doors.filter(door => door.scope.state === "IL")) {
    assert.equal(door.model, "ASSIGNED", "Cook's suburban sites must not become countywide vote centers for Chicago readers");
    assert.equal(door.matchingUnit, "TOWN");
  }
});

test("saved current county lists survive the reader and publication merge without PDF header or address bleed", async () => {
  const reads = new Map<string, VotingSourceRead>();
  const captureCache = new Map();
  for (const door of doors) {
    const read = await readVotingSource(door, { fetch: fetcher, now: () => now, captureCache });
    assert.ok(read.sites.length, door.id);
    assert.deepEqual(read.blanks.filter(blank => blank.reason === "access" || blank.reason === "extraction"), [], door.id);
    assert.ok(read.sites.every(site => site.sources?.some(source => source.official)), door.id);
    for (const site of read.sites) {
      assert.ok(site.name.length < 200, `${door.id}: ${site.name}`);
      assert.ok(site.address.length < 250, `${door.id}: ${site.address}`);
      assert.doesNotMatch(`${site.name} ${site.address}`, /SITE NAME|Assembly District|SITE ADDRESS|\.{3,}|Đị a|Thành ph/);
      assert.equal(site.countyFips, door.scope.countyFips, door.id);
    }
    reads.set(door.id, read);
  }
  for (const id of ["vs07-broward-polls", "vs07-cuyahoga-polls"]) {
    assert.equal(reads.get(id)!.blanks.some(blank => blank.reason === "earlier-election"), false, id);
  }
  // Trimmed excerpts: the first printed page of each multi-page list (Palm Beach's map panels are on page 2,
  // Tarrant's early schedule keeps both pages). Full documents are saved evidence for scripts/vs07-replay.mts.
  const expected: Record<string, number> = {
    "vs07-miami-ev": 28, "vs07-fulton-early": 33, "vs07-gwinnett-early": 13,
    "vs07-gwinnett-drop": 7, "vs07-franklin-early": 1, "vs07-broward-polls": 19,
    "vs07-cuyahoga-polls": 4, "vs07-dallas-early": 24, "vs07-dallas-day": 24,
    "vs07-tarrant-day": 26, "vs07-tarrant-early": 39, "vs07-tarrant-early-page-2": 8,
    "vs07-wayne-early": 15, "vs07-harris-polls": 21,
    "vs07-palmbeach-map-panel-1": 11, "vs07-palmbeach-map-panel-2": 9, "vs07-palmbeach-map-panel-3": 8,
    "vs07-cook-wheeling-early": 1, "vs07-cook-barrington-hills-early": 1,
    "vs07-nyc-Poll_Site_List_Nov_General_2026_Election_Day_Richmond-panel-1": 23,
    "vs07-nyc-Poll_Site_List_Nov_General_2026_Early_Voting_Richmond-panel-1": 5,
  };
  for (const [id, count] of Object.entries(expected)) assert.equal(reads.get(id)?.sites.length, count, id);
  const palm = reads.get("vs07-palmbeach-map-panel-1")!;
  assert.ok(palm.sites.some(site => site.name.includes("Fladell") && site.address.startsWith("16700 Jog Rd.")));
  assert.ok(reads.get("vs07-harris-polls")!.sites.every(site => !site.name.includes("**")));
  assert.ok(reads.get("vs07-harris-polls")!.sites.every(site => site.hours === "7 a.m. to 7 p.m."));
  const byCounty = new Map<string, VotingSourceDoor[]>();
  for (const door of doors) byCounty.set(door.scope.countyFips!, [...byCounty.get(door.scope.countyFips!) ?? [], door]);
  for (const [county, countyDoors] of byCounty) {
    const combined = combineVotingSourceReads(countyDoors.map(door => reads.get(door.id)!));
    const jurisdiction = mergeVotingSourceRead(undefined, countyDoors[0]!, combined, now);
    assert.ok(jurisdiction.sites.length, county);
    assert.equal(new Set(jurisdiction.sites.map(site => site.id)).size, jurisdiction.sites.length, county);
  }
});
