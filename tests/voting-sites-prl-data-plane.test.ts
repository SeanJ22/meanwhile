import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  VOTING_SITES_CONTRACT,
  votingSitesCandidate,
} from "../lib/ballot/voting-sites-data-plane.ts";
import {
  loadVotingSites,
  readVotingSitesProjection,
  resetVotingSitesCache,
} from "../lib/ballot/voting-sites-server.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { failedAcquisitionCandidate } from "../lib/civic-data/candidate-builders.ts";
import { MANUAL_PRODUCTION_SOURCE_CONTRACTS } from "../lib/civic-data/manual-contracts.ts";
import {
  manualCandidateContractIssue,
  processRegisteredManualCandidate,
} from "../lib/civic-data/promotion.ts";
import { SOURCE_AUTHORITIES } from "../lib/civic-data/source-authority.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { PRL_CONTRACT, prlCandidate } from "../lib/sources/prl/data-plane.ts";
import {
  prlProfileForSubject,
  readPrlProjection,
  resetPrlCache,
} from "../lib/sources/prl/snapshot.ts";
import { PRL_RHETORIC_ATTRIBUTION, type PrlSnapshot } from "../lib/sources/prl/types.ts";

const ROOT = process.cwd();
const T0 = "2026-09-08T12:00:00.000Z";
const T1 = "2026-09-08T13:00:00.000Z";
const SOURCE_URL = "https://elections.example.gov/az/locations";

function votingFixture(): VotingSitesFile {
  const site = (id: string, name: string, address: string, lat: number, lng: number, election: string) =>
    ({ id, name, address, room: null, lat, lng, kind: "ELECTION_DAY" as const, election, serves: null });
  return {
    generatedAt: "2026-08-19",
    jurisdictions: [
      {
        ocdId: "ocd-division/country:us/state:az/county:example", name: "Example County", state: "AZ", model: "VOTE_CENTER",
        election: "2026 General",
        sites: [
          site("az-example-day-1", "Community Center", "100 Main Street, Exampleville, AZ 85000", 32.2, -110.9, "2026 General"),
          site("az-example-day-2", "Public Library", "200 Oak Avenue, Exampleville, AZ 85000", 32.3, -110.8, "2026 General"),
        ],
        sourceOrg: "Example County Elections", sourceUrl: SOURCE_URL, collectedAt: "2026-08-19", refusal: null,
      },
      {
        ocdId: "ocd-division/country:us/state:nj/place:example_one", name: "Town of Example One", state: "NJ", model: "ASSIGNED",
        election: "2026 General Election",
        sites: [site("nj-example-one-1", "Firehouse", "1 Elm Street, Example One, NJ 07000", 40.9, -74.4, "2026 General Election")],
        sourceOrg: "Example County Board of Elections", sourceUrl: "https://elections.example.gov/nj/example-one", collectedAt: "2026-08-19", refusal: null,
      },
      {
        ocdId: "ocd-division/country:us/state:nj/place:example_two", name: "Borough of Example Two", state: "NJ", model: "ASSIGNED",
        election: "2026 General Election",
        sites: [site("nj-example-two-1", "Borough Hall", "2 Pine Street, Example Two, NJ 07001", 40.8, -74.5, "2026 General Election")],
        sourceOrg: "Example County Board of Elections", sourceUrl: "https://elections.example.gov/nj/example-two", collectedAt: "2026-08-19", refusal: null,
      },
    ],
  } as VotingSitesFile;
}

function prlFixture(): PrlSnapshot {
  const profile = (bioguideId: string, prlName: string) => ({
    bioguideId, prlName, statementCount: 1200,
    shares: { policy: 60, bipartisanship: 5, creditclaiming: 20, "attack-policy": 12, "attack-personal": 3 },
    sources: ["all"], measuredAt: "2026-08-16",
  });
  return {
    formatVersion: 1,
    fetchedAt: "2026-08-19T15:24:21.701Z",
    sourceFile: "profiles-all-national.csv",
    sourceUrl: "https://americaspoliticalpulse.com/data/elite/profiles-all-national.zip",
    rowsInFile: 3,
    rowsWithStatements: 2,
    profiles: [profile("A000001", "Member One"), profile("B000002", "Member Two")],
    rosterMisses: ["C000003"],
    attribution: PRL_RHETORIC_ATTRIBUTION,
  } as PrlSnapshot;
}

function votingCandidate(file: VotingSitesFile, at: string, raw: string, failures: Parameters<typeof votingSitesCandidate>[0]["failures"] = []) {
  return votingSitesCandidate({
    current: file,
    prior: null,
    failures,
    rawBodies: [raw],
    successfulAuthorityReads: 1,
    requestedUrl: SOURCE_URL,
    finalUrl: SOURCE_URL,
    retrievedAt: at,
  });
}

test("voting sites promote with exact source/class/scope evidence and the Reader follows only the pointer", async () => {
  resetVotingSitesCache();
  const store = new MemoryRoutineDataStore();
  const candidate = votingCandidate(votingFixture(), T0, "official voting-site bytes v1");
  assert.deepEqual(candidate.sourceProjectionEvidence, {
    kind: "SOURCE_PROJECTION_CONTRACT",
    sourceId: "voting-sites",
    recordClass: "VOTING_SITE",
    scope: VOTING_SITES_CONTRACT.scope,
  });
  assert.equal(manualCandidateContractIssue("voting-sites", candidate), null);
  const outcome = await processRegisteredManualCandidate(store, "voting-sites", candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.readerReadback?.status, "PASS");
  const fixture = votingFixture();
  assert.equal(outcome.candidate.candidate.changeSet?.added.length,
    fixture.jurisdictions.length + fixture.jurisdictions.reduce((sum, row) => sum + row.sites.length, 0));
  const read = await readVotingSitesProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(loadVotingSites().jurisdictions.length, votingFixture().jurisdictions.length);
});

test("a first voting-site holding publishes without requiring other states", async () => {
  const file = votingFixture();
  file.jurisdictions = [file.jurisdictions.find(row => row.state === "AZ" && row.sites.length > 0)!];
  const store = new MemoryRoutineDataStore();
  const outcome = await processRegisteredManualCandidate(store, "voting-sites", votingCandidate(file, T0, "one authority's sites"), T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual((outcome.promoted!.payload as VotingSitesFile).jurisdictions, file.jurisdictions);
});

test("voting-site coordinates admit Alaska and Hawaii while rejecting invalid points", () => {
  const file = votingFixture();
  const site = file.jurisdictions.find(row => row.sites.length > 0)!.sites[0];
  for (const [lat, lng] of [[64.8, -147.7], [21.3, -157.8], [52, 179.5]]) {
    site.lat = lat;
    site.lng = lng;
    assert.equal(votingCandidate(file, T0, "published points").normalization.succeeded, true);
  }
  for (const [lat, lng] of [[91, -147.7], [21.3, -181], [NaN, -157.8]]) {
    site.lat = lat;
    site.lng = lng;
    assert.equal(votingCandidate(file, T0, "invalid points").normalization.succeeded, false);
  }
});

test("any state or DC publishes sourced voting sites without editing an authority list", async () => {
  for (const state of ["AK", "HI", "DC", "WI"]) {
    const original = votingFixture().jurisdictions.find(row => row.sites.length > 0)!;
    const url = `https://elections.${state.toLowerCase()}.gov/locations`;
    const jurisdiction = { ...original, state, sourceUrl: url, sourceOrg: `${state} election office`,
      ocdId: `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}`,
      model: "ASSIGNED" as const, sites: original.sites.slice(0, 1) };
    const candidate = votingSitesCandidate({ current: { generatedAt: "2026-09-08", jurisdictions: [jurisdiction] },
      prior: null, failures: [], rawBodies: ["test official source bytes"], successfulAuthorityReads: 1,
      requestedUrl: url, finalUrl: url, retrievedAt: T0 });
    const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "voting-sites", candidate, T0);
    assert.equal(outcome.candidate.state, "PROMOTED", `${state}: ${outcome.candidate.failureDetail}`);
  }
});

test("a vendor voting-site source carries its official linking page; an unlinked source cannot publish", async () => {
  const original = votingFixture().jurisdictions.find(row => row.sites.length > 0)!;
  const sourceUrl = "https://voting.vendor.example/locations";
  const jurisdiction = { ...original, sourceUrl, sites: original.sites.slice(0, 1) };
  const build = (row: typeof jurisdiction) => votingSitesCandidate({
    current: { generatedAt: "2026-09-08", jurisdictions: [row] }, prior: null, failures: [],
    rawBodies: ["test source bytes and linking page"], successfulAuthorityReads: 1,
    requestedUrl: sourceUrl, finalUrl: sourceUrl, retrievedAt: T0,
  });
  const unlinked = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "voting-sites", build(jurisdiction), T0);
  assert.equal(unlinked.promoted, null);
  const linked = { ...jurisdiction, sourceLinkingPage: { url: "https://elections.example.gov/",
    html: `<a href="${sourceUrl}">Voting locations</a>` } };
  const candidate = build(linked);
  const outcome = await processRegisteredManualCandidate(new MemoryRoutineDataStore(), "voting-sites", candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.deepEqual((outcome.promoted!.payload as VotingSitesFile).jurisdictions[0].sourceLinkingPage, linked.sourceLinkingPage);
  for (const url of ["https://elections.example.gov.evil.example/locations", "https://unlinked.example/locations"]) {
    assert.equal(build({ ...linked, sourceUrl: url }).normalization.succeeded, false);
  }
});

test("one failed voting authority retains only its prior scope while healthy authorities and exact deltas advance", async () => {
  const store = new MemoryRoutineDataStore();
  const prior = votingFixture();
  const first = votingCandidate(prior, T0, "official voting-site bytes v1");
  await processRegisteredManualCandidate(store, "voting-sites", first, T0);

  const current = structuredClone(prior);
  current.generatedAt = "2026-09-08";
  const az = current.jurisdictions.find((row) => row.state === "AZ" && row.sites.length > 0)!;
  az.sites[0].name = `${az.sites[0].name} — updated by authority`;
  for (const row of current.jurisdictions.filter((jurisdiction) => jurisdiction.state === "NJ")) {
    row.sites = [];
    row.refusal = { wall: "official publisher unavailable", rungs: [{ rung: 2, what: "official page", result: "HTTP 503", attemptedAt: "2026-09-08" }] };
  }
  const successor = votingSitesCandidate({
    current,
    prior,
    failures: [{ state: "NJ", code: "MORRIS_UNAVAILABLE", detail: "official publisher unavailable" }],
    rawBodies: ["healthy AZ and NH bytes; failed NJ response"],
    successfulAuthorityReads: 2,
    requestedUrl: SOURCE_URL,
    finalUrl: SOURCE_URL,
    retrievedAt: T1,
  });
  const promoted = await processRegisteredManualCandidate(store, "voting-sites", successor, T1);
  assert.equal(promoted.candidate.state, "PROMOTED");
  const payload = promoted.promoted!.payload as VotingSitesFile;
  assert.deepEqual(
    payload.jurisdictions.filter((row) => row.state === "NJ"),
    prior.jurisdictions.filter((row) => row.state === "NJ")
      .sort((left, right) => left.ocdId.localeCompare(right.ocdId)),
  );
  assert.equal(payload.jurisdictions.find((row) => row.state === "AZ" && row.sites.length > 0)!.sites[0].name, az.sites[0].name);
  assert.ok(promoted.candidate.candidate.changeSet?.changed.some((change) => change.key.startsWith("site:ocd-division/country:us/state:az/")));
  assert.equal(promoted.candidate.candidate.changeSet?.removed.length, 0);
  assert.deepEqual(promoted.candidate.receipt?.excludedFacts.map((fact) => fact.code), ["MORRIS_UNAVAILABLE"]);
});

test("a globally empty voting candidate is refused and store failure never opens the tracked fixture", async () => {
  resetVotingSitesCache();
  const store = new MemoryRoutineDataStore();
  const good = votingCandidate(votingFixture(), T0, "official voting-site bytes v1");
  await processRegisteredManualCandidate(store, "voting-sites", good, T0);
  const empty = structuredClone(votingFixture());
  for (const row of empty.jurisdictions) {
    row.sites = [];
    row.refusal ??= { wall: "source unavailable", rungs: [{ rung: 2, what: "official route", result: "failed", attemptedAt: "2026-09-08" }] };
  }
  const refused = await processRegisteredManualCandidate(
    store,
    "voting-sites",
    votingCandidate(empty, T1, "empty official response"),
    T1,
  );
  assert.equal(refused.promoted, null);
  assert.equal((await store.readPromotion("VOTING_SITE", VOTING_SITES_CONTRACT.scope))?.versionId, good.id);

  const brokenStore = {
    async readPromotion() { throw new Error("database unavailable"); },
    async readCandidate() { throw new Error("must not follow an absent pointer"); },
  };
  const unavailable = await readVotingSitesProjection({ store: brokenStore, bypassCache: true, now: T1 });
  assert.equal(unavailable.kind, "STORE_UNREACHABLE");
  assert.throws(() => loadVotingSites(), /holding is STORE_UNREACHABLE/);
});

test("PRL promotes only its attributed allowlisted measurement and Reader joins by exact Bioguide", async () => {
  resetPrlCache();
  const store = new MemoryRoutineDataStore();
  const snapshot = prlFixture();
  const candidate = prlCandidate({
    snapshot,
    rawZip: new TextEncoder().encode("deterministic PRL archive v1"),
    finalUrl: snapshot.sourceUrl,
    retrievedAt: T0,
  });
  assert.deepEqual(candidate.sourceProjectionEvidence, {
    kind: "SOURCE_PROJECTION_CONTRACT",
    sourceId: "prl",
    recordClass: "PRL_PROFILE",
    scope: PRL_CONTRACT.scope,
  });
  assert.equal(manualCandidateContractIssue("prl", candidate), null);
  const outcome = await processRegisteredManualCandidate(store, "prl", candidate, T0);
  assert.equal(outcome.candidate.state, "PROMOTED");
  assert.equal(outcome.readerReadback?.status, "PASS");
  const read = await readPrlProjection({ store, bypassCache: true, now: T0 });
  assert.equal(read.kind, "PROMOTED");
  const bioguide = snapshot.profiles[0].bioguideId;
  const profile = prlProfileForSubject(`congress:${bioguide}`);
  assert.equal(profile?.bioguideId, bioguide);
  assert.equal(profile?.attribution.citation, snapshot.attribution.citation);
  assert.equal(prlProfileForSubject(bioguide), null, "a name/bare-id fallback must not join a PRL row");
});

test("PRL licensing/ranking defects and source failures preserve the prior GOOD attributed projection", async () => {
  const store = new MemoryRoutineDataStore();
  const snapshot = prlFixture();
  const good = prlCandidate({ snapshot, rawZip: new TextEncoder().encode("PRL v1"), finalUrl: snapshot.sourceUrl, retrievedAt: T0 });
  await processRegisteredManualCandidate(store, "prl", good, T0);

  const badSnapshot = structuredClone(snapshot) as PrlSnapshot & { profiles: Array<PrlSnapshot["profiles"][number] & { ideology_ideology?: number }> };
  badSnapshot.profiles[0].ideology_ideology = 0.5;
  const bad = prlCandidate({ snapshot: badSnapshot, rawZip: new TextEncoder().encode("PRL v2"), finalUrl: snapshot.sourceUrl, retrievedAt: T1 });
  const refused = await processRegisteredManualCandidate(store, "prl", bad, T1);
  assert.equal(refused.promoted, null);
  assert.equal(refused.candidate.state, "PARSE_INVALID");
  assert.match(refused.candidate.failureDetail ?? "", /outside the PRL rhetoric allowlist/);
  assert.equal((await store.readPromotion("PRL_PROFILE", PRL_CONTRACT.scope))?.versionId, good.id);

  const failed = failedAcquisitionCandidate({
    sourceId: PRL_CONTRACT.sourceId,
    recordClass: PRL_CONTRACT.recordClass,
    scope: PRL_CONTRACT.scope,
    requestedUrl: snapshot.sourceUrl,
    attemptedAt: "2026-09-08T14:00:00.000Z",
    failureDetail: "PRL archive unavailable",
    parserVersion: PRL_CONTRACT.parserVersion,
  });
  const sourceFailure = await processRegisteredManualCandidate(store, "prl", failed, failed.retrieval.retrievedAt);
  assert.equal(sourceFailure.candidate.state, "SOURCE_BLOCKED");
  assert.equal((await store.readPromotion("PRL_PROFILE", PRL_CONTRACT.scope))?.versionId, good.id);
});

test("voting-sites and PRL share registered acquisition commands with automatic refresh and no tracked mutable writer", () => {
  const contracts = MANUAL_PRODUCTION_SOURCE_CONTRACTS.filter((contract) => ["voting-sites", "prl"].includes(contract.id));
  assert.equal(contracts.length, 2);
  assert.ok(contracts.every((contract) => contract.execution === "EXPLICIT_OWNER_INVOCATION_ONLY"));
  assert.ok(contracts.every((contract) => !Object.hasOwn(contract, "cadence") && !Object.hasOwn(contract, "retry")));
  assert.deepEqual(SOURCE_AUTHORITIES.prl.recordClasses, ["PRL_PROFILE", "PRL_ARCHIVE"]);
  assert.equal(SOURCE_AUTHORITIES.prl.trust, "T3_ATTRIBUTED_PRIMARY");
  assert.ok(SOURCE_AUTHORITIES.prl.competentFacts.every((fact) => /PRL|licence/.test(fact)));

  for (const contract of contracts) {
    const source = readFileSync(join(ROOT, contract.command[0]), "utf8");
    assert.doesNotMatch(source, /\b(?:writeFile|writeFileSync|appendFile|appendFileSync|createWriteStream)\s*\(/, contract.id);
    assert.doesNotMatch(source, /\bprocess\.exit\s*\(/, contract.id);
    assert.doesNotMatch(source, /(?:deploy-production|netlify\s+deploy|release:prod|git\s+(?:add|commit|push))/i, contract.id);
  }
  const prlSource = readFileSync(join(ROOT, "scripts", "prl-refresh.mts"), "utf8");
  assert.doesNotMatch(prlSource, /officeholders-us\.json|data[\\/]prl[\\/]prl-profiles\.json/);

  const votingReader = readFileSync(join(ROOT, "lib", "ballot", "voting-sites-server.ts"), "utf8");
  const prlReader = readFileSync(join(ROOT, "lib", "sources", "prl", "snapshot.ts"), "utf8");
  assert.match(votingReader, /readPromotedCivicData/);
  assert.match(prlReader, /readPromotedCivicData/);
  const config = readFileSync(join(ROOT, "next.config.ts"), "utf8");
  const trace = readFileSync(join(ROOT, "lib", "holdings", "reader-trace.ts"), "utf8");
  assert.doesNotMatch(config, /data\/prl\/prl-profiles\.json/);
  assert.doesNotMatch(trace, /data\/(?:voting-sites\.json|prl\/prl-profiles\.json)/);
});
