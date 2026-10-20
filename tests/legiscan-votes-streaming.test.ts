import { parseLegiscanDataset } from "./helpers/state-vote-parsers.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { zip } from "../scripts/xlsx.mjs";
import { digest, legiscanIdentityJoins, profileUrl, parseLegiscanDatasetFile, parseLegiscanDatasetList } from "../lib/sources/legiscan/dataset.ts";
import { acquireLegiscanVotes, currentLegiscanSessions } from "../lib/sources/legiscan/vote-acquisition.ts";
import { indexDivisions, normalize, yamlToPeople } from "../lib/sources/plural/index.ts";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { PluralVoteFact } from "../lib/sources/plural/votes.ts";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/legiscan/${name}`, import.meta.url), "utf8");
const at = "2026-10-13T12:00:00.000Z";
const metadata = JSON.parse(fixture("tx-dataset-metadata.json"));
const session = parseLegiscanDatasetList(fixture("tx-dataset-list.json"), "TX").find(row => row.sessionId === metadata.session_id)!;
const personSource = "https://raw.githubusercontent.com/openstates/people/main/data/tx/legislature/Alma-Allen-2fd6fcd3-9676-42a4-b879-e317576ff18f.yml";
const holders = normalize(yamlToPeople(fixture("openstates-alma-allen.yml"), "tx", personSource, at), indexDivisions([]), at, "US-TX").officeholders;
const roll = JSON.parse(fixture("tx-1599780.json"));
function archive(extra: { name: string; data: Buffer }[] = []) {
  return zip([
    { name: "TX/bill/HB1.json", data: Buffer.from(fixture("tx-HB1.json")) },
    { name: "TX/vote/1599780.json", data: Buffer.from(fixture("tx-1599780.json")) },
    { name: "TX/people/5848.json", data: Buffer.from(fixture("tx-5848.json")) },
    ...extra,
  ], "2026-10-13");
}
function input(bytes = archive()) {
  const url = `https://api.legiscan.com/?op=getDataset&id=${session.sessionId}&dataset_hash=${session.datasetHash}`;
  return { state: "TX", session, bytes, holders, signal: AbortSignal.timeout(10_000),
    evidence: { requestedUrl: url, finalUrl: url, retrievedAt: at, sha256: digest(bytes) } };
}

test("file-backed LegiScan parsing streams the same member facts without retaining normalized rolls", async () => {
  const source = input(), retained = await parseLegiscanDataset(source);
  const directory = await mkdtemp(join(tmpdir(), "vt01-legiscan-test-"));
  try {
    const path = join(directory, "session.zip");
    await writeFile(path, source.bytes);
    const streamed: PluralVoteFact[] = [];
    const result = await parseLegiscanDatasetFile({ ...source, path, onVote: async vote => { streamed.push(vote); } });
    assert.deepEqual(streamed, retained.votes);
    assert.deepEqual(result.votes, [], "the producer releases each consumed roll");
    assert.equal(result.rollCalls, 1);
    assert.equal(result.memberVotes, 1);
    assert.equal(result.unmatchedPositions, 149);
    assert.deepEqual(result.held, retained.held);
    assert.deepEqual(result.joins, retained.joins);
    assert.deepEqual(result.evidence, retained.evidence);
    assert.ok(result.evidence.members?.every(member => /^[a-f0-9]{64}$/.test(member.sha256) && !Object.hasOwn(member, "body")));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("a vote consumer controls backpressure and its failure stops acquisition", async () => {
  const second = { roll_call: { ...roll.roll_call, roll_call_id: 1599781 } };
  const source = input(archive([{ name: "TX/vote/1599781.json", data: Buffer.from(JSON.stringify(second)) }]));
  let resume!: () => void, entered!: () => void;
  const paused = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const ids: string[] = [];
  const parsing = parseLegiscanDataset({ ...source, onVote: async vote => {
    ids.push(vote.id);
    if (ids.length === 1) { entered(); await paused; }
  } });
  await started;
  assert.deepEqual(ids, ["legiscan:roll_call:1599780"], "the second roll waits for the first consumer");
  resume();
  const result = await parsing;
  assert.deepEqual(ids, ["legiscan:roll_call:1599780", "legiscan:roll_call:1599781"]);
  assert.equal(result.rollCalls, 2);
  assert.deepEqual(result.votes, []);

  let consumed = 0;
  const persistenceFailure = new Error("test publication failed");
  await assert.rejects(parseLegiscanDataset({ ...source, onVote: async () => { consumed++; throw persistenceFailure; } }),
    error => error === persistenceFailure);
  assert.equal(consumed, 1, "a failed durable consumer cannot be counted as a held publisher record");
});

test("duplicate native roll IDs are rejected before either copy reaches a streaming consumer", async () => {
  const source = input(archive([{ name: "TX/vote/duplicate.json", data: Buffer.from(fixture("tx-1599780.json")) }]));
  const ids: string[] = [];
  const result = await parseLegiscanDataset({ ...source, onVote: async vote => { ids.push(vote.id); } });
  assert.deepEqual(ids, []);
  assert.equal(result.rollCalls, 0);
  assert.equal(result.memberVotes, 0);
  assert.ok(result.held.some(row => row.key === "legiscan:roll_call:1599780"));
});

test("LegiScan acquisition selects the current cycle and releases each completed dataset", async () => {
  const listed = parseLegiscanDatasetList(fixture("tx-dataset-list.json"), "TX");
  const future = { ...session, sessionId: 9999, yearStart: 2027, yearEnd: 2028 };
  const selected = currentLegiscanSessions([...listed, future], at);
  assert.ok(selected.some(row => row.sessionId === session.sessionId), "special sessions in the current cycle remain owed");
  assert.ok(selected.every(row => row.yearStart === 2025));
  assert.deepEqual(currentLegiscanSessions([future], at), []);
  const bytes = archive(), native = JSON.parse(fixture("tx-dataset-list.json")).datasetlist.find((row: { session_id: number }) => row.session_id === session.sessionId);
  const completed: string[] = [];
  const acquired = await acquireLegiscanVotes({ state: "TX", holders, apiKey: "test-key", now: () => at,
    signal: AbortSignal.timeout(10_000), store: new MemoryEvidenceStore(), locks: createMemoryRepositories().locks,
    fetchImpl: (async raw => {
      const endpoint = new URL(String(raw));
      return endpoint.searchParams.get("op") === "getDatasetList"
        ? new Response(JSON.stringify({ status: "OK", datasetlist: [{ ...native, access_key: "test-access" }] }))
        : new Response(JSON.stringify({ status: "OK", dataset: { ...metadata, zip: bytes.toString("base64") } }));
    }) as typeof fetch,
    onDataset: async result => { assert.equal(result.votes.length, 1); completed.push(result.votes[0].id); },
  });
  assert.deepEqual(completed, ["legiscan:roll_call:1599780"]);
  assert.deepEqual(acquired.results, [], "callback consumers cannot retain prior sessions through the acquisition result");
  assert.equal(acquired.completed.length, 1);
  assert.equal(acquired.completed[0].rollCalls, 1);
  assert.equal(acquired.completed[0].memberVotes, 1);
  assert.ok(!Object.hasOwn(acquired.completed[0], "votes"));
});

test("a current biennium keeps its regular session beside a later special session and excludes prefile", () => {
  const native = JSON.parse(fixture("tx-dataset-list.json")).datasetlist.find((row: { session_id: number }) => row.session_id === session.sessionId);
  const list = parseLegiscanDatasetList(JSON.stringify({ status: "OK", datasetlist: [
    { ...native, session_id: 100, session_name: "2023-2024 Regular Session", special: 0, prefile: 0, year_start: 2023, year_end: 2024 },
    { ...native, session_id: 200, session_name: "2025-2026 Regular Session", special: 0, prefile: 0, year_start: 2025, year_end: 2026 },
    { ...native, session_id: 201, special: 1, prefile: 0, year_start: 2026, year_end: 2026 },
    { ...native, session_id: 300, session_name: "2027-2028 Regular Session", special: 0, prefile: 1, year_start: 2027, year_end: 2028 },
  ] }), "TX");
  assert.deepEqual(currentLegiscanSessions(list, at).map(row => row.sessionId).sort(), [200, 201]);
});


test("North Carolina's extra session stays beside its current regular session when the publisher's special flag is zero", () => {
  const native = JSON.parse(fixture("tx-dataset-list.json")).datasetlist[0];
  const sessions = parseLegiscanDatasetList(JSON.stringify({ status: "OK", datasetlist: [
    { ...native, session_id: 2189, session_name: "2025-2026 Session", year_start: 2025, year_end: 2026, special: 0, prefile: 0 },
    { ...native, session_id: 2274, session_name: "2026 First Extra Session", year_start: 2026, year_end: 2026, special: 0, prefile: 0 },
  ] }), "NC");
  assert.deepEqual(currentLegiscanSessions(sessions, at).map(row => row.sessionId).sort(), [2189, 2274]);
});

test("independent exact member profiles join without an official member URL and ambiguous profiles stay unresolved", () => {
  const native = JSON.parse(fixture("tx-5848.json")).person;
  const variants = [
    { url: "https://ballotpedia.org/Alma_Allen_(politician)", links: { social: { ballotpedia: "https://ballotpedia.org/Alma_Allen_%28politician%29" } } },
    { url: "https://justfacts.votesmart.org/candidate/biography/25503/alma-allen", links: { social: { votesmart: "https://justfacts.votesmart.org/candidate/biography/25503/alma-allen" } } },
    { url: "https://example.org/member-campaign", links: { links: { personal: { website: "https://example.org/member-campaign" } } } },
  ];
  for (const variant of variants) {
    const person = { ...native, ballotpedia: "", votesmart_id: "", bio: variant.links };
    const holder = { ...holders[0], websiteUrl: null, profileUrls: [variant.url] };
    const joined = legiscanIdentityJoins([holder], [person]);
    assert.equal(joined.length, 1, variant.url);
    assert.equal(joined[0].basis, "EXACT_MEMBER_PROFILE_URL");
    assert.equal(joined[0].matchedUrl, profileUrl(variant.url));
    const duplicate = { ...holder, id: "plural:tx:12345678-1234-1234-1234-123456789abc", personId: "ocd-person/12345678-1234-1234-1234-123456789abc",
      nativeIds: { "ocd-person": ["ocd-person/12345678-1234-1234-1234-123456789abc"] } };
    assert.deepEqual(legiscanIdentityJoins([holder, duplicate], [person]), []);
  }
  assert.equal(profileUrl("https://ballotpedia.org/Alma%2FAllen"), "https://ballotpedia.org/Alma%2FAllen", "encoded path separators cannot collapse two profiles");
});

test("Nebraska's native L chamber publishes as a unicameral legislature", async () => {
  const bill = JSON.parse(fixture("tx-HB1.json")), person = JSON.parse(fixture("tx-5848.json")), vote = structuredClone(roll);
  bill.bill.state = "NE";
  bill.bill.votes = bill.bill.votes.map((row: { url?: string }) => ({ ...row, url: row.url?.replace("legiscan.com/TX/", "legiscan.com/NE/") }));
  person.person.state_id = 27; vote.roll_call.chamber = "L"; vote.roll_call.chamber_id = 64;
  const bytes = zip([
    { name: "NE/bill/HB1.json", data: Buffer.from(JSON.stringify(bill)) },
    { name: "NE/vote/1599780.json", data: Buffer.from(JSON.stringify(vote)) },
    { name: "NE/people/5848.json", data: Buffer.from(JSON.stringify(person)) },
  ], "2026-10-13");
  const parsed = await parseLegiscanDataset({ ...input(bytes), state: "NE", session: { ...session, state: "NE", stateId: 27 },
    holders: [{ ...holders[0], state: "NE", nativeIds: { ...holders[0].nativeIds, legiscan: ["5848"] } }] });
  assert.equal(parsed.votes.length, 1);
  assert.equal(parsed.votes[0].chamber, "legislature");
  assert.equal(parsed.votes[0].organizationId, "legiscan:chamber:NE:64");
});
