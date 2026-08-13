import assert from "node:assert/strict";
import test from "node:test";

import {
  ballotNjMorrisSource,
  contestsForDivisions,
  validateBallotFile,
} from "../lib/sources/ballot-nj-morris/index.ts";
import { electionDatesFor } from "../lib/ballot/election-dates.ts";
import { divisionsAt } from "../lib/registry/server.ts";
import { resolveZip } from "../lib/geo/zcta.ts";

/**
 * The S2 ballot source, against the committed curated file and the real
 * registry geometry. Counts are asserted with their denominators — an empty
 * contest or a zero-match join must fail loudly, never render as a thin
 * ballot.
 */

async function ballotAt(zip: string) {
  const r = resolveZip(zip);
  assert.ok(r.ok, `${zip} must resolve`);
  const set = ballotNjMorrisSource.normalize(await ballotNjMorrisSource.fetch());
  const divisions = await divisionsAt(r.centroid.lat, r.centroid.lng);
  return { set, ...contestsForDivisions(set, divisions.map((d) => d.ocdId)) };
}

test("the committed Morris file validates, and every record is cited", async () => {
  const [raw] = await ballotNjMorrisSource.fetch();
  validateBallotFile(raw);
  const set = ballotNjMorrisSource.normalize([raw]);
  assert.equal(set.contests.length, 6);
  assert.equal(set.candidacies.length, 15);
  for (const record of [...set.contests, ...set.candidacies, ...set.absences]) {
    assert.match(
      record.provenance.sourceUrl ?? "",
      /^https:\/\//,
      "every ballot record cites its filing",
    );
  }
});

test("a Rockaway Township voter sees every contest the clerk filed for 07866", async () => {
  const { set, contests, absences } = await ballotAt("07866");

  // The join's denominator: all six curated contests belong to divisions
  // covering the 07866 centroid — senate via the state walk, the rest by
  // containment. Fewer means the OCD join silently broke.
  assert.equal(
    contests.length,
    6,
    `expected all 6 contests at 07866, got ${contests.map((c) => c.id).join(", ")}`,
  );

  const byId = new Map(contests.map((c) => [c.id, c]));
  assert.ok(byId.has("ballot-nj-morris:us-senate"));
  assert.ok(byId.has("ballot-nj-morris:us-house-11"));
  assert.ok(byId.has("ballot-nj-morris:county-commissioner"));

  const senate = set.candidacies.filter(
    (c) => c.contestId === "ballot-nj-morris:us-senate",
  );
  assert.equal(senate.length, 4, "four Senate candidates filed");

  // The clerk's own statement of municipal absence renders, cited — and the
  // no-public-question statement alongside it.
  assert.equal(absences.length, 2, absences.map((a) => a.ocdId).join(", "));
});

test("the ballot never leaks across boundaries", async () => {
  // An Arizona zip matches nothing in a Morris County file. Zero here is the
  // correct answer, not a failure — the inverse of the 07866 assertion.
  const { contests } = await ballotAt("85641");
  assert.equal(contests.length, 0);
});

test("incumbency is unknown, never defaulted to false", async () => {
  // The clerk's filing does not state incumbency, so every row must carry
  // null — a false would silently claim every candidate is a challenger.
  const set = ballotNjMorrisSource.normalize(await ballotNjMorrisSource.fetch());
  for (const cand of set.candidacies) {
    assert.equal(cand.incumbent, null, `${cand.id} claims incumbency knowledge`);
  }
});

test("the NJ date strip is complete and cited", () => {
  const dates = electionDatesFor("NJ");
  assert.ok(dates);
  assert.equal(dates.electionDay, "2026-11-03");
  const labels = dates.steps.map((s) => s.label).join(" | ");
  for (const needed of ["registration", "Mail ballots", "early voting", "Election Day"]) {
    assert.match(labels, new RegExp(needed, "i"), `date strip is missing ${needed}`);
  }
  assert.match(dates.sourceUrl, /^https:\/\/www\.nj\.gov\//);
});
