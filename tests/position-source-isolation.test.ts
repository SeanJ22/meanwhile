import assert from "node:assert/strict";
import { test } from "node:test";

import {
  settlePositionHoldingAnswer,
  type PositionHoldingReaders,
} from "../lib/candidates/position-holding.ts";
import type { CandidateCorpus } from "../lib/candidates/corpus.ts";
import type { StatementCorpus } from "../lib/corpus/types.ts";
import { ReaderPersonIdentityError } from "../lib/identity/reader-person.ts";

const SUBJECT = "ballot-nj-morris:test-office:test-person";

const candidateCorpus: CandidateCorpus = {
  formatVersion: 1,
  fetchedAt: "2026-09-09T00:00:00.000Z",
  attempted: 1,
  failures: [],
  documents: [{
    id: "candidate-document",
    candidateKey: SUBJECT,
    sourceClass: "CAMPAIGN_SITE",
    basis: "HUNTED_AND_VERIFIED",
    metaDescription: null,
    documentUrl: "https://candidate.example/issue",
    contentHash: "candidate-hash",
    retrievedAt: "2026-09-09T00:00:00.000Z",
    contentType: "text/html",
    text: "Housing belongs within reach of every family.",
    extraction: "html",
    extractionNote: null,
  }],
};

const statements: StatementCorpus = {
  snapshots: [{
    id: "official-document",
    subjectId: SUBJECT,
    subjectName: "Test Person",
    kind: "OFFICIAL_PAGE",
    url: "https://official.example/issue",
    contentHash: "official-hash",
    retrievedAt: "2026-09-08T00:00:00.000Z",
    httpStatus: 200,
    extraction: "ok",
    text: "Housing policy is listed on this official page.",
    title: "Issues",
  }],
};

const readers = (overrides: Partial<PositionHoldingReaders> = {}): PositionHoldingReaders => ({
  candidateCorpus: async () => candidateCorpus,
  officeholderStatements: async () => statements,
  identityKeys: async () => [SUBJECT],
  ...overrides,
});

test("candidate-publication failure preserves a source-linked officeholder passage and names the partial holding", async () => {
  const result = await settlePositionHoldingAnswer(SUBJECT, "housing", readers({
    candidateCorpus: async () => { throw new Error("planted candidate-publication failure"); },
  }));
  assert.equal(result.kind, "ANSWER");
  if (result.kind !== "ANSWER") return;
  assert.equal(result.holdingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["CANDIDATE_PUBLICATION"]);
  assert.deepEqual(result.answer.passages.map((row) => row.snapshotId), ["official-document"]);
});

test("officeholder-statement failure preserves a source-linked candidate passage and names the partial holding", async () => {
  const result = await settlePositionHoldingAnswer(SUBJECT, "housing", readers({
    officeholderStatements: async () => { throw new Error("planted officeholder-statement failure"); },
  }));
  assert.equal(result.kind, "ANSWER");
  if (result.kind !== "ANSWER") return;
  assert.equal(result.holdingStatus, "PARTIAL");
  assert.deepEqual(result.unavailableAuthorities, ["OFFICEHOLDER_STATEMENT"]);
  assert.deepEqual(result.answer.passages.map((row) => row.snapshotId), ["candidate-document"]);
});

test("a partial corpus cannot manufacture searched-nothing or not-yet-collected", async () => {
  const result = await settlePositionHoldingAnswer(SUBJECT, "water", readers({
    candidateCorpus: async () => { throw new Error("planted candidate-publication failure"); },
  }));
  assert.deepEqual(result, {
    kind: "HOLDING_UNAVAILABLE",
    unavailableAuthorities: ["CANDIDATE_PUBLICATION"],
  });
});

test("identity holding failure searches only the requested exact key and never erases its proven passage", async () => {
  const result = await settlePositionHoldingAnswer(SUBJECT, "housing", readers({
    identityKeys: () => { throw new Error("planted identity-store failure"); },
  }));
  assert.equal(result.kind, "ANSWER");
  if (result.kind !== "ANSWER") return;
  assert.equal(result.holdingStatus, "PARTIAL");
  assert.deepEqual(result.answer.canonicalSubjectKeys, [SUBJECT]);
  assert.deepEqual(result.unavailableAuthorities, ["PERSON_IDENTITY"]);
});

test("an explicit unresolved identity remains fail-closed rather than falling back to an exact key", async () => {
  const result = await settlePositionHoldingAnswer(SUBJECT, "housing", readers({
    identityKeys: async () => { throw new ReaderPersonIdentityError(); },
  }));
  assert.equal(result.kind, "IDENTITY_UNRESOLVED");
});
