import "./helpers/linking-copies.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { refreshVotingSources } from "../scripts/fetch-voting-sites.mts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { holdVotingRawEvidence, mergeVotingSourceRead, replaceVotingJurisdiction } from "../lib/ballot/voting-source-publication.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { readVotingSitesProjection } from "../lib/ballot/voting-sites-server.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { VOTING_SOURCE_REPLACEMENT_VERIFIER } from "../lib/ballot/voting-source-replacement-contract.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { cycleVault } from "../lib/control-plane/scheduler/vault.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

const robots = () => new Response("User-agent: *\nAllow: /", { headers: { "content-type": "text/plain" } });
const csv = (body: string) => new Response(body, { headers: { "content-type": "text/csv" } });

// Production, Oct 30 14:05Z: Eau Claire's ward list dates itself on the city's Elections page, so every list row also
// cites that page. The page's own early-voting office was treated as the list's row and dropped, and the list's
// changed rows could not be retired, so WI (and the same linked-page rows in TX and HI) stayed held.
const scope = { state: "WI", ocdId: "ocd-division/country:us/state:wi/county:eau_claire/place:eau_claire_city",
  name: "Eau Claire city", countyFips: "55035", countySubdivisionGeoid: "5503522300" };
const page = "https://www.eauclairewi.gov/568/Elections";
const early: VotingSourceDoor = { id: "wi-eau-claire-in-person-absentee", publisher: "City of Eau Claire City Clerk (City Elections)",
  url: page, shape: "list-page", covers: ["EARLY_VOTING"], scope, electionDate: "2026-11-03", electionPageUrl: page,
  electionAssociationVerified: true, matchingUnit: "TOWN", extraction: { kind: "EARLY_VOTING", records: {
    pattern: "<strong>Early Voting \\(In-Person Absentee Voting\\).*?Individuals may also register", fields: {
      name: { pattern: "Located in (City Elections Office) at", group: 1 },
      street: { pattern: "Located in City Elections Office at ([^<]*?)\\.?</strong>", group: 1 },
      hours: { pattern: "<strong>HOURS:</strong></p>(.*?)<p><strong>There is an area", group: 1 },
      days: { pattern: "(It will begin on [^.]*2026)", group: 1 } } }, templates: { address: "{street}, Eau Claire, WI" } } };
// The live list is a PDF; the same columns as a CSV keep the fixture readable without changing what is compared.
const wards: VotingSourceDoor = { id: "wi-eau-claire-polling-places", publisher: "City of Eau Claire City Clerk",
  url: "https://www.eauclairewi.gov/DocumentCenter/View/468/Polling-Places-and-Their-Wards-PDF", shape: "file", covers: ["ELECTION_DAY"],
  scope, electionDate: "2026-11-03", electionPageUrl: page, electionAssociationVerified: true, model: "ASSIGNED", matchingUnit: "WARD",
  extraction: { kind: "ELECTION_DAY", format: "csv", columns: { name: "SITE", room: "ROOM", ward: "WARDS", precinct: "WARDS" },
    templates: { address: "{ADDRESS}, Eau Claire, WI" } } };
const fitchburg: VotingSourceDoor = { id: "wi-fitchburg-polling-places", publisher: "City of Fitchburg Clerk",
  url: "https://www.fitchburgwi.gov/DocumentCenter/View/1/Polling-Places", shape: "file", covers: ["ELECTION_DAY"],
  scope: { state: "WI", ocdId: "ocd-division/country:us/state:wi/county:dane/place:fitchburg_city", name: "Fitchburg city", countyFips: "55025" },
  electionDate: "2026-11-03", electionPageUrl: "https://www.fitchburgwi.gov/DocumentCenter/View/1/Polling-Places",
  electionAssociationVerified: true, model: "ASSIGNED", extraction: { kind: "ELECTION_DAY", format: "csv", columns: { name: "SITE", address: "ADDRESS" } } };
const elections = `<html><body><h1>Elections</h1><p>November 3, 2026 General Election</p>
<p><a href="/DocumentCenter/View/468/Polling-Places-and-Their-Wards-PDF">Polling Places and their Wards (PDF)</a></p>
<p><strong>Early Voting (In-Person Absentee Voting) Located in City Elections Office at 203 S. Farwell St.</strong></p><p>It will begin on Tuesday, October 20, 2026, and will be available weekdays through Friday, October 30, 2026</p><p><strong>HOURS:</strong></p><p>Weekdays: 9 a.m. - 4 p.m.</p><p><strong>There is an area for curbside voting.</strong></p><p>Individuals may also register to vote.</p>
</body></html>`;

test("a list dated on its city's election page retires only its own changed row; the page's own early-voting office stays, and the pass reads on", async (t) => {
  const store = new MemoryRoutineDataStore(), repos = createMemoryRepositories();
  const root = await mkdtemp(join(tmpdir(), "voting-linked-page-"));
  let legionRoom = "", fitchburgAddress = "5520 Lacy Rd, Fitchburg, WI";
  const fetchSource = (async input => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt") return robots();
    if (url.href === page) return new Response(elections, { headers: { "content-type": "text/html" } });
    if (url.href === wards.url) return csv(`SITE,ADDRESS,ROOM,WARDS\nAMERICAN LEGION # 53,634 WATER ST,${legionRoom},"42, 52"\nVFW 305,1300 STARR AVE,,"7, 8"\n`);
    if (url.href === fitchburg.url) return csv(`SITE,ADDRESS\nFitchburg City Hall,"${fitchburgAddress}"\n`);
    return new Response(null, { status: 404 });
  }) as typeof fetch;
  let clock = Date.parse("2026-10-30T14:05:00.000Z");
  t.mock.method(Date, "now", () => clock);
  const run = (at: string) => { clock = Date.parse(at); return refreshVotingSources({ state: "WI", store, context: { repos }, now: () => at,
    deadlineMs: clock + 60_000, fetch: fetchSource, geocode: async () => null, registry: { divisions: [], bodies: [] },
    vault: cycleVault(root), seeds: [early, wards, fitchburg] }); };
  const sites = async (at: string) => {
    const reader = await readVotingSitesProjection("WI", { store, now: at });
    assert.equal(reader.kind, "PROMOTED");
    return reader.kind === "PROMOTED" ? reader.value.jurisdictions.flatMap(row => row.sites) : [];
  };
  try {
    const first = await run("2026-10-30T14:05:00.000Z");
    assert.equal(first.publications, 3, "the office page, then its ward list beside the held office, then Fitchburg");
    const held = await sites("2026-10-30T14:05:00.000Z");
    assert.deepEqual(held.map(site => site.name).sort(), ["AMERICAN LEGION # 53", "City Elections Office", "Fitchburg City Hall", "VFW 305"]);
    assert.ok(held.find(site => site.name === "VFW 305")!.sources!.some(source => source.url === page), "list rows still cite the page that dates them");

    // The clerk adds a room to one polling place (its id changes) and Fitchburg corrects an address.
    legionRoom = "Hall"; fitchburgAddress = "5520 Lacy Road, Fitchburg, WI";
    const second = await run("2026-10-30T22:05:00.000Z");
    assert.equal(second.publications, 2, "the ward list's change publishes and the pass goes on to Fitchburg");
    const next = await sites("2026-10-30T22:05:00.000Z");
    assert.deepEqual(next.filter(site => site.name === "AMERICAN LEGION # 53").map(site => site.room), ["Hall"]);
    assert.ok(next.some(site => site.name === "City Elections Office" && site.kind === "EARLY_VOTING"), "the independently published office stays");
    assert.ok(next.some(site => site.address === "5520 Lacy Road, Fitchburg, WI"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Production, Oct 30: VA, KY, OR, SC and WA statewide files name each county; the live read matches the names to the
// registry, but the saved-source replay could not, so every removal (VA: one room added to a Fredericksburg site) stayed held.
test("a statewide county-named file's replacement replays from saved bytes with the county matches it already published", async () => {
  await import("../lib/ballot/voting-source-replacement.ts");
  const door: VotingSourceDoor = { id: "va-statewide-polling-general-2026", publisher: "Virginia Department of Elections",
    url: "https://www.elections.virginia.gov/media/registration-statistics/2026-November-General.csv", shape: "file", covers: ["ELECTION_DAY"],
    scope: { state: "VA", ocdId: "ocd-division/country:us/state:va", name: "Virginia" }, electionDate: "2026-11-03",
    electionPageUrl: "https://www.elections.virginia.gov/resultsreports/registration-statistics",
    extraction: { format: "csv", columns: { name: "Polling Location Name", address: ["Polling Location Address Line 1", "Polling Location City", "Polling Location State"],
      countyName: "Polling Location Locality Name", precinct: "Polling Location Precinct Name", room: "Polling Location Voting Room", election: "Election Name" } } };
  const file = (room: string) => "Election Name,Polling Location Locality Name,Polling Location Precinct Name,Polling Location Name,Polling Location Voting Room,Polling Location Address Line 1,Polling Location City,Polling Location State\n" +
    `2026 November General,Fredericksburg City,401 - Fcps Administration,Fcps Administration,${room},210 Ferdinand Street,Fredericksburg,VA\n` +
    "2026 November General,Halifax County,603 - Mt Carmel,Turbeville Ruritan Club Bldg,,1040 Melon Rd,South Boston,VA\n";
  const counties: Record<string, string> = { "Fredericksburg City": "51630", "Halifax County": "51083" };
  const read = (room: string, at: string) => readVotingSource(door, { now: () => at, resolveCountyFips: name => counties[name] ?? null,
    fetch: (async input => String(input).endsWith("/robots.txt") ? robots() : csv(file(room))) as typeof fetch });
  const beforeAt = "2026-10-30T10:30:00.000Z", at = "2026-10-30T14:52:00.000Z";
  const oldRead = await read("", beforeAt), newRead = await read("Gym", at);
  assert.ok(!newRead.blanks.length, JSON.stringify(newRead.blanks));
  const prior = replaceVotingJurisdiction(null, mergeVotingSourceRead(undefined, door, oldRead, beforeAt), beforeAt);
  const next = replaceVotingJurisdiction(prior, mergeVotingSourceRead(prior.jurisdictions[0], door, newRead, at), at);
  const candidate = (current: typeof prior, before: typeof prior | null, captured: typeof oldRead, when: string, replacing?: VotingSourceDoor[]) =>
    holdVotingRawEvidence(captured).then(acquisition => votingSitesCandidate({ state: "VA", current, prior: before, failures: [], acquisition,
      successfulAuthorityReads: 1, requestedUrl: door.url, finalUrl: door.url, retrievedAt: when, sourceReplacementDoors: replacing }));
  const store = new MemoryRoutineDataStore();
  const previous = await candidate(prior, null, oldRead, beforeAt);
  assert.ok((await processRegisteredManualCandidate(store, "voting-sites:VA", previous, beforeAt)).promoted);
  const outcome = await processRegisteredManualCandidate(store, "voting-sites:VA", await candidate(next, prior, newRead, at, [door]), at, previous.id);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "the official file's own room change publishes");
  assert.equal(outcome.candidate.candidate.changeSet?.removed.length, 1);
  assert.deepEqual(next.jurisdictions[0]!.sites.map(site => [site.name, site.room, site.countyFips]).sort(),
    [["Fcps Administration", "Gym", "51630"], ["Turbeville Ruritan Club Bldg", null, "51083"]]);
  // A site only the election page published is never this file's to retire, even beside a passing replay.
  const dated = { ...door, electionAssociationVerified: true };
  const pageOnly = { ...prior.jurisdictions[0]!.sites[0]!, id: "page-only-office", sources: [{ publisher: door.publisher, url: door.electionPageUrl, checkedAt: beforeAt }] };
  const withPage = { ...prior, jurisdictions: [{ ...prior.jurisdictions[0]!, sites: [...prior.jurisdictions[0]!.sites, pageOnly] }] };
  const forged = await candidate(next, withPage, newRead, at, [dated]);
  const receipt = validateRoutineCandidate({ ...forged, changeSet: candidateChangeSet(forged, withPage) }, (await store.readCandidate(previous.id))!, at,
    [{ consumer: `${VOTING_SOURCE_REPLACEMENT_VERIFIER} (source-scoped pre-promotion)`, passed: true, detail: "replayed" }]).receipt;
  assert.ok(receipt.checks.some(check => check.code === "VOTING_SOURCE_REPLACEMENT_UNPROVEN"));
});
