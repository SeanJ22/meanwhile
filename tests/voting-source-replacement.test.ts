import "./helpers/linking-copies.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { holdVotingRawEvidence, mergeVotingSourceRead, replaceVotingJurisdiction } from "../lib/ballot/voting-source-publication.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { verifyVotingSourceReplacement } from "../lib/ballot/voting-source-replacement.ts";
import { VOTING_SOURCE_REPLACEMENT_VERIFIER } from "../lib/ballot/voting-source-replacement-contract.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import { rememberStatePublicationPrior } from "../lib/civic-data/state-publication.ts";
import { withMigratedRoutineStore } from "./helpers/migrated-routine-store.ts";

const directory = "tests/fixtures/voting-sources/vs-07/";
const door = (JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[])
  .find(door => door.id === "vs07-az-pima-election-day")!;
const all = JSON.parse(readFileSync(directory + "pima-all-vote-centers-native.json", "utf8"));
const current = JSON.parse(readFileSync(directory + "pima-2026-vote-centers-native.json", "utf8"));
const page = readFileSync(directory + "pima-election-page-native.html");
const beforeAt = "2026-10-21T12:00:00.000Z", at = "2026-10-22T12:00:00.000Z";
// Native published features, with a controlled ArcGIS transport envelope.
const fetchNative: typeof fetch = async input => {
  const url = new URL(String(input));
  if (url.pathname.endsWith("/robots.txt")) return new Response("User-agent: *\nAllow: /");
  if (!url.pathname.endsWith("/query")) return new Response(page, { headers: { "content-type": "text/html" } });
  const data = url.searchParams.get("where") === door.extraction!.where ? current : all;
  if (url.searchParams.get("returnIdsOnly") === "true") return Response.json({ objectIds: data.features.map((row: { attributes: { OBJECTID: number } }) => row.attributes.OBJECTID) });
  const ids = new Set(url.searchParams.get("objectIds")!.split(",").map(Number));
  return Response.json({ ...data, features: data.features.filter((row: { attributes: { OBJECTID: number } }) => ids.has(row.attributes.OBJECTID)) });
};

async function setup(fetchSource: typeof fetch = fetchNative) {
  const legacy = { ...door, extraction: { ...door.extraction, where: undefined } };
  const oldRead = await readVotingSource(legacy, { fetch: fetchSource, now: () => beforeAt });
  const read = await readVotingSource(door, { fetch: fetchSource, now: () => at });
  assert.equal(oldRead.sites.length, 148);
  assert.equal(read.sites.length, 129);
  assert.ok(!read.blanks.some(blank => ["access", "extraction", "missing-sites"].includes(blank.reason)));
  const oldJurisdiction = mergeVotingSourceRead(undefined, legacy, oldRead, beforeAt);
  const prior = replaceVotingJurisdiction(null, oldJurisdiction, beforeAt);
  const previous = votingSitesCandidate({ state: "AZ", current: prior, prior: null, failures: [], acquisition: await holdVotingRawEvidence(oldRead),
    successfulAuthorityReads: oldRead.sources.length, requestedUrl: door.url, finalUrl: door.url, retrievedAt: beforeAt });
  const jurisdiction = mergeVotingSourceRead(oldJurisdiction, door, read, at);
  const next = replaceVotingJurisdiction(prior, jurisdiction, at);
  const candidate = votingSitesCandidate({ state: "AZ", current: next, prior, failures: [], acquisition: await holdVotingRawEvidence(read),
    successfulAuthorityReads: read.sources.length, requestedUrl: door.url, finalUrl: door.url, retrievedAt: at, sourceReplacementDoors: [door] });
  return { previous, candidate, prior, next, read };
}

// Production, Oct 24-29: every voting-site removal in DE, MA, OR, AZ, WA and KY was held as VOTING_SOURCE_REPLACEMENT_UNPROVEN.
// The voting job remembers its held state, so the production adapter hands validation the prior's member index, not its payload.
test("on the production adapter, the voting job's own held read lets a complete official replacement retire its old rows", async () => {
  await withMigratedRoutineStore("voting-sites:AZ", async store => {
    (store as unknown as { writeAuthority: Record<string, unknown> }).writeAuthority.capability = "MANUAL_CONTRACT";
    const { previous } = await setup();
    assert.ok((await processRegisteredManualCandidate(store, "voting-sites:AZ", previous, beforeAt)).promoted);
    const held = await readPromotedCivicData<VotingSitesFile>("VOTING_SITE", "US-AZ:voting-sites", { store, now: at });
    assert.equal(held.kind, "PROMOTED");
    if (held.kind !== "PROMOTED") return;
    rememberStatePublicationPrior(store, held.projection);
    const read = await readVotingSource(door, { fetch: fetchNative, now: () => at });
    const next = replaceVotingJurisdiction(held.value, mergeVotingSourceRead(held.value.jurisdictions[0], door, read, at), at);
    const candidate = votingSitesCandidate({ state: "AZ", current: next, prior: held.value, failures: [], acquisition: await holdVotingRawEvidence(read),
      successfulAuthorityReads: read.sources.length, requestedUrl: door.url, finalUrl: door.url, retrievedAt: at, carriedFromVersionId: previous.id,
      sourceReplacementDoors: [door] });
    const outcome = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate, at, previous.id);
    assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "the complete current list replaces its own rows");
    assert.ok(outcome.candidate.receipt?.checks.some(check => check.code === "OFFICIAL_VOTING_SOURCE_REPLACED" && check.verdict === "PASS"));
    const after = await readPromotedCivicData<VotingSitesFile>("VOTING_SITE", "US-AZ:voting-sites", { store, now: at });
    assert.equal(after.kind === "PROMOTED" && after.value.jurisdictions[0]!.sites.length, 129);
  });
});

test("removal cannot be authorized by self-asserted checks, missing bytes, an omitted current row or a different publisher", async () => {
  const { previous, candidate, prior, next, read } = await setup();
  const store = new MemoryRoutineDataStore();
  await processRegisteredManualCandidate(store, "voting-sites:AZ", previous, beforeAt);
  const held = (await store.readCandidate(previous.id))!;
  const changed = { ...candidate, changeSet: candidateChangeSet(candidate, prior) };
  const unchecked = validateRoutineCandidate(changed, held, at);
  assert.ok(unchecked.receipt.checks.some(check => check.code === "VOTING_SOURCE_REPLACEMENT_UNPROVEN" && check.verdict === "FAIL"));
  const normalized = candidate.normalizedPayload as { acquisition: { savedDocument?: unknown }[] };
  const missing = { ...candidate, normalizedPayload: { ...normalized, acquisition: normalized.acquisition.map((capture, index) => index ? capture : { ...capture, savedDocument: undefined }) } };
  assert.match((await verifyVotingSourceReplacement(missing, previous))!, /bytes are unavailable/);
  const omitted = { ...candidate, readModel: { ...next, jurisdictions: next.jurisdictions.map(row => ({ ...row, sites: row.sites.slice(1) })) } };
  assert.match((await verifyVotingSourceReplacement(omitted, previous))!, /differ from the complete saved-source/);
  const independent = { ...prior.jurisdictions[0]!.sites[0]!, id: "protocol-independent-publisher-alias",
    sources: [{ publisher: "Independent official publisher", url: "https://www.pima.gov/independent-current-list" }] };
  const withIndependent = { ...previous, readModel: { ...prior, jurisdictions: prior.jurisdictions.map(row => ({ ...row, sites: [...row.sites, independent] })) } };
  assert.match((await verifyVotingSourceReplacement(candidate, withIndependent))!, /independently held sites/);
  assert.equal(read.sites.filter(site => site.election === "All").length, 3, "the official definition keeps its three All-election centers");
});

test("a redirected official election page still replays from its saved bytes, so the live Pima replacement can retire its old rows", async () => {
  // Pima's configured election page (/3199/Pima-Votes) answers with a redirect to /pima-votes.
  const moved = new URL("/pima-votes", door.electionPageUrl).href;
  const redirecting: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.href === door.electionPageUrl) return new Response(null, { status: 301, headers: { location: moved } });
    return fetchNative(input, init);
  };
  const { previous, candidate } = await setup(redirecting);
  const acquisition = (candidate.normalizedPayload as { acquisition: { url: string; requestedUrl?: string }[] }).acquisition;
  assert.ok(acquisition.some(capture => capture.url === moved && capture.requestedUrl === door.electionPageUrl));
  assert.equal(await verifyVotingSourceReplacement(candidate, previous), null);
  const unmapped = { ...candidate, normalizedPayload: { ...candidate.normalizedPayload as object,
    acquisition: acquisition.map(({ requestedUrl: _requestedUrl, ...capture }) => capture) } };
  assert.match((await verifyVotingSourceReplacement(unmapped, previous))!, /not a complete site read/);
});

// Production, Oct 30: a list dated on its city's election page cites that page on every row (WI Eau Claire, TX Harris, HI), and
// statewide files name counties the replay could not match (VA, KY, OR, SC, WA), so official changes stayed held.
test("a list retires its own changed row beside its election page's own office, replaying the counties it published", async () => {
  const page = "https://www.eauclairewi.gov/568/Elections";
  const wards: VotingSourceDoor = { id: "wi-eau-claire-polling-places", publisher: "City of Eau Claire City Clerk", url: "https://www.eauclairewi.gov/DocumentCenter/View/468/Polling-Places-and-Their-Wards-PDF",
    shape: "file", covers: ["ELECTION_DAY"], electionDate: "2026-11-03", electionPageUrl: page, electionAssociationVerified: true, model: "ASSIGNED",
    scope: { state: "WI", ocdId: "ocd-division/country:us/state:wi/county:eau_claire/place:eau_claire_city", name: "Eau Claire city" },
    extraction: { kind: "ELECTION_DAY", format: "csv", columns: { name: "SITE", address: "ADDRESS", room: "ROOM", countyName: "COUNTY" } } };
  const read = (room: string, when: string) => readVotingSource(wards, { now: () => when, resolveCountyFips: () => "55035", fetch: (async input => String(input).endsWith("/robots.txt") ? new Response("User-agent: *\nAllow: /") : String(input) === page
    ? new Response(`<p>November 3, 2026 General Election</p><a href="${wards.url}">Polling Places and their Wards</a>`, { headers: { "content-type": "text/html" } })
    : new Response(`SITE,ADDRESS,ROOM,COUNTY\nAMERICAN LEGION # 53,"634 WATER ST, Eau Claire, WI",${room},Eau Claire\nVFW 305,"1300 STARR AVE, Eau Claire, WI",,Eau Claire\n`, { headers: { "content-type": "text/csv" } })) as typeof fetch });
  const [oldRead, newRead] = [await read("", beforeAt), await read("Hall", at)], listed = mergeVotingSourceRead(undefined, wards, oldRead, beforeAt);
  const office = { id: "city-elections-office", name: "City Elections Office", address: "203 S. Farwell St, Eau Claire, WI", lat: null, lng: null, room: null, election: null, serves: null,
    kind: "EARLY_VOTING" as const, electionDate: "2026-11-03", sources: [{ publisher: "City of Eau Claire City Clerk (City Elections)", url: page, checkedAt: beforeAt }] };
  const prior = replaceVotingJurisdiction(null, { ...listed, sites: [...listed.sites, office] }, beforeAt), next = replaceVotingJurisdiction(prior, mergeVotingSourceRead(prior.jurisdictions[0], wards, newRead, at), at);
  const build = async (current: VotingSitesFile, before: VotingSitesFile | null, captured: typeof oldRead, when: string, doors?: VotingSourceDoor[]) => votingSitesCandidate({ state: "WI",
    current, prior: before, failures: [], acquisition: await holdVotingRawEvidence(captured), successfulAuthorityReads: 1, requestedUrl: wards.url, finalUrl: wards.url, retrievedAt: when, sourceReplacementDoors: doors });
  const store = new MemoryRoutineDataStore(), previous = await build(prior, null, oldRead, beforeAt);
  assert.ok((await processRegisteredManualCandidate(store, "voting-sites:WI", previous, beforeAt)).promoted);
  const outcome = await processRegisteredManualCandidate(store, "voting-sites:WI", await build(next, prior, newRead, at, [wards]), at, previous.id);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "the clerk's own room change publishes"); assert.deepEqual(next.jurisdictions[0]!.sites.map(site => [site.name, site.room ?? null]).sort(), [["AMERICAN LEGION # 53", "Hall"], ["City Elections Office", null], ["VFW 305", null]]);
  // The page's own office is never the list's to retire, even beside a passing replay.
  const forged = await build({ ...next, jurisdictions: [{ ...next.jurisdictions[0]!, sites: next.jurisdictions[0]!.sites.filter(site => site.id !== office.id) }] }, prior, newRead, at, [wards]);
  assert.ok(validateRoutineCandidate({ ...forged, changeSet: candidateChangeSet(forged, prior) }, (await store.readCandidate(previous.id))!, at,
    [{ consumer: `${VOTING_SOURCE_REPLACEMENT_VERIFIER} (source-scoped pre-promotion)`, passed: true, detail: "replayed" }]).receipt.checks.some(check => check.code === "VOTING_SOURCE_REPLACEMENT_UNPROVEN"));
});

test("the voting job loads the saved-source verifier; promotion code shared with reader routes does not bundle it", () => {
  const probe = (body: string) => spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs", "--input-type=module", "-e", `
    const { votingSourceReplacementVerifier } = await import("./lib/ballot/voting-source-replacement-contract.ts");
    ${body}
    console.log(JSON.stringify(Boolean(votingSourceReplacementVerifier())));`], { encoding: "utf8" });
  const reader = probe(`await import("./lib/civic-data/candidate-integrity.ts");`);
  assert.equal(reader.stdout.trim().split("\n").at(-1), "false", reader.stderr);
  const job = probe(`await import("./scripts/fetch-voting-sites.mts");`);
  assert.equal(job.stdout.trim().split("\n").at(-1), "true", job.stderr);
});
