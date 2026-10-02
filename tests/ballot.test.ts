import assert from "node:assert/strict";
import { divisionIdsForZipArea } from "../lib/ballot/zip-divisions.ts";
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

/*
 * Resolved the way `app/ballot/page.tsx` resolves it — the zip's AREA, not just
 * its centroid (`NJ01`, 2026-08-22). A test that asked the narrower question
 * would pass on a build where Rockaway Borough had vanished from the page
 * again, which is exactly the regression it exists to catch.
 */
async function ballotAt(zip: string) {
  const r = resolveZip(zip);
  assert.ok(r.ok, `${zip} must resolve`);
  const set = ballotNjMorrisSource.normalize(await ballotNjMorrisSource.fetch());
  const divisions = await divisionsAt(r.centroid.lat, r.centroid.lng);
  const ocdIds = await divisionIdsForZipArea(zip, divisions.map((d) => d.ocdId));
  return { set, ...contestsForDivisions(set, ocdIds) };
}

test("the committed Morris file validates, and every record is cited", async () => {
  const [raw] = await ballotNjMorrisSource.fetch();
  validateBallotFile(raw);
  const set = ballotNjMorrisSource.normalize([raw]);
  /*
   * MINIMUMS, not equalities (2026-08-22). The file is no longer a hand
   * transcription frozen at six contests — `corepack pnpm nj:ballot --write`
   * regenerates it from the clerk's CURRENT documents, and the clerk revises on
   * its own schedule, so an equality here would fail every time the county
   * publishes and would be "fixed" by editing the number until it stopped
   * meaning anything.
   *
   * What the equality was actually guarding is kept and strengthened below: the
   * specific contests must be present BY ID, and the OCD join is asserted at
   * 07866 by name. A floor catches the failure that matters — the file
   * collapsing — while a ceiling only caught the county doing its job.
   */
  assert.ok(set.contests.length >= 80, `only ${set.contests.length} contests`);
  assert.ok(set.candidacies.length >= 250, `only ${set.candidacies.length} candidacies`);
  const contestIds = new Set(set.contests.map((c) => c.id));
  assert.equal(contestIds.size, set.contests.length, "duplicate contest ids");
  const candidacyIds = new Set(set.candidacies.map((c) => c.id));
  assert.equal(candidacyIds.size, set.candidacies.length, "duplicate candidacy ids");
  /*
   * The ids a reader's stored reactions hang off. Re-minting one orphans real
   * answers about a named person, invisibly — the new record simply has no
   * reactions rather than obviously wrong ones. Pinned by name so a generator
   * change cannot quietly break the join.
   */
  for (const id of [
    "ballot-nj-morris:us-senate",
    "ballot-nj-morris:us-house-11",
    "ballot-nj-morris:county-commissioner",
    "ballot-nj-morris:rockaway-twp-boe",
    "ballot-nj-morris:rockaway-twp-boe-unexpired",
    "ballot-nj-morris:morris-hills-regional-boe-rockaway-twp",
  ]) {
    assert.ok(contestIds.has(id), `contest id ${id} was not carried forward`);
  }
  assert.ok(candidacyIds.has("ballot-nj-morris:us-senate:booker"));
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

  // The join's denominator: every contest whose division reaches inside 07866.
  // Fewer than the six the hand transcription carried means the OCD join
  // silently broke.
  assert.ok(
    contests.length >= 6,
    `expected at least the original 6 contests at 07866, got ${contests.map((c) => c.id).join(", ")}`,
  );

  const byId = new Map(contests.map((c) => [c.id, c]));
  assert.ok(byId.has("ballot-nj-morris:us-senate"));
  assert.ok(byId.has("ballot-nj-morris:us-house-11"));
  assert.ok(byId.has("ballot-nj-morris:county-commissioner"));
  assert.ok(byId.has("ballot-nj-morris:rockaway-twp-boe"));
  assert.ok(byId.has("ballot-nj-morris:morris-hills-regional-boe-rockaway-twp"));

  const senate = set.candidacies.filter(
    (c) => c.contestId === "ballot-nj-morris:us-senate",
  );
  assert.equal(senate.length, 4, "four Senate candidates filed");

  // The clerk's own statement of municipal absence renders, cited — and the
  // no-public-question statement alongside it. A floor, because the generated
  // file now carries the clerk's NO LOCAL ELECTION statement for every
  // municipality that reaches this zip rather than only for Rockaway Township.
  assert.ok(absences.length >= 2, absences.map((a) => a.ocdId).join(", "));
});

/**
 * `NJ01` — Rockaway Borough and Rockaway Township are two governments in one
 * zip, and the product held only one of them.
 *
 * The Borough runs its own council and its own school district. Its residents
 * write 07866. The ballot page resolved the zip to a single ZCTA centroid,
 * which falls inside the TOWNSHIP, so a Borough resident entering their own zip
 * saw the Township's government, none of their own, and a four-candidate
 * council race that did not render at all.
 *
 * The four candidates are named here on purpose. A count would pass on a build
 * that rendered four of the Township's people under the Borough's heading,
 * which is the collapsed-join failure this session found three other instances
 * of on the same day.
 */
test("NJ01: a 07866 reader sees Rockaway BOROUGH's government, not only the Township's", async () => {
  const { set, contests } = await ballotAt("07866");
  const byId = new Map(contests.map((c) => [c.id, c]));

  const council = [...byId.values()].find(
    (c) => c.ocdId === "ocd-division/country:us/state:nj/place:rockaway" && /Council/i.test(c.title),
  );
  assert.ok(council, "the Rockaway Borough council contest does not render at 07866");
  assert.equal(council!.voteFor, 2);

  const running = set.candidacies
    .filter((c) => c.contestId === council!.id)
    .map((c) => c.familyName)
    .sort();
  assert.deepEqual(running, ["BURNSIDE", "DAWKINS, JR.", "MCDONALD", "NATALE"]);

  const boroBoe = [...byId.values()].find(
    (c) => c.ocdId === "ocd-division/country:us/state:nj/school_district:rockaway_borough_school_district",
  );
  assert.ok(boroBoe, "the Rockaway Borough school board contest does not render at 07866");

  /*
   * And the Township's own contests are untouched. Widening the resolver must
   * ADD the Borough, never trade one municipality for the other — that would be
   * the same defect pointed the other way.
   */
  assert.ok(byId.has("ballot-nj-morris:rockaway-twp-boe"));

  /*
   * The two Rockaway school districts must never share a division. They differ
   * by one word and were collapsed onto one another once already, which put the
   * Borough's children in front of the Township's board.
   */
  assert.notEqual(boroBoe!.ocdId, byId.get("ballot-nj-morris:rockaway-twp-boe")!.ocdId);
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
  /*
   * Denominators, moved 2026-08-27 and each move sourced.
   *
   * CANDIDACY 9 -> 10: Corporation Commissioner. It was omitted because no
   * source stated how many of the five seats were scheduled this cycle, and a
   * guessed seat count is a claim. The Pima County Official Candidate List
   * states it — "Vote for not more than 2" — so the contest is now carried.
   *
   * MEASURES 11 -> 12: Proposition 425, Pima County's Permanent Base
   * Adjustment. It is a COUNTY measure, so unlike the eleven statewide ones it
   * is cited to the county rather than to the Legislative Council.
   */
  assert.equal(candidacy.length, 10, candidacy.map((c) => c.id).join(", "));
  assert.equal(measures.length, 12, measures.map((c) => c.id).join(", "));

  const ids = new Set(contests.map((c) => c.id));
  assert.ok(ids.has("ballot-az-pima:us-house-7"));
  assert.ok(ids.has("ballot-az-pima:state-house-20"));
  assert.ok(!ids.has("ballot-az-pima:us-house-6"), "CD-6 must not leak into 85701");

  /*
   * Every STATEWIDE measure links the Legislative Council's adopted analysis.
   *
   * The Council analyses statewide measures and nothing else, so a county or
   * school-district measure has no Council analysis to link and never will.
   * The assertion is therefore scoped to the division it was always about, and
   * the local measures are held to their OWN referring authority instead —
   * which is a stricter test than dropping them from the loop, not a looser
   * one.
   */
  const statewide = measures.filter(
    (m) => m.ocdId === "ocd-division/country:us/state:az",
  );
  assert.equal(statewide.length, 11, statewide.map((m) => m.id).join(", "));
  for (const m of statewide) {
    assert.match(m.provenance.sourceUrl ?? "", /azleg\.gov.*2026BallotMeasures/);
  }
  for (const m of measures.filter((m) => !statewide.includes(m))) {
    assert.match(
      m.provenance.sourceUrl ?? "",
      /pima/,
      `${m.id}: a local measure cites the authority that referred it`,
    );
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
  // Executive Council 2, county commissioner 2, five county offices, and
  // the statewide CACR 13 question = 13 contests — the full November slate (2026-08-16 correction: the thin-
  // ballot finding held only for town/school offices, which decide in March).
  assert.equal(contests.length, 13, contests.map((c) => c.id).join(", "));

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
  const march = absences.filter((a) => /March/.test(a.statement));
  assert.equal(march.length, 2, "both March town-meeting absences stand");
  assert.ok(
    contests.some((contest) => contest.id === "ballot-nh-merrimack:cacr-13" && contest.type === "MEASURE"),
    "the Secretary of State's current statewide question must render as a measure",
  );
  assert.ok(
    set.measures.some((measure) => measure.contestId === "ballot-nh-merrimack:cacr-13"),
    "the CACR 13 contest must carry the General Court's official question text",
  );

  // Our unmapped-districts gap is stated, never smoothed over.
  assert.ok((set.coverageNotes ?? []).length > 0);
});

/**
 * **THE ELECTION AUTHORITY IS NOT ALWAYS THE SECRETARY OF STATE.**
 *
 * This allowed three hosts — the state Secretary of State and the Legislative
 * Council — which was right while the file held statewide contests only. It is
 * wrong for the tier this product actually reaches, and A.R.S. § 16-928 says
 * so in as many words: filings route to the Secretary of State for statewide
 * and legislative offices, to **the county officer in charge of elections**
 * for county, school-district and special-taxing-district offices, and to the
 * city or town clerk for municipal ones.
 *
 * So the list is by AUTHORITY, each entry naming which authority it is and for
 * what. A URL that is merely official is still not enough: it has to be the
 * body that runs, refers or files the thing being cited.
 */
const ELECTION_AUTHORITIES: { pattern: RegExp; who: string }[] = [
  { pattern: /^https:\/\/azsos\.gov\//, who: "Arizona Secretary of State" },
  {
    pattern: /^https:\/\/apps\.azsos\.gov\//,
    who: "Arizona Secretary of State — the application host its own election pages link, and where the certified county canvasses are published",
  },
  { pattern: /^https:\/\/www\.azleg\.gov\//, who: "Arizona Legislative Council" },
  {
    pattern: /^https:\/\/content\.civicplus\.com\/api\/assets\/az-pimacounty\//,
    who: "Pima County Elections Department — the county officer in charge of elections under A.R.S. § 16-928, publishing through its own CMS asset host",
  },
  {
    pattern: /^https:\/\/www\.schools\.pima\.gov\//,
    who: "Pima County School Superintendent — the filing officer for school-district ballot measures and governing-board candidates in this county",
  },
  {
    pattern: /^https:\/\/pima\.legistar\.com\//,
    who: "Pima County Board of Supervisors — the body that cancels an uncontested school-district election and appoints to the seat",
  },
  { pattern: /^https:\/\/www\.sos\.nh\.gov\//, who: "New Hampshire Secretary of State" },
];

test("every AZ and NH ballot record is cited to an official source", async () => {
  for (const state of ["az", "nh"]) {
    const entry = BALLOT_SOURCES.find((s) => s.state === state);
    assert.ok(entry);
    const set = entry.source.normalize(await entry.source.fetch());
    for (const record of [...set.contests, ...set.candidacies, ...set.absences]) {
      const url = record.provenance.sourceUrl ?? "";
      assert.ok(
        ELECTION_AUTHORITIES.some((a) => a.pattern.test(url)),
        `${state}: ${url} is not one of the named election authorities — ` +
          `add the authority and say which body it is, or cite one that is already listed`,
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
      join(process.cwd(), "data", "states", "az", "ballot", "az-general-lineup-2026.json"),
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
    readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8"),
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

test("official navigation selects only the supplied canonical state records", async () => {
  const { pollingPlaceLinkFor } = await import("../lib/ballot/polling-place-links.ts");
  const { registrationLinkFor } = await import("../lib/ballot/registration-links.ts");
  const { POLLING_LINKS, REGISTRATION_LINKS } = await import("./helpers/ballot-navigation.ts");
  assert.equal(pollingPlaceLinkFor("NY", POLLING_LINKS)?.url, POLLING_LINKS[0].url);
  assert.equal(registrationLinkFor("NY", REGISTRATION_LINKS)?.url, REGISTRATION_LINKS[0].url);
  assert.equal(pollingPlaceLinkFor("AZ", POLLING_LINKS), null);
  assert.equal(registrationLinkFor("NH", REGISTRATION_LINKS), null);
  assert.equal(pollingPlaceLinkFor("NY", []), null);
  assert.equal(registrationLinkFor("NY", []), null);
});
/**
 * **F21, amended 2026-08-20 by the author's ruling. The guard's intent
 * survives; its arithmetic does not.**
 *
 * This test used to read, in full:
 *
 * > `test("item 6: the ballot page renders the polling-place pointer in both
 * > places", ...)` — "Both surfaces the brief named: the dates header and the
 * > checker box." `assert.equal(occurrences, 2, "the pointer resolves N
 * > time(s); it belongs in the dates header AND the checker box")`
 *
 * It now reads as below: the pointer is required ONCE PER PAGE, in the dates
 * header.
 *
 * WHY THE OLD FORM WAS RIGHT WHEN IT WAS WRITTEN. On 2026-08-15 the two
 * surfaces were LINKS, in different surrounding context, and a reader
 * arriving at either one found the answer. Item 15 (2026-08-19) turned both
 * into the same in-app `WhereToVote` pill, and two identical controls read
 * worse than the two links had: a repeated identical control makes a reader
 * wonder which one is the real one. That is reader friction, which
 * `CLAUDE.md` ranks with a wrong number, and it claims none of the four
 * exceptions.
 *
 * WHAT DID NOT CHANGE, and it is the whole point of keeping a guard here: a
 * reader must always be able to FIND the pointer. Duplication was a means to
 * that, never the end. So the count moves from 2 to 1 and the required
 * LOCATION becomes explicit — a pointer that drifted out of the dates header
 * into some third place would satisfy a bare count and fail the intent.
 */
test("F21: the ballot page renders the polling-place pointer exactly once, in the dates header", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");
  assert.ok(page.includes("pollingPlaceLinkFor"), "the ballot page never asks for it");

  const pointerCall = "pollingPlaceLinkFor(set.election.state, pollingPlaceLinks)";
  const occurrences = page.split(pointerCall).length - 1;
  assert.equal(
    occurrences,
    1,
    `the pointer resolves ${occurrences} time(s); once per page, in the dates header (F21)`,
  );

  // Location, not just count. The dates header is the block that also
  // resolves the registration deadline and early-voting steps.
  const header = page.indexOf("const reg = registrationLinkFor(set.election.state, registrationLinks);");
  const pointer = page.indexOf(pointerCall);
  assert.ok(header >= 0 && pointer > header, "the pointer left the dates header");
  /*
   * **AZ-4 and AZ-5 (2026-08-23) — the checker box this used to point at is
   * DELETED, so the assertion that named it is replaced rather than dropped.**
   *
   * It read `page.indexOf("registration checker, prominent") > pointer`, which
   * proved the polling pointer sat ABOVE the separate registration card. That
   * card was the third appearance of one destination inside about ten lines
   * and the author ruled it down to one pill inside the next-election box. The
   * intent the old line carried — the pointer lives in the dates header, not
   * in some third place below it — is now proved against the section's own
   * closing tag, which cannot be satisfied by a pill drifting further down the
   * page.
   */
  const sectionEnd = page.indexOf("</section>", pointer);
  assert.ok(sectionEnd > pointer, "the pointer is not inside the dates section at all");
  assert.ok(
    page.indexOf("registration checker, prominent") === -1,
    "the separate registration checker box is back — AZ-4 and AZ-5 deduplicated it to one pill",
  );

  /*
   * **AMENDED 2026-08-24 (BAL-2, BAL-3) — THE WARNING'S SUBJECT NO LONGER
   * EXISTS ON THIS PAGE.**
   *
   * This asserted `page.includes("{polls.note}")` — "the reader is never told
   * what the tool asks for" — where the tool is the state's polling-place
   * lookup and the note is *"You'll need your date of birth and either a
   * driver's licence number or the last four of your Social Security
   * number."*
   *
   * BAL-2 deleted the LINK to that tool: the author's ruling is that the pill
   * beside it already opens the same authority's answer, in-app, from data we
   * retrieved and sourced. With no tap that leaves, there is nothing to warn
   * about, and BAL-3 removed the warning for that reason rather than to make
   * the card shorter.
   *
   * What is asserted instead is the thing that still matters: the pointer is
   * the IN-APP pill, and the state's tool is not offered as a second route
   * beside it. `polls.note` is untouched in `lib/ballot/polling-place-links.ts`
   * — the fact is still recorded, it simply no longer renders.
   */
  assert.ok(
    !/own tool/.test(page),
    "the state's polling-place tool is being offered as a second route again (BAL-2)",
  );
});

/**
 * **AZ-4 and AZ-5 (item 5, 2026-08-23, the author's ruling) — the
 * registration destination reaches the reader ONCE.**
 *
 * From the 8/22 capture of the ballot near 85701, it appeared three times
 * inside about ten lines: an inline link on the registration-deadline line,
 * the Secretary of State named beneath it, and a third card below repeating
 * the same words. The author's ruling is one prominent pill, pointing at the
 * reader's Secretary of State, at the moment of need.
 *
 * The reason it may not simply be dropped as friction is stated in the rule
 * itself: **the Secretary of State is the only authoritative source for
 * registration status, the app cannot answer it, and a reader who trusts an
 * in-app answer and does not check loses their vote.** So it leaves the app
 * deliberately and says so at the point of the tap — the one place where
 * keeping the reader in the app would be the wrong call.
 */
test("AZ-4/AZ-5: the ballot resolves the registration link exactly once, and it is a labelled pill", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const page = readFileSync(join(process.cwd(), "app", "ballot", "page.tsx"), "utf8");

  const resolves = page.split("registrationLinkFor(set.election.state, registrationLinks)").length - 1;
  assert.equal(
    resolves,
    1,
    `the registration link resolves ${resolves} time(s); the author's ruling is one pill`,
  );

  const pills = page.split("data-registration-pill").length - 1;
  assert.equal(pills, 1, `${pills} registration pill(s) rendered; exactly one is the ruling`);

  assert.ok(
    page.includes("data-leaves-app\n                    className=\"voting-open-button\"") ||
      /data-leaves-app[\s\S]{0,120}voting-open-button/.test(page),
    "the registration pill must be labelled as leaving the app",
  );
  /*
   * **AMENDED 2026-08-24 (BAL-4) — THE WARNING IS ON THE CONTROL, NOT BESIDE
   * IT, AND THAT IS THE POINT OF THE AMENDMENT.**
   *
   * This asserted the sentence rendered as a paragraph under the pill. BAL-4's
   * spec for the next-election box admits the two dates and the two pills and
   * nothing else, so the paragraph came out — but the OBLIGATION it carried
   * did not, because this pill genuinely leaves the product and the friction
   * rule's own example is a link that springs a demand on an unwarned reader.
   *
   * So the assertion moves with the sentence: it must still be present, and it
   * must be reachable by a reader who cannot see the arrow. A `title` alone
   * would not be — it is invisible to a screen reader and to a touch device.
   */
  assert.ok(
    /only place this can be checked/.test(page),
    "the pill no longer says why it leaves — the Secretary of State is the system of record",
  );
  assert.ok(
    /aria-label=\{`\$\{reg\.label\}[\s\S]{0,200}leaves this app`\}/.test(page),
    "the leaving warning is not in the pill's accessible name, so a reader who cannot see the arrow is never told",
  );
});
