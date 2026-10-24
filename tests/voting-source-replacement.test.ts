import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { holdVotingRawEvidence, mergeVotingSourceRead, replaceVotingJurisdiction } from "../lib/ballot/voting-source-publication.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { verifyVotingSourceReplacement } from "../lib/ballot/voting-source-replacement.ts";
import { candidateChangeSet } from "../lib/civic-data/changes.ts";
import { validateRoutineCandidate } from "../lib/civic-data/validate.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";

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

test("a complete native current-map replay retires only the 19 out-of-filter Pima rows through the real promotion door", async () => {
  const { previous, candidate } = await setup();
  const store = new MemoryRoutineDataStore();
  const first = await processRegisteredManualCandidate(store, "voting-sites:AZ", previous, beforeAt);
  assert.ok(first.promoted, first.candidate.failureDetail ?? "the native prior publishes");
  const second = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate, at);
  assert.ok(second.promoted, second.candidate.failureDetail ?? "the complete current native list replaces only its own rows");
  assert.equal(second.readerReadback?.status, "PASS");
  assert.equal(second.candidate.candidate.changeSet?.removed.length, 19);
  assert.ok(second.candidate.receipt?.checks.some(check => check.code === "OFFICIAL_VOTING_SOURCE_REPLACED" && check.verdict === "PASS"));
  assert.equal(candidate.horizon.claimsComplete, false, "the whole state remains an open fact set");
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
