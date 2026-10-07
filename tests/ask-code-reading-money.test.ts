import assert from "node:assert/strict";
import test from "node:test";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();

import { ballotAskInventory, ballotRecordsFor, namedSourceFilingIds } from "../lib/ask/ballot-inventory.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";
import { lexicalQuestionShape, lexicalReading, moneyShapeForBoundPerson, otherNamedPerson } from "../lib/ask/lexical-reading.ts";
import { codeBestReading } from "../lib/ask/speculative-reading.ts";
import { voteEvidenceReadsStateRollCalls } from "../lib/ask/votes.ts";
import { BALLOT_SOURCES } from "../lib/ballot/registry.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

const WARMINGTON = "ballot-nh-merrimack:governor:warmington-cinde";
const AYOTTE = "ballot-nh-merrimack:governor:ayotte-kelly";
const HARNED = "ballot-nh-merrimack:state-senate-7:harned-rebecca";
const NH = "ocd-division/country:us/state:nh";
const MERRIMACK = "ocd-division/country:us/state:nh/county:merrimack";

const nhSet = await (async () => {
  const entry = BALLOT_SOURCES.find(({ state }) => state === "nh")!;
  return entry.source.normalize(await entry.source.fetch());
})();

test("a held candidate the reader NAMES is a subject outside the reader's divisions — and nothing else from there is", () => {
  const matched = nhSet.contests.filter((contest) => contest.ocdId === NH || contest.ocdId === MERRIMACK);
  assert.ok(!matched.some((contest) => contest.id === "ballot-nh-merrimack:state-senate-7"), "precondition: District 7 is not this reader's contest");
  const before = ballotAskInventory(nhSet, matched);
  assert.equal(before.subjects.has(HARNED), false, "unnamed: not offered");
  const named = namedSourceFilingIds("How much has Rebecca Harned raised?", nhSet);
  assert.deepEqual(named, [HARNED]);
  const inventory = ballotAskInventory(nhSet, matched, () => [], named);
  const harned = inventory.subjects.get(HARNED);
  assert.ok(harned, "named: answerable");
  assert.equal(harned.kind, "PERSON");
  assert.equal(harned.outsideReaderDivisions, true);
  assert.equal(harned.contestTitle, "State Senator, District 7");
  assert.equal(inventory.subjects.has("ballot-nh-merrimack:state-senate-7"), false, "her contest is not made a subject of this reader's ballot");
  // Her records say what she filed for, and nothing says it is on this reader's ballot.
  const retrieved = ballotRecordsFor(harned, { set: nhSet, contests: matched, absences: nhSet.absences });
  assert.ok(retrieved.records.some((record) => record.kind === "CANDIDACY" && record.id === HARNED));
  assert.ok(!retrieved.records.some((record) => record.kind === "CONTEST"), "no 'appears on this ballot' record for a contest outside the reader's divisions");
});

const people: BindableEntity[] = [
  { id: WARMINGTON, name: "Cinde Warmington", nameClass: "person", divisionType: "person" },
  { id: WARMINGTON, name: "Warmington", nameClass: "person", divisionType: "person" },
  { id: AYOTTE, name: "Kelly Ayotte", nameClass: "person", divisionType: "person" },
  { id: AYOTTE, name: "Ayotte", nameClass: "person", divisionType: "person" },
  { id: HARNED, name: "Rebecca Harned", nameClass: "person", divisionType: "person" },
  { id: "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#select", name: "Newbury Selectboard", nameClass: "body", divisionType: "place", level: "BODY" } as BindableEntity,
];
const OFFICES: Record<string, string> = { [WARMINGTON]: "Governor", [AYOTTE]: "Governor", [HARNED]: "State Senator, District 7" };
const officeOf = (id: string) => OFFICES[id] ?? null;
const read = (question: string) => lexicalReading({ question, inventory: people, namedBodies: people.filter((entity) => entity.level === "BODY"), officeOf });

test("a named person's money question is read in code: the subject, PERSON_RECORD and no tense — the models' reading", () => {
  for (const question of [
    "How much has Kelly Ayotte raised and spent?",
    "How much did Kelly Ayotte raise?",
    "Who donated to Kelly Ayotte's campaign?",
    "Who are Kelly Ayotte's biggest donors?",
  ]) {
    const reading = read(question);
    assert.equal(reading?.shape, "MONEY", question);
    assert.equal(reading?.subjectId, AYOTTE, question);
    assert.equal(reading?.interpretation.intent, "PERSON_RECORD");
    assert.deepEqual(reading?.interpretation.temporal, { kind: "NONE" }, "a money question selects no sitting, whatever its tense word");
    assert.deepEqual(reading?.interpretation.entityMentions, []);
  }
  // A race the reader names must be the person's own.
  assert.equal(read("How much has Rebecca Harned raised for her state senate race?")?.subjectId, HARNED);
  assert.equal(read("How much has Kelly Ayotte raised for her state senate race?"), null, "not her race: the model reads it");
});

test("a comparison binds the FIRST named person through the reader's own mention, and names the second exactly", () => {
  const reading = read("Has Cinde Warmington raised more money than Kelly Ayotte?");
  assert.equal(reading?.shape, "MONEY");
  assert.equal(reading?.subjectId, WARMINGTON);
  assert.deepEqual(reading?.interpretation.entityMentions, ["cinde warmington"], "the resolver binds her on the reader's words, not a clarification");
  assert.deepEqual(moneyShapeForBoundPerson("Has Cinde Warmington raised more money than Kelly Ayotte?", people, WARMINGTON, officeOf), { ask: { kind: "COMPARE", measure: "RAISED" }, otherId: AYOTTE });
  assert.equal(otherNamedPerson("Has Cinde Warmington raised more money than Kelly Ayotte?", people, WARMINGTON)?.id, AYOTTE);
  assert.equal(otherNamedPerson("How much has Kelly Ayotte raised?", people, AYOTTE), null, "the subject's own surname alias is not another person");
  // Refused: the same person twice, an unheld second name.
  assert.equal(read("Has Kelly Ayotte raised more money than Ayotte?"), null);
  assert.equal(read("Has Kelly Ayotte raised more money than Chris Sununu?"), null);
});

test("'is there a meeting soon' wording and contact and person wording are canonical shapes now", () => {
  const accepted: [string, string][] = [
    ["Is there a Rockaway Township Council meeting coming up soon?", "MEETING_TIME"],
    ["Is there an upcoming Mesa City Council meeting?", "MEETING_TIME"],
    ["Is there a meeting of the Pima County Board of Supervisors soon?", "MEETING_TIME"],
    ["Does the Vail school board have a meeting coming up?", "MEETING_TIME"],
    ["Is the Tucson City Council meeting soon?", "MEETING_TIME"],
    ["When is the Newbury Selectboard meeting?", "MEETING_TIME"],
    ["When is the next meeting of the Mesa City Council?", "MEETING_TIME"],
    ["How do I contact Katie Hobbs?", "CONTACT"],
    ["What office is Rebecca Harned running for?", "PERSON_RECORD"],
    ["Is Kelly Ayotte the incumbent?", "PERSON_RECORD"],
  ];
  for (const [question, shape] of accepted) assert.equal(lexicalQuestionShape(question)?.shape, shape, question);
  for (const question of [
    "Is there a Mesa City Council meeting about the budget?",
    "Is the Tucson City Council meeting this month?", // a window the answer would not honour
    "Is there a meeting soon?", // no name
  ]) assert.equal(lexicalQuestionShape(question), null, question);
  const soon = read("Is there a Newbury Selectboard meeting coming up soon?");
  assert.equal(soon?.shape, "MEETING_TIME");
  assert.equal(soon?.interpretation.intent, "MEETING_TIME");
  assert.deepEqual(soon?.interpretation.temporal, { kind: "NEXT" });
  assert.equal(read("How do I contact Kelly Ayotte?")?.interpretation.intent, "CONTACT");
});

test("the code's guess for a pronoun money question is the models' reading: PERSON_RECORD, no tense", () => {
  const guess = codeBestReading({ question: "How much did she raise?", inventory: people, activeSubjects: [{ id: AYOTTE, name: "Kelly Ayotte", kind: "PERSON", focused: true }] });
  assert.equal(guess?.subjectId, AYOTTE);
  assert.equal(guess?.interpretation.intent, "PERSON_RECORD");
  assert.deepEqual(guess?.interpretation.temporal, { kind: "NONE" });
});

process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
delete process.env.ANTHROPIC_API_KEY;
let modelCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (url.startsWith("https://api.anthropic.com/")) { modelCalls += 1; throw new Error("no model call is expected here"); }
  return realFetch(input, init);
}) as typeof fetch;
const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");

interface Payload { mode: string; answer: string | null; subject: { id: string } | null; records: EvidenceRecord[]; trace: { interpretation: { why?: string }; synthesis: { why?: string }; composition?: { kind: string; shape: string; passed?: boolean }; validation: { passed?: boolean } } }
async function ask(question: string, ocdIds: string[], surface = "BALLOT"): Promise<Payload> {
  resetGroundedState();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-code-reading-money-test" },
    body: JSON.stringify({ question, ocdIds, surface, today: "2026-08-28" }),
  }));
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return JSON.parse(text) as Payload;
}

test("ROUTE: Rebecca Harned, asked from Merrimack County, is found and her held filing is the answer — no model", { concurrency: false }, async () => {
  const before = modelCalls;
  const payload = await ask("How much has Rebecca Harned raised?", [NH, MERRIMACK]);
  assert.equal(modelCalls, before);
  assert.equal(payload.subject?.id, HARNED, "was UNRESOLVED: her contest is outside the reader's divisions");
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.synthesis.why, "composed-from-money-records");
  assert.deepEqual(payload.trace.composition && [payload.trace.composition.kind, payload.trace.composition.shape, payload.trace.composition.passed], ["MONEY", "HOW_MUCH", true]);
  assert.match(payload.answer ?? "", /^Rebecca Harned's campaign committee, registered as "Harned, Rebecca", reported raising \$[\d,]+\.\d\d and spending \$[\d,]+\.\d\d/);
  const finance = payload.records.find((record) => record.kind === "FINANCE_SUMMARY");
  assert.ok(finance && (payload.answer ?? "").includes(`$${finance.finance!.totals.receipts!.toLocaleString("en-US", { minimumFractionDigits: 2 })}`), "the figure stated is the record the reader is shown");
});

test("ROUTE: 'Has Cinde Warmington raised more money than Kelly Ayotte?' retrieves BOTH and composes the comparison", { concurrency: false }, async () => {
  const payload = await ask("Has Cinde Warmington raised more money than Kelly Ayotte?", [NH, MERRIMACK]);
  assert.equal(payload.subject?.id, WARMINGTON);
  const money = payload.records.filter((record) => record.kind === "FINANCE_SUMMARY");
  assert.deepEqual(money.map((record) => record.subjectId).sort(), [AYOTTE, WARMINGTON], "both people's held filings reach the reader");
  assert.ok(payload.records.some((record) => record.kind === "CANDIDACY" && record.subjectId === AYOTTE), "and who the second person is");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.composition?.shape, "COMPARE");
  assert.match(payload.answer ?? "", /Kelly Ayotte's campaign committee, registered as "Kelly for New Hampshire", reported raising \$[\d,.]+, both for the 2026 Election Cycle\. By these filings, "Kelly for New Hampshire" reported raising more\./);
  assert.doesNotMatch(payload.answer ?? "", /no (?:fundraising|money|records)/i);
});

test("ROUTE: a comparison whose second name is SHORTER still reaches both people (the whole-question binder picks the longer name)", { concurrency: false }, async () => {
  const payload = await ask("Has Marilyn ALTHOFF raised more money than Joseph M. MURPHY?", ["ocd-division/country:us/state:nj", "ocd-division/country:us/state:nj/county:morris"]);
  assert.equal(payload.subject?.id, "ballot-nj-morris:mendham-borough-member-of-the-borough-council-place-mendham:althoff-marilyn");
  const money = payload.records.filter((record) => record.kind === "FINANCE_SUMMARY").map((record) => record.subjectId).sort();
  assert.deepEqual(money, ["ballot-nj-morris:mendham-borough-member-of-the-borough-council-place-mendham:althoff-marilyn", "ballot-nj-morris:mendham-borough-member-of-the-borough-council-place-mendham:murphy-joseph-m"]);
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.match(payload.answer ?? "", /The two filings cover different reporting periods, so the figures are stated side by side and not compared\./, "different NJ filing dates: never a verdict");
});

test("the other person named is the FULL name the reader typed, never another candidate's bare surname alias", () => {
  const withAlias: BindableEntity[] = [
    ...people,
    { id: "ballot-nj-morris:x:murphy-joseph-m", name: "Joseph M. MURPHY", nameClass: "person", divisionType: "person" },
    { id: "ballot-nj-morris:x:murphy-joseph-m", name: "MURPHY", nameClass: "person", divisionType: "person" },
    { id: "ballot-nj-morris:y:murphy-pat", name: "MURPHY", nameClass: "person", divisionType: "person" },
  ];
  assert.equal(otherNamedPerson("Has Kelly Ayotte raised more money than Joseph M. Murphy?", withAlias, AYOTTE)?.id, "ballot-nj-morris:x:murphy-joseph-m");
  assert.equal(otherNamedPerson("Has Kelly Ayotte raised more money than Murphy?", withAlias, AYOTTE), null, "a bare surname two people share names neither");
});

test("ROUTE: 'who gave' says our records hold totals, not donors — composed, validated, no model", { concurrency: false }, async () => {
  const payload = await ask("Who donated to Kelly Ayotte's campaign?", [NH, MERRIMACK]);
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.validation.passed, true);
  assert.match(payload.answer ?? "", /^Our records for Kelly Ayotte hold campaign totals, not the identities of donors \(money records we hold for this candidate that name a donor: 0 of 1\)\./);
});

test("a state's roll calls are read for a state legislator only — never for a body or a county candidate", () => {
  assert.equal(voteEvidenceReadsStateRollCalls("A Legislator", { officeholderId: "nj-legislature:12345" }), true);
  assert.equal(voteEvidenceReadsStateRollCalls("A Legislator", { officeholderId: "nh-general-court:abc" }), true);
  assert.equal(voteEvidenceReadsStateRollCalls("Tayfun Selen", { withinStates: ["nj"] }), false, "no roster row: nothing to read");
});

test("ROUTE: a New Jersey meeting question does not wait for New Jersey's roll calls (5.7-6.7 s cold, measured)", { concurrency: false }, async () => {
  const payload = await ask("When does the Rockaway Township Council meet next?", ["ocd-division/country:us/state:nj", "ocd-division/country:us/state:nj/county:morris", "ocd-division/country:us/state:nj/county:morris/place:rockaway_township"], "MAP") as Payload & { trace: { preloads?: Record<string, number> } };
  assert.ok(payload.trace.preloads, "the preload timings are traced");
  assert.equal(Object.keys(payload.trace.preloads!).some((name) => name.startsWith("stateVotes:")), false, "no state roll-call read for a body question");
});

test("ROUTE: 'Is there a Vail school board meeting coming up soon?' is read in code and composed from the sitting", { concurrency: false }, async () => {
  const payload = await ask("Is there a Vail school board meeting coming up soon?", ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima", "ocd-division/country:us/state:az/school_district:vail_unified_district"], "MAP");
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.match(payload.answer ?? "", /^The next Vail Unified School District Governing Board meeting is on /);
});
