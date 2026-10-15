import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";

import type { EvidencePack } from "../lib/ask/evidence.ts";
import { composeOwnWordsAnswer } from "../lib/ask/own-words.ts";
import { synthesisPrompt, synthesizeAnswer } from "../lib/ask/synthesize.ts";

const passagePack: EvidencePack = {
  question: "What does Casey Example say about housing?",
  intent: "PERSON_RECORD",
  temporal: { kind: "NONE" },
  subject: { kind: "PERSON", id: "candidate:casey", name: "Casey Example" },
  records: [{ kind: "SOURCE_PASSAGE", id: "page:1", subjectId: "candidate:casey",
    text: "Searching a campaign page linked to Casey Example for housing found this passage: \"more homes\". A phrase match does not establish a personal stance or the passage's speaker.",
    sourceUrl: "https://campaign.example/issues", retrievedAt: "2026-09-27T00:00:00.000Z" }],
  gaps: [], denominators: {}, today: "2026-09-28",
};

test("a person's stance question is written from the statements we hold, like any other question", async () => {
  const bodies: string[] = [];
  await synthesizeAnswer(passagePack, { apiKey: "test", fetchImpl: async (_url, init) => {
    bodies.push(String(init?.body));
    throw new Error("writer reached");
  } });
  assert.equal(bodies.length, 1, "the writer answers from the held passage");
  assert.match(bodies[0], /campaign\.example\/issues/, "the statement's source goes to the writer for Sources");
  assert.match(synthesisPrompt(passagePack), /SOURCE_PASSAGE is a matched quotation/);
});

test("a question about what a page says is not composed as the person's own words", () => {
  const record = { ...passagePack.records[0], verifiedStatement: { speakerId: "candidate:casey", quote: "We must build more homes for every family here.",
    date: "2026-09-20", attribution: "The official source", nativeSourceId: "statement:1" } };
  const subject = passagePack.subject!;
  assert.equal(composeOwnWordsAnswer({ subject, question: "What does Casey Example's campaign page say about housing?", records: [record] }), null);
  assert.ok(composeOwnWordsAnswer({ subject, question: "What does Casey Example say about housing?", records: [record] }));
});
