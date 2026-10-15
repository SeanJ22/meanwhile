import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { acquireStateVotes } from "../lib/sources/plural/vote-acquisition.ts";
import { pluralVoteJurisdiction, pluralVotesScope, mergePluralVotes, parsePluralBill, readPluralVotesForPerson, type PluralBillEvidence, type PluralVoteAcquisition } from "../lib/sources/plural/votes.ts";
import { readRawCaptureText } from "../lib/civic-data/raw-capture-vault.ts";
import { refreshStateVotes } from "../scripts/openstates-votes-refresh.mts";

const AT = "2026-10-01T12:00:00.000Z";
const native = (kind: string, value: number) => `ocd-${kind}/00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const person = native("person", 1), other = native("person", 2);
function vote(value: number, overrides: Record<string, unknown> = {}) {
  return { id: native("vote", value), organization: { id: native("organization", 1), classification: "lower" },
    start_date: "2026-04-01", legislative_session: "57th-2nd-regular", motion_text: "Third reading", result: "pass",
    counts: [{ option: "yes", value: 31 }, { option: "no", value: 20 }],
    votes: [{ voter_id: person, option: "yes" }, { voter_id: other, option: "no" }],
    sources: [{ url: "https://www.azleg.gov/legtext/57leg/2R/bills/hb1001p.pdf" }], ...overrides };
}
function evidence(value = 1, votes: unknown[] = [vote(value)], session = "57th-2nd-regular"): PluralBillEvidence {
  const body = JSON.stringify({ id: native("bill", value), identifier: `HB ${1000 + value}`, title: "A sourced bill title",
    jurisdiction: { id: pluralVoteJurisdiction("az") }, session, votes });
  const url = `https://v3.openstates.org/bills/${native("bill", value)}?include=votes`;
  return { requestedUrl: url, finalUrl: url, body, retrievedAt: AT, sha256: createHash("sha256").update(body).digest("hex") };
}
test("native votes publish independently with literal labels, exact people and source sessions", () => {
  const source = evidence(1, [vote(1), vote(2, { votes: [{ voter_id: null, option: "yes" }] }),
    vote(3, { votes: [{ voter_id: person, option: "paired" }, { voter_id: null, option: "yes" }] }),
    vote(4, { start_date: "2027-01-01" })]);
  const parsed = parsePluralBill("az", source);
  assert.equal(parsed.votes.length, 2); assert.equal(parsed.held.length, 2);
  assert.equal(parsed.votes[1].positions[0].option, "paired");
  assert.equal(parsed.votes[1].unresolvedPositions, 1);
  assert.deepEqual(parsed.votes[0].counts, [{ option: "yes", value: 31 }, { option: "no", value: 20 }]);
  assert.equal(parsed.votes[0].session, "57th-2nd-regular");
  assert.equal(parsed.votes[0].positions[0].retrievedAt, AT);
  assert.throws(() => parsePluralBill("az", { ...source, finalUrl: source.finalUrl.replace("000000000001", "000000000002") }), /ROUTE_IDENTITY/);
});
test("a partial newer native vote preserves earlier exact positions and old sessions", () => {
  const old = parsePluralBill("az", evidence()).votes[0];
  const nextAt = "2026-10-10T12:00:00.000Z";
  const partial = { ...old, retrievedAt: nextAt, positions: [{ personId: person, option: "no", retrievedAt: nextAt }], unresolvedPositions: 1 };
  const projection = mergePluralVotes("az", mergePluralVotes("az", null, [old]), [partial]);
  assert.equal(projection.rollCalls[0].positions.find(row => row.personId === other)?.retrievedAt, AT);
  assert.equal(projection.rollCalls[0].positions.find(row => row.personId === person)?.option, "no");
  const nextSession = parsePluralBill("az", evidence(2, [vote(2, { legislative_session: "58th-1st-regular" })], "58th-1st-regular")).votes;
  assert.equal(mergePluralVotes("az", projection, nextSession).rollCalls.length, 2);
});
test("repeated native vote or person IDs cannot silently overwrite acquired evidence", () => {
  assert.equal(parsePluralBill("az", evidence(1, [vote(1), vote(1)])).votes.length, 0);
  assert.equal(parsePluralBill("az", evidence(1, [vote(1, { votes: [{ voter_id: person, option: "yes" }, { voter_id: person, option: "no" }] })])).votes.length, 0);
});
function harness() {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const requested: string[] = [];
  let failFirst = false;
  const fetchImpl: typeof fetch = async (raw, init) => {
    const url = String(raw); requested.push(url);
    if (url.includes("/data/session-csv/")) return new Response("<html>Session CSV</html>");
    assert.equal(new Headers(init?.headers).get("X-API-KEY"), "held-test-key");
    assert.doesNotMatch(url, /key|token|secret/i);
    const endpoint = new URL(url);
    if (endpoint.pathname.startsWith("/jurisdictions/")) return new Response(JSON.stringify({ id: pluralVoteJurisdiction("az"), legislative_sessions: [{identifier: "57th-2nd-regular", start_date: "2026-01-01", classification: "primary", downloads: []}] }));
    if (!endpoint.pathname.startsWith("/bills/")) return new Response(JSON.stringify({ pagination: {max_page:1}, results: [1, 2].map(value => ({ id: native("bill", value), jurisdiction: { id: pluralVoteJurisdiction("az") } })) }));
    const value = url.includes("000000000001") ? 1 : 2;
    if (failFirst && value === 1) return new Response("unavailable", { status: 503 });
    return new Response(evidence(value).body);
  };
  return { input: { state: "az", store, locks, vault: new MemoryEvidenceStore(), fetchImpl, apiKey: "held-test-key", now: () => AT, signal: AbortSignal.timeout(10_000) }, requested, failFirst: () => { failFirst = true; } };
}
test("known cached bill evidence reuses original source observations and one bad bill leaves the next fact available", async () => {
  const h = harness(); h.failFirst();
  const first = await acquireStateVotes(h.input);
  assert.equal(first.results.length, 1); assert.equal(first.held.length, 1);
  const priorRequests = h.requested.length;
  const replay = await acquireStateVotes(h.input);
  assert.equal(replay.results[0].evidence.retrievedAt, AT);
  assert.equal(replay.results[0].evidence.sourceCheck?.checkedAt, AT);
  assert.equal(h.requested.length, priorRequests + 1, "only the unavailable bill remains due");
});
test("the source writer publishes a native vote before the next bill request and typed reader needs no roster or global marker", async () => {
  const h = harness(), civicStore = new MemoryRoutineDataStore();
  let publications = 0;
  const result = await refreshStateVotes({ ...h.input, civicStore, onBill: async () => {
    publications++; assert.ok(await civicStore.readPromotion("STATE_ROLL_CALL", pluralVotesScope("az")));
    assert.equal(h.requested.length, publications + 3);
  } });
  assert.equal(publications, 2); assert.ok(result.publication.outcome.promoted);
  const rows = await readPluralVotesForPerson("az", person, { store: civicStore, bypassCache: true, now: AT });
  assert.equal(rows.length, 2); assert.equal(rows[0].position, "yes");
  assert.deepEqual(await readPluralVotesForPerson("az", "az-legislature:1", { store: civicStore, now: AT }), []);
});

test("each vote candidate holds a raw-capture reference, never the bill bytes, and the vault returns them exactly", async () => {
  const h = harness(), civicStore = new MemoryRoutineDataStore(), held: PluralVoteAcquisition[][] = [];
  const result = await refreshStateVotes({ ...h.input, civicStore, onBill: async () => {
    const saved = await civicStore.readCandidate((await civicStore.readPromotion("STATE_ROLL_CALL", pluralVotesScope("az")))!.versionId);
    held.push((saved!.candidate.normalizedPayload as { acquisitions: PluralVoteAcquisition[] }).acquisitions);
  } });
  assert.ok(result.publication.outcome.promoted); assert.equal(held.length, 2);
  for (const [index, [acquisition]] of held.entries()) {
    const body = evidence(index + 1).body;
    assert.equal("body" in acquisition, false); assert.equal(acquisition.raw?.rawHash, acquisition.sha256);
    assert.equal(await readRawCaptureText(h.input.vault, acquisition.raw!), body);
  }
});

test("a source check with no votes succeeds, then confirms the held empty projection unchanged", async () => {
  const h = harness(), civicStore = new MemoryRoutineDataStore();
  const transport = h.input.fetchImpl;
  const fetchImpl: typeof fetch = async (raw, init) => {
    if (new URL(String(raw)).pathname === "/bills") return new Response(JSON.stringify({ results: [], pagination: {max_page: 0} }));
    return transport(raw, init);
  };
  const first = await refreshStateVotes({...h.input, civicStore, fetchImpl});
  assert.ok(first.publication.outcome.promoted);
  assert.deepEqual((first.publication.candidate.readModel as {rollCalls:unknown[]}).rollCalls, []);
  const next = await refreshStateVotes({...h.input, civicStore, fetchImpl});
  assert.ok(next.publication.outcome.confirmed);
  assert.equal(next.publication.outcome.confirmed.versionId, first.publication.outcome.promoted.versionId);
  assert.equal(next.held.length, 0);
});
test("a conflicting native person never hides other independently verified positions", () => {
  const parsed = parsePluralBill("az", evidence(1, [vote(1, {votes: [
    {voter_id:person,option:"yes"}, {voter_id:person,option:"no"}, {voter_id:other,option:"paired"},
  ]})]));
  assert.equal(parsed.votes.length, 1);
  assert.deepEqual(parsed.votes[0].positions.map(row => [row.personId,row.option]), [[other,"paired"]]);
  assert.equal(parsed.votes[0].unresolvedPositions, 2);
  assert.equal(parsed.held.length, 1);
});
