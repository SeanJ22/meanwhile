import assert from "node:assert/strict";
import test from "node:test";

import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await installRegistryRuntimeFirstSeeds();

import type { EvidenceRecord } from "../lib/ask/evidence.ts";
import { composeOwnWordsAnswer, ownWordsPassages, readsAsSpokenSentence } from "../lib/ask/own-words.ts";
import { statementEvidenceFor } from "../lib/ask/statements.ts";
import { positionsFor } from "../lib/corpus/positions.ts";
import { unifiedCorpus } from "../lib/corpus/unified.ts";

const person = { kind: "PERSON" as const, id: "candidate:casey", name: "Casey Example" };
const passage = (over: Partial<EvidenceRecord> = {}): EvidenceRecord => ({
  kind: "SOURCE_PASSAGE", id: "page:1", subjectId: person.id,
  text: 'Searching a held campaign page linked to Casey Example for water found this passage: "We must protect our water supply for every family in this district.". Latest captured version. Read 2026-09-27T00:00:00.000Z. A phrase match does not establish a personal stance or the passage\'s speaker.',
  sourceUrl: "https://campaign.example/issues", retrievedAt: "2026-09-27T00:00:00.000Z", ...over,
});

test("an own-page verbatim passage is answered in code with the quote, date and source", () => {
  const out = composeOwnWordsAnswer({ subject: person, question: "What does Casey Example say about water?", records: [passage()] });
  assert.ok(out);
  assert.match(out.answer, /“We must protect our water supply for every family in this district.”/);
  assert.match(out.answer, /September 27th, 2026/);
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
  const odd = passage({ id: "page:2", text: "A mention of water somewhere." });
  const out = composeOwnWordsAnswer({ subject: person, question: "What does Casey Example say about water?", records: [passage(), odd] });
  assert.ok(out);
  assert.doesNotMatch(out.answer, /mention of water/);
});

test("a press-list headline with page furniture is never quoted as a person's words", () => {
  const headline = passage({ id: "page:3", text: 'Searching a held official page linked to Casey Example for water found this passage: "Statement on Newly Announced Federal Proposal for Colorado River Water Cuts July 31, 2026 Read More Press Release Rep.". Latest captured version. Read 2026-08-20T00:00:00.000Z.' });
  assert.equal(composeOwnWordsAnswer({ subject: person, question: "What has Casey Example said about water?", records: [headline] }), null);
  assert.equal(readsAsSpokenSentence("We must protect our water supply for every family in this district."), true);
  assert.equal(readsAsSpokenSentence("As Governor, my loyalty will be to the people of Arizona, not to special interests or big donors.” —Teri Ann Hourihan My Heart is For Arizona I rejected the No Labels Party endorsement and every other offer."), false);
  assert.equal(readsAsSpokenSentence("Water Policy Update From Our Office Today."), false);
});

test("real held passages compose to the exact quotation Positions returns", () => {
  const corpus = unifiedCorpus();
  let tested = 0;
  for (const snapshot of corpus.snapshots) {
    if (snapshot.extraction !== "ok" || !snapshot.text) continue;
    const words = [...new Set(snapshot.text.match(/\b[A-Za-z]{6,}\b/g) ?? [])].slice(0, 40);
    const topic = words.find((w) => positionsFor(snapshot.subjectId, w, corpus).kind === "MATCHED");
    if (!topic) continue;
    const subject = { kind: "PERSON" as const, id: snapshot.subjectId, name: "This person" };
    const question = `What does this person say about ${topic}?`;
    const { records } = statementEvidenceFor(subject, question, [snapshot.subjectId]);
    if (!records.length) continue;
    // Held pages carry headline and menu runs; only a sentence is quoted, and what is quoted is exactly what Positions returns.
    const { passages, garbled } = ownWordsPassages(records, subject.id);
    for (const p of passages) assert.ok(readsAsSpokenSentence(p.quote), p.quote);
    const out = composeOwnWordsAnswer({ subject, question, records });
    if (!passages.length || garbled > 0) { assert.equal(out, null, snapshot.subjectId); continue; }
    assert.ok(out, snapshot.subjectId);
    assert.ok(out.citedUrls.length > 0);
    if (++tested >= 25) break;
  }
  assert.ok(tested >= 10, `tested ${tested}`);
});
