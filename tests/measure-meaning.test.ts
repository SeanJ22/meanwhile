import assert from "node:assert/strict";
import test from "node:test";
import { composeMeasureMeaningAnswer } from "../lib/ask/measure-meaning.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import type { EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import type { MeasureRecord } from "../lib/ballot/measure-records.ts";
import { ballotRecordsFor, ballotSubject, type BallotSubjectRecord } from "../lib/ask/ballot-inventory.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { explicitVoteMeanings } from "../lib/ballot/measure-records.ts";

const subject = { kind: "MEASURE", id: "held-measure", name: "Held question" } as EvidenceSubject;
const records: EvidenceRecord[] = [{ kind: "MEASURE_SUMMARY", id: "held-measure#no-meaning", subjectId: subject.id,
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

test("the ballot evidence builder carries the stored NO meaning with the measure's canonical subject id", () => {
  const record: BallotSubjectRecord = { kind: "MEASURE", id: subject.id, name: subject.name, contestId: subject.id,
    contestTitle: subject.name, ocdId: "ocd-division/country:us/state:nh" };
  const provenance = { sourceUrl: records[0].sourceUrl!, sourceOrg: "Fixture election authority", collectedAt: "2026-10-04T07:00:00Z", verifiedAt: null };
  const set: BallotSet = { election: { id: "nh-fixture", state: "NH", name: "Fixture election", date: "2026-11-03" },
    contests: [{ id: subject.id, electionId: "nh-fixture", title: subject.name, type: "MEASURE", voteFor: 1,
      ocdId: record.ocdId, divisionVintage: "fixture", termYears: null, scopeNote: null, provenance }],
    measures: [{ id: subject.id, contestId: subject.id, questionText: "Shall the funding limit change?", officialStatement: null, provenance }], candidacies: [], absences: [] };
  const built = ballotRecordsFor(record, { set, contests: set.contests, absences: [], measureSummary: () => ({
    summary: "Changes the funding limit.", summarizesUrl: provenance.sourceUrl, noMeans: records[0].measureMeaning!.meaning }) });
  const answer = composeMeasureMeaningAnswer({ subject: ballotSubject(record), question: "What does a NO vote mean?", records: built.records });
  assert.deepEqual(answer, { answer: records[0].text, citedUrls: [provenance.sourceUrl] });
});

test("explicit official vote sentences are preserved verbatim and contradictory meanings stay unknown", () => {
  const text = 'A “YES” vote shall have the effect of allowing the county to adjust its base expenditure limit. A “NO” vote shall have the effect of not allowing the county to adjust its base expenditure limit.';
  assert.deepEqual(explicitVoteMeanings(text), {
    yesMeans: text.split('. ')[0] + '.', noMeans: text.split('. ')[1],
  });
  assert.equal(explicitVoteMeanings('The proposal would raise a limit.').noMeans, null);
  assert.equal(explicitVoteMeanings(text + ' A “NO” vote shall do something different.').noMeans, null);
  assert.equal(explicitVoteMeanings('A NO vote would retain the $1.25 rate. A YES vote would raise it.').noMeans,
    'A NO vote would retain the $1.25 rate.');
});
