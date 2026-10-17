import assert from "node:assert/strict";
import test from "node:test";

import { composeOwnWordsAnswer } from "../lib/ask/own-words.ts";
import { statementEvidenceFor } from "../lib/ask/statements.ts";
import { DEFAULT_STANCE_TOPICS } from "../lib/stances/topics.ts";
import { buildTopicAnswers, chipQuestion, topicAnswersByLabel } from "../lib/corpus/topic-answers.ts";
import type { SourceSnapshot, StatementCorpus } from "../lib/corpus/types.ts";

function snap(over: Partial<SourceSnapshot>): SourceSnapshot {
  return {
    id: "s1", subjectId: "congress:A", subjectName: "Ana Reyes", kind: "CAMPAIGN_SITE",
    url: "https://anareyes.example/issues", contentHash: "h", retrievedAt: "2026-09-01T00:00:00.000Z",
    httpStatus: 200, extraction: "ok", text: "Affordable housing is my first priority. I will build more homes.", title: null, ...over,
  };
}
const person = { subjectId: "congress:A", name: "Ana Reyes" };
const housing = DEFAULT_STANCE_TOPICS.find(t => t.id === "housing")!;
const water = DEFAULT_STANCE_TOPICS.find(t => t.id === "water")!;
const corpus: StatementCorpus = { snapshots: [snap({})] };

test("a chip and Ask retain the same exact page evidence without assigning its speaker", () => {
  const stored = buildTopicAnswers([person], corpus, [housing])[0]!;
  const question = chipQuestion(person.name, housing.label);
  const found = statementEvidenceFor([], { kind: "PERSON", id: person.subjectId, name: person.name }, question, [], () => corpus, [person.subjectId]);
  const asked = composeOwnWordsAnswer({ subject: { kind: "PERSON", id: person.subjectId, name: person.name }, question, records: found.records });
  assert.equal(stored.prose, asked?.answer ?? null);
  assert.equal(asked, null, "a page match does not verify who said the quoted words");
  assert.deepEqual(stored.records, found.records);
  assert.deepEqual(stored.citedUrls, ["https://anareyes.example/issues"]);
  assert.ok(stored.records.some(record => record.text.includes("Affordable housing is my first priority") && record.sourceUrl === "https://anareyes.example/issues"));
  assert.ok(stored.records.every(record => record.verifiedStatement === undefined));
});

test("a topic with no match stores Ask's named gap, never a claim about the person", () => {
  const stored = buildTopicAnswers([person], corpus, [water])[0]!;
  assert.equal(stored.prose, null);
  assert.equal(stored.records.length, 0);
  assert.ok(stored.gaps.every(g => g.whose === "OURS"));
});

test("every person gets every topic, and the card reads one person's answers by chip label", () => {
  const two = [person, { subjectId: "congress:B", name: "Ben Ortiz" }];
  const answers = buildTopicAnswers(two, corpus);
  assert.equal(answers.length, two.length * DEFAULT_STANCE_TOPICS.length);
  const mine = topicAnswersByLabel(answers, "congress:A");
  assert.deepEqual(Object.keys(mine), DEFAULT_STANCE_TOPICS.map(t => t.label));
  assert.equal(mine.housing.prose, null);
  assert.deepEqual(mine.housing, buildTopicAnswers([person], corpus, [housing])[0]);
  assert.ok(mine.housing.records.length > 0);
  assert.equal(topicAnswersByLabel(answers, "congress:B").housing.records.length, 0);
});
