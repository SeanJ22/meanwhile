import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { initializeFederalVoteFirstSeed } from "./helpers/federal-vote-first-seed.ts";

await initializeFederalVoteFirstSeed();

import { meetingOutcomeEvidenceFor, type HeldMeetingAction } from "../lib/ask/meeting-outcomes.ts";
import { composeSittingAnswer, composeSittingAnswerWithBasis, type ComposableSitting, type SittingAnswerInput, type SittingGap } from "../lib/ask/sitting-answer.ts";
import { measureAnswer } from "../lib/ask/length-contract.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import type { EvidencePack, EvidenceRecord } from "../lib/ask/evidence.ts";
import { getOutcomeSnapshot, useOutcomeSnapshotForTests } from "../lib/outcomes/store.ts";
import { applyMinutesApprovals, minutesLinkFor, minutesSitting, type MinutesDocumentRead } from "../lib/outcomes/minutes-ingest.ts";
import { mergeSnapshot } from "../lib/outcomes/ingest.ts";
import type { OutcomeSnapshot, PersistedSittingOutcomes } from "../lib/outcomes/types.ts";
import { parseCalendarRows, type InSiteCalendarRow } from "../lib/sources/legistar-insite/calendar.ts";
import type { MinutesPage } from "../lib/sources/legistar-insite/minutes.ts";
import { findTenant } from "../lib/sources/legistar-insite/tenant-registry.ts";
import { NEVER_READ } from "../lib/ops/freshness.ts";

const PIMA = "ocd-division/country:us/state:az/county:pima#governing";
const MESA = "ocd-division/country:us/state:az/place:mesa#governing";
const NOW = Date.parse("2026-09-25T12:00:00Z");
const QUESTION = "What did the Pima County Board of Supervisors decide at its last meeting?";

function meetingRecord(sitting: ComposableSitting, bodyId: string, url: string): EvidenceRecord {
  return { kind: "MEETING", id: sitting.id, bodyId, text: `${sitting.title}.`, occurredAt: sitting.startsAt, sourceUrl: url };
}

function packOf(subject: { id: string; name: string }, records: readonly EvidenceRecord[]): EvidencePack {
  return { question: QUESTION, intent: "PAST_MEETING", temporal: { kind: "LAST" }, subject: { kind: "BODY", ...subject }, records: [...records], gaps: [], denominators: {}, today: "2026-09-25" };
}

/** The described actions: the phrases after "Recorded actions described here: N of M — ", up to that sentence's end. */
function describedPhrases(answer: string): string[] {
  const from = answer.slice(answer.indexOf(" — ") + 3);
  const end = from.search(/["a-z]\.(?= [A-Z]|$)/);
  return from.slice(0, end + 1).split("; ");
}

/** Each "..." span of a composed answer, with a cut marker and the composer's quote swap undone. */
function quotedSpans(answer: string): string[] {
  return [...answer.matchAll(/"([^"]+)"/g)].map((match) => match[1].replace(/…$/, "").trim());
}

const plain = (text: string) => text.replace(/\s+/g, " ").replace(/"/g, "'").trim();

/**
 * THE GROUNDING AND PRIVACY CHECK. Every quoted span is a span of a record the
 * reader is shown; no store field outside those records (an item id, a
 * disposition enum, a meeting id, a body id) appears; and every number outside
 * a quote is one the answer's own counts or date account for.
 */
function assertGrounded(answer: string, records: readonly EvidenceRecord[], allowedNumbers: readonly number[]): void {
  const shown = records.map((record) => plain(record.text));
  for (const span of quotedSpans(answer)) {
    assert.ok(shown.some((text) => text.includes(plain(span))), `quoted span is a span of a shown record: ${span}`);
  }
  assert.doesNotMatch(answer, /\b(?:PASSED|FAILED|NOT_RECORDED|RECORDED|OUTCOME_WITHOUT_ROLL_CALL|NOT_RETRIEVED|ACTION_SUMMARY|ROLL_CALL)\b/, "no store enum");
  assert.doesNotMatch(answer, /legistar(?:-insite)?:|ocd-division|#action|\b3\d{5}\b/, "no internal identifier");
  assert.doesNotMatch(answer, /https?:/, "no link written into the prose");
  // A minutes item number is the minutes' own ("Item 5-c"), and so is a span of a shown record.
  const items = [...answer.matchAll(/\bItem (\d[\w-]*(?:, \d[\w-]*)*),/g)].map((match) => match[1]);
  for (const reference of items) assert.ok(shown.some((text) => text.includes(`Item ${reference}`)), `Item ${reference} is a shown record's own number`);
  const outside = answer.replace(/"[^"]+"/g, "").replace(/\bItem \d[\w-]*(?:, \d[\w-]*)*,/g, "");
  for (const number of outside.match(/\d+/g) ?? []) {
    assert.ok(allowedNumbers.includes(Number(number)), `the number ${number} outside a quote is a count or the date`);
  }
}

const PIMA_1825: ComposableSitting = { id: "legistar:pima:1825", title: "Board of Supervisors Regular Meeting", startsAt: "2026-08-25T17:00:00-07:00", timeZone: "America/Phoenix", status: "SCHEDULED" };

function pimaInput(sitting: ComposableSitting, outcome: ReturnType<typeof meetingOutcomeEvidenceFor>, extra: Partial<SittingAnswerInput> = {}): SittingAnswerInput {
  return {
    shape: "MEETING_OUTCOME", subjectName: "Pima County Board Of Supervisors", sittings: [sitting],
    records: [meetingRecord(sitting, PIMA, "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1825"), ...outcome.records],
    sittingGaps: [], now: NOW, questionClass: "WHAT_WAS_DECIDED", actions: outcome.actions, ...extra,
  };
}

test("Pima: what the board decided is its own record — the date, each result counted over the actions, each motion and result in the publisher's words", () => {
  const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: PIMA_1825.id, startsAt: PIMA_1825.startsAt, question: QUESTION });
  assert.equal(outcome.actions.length, 58, "precondition: the committed 2026-08-25 sitting holds 58 recorded actions");
  const input = pimaInput(PIMA_1825, outcome);
  const { composed, basis } = composeSittingAnswerWithBasis(input);
  assert.equal(basis, "RECORDED_ACTIONS");
  assert.ok(composed);
  const lead = /^At its Tuesday, August 25th, 2026 meeting, the Pima County Board of Supervisors recorded 58 actions, each in the records with this answer; published result "Pass": 57 of 58; without a published result: 1 of 58\. Recorded actions described here: (\d+) of 58 — /.exec(composed.answer);
  assert.ok(lead, composed.answer);
  const shown = Number(lead[1]);
  assert.ok(shown >= 2, `several actions are described (${shown})`);
  // Each described action is a held action: its item, its motion and its result, as held.
  const described = describedPhrases(composed.answer);
  assert.equal(described.length, shown);
  for (const phrase of described) {
    const action = outcome.actions.find((held) => held.item && phrase.startsWith(`"${plain(held.item).slice(0, 40)}`));
    assert.ok(action, `the phrase names a held action: ${phrase}`);
    assert.ok(phrase.includes(`"${action.motion}"`), "the clerk's own verb");
    assert.ok(phrase.endsWith(`result "${action.result}"`), "the publisher's own result word");
  }
  assert.deepEqual(composed.citedUrls, ["https://pima.legistar.com/MeetingDetail.aspx?LEGID=1825", "https://webapi.legistar.com/v1/pima/events/1825/eventitems"], "the sitting and the record the actions were read from");
  assert.ok(measureAnswer(composed.answer).characters <= 700);
  assert.equal(validateAnswer(composed.answer, composed.citedUrls, packOf({ id: PIMA, name: "Pima County Board Of Supervisors" }, input.records)).kind, "PASSED", "the same validator a model answer faces");
  assertGrounded(composed.answer, input.records, [25, 2026, 58, 57, 1, shown]);
});

test("Pima: the record now carries the item's title and the publisher's own result word, so a reader can see what was decided", () => {
  const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: PIMA_1825.id, startsAt: PIMA_1825.startsAt, question: QUESTION });
  const first = outcome.records.find((record) => record.id === "329182#action");
  assert.equal(first?.text, "File ID 20656: On \"Contract\nBorderland Construction Company, Inc., to provide for Construction Manager at Risk Services: Santa Cruz Irvington to Valencia Improvements, term date 8/25/26 to 6/30/30, Pima County Flood Control District Tax Levy Fund, contract amount $201,351.43 (PO2600022353) Administering Department: Regional Flood Control District\", the board's recorded action was \"approve\". The published result was \"Pass\". Moved by Rex Scott, seconded by Steve Christy. The clerk recorded: \"Motion by Supervisor Scott, seconded by Supervisor Christy and carried by a 4-0 vote, Supervisor Heinz was not present for the vote, to approve the item.\"");
  const informational = outcome.actions.find((action) => action.motion === "informational only");
  assert.deepEqual([informational?.resultState, informational?.result], ["ABSENT", null], "no pass/fail word is published for it");
  assert.match(outcome.records.find((record) => record.id === informational?.recordId)?.text ?? "", /carries no pass or fail result for the motion\. The result is missing from their record, not decided against\./, "and its record says so, in the store's own words");
});

test("a motion with no result recorded is SAID to have none — never read as passed or failed — and a contradictory result is named as one", () => {
  const snapshot = getOutcomeSnapshot();
  const sitting = snapshot.sittings.find((row) => row.meetingId === "legistar:pima:1822")!;
  const pass = sitting.outcomes.find((row) => row.dispositionRaw === "Pass" && !row.onConsentCalendar)!;
  const absent = sitting.outcomes.find((row) => row.dispositionRaw === null && row.action)!;
  const contradictory = { ...pass, eventItemId: pass.eventItemId + 900000, disposition: "NOT_RECORDED" as const, dispositionConflict: "the published record says \"Pass\" and its own numeric flag says 0. A record that contradicts itself is not evidence of either answer." };
  const agenda = sitting.agenda.filter((row) => [pass.eventItemId, absent.eventItemId].includes(row.eventItemId))
    .flatMap((row) => row.eventItemId === pass.eventItemId ? [row, { ...row, eventItemId: contradictory.eventItemId, title: `Second reading of ${row.title}` }] : [row]);
  // The two actions the composer leads with are the contested ones; the unremarkable pass is left to the records.
  useOutcomeSnapshotForTests({ ...snapshot, sittings: [{ ...sitting, agenda, outcomes: [absent, contradictory, pass], rollCalls: [] }] });
  try {
    const held: ComposableSitting = { id: sitting.meetingId, title: "Board of Supervisors Regular Meeting", startsAt: sitting.startsAt!, timeZone: "America/Phoenix", status: "SCHEDULED" };
    const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: held.id, startsAt: held.startsAt, question: QUESTION });
    assert.deepEqual(outcome.actions.map((action) => action.resultState), ["ABSENT", "CONTRADICTORY", "STATED"]);
    const composed = composeSittingAnswer(pimaInput(held, outcome));
    assert.ok(composed);
    assert.match(composed.answer, /recorded 3 actions, each in the records with this answer; published result "Pass": 1 of 3; without a published result: 1 of 3; with a published result that contradicts itself: 1 of 3\. Recorded actions described here: \d of 3 — /, "every result state is counted over the same actions");
    const phrases = describedPhrases(composed.answer);
    const absentPhrase = phrases.find((phrase) => phrase.includes(`"${absent.action}"`));
    assert.ok(absentPhrase, `the action with no result is described: ${composed.answer}`);
    assert.match(absentPhrase, /, without a published result$/, "…and said to have none");
    assert.doesNotMatch(absentPhrase, /Pass|pass(?:ed)?\b|fail|carried|approved/i, "nothing is inferred for it");
    assert.ok(phrases.some((phrase) => phrase.startsWith("\"Second reading of") && phrase.endsWith("its published result contradicts itself")), "a record that contradicts itself is never given either result");
    assert.equal(phrases.findIndex((phrase) => phrase.startsWith("\"Second reading of")), 0, "the contradictory result leads");
  } finally {
    useOutcomeSnapshotForTests(null);
  }
});

const DIR = "tests/fixtures/legistar-insite-mesa-minutes";
const tenant = findTenant("mesa")!;
const gridRows = [
  ...parseCalendarRows(readFileSync(`${DIR}/calendar-2026-09-25.html`, "utf8")),
  ...parseCalendarRows(readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-paged.html", "utf8")),
  ...parseCalendarRows(readFileSync("tests/fixtures/legistar-insite-mesa-calendar-this-year-page2.html", "utf8")),
];

function gridRow(insiteId: string): InSiteCalendarRow {
  const readings = gridRows.filter((candidate) => candidate.insiteId === insiteId);
  return readings.find((candidate) => candidate.minutes.href) ?? readings[0]!;
}

/** A real Mesa minutes document (the text layer read from its sha256-identified bytes), read into a sitting. */
function mesaSitting(insiteId: string): PersistedSittingOutcomes {
  const fixture = JSON.parse(readFileSync(`${DIR}/minutes-${insiteId}.pages.json`, "utf8")) as { url: string; sha256: string; byteCount: number; pageCount: number; pages: MinutesPage[] };
  const row = gridRow(insiteId);
  const link = minutesLinkFor(row, tenant.host)!;
  const document: MinutesDocumentRead = { link, sha256: fixture.sha256, byteCount: fixture.byteCount, pageCount: fixture.pageCount, pages: fixture.pages, unreadable: null };
  return minutesSitting({ tenant, row, calendarUrl: "https://mesa.legistar.com/Calendar.aspx", observedAt: "2026-09-25T18:00:00.000Z", document, readOn: NEVER_READ }).sitting;
}

const EMPTY_STORE: OutcomeSnapshot = { generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] };

test("minutes-local item numbers stay distinct when a question reads two sittings", () => {
  const first = mesaSitting("1336059");
  const second = { ...first, meetingId: `${first.meetingId}-second-sitting`, startsAt: "2026-07-27T19:00:00-07:00" };
  useOutcomeSnapshotForTests(mergeSnapshot(EMPTY_STORE, [first, second], { generatedOn: "2026-09-25", generatedAt: "2026-09-25T18:00:00.000Z" }));
  try {
    const readings = [first, second].map(sitting => meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId: sitting.meetingId, startsAt: sitting.startsAt!, question: "What did the Mesa City Council decide?" }));
    assert.ok(readings.every(reading => reading.actions.length > 0));
    const ids = readings.flatMap(reading => reading.actions.map(action => action.recordId));
    assert.equal(new Set(ids).size, ids.length, "local item numbers cannot collapse distinct sitting records");
    for (const reading of readings) for (const action of reading.actions) {
      assert.ok(action.recordId.startsWith(`${action.meetingId}#`));
      assert.ok(reading.records.some(record => record.id === action.recordId));
    }
  } finally { useOutcomeSnapshotForTests(null); }
});

test("Mesa: the council's decisions from its own minutes — each motion and its result in the minutes' words, and the minutes' standing", () => {
  const july27 = mesaSitting("1336059");
  // The store as the routine holds it: the sitting merged in, its minutes' standing applied.
  useOutcomeSnapshotForTests(applyMinutesApprovals(mergeSnapshot(EMPTY_STORE, [july27], { generatedOn: "2026-09-25", generatedAt: "2026-09-25T18:00:00.000Z" })));
  try {
    const sitting: ComposableSitting = { id: july27.meetingId, title: "City Council Meeting", startsAt: july27.startsAt!, timeZone: "America/Phoenix", status: "SCHEDULED" };
    const outcome = meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId: sitting.id, startsAt: sitting.startsAt, question: "What did the Mesa City Council decide recently?" });
    assert.equal(outcome.actions.length, 15, "precondition: five motions and the ten consent items the consent motion carried");
    assert.ok(outcome.actions.every((action) => action.source === "MINUTES"));
    const records = [meetingRecord(sitting, MESA, "https://mesa.legistar.com/MeetingDetail.aspx?ID=1336059"), ...outcome.records];
    const composed = composeSittingAnswer({ shape: "MEETING_OUTCOME", subjectName: "Mesa City Council", sittings: [sitting], records, sittingGaps: [], now: NOW, questionClass: "WHAT_WAS_DECIDED", actions: outcome.actions });
    assert.ok(composed);
    // Results the clerk wrote as sentences are quoted per motion, never repeated as count labels.
    const lead = /^At its Monday, July 27th, 2026 meeting, the Mesa City Council recorded 15 actions, each in the records with this answer\. Recorded actions described here: (\d+) of 15 — /.exec(composed.answer);
    assert.ok(lead, composed.answer);
    // The first described motion is the first the council took up off its consent agenda: the item's own first
    // sentence, the motion and the result, in the minutes' words.
    assert.match(composed.answer, / — Item 5-c, "A resolution extending Falcon Field Airport’s landing fee implementation date\.": "that Resolution No\. 12559 be adopted", result "Mayor Freeman declared the motion carried by majority vote\."/);
    assert.match(composed.answer, /\. Published as the council's minutes \("Minutes"\)\. No later sitting we hold records approving them, so they are not described as approved\.$/, "minutes not seen approved are never presented as the approved record");
    const pack = packOf({ id: MESA, name: "Mesa City Council" }, records);
    assert.equal(validateAnswer(composed.answer, composed.citedUrls, pack).kind, "PASSED");
    assert.ok(composed.citedUrls.includes(outcome.records[0]!.sourceUrl!), "the minutes document itself is cited");
    const shown = Number(lead[1]);
    for (const phrase of describedPhrases(composed.answer)) {
      const action = outcome.actions.find((held) => held.itemReference && phrase.startsWith(`Item ${held.itemReference}, `));
      assert.ok(action, `the phrase names a held action: ${phrase}`);
      assert.ok(phrase.endsWith(`result "${action.result}"`), "the minutes' own result");
    }
    assertGrounded(composed.answer, records, [27, 2026, 15, shown]);
  } finally {
    useOutcomeSnapshotForTests(null);
  }
});

test("composition steps aside — and the model writes — whenever the records cannot carry the answer", () => {
  const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: PIMA_1825.id, startsAt: PIMA_1825.startsAt, question: QUESTION });
  const input = pimaInput(PIMA_1825, outcome);
  assert.ok(composeSittingAnswer(input), "precondition: the whole input composes");
  const other: ComposableSitting = { ...PIMA_1825, id: "legistar:pima:9999", title: "Special Meeting", startsAt: "2026-08-25T13:00:00-07:00" };
  const actionRecords = input.records.filter((record) => record.kind === "MEETING_ACTION");
  const cases: [string, Partial<SittingAnswerInput>][] = [
    ["no held action read beside the records", { actions: [] }],
    ["an action record the route did not hold", { actions: outcome.actions.slice(1) }],
    ["a held action whose record the reader is not shown", { records: input.records.filter((record) => record.id !== outcome.actions[0]!.recordId) }],
    ["a quoted span that is not in its record", { actions: outcome.actions.map((action, index) => index === 0 ? { ...action, result: "Adopted unanimously" } : action) }],
    ["two action records sharing one id (two minutes-read sittings on one day)", { records: [...input.records, actionRecords[0]!] }],
    ["a cancelled sitting", { sittings: [{ ...PIMA_1825, status: "CANCELED" }] }],
    ["a sitting still to come", { now: Date.parse("2026-08-01T12:00:00Z") }],
    ["an unrecorded time zone", { sittings: [{ ...PIMA_1825, timeZone: null }] }],
    ["an unresolved calendar listing", { records: input.records.map((record) => record.kind === "MEETING" ? { ...record, meetingListingIdentity: { uniqueMeetingCount: null } as EvidenceRecord["meetingListingIdentity"] } : record) }],
    ["a same-day sitting with neither an action nor a named outcome gap", { sittings: [PIMA_1825, other], records: [...input.records, meetingRecord(other, PIMA, "https://pima.legistar.com/x")] }],
    ["no described action passes the validator on its own", { admissible: () => false }],
  ];
  for (const [why, change] of cases) assert.equal(composeSittingAnswer({ ...input, ...change }), null, why);
  // "How did they vote" stays on the roll calls; an agenda question is not a decisions question.
  assert.equal(composeSittingAnswerWithBasis({ ...input, questionClass: "HOW_DID_THEY_VOTE" }).basis, "ROLL_CALLS");
  assert.equal(composeSittingAnswerWithBasis({ ...input, questionClass: null }).composed, null, "recorded actions outside a decisions question are for the model");
});

test("a same-day sitting is counted beside the chosen one, or its named outcome gap is said for it", () => {
  const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: PIMA_1825.id, startsAt: PIMA_1825.startsAt, question: QUESTION });
  const earlier: ComposableSitting = { ...PIMA_1825, id: "legistar:pima:1873", title: "Board of Supervisors Special Meeting", startsAt: "2026-08-25T15:00:00-07:00" };
  const theirs = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: earlier.id, startsAt: earlier.startsAt, question: QUESTION });
  assert.equal(theirs.actions.length, 1, "precondition: the committed 15:00 sitting holds one recorded action");
  const records = [meetingRecord(PIMA_1825, PIMA, "https://pima.legistar.com/1825"), meetingRecord(earlier, PIMA, "https://pima.legistar.com/1873"), ...outcome.records, ...theirs.records];
  const both = composeSittingAnswer({ ...pimaInput(PIMA_1825, outcome), sittings: [PIMA_1825, earlier], records, actions: [...outcome.actions, ...theirs.actions] });
  assert.match(both?.answer ?? "", /^At its Tuesday, August 25th, 2026 meeting \("Board of Supervisors Regular Meeting"\), the Pima County Board of Supervisors recorded 58 actions/, "the chosen sitting is named when the day holds two");
  assert.match(both?.answer ?? "", /The "Board of Supervisors Special Meeting" sitting earlier that day recorded 1 more action\./);
  const gap: SittingGap = { role: "OUTCOME", meetingId: earlier.id, gap: { whose: "THEIRS", statement: "We read that sitting's agenda items and the body's own record shows no action recorded against them." } };
  const withGap = composeSittingAnswer({ ...pimaInput(PIMA_1825, outcome), sittings: [PIMA_1825, earlier], records: records.filter((record) => !theirs.records.includes(record)), sittingGaps: [gap] });
  assert.match(withGap?.answer ?? "", /For the "Board of Supervisors Special Meeting" sitting earlier that day: We read that sitting's agenda items and the body's own record shows no action recorded against them\./);
});

test("the held actions are read beside the records, never inside them: every quoted field is a span of its own record's text", () => {
  const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: PIMA_1825.id, startsAt: PIMA_1825.startsAt, question: QUESTION });
  const byId = new Map(outcome.records.map((record) => [record.id, plain(record.text)]));
  for (const action of outcome.actions as HeldMeetingAction[]) {
    const text = byId.get(action.recordId);
    assert.ok(text, `${action.recordId} is a record the reader is shown`);
    for (const span of [action.item, action.motion, action.result, action.matterFile]) if (span) assert.ok(text.includes(plain(span)), `${action.recordId}: ${span.slice(0, 40)}`);
  }
  assert.ok(outcome.records.every((record) => !("actions" in record)), "the records are unchanged in shape");
});

const calls: string[] = [];
process.env.WTP_LIMIT_LOG_IP_PER_MINUTE = "10000";
process.env.ANTHROPIC_API_KEY = "test-stub-not-a-real-key";
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input);
  calls.push(url);
  throw new Error(`the decisions answer made an outbound request: ${url}`);
}) as typeof fetch;
const { POST } = await import("../app/api/ask/grounded/route.ts");
const { resetGroundedState } = await import("../lib/ask/grounded-state.ts");

test("ROUTE: \"what did the Pima board decide at its last meeting\" is composed from its recorded actions — no model call, the same validator, nothing of the reader's", { concurrency: false }, async () => {
  resetGroundedState();
  const before = calls.length;
  const started = performance.now();
  const response = await POST(new Request("https://wtp.test/api/ask/grounded", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://wtp.test", host: "wtp.test", "x-wtp-synthetic-run": "ask-decision-answer-test" },
    body: JSON.stringify({ question: QUESTION, ocdIds: ["ocd-division/country:us/state:az", "ocd-division/country:us/state:az/county:pima"], today: "2026-08-28", approximateLocation: "Tucson, 85705" }),
  }));
  const elapsed = performance.now() - started;
  const payload = await response.json() as { mode: string; answer: string | null; records: EvidenceRecord[]; trace: { interpretation: { why?: string }; synthesis: { why?: string }; validation: { passed?: boolean }; composition?: { basis?: string; passed?: boolean }; speculation?: unknown } };
  assert.equal(response.status, 200);
  assert.deepEqual(calls.slice(before), [], "no model call of any kind");
  assert.equal(payload.trace.interpretation.why, "lexical-reading");
  assert.equal(payload.trace.composition?.basis, "RECORDED_ACTIONS");
  assert.equal(payload.trace.synthesis.why, "composed-from-sitting-records");
  assert.equal(payload.trace.validation.passed, true);
  assert.equal(payload.mode, "GROUNDED_COMPOSED");
  assert.equal(payload.trace.speculation, undefined, "a question the code reads starts no speculation");
  assert.match(payload.answer ?? "", /^At its Tuesday, August 25th, 2026 meeting \("[^"]+"\), the Pima County Board of Supervisors recorded 58 actions, each in the records with this answer; published result "Pass": 57 of 58; without a published result: 1 of 58\. Recorded actions described here: \d+ of 58 — "/);
  assert.match(payload.answer ?? "", /sitting earlier that day recorded 1 more action\./);
  assert.doesNotMatch(payload.answer ?? "", /Tucson|85705/, "nothing the reader sent about themselves");
  const shown = Number(/described here: (\d+) of 58/.exec(payload.answer ?? "")?.[1]);
  assertGrounded(payload.answer ?? "", payload.records, [25, 2026, 58, 57, 1, shown]);
  // Measured on this machine, in process, warm seeds: an estimate of the code path only, never a claim about production.
  console.log(`decisions answer composed in ${elapsed.toFixed(0)} ms (local, in-process, no model call)`);
});
