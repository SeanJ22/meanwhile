import assert from "node:assert/strict";
import test from "node:test";
import { composeMeasureMeaningAnswer } from "../lib/ask/measure-meaning.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import type { EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import type { MeasureRecord } from "../lib/ballot/measure-records.ts";

const subject = { kind: "MEASURE", id: "held-measure", name: "Held question" } as EvidenceSubject;
const records: EvidenceRecord[] = [{ kind: "MEASURE_SUMMARY", id: "held-measure#no-meaning", subjectIds: [subject.id],
  text: "NO: The existing funding limit remains in place.", measureMeaning: { vote: "NO", meaning: "The existing funding limit remains in place." },
  sourceUrl: "https://elections.example.gov/question" }];

test("a NO question quotes exactly the stored NO meaning with its source", () => {
  for (const question of ["What does a NO vote mean?", "What happens if I vote no?", "What does NO mean on this question?"]) {
    assert.deepEqual(composeMeasureMeaningAnswer({ subject, question, records }), { answer: records[0].text, citedUrls: [records[0].sourceUrl] });
  }
  assert.equal(composeMeasureMeaningAnswer({ subject, question: "What does a YES vote mean?", records }), null);
  assert.equal(composeMeasureMeaningAnswer({ subject: { ...subject, id: "different-measure" }, question: "What does a NO vote mean?", records }), null);
});

test("the thin measure reader carries new meanings as data and leaves unrecorded meaning blank", () => {
  const record = { contestId: subject.id, whatItDoes: "Changes the funding limit.", yesMeans: "The new limit takes effect.",
    noMeans: records[0].measureMeaning!.meaning, sourceUrl: records[0].sourceUrl!, sourceHash: "a".repeat(64), writtenAt: "2026-10-04T07:00:00Z", parts: [] } as MeasureRecord;
  assert.equal(summaryForContest(subject.id, [record])?.noMeans, record.noMeans);
  assert.equal(summaryForContest(subject.id, [{ ...record, noMeans: null }])?.noMeans, null);
});
