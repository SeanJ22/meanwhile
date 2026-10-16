import { rememberStatePublicationPrior, takeStatePublicationPrior } from "../lib/civic-data/state-publication-prior.ts";
import { stateBallotScope } from "../lib/ballot/state-scopes.ts";
import { readPromotedCivicData } from "../lib/civic-data/read-model.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import test from "node:test";
import { votingSitesContract, votingSitesCandidate,
  votingSitesScopedSuccessor, votingSitesStandardSuccessor, type VotingRawCapture } from "../lib/ballot/voting-sites-data-plane.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { parseVotingCapture, votingRowsToSites } from "../lib/ballot/voting-source-readers.ts";
import { mergeVotingSourceRead, holdVotingRawEvidence } from "../lib/ballot/voting-source-publication.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import type { VotingSourceDoor, VotingSourceRead } from "../lib/ballot/voting-source-types.ts";

const PDF = readFileSync(join(process.cwd(), "tests/fixtures/cochise-2026-vote-centers.pdf"));
const DOOR = (JSON.parse(readFileSync(join(process.cwd(), "data/reference/voting-legacy-doors.json"), "utf8")) as VotingSourceDoor[])
  .find(door => door.id === "legacy:cochise:vote-center-pdf")!;
const CAPTURE = { url: DOOR.url, contentType: "application/pdf", bytes: PDF };
async function capturedRead(): Promise<VotingSourceRead> {
  const source = { publisher: DOOR.publisher, url: DOOR.url, checkedAt: T1 };
  const parsed = votingRowsToSites(await parseVotingCapture(CAPTURE, DOOR), DOOR, source);
  return { doorId: DOOR.id, sites: parsed.sites, office: parsed.office, rules: DOOR.rules ?? [], sources: [source],
    blanks: [], attempts: [], rawBodies: [CAPTURE] };
}
async function capturedJurisdiction() {
  return mergeVotingSourceRead(undefined, DOOR, await capturedRead(), T1);
}
const T0 = "2026-09-28T10:00:00.000Z";
const T1 = "2026-09-28T10:30:00.000Z";
const COCHISE = "ocd-division/country:us/state:az/county:cochise";
const COUNTY_A = "ocd-division/country:us/state:az/county:example-a";
const COUNTY_B = "ocd-division/country:us/state:az/county:example-b";

function priorFile(): VotingSitesFile {
  const county = (ocdId: string, state: string, name: string, n: number) => ({
    ocdId, name, state, model: "VOTE_CENTER" as const, election: "2026 General",
    sites: [{ id: `${state.toLowerCase()}-vc-${n}`, name: `${name} Vote Center`, address: `${n}00 Main Street, Example, ${state} 9900${n}`,
      room: null, lat: 45 + n / 10, lng: -120 - n / 10, kind: "ELECTION_DAY" as const, election: "2026 General", serves: null }],
    sourceOrg: `${name} Elections`, sourceUrl: `https://elections.${state.toLowerCase()}-example.gov/vote-centers`,
    collectedAt: "2026-09-20", refusal: null,
  });
  return { generatedAt: "2026-09-20", jurisdictions: [county(COUNTY_A, "AZ", "Example A County", 1), county(COUNTY_B, "AZ", "Example B County", 2)] };
}

test("the generic PDF mapping reads all 18 official countywide vote centers, hours, phone and return rule", async () => {
  const read = await capturedRead();
  assert.equal(read.sites.length, 18);
  assert.equal(new Set(read.sites.map(site => site.id)).size, 18);
  assert.equal(read.sites.find(site => site.name === "Shiloh Christian Ministries")?.address, "1519 Avenida Del Sol");
  assert.ok(read.sites.every(site => site.hours === "6:00 a.m. to 7:00 p.m." && site.days === "Election Day"));
  assert.ok(read.sites.every(site => site.kind === "VOTE_CENTER" && site.sources?.[0]?.url === DOOR.url));
  assert.equal(read.office?.phone, "520-432-8970");
  assert.equal(read.rules[0]?.text, "Voters may vote at any of the Vote Centers listed below.");
  assert.equal(createHash("sha256").update(PDF).digest("hex"), "f6d1a5aea11ed5869989aba7532ebfe481cf0321d6f451470f6e2907ace3270c");
  assert.equal((await capturedJurisdiction()).model, "VOTE_CENTER");
  const vault = new MemoryEvidenceStore(), evidence = await holdVotingRawEvidence(vault, read);
  assert.deepEqual(Buffer.from((await vault.get(evidence[0]!.vaultKey))!.bytes), PDF);
});

test("an incomplete PDF fails without producing a replacement list", async () => {
  await assert.rejects(parseVotingCapture({ ...CAPTURE, bytes: PDF.subarray(0, 100) }, DOOR));
});

test("a scoped county successor promotes through the existing pointer and leaves every other county exact", async () => {
  const store = new MemoryRoutineDataStore();
  const prior = priorFile();
  const vault = new MemoryEvidenceStore();
  const original = await holdVotingRawEvidence(vault, { rawBodies: [{ url: "https://elections.az-example.gov/vote-centers",
    contentType: "text/html", bytes: new TextEncoder().encode("original official bytes") }] });
  const base = votingSitesCandidate({ state: "AZ", current: prior, prior: null, failures: [], acquisition: original,
    successfulAuthorityReads: 1, requestedUrl: "https://elections.az-example.gov/vote-centers", finalUrl: "https://elections.az-example.gov/vote-centers", retrievedAt: T0 });
  assert.ok((await processRegisteredManualCandidate(store, "voting-sites:AZ", base, T0)).promoted);
  const cochise = await capturedJurisdiction();
  const successor = votingSitesScopedSuccessor(prior, cochise, "2026-09-28");
  assert.deepEqual(successor.jurisdictions.filter(row => row.ocdId !== COCHISE),
    [...prior.jurisdictions].sort((left, right) => left.ocdId.localeCompare(right.ocdId)));
  const acquisition = await holdVotingRawEvidence(vault, await capturedRead());
  const candidate = votingSitesCandidate({ state: "AZ", current: successor, prior, failures: [], acquisition,
    successfulAuthorityReads: 1, requestedUrl: cochise.sourceUrl, finalUrl: cochise.sourceUrl, retrievedAt: T1,
    carriedFromVersionId: base.id });
  const payload = candidate.normalizedPayload as { acquisition: VotingRawCapture[]; carriedFromVersionId: string; projection: VotingSitesFile };
  assert.equal(payload.carriedFromVersionId, base.id);
  assert.deepEqual(payload.projection, successor);
  assert.deepEqual(payload.acquisition, [{ url: DOOR.url, contentType: "application/pdf", vaultKey: payload.acquisition[0]!.vaultKey,
    rawHash: "f6d1a5aea11ed5869989aba7532ebfe481cf0321d6f451470f6e2907ace3270c", byteLength: PDF.byteLength }]);
  assert.ok(JSON.stringify(candidate).length < 64 * 1024, "the candidate holds refs, not the PDF");
  assert.deepEqual(Buffer.from((await vault.get(payload.acquisition[0]!.vaultKey))!.bytes), PDF);
  const published = await processRegisteredManualCandidate(store, "voting-sites:AZ", candidate, T1);
  assert.ok(published.promoted);
  assert.equal(published.readerReadback?.status, "PASS", JSON.stringify(published.readerReadback));
  const read = await readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", "AZ"), { store, now: T1, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(read.kind === "PROMOTED" && read.value.jurisdictions.find(row => row.ocdId === COCHISE)?.sites.length, 18);
  assert.equal((await store.readPromotion(votingSitesContract("AZ").recordClass, votingSitesContract("AZ").scope))?.versionId, candidate.id);
  const saved = await store.readCandidate(candidate.id);
  assert.deepEqual((saved?.candidate.normalizedPayload as typeof payload).acquisition, payload.acquisition);
  assert.deepEqual(votingSitesScopedSuccessor(null, cochise, "2026-09-28").jurisdictions, [cochise]);
});

test("the next standard refresh carries a scoped county unchanged while refreshing the others", async () => {
  const prior = priorFile();
  const cochise = await capturedJurisdiction();
  const withCochise = votingSitesScopedSuccessor(prior, cochise, "2026-09-28");
  const next = votingSitesStandardSuccessor(prior, withCochise);
  assert.deepEqual(next.jurisdictions.find(row => row.ocdId === COCHISE), cochise);
  assert.equal(next.jurisdictions.length, withCochise.jurisdictions.length);
  const disappeared = { ...prior, jurisdictions: prior.jurisdictions.filter(row => row.ocdId !== COUNTY_A) };
  assert.equal(votingSitesStandardSuccessor(disappeared, withCochise).jurisdictions.some(row => row.ocdId === COUNTY_A), true);
  assert.equal(votingSitesStandardSuccessor(disappeared, withCochise, prior.jurisdictions.map(row => row.ocdId))
    .jurisdictions.some(row => row.ocdId === COUNTY_A), false);
  assert.deepEqual(votingSitesStandardSuccessor(withCochise, prior), withCochise);
});

test("scoped refresh accepts any state, county, voting model and sourced site count", () => {
  const prior = priorFile();
  const original = prior.jurisdictions.find(row => row.sites.length > 0)!;
  for (const state of ["AK", "HI", "DC", "WI"]) {
    const ocdId = `ocd-division/country:us/${state === "DC" ? "district" : "state"}:${state.toLowerCase()}/county:example`;
    const current = { ...structuredClone(original), state, ocdId, model: "ASSIGNED" as const, sites: original.sites.slice(0, 1) };
    const next = votingSitesScopedSuccessor(prior, current, "2026-09-28");
    assert.deepEqual(next.jurisdictions.find(row => row.ocdId === ocdId), current);
    assert.deepEqual(next.jurisdictions.filter(row => row.ocdId !== ocdId),
      [...prior.jurisdictions].sort((a, b) => a.ocdId.localeCompare(b.ocdId)));
  }
});

test("one county's source failure retains that county only", async () => {
  const cochise = await capturedJurisdiction();
  const prior = priorFile();
  const full = votingSitesScopedSuccessor(prior, cochise, "2026-09-28");
  const current = structuredClone(full);
  const failed = current.jurisdictions.find(row => row.ocdId === COUNTY_A)!;
  failed.sites = [];
  failed.refusal = { wall: "HTTP 503", rungs: [{ rung: 2, what: "official route", result: "HTTP 503", attemptedAt: "2026-09-28" }] };
  const refresh = (value: VotingSitesFile, jurisdictionId: string) => votingSitesCandidate({ state: "AZ", current: value, prior: full,
    failures: [{ jurisdictionId, code: "SOURCE_UNAVAILABLE", detail: "HTTP 503" }], acquisition: [], successfulAuthorityReads: 0,
    requestedUrl: DOOR.url, finalUrl: DOOR.url, retrievedAt: T1 }).readModel as VotingSitesFile;
  const partial = refresh(current, COUNTY_A);
  assert.deepEqual(partial.jurisdictions.find(row => row.ocdId === COCHISE), cochise);
  assert.deepEqual(partial.jurisdictions.find(row => row.ocdId === COUNTY_A)?.sites, full.jurisdictions.find(row => row.ocdId === COUNTY_A)?.sites);
  const changed = structuredClone(full);
  changed.jurisdictions.find(row => row.ocdId === COCHISE)!.sites = [];
  const retained = refresh(changed, COCHISE);
  assert.deepEqual(retained.jurisdictions.find(row => row.ocdId === COCHISE), cochise);
  assert.deepEqual(retained.jurisdictions.find(row => row.ocdId === COUNTY_A), full.jurisdictions.find(row => row.ocdId === COUNTY_A));
});


test("voting successors release unchanged prior rows and retain exact changed or removed audit values", async () => {
  const store = new MemoryRoutineDataStore(), original = priorFile();
  original.jurisdictions[0].sites.push({ ...original.jurisdictions[0].sites[0], id: "retired-site", name: "Retired site" });
  const url = original.jurisdictions[0].sourceUrl;
  const acquisition = await holdVotingRawEvidence(new MemoryEvidenceStore(), { rawBodies: [{ url,
    contentType: "text/plain", bytes: new TextEncoder().encode("Fixture official sites") }] });
  const base = votingSitesCandidate({ state: "AZ", current: original, prior: null, failures: [], acquisition,
    successfulAuthorityReads: 1, requestedUrl: url, finalUrl: url, retrievedAt: T0 });
  assert.ok((await processRegisteredManualCandidate(store, "voting-sites:AZ", base, T0)).promoted);
  const read = await readPromotedCivicData<VotingSitesFile>("VOTING_SITE", stateBallotScope("voting-sites", "AZ"), { store, now: T1, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  if (read.kind !== "PROMOTED") throw new Error("Missing voting fixture");
  rememberStatePublicationPrior(store, read.projection);
  const held = read.value, previous = held.jurisdictions[0];
  const current = { ...held, jurisdictions: held.jurisdictions.map(row => row === previous
    ? { ...row, sites: [{ ...row.sites[0], name: "Updated public site" }] } : row) };
  const candidate = votingSitesCandidate({ state: "AZ", current, prior: held, failures: [], acquisition,
    successfulAuthorityReads: 1, requestedUrl: url, finalUrl: url, retrievedAt: T1, carriedFromVersionId: base.id });
  const index = takeStatePublicationPrior(store, "VOTING_SITE", stateBallotScope("voting-sites", "AZ"))!;
  assert.ok(index);
  assert.equal(index.members.get(`site:${previous.ocdId}:${previous.sites[0].id}`)?.record, previous.sites[0]);
  assert.equal(index.members.get(`site:${previous.ocdId}:retired-site`)?.record, previous.sites[1]);
  const unchanged = held.jurisdictions[1];
  assert.equal(index.members.get(`site:${unchanged.ocdId}:${unchanged.sites[0].id}`)?.record, undefined);
  assert.equal(index.members.get(`jurisdiction:${previous.ocdId}`)?.record, undefined, "site changes do not duplicate unchanged jurisdiction metadata");
  assert.equal((candidate.readModel as VotingSitesFile).jurisdictions[1], unchanged);
  assert.equal(previous.sites[0].name, "Example A County Vote Center");
});
