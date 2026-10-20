import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  allowedColumns,
  assertNoForbiddenColumns,
  normalizeProfileRows,
  parseCsv,
  shareSentence,
} from "../lib/sources/prl/index.ts";
import {
  PRL_CATEGORIES,
  PRL_RHETORIC_ATTRIBUTION,
  PRL_SURVEY_ATTRIBUTION,
  type PrlSnapshot,
} from "../lib/sources/prl/types.ts";

const ROOT = process.cwd();

// PRL numbers render as PRL's measurement, never in the app's voice; no rank, percentile or ideology score crosses
// the boundary; every share carries a stated base.

const FIXTURE_CSV = [
  allowedColumns().join(","),
  "A000001,Somebody A,120,all,2026-08-16,70.99,10,5,5,1",
  "B000002,Somebody B,40,all,2026-08-16,30,20,10,5,0",
].join("\n");

function snapshot(): PrlSnapshot {
  const { profiles, rosterMisses } = normalizeProfileRows(parseCsv(FIXTURE_CSV), ["A000001", "B000002"]);
  return {
    formatVersion: 1,
    fetchedAt: "2026-08-16T00:00:00.000Z",
    sourceFile: "fixture",
    sourceUrl: PRL_RHETORIC_ATTRIBUTION.url,
    rowsInFile: 2,
    rowsWithStatements: 2,
    profiles,
    rosterMisses,
    attribution: PRL_RHETORIC_ATTRIBUTION,
  };
}

test("D62: no rank, percentile or ideology score crosses the boundary", () => {
  // The filter is an allowlist so a new source column cannot arrive silently.
  assertNoForbiddenColumns(allowedColumns());
  for (const column of allowedColumns()) {
    assert.doesNotMatch(column, /rank|percentile|ideology|nominate/i, column);
  }
  assert.throws(
    () => assertNoForbiddenColumns([...allowedColumns(), "ideology_ideology"]),
    /refusing to read/,
    "the allowlist check must refuse an ideology score added to it",
  );

  // Keys, not serialized text: real member names contain these substrings.
  const snap = snapshot();
  for (const profile of snap.profiles) {
    for (const key of [...Object.keys(profile), ...Object.keys(profile.shares)]) {
      assert.doesNotMatch(
        key,
        /rank|percentile|ideology|score|rating|grade|match|fit|alignment|recommendation/i,
        `${profile.bioguideId} carries a forbidden key: ${key}`,
      );
    }
  }
});

test("D62: the attribution is the RHETORIC citation, not the survey one", () => {
  // The files used are on the rhetoric page, whose citation differs from the survey one.
  assert.match(PRL_RHETORIC_ATTRIBUTION.citation, /Congressional Rhetoric Dataset/);
  assert.match(PRL_RHETORIC_ATTRIBUTION.url, /\/elites\/data$/);
  assert.match(PRL_SURVEY_ATTRIBUTION.citation, /Westwood, S\. J\., & Lelkes, Y\./);
  assert.notEqual(PRL_RHETORIC_ATTRIBUTION.citation, PRL_SURVEY_ATTRIBUTION.citation);

  // The snapshot carries its attribution with the rows.
  const snap = snapshot();
  assert.equal(snap.attribution.citation, PRL_RHETORIC_ATTRIBUTION.citation);
  assert.match(snap.attribution.licenceUrl, /creativecommons\.org\/licenses\/by\//);
  assert.match(snap.attribution.licenceReadAt, /^\d{4}-\d{2}-\d{2}$/);
});

test("D62: a share is a percentage as PRL computed it, never a fraction we scaled", () => {
  // The `_mean` columns are already 0-100; scaling them again renders an impossible share.
  const snap = snapshot();
  for (const profile of snap.profiles) {
    for (const [key, value] of Object.entries(profile.shares)) {
      if (value === null) continue;
      assert.ok(
        value >= 0 && value <= 100,
        `${profile.bioguideId} ${key}: ${value} is outside 0-100`,
      );
    }
  }
  const sample = snap.profiles.find((p) => (p.shares.policy ?? 0) > 50);
  assert.ok(sample);
  const sentence = shareSentence(sample, "policy");
  assert.ok(sentence);
  assert.doesNotMatch(sentence, /\d{3,}%/, `a three-digit share rendered: ${sentence}`);
});

test("D62: every sentence is PRL's measurement, in PRL's name, with the count stated", () => {
  const snap = snapshot();
  const profile = snap.profiles[0];
  for (const category of PRL_CATEGORIES) {
    const sentence = shareSentence(profile, category.key);
    if (!sentence) continue;
    // Named, always: a PRL number in the app's own voice is the app making the measurement.
    assert.match(sentence, /Polarization Research Lab/);
    // The base rides with it — PRL's own pages print "Posts tracked: N".
    assert.match(sentence, /statements on file/);
    // And never a claim about belief, or about who was attacked.
    assert.doesNotMatch(sentence, /believes|supports|opposes|thinks|stance/i);
  }
});

test("D62: a member with no classified statements is a gap, never a silent drop", () => {
  const csv = [
    allowedColumns().join(","),
    "A000001,Somebody A,100,all,2026-08-16,50,10,10,10,1",
    "B000002,Somebody B,0,all,2026-08-16,0,0,0,0,0",
  ].join("\n");
  const result = normalizeProfileRows(parseCsv(csv), ["A000001", "B000002", "C000003"]);

  assert.equal(result.profiles.length, 1);
  // Every count stated.
  assert.equal(result.counts.rosterAsked, 3);
  assert.equal(result.counts.matched, 1);
  assert.equal(result.counts.droppedNoStatements, 1);
  // B has a row with nothing classified; C has no row at all. Both are
  // named, and neither renders as a member who says nothing.
  assert.deepEqual(result.rosterMisses, ["B000002", "C000003"]);
});

test("D62: a moved schema fails loudly rather than guessing which column replaced it", () => {
  const csv = ["bioguide_id,full_name", "A000001,Somebody"].join("\n");
  assert.throws(
    () => normalizeProfileRows(parseCsv(csv), ["A000001"]),
    /has no column/,
    "a missing column must stop the run",
  );
  assert.throws(() => normalizeProfileRows([], []), /zero rows/);
});

test("D62: the CSV reader survives a quoted field full of commas", () => {
  // The source embeds a long blob per member in one quoted cell, with commas throughout.
  const rows = parseCsv('a,b,c\n1,"x, y, z",3\n');
  assert.deepEqual(rows[1], ["1", "x, y, z", "3"]);
});

test("D62: PRL's race-competitiveness rating is not in this build", () => {
  // A race rating is a forecast, not a measurement.
  const source = [
    readFileSync(join(ROOT, "lib", "sources", "prl", "index.ts"), "utf8"),
    readFileSync(join(ROOT, "lib", "sources", "prl", "types.ts"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /competitiveness|toss[ -]?up|lean [DR]\b|likely [DR]\b/i);
});
