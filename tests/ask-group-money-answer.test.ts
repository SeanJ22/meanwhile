import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { absencesForDivisions } from "../lib/ask/ballot-inventory.ts";
import { campaignMoneyEvidenceFor } from "../lib/ask/campaign-money.ts";
import type { EvidencePack, EvidenceRecord, EvidenceSubject } from "../lib/ask/evidence.ts";
import { overLengthBudget } from "../lib/ask/length-contract.ts";
import { financeQuestionAsked, financeRegimeNotesFor } from "../lib/ask/local-finance.ts";
import {
  composeGroupMoneyAnswer,
  composeNoRaceMoneyAnswer,
  contestFitsBody,
  groupMoneyQuestionShape,
  moneyQuestionShape,
  type GroupCandidate,
  type GroupMoneyAsk,
} from "../lib/ask/money-answer.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { CampaignMoney } from "../lib/funding/campaign-money.ts";
import type { StateMoneyRecord } from "../lib/funding/state-money.ts";
import { stateMoneyRecordsForDisplay } from "../lib/funding/state-money-reader.ts";

const AZ_BALLOT = JSON.parse(readFileSync(join(process.cwd(), "data", "states", "az", "ballot", "az-pima-2026.json"), "utf8")) as BallotSet;

const GOVERNOR = "ballot-xx:governor";
const SENATE_7 = "ballot-xx:state-senate-7";
const CONTESTS = [
  { id: GOVERNOR, title: "Governor", ocdId: "ocd-division/country:us/state:xx" },
  { id: SENATE_7, title: "State Senator, District 7", ocdId: "ocd-division/country:us/state:xx/sldu:7" },
];
const CANDIDACIES = [
  { id: `${GOVERNOR}:one-avery`, contestId: GOVERNOR, givenName: "Avery", familyName: "One" },
  { id: `${GOVERNOR}:two-blair`, contestId: GOVERNOR, givenName: "Blair", familyName: "Two" },
  { id: `${GOVERNOR}:three-casey`, contestId: GOVERNOR, givenName: "Casey", familyName: "Three" },
  { id: `${GOVERNOR}:four-drew`, contestId: GOVERNOR, givenName: "Drew", familyName: "Four" },
  { id: `${SENATE_7}:five-emery`, contestId: SENATE_7, givenName: "Emery", familyName: "Five" },
  { id: `${SENATE_7}:six-finley`, contestId: SENATE_7, givenName: "Finley", familyName: "Six" },
  { id: `${SENATE_7}:seven-gray`, contestId: SENATE_7, givenName: "Gray", familyName: "Seven" },
];

function money(targetKey: string, name: string, office: string, filingState: StateMoneyRecord["filingState"], receipts: number | null): StateMoneyRecord {
  const agency = "Example Secretary of State — Campaign Finance System";
  const registeredName = filingState === "FILED" ? `Friends of ${name}` : name;
  return {
    dataClass: "STATE_COMMITTEE",
    jurisdiction: "XX",
    agency,
    filingsUrl: "https://cfs.example.gov/",
    committeeId: filingState === "FILED" ? `c-${targetKey.split(":").pop()}` : null,
    registeredName,
    candidateNameAsFiled: name,
    officeSought: office,
    electionYear: 2026,
    filingState,
    totals: { receipts, expenditures: receipts === null ? null : receipts / 2, cashOnHand: null, reportCount: null, coveringPeriod: "2026 Election Cycle" },
    targetKeys: [targetKey],
    match: { registeredName, officeAsFiled: office, officeOnBallot: office, electionYearAsFiled: 2026, electionYearOnBallot: 2026, allThreeAgree: true, note: "name, office and election year all agree" },
    checkedAt: "2026-09-01",
    provenance: { sourceUrl: `https://cfs.example.gov/filer/${targetKey.split(":").pop()}`, sourceOrg: agency, collectedAt: "2026-09-01", verifiedAt: "2026-09-01" },
  } as StateMoneyRecord;
}

const MONEY: StateMoneyRecord[] = [
  money(`${GOVERNOR}:one-avery`, "Avery One", "Governor", "FILED", 888256.7),
  money(`${GOVERNOR}:two-blair`, "Blair Two", "Governor", "NO_REPORTS_ON_FILE", null),
  money(`${GOVERNOR}:three-casey`, "Casey Three", "Governor", "NO_REPORTS_ON_FILE", null),
  money(`${SENATE_7}:five-emery`, "Emery Five", "State Senator", "FILED", 12500),
  money(`${SENATE_7}:six-finley`, "Finley Six", "State Senator", "FILED", 7250.25),
];

interface Race { contest: { id: string; title: string; ocdId: string }; candidates: GroupCandidate[]; records: EvidenceRecord[]; gaps: EvidencePack["gaps"] }

/** A contest's candidates and their held money, through the route's own selector (state records only). */
function race(contestId: string): Race {
  const contest = CONTESTS.find((row) => row.id === contestId)!;
  const records: EvidenceRecord[] = [];
  const gaps: EvidencePack["gaps"] = [];
  const candidates: GroupCandidate[] = [];
  for (const candidacy of CANDIDACIES.filter((row) => row.contestId === contestId)) {
    const name = [candidacy.givenName, candidacy.familyName].filter(Boolean).join(" ");
    const subject: EvidenceSubject = { kind: "PERSON", id: candidacy.id, name };
    const shown = stateMoneyRecordsForDisplay(MONEY.filter((record) => record.targetKeys.includes(candidacy.id)));
    const select = (): CampaignMoney => ({
      requestedTargetKey: candidacy.id, federal: { kind: "none" }, officialIdentity: "NOT_OFFICIAL",
      state: { records: shown, resolution: "DIRECT_CANDIDACY_KEY", resolvedTargetKey: candidacy.id },
    });
    const evidence = campaignMoneyEvidenceFor(subject, candidacy.id, contestId, select);
    records.push(...evidence.records);
    gaps.push(...evidence.gaps);
    candidates.push({ id: candidacy.id, name, matched: evidence.denominators.financeIdentityUnresolved === 0 });
  }
  const contestSubject: EvidenceSubject = { kind: "CONTEST", id: contestId, name: contest.title };
  gaps.push(...financeRegimeNotesFor(contestSubject, { state: records.length > 0, federal: false, county: false }).map((note) => note.gap));
  return { contest, candidates, records, gaps };
}

const packFor = (subject: EvidenceSubject, records: EvidenceRecord[], question: string): EvidencePack => ({
  question, intent: "PERSON_RECORD", temporal: { kind: "NONE" }, subject, records, gaps: [], denominators: {}, today: "2026-09-25",
});
const dollars = (amount: number) => `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The person is named in the group of candidates that share this gap ("A and B: <gap>"), never under another clause. */
function namedWithGap(answer: string, name: string, gap: string): boolean {
  const at = answer.indexOf(name);
  const said = answer.indexOf(`: ${gap}`, at);
  // A legal ballot name may contain parentheses.
  // A semicolon or earlier colon, not a parenthesis, crosses a clause boundary.
  return at >= 0 && said > at && !/[;:]/.test(answer.slice(at, said));
}

const RACES: Race[] = CONTESTS.map((contest) => race(contest.id));

test("race money wording is recognised with its race words, and a named person's money question is not a race question", () => {
  const accepted: [string, GroupMoneyAsk["kind"], string][] = [
    ["Who funded the Vail school board candidates?", "WHO_GAVE", "vail school board"],
    ["Who donated to the candidates for governor?", "WHO_GAVE", "governor"],
    ["Who are the biggest donors to the State Senator, District 7 candidates?", "WHO_GAVE", "state senator district 7"],
    ["How much have the candidates for governor raised?", "HOW_MUCH", "governor"],
    ["How much money have the Mendham Township Committee candidates raised and spent?", "HOW_MUCH", "mendham township committee"],
    ["How much money has been raised in the governor's race?", "HOW_MUCH", "governor"],
    ["Who is raising the most in the governor's race?", "MOST", "governor"],
    ["Who has raised the most money in the State Representative, District 17 race?", "MOST", "state representative district 17"],
    ["Which candidate spent the most in the County Commissioner race?", "MOST", "county commissioner"],
  ];
  for (const [question, kind, group] of accepted) {
    const shape = groupMoneyQuestionShape(question);
    assert.ok(shape, question);
    assert.equal(shape.ask.kind, kind, question);
    assert.equal(shape.group, group, question);
    assert.equal(financeQuestionAsked(question), true, `the route retrieves money for: ${question}`);
  }
  for (const question of [
    "How much has Katie Hobbs raised?",
    "Who donated to Katie Hobbs's campaign?",
    "Has Cinde Warmington raised more money than Kelly Ayotte?",
    "Who funded their campaigns?",
    "How much have the candidates raised in 2024?",
    "Who is funding the Vail school district?",
  ]) {
    assert.equal(groupMoneyQuestionShape(question), null, question);
  }
  // The two readers never both claim a question.
  for (const [question] of accepted) assert.equal(moneyQuestionShape(question), null, question);
});

test("contest money answers name candidates with their own figures and pass validation", () => {
  let composedCount = 0;
  let withAMissingRecord = 0;
  for (const held of RACES) {
    for (const ask of [{ kind: "HOW_MUCH", measures: ["RAISED", "SPENT"] }, { kind: "WHO_GAVE" }, { kind: "MOST", measure: "RAISED" }] as GroupMoneyAsk[]) {
      const composed = composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: held.records, gaps: held.gaps });
      if (!composed) {
        // Only length may refuse a contest whose candidates each hold at most one state filing.
        continue;
      }
      composedCount += 1;
      const where = `${held.contest.id} ${ask.kind}`;
      assert.equal(overLengthBudget(composed.answer), null, where);
      const subject: EvidenceSubject = { kind: "CONTEST", id: held.contest.id, name: held.contest.title };
      const verdict = validateAnswer(composed.answer, composed.citedUrls, packFor(subject, held.records, "race money"));
      assert.equal(verdict.kind, "PASSED", `${where}: ${verdict.kind === "FAILED" ? verdict.failed.join(",") : ""}\n${composed.answer}`);
      if (ask.kind === "WHO_GAVE") { assert.equal(composed.missingAnswer, true); continue; }
      assert.doesNotMatch(composed.answer, /candidates with a state money record we hold/);
      for (const person of held.candidates) {
        assert.ok(composed.answer.includes(person.name), `${where} names ${person.name}: ${composed.answer}`);
        const record = held.records.find((row) => row.subjectId === person.id);
        if (!record) {
          withAMissingRecord += 1;
          // Our gap, in the words that fit it: an unresolved finance identity is never "no filing".
          const gap = "we don't have a campaign filing yet";
          assert.ok(namedWithGap(composed.answer, person.name, gap), `${where}: ${composed.answer}`);
          continue;
        }
        for (const own of held.records.filter((row) => row.subjectId === person.id)) {
          const finance = own.finance!;
          if (finance.filingState !== "NO_REPORTS_ON_FILE") assert.ok(composed.answer.includes(`"${finance.registeredName!.replace(/"/g, "'").trim()}"`), `${where} states ${person.name}'s registered committee`);
          else assert.ok(namedWithGap(composed.answer, person.name, `no reports on file with the ${finance.agency}`), `${where}: ${person.name}'s agency had no reports\n${composed.answer}`);
          if (finance.filingState === "FILED" && finance.totals.receipts !== null) {
            assert.ok(composed.answer.includes(dollars(finance.totals.receipts)), `${where} states ${person.name}'s own receipts as filed`);
          }
        }
        // Two committees are stated apart and never added into one figure.
        if (held.records.filter((row) => row.subjectId === person.id).length === 2) assert.ok(composed.answer.includes(`${person.name}, two committees stated apart (`), `${where}: ${composed.answer}`);
      }
      for (const url of composed.citedUrls) assert.ok(held.records.some((record) => record.sourceUrl === url), `${where} cites only held records`);

      if (ask.kind === "MOST" && / reported raising more$| reported raising more\./.test(composed.answer)) {
        // A verdict names the committee with the highest filed receipts, and only on like-for-like filings.
        const filed = held.records.filter((record) => record.finance?.filingState === "FILED");
        assert.equal(filed.length, held.candidates.length, where);
      }
    }
  }
  assert.ok(composedCount > 0, "at least one contest composes");
  assert.ok(withAMissingRecord > 0, "at least one composed contest names a candidate we hold no money record for");
});

test("a contest names a candidate’s missing filing without treating it as zero", () => {
  const ask: GroupMoneyAsk = { kind: "HOW_MUCH", measures: ["RAISED"] };
  let found = 0;
  for (const held of RACES) {
    const withRecord = held.candidates.filter((person) => held.records.some((record) => record.subjectId === person.id));
    const lacking = held.candidates.filter((person) => person.matched && !withRecord.includes(person));
    if (withRecord.length === 0 || lacking.length === 0) continue;
    const composed = composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: held.records, gaps: held.gaps });
    if (!composed) continue;
    found += 1;
    assert.doesNotMatch(composed.answer, /candidates with a state money record we hold/);
    for (const person of lacking) assert.ok(namedWithGap(composed.answer, person.name, "we don't have a campaign filing yet"), composed.answer);
    // Never "$0" for a candidate we hold nothing for.
    assert.doesNotMatch(composed.answer, /\$0\.00/);
  }
  assert.ok(found >= 1, "a contest with a candidate lacking a record composes");
});

test("a candidate whose ballot listing is not matched to a filing identity is never said to have no filing", () => {
  const held = RACES.find((row) => row.contest.id === SENATE_7)!;
  const candidates = held.candidates.map((person, index) => index === 0 ? { ...person, matched: false } : person);
  const records = held.records.filter((record) => record.subjectId !== candidates[0].id);
  const composed = composeGroupMoneyAnswer({ ask: { kind: "HOW_MUCH", measures: ["RAISED"] }, contest: held.contest, candidates, records, gaps: held.gaps });
  assert.ok(composed);
  assert.ok(namedWithGap(composed.answer, candidates[0].name, "we don't have a campaign filing yet"), composed.answer);
  assert.ok(!namedWithGap(composed.answer, candidates[0].name, "no state committee filing in our records"), composed.answer);
});

test("candidates who share a gap are named together, in ballot order, where the first of them stands", () => {
  const held = RACES.find((row) => row.contest.id === GOVERNOR)!;
  const noReports = held.candidates.filter((person) => held.records.some((record) => record.subjectId === person.id && record.finance?.filingState === "NO_REPORTS_ON_FILE"));
  assert.ok(noReports.length >= 2, "the Governor race holds two candidates the agency had no reports for");
  const composed = composeGroupMoneyAnswer({ ask: { kind: "MOST", measure: "RAISED" }, contest: held.contest, candidates: held.candidates, records: held.records, gaps: held.gaps });
  assert.ok(composed, "the Governor race composes once the shared gap is said once");
  assert.ok(composed.answer.includes(`${noReports.map((person) => person.name).join(" and ")}: no reports on file with the `), composed.answer);
  assert.ok(composed.answer.includes("so none is ranked"), "two candidates without reports: no ranking");
});

test("the race composer steps aside for anything it cannot state plainly", () => {
  const held = RACES.find((row) => row.contest.id === SENATE_7)!;
  const ask: GroupMoneyAsk = { kind: "HOW_MUCH", measures: ["RAISED"] };
  assert.ok(composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: held.records, gaps: held.gaps }));
  // A money record for someone the ballot does not list for this race.
  const stray = { ...held.records[0], subjectId: `${GOVERNOR}:one-avery` };
  assert.equal(composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: [...held.records, stray], gaps: held.gaps }), null);
  // A county register row is a writer's to read.
  const county = { kind: "FINANCE_COMMITTEE", id: "easyvote:pima:x", text: "x", sourceUrl: null } as EvidenceRecord;
  assert.equal(composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: [...held.records, county], gaps: held.gaps }), null);
  // A candidate with two filings is stated apart; three is a writer's to read.
  const twice = { ...held.records[0], id: `${held.records[0].id}:second` };
  const apart = composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: [...held.records, twice], gaps: held.gaps });
  assert.ok(apart?.answer.includes(", two committees stated apart ("), apart?.answer);
  const thrice = { ...held.records[0], id: `${held.records[0].id}:third` };
  assert.equal(composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: held.candidates, records: [...held.records, twice, thrice], gaps: held.gaps }), null);
  // No candidates listed.
  assert.equal(composeGroupMoneyAnswer({ ask, contest: held.contest, candidates: [], records: [], gaps: [] }), null);
});

test("a bound body reaches a contest only through its own office, never another office sharing its division", () => {
  assert.equal(contestFitsBody("Member of the Township Committee", "Mendham Township Committee"), true);
  assert.equal(contestFitsBody("Member of the Board of County Commissioners", "Morris County Board Of County Commissioners"), true);
  assert.equal(contestFitsBody("Member of the Board of Education", "Rockaway Township Board of Education"), true);
  assert.equal(contestFitsBody("County Clerk", "Morris County Board Of County Commissioners"), false);
  assert.equal(contestFitsBody("Mayor", "Rockaway Township Council"), false);
  assert.equal(contestFitsBody("Member of the Township Committee", "Mendham Township Planning Board"), false);
});

test("a ballot absence and committee register cannot substitute for requested campaign funding", () => {
  const bodyId = "ocd-division/country:us/state:az/school_district:vail_unified_district#board";
  const body = { kind: "BODY" as const, id: bodyId, name: "Vail Unified School District Governing Board" };
  const [absence] = absencesForDivisions([bodyId.split("#")[0]], AZ_BALLOT.absences);
  assert.ok(absence && /^There is no Vail Unified School District governing board race/.test(absence.text));
  // What the route retrieved for this body from the promoted Pima County holding, recorded read-only (never minted here).
  const finance = JSON.parse(readFileSync(join(process.cwd(), "tests", "fixtures", "ask-vail-body-finance-records.json"), "utf8")) as { records: EvidenceRecord[] };
  const records = [absence, ...finance.records];
  const committees = finance.records.filter((record) => record.kind === "FINANCE_COMMITTEE");
  assert.ok(committees.length > 0, "the county register links committees to the Vail office");
  for (const ask of [{ kind: "WHO_GAVE" }, { kind: "HOW_MUCH", measures: ["RAISED"] }] as GroupMoneyAsk[]) {
    const composed = composeNoRaceMoneyAnswer({ ask, body: { id: bodyId, name: body.name }, absence, records });
    assert.ok(composed, ask.kind);
    assert.match(composed.answer, /^We don't have Vail Unified School District Governing Board's campaign/);
    assert.equal(composed.missingAnswer, true);
    assert.equal(overLengthBudget(composed.answer), null);
    const verdict = validateAnswer(composed.answer, composed.citedUrls, packFor(body, records, "Who funded the Vail school board candidates?"));
    assert.equal(verdict.kind, "PASSED", verdict.kind === "FAILED" ? verdict.failed.join(",") : "");
    assert.deepEqual(composed.citedUrls, [], "a gap about our holding does not claim a government absence");
    // Never a total, and never a committee attached to a person.
    assert.doesNotMatch(composed.answer, /\btotal(?:led|ing)? \$|\braised \$/);

  }
  // A statement that a race IS on the ballot is not this answer's to restate as "no race".
  assert.equal(composeNoRaceMoneyAnswer({ ask: { kind: "WHO_GAVE" }, body: { id: bodyId, name: body.name }, absence: { ...absence, kind: "CONTEST" }, records }), null);
});
