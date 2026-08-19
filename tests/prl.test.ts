import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  allowedColumns,
  assertNoForbiddenColumns,
  normalizeProfiles,
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

/**
 * D62 — the Polarization Research Lab, what members SAY.
 *
 * The doctrine these hold: PRL numbers render AS PRL'S MEASUREMENT and never
 * in the app's voice; the identical panel for every member; no rank, no
 * percentile and no ideology score crosses the boundary at any remove; and
 * every share carries a stated base.
 */

function snapshot(): PrlSnapshot {
  return JSON.parse(
    readFileSync(join(ROOT, "data", "prl", "prl-profiles.json"), "utf8"),
  ) as PrlSnapshot;
}

test("D62: the committed snapshot is real, and states its own denominators", () => {
  const snap = snapshot();
  assert.equal(snap.formatVersion, 1);
  // A snapshot that matched nothing must not read as a pass — the empty-feed
  // shape this codebase keeps naming.
  assert.ok(snap.profiles.length > 400, `only ${snap.profiles.length} profiles`);
  assert.ok(snap.rowsInFile >= snap.profiles.length);
  assert.ok(snap.rowsWithStatements > 0);
  assert.ok(Array.isArray(snap.rosterMisses));
  // The file it was built from is pinned by hash, so a later run can tell
  // whether the source moved or only our code did.
  assert.match(snap.sourceFile, /sha256 [0-9a-f]{64}/);
  assert.match(snap.sourceUrl, /^https:\/\/americaspoliticalpulse\.com\//);
});

test("D62: no rank, percentile or ideology score crosses the boundary", () => {
  // The source file carries 17 of them, including a single left-right
  // ideology number. Every one is exactly what CLAUDE.md forbids a record to
  // grow, and a rank does not become acceptable because a university
  // computed it. The filter is an ALLOWLIST so a new source column cannot
  // arrive silently.
  assertNoForbiddenColumns(allowedColumns());
  for (const column of allowedColumns()) {
    assert.doesNotMatch(column, /rank|percentile|ideology|nominate/i, column);
  }
  assert.throws(
    () => assertNoForbiddenColumns([...allowedColumns(), "ideology_ideology"]),
    /refusing to read/,
    "the allowlist check must refuse an ideology score added to it",
  );

  // And nothing in the committed snapshot's KEYS carries one either. Keys,
  // not the serialized text: real members are named Crank, Frankel and
  // Franklin, and a substring search over the whole file finds those.
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
  // The correction that made checking the page worth it. D62's row recorded
  // the survey citation; the files this build uses are on a different page
  // with a different one. Shipping the wrong string is an attribution error
  // under the licence that permits the use at all.
  assert.match(PRL_RHETORIC_ATTRIBUTION.citation, /Congressional Rhetoric Dataset/);
  assert.match(PRL_RHETORIC_ATTRIBUTION.url, /\/elites\/data$/);
  assert.match(PRL_SURVEY_ATTRIBUTION.citation, /Westwood, S\. J\., & Lelkes, Y\./);
  assert.notEqual(PRL_RHETORIC_ATTRIBUTION.citation, PRL_SURVEY_ATTRIBUTION.citation);

  // The snapshot carries its attribution with the rows, the way
  // LEGISCAN_ATTRIBUTION does, so it cannot drift from the data it covers.
  const snap = snapshot();
  assert.equal(snap.attribution.citation, PRL_RHETORIC_ATTRIBUTION.citation);
  assert.match(snap.attribution.licenceUrl, /creativecommons\.org\/licenses\/by\//);
  assert.match(snap.attribution.licenceReadAt, /^\d{4}-\d{2}-\d{2}$/);
});

test("D62: a share is a percentage as PRL computed it, never a fraction we scaled", () => {
  // THE DEFECT THE REAL FILE CAUGHT. The `_mean` columns are 0-100, not
  // 0-1, and the first sentence builder multiplied by 100 — Mark Kelly's
  // policy share would have rendered as "7099%". Obvious at that size;
  // the same error at 0.7 would have read "1%" and looked fine.
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
    // Named, always: a PRL number in the app's own voice is the app making
    // the measurement.
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
  const result = normalizeProfiles(csv, ["A000001", "B000002", "C000003"]);

  assert.equal(result.profiles.length, 1);
  // Every count stated: a run that returned one row of three asked-for must
  // say which of the two other things happened to each.
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
    () => normalizeProfiles(csv, ["A000001"]),
    /has no column/,
    "a missing column must stop the run",
  );
  assert.throws(() => normalizeProfiles("", []), /zero rows/);
});

test("D62: the CSV reader survives a quoted field full of commas", () => {
  // The source file embeds a whole ProPublica blob per member, in one
  // quoted cell, with commas and colons throughout. A split(",") reader
  // mis-columns every row after it and reads plausible garbage.
  const rows = parseCsv('a,b,c\n1,"x, y, z",3\n');
  assert.deepEqual(rows[1], ["1", "x, y, z", "3"]);
});

test("D62: PRL's race-competitiveness rating is not in this build", () => {
  // The one exclusion D62 recorded as a recommendation: a "Toss Up" rating
  // on a partisan gradient is a FORECAST, not a measurement — handicapping,
  // and telling readers whose race matters suppresses exactly the local
  // participation this product exists for. Same family as never-rank.
  const source = [
    readFileSync(join(ROOT, "lib", "sources", "prl", "index.ts"), "utf8"),
    readFileSync(join(ROOT, "lib", "sources", "prl", "types.ts"), "utf8"),
  ].join("\n");
  assert.doesNotMatch(source, /competitiveness|toss[ -]?up|lean [DR]\b|likely [DR]\b/i);
});
