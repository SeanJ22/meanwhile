import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import { composeBallotOnlyAnswer } from "../lib/ask/ballot-only-answer.ts";
import { measureAnswer, overLengthBudget } from "../lib/ask/length-contract.ts";
import type { BallotForDivisions } from "../lib/ask/server-sources.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";

const raw = Object.values(JSON.parse(readFileSync("data/ballot/2026-general/az.json", "utf8")).ballots)[0] as BallotSet;
function holdings(set: BallotSet): BallotForDivisions {
  return { set, sets: [set], contests: set.contests, absences: set.absences, loaderFailures: [],
    analysisLoaderFailed: false, measureAnalysis: () => null, setForTarget: () => set,
    nominees: () => [], positions: () => [], measureSummary: () => null, measureProvisions: () => [] };
}

test("a large official ballot composes bounded counts without a model and retains every complete contest record", context => {
  const fetch = context.mock.method(globalThis, "fetch", () => { throw new Error("A held ballot summary must not call a model or source"); });
  const base = "ocd-division/country:us/state:az";
  const selected = ballotForDivisions(raw, [base, `${base}/county:pima`, `${base}/school_district:vail_unified_district`]);
  const before = structuredClone(selected);
  assert.equal(selected.contests.length, 35);
  const result = composeBallotOnlyAnswer(holdings(selected), "What is on my ballot?", "2026-10-21");
  assert.ok(result, "the complete sourced ballot must stay on the deterministic composed path");
  assert.equal(result.verdict.kind, "PASSED");
  assert.match(result.composed.answer, /^Your ballot for the 2026 General Election on .+ has 22 races and 13 ballot measures\.$/);
  assert.equal(measureAnswer(result.composed.answer).sentences, 1);
  assert.equal(overLengthBudget(result.composed.answer), null);
  assert.equal(fetch.mock.callCount(), 0);
  assert.equal(result.composed.records.length, selected.contests.length);
  for (const contest of selected.contests) {
    const record: EvidenceRecord | undefined = result.composed.records.find(row => row.id === contest.id);
    assert.ok(record, contest.id);
    assert.ok(record.text.includes(contest.title), contest.title);
    assert.equal(record.kind, "CONTEST");
    assert.equal(record.occurredAt, selected.election.date);
    assert.equal(record.sourceUrl, contest.provenance.sourceUrl);
    assert.equal(record.sourceOrg, contest.provenance.sourceOrg);
    assert.equal(record.retrievedAt, contest.provenance.collectedAt);
    const sourceUrl = contest.provenance.sourceUrl;
    assert.ok(sourceUrl);
    assert.ok(result.composed.citedUrls.includes(sourceUrl));
  }
  assert.deepEqual(selected, before, "the summary does not shorten or remove any ballot fact");
});

test("a small sourced ballot keeps its full race and measure names in the composed prose", context => {
  const fetch = context.mock.method(globalThis, "fetch", () => { throw new Error("A small held ballot summary must not call a model"); });
  const selected = { ...raw, contests: raw.contests.filter(contest => ["ballot-az-pima:governor", "ballot-az-pima:prop-141"].includes(contest.id)) };
  const result = composeBallotOnlyAnswer(holdings(selected), "What is on my ballot?", "2026-10-21");
  assert.ok(result);
  assert.equal(result.verdict.kind, "PASSED");
  assert.match(result.composed.answer, /has 1 race and 1 ballot measure\./);
  assert.ok(result.composed.answer.includes(`The races are ${selected.contests.find(contest => contest.type === "CANDIDACY")!.title}.`));
  assert.match(result.composed.answer, /The measures are Proposition 141\./);
  assert.equal(result.composed.records.length, 2);
  assert.equal(fetch.mock.callCount(), 0);
});
