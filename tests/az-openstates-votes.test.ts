import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { acquireArizonaVotes } from "../lib/sources/plural/vote-acquisition.ts";
import { AZ_PLURAL_JURISDICTION, AZ_PLURAL_VOTES_SCOPE, mergeArizonaPluralVotes, parseArizonaPluralBill, readArizonaPluralVotesForPerson, type PluralBillEvidence } from "../lib/sources/plural/votes.ts";
import { refreshArizonaVotes } from "../scripts/az-votes-refresh.mts";

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
    jurisdiction: { id: AZ_PLURAL_JURISDICTION }, session, votes });
  const url = `https://v3.openstates.org/bills/${native("bill", value)}?include=votes`;
  return { requestedUrl: url, finalUrl: url, body, retrievedAt: AT, sha256: createHash("sha256").update(body).digest("hex") };
}
test("native votes publish independently with literal labels, exact people and source sessions", () => {
  const source = evidence(1, [vote(1), vote(2, { votes: [{ voter_id: null, option: "yes" }] }),
    vote(3, { votes: [{ voter_id: person, option: "paired" }, { voter_id: null, option: "yes" }] }),
    vote(4, { start_date: "2027-01-01" })]);
  const parsed = parseArizonaPluralBill(source);
  assert.equal(parsed.votes.length, 2); assert.equal(parsed.held.length, 2);
  assert.equal(parsed.votes[1].positions[0].option, "paired");
  assert.equal(parsed.votes[1].unresolvedPositions, 1);
  assert.deepEqual(parsed.votes[0].counts, [{ option: "yes", value: 31 }, { option: "no", value: 20 }]);
  assert.equal(parsed.votes[0].session, "57th-2nd-regular");
  assert.equal(parsed.votes[0].positions[0].retrievedAt, AT);
  assert.throws(() => parseArizonaPluralBill({ ...source, finalUrl: source.finalUrl.replace("000000000001", "000000000002") }), /ROUTE_IDENTITY/);
});
test("a partial newer native vote preserves earlier exact positions and old sessions", () => {
  const old = parseArizonaPluralBill(evidence()).votes[0];
  const nextAt = "2026-10-10T12:00:00.000Z";
  const partial = { ...old, retrievedAt: nextAt, positions: [{ personId: person, option: "no", retrievedAt: nextAt }], unresolvedPositions: 1 };
  const projection = mergeArizonaPluralVotes(mergeArizonaPluralVotes(null, [old]), [partial]);
  assert.equal(projection.rollCalls[0].positions.find(row => row.personId === other)?.retrievedAt, AT);
  assert.equal(projection.rollCalls[0].positions.find(row => row.personId === person)?.option, "no");
  const nextSession = parseArizonaPluralBill(evidence(2, [vote(2, { legislative_session: "58th-1st-regular" })], "58th-1st-regular")).votes;
  assert.equal(mergeArizonaPluralVotes(projection, nextSession).rollCalls.length, 2);
});
test("repeated native vote or person IDs cannot silently overwrite acquired evidence", () => {
  assert.equal(parseArizonaPluralBill(evidence(1, [vote(1), vote(1)])).votes.length, 0);
  assert.equal(parseArizonaPluralBill(evidence(1, [vote(1, { votes: [{ voter_id: person, option: "yes" }, { voter_id: person, option: "no" }] })])).votes.length, 0);
});
function harness() {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories();
  const requested: string[] = [];
  let failFirst = false;
  const fetchImpl: typeof fetch = async (raw, init) => {
    const url = String(raw); requested.push(url);
    assert.equal(new Headers(init?.headers).get("X-API-KEY"), "held-test-key");
    assert.doesNotMatch(url, /key|token|secret/i);
    const endpoint = new URL(url);
    if (!endpoint.pathname.startsWith("/bills/")) return new Response(JSON.stringify({ results: [1, 2].map(value => ({ id: native("bill", value), jurisdiction: { id: AZ_PLURAL_JURISDICTION } })) }));
    const value = url.includes("000000000001") ? 1 : 2;
    if (failFirst && value === 1) return new Response("unavailable", { status: 503 });
    return new Response(evidence(value).body);
  };
  return { input: { store, locks, fetchImpl, apiKey: "held-test-key", now: () => AT, signal: AbortSignal.timeout(10_000) }, requested, failFirst: () => { failFirst = true; } };
}
test("known cached bill evidence reuses original source observations and one bad bill leaves the next fact available", async () => {
  const h = harness(); h.failFirst();
  const first = await acquireArizonaVotes(h.input);
  assert.equal(first.results.length, 1); assert.equal(first.held.length, 1);
  const priorRequests = h.requested.length;
  const replay = await acquireArizonaVotes(h.input);
  assert.equal(replay.results[0].evidence.retrievedAt, AT);
  assert.equal(replay.results[0].evidence.sourceCheck?.checkedAt, AT);
  assert.equal(h.requested.length, priorRequests + 1, "only the unavailable bill remains due");
});
test("the source writer publishes a native vote before the next bill request and typed reader needs no roster or global marker", async () => {
  const h = harness(), civicStore = new MemoryRoutineDataStore();
  let publications = 0;
  const result = await refreshArizonaVotes({ ...h.input, civicStore, onBill: async () => {
    publications++; assert.ok(await civicStore.readPromotion("STATE_ROLL_CALL", AZ_PLURAL_VOTES_SCOPE));
    assert.equal(h.requested.length, publications + 1);
  } });
  assert.equal(publications, 2); assert.ok(result.publication.outcome.promoted);
  const rows = await readArizonaPluralVotesForPerson(person, { store: civicStore, bypassCache: true, now: AT });
  assert.equal(rows.length, 2); assert.equal(rows[0].position, "yes");
  assert.deepEqual(await readArizonaPluralVotesForPerson("az-legislature:1", { store: civicStore, now: AT }), []);
});
