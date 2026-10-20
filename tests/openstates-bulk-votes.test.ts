import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MemoryEvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { acquireStateVotes, currentPluralSessions, PLURAL_SESSION_CATALOG, pluralJurisdictionsUrl } from "../lib/sources/plural/vote-acquisition.ts";
import { parsePluralBulkSession } from "../lib/sources/plural/vote-bulk.ts";
import { parsePluralBill, pluralVoteJurisdiction, pluralVotesScope, readPluralVotesForPerson, type PluralBillEvidence, type PluralVoteAcquisition } from "../lib/sources/plural/votes.ts";
import { refreshStateVotes } from "../scripts/openstates-votes-refresh.mts";

interface Example { personId: string; position: string; billNumber: string; billTitle: string; date: string; voteId: string }
interface Sample { state: string; session: string; sourceUrl: string; fixtureArchive: string; fixtureArchiveSha256: string; metadataFixture: string; readerExample?: Example }
const ROOT = new URL("./fixtures/state-votes/openstates/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", ROOT), "utf8")) as {
  capturedAt: string; states: Sample[]; apiBillSamples: { path: string; sourceUrl: string; sha256: string; memberPositions: number; rollCallCount: number }[];
};
const hash = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const sourceEvidence = (sample: Sample, bytes: Uint8Array): PluralBillEvidence => ({
  requestedUrl: sample.sourceUrl, finalUrl: sample.sourceUrl, body: "", retrievedAt: manifest.capturedAt, sha256: hash(bytes),
});

/** The replay retains one actual session record from the captured metadata.
 * Native IDs, labels, public archive URL and every CSV field remain sourced. */
async function harness(sample: Sample) {
  const store = new MemoryEvidenceStore(), { locks } = createMemoryRepositories(), civicStore = new MemoryRoutineDataStore();
  const zip = await readFile(new URL(sample.fixtureArchive, ROOT));
  const metadata = JSON.parse(await readFile(new URL(sample.metadataFixture, ROOT), "utf8")) as { legislative_sessions: { identifier: string }[] };
  const body = JSON.stringify({ results: [{ ...metadata, legislative_sessions: metadata.legislative_sessions.filter(session => session.identifier === sample.session) }], pagination: { max_page: 1 } });
  const catalog = await readFile(new URL("session-csv-catalog.html", ROOT));
  const requests: string[] = [];
  let checkedAt = manifest.capturedAt;
  const fetchImpl: typeof fetch = async (raw, init) => {
    const url = String(raw); requests.push(url);
    const headers = new Headers(init?.headers);
    if (url === PLURAL_SESSION_CATALOG) {
      assert.equal(headers.get("X-API-KEY"), null);
      return headers.has("if-none-match") ? new Response(null, { status: 304 }) : new Response(catalog, { headers: { etag: "fixture-catalog" } });
    }
    if (url === pluralJurisdictionsUrl(1)) {
      assert.equal(headers.get("X-API-KEY"), "fixture-key");
      return headers.has("if-none-match") ? new Response(null, { status: 304 }) : new Response(body, { headers: { etag: "fixture-metadata" } });
    }
    if (url === sample.sourceUrl) {
      assert.equal(headers.get("X-API-KEY"), null, "public session archive reads use no API key");
      return headers.has("if-none-match") ? new Response(null, { status: 304 }) : new Response(zip, { headers: { etag: sample.fixtureArchiveSha256, "content-type": "application/zip" } });
    }
    throw new Error(`unexpected fixture request: ${url}`);
  };
  return { zip, civicStore, requests,
    input: { state: sample.state, store, locks, civicStore, vault: new MemoryEvidenceStore(), apiKey: "fixture-key", fetchImpl, signal: AbortSignal.timeout(10_000), now: () => checkedAt },
    nextCheck: () => { checkedAt = new Date(Date.parse(checkedAt) + 86_400_001).toISOString(); },
  };
}

for (const sample of manifest.states.filter(sample => sample.readerExample)) {
  test(`${sample.state}: real public CSV session promotes exact senator votes and a 304 check preserves them`, async () => {
    const h = await harness(sample), example = sample.readerExample!;
    assert.equal(hash(h.zip), sample.fixtureArchiveSha256);
    let published = 0;
    const first = await refreshStateVotes({ ...h.input, onBill: async result => {
      published++;
      assert.equal(h.requests.at(-1), sample.sourceUrl);
      assert.equal(result.votes.length, 1);
    } });
    assert.equal(published, 1);
    assert.ok(first.publication.outcome.promoted);
    assert.equal((first.publication.candidate.readModel as { formatVersion: number }).formatVersion, 2);
    assert.ok(await h.civicStore.readPromotion("STATE_ROLL_CALL", pluralVotesScope(sample.state)));
    const [archive] = (first.publication.candidate.normalizedPayload as { acquisitions: PluralVoteAcquisition[] }).acquisitions;
    assert.equal("body" in archive, false); assert.equal(archive.sha256, sample.fixtureArchiveSha256);
    if (sample.state === "GA") {
      assert.deepEqual(first.held, [{ key: `${example.voteId}:ocd-person/546d682f-b256-4060-8fd3-084d7f118d43`, detail: "the native person has conflicting publisher positions" }]);
      assert.deepEqual(await readPluralVotesForPerson(sample.state, "ocd-person/546d682f-b256-4060-8fd3-084d7f118d43", { store: h.civicStore, bypassCache: true, now: h.input.now() }), []);
    } else assert.deepEqual(first.held, []);
    const rows = await readPluralVotesForPerson(sample.state, example.personId, { store: h.civicStore, bypassCache: true, now: h.input.now() });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, example.voteId);
    assert.equal(rows[0].position, example.position);
    assert.equal(rows[0].billNumber, example.billNumber);
    assert.equal(rows[0].billTitle, example.billTitle);
    assert.equal(rows[0].date, example.date);
    assert.equal(rows[0].sourceApiUrl, sample.sourceUrl);
    if (sample.state !== "GA") assert.ok(rows[0].sourceUrls.length, "the publisher's original HTTPS source links survive");
    // Georgia supplies only its HTTP SOAP service WSDL as a vote source. The
    // original row remains in the archive and the public bulk URL cites the vote.
    const version = first.publication.outcome.promoted!.versionId;
    h.nextCheck();
    const unchanged = await refreshStateVotes(h.input);
    assert.ok(unchanged.publication.outcome.confirmed, "no new votes is a successful unchanged check");
    assert.equal(unchanged.publication.outcome.confirmed!.versionId, version);
    assert.deepEqual(unchanged.held, first.held);
    assert.deepEqual(await readPluralVotesForPerson(sample.state, example.personId, { store: h.civicStore, bypassCache: true, now: h.input.now() }), rows);
  });
}

test("NJ: the actual current archive omits vote files and checks successfully with no invented roll calls", async () => {
  const sample = manifest.states.find(sample => sample.state === "NJ")!, h = await harness(sample);
  const parsed = await parsePluralBulkSession(sample.state, sample.session, h.zip, sourceEvidence(sample, h.zip));
  assert.deepEqual(parsed.votes, []); assert.deepEqual(parsed.held, []);
  const first = await refreshStateVotes(h.input);
  assert.ok(first.publication.outcome.promoted);
  h.nextCheck();
  const next = await refreshStateVotes(h.input);
  assert.ok(next.publication.outcome.confirmed);
  assert.deepEqual(next.held, []);
});

test("real API v3 fallback resolves nested voter IDs and counts-only responses publish no person positions", async () => {
  for (const sample of manifest.apiBillSamples) {
    const body = await readFile(new URL(sample.path, ROOT), "utf8");
    assert.equal(hash(body), sample.sha256);
    const parsed = parsePluralBill(sample.path.slice(0, 2), { requestedUrl: sample.sourceUrl, finalUrl: sample.sourceUrl,
      body, sha256: sample.sha256, retrievedAt: manifest.capturedAt });
    const count = parsed.votes.reduce((sum, vote) => sum + vote.positions.length, 0);
    assert.equal(count, sample.memberPositions);
    if (sample.memberPositions) assert.equal(parsed.votes.length, sample.rollCallCount);
    else { assert.deepEqual(parsed.votes, []); assert.equal(parsed.held.length, sample.rollCallCount); }
  }
});

test("an archive's state, session and original byte digest are required before votes can be parsed", async () => {
  const sample = manifest.states.find(sample => sample.state === "WA")!, bytes = await readFile(new URL(sample.fixtureArchive, ROOT));
  const evidence = sourceEvidence(sample, bytes);
  await assert.rejects(parsePluralBulkSession("IL", sample.session, bytes, evidence), /SOURCE_ROUTE_INVALID/);
  await assert.rejects(parsePluralBulkSession(sample.state, "different-session", bytes, evidence), /SOURCE_ROUTE_INVALID/);
  await assert.rejects(parsePluralBulkSession(sample.state, sample.session, bytes, { ...evidence, sha256: "0".repeat(64) }), /SOURCE_EVIDENCE_INVALID/);
  const damaged = Buffer.from(bytes); damaged[100] ^= 1;
  await assert.rejects(parsePluralBulkSession(sample.state, sample.session, damaged, { ...evidence, sha256: hash(damaged) }), /ZIP_INVALID/);
});

test("the real anonymous public catalog cannot invent archive URLs when no API key is available", async () => {
  const sample = manifest.states.find(sample => sample.state === "WA")!, h = await harness(sample);
  await assert.rejects(acquireStateVotes({ ...h.input, apiKey: "" }), /PUBLIC_SESSION_LINKS_UNAVAILABLE_AND_API_KEY_UNAVAILABLE/);
  assert.deepEqual(h.requests, [PLURAL_SESSION_CATALOG]);
});

test("current-session refresh skips the preceding cycle even when its archive is unavailable", async () => {
  const sample = manifest.states.find(sample => sample.state === "WA")!, h = await harness(sample);
  const metadata = JSON.parse(await readFile(new URL(sample.metadataFixture, ROOT), "utf8")) as {
    legislative_sessions: { identifier: string; downloads: { data_type: string; url: string }[] }[];
  };
  const previous = metadata.legislative_sessions.find(session => session.identifier === "2023-2024")!;
  const previousUrl = previous.downloads.find(download => download.data_type === "csv")!.url;
  const replay = h.input.fetchImpl, fallbackRequests: string[] = [];
  const fetchImpl: typeof fetch = async (raw, init) => {
    const url = String(raw);
    if (url === PLURAL_SESSION_CATALOG) return new Response(`<h1>Session CSV</h1><ul>
      <li><a href="${sample.sourceUrl}">current</a> updated 2026-10-12</li>
      <li><a href="${previousUrl}">previous</a> updated 2026-10-11</li></ul>`);
    if (url === pluralJurisdictionsUrl(1)) return new Response(JSON.stringify({ results: [{ ...metadata,
      legislative_sessions: metadata.legislative_sessions.filter(session => [sample.session, previous.identifier].includes(session.identifier)) }], pagination: { max_page: 1 } }));
    if (url === previousUrl) assert.fail("the preceding cycle must not be downloaded during a current-session run");
    if (url.startsWith("https://v3.openstates.org/bills?")) {
      fallbackRequests.push(url);
      assert.equal(new URL(url).searchParams.get("session"), previous.identifier);
      assert.equal(new Headers(init?.headers).get("X-API-KEY"), "fixture-key");
      return new Response(JSON.stringify({ results: [], pagination: { max_page: 0 } }));
    }
    return replay(raw, init);
  };
  const sessions: string[] = [];
  const acquired = await acquireStateVotes({ ...h.input, fetchImpl, onBill: async result => { sessions.push(result.votes[0]!.session); } });
  assert.equal(acquired.bills, 1);
  assert.deepEqual(sessions, [sample.session]);
  assert.equal(fallbackRequests.length, 0);
  assert.deepEqual(acquired.held, []);
});

test("two state runs share the national session catalog before downloading their own archives", async () => {
  const samples = ["WA", "AZ"].map(state => manifest.states.find(sample => sample.state === state)!);
  const h = await harness(samples[0]);
  const jurisdictions = await Promise.all(samples.map(async sample => {
    const metadata = JSON.parse(await readFile(new URL(sample.metadataFixture, ROOT), "utf8")) as { legislative_sessions: { identifier: string }[] };
    return { ...metadata, legislative_sessions: metadata.legislative_sessions.filter(row => row.identifier === sample.session) };
  }));
  const archives = new Map(await Promise.all(samples.map(async sample => [sample.sourceUrl, await readFile(new URL(sample.fixtureArchive, ROOT))] as const)));
  let catalogRequests = 0;
  const fetchImpl: typeof fetch = async (raw, init) => {
    const url = String(raw);
    if (url === PLURAL_SESSION_CATALOG) return new Response("<h1>Session CSV</h1>");
    if (url === pluralJurisdictionsUrl(1)) {
      catalogRequests++;
      assert.equal(new Headers(init?.headers).get("X-API-KEY"), "fixture-key");
      return new Response(JSON.stringify({ results: jurisdictions, pagination: { max_page: 1 } }));
    }
    const archive = archives.get(url);
    assert.ok(archive, `unexpected source request ${url}`);
    assert.equal(new Headers(init?.headers).get("X-API-KEY"), null);
    return new Response(archive);
  };
  for (const sample of samples) {
    const sessions: string[] = [];
    const acquired = await acquireStateVotes({ ...h.input, state: sample.state, fetchImpl, onBill: async result => {
      sessions.push(result.votes[0].session);
    } });
    assert.deepEqual(sessions, [sample.session]);
    assert.deepEqual(acquired.held, []);
  }
  assert.equal(catalogRequests, 1, "national metadata is shared rather than one quota request per state");
});

test("current cycles retain regular and special sessions despite missing classifications and backdated starts", () => {
  // Exact identifying fields from the publisher's live /jurisdictions catalog.
  // These cases cover its omitted classifications, special sessions labeled
  // primary, prefiled future sessions, and Mississippi's backdated 2026 start.
  const samples: { state: string; expected: string[]; rows: [string, string, string, string][] }[] = [
    { state: "TX", expected: ["89R", "891", "892"], rows: [
      ["89R", "89th Legislature (2025)", "regular", "2025-01-10"],
      ["891", "89th Legislature, 1st Called Session (2025)", "special", "2025-07-21"],
      ["892", "89th Legislature, 2nd Called Session (2025)", "special", "2025-08-18"],
    ] },
    { state: "VA", expected: ["2026", "2026S1"], rows: [
      ["2025", "2025 Regular Session", "", "2025-01-08"],
      ["2026", "2026 Regular Session", "", "2026-01-14"],
      ["2026S1", "2026, 1st Special Session", "", "2026-04-23"],
      ["2027", "2027 Regular Session", "", "2027-01-13"],
    ] },
    { state: "GA", expected: ["2025_26", "2026_ss"], rows: [
      ["2025_26", "2025-2026 Regular Session", "", "2025-01-13"],
      ["2026_ss", "2026 Special Session", "", "2026-06-17"],
    ] },
    { state: "MN", expected: ["2025-2026", "2025s1"], rows: [
      ["2025-2026", "2025-2026 Regular Session", "primary", "2025-01-14"],
      ["2025s1", "2025, First Special Session", "primary", "2025-06-08"],
      ["2027-2028", "2027-2028 Regular Session", "primary", "2027-01-12"],
    ] },
    { state: "MS", expected: ["2026", "20261E"], rows: [
      ["2026", "2026 Regular Session", "primary", "2025-01-06"],
      ["2025", "2025 Regular Session", "primary", "2025-01-07"],
      ["20251E", "2025 First Extraordinary Session", "special", "2025-05-28"],
      ["20261E", "2026 1st Extraordinary Session", "primary", "2026-07-14"],
    ] },
    { state: "CA", expected: ["20252026", "20252026 Special Session 1"], rows: [
      ["20232024 Special Session 2", "2023-2024, Special Session 2", "special", "2024-09-01"],
      ["20252026", "2025-2026 Regular Session", "primary", "2024-12-02"],
      ["20252026 Special Session 1", "2025-2026, Special Session 1", "special", "2024-12-02"],
    ] },
  ];
  for (const sample of samples) {
    const bytes = new TextEncoder().encode(JSON.stringify({ id: pluralVoteJurisdiction(sample.state),
      legislative_sessions: sample.rows.map(([identifier, name, classification, start_date]) => ({ identifier, name, classification, start_date })),
    }));
    assert.deepEqual(currentPluralSessions(bytes, sample.state, "2026-10-20T00:00:00Z").map(row => row.identifier).sort(), [...sample.expected].sort(), sample.state);
  }
});
