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

/**
 * The AZ and NH surfaces (2026-08-14), through the shared registry — the
 * same joins, denominators stated.
 */
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import { BALLOT_COVERED_STATES } from "../lib/ballot/covered-states.ts";

async function registryBallotAt(zip: string) {
  const r = resolveZip(zip);
  assert.ok(r.ok, `${zip} must resolve`);
  const divisions = await divisionsAt(r.centroid.lat, r.centroid.lng);
  const ocdIds = divisions.map((d) => d.ocdId);
  for (const { source } of BALLOT_SOURCES) {
    const set = source.normalize(await source.fetch());
    const hit = contestsForDivisions(set, ocdIds);
    if (hit.contests.length > 0 || hit.absences.length > 0) {
      return { set, ...hit };
    }
  }
  throw new Error(`${zip}: no ballot source matched`);
}

test("the client's covered-state list agrees with the registry", () => {
  assert.deepEqual(
    [...BALLOT_COVERED_STATES].sort(),
    BALLOT_SOURCES.map((s) => s.state).sort(),
    "covered-states.ts and ballot registry drifted apart",
  );
});

test("a Tucson voter (85701) sees the statewide slate, CD-7, LD-20 and the measures", async () => {
  const { set, contests } = await registryBallotAt("85701");
  assert.equal(set.election.state, "AZ");

  const candidacy = contests.filter((c) => c.type === "CANDIDACY");
  const measures = contests.filter((c) => c.type === "MEASURE");
  // Denominators: 6 statewide offices + CD7 + LD20 senate + LD20 house = 9
  // candidacy contests; 11 statewide measures.
  assert.equal(candidacy.length, 9, candidacy.map((c) => c.id).join(", "));
  assert.equal(measures.length, 11);

  const ids = new Set(contests.map((c) => c.id));
  assert.ok(ids.has("ballot-az-pima:us-house-7"));
  assert.ok(ids.has("ballot-az-pima:state-house-20"));
  assert.ok(!ids.has("ballot-az-pima:us-house-6"), "CD-6 must not leak into 85701");

  // Every measure links the Legislative Council's adopted analysis.
  for (const m of measures) {
    assert.match(m.provenance.sourceUrl ?? "", /azleg\.gov.*2026BallotMeasures/);
  }

  // The no-U.S.-Senate absence is stated and cited, never implied.
  const { absences } = await registryBallotAt("85701");
  assert.ok(
    absences.some((a) => a.statement.includes("No U.S. Senate seat")),
    "the cited absence of a Senate race must render",
  );
});

test("a Vail voter (85641) sees CD-6 and LD-19, never Tucson's districts", async () => {
  const { contests } = await registryBallotAt("85641");
  const ids = new Set(contests.map((c) => c.id));
  assert.ok(ids.has("ballot-az-pima:us-house-6"));
  assert.ok(ids.has("ballot-az-pima:state-senate-19"));
  assert.ok(!ids.has("ballot-az-pima:us-house-7"));
  assert.ok(!ids.has("ballot-az-pima:state-house-20"));
});

test("a Newbury voter (03255) sees the November slate, and March is stated, not hidden", async () => {
  const { set, contests, absences } = await registryBallotAt("03255");
  assert.equal(set.election.state, "NH");

  // Denominator: governor, US senate, CD2, state senate 7, Merrimack 7,
  // Executive Council 2, county commissioner 2, and five county offices = 12
  // contests — the full November slate (2026-08-16 correction: the thin-
  // ballot finding held only for town/school offices, which decide in March).
  assert.equal(contests.length, 12, contests.map((c) => c.id).join(", "));

  const ids = new Set(contests.map((c) => c.id));
  assert.ok(ids.has("ballot-nh-merrimack:us-senate"));
  assert.ok(ids.has("ballot-nh-merrimack:state-house-merrimack-7"));
  assert.ok(ids.has("ballot-nh-merrimack:executive-council-2"));
  assert.ok(ids.has("ballot-nh-merrimack:county-commissioner-2"));

  // Both once-missing contests carry filed candidates, not empty shells.
  const ec = set.candidacies.filter(
    (c) => c.contestId === "ballot-nh-merrimack:executive-council-2",
  );
  assert.equal(ec.length, 3, "EC District 2: Liot Hill, Menard, Strathdee");
  const commissioner = set.candidacies.filter(
    (c) => c.contestId === "ballot-nh-merrimack:county-commissioner-2",
  );
  assert.equal(commissioner.length, 3, "Commissioner D2: Ribas, Bilodeau, French");

  const senate = set.candidacies.filter(
    (c) => c.contestId === "ballot-nh-merrimack:us-senate",
  );
  assert.equal(senate.length, 13, "13 filed for the open Senate seat");

  // The town-meeting finding renders as the authority's own structure — the
  // March town election — for both the town and the school district.
  assert.equal(absences.length, 2, absences.map((a) => a.ocdId).join(", "));
  for (const a of absences) assert.match(a.statement, /March/);

  // Our unmapped-districts gap is stated, never smoothed over.
  assert.ok((set.coverageNotes ?? []).length > 0);
});

test("every AZ and NH ballot record is cited to an official source", async () => {
  for (const state of ["az", "nh"]) {
    const entry = BALLOT_SOURCES.find((s) => s.state === state);
    assert.ok(entry);
    const set = entry.source.normalize(await entry.source.fetch());
    for (const record of [...set.contests, ...set.candidacies, ...set.absences]) {
      assert.match(
        record.provenance.sourceUrl ?? "",
        /^https:\/\/(azsos\.gov|www\.azleg\.gov|www\.sos\.nh\.gov)\//,
        `${state}: every record cites the election authority or Legislative Council`,
      );
    }
  }
});

/**
 * The certified general lineup (6a): nominees render from the canvass, the
 * canvass is cited, and every lineup contest keys to a real filed contest.
 */
test("the AZ general lineup cites the certified canvass and keys to real contests", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const lineup = JSON.parse(
    readFileSync(
      join(process.cwd(), "data", "ballot", "az-general-lineup-2026.json"),
      "utf8",
    ),
  ) as {
    canvass: { url: string; issuedBy: string; readAt: string; readNote: string };
    contests: { contestId: string; nominees: { name: string; partyLabel: string }[] }[];
  };

  assert.match(
    lineup.canvass.url,
    /^https:\/\/apps\.azsos\.gov\/election\/2026\/canvass\//,
    "the lineup must cite the SOS canvass document itself",
  );
  assert.ok(
    lineup.canvass.readNote.length > 50,
    "how the scan was read is part of the citation",
  );

  const az = JSON.parse(
    readFileSync(join(process.cwd(), "data", "ballot", "az-pima-2026.json"), "utf8"),
  ) as { contests: { id: string; type: string }[] };
  const contestIds = new Set(az.contests.map((c) => c.id));

  assert.ok(lineup.contests.length >= 12, `expected 12 lineup contests, found ${lineup.contests.length}`);
  for (const contest of lineup.contests) {
    assert.ok(
      contestIds.has(contest.contestId),
      `${contest.contestId}: lineup for a contest that is not on the ballot file`,
    );
    assert.ok(
      contest.nominees.length >= 1,
      `${contest.contestId}: a lineup with no nominees is not a lineup`,
    );
    for (const nominee of contest.nominees) {
      assert.ok(nominee.name.length >= 5 && nominee.partyLabel.length >= 3);
    }
  }

  // The surface renders the lineup and retires the filing fallback.
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  assert.ok(page.includes("lineupForContest"), "the ballot page must render the lineup");
  assert.ok(
    page.includes("certified primary canvass"),
    "the canvass citation must be on the surface",
  );
});
