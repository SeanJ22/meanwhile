import assert from "node:assert/strict";
import test from "node:test";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([
  initializeFederalVoteFirstSeed(),
  installRegistryRuntimeFirstSeeds(),
]);

import { bodyNameFromQuestion, lexicalQuestionShape, lexicalReading, unheldNamedBodyQuestion } from "../lib/ask/lexical-reading.ts";
import {
  composeSittingAnswer,
  plainGapStatement,
  proseName,
  settleSittingComposition,
  type ComposableSitting,
  type SittingGap,
} from "../lib/ask/sitting-answer.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import { readableSitting } from "../lib/ask/meeting-time.ts";
import { citedUrlsFrom, synthesisContextPayload, synthesisLadder, synthesisPrompt, synthesisRequestBody, synthesisSources, synthesizeWithLadder } from "../lib/ask/synthesize.ts";
import { ASK_FAST_WRITER_MODEL, ASK_SYNTHESIS_MODEL, resolveAskRoleModel } from "../lib/ask/model.ts";
import { WRITER_MEMBER_VOTE_ROWS, writerInputProof, writerSelection } from "../lib/ask/writer-selection.ts";
import type { EvidencePack, EvidenceRecord } from "../lib/ask/evidence.ts";
import type { BindableEntity } from "../lib/routing/named-entity.ts";

/**
 * **THE SHAPE OF ASK'S LATENCY.** (2026-09-25, the Ask latency repair.)
 *
 * Measured on production 2026-09-25: a new question on a warm instance took
 * 7.5 s — 2.4 s reading it with a model and 4.8 s writing it with a model —
 * for answers the records already held. Sean's bar is three seconds from the
 * question to a usable answer. These tests pin the SHAPE that makes the fast
 * path fast and keeps it honest, with a fake transport that counts every call:
 *
 * - a question the reader's own words settle is read in code (no call);
 * - an answer the sitting records already are is composed (no call);
 * - anything else still reaches the model, exactly once per rung, and the two
 *   rungs are sequential only because the second needs the first's binding;
 * - an unchanged question over unchanged records is served from the cache;
 * - every composed answer faces the same validator, and a failure never ships;
 * - a model answer cites numbered sources instead of writing URLs out after
 *   the answer, and an invented citation still fails closed.
 */

const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const MESA_SCHOOLS = "ocd-division/country:us/state:az/school_district:mesa_unified_district#board";
const INVENTORY: BindableEntity[] = [
  { id: MESA, name: "Mesa", nameClass: "body", divisionType: "place", level: "BODY" } as BindableEntity,
  { id: MESA_SCHOOLS, name: "Mesa Unified School District Governing Board", nameClass: "body", divisionType: "school_district", level: "BODY" } as BindableEntity,
];

test("a named body missing from our records gets a gap while held ambiguities and pronouns keep their resolution", () => {
  for (const name of ["Columbus City Council", "Tempe City Council", "Example County Board of Supervisors"]) {
    assert.deepEqual(unheldNamedBodyQuestion(`When does ${name} meet next?`, INVENTORY), { shape: "MEETING_TIME", name: name.toLowerCase() });
  }
  for (const question of ["When does Mesa City Council meet next?", "When do they meet next?", "When does the city council meet next?", "When does the Msea City Council meet next?", "When does Columbus City Council meet next about the budget?"]) {
    assert.equal(unheldNamedBodyQuestion(question, INVENTORY), null, question);
  }
});

/* ── the lexical reading ─────────────────────────────────────────────────── */

test("the canonical shapes are read, and anything with more in it is not", () => {
  const accepted: [string, string][] = [
    ["When does the Mesa City Council meet next?", "MEETING_TIME"],
    ["When is the Vail school board meeting next, and where?", "MEETING_TIME"],
    ["What did the Mesa City Council decide at its August 31, 2026 meeting?", "MEETING_OUTCOME"],
    ["When is the next Tucson City Council meeting?", "MEETING_TIME"],
    ["What time does the Pima County Board of Supervisors meet?", "MEETING_TIME"],
    ["When did the Mesa City Council last meet?", "MEETING_TIME"],
    ["When's the Chandler City Council's next meeting?", "MEETING_TIME"],
    ["What's on the Pima County Board of Supervisors agenda?", "BODY_AGENDA"],
    ["What's on the agenda for the next Pima County Board of Supervisors meeting?", "BODY_AGENDA"],
    ["What is on the agenda for the upcoming Vail school board meeting?", "BODY_AGENDA"],
    ["What is on the agenda for the Tucson City Council?", "BODY_AGENDA"],
    ["What did the Mesa City Council decide recently?", "MEETING_OUTCOME"],
    ["How did the Pima County Board of Supervisors vote last time?", "MEETING_OUTCOME"],
    ["What did the Pima County Board of Supervisors decide at its last meeting?", "MEETING_OUTCOME"],
    ["Who sits on the Mesa City Council?", "BODY_ROSTER"],
    ["What does the Pima County Board of Supervisors do?", "BODY_CIVICS"],
    ["Explain Prop 141 to me", "MEASURE_EXPLAIN"],
    ["Who is running for governor?", "CONTEST_FIELD"],
    ["What has Katie Hobbs done?", "PERSON_RECORD"],
  ];
  for (const [question, shape] of accepted) {
    assert.equal(lexicalQuestionShape(question)?.shape, shape, question);
  }
  for (const question of [
    "When does the Mesa City Council meet next about the budget?",
    "When does the Mesa City Council meet next week?",
    "Where does the Mesa City Council meet?",
    "When do they meet next?",
    "Who sits on this body?",
    "What will the Mesa City Council decide next?",
    "What did the Mesa City Council do?",
    "What has she done?",
    "what will the weather be like on election day",
    "Is Pima County voting on data centers?",
  ]) {
    assert.equal(lexicalQuestionShape(question), null, question);
  }
});

test("the lexical reading binds exactly what every binder binds, with the tense the model returned", () => {
  const reading = lexicalReading({ question: "When does the Mesa City Council meet next?", inventory: INVENTORY, namedBodies: INVENTORY });
  assert.ok(reading);
  assert.equal(reading.subjectId, MESA, "the city, not the school district that shares its name");
  assert.equal(reading.interpretation.intent, "MEETING_TIME");
  assert.deepEqual(reading.interpretation.temporal, { kind: "NEXT" });
  assert.deepEqual(reading.interpretation.entityMentions, [], "no model mention: the whole question bound");
  assert.equal(bodyNameFromQuestion("When does the Mesa City Council meet next?", INVENTORY, MESA), "mesa city council");
  assert.equal(bodyNameFromQuestion("When does the Mesa City Council meet next?", INVENTORY, MESA_SCHOOLS), null);
  assert.equal(bodyNameFromQuestion("When do they meet next?", INVENTORY, MESA), null);

  // The 2026-09-25 agreement check against the live model: no tense word is NONE, not NEXT.
  assert.deepEqual(lexicalReading({ question: "When does the Mesa City Council meet?", inventory: INVENTORY, namedBodies: INVENTORY })?.interpretation.temporal, { kind: "NONE" });
  assert.equal(lexicalReading({ question: "When did the Mesa City Council last meet?", inventory: INVENTORY, namedBodies: INVENTORY })?.interpretation.intent, "PAST_MEETING");
  const outcome = lexicalReading({ question: "What did the Mesa City Council decide recently?", inventory: INVENTORY, namedBodies: INVENTORY });
  assert.equal(outcome?.interpretation.intent, "PAST_MEETING");
  assert.deepEqual(outcome?.interpretation.temporal, { kind: "LAST" });
});

test("a kind of body named with no name is the reader's own body of that kind, or asks which of several", () => {
  const governing = (id: string, name: string, divisionType: string): BindableEntity => ({ id, name, nameClass: "body", divisionType, level: "BODY" } as BindableEntity);
  const vail = governing("ocd-division/country:us/state:az/school_district:vail_unified_district#board", "Vail Unified School District Governing Board", "school_district");
  const empire = governing("ocd-division/country:us/state:az/school_district:empire_elementary_district#board", "Empire Elementary District Governing Board", "school_district");
  const tucson = governing("ocd-division/country:us/state:az/place:tucson#governing", "Tucson Mayor & Council", "place");
  const read = (question: string, readerGoverning: BindableEntity[]) =>
    lexicalReading({ question, inventory: [...INVENTORY, vail, empire, tucson], namedBodies: INVENTORY, readerGoverning });
  const one = read("When is the next school board meeting?", [vail, tucson]);
  assert.equal(one?.subjectId, vail.id, "the one school district the ZIP reaches");
  assert.equal(one?.interpretation.intent, "MEETING_TIME");
  assert.deepEqual(one?.interpretation.entityMentions, [vail.name]);
  assert.equal(read("When does the city council meet?", [vail, tucson])?.subjectId, tucson.id);
  assert.equal(read("Can I speak at the next school board meeting?", [vail, tucson])?.shape, "PUBLIC_COMMENT");
  const several = read("When is the next school board meeting?", [vail, empire, tucson]);
  assert.deepEqual(several?.areaChoices?.bodies.map((body) => body.id), [vail.id, empire.id], "asks which, naming the ones the ZIP reaches");
  assert.equal(several?.subjectId, "");
  assert.equal(read("When is the next county board of supervisors meeting?", [vail, tucson]), null, "no county body reached: the model reads it");
  assert.notEqual(read("When is the next Mesa school board meeting?", [vail])?.subjectId, vail.id, "a name in the slot is not a kind of body alone");
});

test("the lexical reading refuses what it cannot settle, so the model reads it as before", () => {
  const refuse = (question: string, inventory: BindableEntity[] = INVENTORY) =>
    assert.equal(lexicalReading({ question, inventory, namedBodies: inventory }), null, question);
  refuse("When does the Tempe City Council meet next?"); // an unheld name
  refuse("When does the Mesa school board meet next?", [INVENTORY[0]]); // a class the held Mesa body is not
  refuse("When do they meet next?"); // a pronoun
  refuse("Who sits on the Mesa City Council about zoning?"); // not a shape
  const twins: BindableEntity[] = [
    ...INVENTORY,
    { id: "ocd-division/country:us/state:az/place:mesa#council-2", name: "Mesa", nameClass: "body", divisionType: "place", level: "BODY" } as BindableEntity,
  ];
  refuse("When does the Mesa City Council meet next?", twins); // two bodies, one name
});

test("an explicit outcome date is preserved and invalid dates cannot enter code reading", () => {
  const read = (question: string) => lexicalReading({ question, inventory: INVENTORY, namedBodies: INVENTORY });
  assert.deepEqual(read("What did the Mesa City Council decide at its August 31, 2026 meeting?")?.interpretation.temporal, { kind: "DATE", localDate: "2026-08-31" });
  assert.equal(read("What did the Mesa City Council decide at its February 30, 2026 meeting?"), null);
  assert.equal(read("What did the Mesa City Council decide at its August 31, 2026 meeting about taxes?"), null);
  assert.equal(read("When is the Mesa City Council meeting next, and where?")?.shape, "MEETING_TIME");
});

test("named-subject shapes read the subject kind they ask about, with the intent the models returned, and no tense", () => {
  const HOBBS = "ballot-az-pima:governor|Katie Hobbs";
  const PROP = "ballot-az-pima:prop-141";
  const GOV = "ballot-az-pima:governor";
  const inventory: BindableEntity[] = [
    ...INVENTORY,
    { id: HOBBS, name: "Katie Hobbs", nameClass: "person", divisionType: "person" },
    { id: PROP, name: "Proposition 141: No tax on miles driven", nameClass: "body", divisionType: "measure" },
    { id: PROP, name: "Prop 141", nameClass: "body", divisionType: "measure" },
    { id: GOV, name: "Governor", nameClass: "body", divisionType: "contest" },
  ];
  const read = (question: string) => lexicalReading({ question, inventory, namedBodies: INVENTORY });
  // What claude-opus-5 returned for these on 2026-09-25 (a roster question reads PERSON_RECORD on all three models).
  assert.deepEqual([read("Who sits on the Mesa City Council?")?.subjectId, read("Who sits on the Mesa City Council?")?.interpretation.intent], [MESA, "PERSON_RECORD"]);
  assert.equal(read("What does the Mesa City Council do?")?.interpretation.intent, "CIVICS");
  assert.deepEqual([read("Explain Prop 141 to me")?.subjectId, read("Explain Prop 141 to me")?.interpretation.intent], [PROP, "MEASURE"]);
  assert.equal(read("What has Katie Hobbs done?")?.subjectId, HOBBS);
  assert.equal(read("Who is running for governor?")?.subjectId, GOV);
  for (const reading of [read("Who sits on the Mesa City Council?"), read("What has Katie Hobbs done?")]) {
    assert.deepEqual(reading?.interpretation.temporal, { kind: "NONE" });
  }
  // Refused: a tense word the retrieval could read differently, a subject of the wrong kind,
  // a second named subject, a class phrase on a non-body.
  assert.equal(read("Who was on the Mesa City Council?"), null, "a tense word stays with the model");
  assert.equal(read("Explain the Mesa City Council to me"), null, "a body is not a measure");
  assert.equal(read("Who is Mesa?"), null, "a body is not a person");
  assert.equal(read("What has Katie Hobbs done about Prop 141?"), null, "two subjects named");
  assert.equal(read("What has Katie Hobbs school board done?"), null, "a class phrase on a person");
});

/* ── the composed sitting answer ─────────────────────────────────────────── */

const STUDY: ComposableSitting = { id: "m1", title: "City Council Study Session", startsAt: "2026-09-28T17:15:00-07:00", timeZone: "America/Phoenix", status: "SCHEDULED" };
const REGULAR: ComposableSitting = { id: "m2", title: "City Council", startsAt: "2026-09-28T17:45:00-07:00", timeZone: "America/Phoenix", status: "SCHEDULED" };
const meetingRecord = (sitting: ComposableSitting, url: string): EvidenceRecord =>
  ({ kind: "MEETING", id: sitting.id, bodyId: MESA, text: `Mesa: ${sitting.title}.`, occurredAt: sitting.startsAt, sourceUrl: url });
const RECORDS: EvidenceRecord[] = [meetingRecord(STUDY, "https://mesa.example.gov/m1"), meetingRecord(REGULAR, "https://mesa.example.gov/m2")];
const AGENDA_GAP: SittingGap = { role: "AGENDA", gap: { whose: "OURS", statement: "We hold the agenda document for that meeting but could not extract its items." } };
const NOW = Date.parse("2026-09-25T12:00:00Z");

test("a time-and-place answer uses only the chosen meeting venue and names an acquisition gap", () => {
  const base = { shape: "MEETING_TIME" as const, subjectName: "Mesa", records: RECORDS, sittingGaps: [], now: NOW, includeLocation: true };
  const held = composeSittingAnswer({ ...base, sittings: [{ ...STUDY, location: { name: "Council Chambers", address: "57 E First Street" } }] });
  assert.match(held?.answer ?? "", /The listed location is Council Chambers, 57 E First Street\./);
  assert.deepEqual(held?.citedUrls, ["https://mesa.example.gov/m1"]);
  const repeated = composeSittingAnswer({ ...base, sittings: [{ ...STUDY, location: { name: "Council Chambers", address: "Council Chambers" } }] });
  assert.match(repeated?.answer ?? "", /The listed location is Council Chambers\./);
  assert.doesNotMatch(repeated?.answer ?? "", /Council Chambers, Council Chambers/);
  const missing = composeSittingAnswer({ ...base, sittings: [STUDY] });
  assert.match(missing?.answer ?? "", /We do not hold a verified location for this meeting\./);
  assert.doesNotMatch(missing?.answer ?? "", /not been posted|Council Chambers/);
});

test("a requested past date with agenda material but no held decisions states the dated gap", () => {
  const answer = composeSittingAnswer({ shape: "MEETING_OUTCOME", subjectName: "Mesa", sittings: [STUDY], records: [RECORDS[0], { kind: "AGENDA_ITEM", id: "proposal", bodyId: MESA, text: "Proposed tax change" }], sittingGaps: [{ role: "OUTCOME", meetingId: STUDY.id, gap: { whose: "OURS", statement: "We have not acquired the decisions from that meeting." } }], now: Date.parse("2026-10-01T00:00:00Z"), requestedLocalDate: "2026-09-28" });
  assert.ok(answer);
  assert.match(answer.answer, /September 28th, 2026/);
  assert.match(answer.answer, /We have not acquired the decisions/);
  assert.doesNotMatch(answer.answer, /most recent|next Mesa|tax change/);
});

test("a meeting-time answer is the sitting, in the body's own zone, and the named agenda gap", () => {
  const composed = composeSittingAnswer({ shape: "MEETING_TIME", subjectName: "Mesa", sittings: [STUDY, REGULAR], records: RECORDS, sittingGaps: [AGENDA_GAP], now: NOW });
  assert.ok(composed);
  assert.equal(composed.answer,
    "The next Mesa meeting is on Monday, September 28th, 2026 at 5:15 PM MST, listed as \"City Council Study Session\". " +
    "Later that day: \"City Council\" at 5:45 PM MST. We hold the agenda document for that meeting but could not extract its items.");
  assert.deepEqual(composed.citedUrls, ["https://mesa.example.gov/m1", "https://mesa.example.gov/m2"], "cites only the sittings' own records");
});

test("composition steps aside whenever there is something to summarise or a fact it cannot state", () => {
  const base = { subjectName: "Mesa", sittings: [STUDY], records: [RECORDS[0]], now: NOW };
  const outcomeGap: SittingGap = { role: "OUTCOME", gap: { whose: "OURS", statement: "We hold no sitting of that body in the outcome store, so we have not recorded what it decided." } };
  const action: EvidenceRecord = { kind: "MEETING_ACTION", id: "1#action", bodyId: MESA, text: "The board's recorded action was \"approve\".", sourceUrl: "https://mesa.example.gov/m1" };
  const item: EvidenceRecord = { kind: "AGENDA_ITEM", id: "m1#0", bodyId: MESA, meetingId: "m1", text: "Approve the minutes.", sourceUrl: "https://mesa.example.gov/a1" };
  assert.ok(composeSittingAnswer({ ...base, shape: "MEETING_OUTCOME", sittingGaps: [outcomeGap] }), "no outcome held: the gap is the answer");
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_OUTCOME", records: [RECORDS[0], action], sittingGaps: [] }), null, "recorded actions outside a decisions question, with no held action read beside them, are for the model to summarise");
  assert.equal(composeSittingAnswer({ ...base, shape: "BODY_AGENDA", records: [RECORDS[0], item], sittingGaps: [] }), null, "held agenda items are for the model to summarise");
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_OUTCOME", sittingGaps: [AGENDA_GAP] }), null, "an outcome question needs its outcome gap");
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_TIME", sittings: [{ ...STUDY, status: "CANCELED" }], sittingGaps: [] }), null, "a cancelled sitting is never offered as the next meeting");
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_TIME", sittings: [{ ...STUDY, timeZone: null }], sittingGaps: [] }), null, "an unrecorded zone is never guessed");
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_TIME", records: [{ ...RECORDS[0], meetingListingIdentity: { uniqueMeetingCount: null } as EvidenceRecord["meetingListingIdentity"] }], sittingGaps: [] }), null, "an unresolved listing identity goes to the model's rule for it");
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_TIME", records: [], sittingGaps: [] }), null, "a sitting the reader is not shown is never described");
  const long: SittingGap = { role: "OUTCOME", gap: { whose: "OURS", statement: "x".repeat(690) } };
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_OUTCOME", sittingGaps: [long] }), null, "the gap that IS the answer must fit, or the model writes it");
  const items = composeSittingAnswer({ ...base, shape: "MEETING_TIME", records: [RECORDS[0], item], sittingGaps: [] });
  assert.match(items?.answer ?? "", /The "City Council Study Session" agenda we hold lists 1 item\./, "a meeting-time answer counts, never summarises, held items");
});

test("a date-only posting is stated as its date, never as the midnight it is stored at", () => {
  // Chandler's council listing (production, 2026-09-25) carries a date and no time.
  const dayOnly: ComposableSitting = { id: "c1", title: "City Council", startsAt: "2026-10-12T00:00:00-07:00", timeZone: "America/Phoenix", startPrecision: "DAY", status: "SCHEDULED" };
  const records = [meetingRecord(dayOnly, "https://chandler.example.gov/c1")];
  const composed = composeSittingAnswer({ shape: "MEETING_TIME", subjectName: "Chandler", sittings: [dayOnly], records, sittingGaps: [], now: NOW });
  assert.equal(composed?.answer, "The next Chandler meeting is on Monday, October 12th, 2026, listed as \"City Council\". Its start time has not been posted.");
  assert.doesNotMatch(composed?.answer ?? "", /12:00 AM/);
  // The record text the model reads says the same, through the same function.
  assert.equal(readableSitting(dayOnly), "Monday, October 12th, 2026 (start time not posted)");
  assert.equal(readableSitting({ ...dayOnly, startPrecision: undefined }), "Monday, October 12th, 2026 at 12:00 AM MST", "a posted time is still printed");
  // Beside a timed sitting, a date-only one is "also that day", never "earlier".
  const withTimed = composeSittingAnswer({ shape: "MEETING_TIME", subjectName: "Mesa", sittings: [STUDY, { ...dayOnly, startsAt: "2026-09-28T00:00:00-07:00", id: "m9" }], records: [RECORDS[0], meetingRecord({ ...dayOnly, id: "m9" }, "https://mesa.example.gov/m9")], sittingGaps: [], now: NOW });
  assert.match(withTimed?.answer ?? "", /Also that day: "City Council" \(start time not posted\)\./);
});

test("with no sitting, the named gap is the whole answer", () => {
  const gap: SittingGap = { role: "NO_SITTING", gap: { whose: "OURS", statement: "We hold meetings for Mesa but none scheduled in the future." } };
  assert.deepEqual(composeSittingAnswer({ shape: "MEETING_TIME", subjectName: "Mesa", sittings: [], records: [], sittingGaps: [gap], now: NOW }),
    { answer: "We hold meetings for Mesa but none scheduled in the future.", citedUrls: [] });
});

test("gap wording is kept; only a machine timestamp is spelled out in the body's zone", () => {
  assert.equal(plainGapStatement("The minutes cell read \"Not available\" at 2026-09-25T22:23:33.443Z. Its decisions are not yet public.", "America/Phoenix"),
    "The minutes cell read \"Not available\" on September 25th, 2026 at 3:23 PM MST. Its decisions are not yet public.");
  assert.equal(plainGapStatement("No timestamp here.", null), "No timestamp here.");
  assert.equal(plainGapStatement("Read at 2026-09-25T22:23:33Z.", null), null, "no zone to spell it in: not composed");
  assert.equal(proseName("Pima County Board Of Supervisors"), "Pima County Board of Supervisors");
  assert.equal(proseName("Of Counsel Board"), "Of Counsel Board", "only inside a name");
});

test("a composed answer ships only on a passing verdict, against the SAME validator", () => {
  const composed = composeSittingAnswer({ shape: "MEETING_TIME", subjectName: "Mesa", sittings: [STUDY], records: [RECORDS[0]], sittingGaps: [], now: NOW });
  assert.ok(composed);
  const pack = (records: EvidenceRecord[]): EvidencePack => ({
    question: "When does the Mesa City Council meet next?", intent: "MEETING_TIME", temporal: { kind: "NEXT" },
    subject: { kind: "BODY", id: MESA, name: "Mesa" }, records, gaps: [], denominators: {}, today: "2026-09-25",
  });
  const passing = settleSittingComposition(composed, (text, urls) => validateAnswer(text, urls, pack([RECORDS[0]])));
  assert.equal(passing.verdict?.kind, "PASSED");
  assert.equal(passing.composed, composed);
  // A record from another government in the pack fails the id-level check, and the prose is discarded whole.
  const foreign = settleSittingComposition(composed, (text, urls) => validateAnswer(text, urls, pack([{ ...RECORDS[0], bodyId: MESA_SCHOOLS }])));
  assert.equal(foreign.verdict?.kind, "FAILED");
  assert.equal(foreign.composed, null, "a failed composition never reaches a reader");
  // A composition citing a URL the pack does not hold fails the invented-source check.
  const invented = settleSittingComposition({ ...composed, citedUrls: ["https://invented.example/x"] }, (text, urls) => validateAnswer(text, urls, pack([RECORDS[0]])));
  assert.equal(invented.composed, null);
  assert.ok(invented.verdict?.kind === "FAILED" && invented.verdict.failed.some((reason) => reason.startsWith("invented-source-url:")));
});

/* ── the route, with a transport that counts ─────────────────────────────── */

const AZ = "ocd-division/country:us/state:az";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const VAIL = "ocd-division/country:us/state:az/school_district:vail_unified_district";

interface Call { kind: "INTERPRET" | "SYNTHESIZE"; model: string; thinking: boolean; effort: boolean; at: number }
const calls: Call[] = [];
/** What each writer answers, by model; "default" for any model not named. */
let writerAnswers: Record<string, { answer: string; citedSources: unknown[] } | "HTTP_529"> = {
  default: { answer: "The board's next sitting is in the records below.", citedSources: [1] },
};
const PASSING = { answer: "The board's next sitting is in the records below.", citedSources: [1] };
/** The model's reading of a question, by the question; CONTACT with no mention for any other. */
const READINGS: Record<string, unknown> = {
  "What did the Pima County Board of Supervisors decide on August 25, 2026?": { intent: "PAST_MEETING", entityMentions: ["Pima County Board of Supervisors"], normalizedMentions: ["Pima County Board of Supervisors"], temporal: { kind: "LAST" }, referent: null },
};

process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
process.env.ANTHROPIC_API_KEY = "test-stub-not-a-real-key";
delete process.env.WTP_ASK_FAST_MODEL;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`latency test refused an outbound request: ${url}`);
  const body = JSON.parse(String(init?.body)) as { system: unknown; model: string; thinking?: unknown; output_config?: { effort?: unknown; format?: { schema?: { properties?: Record<string, unknown> } } } };
  /* The writer's schema has an answer; the reading's does not (both marks their system prompt now). */
  const synthesis = body.output_config?.format?.schema?.properties?.answer !== undefined;
  calls.push({ kind: synthesis ? "SYNTHESIZE" : "INTERPRET", model: body.model, thinking: body.thinking !== undefined, effort: body.output_config?.effort !== undefined, at: Date.now() });
  const planned = writerAnswers[body.model] ?? writerAnswers.default;
  if (synthesis && planned === "HTTP_529") return new Response(JSON.stringify({ error: { type: "overloaded_error" } }), { status: 529 });
  const asked = synthesis ? null : (body as unknown as { messages: { content: string }[] }).messages.at(-1)?.content ?? "";
  const text = synthesis
    ? JSON.stringify(planned)
    : JSON.stringify(READINGS[asked ?? ""] ?? { intent: "CONTACT", entityMentions: [], normalizedMentions: [], temporal: { kind: "NONE" }, referent: null });
  return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");

interface Payload {
  mode: string;
  answer: string | null;
  records: EvidenceRecord[];
  denominators: Record<string, number>;
  trace: {
    interpretation: { ran: boolean; why?: string; cached?: boolean };
    speculation?: { ran: boolean; why: string; delivered: string };
    synthesis: { ran: boolean; why?: string; cached?: boolean; model?: string; writers?: { model: string; role: string; result: string; failed?: string[]; detail?: string }[]; escalation?: string; writerSelection?: { memberVoteRowsShown: number; memberVoteRowsWithheld: number; rollCallsWithheld: number } };
    validation: { ran: boolean; passed?: boolean; failed?: string[] };
    composition?: { shape: string; composed: boolean; passed?: boolean };
    sourcesLoaded?: string;
  };
}

async function ask(question: string, ocdIds: string[], options: { reset?: boolean; today?: string; extra?: Record<string, unknown> } = {}): Promise<{ payload: Payload; calls: Call[] }> {
  if (options.reset !== false) resetGroundedState();
  const before = calls.length;
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-latency-shape-test" },
    body: JSON.stringify({ question, ocdIds, today: options.today ?? "2026-08-28", ...options.extra }),
  }));
  const text = await response.text();
  assert.equal(response.status, 200, text);
  return { payload: JSON.parse(text) as Payload, calls: calls.slice(before) };
}

test("ROUTE: a meeting-time question is read in code and answered from the sitting — no model call at all", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("When does the Vail school board meet next?", [AZ, PIMA, VAIL]);
  assert.deepEqual(made, [], "neither rung called a model");
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.equal(payload.trace.synthesis.why, "composed-from-sitting-records");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.validation.passed, true, "the composed prose passed the same validator a model answer faces");
  assert.match(payload.answer ?? "", /^The next Vail Unified School District Governing Board meeting is on Tuesday, September 8th, 2026 at 7:00 PM MST/);
  assert.ok(payload.records.some((record) => record.kind === "MEETING" && record.id === "apptegy:vail:60703698"), "the sitting the prose names is a record the reader is shown");
  assert.ok(!/https?:/.test(payload.answer ?? ""), "no link is written into the prose");
});

test("ROUTE: a settled question whose records need writing makes ONE call — the fast writer, no reading call, no thinking", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("What's on the Pima County Board of Supervisors agenda?", [AZ, PIMA]);
  assert.deepEqual(made.map((call) => [call.kind, call.model]), [["SYNTHESIZE", ASK_FAST_WRITER_MODEL]]);
  assert.equal(made[0].thinking, false, "Haiku 4.5 is sent no adaptive thinking (a 400 there)");
  assert.equal(made[0].effort, false, "Haiku 4.5 is sent no effort (a 400 there)");
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.ok(payload.records.some((record) => record.kind === "AGENDA_ITEM"), "precondition: held items to summarise");
  assert.equal(payload.trace.composition?.composed, false, "composition stepped aside for the model");
  assert.equal(payload.mode, "GROUNDED_CLAUDE");
  assert.equal(payload.trace.synthesis.model, ASK_FAST_WRITER_MODEL, "the trace names the writer whose answer was delivered");
  assert.deepEqual(payload.trace.synthesis.writers?.map((writer) => [writer.role, writer.result]), [["FAST", "PASSED"]]);
  assert.equal(payload.trace.synthesis.escalation, undefined, "the frontier writer did not run");
});

test("ROUTE: who sits on a named body is read in code and composed from its roster — no model call at all", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who sits on the Vail school board?", [AZ, PIMA, VAIL]);
  assert.deepEqual(made, [], "neither rung called a model");
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.equal(payload.trace.synthesis.why, "composed-from-roster-records");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.validation.passed, true, "the composed prose passed the same validator a model answer faces");
  assert.match(payload.answer ?? "", /^Vail Unified School District Governing Board has \d+ members: /);
  assert.ok(payload.records.some((record) => record.kind === "CONTACT"), "the people the prose names are records the reader is shown");
});

test("ROUTE: who is my state senator is read from the words and composed from the officeholders held for the reader's divisions — no model call, no other source read", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who is my state senator?", [AZ, PIMA, VAIL, "ocd-division/country:us/state:az/sldu:19", "ocd-division/country:us/state:az/sldl:19"]);
  assert.deepEqual(made, [], "neither rung called a model");
  assert.equal(payload.trace.interpretation.why, "reader-officials-shape");
  assert.equal(payload.trace.synthesis.why, "composed-from-officeholder-records");
  assert.equal(payload.trace.composition?.composed, true);
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.match(payload.answer ?? "", /^Your state senator is .+ for District 19\.$/);
  assert.ok(payload.records.some((record) => record.kind === "OFFICEHOLDER"), "the person the prose names is a record the reader is shown");
  assert.equal(payload.trace.sourcesLoaded, "ESSENTIAL", "the registry and the federal directory are all it reads");
});

test("ROUTE: who is the mayor of a city the reader's divisions reach is answered for that city, whatever else its name matches, with no clarifying question", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who is the mayor of Tucson?", [AZ, PIMA, `${AZ}/place:tucson`, `${AZ}/place:tucson_southeast`]);
  assert.deepEqual(made, [], "neither rung called a model");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.interpretation.why, "reader-officials-shape");
  assert.match(payload.answer ?? "", /^On Tucson Mayor & Council, the mayor is Regina Romero/);
});

test("ROUTE: what meetings are coming up is read from the words and composed from the sittings held for the reader's divisions — no model call, and no other source read", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("What meetings are coming up?", [AZ, PIMA, VAIL], { today: "2026-08-28" });
  assert.deepEqual(made, [], "neither rung called a model");
  assert.equal(payload.trace.interpretation.why, "area-meetings-shape");
  assert.equal(payload.trace.synthesis.why, "composed-from-calendar-records");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.validation.passed, true);
  assert.match(payload.answer ?? "", /^We hold \d+ meetings? in the next 14 days for the governments in your area: /);
  assert.ok(payload.records.some((record) => record.kind === "MEETING"), "the sittings the prose names are records the reader is shown");
  assert.equal(payload.trace.sourcesLoaded, "ESSENTIAL");
  /* With a card open the question is about that card: the reader's own area is not assumed. */
  const focused = await ask("What meetings are coming up?", [AZ, PIMA, VAIL], { today: "2026-08-28", extra: { activeSubjects: [{ id: "ocd-division/country:us/state:az/school_district:vail_unified_district#board", name: "Vail Unified School District Governing Board", kind: "BODY", focused: true }] } });
  assert.notEqual(focused.payload.trace.interpretation.why, "area-meetings-shape");
});

test("ROUTE: what is on my ballot is read from the words and composed from the contests the reader's divisions reach — no model call", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("What is on my ballot?", [AZ, PIMA, VAIL]);
  assert.deepEqual(made, [], "neither rung called a model");
  assert.equal(payload.trace.interpretation.why, "ballot-shape");
  assert.equal(payload.trace.synthesis.why, "composed-from-ballot-records");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.match(payload.answer ?? "", /^Your ballot for the .+ on .+ has \d+ races? and \d+ ballot measures?\./);
  assert.ok(payload.records.some((record) => record.kind === "CONTEST"), "each contest is a record the reader is shown");
});

test("ROUTE: who represents me in Congress names the two U.S. Senators the state holds beside the district's Representative", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who represents me in Congress?", [PIMA, VAIL, "ocd-division/country:us/state:az/cd:6"]);
  assert.deepEqual(made, []);
  assert.match(payload.answer ?? "", /^Your United States Senators are .+ and .+; your United States Representative is .+ for District 6\.$/);
});

test("ROUTE: can I speak at a meeting is read from the words and composed from the sitting and the held comment rules — no model call", { concurrency: false }, async () => {
  for (const question of ["Can I speak at the next Vail school board meeting?", "Does the Vail school board take public comment?"]) {
    const { payload, calls: made } = await ask(question, [AZ, PIMA, VAIL]);
    assert.deepEqual(made, [], `${question}: neither rung called a model`);
    assert.equal(payload.mode, "GROUNDED_COMPOSED", question);
    assert.equal(payload.trace.validation.passed, true, question);
    assert.match(payload.answer ?? "", /Vail|We have not recorded how the public can comment/, question);
  }
});

test("ROUTE: any other question is still read by the model; the answer starts from the code's reading meanwhile and is kept because the readings agree", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who can I talk to at the Vail school board?", [AZ, PIMA, VAIL]);
  assert.deepEqual(made.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE"], "one reading and one answer: the answer was started on the code's reading, not written twice");
  assert.equal(made[0].model, resolveAskRoleModel("READER"), "reading the question is the READER role's model (Haiku 4.5 since the 2026-09-25 comparison)");
  assert.equal(payload.trace.interpretation.ran, true);
  assert.equal(payload.trace.composition, undefined, "no composition shape");
  assert.equal(payload.mode, "GROUNDED_CLAUDE");
  assert.deepEqual([payload.trace.speculation?.delivered, payload.trace.speculation?.why], ["SPECULATIVE_ANSWER", "same-subject-body-kind-and-writer-input"]);
});

test("ROUTE: the same question over unchanged records is served from the cache, with no new call", { concurrency: false }, async () => {
  const first = await ask("Who can I talk to at the Vail school board?", [AZ, PIMA, VAIL]);
  assert.equal(first.calls.length, 2);
  const second = await ask("who can i talk to at the vail school board", [AZ, PIMA, VAIL], { reset: false });
  assert.deepEqual(second.calls, [], "equivalent wording, same evidence: no model call");
  assert.equal(second.payload.trace.interpretation.cached, true);
  assert.equal(second.payload.trace.synthesis.cached, true);
  assert.equal(second.payload.answer, first.payload.answer);
});

test("ROUTE: a money question asking WHO gave is written by the fast writer first, like every other question", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who funded the Vail school board?", [AZ, PIMA, VAIL]);
  const writers = made.filter((call) => call.kind === "SYNTHESIZE");
  assert.ok(writers.length >= 1, "a writer ran");
  assert.equal(writers[0].model, ASK_FAST_WRITER_MODEL, "the fast writer wrote first");
  assert.deepEqual(payload.trace.synthesis.writers?.map((writer) => writer.role), ["FAST"]);
  assert.equal(payload.trace.synthesis.escalation, undefined, "the frontier writer did not run");
});

test("ROUTE: the frontier writer runs ONLY when the fast answer fails a check, and the reason is recorded", { concurrency: false }, async () => {
  try {
    writerAnswers = { [ASK_FAST_WRITER_MODEL]: { answer: "See https://invented.example/agenda for the full list.", citedSources: [1] }, default: PASSING };
    const { payload, calls: made } = await ask("What's on the Pima County Board of Supervisors agenda?", [AZ, PIMA]);
    assert.deepEqual(made.map((call) => call.model), [ASK_FAST_WRITER_MODEL, ASK_SYNTHESIS_MODEL]);
    assert.equal(made[1].thinking, true, "the frontier writer keeps adaptive thinking");
    assert.equal(payload.mode, "GROUNDED_CLAUDE");
    assert.equal(payload.answer, PASSING.answer, "the frontier writer's passing answer is delivered — never the failed one");
    assert.equal(payload.trace.synthesis.model, ASK_SYNTHESIS_MODEL);
    assert.deepEqual(payload.trace.synthesis.writers?.map((writer) => [writer.role, writer.result]), [["FAST", "FAILED"], ["FRONTIER", "PASSED"]]);
    assert.match(payload.trace.synthesis.escalation ?? "", /^fast-writer-failed-validation: invented-source-url:/);

    writerAnswers = { [ASK_FAST_WRITER_MODEL]: "HTTP_529", default: PASSING };
    const unavailable = await ask("What's on the Pima County Board of Supervisors agenda?", [AZ, PIMA]);
    assert.equal(unavailable.payload.mode, "GROUNDED_CLAUDE", "a fast writer that cannot answer hands to the frontier writer");
    assert.equal(unavailable.payload.trace.synthesis.escalation, "fast-writer-unavailable: HTTP 529 overloaded_error");
  } finally {
    writerAnswers = { default: PASSING };
  }
});

test("ROUTE: when every writer fails validation the answer still fails closed — an invented citation or an invented link", { concurrency: false }, async () => {
  try {
    for (const answer of [
      { answer: "The board lists every item in the records.", citedSources: [42] },
      { answer: "See https://invented.example/agenda for the full list.", citedSources: [1] },
    ]) {
      writerAnswers = { default: answer };
      const { payload, calls: made } = await ask("What's on the Pima County Board of Supervisors agenda?", [AZ, PIMA]);
      assert.deepEqual(made.map((call) => call.model), [ASK_FAST_WRITER_MODEL, ASK_SYNTHESIS_MODEL], "both writers tried");
      assert.equal(payload.mode, "REJECTED_FELL_BACK", answer.answer);
      assert.equal(payload.answer, null);
      assert.ok(payload.trace.validation.failed?.some((reason) => reason.startsWith("invented-source-url:")));
    }
  } finally {
    writerAnswers = { default: PASSING };
  }
});

test("ROUTE: 'how did they vote' is answered from the publisher's roll calls — no model call, every value in its own word", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("How did the Pima County Board of Supervisors vote last time?", [AZ, PIMA], { today: "2026-08-28" });
  assert.deepEqual(made, [], "no model call");
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.validation.passed, true);
  const rows = payload.records.filter((record) => record.kind === "MEETING_MEMBER_VOTE");
  assert.match(payload.answer ?? "", new RegExp(`recorded each member's vote on \\d+ items?\\. On "`));
  // Every "name: value" the prose states is a row the reader is shown, in the publisher's word.
  const stated = [...(payload.answer ?? "").matchAll(/(?:: |; )([^:;"]+?): ([A-Za-z ]+?)(?=;|\.|$)/g)];
  assert.ok(stated.length >= 2, "the prose states member votes");
  for (const [, names, value] of stated) {
    for (const name of names.split(/, | and /)) {
      assert.ok(rows.some((row) => row.text.endsWith(`${name.trim()} voted ${value}.`)), `${name} voted ${value} is a held row`);
    }
  }
});

test("ROUTE: a large outcome sitting sends the writer a bounded selection; the reader's records and counts stay whole", { concurrency: false }, async () => {
  // A dated question is read by the model (the undated one is composed from the recorded actions, tests/ask-decision-answer.test.ts).
  const { payload, calls: made } = await ask("What did the Pima County Board of Supervisors decide on August 25, 2026?", [AZ, PIMA], { today: "2026-08-28" });
  const rows = payload.records.filter((record) => record.kind === "MEETING_MEMBER_VOTE").length;
  assert.ok(rows > WRITER_MEMBER_VOTE_ROWS, `precondition: the committed sitting holds more rows (${rows}) than the bound`);
  assert.equal(payload.denominators.personVoteRowsInPack, rows, "the denominators state the full count");
  assert.deepEqual(made.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE"], "one reading and one answer, started on the code's reading while the model read");
  assert.equal(payload.trace.speculation?.delivered, "SPECULATIVE_ANSWER");
  const sel = payload.trace.synthesis.writerSelection;
  assert.ok(sel && sel.memberVoteRowsShown <= WRITER_MEMBER_VOTE_ROWS && sel.memberVoteRowsShown + sel.memberVoteRowsWithheld === rows);
});

/* ── the citation format ─────────────────────────────────────────────────── */

test("a citation is a source number, mapped back to the pack's own URL; an unknown number never passes", () => {
  const records: EvidenceRecord[] = [
    { kind: "MEETING", id: "m", text: "x", sourceUrl: "https://a.example/1" },
    { kind: "AGENDA_ITEM", id: "i", text: "y", sourceUrl: "https://b.example/2" },
    { kind: "AGENDA_ITEM", id: "j", text: "z", sourceUrl: "https://a.example/1" },
    { kind: "BODY", id: "b", text: "w", sourceUrl: null },
  ];
  assert.deepEqual(synthesisSources({ records }), [{ n: 1, url: "https://a.example/1" }, { n: 2, url: "https://b.example/2" }], "each distinct source once, in first-appearance order");
  assert.deepEqual(citedUrlsFrom({ records }, [2, 1, 2]), ["https://b.example/2", "https://a.example/1"]);
  assert.deepEqual(citedUrlsFrom({ records }, [3, "1"]), ["unknown-source:3", "unknown-source:1"], "a number no source carries, or a non-number, is kept — never dropped");
  const pack: EvidencePack = { question: "q", intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null, records, gaps: [], denominators: {}, today: "2026-09-25" };
  assert.equal(validateAnswer("An answer.", citedUrlsFrom({ records }, [1, 2]), pack).kind, "PASSED");
  const refused = validateAnswer("An answer.", citedUrlsFrom({ records }, [3]), pack);
  assert.ok(refused.kind === "FAILED" && refused.failed.some((reason) => reason.startsWith("invented-source-url:unknown-source:3")));
});

test("the synthesis request numbers the sources, asks for numbers, and still generates the answer FIRST", () => {
  const pack: EvidencePack = {
    question: "What's on the agenda?", intent: "UPCOMING_AGENDA", temporal: { kind: "NEXT" },
    subject: { kind: "BODY", id: MESA, name: "Mesa" }, records: [RECORDS[0]], gaps: [], denominators: {}, today: "2026-09-25",
  };
  const body = synthesisRequestBody(pack, { model: ASK_SYNTHESIS_MODEL, cached: true, effort: "medium" }) as {
    output_config: { format: { schema: { properties: Record<string, unknown>; required: string[] } } };
    messages: { content: { text: string }[] }[];
  };
  const schema = body.output_config.format.schema;
  assert.deepEqual(Object.keys(schema.properties), ["answer", "citedSources"], "the answer is the first property, so the citation format cannot change a word of it");
  assert.deepEqual(schema.required, ["answer", "citedSources"]);
  assert.match(synthesisPrompt(pack), /citedSources: the n, from the sources list/);
  assert.doesNotMatch(synthesisPrompt(pack), /citedUrls/);
  const context = JSON.parse(body.messages[0].content[0].text) as { records: EvidenceRecord[]; sources: { n: number; url: string }[] };
  assert.deepEqual(context.records, pack.records, "the records the model reads are unchanged");
  assert.deepEqual(context.sources, [{ n: 1, url: "https://mesa.example.gov/m1" }]);
});

/* ── what the writer is sent, and who writes ─────────────────────────────── */

function voteRows(item: string, members: number, url: string): EvidenceRecord[] {
  return Array.from({ length: members }, (_, index) => ({
    kind: "MEETING_MEMBER_VOTE" as const, id: `${item}#m${index}`, bodyId: MESA, text: `On "Item ${item}", Member ${index} voted Aye.`, sourceUrl: url,
  }));
}

test("the writer is sent every record but member-vote rows past the bound, cut by WHOLE roll call; the proof sees exactly that", () => {
  const action: EvidenceRecord = { kind: "MEETING_ACTION", id: "i1#action", bodyId: MESA, text: "The board's recorded action was \"approve\". The clerk recorded: \"3-2\"", sourceUrl: "https://a.example/actions" };
  assert.equal(WRITER_MEMBER_VOTE_ROWS, 24, "the bound these numbers are written for");
  const records = [action, ...voteRows("i1", 12, "https://a.example/v1"), ...voteRows("i2", 12, "https://a.example/v2"), ...voteRows("i3", 12, "https://a.example/v3")];
  const selection = writerSelection({ records });
  assert.equal(selection.records.length, 25, "the action and the first two roll calls (24 rows)");
  assert.deepEqual(selection.withheld, { memberVoteRows: 12, rollCalls: 1 });
  assert.ok(selection.records.includes(action), "a recorded action is never cut");
  assert.ok(!selection.records.some((record) => record.id.startsWith("i3#")), "the third roll call is withheld whole");
  assert.match(selection.note ?? "", /on 3 roll-call items \(36 rows\).*the rows for 2 of them \(24 rows\).*Every row is shown to the reader.*never say or imply that votes were not published/);
  // One roll call larger than the bound is still sent whole — never half a vote.
  assert.equal(writerSelection({ records: voteRows("big", 55, "https://a.example/big") }).records.length, 55);
  // Nothing past the bound: identity, no note.
  assert.deepEqual(writerSelection({ records: [action] }), { records: [action], note: null, withheld: { memberVoteRows: 0, rollCalls: 0 }, shown: { memberVoteRows: 0, rollCalls: 0 } });

  const pack: EvidencePack = { question: "How did the board vote?", intent: "PAST_MEETING", temporal: { kind: "LAST" }, subject: { kind: "BODY", id: MESA, name: "Mesa" }, records, gaps: [], denominators: { personVoteRowsInPack: 36 }, today: "2026-09-25" };
  const sent = JSON.parse(synthesisContextPayload(pack)) as { records: EvidenceRecord[]; writerSelection: string | null; sources: { n: number; url: string }[]; whatWasSearched: Record<string, number> };
  assert.deepEqual(sent.records, selection.records, "the model input IS the selection");
  assert.equal(sent.writerSelection, selection.note, "and the writer is told what it was not given");
  assert.equal(sent.whatWasSearched.personVoteRowsInPack, 36, "the full count still reaches the writer");
  assert.deepEqual(sent.sources.map((source) => source.url), ["https://a.example/actions", "https://a.example/v1", "https://a.example/v2"], "sources are numbered over what the writer was sent");
  assert.deepEqual(citedUrlsFrom(pack, [3]), ["https://a.example/v2"]);
  assert.deepEqual(writerInputProof(pack, records, sent.records), { receivesItsSelection: true, withheldMemberVoteRows: 12 });
  assert.equal(writerInputProof(pack, records, records).receivesItsSelection, false, "the whole pack is NOT what the writer is sent");
  assert.equal(writerInputProof(pack, records, sent.records.filter((record) => record.id !== action.id)).receivesItsSelection, false, "a withheld action fails the proof");

  // The writer is told, in its rules too, and an answer that calls the withheld votes unpublished is refused
  // (measured 2026-09-25: the fast writer wrote exactly that over a 48-roll-call Pima sitting).
  assert.match(synthesisPrompt(pack), /Never say or imply that the others were not published/);
  const refused = validateAnswer("Four members voted Aye on the first item. The Board has not published how each member voted on most other items.", [], pack);
  assert.ok(refused.kind === "FAILED" && refused.failed.includes("withheld-votes-called-unpublished"));
  assert.equal(validateAnswer("Four members voted Aye on the first item; Member 3 voted Nay on the second.", [], pack).kind, "PASSED");
  const whole: EvidencePack = { ...pack, records: records.slice(0, 13) };
  assert.ok(!(validateAnswer("The Board has not published how each member voted on most other items.", [], whole) as { failed?: string[] }).failed?.includes("withheld-votes-called-unpublished"), "only where rows were held back from the writer");
});

test("the declared ladder: the fast writer first (no thinking, no effort), then the frontier; one switch turns the fast writer off", () => {
  const ladder = synthesisLadder({});
  assert.deepEqual(ladder.map((rung) => [rung.model, rung.role, rung.effort]), [[ASK_FAST_WRITER_MODEL, "FAST", null], [ASK_SYNTHESIS_MODEL, "FRONTIER", "medium"]]);
  assert.deepEqual(synthesisLadder({ WTP_ASK_FAST_MODEL: "off" }).map((rung) => rung.role), ["FRONTIER"]);
  const pack: EvidencePack = { question: "q", intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null, records: [RECORDS[0]], gaps: [], denominators: {}, today: "2026-09-25" };
  const fast = synthesisRequestBody(pack, { model: ASK_FAST_WRITER_MODEL, cached: true }) as { thinking?: unknown; output_config: { effort?: unknown } };
  assert.equal(fast.thinking, undefined);
  assert.equal(fast.output_config.effort, undefined);
  const frontier = synthesisRequestBody(pack, { model: ASK_SYNTHESIS_MODEL, cached: true, effort: "medium" }) as { thinking?: unknown; output_config: { effort?: unknown } };
  assert.deepEqual(frontier.thinking, { type: "adaptive" });
  assert.equal(frontier.output_config.effort, "medium");
});

test("the ladder stops at once on a structural refusal — the next writer would meet the same one", async () => {
  const empty: EvidencePack = { question: "q", intent: "UNKNOWN", temporal: { kind: "NONE" }, subject: null, records: [], gaps: [], denominators: {}, today: "2026-09-25" };
  const result = await synthesizeWithLadder(empty, { apiKey: "k", validate: () => ({ kind: "PASSED", checked: [] }), fetchImpl: (async () => { throw new Error("no call for an empty pack"); }) as unknown as typeof fetch });
  assert.equal(result.outcome.kind, "UNAVAILABLE");
  assert.deepEqual(result.attempts.map((attempt) => [attempt.role, attempt.result, attempt.detail]), [["FAST", "UNAVAILABLE", "no-evidence"]]);
  assert.equal(result.escalation, null);
});


test("government budget questions bind the named or focused body without borrowing a person or ambiguous card", () => {
  const input = {inventory:INVENTORY,namedBodies:INVENTORY};
  assert.equal(lexicalReading({...input,question:"What is the Mesa City Council budget?"})?.shape,"GOVERNMENT_MONEY");
  const focus = {id:MESA,name:"Mesa",kind:"BODY" as const,focused:true};
  assert.equal(lexicalReading({...input,question:"What is this government's budget?",activeSubjects:[focus]})?.subjectId,MESA);
  assert.equal(lexicalReading({...input,question:"What is this government's budget?"}),null);
  assert.equal(lexicalReading({...input,question:"What is this government's budget?",activeSubjects:[focus,{id:MESA_SCHOOLS,name:"Mesa Unified School District Governing Board",kind:"BODY",focused:true}]}),null);
  assert.equal(lexicalReading({...input,question:"What is this government's campaign budget?",activeSubjects:[focus]}),null);
});
