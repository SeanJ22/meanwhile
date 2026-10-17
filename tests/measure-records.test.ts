import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { BallotSet } from "../lib/ballot/types.ts";
import { measureRecordIssue, measureRecordsForBallot, type MeasureRecord } from "../lib/ballot/measure-records.ts";
import { summaryForContest } from "../lib/ballot/measure-summary.ts";
import { getProvisionTargetIds, provisionsForContest } from "../lib/ballot/measure-provisions.ts";

const record: MeasureRecord = {
  contestId: "ballot-test:measure", whatItDoes: "Creates a public program.",
  yesMeans: "Creates the program.", noMeans: "Keeps the existing law.",
  parts: [{ id: "ballot-test:measure#program", number: "2(b)", kind: "PROGRAM", label: "Program", what: "Creates the program." }],
  sourceUrl: "https://elections.example.gov/measure", sourceHash: "a".repeat(64), writtenAt: "2026-10-04",
};
const ballot = { contests: [{ id: record.contestId, type: "MEASURE" }], measures: [], measureRecords: [record] } as unknown as BallotSet;

test("a measure added or updated as ballot data reaches both thin readers and reaction targets", () => {
  const rows = measureRecordsForBallot(ballot);
  assert.equal(summaryForContest(record.contestId, rows)?.summary, record.whatItDoes);
  assert.equal(provisionsForContest(record.contestId, rows)[0]?.id, record.parts[0].id);
  assert.ok(getProvisionTargetIds(rows).has(record.parts[0].id));
  const next = { ...ballot, measureRecords: [{ ...record, whatItDoes: "Changes the public program." }] };
  assert.equal(summaryForContest(record.contestId, measureRecordsForBallot(next))?.summary, "Changes the public program.");
  assert.deepEqual([...getProvisionTargetIds(measureRecordsForBallot(next))], [record.parts[0].id]);
  assert.equal(next.measureRecords[0].parts[0].number, "2(b)");
});

test("records outside this ballot and malformed or repeated reaction identities are excluded", () => {
  assert.equal(measureRecordsForBallot({ ...ballot, contests: [] }).length, 0);
  assert.ok(measureRecordIssue({ ...record, parts: [record.parts[0], record.parts[0]] }));
  assert.ok(measureRecordIssue({ ...record, parts: [{ ...record.parts[0], id: "other-measure#program" }] }));
  assert.equal(measureRecordsForBallot({ ...ballot, measureRecords: [{ ...record, sourceHash: "missing" }] }).length, 0);
  assert.deepEqual(measureRecordsForBallot({ ...ballot, measureRecords: [] }), []);
});

test("state ballot data carries every reviewed Arizona measure record and stable reaction target", () => {
  const state = JSON.parse(readFileSync("data/ballot/2026-general/az.json", "utf8"));
  const ballot = Object.values(state.ballots)[0] as BallotSet;
  const rows = measureRecordsForBallot(ballot);
  assert.equal(rows.length, 15);
  assert.equal(getProvisionTargetIds(rows).size, 52);
  assert.deepEqual(rows.map(row => row.contestId).sort(), ballot.measureRecords!.map(row => row.contestId).sort());
  for (const row of rows) assert.equal(measureRecordIssue(row), null);
});
