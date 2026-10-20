import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { MemoryEvidenceStore, type EvidenceStore } from "../lib/control-plane/evidence/store.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import { processRegisteredRoutineCandidate } from "../lib/civic-data/promotion.ts";
import { createVotePageSink, bindVotePageVault, readVotePages, votePagesIssue, votePageVault, type VotePageProjection } from "../lib/state-rollcalls/vote-pages.ts";
import { parsePluralBulkSession } from "../lib/sources/plural/vote-bulk.ts";
import { pluralVotesCandidate, pluralVotesContract, readPluralVotesForPerson } from "../lib/sources/plural/votes.ts";

const root = new URL("./fixtures/state-votes/openstates/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const sample = manifest.states.find((row: { state: string }) => row.state === "WA");
const archive = await readFile(new URL(sample.fixtureArchive, root));
const evidence = { requestedUrl: sample.sourceUrl, finalUrl: sample.sourceUrl, retrievedAt: manifest.capturedAt,
  body: "", sha256: createHash("sha256").update(archive).digest("hex") };
const original = (await parsePluralBulkSession("WA", sample.session, archive, evidence)).votes[0];
const native = (index: number) => `ocd-vote/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const sinkFor = (vault: EvidenceStore, prior: VotePageProjection | null = null) => createVotePageSink({
  state: "WA", sourceId: "plural-openstates-votes", vault, prior, signal: AbortSignal.timeout(20_000),
});

test("hosted readers use the existing site store with Netlify's injected context", () => {
  const provider = process.env.WTP_VAULT_PROVIDER, context = process.env.NETLIFY_BLOBS_CONTEXT;
  try {
    delete process.env.WTP_VAULT_PROVIDER;
    process.env.NETLIFY_BLOBS_CONTEXT = Buffer.from(JSON.stringify({ siteID: "fixture-site", token: "fixture-token" })).toString("base64");
    const vault = votePageVault();
    assert.equal(typeof vault.get, "function");
    assert.equal(typeof vault.head, "function");
  } finally {
    if (provider === undefined) delete process.env.WTP_VAULT_PROVIDER; else process.env.WTP_VAULT_PROVIDER = provider;
    if (context === undefined) delete process.env.NETLIFY_BLOBS_CONTEXT; else process.env.NETLIFY_BLOBS_CONTEXT = context;
  }
});

test("legacy positions migrate to compact pages and the existing typed person reader returns their source facts", async () => {
  const vault = new MemoryEvidenceStore(), civicStore = new MemoryRoutineDataStore();
  const sink = await sinkFor(vault, { formatVersion: 1, state: "WA", rollCalls: [original] });
  try {
    const projection = await sink.snapshot();
    assert.equal(projection.formatVersion, 2);
    assert.deepEqual(projection.rollCalls[0].positions, []);
    assert.equal(projection.rollCalls[0].positionCount, original.positions.length);
    assert.equal(projection.rollCalls[0].firstPersonId, original.positions.map(row => row.personId).sort()[0]);
    assert.equal(votePagesIssue(projection), null);
    bindVotePageVault(civicStore, vault);
    const { body: _body, ...acquisition } = evidence;
    const candidate = pluralVotesCandidate({ projection, acquired: [acquisition], held: [], checkedAt: evidence.retrievedAt });
    const outcome = await processRegisteredRoutineCandidate(civicStore, pluralVotesContract("WA"), candidate, evidence.retrievedAt);
    assert.ok(outcome.promoted);
    const rows = await readPluralVotesForPerson("WA", sample.readerExample.personId, { store: civicStore, bypassCache: true, now: evidence.retrievedAt });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].position, sample.readerExample.position);
    assert.equal(rows[0].billTitle, original.billTitle);
    assert.equal(rows[0].motion, original.motion);
    assert.equal(rows[0].result, original.result);
    assert.deepEqual(rows[0].sourceUrls, original.sourceUrls);
  } finally { await sink.close(); }
});

test("unchanged pages retain their keys while a partial current vote preserves missing positions and history", async () => {
  const vault = new MemoryEvidenceStore();
  const history = { ...original, id: native(1), session: "2023-2024" };
  const first = await sinkFor(vault, { formatVersion: 1, state: "WA", rollCalls: [history, original] });
  let prior: VotePageProjection;
  try { prior = await first.snapshot(); } finally { await first.close(); }
  const unchanged = await sinkFor(vault, prior!);
  try { await unchanged.put(original); assert.deepEqual(await unchanged.snapshot(), prior!); }
  finally { await unchanged.close(); }
  const next = await sinkFor(vault, prior!);
  try {
    const updatedAt = "2026-10-21T00:00:00.000Z", [person, missing] = original.positions;
    assert.equal(await next.put({ ...original, retrievedAt: updatedAt,
      positions: [{ ...person, option: "paired", retrievedAt: updatedAt }], unresolvedPositions: 1 }), null);
    const projection = await next.snapshot();
    assert.deepEqual(projection.memberPages!.filter(page => page.session === history.session), prior!.memberPages!.filter(page => page.session === history.session));
    const read = await readVotePages(vault, projection, person.personId);
    assert.equal(read.find(vote => vote.id === original.id)!.positions[0].option, "paired");
    assert.ok(read.some(vote => vote.id === history.id));
    const held = (await readVotePages(vault, projection, missing.personId)).find(vote => vote.id === original.id)!;
    assert.equal(held.positions[0].option, missing.option);
    assert.equal(held.positions[0].retrievedAt, missing.retrievedAt);
    assert.equal(projection.rollCalls.find(vote => vote.id === original.id)!.positionCount, original.positions.length);
  } finally { await next.close(); }
});

test("a recycled native roll ID holds only that conflicting fact and preserves neighboring source votes", async () => {
  const vault = new MemoryEvidenceStore(), sink = await sinkFor(vault);
  try {
    await sink.put(original);
    const issue = await sink.put({ ...original, billId: "ocd-bill/00000000-0000-4000-8000-000000000999" });
    assert.match(issue!, /changed its bill, session or chamber identity/);
    const neighbor = { ...original, id: native(2) };
    assert.equal(await sink.put(neighbor), null);
    const projection = await sink.snapshot();
    assert.equal(projection.rollCalls.length, 2);
    assert.equal(projection.rollCalls.find(vote => vote.id === original.id)!.billId, original.billId);
    assert.equal((await readVotePages(vault, projection, original.positions[0].personId)).length, 2);
  } finally { await sink.close(); }
});

test("member pages bound row and byte sizes and the cold reader fetches only its person with four concurrent reads", async () => {
  const vault = new MemoryEvidenceStore(), sink = await sinkFor(vault), person = original.positions[0];
  try {
    for (let index = 0; index < 4_100; index++) await sink.put({ ...original, id: native(index + 10), positions: [person] });
    const projection = await sink.snapshot();
    assert.equal(projection.memberPages!.length, 5);
    assert.ok(projection.memberPages!.every(page => page.count <= 1024));
    for (const page of projection.memberPages!) assert.ok((await vault.head(page.key))!.byteLength <= 2 * 1024 * 1024);
    let active = 0, peak = 0;
    const readerVault: EvidenceStore = { ...vault, put: vault.put.bind(vault), head: vault.head.bind(vault), list: vault.list.bind(vault),
      get: async key => {
        assert.ok(key.includes(person.personId.slice(11)));
        active++; peak = Math.max(peak, active);
        try { await new Promise<void>(resolve => setImmediate(resolve)); return await vault.get(key); }
        finally { active--; }
      },
    };
    assert.equal((await readVotePages(readerVault, projection, person.personId)).length, 4_100);
    assert.equal(peak, 4);
  } finally { await sink.close(); }
  const byteBound = await sinkFor(vault);
  try {
    for (let index = 0; index < 120; index++) await byteBound.put({ ...original, id: native(index + 5_000),
      billTitle: "A".repeat(30_000), positions: [person] });
    const projection = await byteBound.snapshot();
    assert.equal(projection.memberPages!.length, 2);
    for (const page of projection.memberPages!) assert.ok((await vault.head(page.key))!.byteLength <= 2 * 1024 * 1024);
  } finally { await byteBound.close(); }
});

test("missing immutable pages and changed roll metadata fail the exact person read", async () => {
  const vault = new MemoryEvidenceStore(), sink = await sinkFor(vault);
  try {
    await sink.put(original); const projection = await sink.snapshot();
    const changed = structuredClone(projection); changed.rollCalls[0].billTitle = "unverified title";
    await assert.rejects(readVotePages(vault, changed, original.positions[0].personId), /VOTE_PAGE_ROLL_MISMATCH/);
    await assert.rejects(readVotePages(new MemoryEvidenceStore(), projection, original.positions[0].personId), /VOTE_PAGE_EVIDENCE_INVALID/);
    const incomplete = structuredClone(projection); incomplete.memberPages!.pop();
    assert.equal(votePagesIssue(incomplete), "VOTE_PAGE_POSITION_TOTAL_INVALID");
  } finally { await sink.close(); }
});
