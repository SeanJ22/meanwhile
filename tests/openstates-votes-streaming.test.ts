import { parsePluralBulkSession } from "./helpers/state-vote-parsers.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { toCsv, zip } from "../scripts/xlsx.mjs";
import { parseCsv } from "../lib/reference/csv.ts";
import { readZipEntries } from "../lib/sources/archive.ts";
import { parsePluralBulkSessionFile } from "../lib/sources/plural/vote-bulk.ts";
import type { PluralBillEvidence, PluralVoteFact } from "../lib/sources/plural/votes.ts";

const root = new URL("./fixtures/state-votes/openstates/", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
const sample = manifest.states.find((row: { state: string }) => row.state === "WA");
const original = await readFile(new URL(sample.fixtureArchive, root));
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const evidence = (bytes: Uint8Array): PluralBillEvidence => ({ requestedUrl: sample.sourceUrl, finalUrl: sample.sourceUrl,
  retrievedAt: manifest.capturedAt, body: "", sha256: hash(bytes) });
const neighborId = "ocd-vote/00000000-0000-4000-8000-000000000001";
function changedArchive(change: (suffix: string, rows: string[][]) => void): Buffer {
  return zip(readZipEntries(original).map(entry => {
    if (!entry.name.endsWith(".csv")) return entry;
    const data = parseCsv(entry.data.toString("utf8"));
    const suffix = entry.name.slice(entry.name.lastIndexOf("_", entry.name.length - 5) + 1, -4);
    change(entry.name.endsWith("_vote_people.csv") ? "people" : suffix, data);
    return { name: entry.name, data: Buffer.from(toCsv(data[0], data.slice(1))) };
  }), manifest.capturedAt.slice(0, 10));
}

test("file-backed Open States joins return the same sourced facts one roll at a time", async () => {
  const retained = await parsePluralBulkSession(sample.state, sample.session, original, evidence(original));
  const directory = await mkdtemp(join(tmpdir(), "vt01-openstates-test-"));
  try {
    const path = join(directory, "session.zip");
    await writeFile(path, original);
    const streamed: PluralVoteFact[] = [];
    const result = await parsePluralBulkSessionFile(sample.state, sample.session, path, evidence(original), {
      onVote: async vote => { streamed.push(vote); },
    });
    assert.deepEqual(streamed, retained.votes);
    assert.deepEqual(result.votes, [], "the producer retains no consumed roll or member positions");
    assert.equal(result.rollCalls, retained.votes.length);
    assert.equal(result.memberVotes, retained.votes.reduce((sum, vote) => sum + vote.positions.length, 0));
    assert.equal(result.unmatchedPositions, 0);
    assert.deepEqual(result.held, retained.held);
    assert.deepEqual(result.members, retained.members);
    await assert.rejects(parsePluralBulkSessionFile(sample.state, sample.session, path, { ...evidence(original), sha256: "0".repeat(64) }),
      /SOURCE_EVIDENCE_INVALID/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("publisher session names with spaces match their encoded archive URL and exact CSV identity", async () => {
  const session = "20252026 Special Session 1";
  const bytes = zip(readZipEntries(original).map(entry => ({
    name: entry.name.replaceAll(sample.session, session),
    data: Buffer.from(entry.data.toString("utf8").replaceAll(sample.session, session)),
  })), manifest.capturedAt.slice(0, 10));
  const url = new URL(sample.sourceUrl.replace(sample.session, session)).href;
  const result = await parsePluralBulkSession(sample.state, session, bytes, { ...evidence(bytes), requestedUrl: url, finalUrl: url });
  assert.equal(result.rollCalls, 1);
  assert.equal(result.votes[0].session, session);
  for (const invalid of ["../2026", "2026/regular", "2026\\regular", "2026\u0000regular", "..", " "]) {
    await assert.rejects(parsePluralBulkSession(sample.state, invalid, bytes, evidence(bytes)), /PLURAL_BULK_SESSION_INVALID/);
  }
});

test("Open States person conflicts and duplicate native rolls are isolated before streaming", async () => {
  const conflicting = changedArchive((suffix, data) => {
    if (suffix !== "people") return;
    const option = data[0].indexOf("option");
    const conflict = [...data[1]]; conflict[option] = conflict[option] === "yes" ? "no" : "yes";
    data.push(conflict, conflict);
  });
  const consumed: PluralVoteFact[] = [];
  const conflict = await parsePluralBulkSession(sample.state, sample.session, conflicting, evidence(conflicting), {
    onVote: async vote => { consumed.push(vote); },
  });
  assert.equal(consumed.length, 1);
  assert.equal(consumed[0].positions.some(row => row.personId === sample.readerExample.personId), false);
  assert.equal(consumed[0].unresolvedPositions, 1, "one contradictory person is counted once");
  assert.equal(conflict.unmatchedPositions, 1);
  assert.equal(conflict.held.filter(row => row.key.endsWith(sample.readerExample.personId)).length, 1);

  const duplicate = changedArchive((suffix, data) => {
    if (suffix === "votes") {
      const id = data[0].indexOf("id"), neighbor = [...data[1]]; neighbor[id] = neighborId;
      data.push([...data[1]], neighbor);
    }
    if (suffix === "people") {
      const voteId = data[0].indexOf("vote_event_id"), neighbor = [...data[1]]; neighbor[voteId] = neighborId;
      data.push(neighbor);
    }
  });
  const ids: string[] = [];
  const result = await parsePluralBulkSession(sample.state, sample.session, duplicate, evidence(duplicate), {
    onVote: async vote => { ids.push(vote.id); },
  });
  assert.deepEqual(ids, [neighborId], "both copies of the ambiguous roll are withheld while a neighboring fact publishes");
  assert.equal(result.rollCalls, 1);
  assert.equal(result.memberVotes, 1);
  assert.ok(result.held.some(row => row.key === sample.readerExample.voteId));
});

test("Open States streaming waits for publication and propagates its error", async () => {
  const bytes = changedArchive((suffix, data) => {
    if (suffix === "votes") { const neighbor = [...data[1]]; neighbor[data[0].indexOf("id")] = neighborId; data.push(neighbor); }
    if (suffix === "people") { const neighbor = [...data[1]]; neighbor[data[0].indexOf("vote_event_id")] = neighborId; data.push(neighbor); }
  });
  let resume!: () => void, entered!: () => void;
  const pause = new Promise<void>(resolve => { resume = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const ids: string[] = [];
  const pending = parsePluralBulkSession(sample.state, sample.session, bytes, evidence(bytes), { onVote: async vote => {
    ids.push(vote.id); if (ids.length === 1) { entered(); await pause; }
  } });
  await started;
  assert.deepEqual(ids, [sample.readerExample.voteId]);
  resume();
  assert.equal((await pending).rollCalls, 2);
  assert.deepEqual(ids, [sample.readerExample.voteId, neighborId]);
  const failure = new Error("test durable publication failed");
  let attempts = 0;
  await assert.rejects(parsePluralBulkSession(sample.state, sample.session, bytes, evidence(bytes), {
    onVote: async () => { attempts++; throw failure; },
  }), error => error === failure);
  assert.equal(attempts, 1);
});
