import assert from "node:assert/strict";
import test from "node:test";


import type { EvidenceRecord } from "../lib/ask/evidence.ts";
import { composeOwnWordsAnswer, ownWordsPassages, readsAsSpokenSentence } from "../lib/ask/own-words.ts";
import { installOfficeholderStatements, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";
import type { CandidateCorpus } from "../lib/candidates/corpus.ts";
import { syntheticCandidateCorpus } from "./helpers/promoted-fixtures.ts";
import { installManualValue } from "./helpers/promoted-fixtures.ts";
import { stateBallotContractId } from "../lib/civic-data/state-scopes.ts";
import type { CivicDataReadResult } from "../lib/civic-data/read-model.ts";
import { readStateAuthorityProjection } from "../lib/civic-data/state-reader.ts";

function served<T>(read: CivicDataReadResult<T>, what: string): T {
  if (read.kind !== "PROMOTED" && read.kind !== "BOOTSTRAP") throw new Error(`${what} fixture did not install: ${read.kind} ${"detail" in read ? read.detail : ""}`);
  return read.value as T;
}

async function installCandidateCorpus(value: CandidateCorpus = syntheticCandidateCorpus(), state = "AZ"): Promise<CandidateCorpus> {
  installManualValue(stateBallotContractId("candidate-corpus", state), value, `test:candidate-corpus:${state}`);
  served((await readStateAuthorityProjection("candidate-publications", state)).result, "Candidate publications");
  return value;
}


await installRegistryAuthority();
await installCandidateCorpus();
await installOfficeholderStatements();

const person = { kind: "PERSON" as const, id: "candidate:casey", name: "Casey Example" };
const passage = (over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "SOURCE_PASSAGE", id: "page:1", subjectId: person.id,
  text: 'Searching a held campaign page linked to Casey Example for water found this passage: "We must protect our water supply for every family in this district.". Latest captured version. Read 2026-09-27T00:00:00.000Z. A phrase match does not establish a personal stance or the passage\'s speaker.',
  verifiedStatement: { speakerId: person.id, quote: "We must protect our water supply for every family in this district.", date: "2026-09-20", attribution: "The official source", nativeSourceId: "statement:1" },
  sourceUrl: "https://campaign.example/issues", retrievedAt: "2026-09-27T00:00:00.000Z", ...over,
});

test("an own-page verbatim passage is answered in code with the quote, date and source", () => {
  const out = composeOwnWordsAnswer({ subject: person, question: "What does Casey Example say about water?", records: [passage()] });
  assert.ok(out);
  assert.match(out.answer, /“We must protect our water supply for every family in this district.”/);
  assert.match(out.answer, /September 20th, 2026/);
  assert.deepEqual(out.citedUrls, ["https://campaign.example/issues"]);
});

test("nothing is composed for a non-stance question, a missing date or address, or no passage", () => {
  const q = "What does Casey Example say about water?";
  assert.equal(composeOwnWordsAnswer({ subject: person, question: "How did Casey Example vote?", records: [passage()] }), null);
  assert.equal(composeOwnWordsAnswer({ subject: person, question: q, records: [passage({ retrievedAt: undefined })] }), null);
  assert.equal(composeOwnWordsAnswer({ subject: person, question: q, records: [passage({ sourceUrl: undefined })] }), null);
  assert.equal(composeOwnWordsAnswer({ subject: person, question: q, records: [] }), null);
  assert.equal(composeOwnWordsAnswer({ subject: null, question: q, records: [passage()] }), null);
  assert.equal(composeOwnWordsAnswer({ subject: person, question: q, records: [passage({ subjectId: "candidate:other" })] }), null);
});

test("a record that is not an own-page quotation is not quoted, and the clean quote still is", () => {
  const odd = passage({ id: "page:2", verifiedStatement: undefined, text: "A mention of water somewhere." });
  const out = composeOwnWordsAnswer({ subject: person, question: "What does Casey Example say about water?", records: [passage(), odd] });
  assert.ok(out);
  assert.doesNotMatch(out.answer, /mention of water/);
});

test("a press-list headline with page furniture is never quoted as a person's words", () => {
  const headline = passage({ id: "page:3", verifiedStatement: undefined, text: 'Searching a held official page linked to Casey Example for water found this passage: "Statement on Newly Announced Federal Proposal for Colorado River Water Cuts July 31, 2026 Read More Press Release Rep.". Latest captured version. Read 2026-08-20T00:00:00.000Z.' });
  assert.equal(composeOwnWordsAnswer({ subject: person, question: "What has Casey Example said about water?", records: [headline] }), null);
  assert.equal(readsAsSpokenSentence("We must protect our water supply for every family in this district."), true);
  assert.equal(readsAsSpokenSentence("As Governor, my loyalty will be to the people of Arizona, not to special interests or big donors.” —Teri Ann Hourihan My Heart is For Arizona I rejected the No Labels Party endorsement and every other offer."), false);
  assert.equal(readsAsSpokenSentence("Water Policy Update From Our Office Today."), false);
});

test("generic held page passages cannot establish the speaker of a quotation", () => {
  const out = composeOwnWordsAnswer({ subject: person, question: "What does Casey Example say about water?", records: [passage({ verifiedStatement: undefined })] });
  assert.equal(out, null);
  assert.equal(ownWordsPassages([passage({ verifiedStatement: undefined })], person.id).passages.length, 0);
});
