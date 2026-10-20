import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { parseLegiscanDatasetList, parseLegiscanDataset, legiscanIdentityJoins, digest, type LegiscanSession } from "../lib/sources/legiscan/dataset.ts";
import { acquireLegiscanVotes } from "../lib/sources/legiscan/vote-acquisition.ts";
import { legiscanVotesProjectionIssue, legiscanVoteIdentityAuthorityIssue, readLegiscanVotesForPerson } from "../lib/sources/legiscan/votes.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { publishStatePeople } from "../lib/civic-data/state-people-publication.ts";
import { normalize, yamlToPeople, indexDivisions } from "../lib/sources/plural/index.ts";
import { refreshLegiscanVotes } from "../scripts/legiscan-votes-refresh.mts";
import { authorityFor } from "../lib/civic-data/source-authority.ts";
import { PLURAL_STATES } from "../lib/sources/plural/targets.ts";
import { LEGISCAN_ATTRIBUTION } from "../lib/sources/legiscan/types.ts";

const vault = new MemoryEvidenceStore();

const fixture = (file: string) => readFileSync(new URL(`./fixtures/legiscan/${file}`, import.meta.url), "utf8");
const at = "2026-10-13T12:00:00.000Z", personId = "ocd-person/2fd6fcd3-9676-42a4-b879-e317576ff18f";
const metadata = JSON.parse(fixture("tx-dataset-metadata.json"));
const session = parseLegiscanDatasetList(fixture("tx-dataset-list.json"), "tx").find(row => row.sessionId === metadata.session_id)!;
const manifest = JSON.parse(fixture("manifest.json"));
const archive = () => zip([
  { name: manifest.selectedArchiveMembers[0], data: Buffer.from(fixture("tx-HB1.json")) },
  { name: manifest.selectedArchiveMembers[1], data: Buffer.from(fixture("tx-1599780.json")) },
  { name: manifest.selectedArchiveMembers[2], data: Buffer.from(fixture("tx-5848.json")) },
], "2026-10-13");
const sourceUrl = "https://raw.githubusercontent.com/openstates/people/main/data/tx/legislature/Alma-Allen-2fd6fcd3-9676-42a4-b879-e317576ff18f.yml";
const holders = () => normalize(yamlToPeople(fixture("openstates-alma-allen.yml"), "tx", sourceUrl, at), indexDivisions([]), at, "US-TX").officeholders;
const evidence = () => ({ requestedUrl: `https://api.legiscan.com/?op=getDataset&id=${session.sessionId}&dataset_hash=${session.datasetHash}`,
  finalUrl: `https://api.legiscan.com/?op=getDataset&id=${session.sessionId}&dataset_hash=${session.datasetHash}`, retrievedAt: at, sha256: digest(archive()) });
const parse = (input: { holders?: ReturnType<typeof holders>; state?: string; session?: LegiscanSession } = {}) => parseLegiscanDataset({
  state: input.state ?? "tx", session: input.session ?? session, bytes: archive(), evidence: evidence(), holders: input.holders ?? holders(), signal: AbortSignal.timeout(10_000) });

test("saved real LegiScan source members bind Texas roll positions to the same exact OpenStates person", async () => {
  const parsed = await parse();
  assert.equal(parsed.votes.length, 1); assert.equal(parsed.held.length, 0);
  const vote = parsed.votes[0];
  assert.equal(vote.id, "legiscan:roll_call:1599780"); assert.equal(vote.billNumber, "HB1");
  assert.equal(vote.motion, "Amendment amended RV#32"); assert.equal(vote.date, "2025-08-21");
  assert.equal(vote.positions.length, 1); assert.equal(vote.unresolvedPositions, 149);
  assert.deepEqual(vote.positions[0], { personId, option: "Yea", retrievedAt: at });
  assert.deepEqual(vote.counts, [{ option: "yea", value: 73 }, { option: "nay", value: 59 }, { option: "nv", value: 1 }, { option: "absent", value: 17 }]);
  assert.equal(parsed.joins[0].basis, "EXACT_MEMBER_PROFILE_URL");
  assert.equal(parsed.joins[0].matchedUrl, "https://house.texas.gov/members/2100");
  assert.equal(parsed.joins[0].openStatesProfileUrl, "https://house.texas.gov/members/2100");
  assert.equal(parsed.joins[0].legiscanProfileUrl, "https://www.house.texas.gov/members/2100");
  assert.ok(vote.sourceUrls.some(url => url.startsWith("https://capitol.texas.gov/BillLookup/RecordVote.aspx?")));
  assert.deepEqual(LEGISCAN_ATTRIBUTION.licence, "CC BY 4.0");
});
test("exact identity matches remain unresolved when two native people share the member URL; names never rescue a join", async () => {
  const holder = holders()[0], duplicate = { ...holder, id: "plural:tx:12345678-1234-1234-1234-123456789abc", personId: "plural:12345678-1234-1234-1234-123456789abc",
    nativeIds: { "ocd-person": ["ocd-person/12345678-1234-1234-1234-123456789abc"] } };
  const ambiguous = await parse({ holders: [holder, duplicate] });
  assert.equal(ambiguous.votes.length, 0); assert.ok(ambiguous.held.some(row => row.key === "legiscan:people:5848"));
  const sameName = await parse({ holders: [{ ...holder, websiteUrl: null, profileUrls: [] }] });
  assert.equal(sameName.votes.length, 0);
  const native = legiscanIdentityJoins([{ ...holder, websiteUrl: null, profileUrls: [], nativeIds: { ...holder.nativeIds, legiscan: ["5848"] } }], [JSON.parse(fixture("tx-5848.json")).person]);
  assert.equal(native[0].personId, personId); assert.equal(native[0].basis, "NATIVE_ID");
});
test("state, session and archive structure are checked before any member positions can publish", async () => {
  await assert.rejects(parse({ state: "NH" }), /LEGISCAN_DATASET_STATE_MISMATCH/);
  await assert.rejects(parse({ session: { ...session, sessionId: 999999 } }), /LEGISCAN_BILL_SCOPE_INVALID/);
  const list = parseLegiscanDatasetList(fixture("tx-dataset-list.json"), "TX");
  assert.deepEqual([...new Set(list.map(row => row.yearStart))], [2025, 2023]);
  for (const state of PLURAL_STATES) assert.equal(authorityFor("legiscan", "STATE_ROLL_CALL", "https://api.legiscan.com/?op=getDatasetList").ok, true, state);
});
function transport() {
  const requests: string[] = [];
  const nativeSession = JSON.parse(fixture("tx-dataset-list.json")).datasetlist.find((row: { session_id: number }) => row.session_id === session.sessionId);
  const fetchImpl = (async (value: Parameters<typeof fetch>[0]) => {
    const url = new URL(String(value)); requests.push(url.searchParams.get("op")!);
    assert.equal(url.searchParams.get("key"), "private-test-api-key");
    if (url.searchParams.get("op") === "getDatasetList") {
      assert.equal(url.searchParams.get("state"), "TX");
      return new Response(JSON.stringify({ status: "OK", datasetlist: [{ ...nativeSession, access_key: "private-test-dataset-key" }] }));
    }
    assert.equal(url.searchParams.get("access_key"), "private-test-dataset-key");
    assert.equal(url.searchParams.has("dataset_hash"), false);
    return new Response(JSON.stringify({ status: "OK", dataset: { ...metadata, zip: archive().toString("base64") } }));
  }) as typeof fetch;
  return { fetchImpl, requests };
}
test("daily listing checks reuse immutable saved datasets and never retain keys", async () => {
  const { fetchImpl, requests } = transport(), store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  let now = at;
  const acquire = () => acquireLegiscanVotes({ state: "tx", holders: holders(), apiKey: "private-test-api-key", store, locks, fetchImpl,
    now: () => now, signal: AbortSignal.timeout(10_000) });
  const first = await acquire(); assert.equal(first.results[0].votes.length, 1); assert.deepEqual(requests, ["getDatasetList", "getDataset"]);
  assert.equal(JSON.stringify(first).includes("private-test-"), false);
  await acquire(); assert.equal(requests.length, 2);
  now = "2026-10-14T12:00:00.000Z";
  const checked = await acquire(); assert.deepEqual(requests, ["getDatasetList", "getDataset", "getDatasetList"]);
  assert.equal(checked.listing.retrievedAt, at); assert.equal(checked.listing.sourceCheck?.checkedAt, now);
  assert.equal(checked.results[0].votes[0].retrievedAt, at);
});
test("actual source fixtures promote through the per-state routine contract and repeat checks confirm unchanged reader facts", async () => {
  const civicStore = new MemoryRoutineDataStore(), store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories(), { fetchImpl } = transport();
  const roster = normalize(yamlToPeople(fixture("openstates-alma-allen.yml"), "tx", sourceUrl, at), indexDivisions([]), at, "US-TX");
  const published = await publishStatePeople({ vault, store: civicStore, state: "tx", roster, releaseId: "fixture-actual-openstates",
    acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, body: fixture("openstates-alma-allen.yml"), rawHash: digest(fixture("openstates-alma-allen.yml")), httpStatus: 200, retrievedAt: at }], now: at });
  assert.ok(published.outcome.promoted);
  const input = { state: "tx", civicStore, store, locks, fetchImpl, apiKey: "private-test-api-key", now: () => at, signal: AbortSignal.timeout(10_000) };
  const first = await refreshLegiscanVotes(input); assert.equal(first.rollCalls, 1); assert.equal(first.positions, 1);
  assert.equal((first.publication.candidate.readModel as { formatVersion: number }).formatVersion, 2);
  assert.equal(legiscanVotesProjectionIssue(first.publication.candidate.readModel as Parameters<typeof legiscanVotesProjectionIssue>[0]), null);
  const unboundPages = structuredClone(first.publication.candidate.readModel) as Parameters<typeof legiscanVotesProjectionIssue>[0];
  unboundPages.identityAuthority.joins = [];
  unboundPages.identityAuthority.crosswalkSha256 = digest([]);
  assert.equal(legiscanVotesProjectionIssue(unboundPages), "LEGISCAN_VOTE_NATIVE_FACT_INVALID");
  const votes = await readLegiscanVotesForPerson("tx", personId, { store: civicStore, now: at, bypassCache: true });
  assert.equal(votes.length, 1); assert.equal(votes[0].position, "Yea");
  const second = await refreshLegiscanVotes(input); assert.ok(second.publication.outcome.confirmed);
  assert.equal(second.publication.outcome.confirmed.versionId, first.publication.outcome.promoted?.versionId);
  const forged = structuredClone(first.publication.candidate);
  (forged.readModel as Parameters<typeof legiscanVotesProjectionIssue>[0]).identityAuthority.versionId = "unheld-roster";
  assert.match((await legiscanVoteIdentityAuthorityIssue(civicStore, forged))!, /canonical held OpenStates roster/);
  // A new capture of the same real native person is a distinct source version;
  // the earlier verified crosswalk keeps the exact source version it used.
  const later = at;
  const republished = await publishStatePeople({ vault, store: civicStore, state: "tx", roster: { ...roster, generatedAt: later }, releaseId: "fixture-actual-openstates-next",
    acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, body: fixture("openstates-alma-allen.yml"), rawHash: digest(fixture("openstates-alma-allen.yml")), httpStatus: 200, retrievedAt: later }], now: later, confirmUnchanged: false });
  assert.ok(republished.outcome.promoted);
  const historical = structuredClone(first.publication.candidate);
  (historical.readModel as Parameters<typeof legiscanVotesProjectionIssue>[0]).identityAuthority.versionId = republished.outcome.promoted.versionId;
  assert.equal(await legiscanVoteIdentityAuthorityIssue(civicStore, historical), null);
});
test("a successful empty daily listing is a confirmed unchanged check and establishes no absent votes", async () => {
  const civicStore = new MemoryRoutineDataStore(), store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const roster = normalize(yamlToPeople(fixture("openstates-alma-allen.yml"), "tx", sourceUrl, at), indexDivisions([]), at, "US-TX");
  await publishStatePeople({ vault, store: civicStore, state: "tx", roster, releaseId: "fixture-empty-list-roster",
    acquisitions: [{ requestedUrl: sourceUrl, finalUrl: sourceUrl, body: fixture("openstates-alma-allen.yml"), rawHash: digest(fixture("openstates-alma-allen.yml")), httpStatus: 200, retrievedAt: at }], now: at });
  const input = { state: "tx", civicStore, store, locks, apiKey: "private-test-api-key", now: () => at, signal: AbortSignal.timeout(10_000),
    fetchImpl: (async () => new Response(JSON.stringify({ status: "OK", datasetlist: [] }))) as typeof fetch };
  const first = await refreshLegiscanVotes(input), second = await refreshLegiscanVotes(input);
  assert.equal(first.rollCalls, 0); assert.equal(first.positions, 0);
  assert.equal(first.publication.candidate.absence.claimsAbsence, false);
  assert.ok(second.publication.outcome.confirmed);
});
