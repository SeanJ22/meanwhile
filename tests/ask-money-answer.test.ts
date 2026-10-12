import assert from "node:assert/strict";
import test from "node:test";

import { campaignMoneyEvidenceFor } from "../lib/ask/campaign-money.ts";
import type { EvidencePack, EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import { overLengthBudget } from "../lib/ask/length-contract.ts";
import { asksOnlyMoney, financeQuestionAsked, financeQuestionAskedFor, financeRegimeNotesFor } from "../lib/ask/local-finance.ts";
import { composeMoneyAnswer, moneyQuestionShape, periodPhrase, raceWordsFitOffice, type MoneyAsk } from "../lib/ask/money-answer.ts";
import { gateRecordsToSubject } from "../lib/ask/relevance.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import type { CampaignMoney } from "../lib/funding/campaign-money.ts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import { stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";

const MONEY_RECORDS = [
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "AZ", "agency": "Arizona Secretary of State — See The Money", "filingsUrl": "https://seethemoney.az.gov/", "committeeId": "201800057", "registeredName": "Elect Katie Hobbs", "candidateNameAsFiled": "Katie Hobbs", "officeSought": "Governor", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 11109719.95, "expenditures": 14355612.69, "cashOnHand": null, "reportCount": null, "coveringPeriod": "Arizona 2026 election cycle, activity recorded 2025-01-01 through 2026-09-01"}, "targetKeys": ["ballot-az-pima:governor:hobbs-katie"], "match": {"registeredName": "Elect Katie Hobbs", "officeAsFiled": "Governor", "officeOnBallot": "Governor", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, exact Arizona seat and election cycle all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://seethemoney.az.gov/Reporting/GetNEWTableData/", "sourceOrg": "Arizona Secretary of State — See The Money", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NH", "agency": "New Hampshire Secretary of State — Campaign Finance System", "filingsUrl": "https://cfs.sos.nh.gov/", "committeeId": "207411", "registeredName": "Friends of Cinde Warmington ", "candidateNameAsFiled": "Cinde Warmington", "officeSought": "Governor", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 888256.7, "expenditures": 483777.32, "cashOnHand": null, "reportCount": null, "coveringPeriod": "2026 Election Cycle"}, "targetKeys": ["ballot-nh-merrimack:governor:warmington-cinde"], "match": {"registeredName": "Friends of Cinde Warmington ", "officeAsFiled": "Governor", "officeOnBallot": "Governor", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails", "sourceOrg": "New Hampshire Secretary of State — Campaign Finance System", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NH", "agency": "New Hampshire Secretary of State — Campaign Finance System", "filingsUrl": "https://cfs.sos.nh.gov/", "committeeId": "214321", "registeredName": "Kelly for New Hampshire", "candidateNameAsFiled": "Kelly Ayotte", "officeSought": "Governor", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 5995303.26, "expenditures": 3276135.21, "cashOnHand": null, "reportCount": null, "coveringPeriod": "2026 Election Cycle"}, "targetKeys": ["ballot-nh-merrimack:governor:ayotte-kelly"], "match": {"registeredName": "Kelly for New Hampshire", "officeAsFiled": "Governor", "officeOnBallot": "Governor", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails", "sourceOrg": "New Hampshire Secretary of State — Campaign Finance System", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NH", "agency": "New Hampshire Secretary of State — Campaign Finance System", "filingsUrl": "https://cfs.sos.nh.gov/", "committeeId": null, "registeredName": "", "candidateNameAsFiled": "", "officeSought": "Governor", "electionYear": 2026, "filingState": "NO_REPORTS_ON_FILE", "totals": {"receipts": null, "expenditures": null, "cashOnHand": null, "reportCount": null, "coveringPeriod": null}, "targetKeys": ["ballot-nh-merrimack:governor:fife-shaun"], "match": {"registeredName": "", "officeAsFiled": null, "officeOnBallot": "Governor", "electionYearAsFiled": null, "electionYearOnBallot": 2026, "allThreeAgree": false, "note": "the Campaign Finance System was searched for \"Fife\" on 2026-09-01; all 1 row(s) it states it holds under that name were retrieved, and none is a 2026 filer that could be this candidacy"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails", "sourceOrg": "New Hampshire Secretary of State — Campaign Finance System", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NH", "agency": "New Hampshire Secretary of State — Campaign Finance System", "filingsUrl": "https://cfs.sos.nh.gov/", "committeeId": "243715", "registeredName": "Harned, Rebecca ", "candidateNameAsFiled": "Rebecca Harned", "officeSought": "State Senate", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 77860.61, "expenditures": 5374.52, "cashOnHand": null, "reportCount": null, "coveringPeriod": "2026 Election Cycle"}, "targetKeys": ["ballot-nh-merrimack:state-senate-7:harned-rebecca"], "match": {"registeredName": "Harned, Rebecca ", "officeAsFiled": "State Senate", "officeOnBallot": "State Senator, District 7", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://cfsapi.sos.nh.gov/api/PublicFilerDetails/GetFilingEntityDetails", "sourceOrg": "New Hampshire Secretary of State — Campaign Finance System", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NJ", "agency": "New Jersey Election Law Enforcement Commission", "filingsUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation?entity=465973", "committeeId": "465973", "registeredName": "SELEN, TAYFUN", "candidateNameAsFiled": "SELEN, TAYFUN", "officeSought": "COUNTY COMMISSIONER", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 225025.5, "expenditures": 229525.5, "cashOnHand": null, "reportCount": 14, "coveringPeriod": "72/24 HR, D-1, R-1, RQ-2024, RQ-2025 through 2026-06-22"}, "targetKeys": ["ballot-nj-morris:county-commissioner:selen"], "match": {"registeredName": "SELEN, TAYFUN", "officeAsFiled": "COUNTY COMMISSIONER", "officeOnBallot": "Member of the Board of County Commissioners", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation", "sourceOrg": "New Jersey Election Law Enforcement Commission", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NJ", "agency": "New Jersey Election Law Enforcement Commission", "filingsUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation?entity=506264", "committeeId": "506264", "registeredName": "SELEN, TAYFUN", "candidateNameAsFiled": "SELEN, TAYFUN", "officeSought": "COUNTY COMMISSIONER", "electionYear": 2026, "filingState": "NO_REPORTS_ON_FILE", "totals": {"receipts": null, "expenditures": null, "cashOnHand": null, "reportCount": 1, "coveringPeriod": "D-1 through 2026-06-26"}, "targetKeys": ["ballot-nj-morris:county-commissioner:selen"], "match": {"registeredName": "SELEN, TAYFUN", "officeAsFiled": "COUNTY COMMISSIONER", "officeOnBallot": "Member of the Board of County Commissioners", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation", "sourceOrg": "New Jersey Election Law Enforcement Commission", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NJ", "agency": "New Jersey Election Law Enforcement Commission", "filingsUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation?entity=504216", "committeeId": "504216", "registeredName": "RUSSO, CHRISTOPHER", "candidateNameAsFiled": "RUSSO, CHRISTOPHER", "officeSought": "COUNTY COMMISSIONER", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 13615, "expenditures": 4297.16, "cashOnHand": null, "reportCount": 6, "coveringPeriod": "72/24 HR, D-1, R-1 through 2026-06-24"}, "targetKeys": ["ballot-nj-morris:county-commissioner:russo"], "match": {"registeredName": "RUSSO, CHRISTOPHER", "officeAsFiled": "COUNTY COMMISSIONER", "officeOnBallot": "Member of the Board of County Commissioners", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation", "sourceOrg": "New Jersey Election Law Enforcement Commission", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NJ", "agency": "New Jersey Election Law Enforcement Commission", "filingsUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation?entity=506507", "committeeId": "506507", "registeredName": "RUSSO, CHRISTOPHER", "candidateNameAsFiled": "RUSSO, CHRISTOPHER", "officeSought": "COUNTY COMMISSIONER", "electionYear": 2026, "filingState": "NO_REPORTS_ON_FILE", "totals": {"receipts": null, "expenditures": null, "cashOnHand": null, "reportCount": null, "coveringPeriod": "2026 GENERAL"}, "targetKeys": ["ballot-nj-morris:county-commissioner:russo"], "match": {"registeredName": "RUSSO, CHRISTOPHER", "officeAsFiled": "COUNTY COMMISSIONER", "officeOnBallot": "Member of the Board of County Commissioners", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation", "sourceOrg": "New Jersey Election Law Enforcement Commission", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NJ", "agency": "New Jersey Election Law Enforcement Commission", "filingsUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation?entity=504225", "committeeId": "504225", "registeredName": "MENARD, RAYMOND", "candidateNameAsFiled": "MENARD, RAYMOND", "officeSought": "MUNICIPAL OFFICE", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 0, "expenditures": 0, "cashOnHand": null, "reportCount": 1, "coveringPeriod": "A-1 through 2026-05-18"}, "targetKeys": ["ballot-nj-morris:boonton-township-member-of-the-township-committee-place-boonton-township:menard-raymond"], "match": {"registeredName": "MENARD, RAYMOND", "officeAsFiled": "MUNICIPAL OFFICE", "officeOnBallot": "Member of the Township Committee", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation", "sourceOrg": "New Jersey Election Law Enforcement Commission", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
  {"dataClass": "STATE_COMMITTEE", "jurisdiction": "NJ", "agency": "New Jersey Election Law Enforcement Commission", "filingsUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation?entity=506518", "committeeId": "506518", "registeredName": "MENARD, RAYMOND", "candidateNameAsFiled": "MENARD, RAYMOND", "officeSought": "MUNICIPAL OFFICE", "electionYear": 2026, "filingState": "FILED", "totals": {"receipts": 0, "expenditures": 0, "cashOnHand": null, "reportCount": 1, "coveringPeriod": "A-1 through 2026-08-27"}, "targetKeys": ["ballot-nj-morris:boonton-township-member-of-the-township-committee-place-boonton-township:menard-raymond"], "match": {"registeredName": "MENARD, RAYMOND", "officeAsFiled": "MUNICIPAL OFFICE", "officeOnBallot": "Member of the Township Committee", "electionYearAsFiled": 2026, "electionYearOnBallot": 2026, "allThreeAgree": true, "note": "name, office and election year all agree with the certified-ballot row"}, "checkedAt": "2026-09-01", "provenance": {"sourceUrl": "https://www.njelecefilesearch.com/SearchEntityByLocation", "sourceOrg": "New Jersey Election Law Enforcement Commission", "collectedAt": "2026-09-01", "verifiedAt": "2026-09-01"}},
] as StateMoneyRecord[];

/** The records the route would retrieve for one target, through the route's own selector. */
function heldEvidence(target: string, name: string): { subject: EvidenceSubject; records: EvidenceRecord[]; gaps: ReturnType<typeof campaignMoneyEvidenceFor>["gaps"] } {
  const shown = stateMoneyRecordsForDisplay(MONEY_RECORDS.filter((record) => record.targetKeys.includes(target)));
  const subject: EvidenceSubject = { kind: "PERSON", id: target, name };
  const select = (): CampaignMoney => ({
    requestedTargetKey: target, federal: { kind: "none" }, officialIdentity: "NOT_OFFICIAL",
    state: { records: shown, resolution: "DIRECT_CANDIDACY_KEY", resolvedTargetKey: target },
  });
  const evidence = campaignMoneyEvidenceFor(subject, target, undefined, select);
  const regime = financeRegimeNotesFor(subject, { state: evidence.denominators.stateFinanceRecordsReturned > 0, federal: false, county: false });
  return { subject, records: evidence.records, gaps: [...evidence.gaps, ...regime.map((note) => note.gap)] };
}

const pack = (subject: EvidenceSubject, records: EvidenceRecord[], question: string): EvidencePack => ({
  question, intent: "PERSON_RECORD", temporal: { kind: "NONE" }, subject, records, gaps: [], denominators: {}, today: "2026-09-25",
});

const AYOTTE = "ballot-nh-merrimack:governor:ayotte-kelly";
const WARMINGTON = "ballot-nh-merrimack:governor:warmington-cinde";
const HARNED = "ballot-nh-merrimack:state-senate-7:harned-rebecca";

test("the comparison that retrieved no money is now a money question, and so is every shape composed here", () => {
  // "raised MORE money" is a money question.
  assert.equal(financeQuestionAsked("Has Cinde Warmington raised more money than Kelly Ayotte?"), true);
  const accepted: [string, MoneyAsk["kind"], string, string?][] = [
    ["How much has Kelly Ayotte raised and spent?", "HOW_MUCH", "kelly ayotte"],
    ["How much campaign money has Katie Hobbs raised?", "HOW_MUCH", "katie hobbs"],
    ["How much money has Tayfun Selen raised for his campaign?", "HOW_MUCH", "tayfun selen"],
    ["How much has Rebecca Harned raised for her state senate race?", "HOW_MUCH", "rebecca harned"],
    ["How much has Katie Hobbs's campaign spent?", "HOW_MUCH", "katie hobbs"],
    ["What is Kelly Ayotte's cash on hand?", "HOW_MUCH", "kelly ayotte"],
    ["Who donated to Katie Hobbs's campaign?", "WHO_GAVE", "katie hobbs"],
    ["Who are Tayfun Selen's biggest donors?", "WHO_GAVE", "tayfun selen"],
    ["Who is funding Kelly Ayotte's campaign?", "WHO_GAVE", "kelly ayotte"],
    ["Who is funding Kelly Ayotte?", "WHO_GAVE", "kelly ayotte"],
    ["Who funds Andy Biggs?", "WHO_GAVE", "andy biggs"],
    ["Who is backing Katie Hobbs?", "WHO_GAVE", "katie hobbs"],
    ["Has Cinde Warmington raised more money than Kelly Ayotte?", "COMPARE", "cinde warmington", "kelly ayotte"],
    ["Who has raised more, Kelly Ayotte or Cinde Warmington?", "COMPARE", "kelly ayotte", "cinde warmington"],
    ["Has Katie Hobbs outraised Andy Biggs?", "COMPARE", "katie hobbs", "andy biggs"],
  ];
  for (const [question, kind, slot, other] of accepted) {
    const shape = moneyQuestionShape(question);
    assert.equal(shape?.ask.kind, kind, question);
    assert.equal(shape?.slot, slot, question);
    assert.equal(shape?.otherSlot, other, question);
    assert.equal(financeQuestionAskedFor(question, "PERSON"), true, `retrieval reads it as money too, for the person it binds: ${question}`);
  }
  assert.deepEqual(moneyQuestionShape("How much has Kelly Ayotte raised and spent?")?.ask, { kind: "HOW_MUCH", measures: ["RAISED", "SPENT"] });
  assert.equal(moneyQuestionShape("How much has Rebecca Harned raised for her state senate race?")?.raceWords, "state senate");
  for (const question of [
    "How much has Katie Hobbs raised in 2022?", // a year the held cycle may not be
    "How much has Katie Hobbs raised from oil companies?", // a qualifier the totals cannot answer
    "Who is funding the school district?", // a budget, not a campaign
    "How much has the county spent on roads?",
    "What has Katie Hobbs done?",
  ]) {
    assert.equal(moneyQuestionShape(question), null, question);
  }
});

test("a race the reader names must be the person's own office", () => {
  assert.equal(raceWordsFitOffice("state senate", "State Senator, District 7"), true);
  assert.equal(raceWordsFitOffice("governor", "Governor"), true);
  assert.equal(raceWordsFitOffice("state senate", "Governor"), false, "Ayotte is not in a state senate race");
  assert.equal(raceWordsFitOffice("district 8 senate", "State Senator, District 7"), false);
  assert.equal(raceWordsFitOffice("state senate", null), false, "an unknown office fits nothing");
});

test("the period is the agency's own, spelled for a reader; New Jersey's report codes are not read out", () => {
  const f = (coveringPeriod: string | null, reportCount: number | null = null) => periodPhrase({ electionYear: 2026, totals: { receipts: 1, expenditures: 1, cashOnHand: null, reportCount, coveringPeriod } });
  assert.equal(f("2026 Election Cycle"), "for the 2026 Election Cycle");
  assert.equal(f("Arizona 2026 election cycle, activity recorded 2025-01-01 through 2026-09-01"), "for the Arizona 2026 election cycle, activity recorded January 1st, 2025 through September 1st, 2026");
  assert.equal(f("72/24 HR, D-1, R-1, RQ-2024, RQ-2025 through 2026-06-22", 14), "in 14 reports filed through June 22nd, 2026");
  assert.equal(f(null), "for the 2026 election cycle");
  assert.equal(f("2026 GENERAL", 3), "for the 2026 GENERAL, across 3 reports");
});

test("how much: the committee's own figures, period, agency and read date — and it passes the validator", () => {
  const held = heldEvidence(AYOTTE, "Kelly Ayotte");
  const composed = composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED", "SPENT"] }, subject: held.subject, records: held.records, gaps: held.gaps });
  assert.equal(composed?.answer,
    "Kelly Ayotte's campaign committee, registered as \"Kelly for New Hampshire\", reported raising $5,995,303.26 and spending $3,276,135.21 for the 2026 Election Cycle. " +
    "Filed with the New Hampshire Secretary of State — Campaign Finance System; read September 1st, 2026. " +
    "These records describe the campaigns' own filings; they do not establish outside spending for or against Kelly Ayotte.");
  assert.deepEqual(composed?.citedUrls, ["https://cfs.sos.nh.gov/"]);
  assert.equal(validateAnswer(composed!.answer, composed!.citedUrls, pack(held.subject, held.records, "How much has Kelly Ayotte raised and spent?")).kind, "PASSED");
  // A figure asked for that the filing does not carry is said to be missing from OUR record, never $0.
  const cash = composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["CASH"] }, subject: held.subject, records: held.records, gaps: held.gaps });
  assert.match(cash?.answer ?? "", /Our record of this filing does not include cash on hand\./);
  assert.doesNotMatch(cash?.answer ?? "", /\$0\.00/);
});

test("Rebecca Harned and Cinde Warmington: the held NH filings are what the answer states", () => {
  const harned = heldEvidence(HARNED, "Rebecca Harned");
  assert.match(composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED"] }, subject: harned.subject, records: harned.records, gaps: harned.gaps })?.answer ?? "",
    /^Rebecca Harned's campaign committee, registered as "Harned, Rebecca", reported raising \$77,860\.61 and spending \$5,374\.52 for the 2026 Election Cycle\./);
  const warmington = heldEvidence(WARMINGTON, "Cinde Warmington");
  assert.match(composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED"] }, subject: warmington.subject, records: warmington.records, gaps: warmington.gaps })?.answer ?? "",
    /registered as "Friends of Cinde Warmington", reported raising \$888,256\.70/, "the registered name is trimmed of the agency's trailing space");
});

test("who gave: our records hold totals, not donor identities — said as OURS, counted, never put on the state", () => {
  const held = heldEvidence("ballot-az-pima:governor:hobbs-katie", "Katie Hobbs");
  const composed = composeMoneyAnswer({ ask: { kind: "WHO_GAVE" }, subject: held.subject, records: held.records, gaps: held.gaps });
  assert.ok(composed);
  assert.match(composed.answer, /^Our records for Katie Hobbs hold campaign totals, not the identities of donors \(money records we hold for this candidate that name a donor: 0 of 1\)\. /);
  assert.match(composed.answer, /The campaign committee, registered as "Elect Katie Hobbs", reported raising \$11,109,719\.95 and spending \$14,355,612\.69/);
  // The donor gap is ours, never put on the state.
  assert.doesNotMatch(composed.answer, /filed with Arizona describe|Arizona (?:does not|doesn't) (?:list|publish|name)|state (?:does not|doesn't) (?:list|publish|name)/i);
  assert.equal(validateAnswer(composed.answer, composed.citedUrls, pack(held.subject, held.records, "Who donated to Katie Hobbs's campaign?")).kind, "PASSED");
});

test("compare: each person's own figure, and a verdict only on like-for-like filings", () => {
  const warmington = heldEvidence(WARMINGTON, "Cinde Warmington");
  const ayotte = heldEvidence(AYOTTE, "Kelly Ayotte");
  const records = [...warmington.records, ...ayotte.records];
  const composed = composeMoneyAnswer({ ask: { kind: "COMPARE", measure: "RAISED" }, subject: warmington.subject, other: { id: AYOTTE, name: "Kelly Ayotte" }, records, gaps: warmington.gaps });
  assert.equal(composed?.answer,
    "Cinde Warmington's campaign committee, registered as \"Friends of Cinde Warmington\", reported raising $888,256.70, and " +
    "Kelly Ayotte's campaign committee, registered as \"Kelly for New Hampshire\", reported raising $5,995,303.26, both for the 2026 Election Cycle. " +
    "By these filings, \"Kelly for New Hampshire\" reported raising more. " +
    "Filed with the New Hampshire Secretary of State — Campaign Finance System; read September 1st, 2026. " +
    "These are the campaigns' own filings; they do not show outside spending for or against either candidate.");
  assert.equal(validateAnswer(composed!.answer, composed!.citedUrls, pack(warmington.subject, records, "Has Cinde Warmington raised more money than Kelly Ayotte?")).kind, "PASSED");
  // Missing the second person's records: no composition.
  assert.equal(composeMoneyAnswer({ ask: { kind: "COMPARE", measure: "RAISED" }, subject: warmington.subject, other: { id: AYOTTE, name: "Kelly Ayotte" }, records: warmington.records, gaps: [] }), null);
  // A person with no filing on record is stated as the agency's record states them — and no verdict is drawn.
  const fife = heldEvidence("ballot-nh-merrimack:governor:fife-shaun", "Shaun Fife");
  const mixed = composeMoneyAnswer({ ask: { kind: "COMPARE", measure: "RAISED" }, subject: ayotte.subject, other: { id: fife.subject.id, name: "Shaun Fife" }, records: [...ayotte.records, ...fife.records], gaps: [] });
  assert.match(mixed?.answer ?? "", /; the New Hampshire Secretary of State — Campaign Finance System had no reports on file for Shaun Fife as of September 1st, 2026\./);
  assert.doesNotMatch(mixed?.answer ?? "", /raising more|\$0\.00/);
  // Filings over different periods are stated side by side, never compared.
  const nj = MONEY_RECORDS.filter((record) => record.jurisdiction === "NJ" && record.filingState === "FILED");
  const single = [...new Set(nj.flatMap((record) => record.targetKeys))].filter((key) => nj.filter((record) => record.targetKeys.includes(key)).length === 1);
  const [x, y] = [heldEvidence(single[0], "Pat Q. Example"), heldEvidence(single[1], "Lee R. Sample")];
  const side = composeMoneyAnswer({ ask: { kind: "COMPARE", measure: "RAISED" }, subject: x.subject, other: { id: y.subject.id, name: "Lee R. Sample" }, records: [...x.records, ...y.records], gaps: [] });
  assert.match(side?.answer ?? "", /The two filings cover different reporting periods, so the figures are stated side by side and not compared\./);
  assert.equal(overLengthBudget(side!.answer), null, "two names with initials still fit: each person is named once");
});

test("every held filing state composes inside the length contract and passes the validator", () => {
  let composedCount = 0;
  {
    const targets = [...new Set(MONEY_RECORDS.flatMap((record) => record.targetKeys))];
    for (const target of targets) {
      const shown = stateMoneyRecordsForDisplay(MONEY_RECORDS.filter((record) => record.targetKeys.includes(target)));
      if (!shown.length || shown.every((record) => record.filingState === "OURS_GAP")) continue;
      // A name with an initial: "R. " counts as a sentence end in the length contract.
      const held = heldEvidence(target, "Pat Q. Example");
      for (const ask of [{ kind: "HOW_MUCH", measures: ["RAISED", "SPENT"] }, { kind: "WHO_GAVE" }] as MoneyAsk[]) {
        const composed = composeMoneyAnswer({ ask, subject: held.subject, records: held.records, gaps: held.gaps });
        assert.ok(composed, `${target} ${ask.kind} composes`);
        assert.equal(overLengthBudget(composed.answer), null, `${target}: ${composed.answer}`);
        assert.equal(validateAnswer(composed.answer, composed.citedUrls, pack(held.subject, held.records, "q")).kind, "PASSED", target);
        composedCount += 1;
      }
    }
  }
  assert.ok(composedCount > 0, `every held target, both kinds (${composedCount})`);
});

test("two committees are stated separately and never added; composition steps aside for what it cannot state", () => {
  const nj = MONEY_RECORDS.filter((record) => record.jurisdiction === "NJ" && record.filingState === "FILED");
  const target = [...new Set(nj.flatMap((record) => record.targetKeys))].find((key) => nj.filter((record) => record.targetKeys.includes(key)).length === 2)!;
  const held = heldEvidence(target, "Pat Q. Example");
  const composed = composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED"] }, subject: held.subject, records: held.records, gaps: held.gaps });
  assert.match(composed?.answer ?? "", /^We hold 2 committee filings for Pat Q\. Example, each stated on its own and not added together\. One, registered as "[^"]+", reported raising \$[\d,.]+ and spending \$[\d,.]+ in \d+ reports? filed through [^;]+; the other, registered as/);
  assert.doesNotMatch(composed?.answer ?? "", /total|combined|together raised/i, "never added");
  const ask: MoneyAsk = { kind: "HOW_MUCH", measures: ["RAISED"] };
  const ayotte = heldEvidence(AYOTTE, "Kelly Ayotte");
  assert.equal(composeMoneyAnswer({ ask, subject: ayotte.subject, records: [], gaps: [] }), null, "no record: the model writes");
  assert.equal(composeMoneyAnswer({ ask, subject: ayotte.subject, records: [...ayotte.records, { kind: "FINANCE_TRANSACTION", id: "cf:1", text: "x", sourceUrl: "https://e.example/1" }], gaps: [] }), null, "itemized county rows are for a writer");
  assert.equal(composeMoneyAnswer({ ask, subject: ayotte.subject, records: [...ayotte.records, { kind: "FINANCE_SUMMARY", id: "fec:H0XX", subjectId: AYOTTE, text: "x", sourceUrl: "https://fec.example/1" }], gaps: [] }), null, "a federal record is for a writer");
  assert.equal(composeMoneyAnswer({ ask, subject: ayotte.subject, records: ayotte.records.map((record) => ({ ...record, finance: undefined })), gaps: [] }), null, "a record without its structured fields is never parsed");
  assert.equal(composeMoneyAnswer({ ask, subject: ayotte.subject, records: [...ayotte.records, ...[1, 2].map((n) => ({ ...ayotte.records[0], id: `${ayotte.records[0].id}:${n}` }))], gaps: [] }), null, "three committees: the model writes");
});

test("a federal candidate's money is the FEC record's own sentences, with the agency and the read date — and 'who gave' says we hold totals, not donors", () => {
  const person: EvidenceSubject = { kind: "PERSON", id: "ballot-az-pima:us-house-6|Juan Ciscomani", name: "Juan Ciscomani" };
  const fec: EvidenceRecord = {
    kind: "FINANCE_SUMMARY", id: "fec:H2AZ02360", subjectId: person.id, canonicalSubjectId: "H2AZ02360",
    text: "This campaign has raised $6.2 million in the 2025–26 election cycle and spent $2.3 million. It has $4.1 million on hand. About 8% of the money came from small donors — people who gave under $200 in total.",
    sourceUrl: "https://www.fec.gov/data/candidate/H2AZ02360/", sourceOrg: "Federal Election Commission", retrievedAt: "2026-09-28",
  };
  const how = composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED"] }, subject: person, records: [fec], gaps: [] });
  assert.equal(how?.answer, "Juan Ciscomani's campaign has raised $6.2 million in the 2025–26 election cycle and spent $2.3 million. It has $4.1 million on hand. About 8% of the money came from small donors — people who gave under $200 in total. Filed with the Federal Election Commission; read September 28th, 2026.");
  assert.deepEqual(how?.citedUrls, ["https://www.fec.gov/data/candidate/H2AZ02360/"]);
  assert.equal(validateAnswer(how!.answer, how!.citedUrls, pack(person, [fec], "How much money has Juan Ciscomani raised?")).kind, "PASSED");
  const who = composeMoneyAnswer({ ask: { kind: "WHO_GAVE" }, subject: person, records: [fec], gaps: [] });
  assert.match(who?.answer ?? "", /^Our records for Juan Ciscomani hold campaign totals, not the identities of donors \(money records we hold for this candidate that name a donor: 0 of 1\)\. Juan Ciscomani's campaign has raised/);
  assert.doesNotMatch(who?.answer ?? "", /withhold|not published|state does not/i, "the donor gap is ours, never the agency's");
  assert.equal(composeMoneyAnswer({ ask: { kind: "COMPARE", measure: "RAISED" }, subject: person, other: { id: "x", name: "Other Person" }, records: [fec], gaps: [] }), null, "a comparison with a federal record is for a writer");
  assert.equal(composeMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED"] }, subject: person, records: [{ ...fec, id: "fec-absence:x" }], gaps: [] }), null, "an FEC absence is not a figure");
});

test("a question about a person's money and nothing they did in office is money-only; a question that also asks how they voted keeps everything", () => {
  for (const question of ["How much money has Juan Ciscomani raised?", "Who are Katie Hobbs's biggest donors?", "Has Cinde Warmington raised more money than Kelly Ayotte?", "Who funds the Vail school board candidates?"]) {
    assert.equal(asksOnlyMoney(question), true, question);
  }
  for (const question of ["How did Juan Ciscomani vote on the budget?", "How much money has Juan Ciscomani raised and how did he vote?", "What is Katie Hobbs's record on fundraising and executive orders?", "Who is Katie Hobbs?"]) {
    assert.equal(asksOnlyMoney(question), false, question);
  }
  assert.equal(financeQuestionAsked("Who funds the Vail school board candidates?"), true, "'funds' is a money verb like 'funded'");
  /* A funding verb aimed at a named person is a money question; aimed at a district it is a budget question. */
  assert.equal(financeQuestionAsked("Who is funding Andy Biggs?"), false);
  assert.equal(financeQuestionAskedFor("Who is funding Andy Biggs?", "PERSON"), true);
  assert.equal(financeQuestionAskedFor("Who is funding the Vail school district?", "BODY"), false);
  assert.equal(financeQuestionAskedFor("Who is backing Prop 141?", "MEASURE"), false);
  assert.equal(asksOnlyMoney("Who is funding Andy Biggs?", "PERSON"), true);
  assert.equal(moneyQuestionShape("Who is funding the Vail school district?"), null, "a slot led by an article is never a person's name");
  assert.equal(moneyQuestionShape("Who is backing Prop 141?")?.slot, "prop 141", "the shape is only a reading of the words: the slot must still bind a held person, and a measure is not one");
});

test("the relevance gate keeps a compared person's records by exact id, and nobody else's", () => {
  const subject: EvidenceSubject = { kind: "PERSON", id: WARMINGTON, name: "Cinde Warmington" };
  const mine: EvidenceRecord = { kind: "FINANCE_SUMMARY", id: "a", subjectId: WARMINGTON, text: "a" };
  const theirs: EvidenceRecord = { kind: "FINANCE_SUMMARY", id: "b", subjectId: AYOTTE, text: "b" };
  const stranger: EvidenceRecord = { kind: "FINANCE_SUMMARY", id: "c", subjectId: "ballot-nh-merrimack:governor:fife-shaun", text: "c" };
  assert.deepEqual(gateRecordsToSubject(subject, [mine, theirs, stranger]).records.map((record) => record.id), ["a"], "no comparison: the subject's own");
  assert.deepEqual(gateRecordsToSubject(subject, [mine, theirs, stranger], new Set([AYOTTE])).records.map((record) => record.id), ["a", "b"]);
});
