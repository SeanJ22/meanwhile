import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/positions/[subject]/[topic]/route.ts";
import { settlePositionHoldingAnswer } from "../lib/candidates/position-holding.ts";
import { readerPositionsFor, type ReaderPositionAnswer } from "../lib/corpus/reader-positions.ts";
import { positionsFor, searchTerms } from "../lib/corpus/positions.ts";
import { unifiedCorpus, unifiedCorpusFromHoldings } from "../lib/corpus/unified.ts";
import { readerPersonKeys } from "../lib/identity/reader-person.ts";
import { positionsFor as candidatePositionsFor } from "../lib/candidates/positions.ts";
import { withReaderSelection } from "../lib/db/reader-route.ts";
import { readRegistryRuntimeProjection } from "../lib/registry/runtime-read-model.ts";
import { readGenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import { statementEvidenceFor } from "../lib/ask/statements.ts";
import { type CandidateCorpus, type CandidateDocument } from "../lib/candidates/corpus.ts";
import { createHash } from "node:crypto";
import { installOfficeholderStatements, installRegistryAuthority, registryTransferImport, syntheticCandidateCorpus } from "./helpers/promoted-fixtures.ts";
import { officialCandidacySeatMatches } from "../lib/registry/runtime-data-plane.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { GenericBallotProjection } from "../lib/ballot/generic-projection.ts";
import type { Contest } from "../lib/ballot/types.ts";
import type { LineupOutcome } from "../lib/identity/types.ts";
import { readFileSync } from "node:fs";
import { requireBallotState } from "../lib/civic-data/state-scopes.ts";
import { currentReaderAuthorityEdge } from "../lib/registry/runtime-edge.ts";

import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { ballotElectionKey } from "../lib/ballot/generic-projection.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";

async function installCandidateCorpus(value: CandidateCorpus = syntheticCandidateCorpus(), state = "AZ"): Promise<CandidateCorpus> {
  installManualValue(stateBallotContractId("candidate-corpus", state), value, `test:candidate-corpus:${state}`);
  served((await readStateAuthorityProjection("candidate-publications", state)).result, "Candidate publications");
  return value;
}

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}



interface SyntheticLineupNominee {
  readonly name: string;
  readonly partyLabel: string;
  readonly outcome: LineupOutcome;
  readonly candidacyId?: string;
  readonly filingParty?: string;
}

interface SyntheticContest {
  readonly id: string;
  readonly title: string;
  readonly ocdId?: string;
  readonly type?: Contest["type"];
  readonly candidacies?: readonly { readonly id: string; readonly givenName: string; readonly familyName: string; readonly partyLabel?: string | null }[];
  readonly lineup?: readonly SyntheticLineupNominee[];
}

function syntheticAzBallot(contests?: readonly SyntheticContest[]): BallotSet {
  const fixtures = JSON.parse(readFileSync(new URL("./fixtures/synthetic-az-ballots.json", import.meta.url), "utf8")) as Record<string, BallotSet>;
  const ballot = fixtures[JSON.stringify(contests ?? null)];
  if (!ballot) throw new Error("The synthetic Arizona ballot input has no recorded fixture");
  return ballot;
}

async function installBallots(...ballots: BallotSet[]): Promise<GenericBallotProjection> {
  const installed: GenericBallotProjection = { kind: "ballot-contests", ballots: {} };
  for (const ballot of ballots.length ? ballots : [syntheticAzBallot()]) {
    const state = requireBallotState(ballot.election.state);
    const previous = currentReaderAuthorityEdge()?.promoted?.get(`BALLOT_CANDIDACY:${stateBallotScope("ballot-contests", state)}`);
    const current = previous?.kind === "PROMOTED" ? previous.projection.payload as GenericBallotProjection : null;
    const value: GenericBallotProjection = { kind: "ballot-contests", ballots: {
      ...(current?.ballots ?? {}), [ballotElectionKey(ballot)]: ballot,
    } };
    installManualValue(stateBallotContractId("ballot-contests", state), value, `test:ballot-contests:${state}`);
    served(await readGenericBallotProjection(state), `${state} ballot`);
    Object.assign(installed.ballots, value.ballots);
  }
  return installed;
}


await installRegistryAuthority();
// The governor's certified card, reconciled to the governor's candidacy.
await installBallots(syntheticAzBallot([{
  id: "ballot-az-pima:governor",
  title: "Governor",
  candidacies: [{ id: "ballot-az-pima:governor:hobbs-katie", givenName: "Katie", familyName: "Hobbs" }],
  lineup: [{ name: "Katie Hobbs", partyLabel: "Democratic", outcome: "RECONCILED", candidacyId: "ballot-az-pima:governor:hobbs-katie" }],
}]));
await installOfficeholderStatements();
const page = (candidateKey: string, url: string, text: string): CandidateDocument => {
  const contentHash = createHash("sha256").update(text).digest("hex");
  return { id: `${candidateKey}@${contentHash}`, candidateKey, sourceClass: "CAMPAIGN_SITE", basis: "HUNTED_AND_VERIFIED", metaDescription: null,
    documentUrl: url, contentHash, retrievedAt: "2026-09-20T00:00:00.000Z", contentType: "text/html", text, extraction: "html", extractionNote: null };
};
const bridged = registryTransferImport().projection.payload.officialCandidacies.rows
  .filter((row) => officialCandidacySeatMatches(row) && row.candidacy && !row.candidacy.candidacyId.startsWith("ballot-az-")).slice(0, 12);
const base = syntheticCandidateCorpus();
const extra = [
  page("ballot-az-pima:governor|Katie Hobbs", "https://example.test/governor-card/",
    "As Governor I will keep every promise made to working families. This synthetic test page states what the campaign says the Governor will do, in words long enough to be held as a readable publication by the reader."),
  ...bridged.map((row, i) => page(row.candidacy!.candidacyId, `https://bridged-${i + 1}.example.test/`,
    `Synthetic test page ${i + 1}. Our libraries need longer hours and every reader deserves a library within walking distance. This page was written for a test and describes no real campaign; it is long enough to be held as a readable publication.`)),
];
const placeFor = (key: string) => {
  const row = bridged.find(row => row.holder.id === key || row.candidacy?.candidacyId === key);
  const divisions = row?.holder.divisions ?? ["ocd-division/country:us/state:az"];
  const state = divisions.flatMap(id => /\/state:([a-z]{2})(?:\/|$)/.exec(id)?.[1]?.toUpperCase() ?? [])[0]!;
  return { state, divisions };
};
const states = [...new Set(["AZ", ...bridged.map(row => placeFor(row.holder.id).state)])];
for (const state of states) {
  const documents = [...(state === "AZ" ? base.documents : []), ...extra.filter(row => placeFor(row.candidateKey).state === state)];
  await installCandidateCorpus({ ...base, attempted: documents.length, documents }, state);
}

test("every held statement identity bridge gives the Positions API the same complete answer from each current person/card identity", async () => {
  const corpus = unifiedCorpus(states);
  const groups = new Map<string, { keys: string[]; subjectId: string; topic: string }>();
  for (const snapshot of corpus.snapshots.filter((snapshot) => snapshot.extraction === "ok" && snapshot.text)) {
    const keys = readerPersonKeys(snapshot.subjectId).keys;
    if (keys.length < 2 || groups.has(keys.join("|"))) continue;
    const topic = [...new Set(searchTerms(snapshot.text!))].find((word) => positionsFor(snapshot.subjectId, word, corpus).passages.some((passage) => passage.snapshotId === snapshot.id));
    if (topic) groups.set(keys.join("|"), { keys, subjectId: snapshot.subjectId, topic });
  }
  assert.ok(groups.size >= 10);
  for (const { keys, subjectId, topic } of groups.values()) {
    const { state, divisions } = placeFor(subjectId);
    const expected = readerPositionsFor([state], subjectId, topic, unifiedCorpus([state]));
    assert.ok(expected.passages.length > 0);
    for (const key of keys) {
      const response = await GET(new Request(`https://wtp.test/api/positions?${new URLSearchParams(divisions.map(id => ["division", id]))}`), { params: Promise.resolve({ subject: encodeURIComponent(key), topic }) });
      assert.equal(response.status, 200, key);
      const payload = await response.json() as ReaderPositionAnswer & { totalMatches: number };
      assert.deepEqual(payload.canonicalSubjectKeys, expected.canonicalSubjectKeys, key);
      assert.deepEqual(payload.passages, expected.passages, key);
      assert.deepEqual(payload.searched, expected.searched, key);
      assert.equal(payload.totalMatches, payload.passages.length, key);
      assert.deepEqual(candidatePositionsFor(state, key), candidatePositionsFor(state, subjectId));
    }
  }
});

test("Hobbs map, ballot and Ask use the held Governor passage while a foreign supplied key cannot supply it", () => {
  const official = "statewide:az/governor";
  const card = "ballot-az-pima:governor|Katie Hobbs";
  assert.equal(positionsFor(official, "Governor", unifiedCorpus(["AZ"])).passages.length, 0, "measured old exact-ID seam");
  const expected = readerPositionsFor(["AZ"], card, "Governor");
  assert.ok(expected.passages.length > 0);
  assert.deepEqual(readerPositionsFor(["AZ"], official, "Governor"), expected);
  const answer = statementEvidenceFor(["AZ"], { kind: "PERSON", id: official, name: "Katie Hobbs" }, "What does Katie Hobbs say about Governor?", ["unresolved:other-person"]);
  assert.equal(answer.records.length, expected.passages.length);
  for (const passage of expected.passages) assert.ok(answer.records.some((record) => record.id === passage.snapshotId && record.text.includes(passage.quote) && record.sourceUrl === passage.url && record.retrievedAt === passage.retrievedAt));
  assert.equal(readerPositionsFor(["AZ"], "unresolved:former-candidate", "Governor").passages.length, 0);
  const unknown = statementEvidenceFor(["AZ"], { kind: "PERSON", id: "unresolved:former-candidate", name: "Katie Hobbs" }, "What does Katie Hobbs say about Governor?", [official, card]);
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

  const candidateAnswer = await inCorpus(corpus, () => {
    const answer = candidatePositionsFor("AZ", official, null, [housing])[0]!.answer;
    assert.deepEqual(candidatePositionsFor("AZ", card, null, [housing])[0]!.answer, answer, "representative selection must not depend on requested alias");
    const foreignAnswer = candidatePositionsFor("AZ", unrelated, null, [housing])[0]!.answer;
    assert.equal(foreignAnswer.kind, "MATCHED");
    if (foreignAnswer.kind === "MATCHED") {
      assert.equal(foreignAnswer.scope.documents.length, 1);
      assert.equal(foreignAnswer.passages[0]?.sourceRevisionId, foreign.sourceRevision!.revisionId);
    }
    return answer;
  });
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
  const expected = readerPositionsFor(["AZ"], official, "housing", unified);
  assert.equal(expected.searched.snapshots, 3);
  assert.equal(expected.passages.length, 2);
  assert.deepEqual(readerPositionsFor(["AZ"], card, "housing", unified), expected);
  assert.deepEqual(readerPositionsFor(["AZ"], unrelated, "housing", unified).passages.map((passage) => passage.snapshotId), [foreign.id]);
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

test("identical alias text without exact captured-source provenance remains separately attributed", async () => {
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
  const candidateAnswer = await inCorpus(corpus, () => candidatePositionsFor("AZ", official, null, [housing])[0]!.answer);
  assert.equal(candidateAnswer.kind, "MATCHED");
  if (candidateAnswer.kind === "MATCHED") assert.equal(candidateAnswer.scope.documents.length, documents.length);
  const answer = readerPositionsFor(["AZ"], official, "housing", unifiedCorpusFromHoldings({ candidateCorpus: corpus }));
  assert.equal(answer.searched.snapshots, 2);
  assert.equal(answer.passages.length, 2, "URL, clock and readable text alone do not establish an exact raw capture");
});

const housing = { id: "housing", label: "Housing", phrases: ["housing"] };
function inCorpus<T>(corpus: CandidateCorpus, read: () => T): Promise<T> {
  return withReaderSelection({ states: ["AZ"], keys: new Set(["state:AZ"]) }, async () => {
    await readRegistryRuntimeProjection(["AZ"]);
    await readGenericBallotProjection("AZ");
    await installCandidateCorpus(corpus, "AZ");
    return read();
  });
}
