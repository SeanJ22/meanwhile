import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { VOTING_SITES_CONTRACT, retainFailedVotingSiteScopes, votingSitesCandidate,
  votingSitesScopedSuccessor, votingSitesStandardSuccessor } from "../lib/ballot/voting-sites-data-plane.ts";
import { loadVotingSites, readVotingSitesProjection, resetVotingSitesCache } from "../lib/ballot/voting-sites-server.ts";
import type { VotingSitesFile } from "../lib/ballot/voting-sites.ts";
import { processRegisteredManualCandidate } from "../lib/civic-data/promotion.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { cochiseGeneralElectionLinkIssue, cochiseVotingJurisdiction, parseCochiseVoteCenterItems,
  parseCochiseVoteCenters, type PositionedText } from "../lib/sources/cochise-vote-centers.ts";

const PDF = readFileSync(join(process.cwd(), "tests/fixtures/cochise-2026-vote-centers.pdf"));
const ELECTIONS = `<h2>General Election</h2><h2>November 3, 2026</h2><a href="/DocumentCenter/View/4575/Vote-Center-Locations-PDF">Vote Center Locations</a>`;
const VOTER = `<h3>Important Dates for General Election</h3><a href="/DocumentCenter/View/4575/Vote-Center-Locations-PDF">View Election Day Polling Locations</a>`;
const T0 = "2026-09-28T10:00:00.000Z";
const T1 = "2026-09-28T10:30:00.000Z";
const COCHISE = "ocd-division/country:us/state:az/county:cochise";
const COUNTY_A = "ocd-division/country:us/state:wa/county:example-a";
const COUNTY_B = "ocd-division/country:us/state:or/county:example-b";

function priorFile(): VotingSitesFile {
  const county = (ocdId: string, state: string, name: string, n: number) => ({
    ocdId, name, state, model: "VOTE_CENTER" as const, election: "2026 General",
    sites: [{ id: `${state.toLowerCase()}-vc-${n}`, name: `${name} Vote Center`, address: `${n}00 Main Street, Example, ${state} 9900${n}`,
      room: null, lat: 45 + n / 10, lng: -120 - n / 10, kind: "ELECTION_DAY" as const, election: "2026 General", serves: null }],
    sourceOrg: `${name} Elections`, sourceUrl: `https://elections.${state.toLowerCase()}-example.gov/vote-centers`,
    collectedAt: "2026-09-20", refusal: null,
  });
  return { generatedAt: "2026-09-20", jurisdictions: [county(COUNTY_A, "WA", "Example A County", 1), county(COUNTY_B, "OR", "Example B County", 2)] };
}

async function positioned(): Promise<PositionedText[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(PDF), useWorkerFetch: false }).promise;
  try {
    const content = await (await doc.getPage(1)).getTextContent();
    return content.items.flatMap((item: unknown) => {
      if (!item || typeof item !== "object" || !("str" in item) || !("transform" in item)) return [];
      const part = item as { str: string; transform: number[] };
      const text = part.str.replace(/\s+/g, " ").trim();
      return text ? [{ text, x: part.transform[4]!, y: part.transform[5]! }] : [];
    });
  } finally { await doc.cleanup(); }
}

test("official 2026 Cochise PDF yields exactly 18 countywide vote centers with exact raw hash", async () => {
  const centers = await parseCochiseVoteCenters(PDF);
  assert.equal(centers.length, 18);
  assert.deepEqual(centers.map(row => row.id), [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,17,18,19].map(n => `az-cochise-vc-${n}`));
  assert.equal(centers.find(row => row.id === "az-cochise-vc-8")?.address, "1519 Avenida Del Sol");
  const jurisdiction = await cochiseVotingJurisdiction({ pdfBytes: PDF, electionsHtml: ELECTIONS,
    voterHtml: VOTER, collectedAt: "2026-09-28" });
  assert.equal(jurisdiction.model, "VOTE_CENTER");
  assert.equal(jurisdiction.election, "2026 General Election");
  assert.equal(jurisdiction.sourceRawSha256, "f6d1a5aea11ed5869989aba7532ebfe481cf0321d6f451470f6e2907ace3270c");
  assert.ok(jurisdiction.sites.every(site => site.serves === null && site.election === "2026 General Election"));
});

test("wrong year, short or duplicate list, malformed address and missing general-election link refuse", async () => {
  const items = await positioned();
  const change = (predicate: (item: PositionedText) => boolean, text: string) =>
    items.map(item => predicate(item) ? { ...item, text } : item);
  assert.throws(() => parseCochiseVoteCenterItems(change(item => item.text.includes("ELECTIONS – 2026"), "COCHISE COUNTY ELECTIONS – 2025")), /YEAR_OR_AUTHORITY_CHANGED/);
  assert.throws(() => parseCochiseVoteCenterItems(items.filter(item => item.text !== "VC19")), /ROW_COUNT_MISMATCH/);
  assert.throws(() => parseCochiseVoteCenterItems(change(item => item.text === "VC19", "VC18")), /DUPLICATE_OR_BAD_ID/);
  assert.throws(() => parseCochiseVoteCenterItems(change(item => item.text === "1519 Avenida Del Sol", "no street")), /ROW_SHAPE_8/);
  assert.throws(() => parseCochiseVoteCenterItems(change(item => item.text.includes("Voters may vote at any"), "Assigned precincts only")), /COUNTYWIDE_ELIGIBILITY_UNPROVEN/);
  assert.equal(cochiseGeneralElectionLinkIssue(ELECTIONS.replace("November 3, 2026", "July 21, 2026"), VOTER), "GENERAL_ELECTION_DATE_UNVERIFIED");
  assert.equal(cochiseGeneralElectionLinkIssue(ELECTIONS, VOTER.replace("Vote-Center-Locations-PDF", "older-list.pdf")), "GENERAL_ELECTION_LINK_UNVERIFIED");
});

test("a scoped county successor promotes through the existing pointer and leaves every other county exact", async () => {
  resetVotingSitesCache();
  const store = new MemoryRoutineDataStore();
  const prior = priorFile();
  const base = votingSitesCandidate({ current: prior, prior: null, failures: [], rawBodies: ["original official bytes"],
    successfulAuthorityReads: 1, requestedUrl: "https://elections.wa-example.gov/vote-centers", finalUrl: "https://elections.wa-example.gov/vote-centers", retrievedAt: T0 });
  assert.ok((await processRegisteredManualCandidate(store, "voting-sites", base, T0)).promoted);
  const cochise = await cochiseVotingJurisdiction({ pdfBytes: PDF, electionsHtml: ELECTIONS,
    voterHtml: VOTER, collectedAt: "2026-09-28" });
  const successor = votingSitesScopedSuccessor(prior, cochise, "2026-09-28");
  assert.deepEqual(successor.jurisdictions.filter(row => row.ocdId !== COCHISE),
    [...prior.jurisdictions].sort((left, right) => left.ocdId.localeCompare(right.ocdId)));
  const frame = `${cochise.sourceUrl}\n${cochise.sourceUrl}\nHTTP 200\nContent-Type: application/pdf\nContent-Transfer-Encoding: base64\nbytes ${PDF.length}\nsha256 ${cochise.sourceRawSha256}\n\n${PDF.toString("base64")}`;
  const candidate = votingSitesCandidate({ current: successor, prior, failures: [], rawBodies: [ELECTIONS, VOTER, frame],
    successfulAuthorityReads: 3, requestedUrl: cochise.sourceUrl, finalUrl: cochise.sourceUrl, retrievedAt: T1,
    retainRawBodies: true, carriedFromVersionId: base.id });
  const payload = candidate.normalizedPayload as { acquisition: string[]; carriedFromVersionId: string; projection: VotingSitesFile };
  assert.equal(payload.carriedFromVersionId, base.id);
  assert.deepEqual(payload.projection, successor);
  assert.deepEqual(Buffer.from(payload.acquisition[2]!.split("\n\n")[1]!, "base64"), PDF);
  const published = await processRegisteredManualCandidate(store, "voting-sites", candidate, T1);
  assert.ok(published.promoted);
  assert.equal(published.readerReadback?.status, "PASS");
  const read = await readVotingSitesProjection({ store, now: T1, bypassCache: true });
  assert.equal(read.kind, "PROMOTED");
  assert.equal(loadVotingSites().jurisdictions.find(row => row.ocdId === COCHISE)?.sites.length, 18);
  assert.equal((await store.readPromotion(VOTING_SITES_CONTRACT.recordClass, VOTING_SITES_CONTRACT.scope))?.versionId, candidate.id);
  const saved = await store.readCandidate(candidate.id);
  assert.deepEqual((saved?.candidate.normalizedPayload as typeof payload).acquisition, payload.acquisition);
  assert.deepEqual(votingSitesScopedSuccessor(null, cochise, "2026-09-28").jurisdictions, [cochise]);
});

test("the next standard refresh carries a scoped county unchanged while refreshing the others", async () => {
  const prior = priorFile();
  const cochise = await cochiseVotingJurisdiction({ pdfBytes: PDF, electionsHtml: ELECTIONS,
    voterHtml: VOTER, collectedAt: "2026-09-28" });
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
  const cochise = await cochiseVotingJurisdiction({ pdfBytes: PDF, electionsHtml: ELECTIONS,
    voterHtml: VOTER, collectedAt: "2026-09-28" });
  const prior = priorFile();
  const full = votingSitesScopedSuccessor(prior, cochise, "2026-09-28");
  const current = structuredClone(full);
  const failed = current.jurisdictions.find(row => row.ocdId === COUNTY_A)!;
  failed.sites = [];
  failed.refusal = { wall: "HTTP 503", rungs: [{ rung: 2, what: "official route", result: "HTTP 503", attemptedAt: "2026-09-28" }] };
  assert.deepEqual(retainFailedVotingSiteScopes(current, full,
    [{ jurisdictionId: COUNTY_A, code: "SOURCE_UNAVAILABLE", detail: "HTTP 503" }]).jurisdictions.find(row => row.ocdId === COCHISE), cochise);
  const changed = structuredClone(full);
  changed.jurisdictions.find(row => row.ocdId === COCHISE)!.sites = [];
  const retained = retainFailedVotingSiteScopes(changed, full,
    [{ jurisdictionId: COCHISE, code: "SOURCE_UNAVAILABLE", detail: "HTTP 503" }]);
  assert.deepEqual(retained.jurisdictions.find(row => row.ocdId === COCHISE), cochise);
  assert.deepEqual(retained.jurisdictions.find(row => row.ocdId === COUNTY_A), full.jurisdictions.find(row => row.ocdId === COUNTY_A));
});
