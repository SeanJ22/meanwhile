import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { readVotingSource } from "../lib/ballot/voting-source-readers.ts";
import { mergeVotingSourceRead, recordVotingSourceRead, registeredVotingSourceDoors, replaceVotingJurisdiction, saveVotingSourceDoor, holdVotingRawEvidence } from "../lib/ballot/voting-source-publication.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { RawCaptureRef } from "../lib/civic-data/raw-capture-vault.ts";
import { votingSitesCandidate } from "../lib/ballot/voting-sites-data-plane.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { stateBallotScope } from "../lib/ballot/state-scopes.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { checkEveryFor } from "../lib/doors/page-doors.ts";
import { listDoors } from "../lib/doors/registry.ts";

const at = "2026-10-13T00:00:00.000Z";
const doors = JSON.parse(readFileSync("data/reference/voting-source-doors.json", "utf8")) as VotingSourceDoor[];
const door = doors.find(row => row.url === "https://vip.sos.nd.gov/Precincts.aspx?eid=348")!;
const bytes = readFileSync("tests/fixtures/voting-sources/nd-2026-native.html");
const fetchSource: typeof fetch = async input => new Response(String(input).endsWith("/robots.txt") ? "User-agent: *\nAllow: /" : bytes,
  { headers: { "content-type": String(input).endsWith("/robots.txt") ? "text/plain" : "text/html" } });

test("saved official tables reach the existing public read model with hours, local phone and source bytes", async () => {
  const read = await readVotingSource(door, { fetch: fetchSource, now: () => at });
  const jurisdiction = mergeVotingSourceRead(undefined, door, read, at);
  assert.equal(jurisdiction.sites.length, 40); // 30 site rows plus 10 published precinct assignments.
  assert.equal(new Set(jurisdiction.sites.map(site => `${site.name}\n${site.address}\n${site.kind}`)).size, 30);
  const drop = jurisdiction.sites.find(site => site.name === "Barnes County Courthouse (Dropbox)")!;
  assert.match(drop.hours!, /7:00 pm/);
  assert.equal(drop.office?.phone, "(701) 845-8500 Ext. 6666");
  const current = replaceVotingJurisdiction(null, jurisdiction, at);
  const vault = new MemoryEvidenceStore();
  const candidate = votingSitesCandidate({ state: "ND", current, prior: null, failures: [], acquisition: await holdVotingRawEvidence(vault, read),
    successfulAuthorityReads: read.sources.length, requestedUrl: door.url, finalUrl: door.url, retrievedAt: at });
  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredManualCandidate(store, "voting-sites:ND", candidate, at);
  assert.ok(outcome.promoted, outcome.candidate.failureDetail ?? "the saved official table should publish");
  assert.equal(outcome.readerReadback?.status, "PASS");
  const projection = await readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", "ND"), { store, now: at, bypassCache: true });
  assert.equal(projection.kind, "PROMOTED");
  if (projection.kind === "PROMOTED") assert.deepEqual(projection.value, JSON.parse(JSON.stringify(current)));
  const saved = (await store.readCandidate(candidate.id))!.candidate;
  assert.ok(!JSON.stringify(saved).includes(bytes.toString("base64")) && !JSON.stringify(saved).includes("rgMasterTable"),
    "the stored candidate holds refs, not the page bytes");
  const page = (saved.normalizedPayload as { acquisition: (RawCaptureRef & { url: string })[] }).acquisition.find(ref => ref.url === door.url)!;
  assert.deepEqual(Buffer.from((await vault.get(page.vaultKey))!.bytes), bytes);
});

test("a failed reread leaves all verified sites intact and keeps its attempted route as open work", async () => {
  const read = await readVotingSource(door, { fetch: fetchSource, now: () => at });
  const prior = mergeVotingSourceRead(undefined, door, read, at);
  const failed = await readVotingSource(door, { fetch: async () => { throw new Error("source unavailable"); }, now: () => at });
  const next = mergeVotingSourceRead(prior, door, failed, "2026-10-14T00:00:00.000Z");
  assert.deepEqual(next.sites, prior.sites);
  assert.equal(next.collectedAt, prior.collectedAt);
  assert.ok(next.blanks?.some(blank => blank.status === "open" && blank.tried.length > 0 && blank.next.length > 0));
});

test("source rows replace themselves while independently published site kinds remain visible", async () => {
  const read = await readVotingSource(door, { fetch: fetchSource, now: () => at });
  const prior = mergeVotingSourceRead(undefined, door, read, at);
  const otherSource = { ...prior.sites[0]!, id: "independent-official-door", sources: [{ publisher: door.publisher, url: "https://vip.sos.nd.gov/" }] };
  const next = mergeVotingSourceRead({ ...prior, sites: [...prior.sites, otherSource] }, door, read, at);
  assert.equal(next.sites.length, prior.sites.length + 1);
  assert.deepEqual(next.sites.find(site => site.id === otherSource.id), otherSource);
});

test("candidate and measure doors retain shared mappings and reread their official source bytes", async () => {
  const repos = createMemoryRepositories();
  const candidateDoor: VotingSourceDoor = { ...door, id: "candidate-list", url: "https://elections.example.gov/ballot",
    electionPageUrl: "https://elections.example.gov/ballot", covers: ["CANDIDATE_LIST"] };
  const measureDoor: VotingSourceDoor = { ...candidateDoor, id: "measure-list", covers: ["BALLOT_MEASURES"] };
  await saveVotingSourceDoor(repos.doors, candidateDoor, at);
  await saveVotingSourceDoor(repos.doors, measureDoor, at);
  const registered = await registeredVotingSourceDoors(repos.doors, "ND");
  assert.deepEqual(registered.map(row => row.covers), [["CANDIDATE_LIST"], ["BALLOT_MEASURES"]]);
  const [saved] = (await listDoors(repos.doors)).doors;
  assert.deepEqual([...saved.holds].sort(), ["ballot-contests", "ballot-measures"]);
  assert.equal(saved.checkEveryMinutes, checkEveryFor("BALLOT_CONTEST"));
  const read = await readVotingSource(candidateDoor, { fetch: fetchSource, now: () => at });
  assert.deepEqual(read.sites, []);
  assert.deepEqual(read.blanks, []);
  assert.equal(read.sources[0].url, candidateDoor.url);
  assert.ok(read.rawBodies.some(body => body.url === candidateDoor.url));
  await recordVotingSourceRead(repos.doors, candidateDoor, read, at);
  const [checked] = (await listDoors(repos.doors)).doors;
  assert.equal(checked.lastSuccessAt, at);
  assert.equal(checked.validators?.checkedAt, at);
});
