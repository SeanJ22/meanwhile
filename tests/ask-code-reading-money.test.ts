import assert from "node:assert/strict";
import test from "node:test";
import { installFederalVotes, installRegistryAuthority } from "./helpers/promoted-fixtures.ts";

await installRegistryAuthority();
await installFederalVotes();

import { ballotAskInventory, ballotRecordsFor, namedSourceFilingIds } from "../lib/ask/ballot-inventory.ts";
import type { EvidenceRecord } from "../lib/ask/evidence.ts";
import { lexicalQuestionShape, lexicalReading, moneyShapeForBoundPerson, otherNamedPerson } from "../lib/ask/lexical-reading.ts";
import { codeBestReading } from "../lib/ask/speculative-reading.ts";
import { voteEvidenceReadsStateRollCalls } from "../lib/ask/votes.ts";
import { readNativeMemberVotes } from "../lib/state-rollcalls/reader-votes.ts";
import type { BallotSet } from "../lib/ballot/types.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

const WARMINGTON = "ballot-nh-merrimack:governor:warmington-cinde";
const AYOTTE = "ballot-nh-merrimack:governor:ayotte-kelly";
const HARNED = "ballot-nh-merrimack:state-senate-7:harned-rebecca";
const NH = "ocd-division/country:us/state:nh";
const MERRIMACK = "ocd-division/country:us/state:nh/county:merrimack";

/*
 * A small synthetic New Hampshire ballot: a statewide race and a county race the reader's divisions reach, and
 * one state-senate district race they do not.
 */
const SAMPLE = "ballot-nh-test:state-senate-7:sample-jordan";
const NH_PROVENANCE = { sourceUrl: "https://example.test/nh-ballot", sourceOrg: "Synthetic test ballot", collectedAt: "2026-09-25", verifiedAt: null };
const nhSet: BallotSet = {
  election: { id: "nh-2026-general-test", date: "2026-11-03", name: "2026 General Election (test)", state: "NH" },
  contests: [
    { id: "ballot-nh-test:governor", electionId: "nh-2026-general-test", ocdId: NH, divisionVintage: "2026", title: "Governor", type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null, provenance: NH_PROVENANCE },
    { id: "ballot-nh-test:county-treasurer", electionId: "nh-2026-general-test", ocdId: MERRIMACK, divisionVintage: "2026", title: "County Treasurer", type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null, provenance: NH_PROVENANCE },
    { id: "ballot-nh-test:state-senate-7", electionId: "nh-2026-general-test", ocdId: `${NH}/sldu:7`, divisionVintage: "2026", title: "State Senator, District 7", type: "CANDIDACY", voteFor: 1, termYears: 2, scopeNote: null, provenance: NH_PROVENANCE },
  ],
  candidacies: [
    { id: "ballot-nh-test:governor:example-casey", contestId: "ballot-nh-test:governor", givenName: "Casey", familyName: "Example", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance: NH_PROVENANCE },
    { id: "ballot-nh-test:county-treasurer:other-robin", contestId: "ballot-nh-test:county-treasurer", givenName: "Robin", familyName: "Other", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance: NH_PROVENANCE },
    { id: SAMPLE, contestId: "ballot-nh-test:state-senate-7", givenName: "Jordan", familyName: "Sample", partyLabel: null, slogan: null, incumbent: null, websiteUrl: null, provenance: NH_PROVENANCE },
  ],
  measures: [],
  absences: [],
};

test("a held candidate the reader NAMES is a subject outside the reader's divisions — and nothing else from there is", () => {
  const matched = nhSet.contests.filter((contest) => contest.ocdId === NH || contest.ocdId === MERRIMACK);
  assert.ok(!matched.some((contest) => contest.id === "ballot-nh-test:state-senate-7"), "precondition: District 7 is not this reader's contest");
  const before = ballotAskInventory(nhSet, matched);
  assert.equal(before.subjects.has(SAMPLE), false, "unnamed: not offered");
  const named = namedSourceFilingIds("How much has Jordan Sample raised?", nhSet);
  assert.deepEqual(named, [SAMPLE]);
  const inventory = ballotAskInventory(nhSet, matched, () => [], named);
  const sample = inventory.subjects.get(SAMPLE);
  assert.ok(sample, "named: answerable");
  assert.equal(sample.kind, "PERSON");
  assert.equal(sample.outsideReaderDivisions, true);
  assert.equal(sample.contestTitle, "State Senator, District 7");
  assert.equal(inventory.subjects.has("ballot-nh-test:state-senate-7"), false, "her contest is not made a subject of this reader's ballot");
  // Her records say what she filed for, and nothing says it is on this reader's ballot.
  const retrieved = ballotRecordsFor(sample, { set: nhSet, contests: matched, absences: nhSet.absences });
  assert.ok(retrieved.records.some((record) => record.kind === "CANDIDACY" && record.id === SAMPLE));
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

test("a state's roll calls are read for a state legislator only, with NH using its exact member projection", async () => {
  assert.equal(voteEvidenceReadsStateRollCalls("A Legislator", { officeholderId: "nj-legislature:12345" }), true);
  assert.equal(voteEvidenceReadsStateRollCalls("A Legislator", { officeholderId: "nh-general-court:12345" }), false, "NH never reopens the retired jurisdiction pointer");
  assert.equal(voteEvidenceReadsStateRollCalls("Tayfun Selen", { withinStates: ["nj"] }), false, "no roster row: nothing to read");
  const calls: string[] = [];
  const readers = { holder: async () => null, nh: async (member: string) => { calls.push(member); return null; }, az: async () => [] };
  assert.equal((await readNativeMemberVotes("nh-general-court:12345", readers))?.status, "NOT_HELD");
  assert.equal(await readNativeMemberVotes("body:county-council", readers), null);
  assert.equal(await readNativeMemberVotes("ballot-nj-morris:county-candidate", readers), null);
  assert.deepEqual(calls, ["nh-general-court:12345"]);
});

test("ROUTE: a New Jersey meeting question does not wait for New Jersey's roll calls (5.7-6.7 s cold, measured)", { concurrency: false }, async () => {
  const payload = await ask("When does the Rockaway Township Council meet next?", ["ocd-division/country:us/state:nj", "ocd-division/country:us/state:nj/county:morris", "ocd-division/country:us/state:nj/county:morris/place:rockaway_township"], "MAP") as Payload & { trace: { preloads?: Record<string, number> } };
  assert.ok(payload.trace.preloads, "the preload timings are traced");
  assert.equal(Object.keys(payload.trace.preloads!).some((name) => name.startsWith("stateVotes:")), false, "no state roll-call read for a body question");
});

