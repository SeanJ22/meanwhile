import assert from "node:assert/strict";
import test from "./helpers/playbooks.ts";

import type { EvidencePack } from "../lib/ask/evidence.ts";
import { asksForPersonalStance, stanceAnswerability } from "../lib/ask/stance-answerability.ts";
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

test("a page match cannot authorize a paid writer to state a person's stance", async () => {
  let calls = 0;
  const outcome = await synthesizeAnswer(passagePack, { apiKey: "test", fetchImpl: async () => {
    calls += 1;
    throw new Error("writer must not run");
  } });
  assert.deepEqual({ kind: outcome.kind, why: outcome.kind === "UNAVAILABLE" ? outcome.why : null },
    { kind: "UNAVAILABLE", why: "unverified-stance" });
  assert.equal(calls, 0);
  assert.equal(passagePack.records[0]?.kind, "SOURCE_PASSAGE", "the quotation remains available as a sourced record");
  assert.match(synthesisPrompt(passagePack), /SOURCE_PASSAGE is a matched quotation/);
});

test("a question about what the page says can quote the page without speaker attribution", () => {
  const page = { ...passagePack, question: "What does Casey Example's campaign page say about housing?" };
  assert.equal(asksForPersonalStance(page.question), false);
  assert.equal(stanceAnswerability(page), "NOT_APPLICABLE");
  assert.equal(stanceAnswerability({ ...passagePack, question: "What does Casey Example say on her campaign page?" }),
    "UNVERIFIED_PERSONAL_STANCE");
  assert.equal(stanceAnswerability({ ...passagePack, subject: { kind: "PERSON", id: "candidate:casey", name: "Casey Example" },
    question: "How did Casey Example vote on the bill?" }), "NOT_APPLICABLE");
});

test("a candidate's filing or biography cannot substitute for a direct personal stance", () => {
  const noPassage = { ...passagePack, records: [{ kind: "CANDIDACY" as const, id: "filing:1",
    text: "Casey Example filed for council.", sourceUrl: "https://elections.example/filing" }] };
  assert.equal(stanceAnswerability(noPassage), "UNVERIFIED_PERSONAL_STANCE");
  assert.equal(stanceAnswerability({ ...noPassage, subject: { kind: "MEASURE", id: "measure:1", name: "A measure" } }), "NOT_APPLICABLE");
});
