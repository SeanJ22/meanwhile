import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/positions/[subject]/[topic]/route.ts";
import { readerPositionsFor, type ReaderPositionAnswer } from "../lib/corpus/reader-positions.ts";
import { positionsFor, searchTerms } from "../lib/corpus/positions.ts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { documentsFor, failuresFor } from "../lib/candidates/positions.ts";
import { statementEvidenceFor } from "../lib/ask/statements.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

test("every held statement identity bridge gives the Positions API the same complete answer from each current person/card identity", async () => {
  const corpus = unifiedCorpus();
  const groups = new Map<string, { keys: string[]; subjectId: string; topic: string }>();
  for (const snapshot of corpus.snapshots.filter((snapshot) => snapshot.extraction === "ok" && snapshot.text)) {
    const keys = readerPersonKeys(snapshot.subjectId).keys;
    if (keys.length < 2 || groups.has(keys.join("|"))) continue;
    const topic = [...new Set(searchTerms(snapshot.text!))].find((word) => positionsFor(snapshot.subjectId, word, corpus).passages.some((passage) => passage.snapshotId === snapshot.id));
    if (topic) groups.set(keys.join("|"), { keys, subjectId: snapshot.subjectId, topic });
  }
  assert.ok(groups.size >= 10);
  for (const { keys, subjectId, topic } of groups.values()) {
    const expected = readerPositionsFor(subjectId, topic, corpus);
    assert.ok(expected.passages.length > 0);
    for (const key of keys) {
      const response = await GET(new Request("https://wtp.test/api/positions"), { params: Promise.resolve({ subject: encodeURIComponent(key), topic }) });
      assert.equal(response.status, 200, key);
      const payload = await response.json() as ReaderPositionAnswer & { totalMatches: number };
      assert.deepEqual(payload.canonicalSubjectKeys, expected.canonicalSubjectKeys, key);
      assert.deepEqual(payload.passages, expected.passages, key);
      assert.deepEqual(payload.searched, expected.searched, key);
      assert.equal(payload.totalMatches, payload.passages.length, key);
      assert.deepEqual(documentsFor(key).map((document) => document.id), documentsFor(subjectId).map((document) => document.id));
      assert.deepEqual(failuresFor(key), failuresFor(subjectId));
    }
  }
});

test("Hobbs map, ballot and Ask use the held Governor passage while a foreign supplied key cannot supply it", () => {
  const official = "statewide:az/governor";
  const card = "ballot-az-pima:governor|Katie Hobbs";
  assert.equal(positionsFor(official, "Governor", unifiedCorpus()).passages.length, 0, "measured old exact-ID seam");
  const expected = readerPositionsFor(card, "Governor");
  assert.ok(expected.passages.length > 0);
  assert.deepEqual(readerPositionsFor(official, "Governor"), expected);
  const answer = statementEvidenceFor({ kind: "PERSON", id: official, name: "Katie Hobbs" }, "What does Katie Hobbs say about Governor?", ["unresolved:other-person"]);
  assert.equal(answer.records.length, expected.passages.length);
  for (const passage of expected.passages) assert.ok(answer.records.some((record) => record.id === passage.snapshotId && record.text.includes(passage.quote) && record.sourceUrl === passage.url && record.retrievedAt === passage.retrievedAt));
  assert.equal(readerPositionsFor("unresolved:former-candidate", "Governor").passages.length, 0);
  const unknown = statementEvidenceFor({ kind: "PERSON", id: "unresolved:former-candidate", name: "Katie Hobbs" }, "What does Katie Hobbs say about Governor?", [official, card]);
  assert.equal(unknown.records.length, 0, "an external alias hint cannot override the committed identity graph");
});
