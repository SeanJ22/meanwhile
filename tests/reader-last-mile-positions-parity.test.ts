import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/positions/[subject]/[topic]/route.ts";
import { settlePositionHoldingAnswer } from "../app/api/positions/[subject]/[topic]/holdings.ts";
import { readerPositionsFor, type ReaderPositionAnswer } from "../lib/corpus/reader-positions.ts";
import { positionsFor, searchTerms } from "../lib/corpus/positions.ts";
import { unifiedCorpus, unifiedCorpusFromHoldings } from "../lib/corpus/unified.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { documentsFor, failuresFor } from "../lib/candidates/positions.ts";
import { statementEvidenceFor } from "../lib/ask/statements.ts";
import { answerFor, type CandidateCorpus, type CandidateDocument } from "../lib/candidates/corpus.ts";
import { createHash } from "node:crypto";
import { installAzBallot, installCandidateCorpus, installOfficeholderStatements, installRegistryAuthority, registryTransferImport, syntheticCandidateCorpus } from "./helpers/promoted-fixtures.ts";
import { servableAzBallot } from "./helpers/reader-fixtures.ts";

await installRegistryAuthority();
// The governor's certified card, reconciled to the governor's candidacy.
await installAzBallot(servableAzBallot([{
  id: "ballot-az-pima:governor",
  title: "Governor",
  candidacies: [{ id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" }],
  lineup: [{ name: "Katie Hobbs", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:hobbs-katie" }],
}]));
await installOfficeholderStatements();
/*
 * The synthetic publication corpus, plus one synthetic campaign page held under the governor's certified card
 * and one under each of twelve candidacies the registry's official-candidacy bridge resolves to a current
 * official, so each page is reachable from two identities.
 */
const page = (candidateKey: string, url: string, text: string): CandidateDocument => {
  const contentHash = createHash("sha256").update(text).digest("hex");
  return { id: `${candidateKey}@${contentHash}`, candidateKey, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED", metaDescription: null,
    documentUrl: url, contentHash, retrievedAt: "2026-09-20T00:00:00.000Z", contentType: "text/html", text, extraction: "html", extractionNote: null };
};
const bridged = registryTransferImport().projection.payload.officialCandidacies.rows
  .filter((row) => row.status === "RESOLVED" && row.candidacy && !row.candidacy.candidacyId.startsWith("ballot-az-")).slice(0, 12);
const base = syntheticCandidateCorpus();
const extra = [
  page("ballot-az-pima:governor|Katie Hobbs", "https://example.test/governor-card/",
    "As Governor I will keep every promise made to working families. This synthetic test page states what the campaign says the Governor will do, in words long enough to be held as a readable publication by the reader."),
  ...bridged.map((row, i) => page(row.candidacy!.candidacyId, `https://bridged-${i + 1}.example.test/`,
    `Synthetic test page ${i + 1}. Our libraries need longer hours and every reader deserves a library within walking distance. This page was written for a test and describes no real campaign; it is long enough to be held as a readable publication.`)),
];
await installCandidateCorpus({ ...base, attempted: base.attempted + extra.length, documents: [...base.documents, ...extra] });

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

test("verified person aliases search each exact captured source once while retaining genuine revision history", async () => {
  const official = "statewide:az/governor";
  const card = "ballot-az-pima:governor|Katie Hobbs";
  const unrelated = "unresolved:another-person";
  const keys = readerPersonKeys(official).keys;
  assert.ok(keys.includes(card), "the two fixture identities must be linked by held identity, not a supplied name");
  const url = "https://campaign.example/issues";
  const capture = (candidateKey: string, edition: number, text: string): CandidateDocument => ({
    id: `${candidateKey}@edition-${edition}`,
    candidateKey,
    sourceClass: "CAMPAIGN_SITE",
    basis: "HUNTED_AND_VERIFIED",
    metaDescription: null,
    documentUrl: url,
    contentHash: text,
    sourceContentHash: `raw-${edition}`,
    sourceRevision: {
      revisionId: `${candidateKey}-revision-${edition}`,
      artifactId: `ar-edition-${edition}`,
      canonicalUrl: url,
      rawContentHash: `raw-${edition}`,
      capturedAt: `2026-09-${20 + edition}T00:00:00.000Z`,
      extractionVersion: 2,
      supersedesRevisionId: edition > 1 ? `${candidateKey}-revision-${edition - 1}` : null,
    },
    retrievedAt: `2026-09-${20 + edition}T00:00:00.000Z`,
    contentType: "text/html",
    text,
    extraction: "html",
    extractionNote: null,
    extractorVersion: 2,
  });
  const old = capture(card, 1, "Housing construction should grow.");
  const current = capture(card, 2, "Housing costs should fall.");
  const metadataRevision = capture(card, 3, current.text!);
  const originals = [old, current, metadataRevision];
  const copies = originals.map((row, index) => capture(official, index + 1, row.text!));
  const foreign = capture(unrelated, 3, current.text!);
  const corpus: CandidateCorpus = { formatVersion: 1, fetchedAt: metadataRevision.retrievedAt, attempted: 3,
    failures: [], documents: [...originals, ...copies, foreign] };

  const selected = documentsFor(official, corpus);
  assert.deepEqual(selected, originals);
  selected.forEach((row, index) => assert.equal(row, originals[index], "retain the untouched original source object"));
  assert.deepEqual(documentsFor(card, corpus), selected, "representative selection must not depend on requested alias");
  assert.deepEqual(documentsFor(unrelated, corpus), [foreign], "another person keeps their own exact source capture");
  const candidateAnswer = answerFor(selected, ["housing"]);
  assert.equal(candidateAnswer.kind, "MATCHED");
  if (candidateAnswer.kind !== "MATCHED") return;
  assert.equal(candidateAnswer.scope.documents.length, 3, "two distinct raw editions with unchanged readable text are still history");
  assert.equal(candidateAnswer.passages.length, 2);
  const historical = candidateAnswer.passages.find((passage) => passage.revisionStatus === "HISTORICAL");
  assert.equal(historical?.sourceArtifactId, old.sourceRevision!.artifactId);
  assert.equal(historical?.retrievedAt, old.retrievedAt);
  assert.ok(candidateAnswer.passages.some((passage) => passage.revisionStatus === "CURRENT" &&
    passage.sourceArtifactId === metadataRevision.sourceRevision!.artifactId));

  const unified = unifiedCorpusFromHoldings({ candidateCorpus: corpus });
  assert.equal(unified.snapshots.length, 7, "the global corpus retains each person's original rows");
  assert.equal(unified.snapshots[0]!.sourceRevision, old.sourceRevision, "carry the held capture envelope without rewriting it");
  const expected = readerPositionsFor(official, "housing", unified);
  assert.equal(expected.searched.snapshots, 3);
  assert.equal(expected.passages.length, 2);
  assert.deepEqual(readerPositionsFor(card, "housing", unified), expected);
  assert.deepEqual(readerPositionsFor(unrelated, "housing", unified).passages.map((passage) => passage.snapshotId), [foreign.id]);
  assert.equal(expected.passages.find((passage) => passage.snapshotId === metadataRevision.id)?.changedSince, old.retrievedAt);
  for (const key of [official, card]) {
    const result = await settlePositionHoldingAnswer(key, "housing", {
      candidateCorpus: async () => corpus,
      officeholderStatements: async () => ({ snapshots: [] }),
      identityKeys: async () => readerPersonKeys(key).keys,
    });
    assert.equal(result.kind, "ANSWER");
    if (result.kind === "ANSWER") assert.deepEqual(result.answer, expected, "the API counts the same deduplicated source search");
  }
});

test("identical alias text without exact captured-source provenance remains separately attributed", () => {
  const official = "statewide:az/governor";
  const card = "ballot-az-pima:governor|Katie Hobbs";
  assert.ok(readerPersonKeys(official).keys.includes(card));
  const documents: CandidateDocument[] = [official, card].map(candidateKey => ({
    id: `${candidateKey}@legacy`, candidateKey, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED",
    metaDescription: null, documentUrl: "https://campaign.example/issues", contentHash: "same-readable-text",
    retrievedAt: "2026-09-20T00:00:00.000Z", contentType: "text/html", text: "Housing costs should fall.",
    extraction: "html", extractionNote: null,
  }));
  const corpus: CandidateCorpus = { formatVersion: 1, fetchedAt: documents[0]!.retrievedAt, attempted: 2,
    failures: [], documents };
  assert.deepEqual(documentsFor(official, corpus), documents);
  const answer = readerPositionsFor(official, "housing", unifiedCorpusFromHoldings({ candidateCorpus: corpus }));
  assert.equal(answer.searched.snapshots, 2);
  assert.equal(answer.passages.length, 2, "URL, clock and readable text alone do not establish an exact raw capture");
});
