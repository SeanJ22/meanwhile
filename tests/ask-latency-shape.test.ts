import assert from "node:assert/strict";
import test from "node:test";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";
import { installRegistryRuntimeFirstSeeds } from "./helpers/registry-runtime-first-seed.ts";

await Promise.all([
  initializeFederalVoteFirstSeed(),
  installRegistryRuntimeFirstSeeds(),
]);

import { lexicalQuestionShape, lexicalReading } from "../lib/ask/lexical-reading.ts";
import {
  composeSittingAnswer,
  plainGapStatement,
  proseName,
  settleSittingComposition,
  type ComposableSitting,
  type SittingGap,
} from "../lib/ask/sitting-answer.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
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
 * - every composed answer faces the same validator, and a failure never ships.
 */

const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const MESA_SCHOOLS = "ocd-division/country:us/state:az/school_district:mesa_unified_district#board";
const INVENTORY: BindableEntity[] = [
  { id: MESA, name: "Mesa", nameClass: "body", divisionType: "place", level: "BODY" } as BindableEntity,
  { id: MESA_SCHOOLS, name: "Mesa Unified School District Governing Board", nameClass: "body", divisionType: "school_district", level: "BODY" } as BindableEntity,
];

/* ── the lexical reading ─────────────────────────────────────────────────── */

test("the canonical shapes are read, and anything with more in it is not", () => {
  const accepted: [string, string][] = [
    ["When does the Mesa City Council meet next?", "MEETING_TIME"],
    ["When is the next Tucson City Council meeting?", "MEETING_TIME"],
    ["What time does the Pima County Board of Supervisors meet?", "MEETING_TIME"],
    ["When did the Mesa City Council last meet?", "MEETING_TIME"],
    ["When's the Chandler City Council's next meeting?", "MEETING_TIME"],
    ["What's on the Pima County Board of Supervisors agenda?", "BODY_AGENDA"],
    ["What is on the agenda for the Tucson City Council?", "BODY_AGENDA"],
    ["What did the Mesa City Council decide recently?", "MEETING_OUTCOME"],
    ["How did the Pima County Board of Supervisors vote last time?", "MEETING_OUTCOME"],
    ["What did the Pima County Board of Supervisors decide at its last meeting?", "MEETING_OUTCOME"],
  ];
  for (const [question, shape] of accepted) {
    assert.equal(lexicalQuestionShape(question)?.shape, shape, question);
  }
  for (const question of [
    "When does the Mesa City Council meet next about the budget?",
    "When does the Mesa City Council meet next week?",
    "Where does the Mesa City Council meet?",
    "When do they meet next?",
    "Who sits on the Mesa City Council?",
    "What will the Mesa City Council decide next?",
    "What did the Mesa City Council do?",
    "Explain Prop 141 to me",
    "what will the weather be like on election day",
    "Is Pima County voting on data centers?",
  ]) {
    assert.equal(lexicalQuestionShape(question), null, question);
  }
});

test("the lexical reading binds exactly what every binder binds, with the tense the model returned", () => {
  const reading = lexicalReading({ question: "When does the Mesa City Council meet next?", inventory: INVENTORY, namedBodies: INVENTORY });
  assert.ok(reading);
  assert.equal(reading.bodyId, MESA, "the city, not the school district that shares its name");
  assert.equal(reading.interpretation.intent, "MEETING_TIME");
  assert.deepEqual(reading.interpretation.temporal, { kind: "NEXT" });
  assert.deepEqual(reading.interpretation.entityMentions, [], "no model mention: the whole question bound");

  // The 2026-09-25 agreement check against the live model: no tense word is NONE, not NEXT.
  assert.deepEqual(lexicalReading({ question: "When does the Mesa City Council meet?", inventory: INVENTORY, namedBodies: INVENTORY })?.interpretation.temporal, { kind: "NONE" });
  assert.equal(lexicalReading({ question: "When did the Mesa City Council last meet?", inventory: INVENTORY, namedBodies: INVENTORY })?.interpretation.intent, "PAST_MEETING");
  const outcome = lexicalReading({ question: "What did the Mesa City Council decide recently?", inventory: INVENTORY, namedBodies: INVENTORY });
  assert.equal(outcome?.interpretation.intent, "PAST_MEETING");
  assert.deepEqual(outcome?.interpretation.temporal, { kind: "LAST" });
});

test("the lexical reading refuses what it cannot settle, so the model reads it as before", () => {
  const refuse = (question: string, inventory: BindableEntity[] = INVENTORY) =>
    assert.equal(lexicalReading({ question, inventory, namedBodies: inventory }), null, question);
  refuse("When does the Tempe City Council meet next?"); // an unheld name
  refuse("When does the Mesa school board meet next?", [INVENTORY[0]]); // a class the held Mesa body is not
  refuse("When do they meet next?"); // a pronoun
  refuse("Who sits on the Mesa City Council?"); // not a shape
  const twins: BindableEntity[] = [
    ...INVENTORY,
    { id: "ocd-division/country:us/state:az/place:mesa#council-2", name: "Mesa", nameClass: "body", divisionType: "place", level: "BODY" } as BindableEntity,
  ];
  refuse("When does the Mesa City Council meet next?", twins); // two bodies, one name
});

/* ── the composed sitting answer ─────────────────────────────────────────── */

const STUDY: ComposableSitting = { id: "m1", title: "City Council Study Session", startsAt: "2026-09-28T17:15:00-07:00", timeZone: "America/Phoenix", status: "SCHEDULED" };
const REGULAR: ComposableSitting = { id: "m2", title: "City Council", startsAt: "2026-09-28T17:45:00-07:00", timeZone: "America/Phoenix", status: "SCHEDULED" };
const meetingRecord = (sitting: ComposableSitting, url: string): EvidenceRecord =>
  ({ kind: "MEETING", id: sitting.id, bodyId: MESA, text: `Mesa: ${sitting.title}.`, occurredAt: sitting.startsAt, sourceUrl: url });
const RECORDS: EvidenceRecord[] = [meetingRecord(STUDY, "https://mesa.example.gov/m1"), meetingRecord(REGULAR, "https://mesa.example.gov/m2")];
const AGENDA_GAP: SittingGap = { role: "AGENDA", gap: { whose: "OURS", statement: "We hold the agenda document for that meeting but could not extract its items." } };
const NOW = Date.parse("2026-09-25T12:00:00Z");

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
  assert.equal(composeSittingAnswer({ ...base, shape: "MEETING_OUTCOME", records: [RECORDS[0], action], sittingGaps: [] }), null, "recorded actions are for the model to summarise");
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

interface Call { kind: "INTERPRET" | "SYNTHESIZE"; at: number }
const calls: Call[] = [];
let synthesisAnswer = { answer: "The board's next sitting is in the records below.", citedUrls: [] as string[] };

process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
process.env.ANTHROPIC_API_KEY = "test-stub-not-a-real-key";
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  if (!url.startsWith("https://api.anthropic.com/")) throw new Error(`latency test refused an outbound request: ${url}`);
  const body = JSON.parse(String(init?.body)) as { system: unknown };
  const synthesis = Array.isArray(body.system);
  calls.push({ kind: synthesis ? "SYNTHESIZE" : "INTERPRET", at: Date.now() });
  const text = synthesis
    ? JSON.stringify(synthesisAnswer)
    : JSON.stringify({ intent: "CONTACT", entityMentions: [], normalizedMentions: [], temporal: { kind: "NONE" }, referent: null });
  return new Response(JSON.stringify({ content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}) as typeof fetch;

const { POST, resetGroundedState } = await import("../app/api/ask/grounded/route.ts");

interface Payload {
  mode: string;
  answer: string | null;
  records: EvidenceRecord[];
  trace: {
    interpretation: { ran: boolean; why?: string; cached?: boolean };
    synthesis: { ran: boolean; why?: string; cached?: boolean };
    validation: { ran: boolean; passed?: boolean; failed?: string[] };
    composition?: { shape: string; composed: boolean; passed?: boolean };
  };
}

async function ask(question: string, ocdIds: string[], options: { reset?: boolean } = {}): Promise<{ payload: Payload; calls: Call[] }> {
  if (options.reset !== false) resetGroundedState();
  const before = calls.length;
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-latency-shape-test" },
    body: JSON.stringify({ question, ocdIds, today: "2026-08-28" }),
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

test("ROUTE: a lexically read question whose records need summarising makes ONE call — synthesis, never interpretation", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("What's on the Pima County Board of Supervisors agenda?", [AZ, PIMA]);
  assert.deepEqual(made.map((call) => call.kind), ["SYNTHESIZE"]);
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.ok(payload.records.some((record) => record.kind === "AGENDA_ITEM"), "precondition: held items to summarise");
  assert.equal(payload.trace.composition?.composed, false, "composition stepped aside for the model");
  assert.equal(payload.mode, "GROUNDED_CLAUDE");
});

test("ROUTE: any other question reaches the model exactly as before — one reading, then one answer that depends on it", { concurrency: false }, async () => {
  const { payload, calls: made } = await ask("Who sits on the Vail school board?", [AZ, PIMA, VAIL]);
  assert.deepEqual(made.map((call) => call.kind), ["INTERPRET", "SYNTHESIZE"], "the answer needs the reading's binding, so these two are the only sequential calls");
  assert.equal(payload.trace.interpretation.ran, true);
  assert.equal(payload.trace.composition, undefined, "no composition shape");
  assert.equal(payload.mode, "GROUNDED_CLAUDE");
});

test("ROUTE: the same question over unchanged records is served from the cache, with no new call", { concurrency: false }, async () => {
  const first = await ask("Who sits on the Vail school board?", [AZ, PIMA, VAIL]);
  assert.equal(first.calls.length, 2);
  const second = await ask("who sits on the vail school board", [AZ, PIMA, VAIL], { reset: false });
  assert.deepEqual(second.calls, [], "equivalent wording, same evidence: no model call");
  assert.equal(second.payload.trace.interpretation.cached, true);
  assert.equal(second.payload.trace.synthesis.cached, true);
  assert.equal(second.payload.answer, first.payload.answer);
});

test("ROUTE: a model answer that fails validation still fails closed", { concurrency: false }, async () => {
  synthesisAnswer = { answer: "See https://invented.example/agenda for the full list.", citedUrls: ["https://invented.example/agenda"] };
  try {
    const { payload } = await ask("What's on the Pima County Board of Supervisors agenda?", [AZ, PIMA]);
    assert.equal(payload.mode, "REJECTED_FELL_BACK");
    assert.equal(payload.answer, null);
    assert.ok(payload.trace.validation.failed?.some((reason) => reason.startsWith("invented-source-url:")));
  } finally {
    synthesisAnswer = { answer: "The board's next sitting is in the records below.", citedUrls: [] };
  }
});
