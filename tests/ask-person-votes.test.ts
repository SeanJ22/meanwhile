import assert from "node:assert/strict";
import test from "node:test";

import type { EvidencePack, EvidenceRecord } from "../lib/ask/evidence.ts";
import { composePersonVotes, personVotesQuestionShape, topicTerms } from "../lib/ask/person-votes.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import { WRITER_PERSON_VOTE_RECORDS, writerInputProof, writerSelection } from "../lib/ask/writer-selection.ts";

const rollCall = (n: number, what: string, date = `2026-09-${String(10 + n).padStart(2, "0")}`, position = "YES"): EvidenceRecord => ({
  kind: "ROLL_CALL_VOTE", id: `congress:C1#house:119-2:${n}`,
  text: `Juan Ciscomani, U.S. Representative: voted ${position} on ${what} — On Passage, ${date}. Passed 300–100.`,
  rollCall: { position, what, when: date, result: "Passed 300–100" },
  occurredAt: date, sourceUrl: `https://clerk.example/${n}`, sourceOrg: "U.S. House of Representatives",
});

test("the vote questions read in code, with the words naming the person and the topic", () => {
  assert.deepEqual(personVotesQuestionShape("How has Juan Ciscomani voted?"), { slot: "juan ciscomani", topic: null });
  assert.deepEqual(personVotesQuestionShape("How did Juan Ciscomani vote on the budget?"), { slot: "juan ciscomani", topic: "budget" });
  assert.deepEqual(personVotesQuestionShape("How has Juan Ciscomani voted on immigration bills?"), { slot: "juan ciscomani", topic: "immigration bills" });
  assert.deepEqual(personVotesQuestionShape("What is Juan Ciscomani's voting record?"), { slot: "juan ciscomani", topic: null });
  for (const question of ["How did she vote on the budget?", "How did the Vail school board vote and who sits on it?", "How did Juan Ciscomani vote on the budget and immigration?", "Who is Juan Ciscomani?", "How did they vote?"]) {
    const read = personVotesQuestionShape(question);
    assert.ok(read === null || !/\b(?:she|they)\b/.test(read.slot), question);
  }
  assert.equal(personVotesQuestionShape("How did Juan Ciscomani vote on the budget and immigration?"), null, "two topics are the writer's");
  assert.deepEqual(topicTerms("the budgets"), ["budget"]);
  assert.deepEqual(topicTerms("bills"), [], "a topic of filler words names nothing");
});

test("no topic: the most recent recorded votes, newest first, and how many we hold", () => {
  const records = [1, 2, 3, 4, 5].map((n) => rollCall(n, `Measure ${n} (H R ${n})`));
  const composed = composePersonVotes({ name: "Juan Ciscomani", topic: null, records });
  assert.equal(composed?.answer,
    "Juan Ciscomani's latest votes: YES on Measure 5 (H R 5) (2026-09-15; Passed 300–100); YES on Measure 4 (H R 4) (2026-09-14; Passed 300–100); and YES on Measure 3 (H R 3) (2026-09-13; Passed 300–100).");
  assert.deepEqual(composed?.citedUrls, ["https://clerk.example/5", "https://clerk.example/4", "https://clerk.example/3"]);
  const pack: EvidencePack = { question: "How has Juan Ciscomani voted?", intent: "PERSON_RECORD", temporal: { kind: "NONE" }, subject: { kind: "PERSON", id: "p", name: "Juan Ciscomani" }, records, gaps: [], denominators: {}, today: "2026-09-29" };
  assert.equal(validateAnswer(composed!.answer, composed!.citedUrls, pack).kind, "PASSED", "the same validator a model answer faces");
});

test("a topic: only the held votes whose own words carry it; a topic no held vote names is the writer's", () => {
  const records = [rollCall(1, "Water Resources Development Act of 2026 (H R 9497)"), rollCall(2, "Establishing the congressional budget for fiscal year 2027 (H CON RES 113)", "2026-07-22"), rollCall(3, "Continuing Appropriations and Budget Extensions Act (H R 6500)", "2026-09-01", "NO")];
  const composed = composePersonVotes({ name: "Juan Ciscomani", topic: "budget", records });
  assert.match(composed?.answer ?? "", /^Juan Ciscomani voted NO on Continuing Appropriations and Budget Extensions Act \(H R 6500\) \(2026-09-01; Passed 300–100\) and YES on Establishing the congressional budget for fiscal year 2027 \(H CON RES 113\) \(2026-07-22; Passed 300–100\)\.$/);
  assert.equal(composePersonVotes({ name: "Juan Ciscomani", topic: "immigration", records }), null, "the Laken Riley Act's title says nothing of immigration: a writer reads it");
  assert.equal(composePersonVotes({ name: "Juan Ciscomani", topic: "bills", records }), null, "a topic of filler words names nothing");
  assert.equal(composePersonVotes({ name: "Juan Ciscomani", topic: null, records: [] }), null, "no roll call held: the named gap and the writer");
  assert.equal(composePersonVotes({ name: "Juan Ciscomani", topic: null, records: [{ ...records[0], rollCall: undefined }] }), null, "a record without its own fields is never parsed");
});

test("the writer is sent the most relevant votes, a key vote's context and position together, and is told what it was not given", () => {
  const filler = Array.from({ length: 30 }, (_, index) => rollCall(index + 1, `Unrelated measure ${index}`));
  const budget = rollCall(90, "Establishing the congressional budget for fiscal year 2027", "2026-07-22");
  const context: EvidenceRecord = { kind: "KEY_VOTE_CONTEXT", id: "key-vote-entry:one-big-bill", text: "The Big Bill (2025): taxes and the budget in one law.", sourceUrl: null };
  const position: EvidenceRecord = { kind: "KEY_VOTE_POSITION", id: "key-vote:p:1", text: "Juan Ciscomani: the House recorded YES on roll call 1.", sourceUrl: "https://clerk.example/k", keyVote: { entryIds: ["one-big-bill"], positionKeys: [], chamber: "house", congress: 119, session: 1, rollNumber: 1, position: "YES", referenceVerifiedAt: "2026-09-27" } };
  const other: EvidenceRecord = { kind: "OFFICEHOLDER", id: "o", text: "Juan Ciscomani holds the office of U.S. Representative.", sourceUrl: "https://a.example/o" };
  const records = [other, ...filler, budget, context, position];
  const pack = { question: "How did Juan Ciscomani vote on the budget?", subject: { kind: "PERSON" as const, id: "p", name: "Juan Ciscomani" }, records };
  const selection = writerSelection(pack);
  assert.ok(selection.records.includes(other), "a record that is not a vote is never cut");
  assert.ok(selection.records.includes(budget), "the vote whose words carry the topic is sent");
  assert.ok(selection.records.includes(context) && selection.records.includes(position), "the budget context brings its position, and the position its context");
  const votes = selection.records.filter((record) => record.kind === "ROLL_CALL_VOTE" || record.kind === "KEY_VOTE_POSITION" || record.kind === "KEY_VOTE_CONTEXT");
  assert.ok(votes.length <= WRITER_PERSON_VOTE_RECORDS + 2, `${votes.length} vote records sent, not the ${filler.length + 3} held`);
  assert.equal(selection.withheld.personVoteRecords, filler.length + 3 - (votes.length));
  assert.match(selection.note ?? "", /never say or imply that votes were not published/);
  assert.deepEqual(writerInputProof(pack, records, selection.records), { receivesItsSelection: true, withheldMemberVoteRows: filler.length + 3 - votes.length });
  /* A family inside the bound is sent whole, with no note. */
  assert.equal(writerSelection({ ...pack, records: [other, budget] }).note, null);

  /* An answer that calls the withheld votes unpublished is refused, as it is for a sitting's member votes. */
  const full: EvidencePack = { ...pack, question: pack.question, intent: "PERSON_RECORD", temporal: { kind: "NONE" }, gaps: [], denominators: {}, today: "2026-09-29" };
  const refused = validateAnswer("How Juan Ciscomani voted on most other measures was not recorded.", [], full);
  assert.ok(refused.kind === "FAILED" && refused.failed.includes("withheld-votes-called-unpublished"));
});
