import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { civicElectionRows, civicLookupFromRaw } from "../lib/sources/google-civic/model.ts";
import { civicCandidate } from "../lib/sources/google-civic/publication.ts";
import { lookupCivicAddress, readCivicApi } from "../lib/sources/google-civic/acquisition.ts";
import { GOOGLE_CIVIC_SOURCE_ID, GOOGLE_CIVIC_SCOPE, civicStateScope, GOOGLE_CIVIC_STATES } from "../lib/sources/google-civic/targets.ts";
import { ROUTINE_SOURCE_CONTRACTS } from "../lib/civic-data/contracts.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredFanOutCandidate, processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { refreshGoogleCivic, countyCivicProbeTargets, probeCountyCivicCoverage } from "../lib/sources/google-civic/refresh.ts";
import { readCountyCivicCoverage } from "../lib/sources/google-civic/coverage.ts";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import type { readRegistrationProjection } from "../lib/registration/reader.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { readRawCaptureText, type RawCaptureRef } from "../lib/civic-data/raw-capture-vault.ts";

const AT = "2026-10-12T23:13:00.000Z";
const fixture = (name: string) => readFileSync(new URL(`./fixtures/google-civic/${name}.json`, import.meta.url), "utf8");
const rawMi = fixture("mi-voterinfo");
const districtIds = new Set((JSON.parse(rawMi).contests as { district?: { id?: string } }[]).flatMap(row => row.district?.id ?? []));

test("real November 3 samples preserve every row, upstream official flags and unknown publication dates", () => {
  for (const state of ["az", "mi", "va", "ca", "tx"]) {
    const raw = fixture(`${state}-voterinfo`), original = JSON.parse(raw);
    const lookup = civicLookupFromRaw(raw, "12000", AT, districtIds);
    const count = ["contests", "pollingLocations", "earlyVoteSites", "dropOffLocations"].reduce((sum, key) => sum + (original[key]?.length ?? 0), 0);
    assert.equal(lookup.rows.length, count);
    assert.equal(lookup.counts.joined + lookup.counts.unjoined, count);
    assert.equal(lookup.status, count ? "AVAILABLE" : "NO_DATA");
    for (const row of lookup.rows) {
      assert.ok(row.sources.every(source => source.official && source.publishedAt === null && source.collectedAt === AT));
      assert.ok(row.joinedDivisionId === null || districtIds.has(row.joinedDivisionId));
    }
    assert.ok(!JSON.stringify(lookup).includes(original.normalizedInput.line1), "the normalized reader address is never returned or saved by a reader lookup");
  }
  const lookup = civicLookupFromRaw(rawMi, "12000", AT, districtIds);
  assert.equal(lookup.counts.joined, 0, "this real sample supplies district names without native OCD ids, so names must not turn into joins");
  assert.ok(lookup.rows.some(row => row.joinedDivisionId === null), "sites with no native OCD id remain held");
  assert.throws(() => civicLookupFromRaw(rawMi, "2000", AT), /different election/);
});

test("only a provider district OCD id joins; a missing or unknown id retains its row", () => {
  const supplied = JSON.parse(rawMi);
  const id = "ocd-division/country:us/state:mi";
  supplied.contests[0].district.id = id;
  supplied.contests[1].district.id = "ocd-division/country:us/state:mi/place:not-held";
  const lookup = civicLookupFromRaw(JSON.stringify(supplied), "12000", AT, new Set([id]));
  assert.equal(lookup.counts.joined, 1);
  assert.equal(lookup.rows.length, civicLookupFromRaw(rawMi, "12000", AT).rows.length);
});

test("one national contract schedules every state and keeps its source distinct from certified lists", () => {
  const contracts = ROUTINE_SOURCE_CONTRACTS.filter(row => row.sourceId === GOOGLE_CIVIC_SOURCE_ID);
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].fanOut, true);
  assert.deepEqual(contracts[0].readerProjection?.consumers, ["ballot", "voting-sites", "Admin"]);
  for (const state of ["AZ", "MI", "VA", "CA", "TX", "NY", "NJ", "NH", "DC"]) assert.ok(GOOGLE_CIVIC_STATES.includes(state));
  assert.equal(contracts[0].cadence.phases?.[0].everyMs, 24 * 60 * 60_000);
});

test("voting answers cannot enter the database or evidence vault", async () => {
  const vault = new MemoryEvidenceStore();
  const lookup = civicLookupFromRaw(rawMi, "12000", AT, districtIds);
  await assert.rejects(civicCandidate(vault, "reader", lookup, rawMi, "voterinfo"), /transient/);
  await assert.rejects(civicCandidate(vault, "reader", lookup, rawMi, "elections"), /transient/);
  assert.deepEqual(await vault.list(""), []);
});

test("live lookup selects the November 3 election explicitly and never leaks input addresses or keys", async () => {
  const requests: URL[] = [];
  const options = { apiKey: "private-test-key", now: () => AT, fetchImpl: (async (url: URL) => {
    requests.push(url);
    return new Response(url.pathname.endsWith("elections") ? fixture("elections") : rawMi);
  }) as unknown as typeof fetch };
  const lookup = await lookupCivicAddress("a private reader address", districtIds, options);
  assert.equal(lookup.status, "AVAILABLE");
  assert.equal(requests[1].searchParams.get("electionId"), "12000");
  assert.equal(requests[1].searchParams.get("address"), "a private reader address");
  assert.ok(!JSON.stringify(lookup).includes("private-test-key"));
  assert.ok(!JSON.stringify(lookup).includes("private reader"));
  const failed = await lookupCivicAddress("a private reader address", new Set(), { ...options,
    fetchImpl: (async () => new Response(fixture("nh-voterinfo"), { status: 404 })) as typeof fetch });
  assert.equal(failed.status, "OUTAGE");
  assert.match(failed.reason!, /HTTP 404/);
  assert.equal(failed.rows.length, 0);
});

test("provider Retry-After is honored on 429 and 5xx without small-government pacing", async () => {
  let requests = 0;
  const pauses: number[] = [];
  const result = await readCivicApi("elections", {}, { apiKey: "private-test-key", now: () => AT,
    sleep: async ms => { pauses.push(ms); },
    fetchImpl: (async () => ++requests === 1 ? new Response("", { status: 429, headers: { "retry-after": "7" } })
      : requests === 2 ? new Response("", { status: 503, headers: { "retry-after": "2" } }) : new Response(fixture("elections"))) as typeof fetch });
  assert.deepEqual(pauses, [7000, 2000]);
  assert.equal(result.checkedAt, AT);
});

test("national refresh visits every state, records missing inventories and publishes a catalog without dropping covered rows", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), visited: string[] = [];
  const registration = (async (state: string) => { visited.push(state); return { kind: "NOT_RECORDED" }; }) as unknown as typeof readRegistrationProjection;
  const result = await refreshGoogleCivic({ store, vault, registration, readOptions: { apiKey: "private-test-key", now: () => AT,
    fetchImpl: (async () => new Response(fixture("elections"))) as typeof fetch } });
  assert.deepEqual(visited, GOOGLE_CIVIC_STATES);
  assert.equal(result.coverage.length, GOOGLE_CIVIC_STATES.length);
  assert.ok(result.coverage.every(row => row.reason?.includes("inventory")));
  assert.ok(result.outcome.promoted, JSON.stringify(result.outcome.candidate.receipt));
  const { rawCapture } = result.candidate.normalizedPayload as { rawCapture: RawCaptureRef };
  assert.deepEqual(await vault.list(""), [rawCapture.vaultKey], "one catalog response is stored once for every state marker");
  assert.equal(await readRawCaptureText(vault, rawCapture), fixture("elections"));
  const next = await processRegisteredRoutineCandidate(store, GOOGLE_CIVIC_SOURCE_ID, await civicCandidate(vault, GOOGLE_CIVIC_SCOPE,
    { formatVersion: 1, kind: "CATALOG", checkedAt: AT, rows: civicElectionRows(fixture("elections"), AT, new Set(["ocd-division/country:us"])), coverage: result.coverage }, fixture("elections"), "elections"), AT);
  assert.ok(next.confirmed);
});

test("county refresh probes each public election office once and saves only yes/no and counts", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), requests: URL[] = [];
  const stateId = "ocd-division/country:us/state:mi";
  // Controlled county/office envelopes test route selection; all returned site rows are the saved source fixture.
  const divisions = ["26065", "26161", "26139"].map((geoid, index) => ({ ocdId: `${stateId}/county:protocol-${index}`, divisionType: "county", geoid }));
  const bodies = [{ ocdId: divisions[0].ocdId, name: "Protocol Board of Elections", officeAddress: "Protocol public election office A" },
    { ocdId: divisions[0].ocdId, name: "Protocol Board of Elections", officeAddress: "Protocol duplicate office" },
    { ocdId: divisions[1].ocdId, name: "Protocol County Clerk Elections", officeAddress: "Protocol public election office B" },
    { ocdId: divisions[2].ocdId, name: "Protocol County Commission", officeAddress: "Protocol general government office" }];
  const registration = (async (state: string) => state === "MI" ? { kind: "PROMOTED", value: { divisions, bodies, governments: [] } } : { kind: "NOT_RECORDED" }) as unknown as typeof readRegistrationProjection;
  const result = await refreshGoogleCivic({ store, vault, registration, votingSites: async () => null, reviewedRegistry: async () => null,
    readOptions: { apiKey: "private-test-key", now: () => AT, fetchImpl: (async (url: URL) => {
      requests.push(url);
      return url.pathname.endsWith("elections") ? new Response(fixture("elections")) : url.searchParams.get("address")!.endsWith("A")
        ? new Response(rawMi) : new Response("provider address echo must not be held", { status: 404 });
    }) as unknown as typeof fetch } });
  assert.ok(result.outcome.promoted);
  const probes = requests.filter(url => url.pathname.endsWith("voterinfo"));
  assert.equal(probes.length, 2);
  assert.ok(probes.every(url => url.searchParams.get("electionId") === "12000"));
  const report = result.coverage.find(row => row.state === "MI")!;
  assert.equal(report.governments, 3); assert.equal(report.withoutAddress, 1); assert.equal(report.checked, 2); assert.equal(report.unavailable, 1);
  const count = JSON.parse(rawMi);
  assert.deepEqual(report.counties, [
    { countyFips: "26065", available: true, pollingLocations: count.pollingLocations?.length ?? 0, earlyVoteSites: count.earlyVoteSites?.length ?? 0, dropOffLocations: count.dropOffLocations?.length ?? 0 },
    { countyFips: "26161", available: false, pollingLocations: 0, earlyVoteSites: 0, dropOffLocations: 0 },
  ]);
  const saved = JSON.stringify(result.candidate);
  for (const transient of ["Protocol public election office", "Protocol duplicate office", "Protocol general government office", "private-test-key", "provider address echo", JSON.parse(rawMi).normalizedInput.line1, JSON.parse(rawMi).pollingLocations[0].address.locationName]) assert.ok(!saved.includes(transient), transient);
  assert.equal((await vault.list("")).length, 1, "only the elections catalog is vaulted");
  const held = await readCountyCivicCoverage(store, "MI");
  assert.equal(held.get("26065")?.available, true); assert.equal(held.get("26161")?.available, false);
  assert.equal((await readCountyCivicCoverage(store, "MI", "2028-11-07")).size, 0);
  const tomorrowRequests: URL[] = [];
  const tomorrow = new Date(Date.parse(AT) + 86_400_000).toISOString();
  const next = await refreshGoogleCivic({ store, vault, registration, votingSites: async () => null, reviewedRegistry: async () => null,
    readOptions: { apiKey: "private-test-key", now: () => tomorrow, fetchImpl: (async (url: URL) => {
      tomorrowRequests.push(url); return new Response(url.pathname.endsWith("elections") ? fixture("elections") : rawMi);
    }) as unknown as typeof fetch } });
  assert.ok(next.outcome.promoted || next.outcome.confirmed);
  assert.equal(tomorrowRequests.filter(url => url.pathname.endsWith("voterinfo")).length, 2, "the following daily pass remeasures every available county office");
  assert.equal((await readCountyCivicCoverage(store, "MI")).get("26161")?.available, true, "the following pass updates the existing no-site sample");
  assert.equal((await vault.list("")).length, 1, "the next pass still holds no voterinfo response");
});

test("provider outages and different elections remain unmeasured rather than becoming a no", async () => {
  const target = { countyFips: "26065", address: "Protocol public election office" };
  await assert.rejects(probeCountyCivicCoverage(target, "12000", { apiKey: "private-test-key", fetchImpl: (async () => new Response("", { status: 403 })) as typeof fetch }), /403/);
  await assert.rejects(probeCountyCivicCoverage(target, "2000", { apiKey: "private-test-key", fetchImpl: (async () => new Response(rawMi)) as typeof fetch }), /different election/);
});

test("the saved official North Carolina directory supplies one public election-office probe address in each of its 100 counties", async () => {
  const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
  const directory = doors.find(door => door.id === "vs07-nc-county-election-offices")!;
  assert.ok(directory);
  const reference = JSON.parse(readFileSync("data/derived/registration/nc.json", "utf8")) as { divisions: [string, string, string, string][] };
  const divisions = reference.divisions.filter(([, kind]) => kind === "county").map(([ocdId, , geoid, label]) => ({ ocdId, geoid, label, divisionType: "county" }));
  const normalize = (name: string) => name.toLowerCase().replace(/\s+county$/, "").replace(/[^a-z0-9]/g, "");
  const counties = new Map(divisions.map(division => [normalize(division.label), division]));
  const html = readFileSync("tests/fixtures/voting-sources/vs-07/nc-offices-native.html");
  const read = await readVotingSource(directory, { now: () => AT,
    fetch: (async input => new Response(String(input).endsWith("/robots.txt") ? "User-agent: *\\nAllow: /" : html,
      { headers: { "content-type": "text/html" } })) as typeof fetch,
    resolveScope: name => { const county = counties.get(normalize(name)); return county ? { state: "NC", name: county.label, ocdId: county.ocdId, countyFips: county.geoid } : null; },
  });
  assert.equal(read.contacts?.length, 100);
  assert.equal(read.sites.length, 0, "an election office directory does not assert that its offices are voting sites");
  const registration = { divisions, bodies: [], governments: [] } as unknown as Parameters<typeof countyCivicProbeTargets>[0];
  const holding = { jurisdictions: read.contacts!.map(contact => ({ ocdId: contact.scope.ocdId, office: contact.office })) } as VotingSitesFile;
  const inventory = countyCivicProbeTargets(registration, holding);
  assert.equal(inventory.counties, 100); assert.equal(inventory.targets.length, 100);
  assert.equal(inventory.targets.find(target => target.countyFips === "37001")?.address, "1128 S. MAIN STREET GRAHAM, NC 27253");
  assert.equal(new Set(inventory.targets.map(target => target.countyFips)).size, 100);
});

test("a resumed national pass starts with states that have no completed source check", async () => {
  const store = new MemoryRoutineDataStore(), vault = new MemoryEvidenceStore(), visited: string[] = [];
  const rows = civicElectionRows(fixture("elections"), AT, new Set(["ocd-division/country:us"]));
  await processRegisteredFanOutCandidate(store, GOOGLE_CIVIC_SOURCE_ID,
    await civicCandidate(vault, civicStateScope("AL"), { formatVersion: 1, kind: "STATE", checkedAt: AT, rows, coverage: [] }, fixture("elections"), "elections"), AT);
  const registration = (async (state: string) => { visited.push(state); return { kind: "NOT_RECORDED" }; }) as unknown as typeof readRegistrationProjection;
  await refreshGoogleCivic({ store, vault, registration, readOptions: { apiKey: "private-test-key", now: () => AT,
    fetchImpl: (async () => new Response(fixture("elections"))) as typeof fetch } });
  assert.equal(visited.at(-1), "AL");
  assert.deepEqual(visited.slice(0, -1), GOOGLE_CIVIC_STATES.filter(state => state !== "AL"));
});
