import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { meetingOutcomeEvidenceFor, type HeldMeetingAction } from "../lib/ask/meeting-outcomes.ts";
import { composeSittingAnswer, composeSittingAnswerWithBasis, type ComposableSitting, type SittingAnswerInput, type SittingGap } from "../lib/ask/sitting-answer.ts";
import { measureAnswer } from "../lib/ask/length-contract.ts";
import { validateAnswer } from "../lib/ask/validate.ts";
import type { EvidencePack, EvidenceRecord } from "../lib/ask/evidence.ts";
import { useOutcomeSnapshotForTests as installOutcomeSnapshot } from "../lib/outcomes/store.ts";
import { applyMinutesApprovals, minutesLinkFor, minutesSitting, type MinutesDocumentRead } from "../lib/outcomes/minutes-ingest.ts";
import { mergeSnapshot, toPersistedSitting } from "../lib/outcomes/ingest.ts";
import { findClient } from "../lib/sources/legistar/client-registry.ts";
import { toAgendaRecords, toOutcomeRecords } from "../lib/sources/legistar/outcomes.ts";
import type { LegistarEvent, LegistarEventItem } from "../lib/sources/legistar/types.ts";
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

function pimaInput(sitting: ComposableSitting, outcome: ReturnType<typeof meetingOutcomeEvidenceFor>, extra: Partial<SittingAnswerInput> = {}): SittingAnswerInput {
  return {
    shape: "MEETING_OUTCOME", subjectName: "Pima County Board Of Supervisors", sittings: [sitting],
    records: [meetingRecord(sitting, PIMA, "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1825"), ...outcome.records],
    sittingGaps: [], now: NOW, questionClass: "WHAT_WAS_DECIDED", actions: outcome.actions, ...extra,
  };
}

/*
 * A Pima sitting read from the recorded Web API fixture (tests/fixtures/legistar-pima-eventitems-1824.json), the
 * board's 2026-08-11 regular meeting, through the same transform the routine uses.
 */
const pimaClient = findClient("pima")!;
function pimaFixtureSitting(eventId: number, startsAt: string): PersistedSittingOutcomes {
  const items = JSON.parse(readFileSync(`tests/fixtures/legistar-pima-eventitems-${eventId}.json`, "utf8")) as LegistarEventItem[];
  const event = (JSON.parse(readFileSync("tests/fixtures/legistar-pima-events.json", "utf8")) as LegistarEvent[]).find((row) => row.EventId === eventId)!;
  const context = { slug: "pima", eventId, sourceOrg: pimaClient.publishingOrg, readOn: NEVER_READ };
  return toPersistedSitting({ event, client: pimaClient, observedAt: "2026-08-12T22:00:00.000Z", startsAt, routesWalked: ["eventitems"],
    collected: { slug: "pima", eventId, agenda: toAgendaRecords(items, context), outcomes: toOutcomeRecords(items, context), rollCalls: [], failedRollCallExtractions: [], voteRequestFailures: [] } });
}

test("a motion with no result recorded is SAID to have none — never read as passed or failed — and a contradictory result is named as one", () => {
  const sitting = pimaFixtureSitting(1824, "2026-08-11T17:00:00-07:00");
  const held = sitting.outcomes.find((row) => row.dispositionRaw === "Pass" && !row.onConsentCalendar)!;
  // The recorded rows carry no action name; the three test rows name one, so each can be described by its motion.
  const pass = { ...held, action: "approve" };
  const absent = { ...held, eventItemId: held.eventItemId + 800000, action: "informational only", disposition: "NOT_RECORDED" as const, dispositionRaw: null, dispositionConflict: null };
  const contradictory = { ...pass, eventItemId: pass.eventItemId + 900000, disposition: "NOT_RECORDED" as const, dispositionConflict: "the published record says \"Pass\" and its own numeric flag says 0. A record that contradicts itself is not evidence of either answer." };
  const agenda = sitting.agenda.filter((row) => row.eventItemId === pass.eventItemId)
    .flatMap((row) => [row, { ...row, eventItemId: contradictory.eventItemId, title: `Second reading of ${row.title}` }, { ...row, eventItemId: absent.eventItemId, title: `Report on ${row.title}` }]);
  // The two actions the composer leads with are the contested ones; the unremarkable pass is left to the records.
  installOutcomeSnapshot(mergeSnapshot({ generatedOn: "UNKNOWN", generatedAt: "UNKNOWN", tenants: [], sittings: [] }, [{ ...sitting, agenda, outcomes: [absent, contradictory, pass], rollCalls: [] }], { generatedOn: "2026-08-12", generatedAt: "2026-08-12T22:00:00.000Z" }));
  try {
    const chosen: ComposableSitting = { id: sitting.meetingId, title: "Board of Supervisors Regular Meeting", startsAt: sitting.startsAt!, timeZone: "America/Phoenix", status: "SCHEDULED" };
    const outcome = meetingOutcomeEvidenceFor({ bodyId: PIMA, meetingId: chosen.id, startsAt: chosen.startsAt, question: QUESTION });
    assert.deepEqual(outcome.actions.map((action) => action.resultState), ["ABSENT", "CONTRADICTORY", "STATED"]);
    const composed = composeSittingAnswer({ ...pimaInput(chosen, outcome), records: [meetingRecord(chosen, PIMA, "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1824"), ...outcome.records] });
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
    installOutcomeSnapshot(null);
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
  installOutcomeSnapshot(mergeSnapshot(EMPTY_STORE, [first, second], { generatedOn: "2026-09-25", generatedAt: "2026-09-25T18:00:00.000Z" }));
  try {
    const readings = [first, second].map(sitting => meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId: sitting.meetingId, startsAt: sitting.startsAt!, question: "What did the Mesa City Council decide?" }));
    assert.ok(readings.every(reading => reading.actions.length > 0));
    const ids = readings.flatMap(reading => reading.actions.map(action => action.recordId));
    assert.equal(new Set(ids).size, ids.length, "local item numbers cannot collapse distinct sitting records");
    for (const reading of readings) for (const action of reading.actions) {
      assert.ok(action.recordId.startsWith(`${action.meetingId}#`));
      assert.ok(reading.records.some(record => record.id === action.recordId));
    }
  } finally { installOutcomeSnapshot(null); }
});

test("Mesa: the council's decisions from its own minutes — each motion and its result in the minutes' words, and the minutes' standing", () => {
  const july27 = mesaSitting("1336059");
  // The store as the routine holds it: the sitting merged in, its minutes' standing applied.
  installOutcomeSnapshot(applyMinutesApprovals(mergeSnapshot(EMPTY_STORE, [july27], { generatedOn: "2026-09-25", generatedAt: "2026-09-25T18:00:00.000Z" })));
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
    installOutcomeSnapshot(null);
  }
});

/** The Mesa July 27 sitting held as the routine holds it, and a composing input over it. */
function mesaHeld(extraSittings: readonly PersistedSittingOutcomes[] = []) {
  const july27 = mesaSitting("1336059");
  installOutcomeSnapshot(applyMinutesApprovals(mergeSnapshot(EMPTY_STORE, [july27, ...extraSittings], { generatedOn: "2026-09-25", generatedAt: "2026-09-25T18:00:00.000Z" })));
  const sitting: ComposableSitting = { id: july27.meetingId, title: "City Council Meeting", startsAt: july27.startsAt!, timeZone: "America/Phoenix", status: "SCHEDULED" };
  const outcome = meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId: sitting.id, startsAt: sitting.startsAt, question: "What did the Mesa City Council decide recently?" });
  const input: SittingAnswerInput = { shape: "MEETING_OUTCOME", subjectName: "Mesa City Council", sittings: [sitting],
    records: [meetingRecord(sitting, MESA, "https://mesa.legistar.com/MeetingDetail.aspx?ID=1336059"), ...outcome.records],
    sittingGaps: [], now: NOW, questionClass: "WHAT_WAS_DECIDED", actions: outcome.actions };
  return { july27, sitting, outcome, input };
}

test("composition steps aside — and the model writes — whenever the records cannot carry the answer", () => {
  const { sitting, outcome, input } = mesaHeld();
  try {
    assert.ok(composeSittingAnswer(input), "precondition: the whole input composes");
    const other: ComposableSitting = { ...sitting, id: `${sitting.id}-other`, title: "Special Meeting", startsAt: sitting.startsAt.replace(/T\d{2}:/, "T13:") };
    const actionRecords = input.records.filter((record) => record.kind === "MEETING_ACTION");
    const cases: [string, Partial<SittingAnswerInput>][] = [
      ["no held action read beside the records", { actions: [] }],
      ["an action record the route did not hold", { actions: outcome.actions.slice(1) }],
      ["a held action whose record the reader is not shown", { records: input.records.filter((record) => record.id !== outcome.actions[0]!.recordId) }],
      ["a quoted span that is not in its record", { actions: outcome.actions.map((action, index) => index === 0 ? { ...action, result: "Adopted unanimously" } : action) }],
      ["two action records sharing one id (two minutes-read sittings on one day)", { records: [...input.records, actionRecords[0]!] }],
      ["a cancelled sitting", { sittings: [{ ...sitting, status: "CANCELED" }] }],
      ["a sitting still to come", { now: Date.parse("2026-07-01T12:00:00Z") }],
      ["an unrecorded time zone", { sittings: [{ ...sitting, timeZone: null }] }],
      ["an unresolved calendar listing", { records: input.records.map((record) => record.kind === "MEETING" ? { ...record, meetingListingIdentity: { uniqueMeetingCount: null } as EvidenceRecord["meetingListingIdentity"] } : record) }],
      ["a same-day sitting with neither an action nor a named outcome gap", { sittings: [sitting, other], records: [...input.records, meetingRecord(other, MESA, "https://mesa.legistar.com/x")] }],
      ["no described action passes the validator on its own", { admissible: () => false }],
    ];
    for (const [why, change] of cases) assert.equal(composeSittingAnswer({ ...input, ...change }), null, why);
    // "How did they vote" stays on the roll calls; an agenda question is not a decisions question.
    assert.equal(composeSittingAnswerWithBasis({ ...input, questionClass: "HOW_DID_THEY_VOTE" }).basis, "SITTING_AND_GAPS", "minutes with no member votes are not read as roll calls");
    const memberVote = { kind: "MEETING_MEMBER_VOTE", id: `${sitting.id}#vote`, text: "A member's recorded vote." } as EvidenceRecord;
    assert.equal(composeSittingAnswerWithBasis({ ...input, records: [...input.records, memberVote], questionClass: "HOW_DID_THEY_VOTE" }).basis, "ROLL_CALLS");
    assert.equal(composeSittingAnswerWithBasis({ ...input, questionClass: null }).composed, null, "recorded actions outside a decisions question are for the model");
  } finally { installOutcomeSnapshot(null); }
});

test("a same-day sitting is counted beside the chosen one, or its named outcome gap is said for it", () => {
  const first = mesaSitting("1336059");
  const earlierHeld = { ...first, meetingId: `${first.meetingId}-earlier`, startsAt: first.startsAt!.replace(/T\d{2}:\d{2}/, "T13:00") };
  const { sitting, outcome, input } = mesaHeld([earlierHeld]);
  try {
    const earlier: ComposableSitting = { ...sitting, id: earlierHeld.meetingId, title: "City Council Study Session", startsAt: earlierHeld.startsAt };
    const theirs = meetingOutcomeEvidenceFor({ bodyId: MESA, meetingId: earlier.id, startsAt: earlier.startsAt, question: "What did the Mesa City Council decide recently?" });
    assert.ok(theirs.actions.length > 0, "precondition: the earlier sitting holds recorded actions");
    const records = [meetingRecord(sitting, MESA, "https://mesa.legistar.com/1336059"), meetingRecord(earlier, MESA, "https://mesa.legistar.com/earlier"), ...outcome.records, ...theirs.records];
    const both = composeSittingAnswer({ ...input, sittings: [sitting, earlier], records, actions: [...outcome.actions, ...theirs.actions] });
    assert.match(both?.answer ?? "", /^At its Monday, July 27th, 2026 meeting \("City Council Meeting"\), the Mesa City Council recorded 15 actions/, "the chosen sitting is named when the day holds two");
    assert.match(both?.answer ?? "", new RegExp(`The "City Council Study Session" sitting earlier that day recorded ${theirs.actions.length} more actions?\\.`));
    const gap: SittingGap = { role: "OUTCOME", meetingId: earlier.id, gap: { whose: "THEIRS", statement: "We read that sitting's agenda items and the body's own record shows no action recorded against them." } };
    const withGap = composeSittingAnswer({ ...input, sittings: [sitting, earlier], records: records.filter((record) => !theirs.records.includes(record)), sittingGaps: [gap] });
    assert.match(withGap?.answer ?? "", /For the "City Council Study Session" sitting earlier that day: We read that sitting's agenda items and the body's own record shows no action recorded against them\./);
  } finally { installOutcomeSnapshot(null); }
});

test("the held actions are read beside the records, never inside them: every quoted field is a span of its own record's text", () => {
  const { outcome } = mesaHeld();
  try {
    assert.ok(outcome.actions.length > 0, "precondition: the sitting holds recorded actions");
    const byId = new Map(outcome.records.map((record) => [record.id, plain(record.text)]));
    for (const action of outcome.actions as HeldMeetingAction[]) {
      const text = byId.get(action.recordId);
      assert.ok(text, `${action.recordId} is a record the reader is shown`);
      for (const span of [action.item, action.motion, action.result, action.matterFile]) if (span) assert.ok(text.includes(plain(span)), `${action.recordId}: ${span.slice(0, 40)}`);
    }
    assert.ok(outcome.records.every((record) => !("actions" in record)), "the records are unchanged in shape");
  } finally { installOutcomeSnapshot(null); }
});
