import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import assert from "node:assert/strict";
import test from "node:test";
import type { BallotWithTickets } from "../lib/ballot/tickets.ts";

const root = new URL("../", import.meta.url);
const evidence = new URL("data/ballot/ba01-pacific-wi-evidence/", root);
const data = JSON.parse(readFileSync(new URL("data/ballot/2026-general/wi.json", root), "utf8"));
const ballot = Object.values(data.ballots)[0] as BallotWithTickets;

test("Wisconsin county acquisitions preserve their exact official source capture bytes", () => {
  const captures = JSON.parse(readFileSync(new URL("captures.json", evidence), "utf8"));
  for (const capture of captures) {
    assert.equal(createHash("sha256").update(gunzipSync(readFileSync(new URL(capture.file, evidence)))).digest("hex"), capture.rawHash);
    assert.ok(data.sourceReceipt.sources.some((source: { rawHash: string; retrievedAt: string }) =>
      source.rawHash === capture.rawHash && source.retrievedAt === capture.retrievedAt));
  }
});

test("Wisconsin county additions retain a captured source for every candidate and preserve the full minor-party CD6 field", () => {
  const cd6 = ballot.contests.find(c => c.title === "Representative in Congress District 6");
  const choices = ballot.candidacies.filter(c => c.contestId === cd6?.id);
  assert.deepEqual(choices.map(c => [c.familyName, c.partyLabel]), [
    ["Glenn Grothman", "Republican"], ["Brad Smith", "Democratic"],
    ["Matthew Arndt", "Wisconsin Green Party"], ["Elizabeth Anne Fitzgibbon", "Independent"],
    ["Mike Thurow", "Independent"],
  ]);
  for (const candidate of ballot.candidacies.filter(c => c.id.startsWith("ba01-pacific-wi-"))) {
    assert.ok(data.sourceReceipt.sources.some((source: { requestedUrl: string; retrievedAt: string }) =>
      source.requestedUrl === candidate.provenance.sourceUrl && source.retrievedAt === candidate.provenance.collectedAt));
  }
});

test("county-office choices stay in their county and retain every source-listed designation equally", () => {
  const sheriff = ballot.contests.find(c => c.title === "Winnebago County Sheriff");
  assert.equal(sheriff?.ocdId, "ocd-division/country:us/state:wi/county:winnebago");
  const choices = ballot.candidacies.filter(c => c.contestId === sheriff?.id);
  assert.deepEqual(choices.map(c => [c.familyName, c.partyLabel]), [
    ["Darin M. Rice", "Republican"], ["Jason W. Rippl", "Democratic"],
    ["Danielle Falesnik", "Strong. Fair. Ready to Lead"],
  ]);
  for (const candidate of choices) {
    assert.equal(candidate.websiteUrl, null);
    assert.equal(candidate.incumbent, null);
    assert.equal(candidate.slogan, null);
  }
  const cd3 = ballot.contests.find(c => c.title === "Representative in Congress District 3");
  assert.equal(ballot.candidacies.filter(c => c.contestId === cd3?.id).length, 4);
});

test("Wisconsin joint tickets preserve the held running-mate IDs and the official printed pair", () => {
  assert.equal(ballot.candidateTickets?.length, 2);
  for (const ticket of ballot.candidateTickets ?? []) {
    const lead = ballot.candidacies.find(c => c.id === ticket.leadCandidacyId);
    const mate = ballot.candidacies.find(c => c.id === ticket.runningMate.id);
    assert.ok(lead);
    assert.ok(mate);
    assert.deepEqual(ticket.runningMate, mate);
    assert.ok(ticket.provenance.quote?.includes(`${lead.givenName} ${lead.familyName}/${mate.givenName} ${mate.familyName}`));
  }
});

test("Milwaukee bilingual ballots retain every city Assembly district and the full Green choice", () => {
  const districts = JSON.parse(readFileSync(new URL("milwaukee-assembly-district-ids.json", evidence), "utf8"));
  assert.equal(districts.features.length, 14);
  for (const feature of districts.features) {
    const district = feature.attributes.STASS;
    const contest = ballot.contests.find(c => c.ocdId === `ocd-division/country:us/state:wi/sldl:${district}`);
    assert.ok(contest, `Milwaukee Assembly ${district}`);
    assert.ok(ballot.candidacies.some(c => c.contestId === contest.id));
  }
  const contest = ballot.contests.find(c => c.ocdId === "ocd-division/country:us/state:wi/sldl:10");
  assert.deepEqual(ballot.candidacies.filter(c => c.contestId === contest?.id).map(c => [c.familyName, c.partyLabel]), [
    ["Darrin Madison", "Democratic"], ["Robert Longwell-Grice", "Wisconsin Green"],
  ]);
});

test("La Crosse AD95 and Green county races retain independent choices equally", () => {
  const ad95 = ballot.contests.find(c => c.ocdId === "ocd-division/country:us/state:wi/sldl:95");
  assert.equal(ballot.candidacies.filter(c => c.contestId === ad95?.id).length, 3);
  assert.ok(ballot.candidacies.some(c => c.contestId === ad95?.id && c.familyName === "Paul Michael Weber" && c.partyLabel === "Independent"));
  const clerk = ballot.contests.find(c => c.title === "Green County Clerk of Circuit Court");
  assert.equal(clerk?.ocdId, "ocd-division/country:us/state:wi/county:green");
  assert.deepEqual(ballot.candidacies.filter(c => c.contestId === clerk?.id).map(c => [c.familyName, c.partyLabel]), [
    ["Melanie Leutenegger", "Democratic"], ["Jennifer Prien", "Independent"],
  ]);
});

test("all seventeen Wisconsin Senate district fields are present, including the independent SD9 choice", () => {
  const senate = ballot.contests.filter(c => c.ocdId.includes("/sldu:"));
  assert.deepEqual(senate.map(c => Number(c.ocdId.split("/sldu:")[1])).sort((a, b) => a - b),
    [1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31, 33]);
  assert.equal(ballot.candidacies.filter(c => senate.some(race => race.id === c.contestId)).length, 33);
  const sd9 = senate.find(c => c.ocdId.endsWith("/sldu:9"));
  assert.deepEqual(ballot.candidacies.filter(c => c.contestId === sd9?.id).map(c => [c.familyName, c.partyLabel]),
    [["Amy Binsfeld", "Republican"], ["Christian Ellis", "Independent"]]);
});

test("new Wisconsin county races preserve Constitution and independent choices with equal fields", () => {
  for (const [title, expected] of [
    ["Walworth County Sheriff", [["Tom Hausner", "Republican"], ["Csaba Keller", "Constitution"]]],
    ["Calumet County Sheriff", [["Brett Bowe", "Republican"], ["Nick Sablich", "Independent"]]],
    ["Racine County Sheriff", [["Cary A. Madrigal", "Republican"], ["Donald E. Vandervest", "Democratic"]]],
  ] as const) {
    const contest = ballot.contests.find(c => c.title === title);
    assert.ok(contest);
    const people = ballot.candidacies.filter(c => c.contestId === contest.id);
    assert.deepEqual(people.map(c => [c.familyName, c.partyLabel]), expected);
    for (const candidate of people) {
      assert.equal(candidate.websiteUrl, null);
      assert.equal(candidate.incumbent, null);
      assert.equal(candidate.slogan, null);
    }
  }
  const senate = ballot.contests.find(c => c.ocdId.endsWith("/sldu:15"));
  assert.equal(ballot.candidacies.filter(c => c.contestId === senate?.id).length, 3);
  assert.ok(ballot.candidacies.some(c => c.contestId === senate?.id && c.familyName === "Christopher Dean" && c.partyLabel === "Serving People Not Parties"));
  const ad36 = ballot.contests.find(c => c.ocdId.endsWith("/sldl:36"));
  assert.deepEqual(ballot.candidacies.filter(c => c.contestId === ad36?.id).map(c => [c.familyName, c.partyLabel]),
    [["Jeffrey L. Mursau", "Republican"], ["Shena Chapman", "Independent"]]);
});

test("Vernon packet cross-county samples retain their printed county scopes and write-in-only office", () => {
  for (const county of ["vernon", "crawford", "richland"]) {
    for (const office of ["Sheriff", "Clerk of Circuit Court"]) {
      const title = county[0].toUpperCase() + county.slice(1) + " County " + office;
      assert.equal(ballot.contests.find(c => c.title === title)?.ocdId, `ocd-division/country:us/state:wi/county:${county}`);
    }
  }
  assert.ok(!ballot.contests.some(c => c.title === "Richland County Coroner"));
  const held = ballot.heldContests?.find(c => c.title === "Richland County Coroner");
  assert.ok(held);
  assert.equal(held.ocdId, "ocd-division/country:us/state:wi/county:richland");
  assert.match(held.reason, /only a write-in line/);
  assert.ok(!ballot.candidacies.some(c => c.contestId === held.id));
  for (const district of [3, 31, 33, 45, 49, 52, 56, 72, 74, 75, 83, 84, 96, 99]) {
    const contest = ballot.contests.find(c => c.ocdId.endsWith(`/sldl:${district}`));
    assert.ok(contest, `Assembly ${district}`);
    assert.equal(ballot.candidacies.filter(c => c.contestId === contest.id).length, [83, 84, 99].includes(district) ? 1 : 2);
  }
});

test("new Wisconsin samples retain all eight Assembly fields and the printed Barron sheriff choice", () => {
  const expected = new Map<number, string[]>([
    [27, ["Lindee Brill"]], [28, ["Rob Kreibich", "Robin Lillesve"]],
    [29, ["Treig Pronschinske", "Chris Danou"]], [38, ["William Penterman", "Terri Wenkman"]],
    [58, ["Bernie Newman", "Dennis D. Degenhardt"]], [59, ["Bradley Petersen", "Jack Holzman"]],
    [62, ["Mike Bellagio", "Angelina M. Cruz"]], [67, ["David Armstrong", "Indiana Thompson"]],
  ]);
  for (const [district, names] of expected) {
    const contest = ballot.contests.find(c => c.ocdId.endsWith(`/sldl:${district}`));
    assert.ok(contest);
    const choices = ballot.candidacies.filter(c => c.contestId === contest.id);
    assert.deepEqual(choices.map(c => c.familyName), names);
    assert.deepEqual(choices.map(c => c.partyLabel), names.length === 1 ? ["Republican"] : ["Republican", "Democratic"]);
    for (const candidate of choices) {
      assert.equal(candidate.websiteUrl, null);
      assert.equal(candidate.incumbent, null);
      assert.equal(candidate.slogan, null);
    }
  }
  const sheriff = ballot.contests.find(c => c.title === "Barron County Sheriff");
  assert.equal(sheriff?.ocdId, "ocd-division/country:us/state:wi/county:barron");
  assert.deepEqual(ballot.candidacies.filter(c => c.contestId === sheriff?.id).map(c => [c.familyName, c.partyLabel]), [["Jodi Kummet", "Republican"]]);
});

test("Wisconsin coverage distinguishes the official race schedule from the unverified candidate denominator", () => {
  const receipt = JSON.parse(readFileSync(new URL("race-schedule-capture.json", evidence), "utf8"));
  for (const capture of [receipt, receipt.officialLinkingCapture]) {
    assert.equal(createHash("sha256").update(gunzipSync(readFileSync(new URL(capture.file, evidence)))).digest("hex"), capture.rawHash);
  }
  const schedule = readFileSync(new URL(receipt.textFile, evidence), "utf8");
  for (const phrase of ["Eight (8) Representatives", "Seventeen (17) State Senators", "Ninety-nine (99) Representatives", "General Election – November 3, 2026"]) {
    assert.ok(schedule.includes(phrase), phrase);
  }
  const report = JSON.parse(readFileSync(new URL("comparison.json", evidence), "utf8"));
  const core = ballot.contests.filter(c => c.type === "CANDIDACY" &&
    (c.ocdId === "ocd-division/country:us/state:wi" && c.title !== "Lieutenant Governor" || /\/(?:cd|sldu|sldl):/.test(c.ocdId)));
  assert.equal(receipt.regularCoreRaceDenominator, 8 + 17 + 99 + 4);
  assert.equal(report.regularCoreRaceCoverage.expected, receipt.regularCoreRaceDenominator);
  assert.equal(report.regularCoreRaceCoverage.held, core.length);
  assert.equal(report.regularCoreRaceCoverage.missing, report.missingDistrictIds.assembly.length);
  assert.equal(core.length + report.missingDistrictIds.assembly.length, receipt.regularCoreRaceDenominator);
  assert.equal(receipt.candidateDenominatorVerified, false);
});

test("Madison 53703 Ward 51 matches each official listed race without claiming printed-sample or live acceptance", async () => {
  const { madisonAddressComparison } = await import("../scripts/ba01-pacific-wi-madison.mts");
  const comparison = madisonAddressComparison();
  assert.equal(comparison.ward, 51);
  assert.equal(comparison.zip, "53703");
  assert.equal(comparison.matchedCandidateContests, 8);
  assert.equal(comparison.matchedMeasures, 3);
  assert.equal(comparison.matchedCandidateChoices, 14);
  assert.equal(comparison.printedSampleStatus, "NOT_VERIFIED");
  assert.equal(comparison.liveStatus, "NOT_VERIFIED");
});

test("Tomah's certified sample adds both Assembly 70 choices equally and preserves its government linking receipt", () => {
  const contest = ballot.contests.find(c => c.ocdId === "ocd-division/country:us/state:wi/sldl:70");
  assert.ok(contest);
  const choices = ballot.candidacies.filter(c => c.contestId === contest.id);
  assert.deepEqual(choices.map(c => [c.familyName, c.partyLabel]), [
    ["Nancy VanderMeer", "Republican"], ["Stephanie Stuve Bodeen", "Democratic"],
  ]);
  for (const candidate of choices) {
    assert.equal(candidate.websiteUrl, null);
    assert.equal(candidate.incumbent, null);
    assert.equal(candidate.slogan, null);
    assert.equal(candidate.provenance.sourceUrl, contest.provenance.sourceUrl);
  }
  const captures = JSON.parse(readFileSync(new URL("captures.json", evidence), "utf8"));
  const capture = captures.find((row: { file: string }) => row.file === "tomah.pdf.gz");
  const linking = capture.officialLinkingCapture;
  assert.equal(linking.httpStatus, 200);
  assert.equal(linking.url, "https://townoftomah.wi.gov/elections");
  const parent = gunzipSync(readFileSync(new URL(linking.file, evidence)));
  assert.equal(createHash("sha256").update(parent).digest("hex"), linking.rawHash);
  assert.ok(parent.toString().includes("Notice%20of%20General%20Election%20and%20Sample%20Ballot%20N.pdf"));
});

test("Madison 53703 Central Library matches all races on its printed Ward 52 sample without covering Ward 51 or claiming live acceptance", async () => {
  const { madisonPrintedSampleComparison, madisonAddressComparison } = await import("../scripts/ba01-pacific-wi-madison.mts");
  const printed = madisonPrintedSampleComparison();
  assert.equal(printed.address, "201 W Mifflin St, Madison, Wisconsin, 53703");
  assert.equal(printed.ward, 52);
  assert.equal(printed.ballotStyle, "005");
  assert.equal(printed.matchedCandidateContests, 8);
  assert.equal(printed.matchedMeasures, 3);
  assert.equal(printed.matchedContests, 11);
  assert.equal(printed.matchedCandidateChoices, 14);
  assert.deepEqual(printed.missingContests, []);
  assert.deepEqual(printed.missingCandidates, []);
  assert.equal(printed.printedSampleStatus, "VERIFIED_FOR_THIS_ADDRESS");
  assert.equal(printed.liveStatus, "NOT_VERIFIED");
  assert.equal(madisonAddressComparison().printedSampleStatus, "NOT_VERIFIED");
});

test("Wisconsin normal assembler promotes verified races while explicitly retaining the empty office hold", async () => {
  const { runBallotPublication } = await import("../scripts/assemble-ballot-package.mts");
  const { MemoryRoutineDataStore } = await import("../lib/civic-data/store.ts");
  const { genericBallotProblems } = await import("../lib/ballot/generic-projection.ts");
  const { stateBallotScope } = await import("../lib/civic-data/state-scopes.ts");
  assert.deepEqual(genericBallotProblems({ kind: "ballot-contests", ballots: data.ballots }, "WI"), []);
  const environment = { WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control", WTP_SANCTIONED_WRITE: "routine-civic-data-promotion" };
  const prior = Object.fromEntries(Object.keys(environment).map(key => [key, process.env[key]]));
  Object.assign(process.env, environment);
  try {
    const store = new MemoryRoutineDataStore();
    const result = await runBallotPublication({ state: "WI", store });
    assert.equal(result.report.status, "PUBLISHED", result.report.reason ?? JSON.stringify(result.receipt));
    const pointer = await store.readPromotion<{ ballots: Record<string, BallotWithTickets> }>("BALLOT_CANDIDACY", stateBallotScope("ballot-contests", "WI"));
    assert.ok(pointer);
    const current = Object.values(pointer.payload.ballots)[0];
    assert.equal(current.contests.length, ballot.contests.length);
    assert.equal(current.candidacies.length, ballot.candidacies.length);
    assert.ok(result.report.heldContests?.some(c => c.title === "Richland County Coroner" && /only a write-in line/.test(c.reason)));
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
