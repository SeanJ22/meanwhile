import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const root = "tests/fixtures/voting-sources/vs-04-central/";
const doors = JSON.parse(readFileSync(`${root}config-fragment.json`, "utf8")) as VotingSourceDoor[];
const captures = JSON.parse(readFileSync(`${root}captures.json`, "utf8")) as { url: string; method: string; file: string; contentType: string }[];
async function rows(id: string) {
  const door = doors.find(row => row.id === id)!;
  const source = captures.find(row => row.url === door.url && row.method === "GET")!;
  const parsed = await parseVotingCapture({ url: door.url, contentType: source.contentType, bytes: readFileSync(root + source.file) }, door);
  return { door, parsed, sites: votingRowsToSites(parsed, door, { publisher: door.publisher, url: door.url }).sites };
}

test("the statewide Oklahoma list keeps every site's printed county and local schedule", async () => {
  const { parsed, sites } = await rows("ok-statewide-early-voting-2026");
  assert.equal(sites.length, 93);
  assert.equal(new Set(sites.map(site => site.countyName)).size, 77);
  assert.ok(parsed.every(row => row.countyName && row.name && row.address));
  assert.equal(sites.find(site => site.name === "ADAIR COUNTY ELECTION BOARD")?.countyName, "Adair");
  const satellite = sites.find(site => site.name === "CENTRAL BAPTIST CHURCH")!;
  assert.equal(satellite.countyName, "Rogers");
  assert.match(satellite.address!, /9001 N 145TH E AVE/);
  assert.match(satellite.hours!, /Oct\. 28 - 8:00 am - 6:00 pm/);
  assert.ok(sites.filter(site => site.countyName === "Cleveland").every(site => !/ROGERS|ADAIR/.test(site.name)));
});

test("Louisiana parish headings apply only to their own repeated location blocks", async () => {
  const { parsed, sites } = await rows("la-statewide-early-voting");
  assert.equal(parsed.length, 112);
  assert.equal(sites.length, 112);
  const ascension = sites.filter(site => site.countyName === "ASCENSION");
  assert.equal(ascension.length, 3);
  assert.deepEqual(ascension.map(site => site.name), ["GOVERNMENTAL ANNEX", "COURTHOUSE WEST", "OAK GROVE COMMUNITY CENTER"]);
  assert.match(ascension[2]!.address!, /37433 HWY 42/);
  assert.equal(sites.find(site => site.name === "ALLEN PARISH REGISTRAR OF VOTERS")?.countyName, "ALLEN");
  assert.ok(sites.filter(site => site.countyName === "ASSUMPTION").every(site => !ascension.some(other => other.name === site.name)));
  const incomplete = votingRowsToSites(parsed, doors.find(door => door.id === "la-statewide-early-voting")!, { publisher: "Louisiana Secretary of State", url: "https://voterportal.sos.la.gov/earlyvoting" });
  assert.equal(incomplete.missingRows.length, 0, "wrapped street lines are read from their own location block");
});

test("the official South Dakota PDF retains facility, address and every printed precinct assignment", async () => {
  const { sites } = await rows("sd-statewide-general-polling-2026");
  assert.equal(sites.length, 456);
  const stickney = sites.find(site => site.name === "Stickney Community Building")!;
  assert.equal(stickney.address, "400 Main St, Stickney");
  assert.deepEqual(stickney.precincts, ["Precinct-1", "Precinct-2"]);
  assert.equal(stickney.countyName, "Aurora");
  assert.ok(sites.every(site => site.electionDate === "2026-11-03"));
});
