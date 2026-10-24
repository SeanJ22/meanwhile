/** Replay separate certified-list and printed-sample address comparisons. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { ballotForDivisions } from "../lib/ballot/contests.ts";
import { ballotCandidateDisplayName } from "../lib/ballot/name-case.ts";
import { ballotCandidatePeople } from "../lib/ballot/tickets.ts";
import type { BallotSet } from "../lib/ballot/types.ts";

const root = new URL("../", import.meta.url);
const evidence = new URL("data/ballot/ba01-pacific-wi-madison-evidence/", root);
const listUrl = "https://elections.countyofdane.com/documents/pdf/What-s-on-the-Ballot-Nov-2026.pdf";
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/g, " ").trim();

export function madisonAddressComparison() {
  const captures = JSON.parse(readFileSync(new URL("captures.json", evidence), "utf8")) as {
    url: string; file: string; rawHash: string;
  }[];
  const raw = (file: string) => {
    const capture = captures.find(row => row.file === file + ".gz");
    assert.ok(capture, file);
    const bytes = gunzipSync(readFileSync(new URL(capture.file, evidence)));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.rawHash);
    return bytes;
  };
  raw("dane-general-certified-list.pdf");
  const geocode = JSON.parse(raw("madison-civic-address-geocode.json").toString("utf8"));
  assert.equal(geocode.candidates.length, 1);
  const address = geocode.candidates[0];
  assert.equal(address.score, 100);
  assert.equal(address.attributes.Postal, "53703");
  const wards = JSON.parse(raw("madison-civic-address-ward.json").toString("utf8"));
  assert.equal(wards.features.length, 1);
  const ward = wards.features[0].attributes["Madison.DATA_ADMIN.Madison_Wards.WARD"];
  assert.equal(ward, 51);
  const source = normalize(readFileSync(new URL("dane-general-certified-list.txt", evidence), "utf8"));
  assert.ok(source.includes("What’s on the Ballot (Dane County) – November 3, 2026"));
  const ad76 = source.split("State Assembly – District 76")[1]?.split("State Assembly – District 77")[0];
  assert.ok(ad76?.includes("51-53"), "The certified list places Madison Ward 51 in Assembly 76");

  const data = JSON.parse(readFileSync(new URL("data/ballot/2026-general/wi.json", root), "utf8"));
  const ballot = Object.values(data.ballots)[0] as BallotSet;
  const divisions = ["ocd-division/country:us/state:wi", "ocd-division/country:us/state:wi/county:dane",
    "ocd-division/country:us/state:wi/cd:2", "ocd-division/country:us/state:wi/sldl:76"];
  const projected = ballotForDivisions(ballot, divisions);
  const expected: { title: string; choices: [string, string][]; sourceLines: string[] }[] = [
    { title: "Governor / Lieutenant Governor", choices: [["Tom Tiffany / David Varnam", "Republican"], ["David Crowley / Sarah Godlewski", "Democratic"]], sourceLines: [] },
    { title: "Attorney General", choices: [["Eric Toney", "Republican"], ["Josh Kaul", "Democratic"]], sourceLines: ["Eric Toney (REP)", "Josh Kaul (DEM)"] },
    { title: "Secretary of State", choices: [["Jay Schroeder", "Republican"], ["JoCasta Zamarripa", "Democratic"], ["Pete Karas", "Wisconsin Green"]], sourceLines: ["Jay Schroeder (REP)", "JoCasta Zamarripa (DEM)", "Pete Karas (GRN)"] },
    { title: "State Treasurer", choices: [["John S. Leiber", "Republican"], ["Yee Leng Xiong", "Democratic"]], sourceLines: ["John S. Leiber (REP)", "Yee Leng Xiong (DEM)"] },
    { title: "Representative in Congress District 2", choices: [["Mark Pocan", "Democratic"]], sourceLines: ["Mark Pocan (DEM)"] },
    { title: "Representative to the Assembly District 76", choices: [["Nina Chat", "Republican"], ["Dina Nina Martinez-Rutherford", "Democratic"]], sourceLines: ["Nina Chat (REP)", "Dina Nina Martinez-Rutherford (DEM)"] },
    { title: "Dane County Sheriff", choices: [["Kalvin D. Barrett", "Democratic"]], sourceLines: ["Kalvin D. Barrett (DEM)"] },
    { title: "Dane County Clerk of Circuit Court", choices: [["Jeff Okazaki", "Democratic"]], sourceLines: ["Jeff Okazaki (DEM)"] },
  ];
  const kenosha = readFileSync(new URL("data/ballot/ba01-pacific-wi-evidence/kenosha.txt", root), "utf8");
  for (const [name, party] of expected[0].choices) assert.ok(kenosha.includes(`${name.replace(" / ", "/")} (${party})`));
  const rows = expected.map(row => {
    for (const line of row.sourceLines) assert.ok(source.includes(line), line);
    const contest = projected.contests.find(contest => contest.title === row.title);
    assert.ok(contest, row.title);
    const choices = projected.candidacies.filter(candidate => candidate.contestId === contest.id);
    const actual = choices.map(candidate => [normalize(ballotCandidateDisplayName(candidate)), candidate.partyLabel]);
    if (row.title === "Governor / Lieutenant Governor") for (const choice of choices) {
      assert.ok(choice.ticket, "the joint choice keeps both individual person cards");
      const original = ballot.candidateTickets?.find(ticket => ticket.leadCandidacyId === choice.id);
      assert.ok(original, "the projected choice keeps its source's explicit ticket");
      assert.equal(choice.ticket.runningMate.id, original.runningMate.id);
      assert.deepEqual(ballotCandidatePeople(choice).map(person => person.id), [choice.id, original.runningMate.id]);
    }
    assert.deepEqual(actual, row.choices, row.title);
    return { title: row.title, type: "CANDIDACY", expectedChoices: row.choices.length, actualChoices: actual.length,
      choices: actual, matched: true, sourceUrl: row.sourceLines.length ? listUrl : "https://www.kenoshacountywi.gov/DocumentCenter/View/31758/11-3-2026-RACES-CANDIDATES-REFERENDUMS" };
  });
  const measures = projected.measures.map(measure => {
    const contest = projected.contests.find(contest => contest.id === measure.contestId);
    assert.ok(contest);
    assert.ok(source.includes(normalize(measure.questionText)), measure.officialNumber ?? contest.title);
    return { title: contest.title, officialNumber: measure.officialNumber, matched: true, sourceUrl: listUrl };
  });
  assert.equal(measures.length, 3);
  assert.equal(projected.contests.length, rows.length + measures.length);
  assert.equal(projected.candidacies.length, 14);
  return { zip: "53703", address: address.address, ward, divisions, electionDate: "2026-11-03",
    comparisonStatus: "OFFICIAL_CERTIFIED_LIST_AND_GIS_MATCH", printedSampleStatus: "NOT_VERIFIED", liveStatus: "NOT_VERIFIED",
    sourceUrls: captures.map(row => row.url), matchedCandidateContests: rows.length, matchedMeasures: measures.length,
    matchedContests: rows.length + measures.length, matchedCandidateChoices: projected.candidacies.length,
    missingContests: [], missingCandidates: [], rows, measures,
    limitations: ["This is one public civic address in 53703. Other addresses in the ZIP have not been compared.",
      "The city directs readers to MyVote for printed samples; MyVote returned HTTP 403 here. A printed sample and the live page still require verification.",
      "Dane’s PDF has a stale November 5 sentence and misspells Tiffany as Tiffay. Its heading is November 3, 2026; the governor spelling and joint tickets are verified against Kenosha’s preserved official list."] };
}

export function madisonPrintedSampleComparison() {
  const captures = JSON.parse(readFileSync(new URL("captures.json", evidence), "utf8")) as {
    url: string; finalUrl: string; file: string; rawHash: string; httpStatus: number;
  }[];
  const raw = (file: string) => {
    const capture = captures.find(row => row.file === file + ".gz");
    assert.ok(capture, file);
    assert.equal(capture.httpStatus, 200);
    const bytes = gunzipSync(readFileSync(new URL(capture.file, evidence)));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), capture.rawHash);
    return { capture, bytes };
  };
  const sample = raw("dane-style005.pdf");
  assert.ok(sample.bytes.subarray(0, 4).toString() === "%PDF");
  const parent = raw("bloominggrove-parent.html");
  const officialLinks = parent.bytes.toString().match(/href=["'][^"']+["']/g) ?? [];
  assert.ok(officialLinks.some(link => decodeURIComponent(link.slice(6, -1)) === decodeURIComponent(sample.capture.url)), "The official municipal parent links the exact sample PDF");
  const source = JSON.parse(readFileSync(new URL("dane-style005-reviewed.json", evidence), "utf8")) as {
    electionDate: string; ballotStyle: string; pageCount: number; printedMadisonWards: number[];
    candidateContests: { title: string; choices: [string, string][] }[];
    measures: { officialNumber: string; questionText: string }[];
  };
  assert.equal(source.electionDate, "2026-11-03");
  assert.equal(source.ballotStyle, "005");
  assert.equal(source.pageCount, 2);
  const geocode = JSON.parse(raw("madison-library-geocode.json").bytes.toString());
  assert.equal(geocode.candidates.length, 1);
  const address = geocode.candidates[0];
  assert.equal(address.score, 100);
  assert.equal(address.attributes.Postal, "53703");
  const wardCapture = raw("madison-library-ward.json");
  const queriedPoint = new URL(wardCapture.capture.url).searchParams.get("geometry");
  assert.equal(queriedPoint, `${address.location.x},${address.location.y}`);
  const wards = JSON.parse(wardCapture.bytes.toString());
  assert.equal(wards.features.length, 1);
  const ward = wards.features[0].attributes["Madison.DATA_ADMIN.Madison_Wards.WARD"];
  assert.equal(ward, 52);
  assert.ok(source.printedMadisonWards.includes(ward), "The printed reverse explicitly includes this city ward");
  assert.ok(!source.printedMadisonWards.includes(51), "This printed style must not be generalized to the separately checked Ward 51 address");
  const certified = madisonAddressComparison();
  const data = JSON.parse(readFileSync(new URL("data/ballot/2026-general/wi.json", root), "utf8"));
  const ballot = Object.values(data.ballots)[0] as BallotSet;
  const projected = ballotForDivisions(ballot, certified.divisions);
  const rows = source.candidateContests.map(row => {
    const contest = projected.contests.find(contest => contest.title === row.title);
    assert.ok(contest, row.title);
    const choices = projected.candidacies.filter(candidate => candidate.contestId === contest.id);
    const actual = choices.map(candidate => [normalize(ballotCandidateDisplayName(candidate)), candidate.partyLabel]);
    if (row.title === "Governor / Lieutenant Governor") for (const choice of choices) {
      assert.ok(choice.ticket, "the joint choice keeps both individual person cards");
      const original = ballot.candidateTickets?.find(ticket => ticket.leadCandidacyId === choice.id);
      assert.ok(original, "the projected choice keeps its source's explicit ticket");
      assert.equal(choice.ticket.runningMate.id, original.runningMate.id);
      assert.deepEqual(ballotCandidatePeople(choice).map(person => person.id), [choice.id, original.runningMate.id]);
    }
    assert.deepEqual(actual, row.choices, row.title);
    return { title: row.title, type: "CANDIDACY", expectedChoices: row.choices.length, actualChoices: actual.length,
      choices: actual, matched: true, sourceUrl: sample.capture.url };
  });
  const measures = source.measures.map(row => {
    const measure = projected.measures.find(measure => measure.officialNumber === row.officialNumber);
    assert.ok(measure, row.officialNumber);
    assert.equal(normalize(measure.questionText), normalize(row.questionText));
    const contest = projected.contests.find(contest => contest.id === measure.contestId);
    assert.ok(contest);
    return { title: contest.title, officialNumber: row.officialNumber, matched: true, sourceUrl: sample.capture.url };
  });
  assert.equal(projected.contests.length, rows.length + measures.length, "Every projected race must appear on this printed sample");
  assert.equal(projected.measures.length, source.measures.length);
  assert.equal(projected.candidacies.length, rows.reduce((total, row) => total + row.expectedChoices, 0));
  return { zip: "53703", address: address.address, ward, divisions: certified.divisions, electionDate: source.electionDate,
    ballotStyle: source.ballotStyle, comparisonStatus: "OFFICIAL_PRINTED_SAMPLE_AND_GIS_MATCH",
    printedSampleStatus: "VERIFIED_FOR_THIS_ADDRESS", liveStatus: "NOT_VERIFIED", sampleUrl: sample.capture.url,
    officialLinkingUrl: parent.capture.url, sourceUrls: captures.map(row => row.url),
    matchedCandidateContests: rows.length, matchedMeasures: measures.length,
    matchedContests: rows.length + measures.length, matchedCandidateChoices: projected.candidacies.length,
    missingContests: [], missingCandidates: [], rows, measures,
    limitations: ["This printed sample comparison covers Central Library, 201 W Mifflin St in Madison Ward 52, ZIP 53703. It does not establish every address in this ZIP.",
      "The separately checked City Hall address is in Ward 51, which is absent from this printed style; its printed sample remains unverified.",
      "This verifies the repository reader projection against official sources. The live page still requires verification."] };
}

if (process.argv[1]?.endsWith("ba01-pacific-wi-madison.mts")) {
  const report = madisonAddressComparison();
  const printed = madisonPrintedSampleComparison();
  if (process.argv.includes("--write-report")) {
    writeFileSync(new URL("comparison.json", evidence), JSON.stringify(report, null, 2) + "\n");
    writeFileSync(new URL("printed-comparison.json", evidence), JSON.stringify(printed, null, 2) + "\n");
  }
  console.log(JSON.stringify({ certifiedListAddress: report, printedSampleAddress: printed }, null, 2));
}
