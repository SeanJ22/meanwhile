import { orderedAutonomousWorkIds } from "./helpers/ordered-autonomous-work.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { votingDoorRefreshCadence, AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { cadenceMsAt } from "../lib/civic-data/contracts.ts";
import { routineTaskDue } from "../lib/civic-data/runner.ts";
import { planVotingSourceBlanks, persistVotingSourceBlanks, votingSourcePlaces } from "../lib/ballot/voting-source-blanks.ts";
import { votingSourcePopulations } from "../lib/ballot/voting-source-population.ts";
import { votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

import type { VotingDoorScope, VotingSourceDoor, VotingSourceRead } from "../lib/ballot/voting-source-types.ts";
import { REGISTRY_STATES } from "../lib/civic-data/state-scopes.ts";

const ELECTION = "2026-11-03";
const NOW = "2026-10-13T12:00:00.000Z";
const HOUR = 3_600_000;
const root: VotingDoorScope = { state: "FL", name: "Florida", ocdId: "ocd-division/country:us/state:fl" };
const okaloosa: VotingDoorScope = { state: "FL", name: "Okaloosa", ocdId: `${root.ocdId}/county:okaloosa`, countyFips: "12091" };
const bradford: VotingDoorScope = { state: "FL", name: "Bradford", ocdId: `${root.ocdId}/county:bradford`, countyFips: "12007" };
const door: VotingSourceDoor = { id: "voterfocus-okaloosa", publisher: "Okaloosa County Supervisor of Elections",
  url: "https://www.voterfocus.com/PrecinctFinder/precinctDirectory?county=okaloosa", shape: "vendor-platform", platform: "voterfocus",
  scope: okaloosa, covers: ["ELECTION_DAY"], electionDate: ELECTION, electionPageUrl: "https://www.govote-okaloosa.com/",
  extraction: { format: "json", jsonPath: "sites", kind: "ELECTION_DAY" } };
function capturedRead(): VotingSourceRead {
  const capture = JSON.parse(readFileSync(new URL("fixtures/voting-sources/voterfocus-okaloosa-normalized.json", import.meta.url), "utf8"));
  const source = { publisher: door.publisher, url: door.url, checkedAt: NOW };
  return { doorId: door.id, ...votingRowsToSites(capture.sites, door, source), rules: [], sources: [source], blanks: [],
    attempts: [{ url: door.url, route: "direct", outcome: "Read the retained official vendor directory" }], rawBodies: [] };
}

test("automatic voting refresh changes from daily to hourly without a Send or restart and covers Election Day in all US timezones", () => {
  const tasks = AUTOMATIC_REFRESH_TASKS.filter(row => row.id.startsWith("voting-sites:"));
  assert.equal(tasks.length, REGISTRY_STATES.length);
  assert.equal(new Set(tasks.map(row => row.acquisitionFailureDomain)).size, REGISTRY_STATES.length);
  for (const state of REGISTRY_STATES) {
    const row = tasks.find(task => task.id === `voting-sites:${state}`)!;
    assert.equal(row.scope, `US-${state}:voting-sites`);
    assert.equal(cadenceMsAt(row.contract, Date.parse("2026-10-27T00:00:00.000Z")), HOUR);
    assert.ok(row.command.includes(`--state=${state}`));
  }
  const task = tasks.find(row => row.id === "voting-sites:FL")!;
  assert.equal(task.ownerInvocation, undefined);
  const checked = "2026-10-26T12:00:00.000Z";
  const clock = { lastAttemptedAt: checked, lastSucceededAt: checked, lastSucceededObservedAt: checked };
  assert.equal(routineTaskDue(task, clock, Date.parse("2026-10-26T23:59:59.999Z")), false);
  assert.equal(routineTaskDue(task, clock, Date.parse("2026-10-27T00:00:00.000Z")), true);
  for (const now of ["2026-10-27T01:00:00.000Z", "2026-11-04T09:00:00.000Z"]) {
    const at = new Date(Date.parse(now) - HOUR).toISOString();
    const current = { lastAttemptedAt: at, lastSucceededObservedAt: at };
    assert.equal(routineTaskDue(task, current, Date.parse(now) - 1), false);
    assert.equal(routineTaskDue(task, current, Date.parse(now)), true);
  }
  assert.equal(cadenceMsAt(task.contract, Date.parse("2026-11-04T12:00:00.000Z")), 24 * HOUR);
  assert.equal(routineTaskDue(task, { lastAttemptedAt: NOW }, Date.parse(NOW) + HOUR), true, "failed and unpublished routes stay scheduled");
  assert.equal(cadenceMsAt({ cadence: votingDoorRefreshCadence("2028-11-07") }, Date.parse("2028-11-01T00:00:00Z")), HOUR);
  assert.throws(() => votingDoorRefreshCadence("2026-02-30"), /INVALID/);
  const runner = readFileSync(new URL("../scripts/routine-civic-data-runner.mts", import.meta.url), "utf8");
  assert.match(runner, /huntTasks\.filter\(task => !STANDING_SOURCE_TASKS\.some\(standing => standing\.id === task\.id\)\)/,
    "owner-send tasks cannot replace a standing source's automatic cadence");
});

test("the complete registry denominator leaves one open blank per delegated county, including counties without any door", () => {
  const places = votingSourcePlaces({ state: root, delegation: "county", divisions: [
    { ocdId: okaloosa.ocdId, divisionType: "county", label: "Okaloosa", state: "FL", geoid: "12091", parentOcdId: root.ocdId },
    { ocdId: bradford.ocdId, divisionType: "county", label: "Bradford", state: "FL", geoid: "12007", parentOcdId: root.ocdId },
  ] });
  const read = capturedRead();
  assert.ok(read.sites.some(site => site.name === "Baker Area Recreation Bldg"));
  const blanks = planVotingSourceBlanks({ electionDate: ELECTION, places, doors: [door], reads: [read] });
  assert.equal(blanks.length, 2);
  assert.equal(new Set(blanks.map(blank => blank.scope.ocdId)).size, 2);
  assert.match(blanks.find(blank => blank.scope.ocdId === bradford.ocdId)!.owed, /Find Election Day polling places/);
  const loaded = blanks.find(blank => blank.scope.ocdId === okaloosa.ocdId)!;
  assert.doesNotMatch(loaded.owed, /Find Election Day polling places/);
  assert.match(loaded.owed, /Published hours/);
  assert.match(loaded.owed, /Census geocodes/);
  assert.ok(loaded.tried.some(line => line.includes(door.url)));
  assert.ok(blanks.every(blank => blank.status === "open" && blank.next.length > 0));
});

test("a statewide response never fills a different county, and earlier-election and posted-later messages remain hunter work", () => {
  const statewide = { ...door, scope: root, publicationMessage: "Locations will be posted closer to the election." };
  const read = capturedRead();
  read.blanks = [{ id: "earlier", doorId: door.id, scope: root, status: "open", reason: "earlier-election",
    owed: "Find the current election's version; keep the older file the election page currently links", tried: [door.url], next: [door.electionPageUrl] }];
  const blanks = planVotingSourceBlanks({ electionDate: ELECTION, places: [okaloosa, bradford], doors: [statewide], reads: [read] });
  assert.match(blanks.find(blank => blank.scope.ocdId === bradford.ocdId)!.owed, /Find Election Day polling places/);
  assert.ok(blanks.every(blank => blank.owed.includes(statewide.publicationMessage) && blank.owed.includes("current election's version")));
  assert.ok(read.sites.length > 0, "the older official answer is kept while the newer version is sought");
});

test("an ancestor OCD cannot spread a site's explicitly scoped blank to another county or town", () => {
  const read = capturedRead();
  const statewide = { ...door, scope: root };
  const site = read.sites.find(site => site.name === "Baker Area Recreation Bldg")!;
  read.blanks = [{ id: "specific-geocode", doorId: door.id, scope: { ...root, countyFips: okaloosa.countyFips },
    status: "open", reason: "geocode", owed: `Resolve the published address for ${site.name}`, tried: [site.address], next: [door.url] }];
  const countyBlanks = planVotingSourceBlanks({ electionDate: ELECTION, places: [okaloosa, bradford], doors: [statewide], reads: [read] });
  assert.match(countyBlanks.find(blank => blank.scope.ocdId === okaloosa.ocdId)!.owed, /Resolve the published address for Baker Area Recreation Bldg/);
  assert.doesNotMatch(countyBlanks.find(blank => blank.scope.ocdId === bradford.ocdId)!.owed, /Resolve the published address for Baker Area Recreation Bldg/);
  // Protocol scope inputs exercise conflicting units without asserting invented place geography.
  const town = { ...okaloosa, ocdId: `${okaloosa.ocdId}/place:test`, countySubdivisionGeoid: "1209100001" };
  read.blanks[0]!.scope = { ...root, countyFips: okaloosa.countyFips, countySubdivisionGeoid: "1209100002" };
  const townBlank = planVotingSourceBlanks({ electionDate: ELECTION, places: [town], doors: [statewide], reads: [read] })[0]!;
  assert.doesNotMatch(townBlank.owed, /Resolve the published address for Baker Area Recreation Bldg/);
  const wrongCountyDoor = { ...statewide, scope: { ...root, countyFips: bradford.countyFips } };
  const rejectedDoor = planVotingSourceBlanks({ electionDate: ELECTION, places: [okaloosa], doors: [wrongCountyDoor], reads: [read] })[0]!;
  assert.match(rejectedDoor.owed, /Find Election Day polling places/);
  assert.deepEqual(rejectedDoor.tried, []);
});

test("open blanks persist in the existing hunter queue idempotently, most populous first, with owed/tried/next instructions", async () => {
  const repos = createMemoryRepositories();
  // Controlled priority inputs: these counts exercise scheduling and assert no demographic fact.
  const blanks = planVotingSourceBlanks({ electionDate: ELECTION, places: [{ ...bradford, population: 1 }, { ...okaloosa, population: 2 }],
    doors: [door], reads: [capturedRead()] });
  assert.equal(blanks[0].scope.ocdId, okaloosa.ocdId);
  const first = await persistVotingSourceBlanks({ repos, blanks, electionDate: ELECTION, now: NOW });
  const again = await persistVotingSourceBlanks({ repos, blanks, electionDate: ELECTION, now: NOW });
  assert.deepEqual(again, first);
  assert.equal((await repos.workItems.list()).length, 2);
  assert.equal((await repos.obligations.list()).length, 2);
  assert.equal((await repos.occurrences.list()).length, 2);
  const items = (await repos.workItems.list()).map(row => row.value);
  assert.ok(items.every(item => item.state === "OPEN" && item.autonomousPlan?.publication?.contractId === "voting-sites:FL"));
  assert.equal((await orderedAutonomousWorkIds(items.reverse(), new Map()))[0], first.workItemIds[0]);
  const plan = items.find(item => item.subject === okaloosa.ocdId)!.autonomousPlan!;
  assert.equal(plan.contract.schemaVersion, 2);
  if (plan.contract.schemaVersion === 2) {
    assert.match(plan.contract.completenessScope, /Owed:.*Published hours/);
    assert.match(plan.contract.completenessScope, /Tried:/);
    assert.match(plan.contract.completenessScope, /Next:/);
  }
  assert.ok(plan.seedUrls.every(url => !/google|bing|search\?/i.test(url)));
});

test("population order uses existing sourced Census holdings with exact registered government joins", async () => {
  const populations = await votingSourcePopulations({ state: "FL", bodies: [
    { ocdId: okaloosa.ocdId, censusId: "204174", homepageUrl: "https://www.okaloosafl.com/" },
    { ocdId: bradford.ocdId, censusId: "184704", homepageUrl: "https://www.bradfordcountyfl.gov/" },
    { ocdId: `${root.ocdId}/county:unresolved`, homepageUrl: "https://www.voterfocus.com/" },
  ] });
  assert.equal(populations.get(okaloosa.ocdId), 213255);
  assert.equal(populations.get(bradford.ocdId), 28540);
  assert.equal(populations.has(`${root.ocdId}/county:unresolved`), false);
});

test("discovery and place blanks share one standing obligation without erasing either debt", async () => {
  const repos = createMemoryRepositories();
  const blank = planVotingSourceBlanks({ electionDate: ELECTION, places: [okaloosa], doors: [door], reads: [capturedRead()] })[0];
  const ids = await persistVotingSourceBlanks({ repos, electionDate: ELECTION, now: NOW,
    blanks: [blank, { ...blank, id: "discovery", owed: "Find the current county list", next: [door.electionPageUrl] }] });
  assert.equal(ids.workItemIds.length, 1);
  const item = (await repos.workItems.mustRead(ids.workItemIds[0])).value;
  assert.match(item.why, /Published hours/);
  assert.match(item.why, /Find the current county list/);
  assert.equal((await repos.obligations.mustRead(ids.obligationIds[0])).value.nextDueAt, NOW);
});


test("missing coverage comes from the reader goal; only explicit sourced absence fills a kind", () => {
  const read = capturedRead();
  const input = { electionDate: ELECTION, places: [okaloosa], doors: [door], reads: [read] };
  const missing = planVotingSourceBlanks(input)[0]!;
  assert.match(missing.owed, /early voting sites/);
  assert.match(missing.owed, /satellite offices/);
  assert.match(missing.owed, /ballot drop boxes/);
  // Protocol-only annotation tests semantics; this asserts no new real-world absence fact.
  read.rules = [{ text: "An office return rule without an absence classification", source: read.sources[0]! }];
  assert.match(planVotingSourceBlanks(input)[0]!.owed, /ballot drop boxes/);
  read.rules[0]!.absenceOf = ["DROP_BOX"];
  assert.doesNotMatch(planVotingSourceBlanks(input)[0]!.owed, /ballot drop boxes/);
  assert.match(planVotingSourceBlanks(input)[0]!.tried.join(" "), /Published rule:/);
  read.rules[0]!.source = { ...read.sources[0]!, url: "" };
  assert.match(planVotingSourceBlanks(input)[0]!.owed, /ballot drop boxes/);
});
