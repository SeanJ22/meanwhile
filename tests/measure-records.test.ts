import assert from "node:assert/strict";
import test from "node:test";
import { azBallot, azPlaceMeasures } from "./helpers/ballot-district-fixtures.ts";
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

test("Arizona state and place records keep source bindings and distinct reaction identities", () => {
  const places = [
    { ocdId: "ocd-division/country:us/state:az", ballots: { state: azBallot } },
    ...azPlaceMeasures,
  ];
  const allRows: MeasureRecord[] = [];
  for (const place of places) for (const set of Object.values(place.ballots)) {
    const rows = measureRecordsForBallot(set);
    assert.equal(rows.length, place.ocdId === "ocd-division/country:us/state:az" ? 8 : 1);
    for (const row of rows) {
      assert.ok(set.contests.some(contest => contest.type === "MEASURE" && contest.id === row.contestId && contest.ocdId === place.ocdId));
      assert.equal(measureRecordIssue(row), null);
      const source = set.measures.find(measure => measure.contestId === row.contestId)!.officialText!;
      assert.equal(row.sourceUrl, source.sourceUrl);
      assert.equal(row.sourceHash, source.sourceHash);
      assert.ok(source.vault.key);
    }
    allRows.push(...rows);
  }
  assert.equal(allRows.length, 12);
  assert.equal(new Set(allRows.map(row => row.contestId)).size, 12);
  assert.equal(getProvisionTargetIds(allRows).size, 17);
  assert.deepEqual([...getProvisionTargetIds(allRows)].sort(), allRows.flatMap(row => row.parts.map(part => part.id)).sort());
  for (const held of [143, 145, 212]) assert.equal(allRows.some(row => row.contestId === `ballot-az-pima:prop-${held}`), false);
});
