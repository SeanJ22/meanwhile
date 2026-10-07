import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  buildTopicTimeline,
  composeTopicAnswer,
  quotable,
  salientEntry,
  tallyClause,
  topicFocusedQuestion,
} from "../lib/ask/topic-timeline.ts";
import { agendaTopicFor } from "../lib/routing/agenda-search.ts";
import type { OutcomeSnapshot } from "../lib/outcomes/types.ts";
import { overLengthBudget } from "../lib/ask/length-contract.ts";
import { september22Sitting } from "./helpers/pima-september-22-sitting.ts";

const PIMA_BOARD = "ocd-division/country:us/state:az/county:pima#governing";
const NOW = Date.parse("2026-09-24T12:00:00.000Z");
const DATA_CENTER = agendaTopicFor("data center")!;
const SOLAR = agendaTopicFor("solar farm")!;

const seed = JSON.parse(readFileSync("tests/fixtures/ask-topic-timeline.json", "utf8")) as {
  meetings: { id: string; bodyId: string | null; bodyName: string; title: string; startsAt: string; timeZone?: string; agendaUrl?: string | null; status?: string; provenance?: { sourceUrl?: string; sourceOrg?: string; collectedAt?: string } }[];
  agendaDocuments: { meetingId: string; documentUrl: string; sourceUrl: string; sourceOrg: string; retrievedAt: string; text: string | null; extraction: string }[];
  sittings: OutcomeSnapshot["sittings"];
};
const pimaMeetings = seed.meetings.filter((meeting) => meeting.bodyId === PIMA_BOARD);
const pimaDocuments = seed.agendaDocuments.filter((document) => pimaMeetings.some((meeting) => meeting.id === document.meetingId));
const pimaSittings = seed.sittings.filter((sitting) => sitting.bodyId === PIMA_BOARD);

test("a topic question is not a one-sitting question, and a one-sitting question is not a topic question", () => {
  assert.equal(topicFocusedQuestion("is pima county voting on data centers")?.id, "data-center");
  assert.equal(topicFocusedQuestion("Did the Board approve the data center moratorium?")?.id, "data-center");
  assert.equal(topicFocusedQuestion("is there a data center on the next meeting agenda?"), null, "names one sitting");
  assert.equal(topicFocusedQuestion("what did the board discuss at its last meeting about the warehouse"), null, "names one sitting");
  assert.equal(topicFocusedQuestion("when does the board meet"), null, "no curated topic");
});

test("helpers quote without inventing: the tally sentence, the salient item, a sentence-safe quote", () => {
  assert.equal(tallyClause("Motion by Chair Allen, seconded by Supervisor Heinz. Upon roll call, approved 3-2, Supervisors Christy and Scott voted nay."),
    "Upon roll call, approved 3-2, Supervisors Christy and Scott voted nay");
  assert.match(tallyClause(september22Sitting().outcomes[0]!.tallyText) ?? "", /approved as amended with 2 conditions 3-2, Supervisors Christy and Scott voted nay/);
  assert.equal(tallyClause("Motion by Supervisor Heinz, seconded by Supervisor Cano."), null, "no result in the text, no result claimed");
  assert.equal(salientEntry({ itemText: "Moratorium on Data Center Development" }, DATA_CENTER), true);
  assert.equal(salientEntry({ itemText: "Drexel Heights Fire District on behalf of Valley Emergency Communication Center, Amendment No. 6, to provide an intergovernmental agreement for data center racks" }, DATA_CENTER), false);
  const quoted = quotable("RESOLUTION NO. 2026 - 56, of the Board", 100);
  assert.equal(quoted, "RESOLUTION NO…", "a clerk's inner period ends the quote rather than splitting our sentence count");
});

test("PIMA, as held before the September 22 read: the August 11 decision leads, and the unread September 22 sitting is named", () => {
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors",
    meetings: pimaMeetings, documents: pimaDocuments, sittings: pimaSittings, now: NOW,
  });
  const august = timeline.entries.find((entry) => entry.localDay === "2026-08-11" && /Moratorium/i.test(entry.itemText));
  assert.ok(august, "the August 11 moratorium item is on the timeline");
  assert.equal(august.status, "PASSED", "joined to its recorded outcome — the record the old answer never read");
  assert.equal(august.basis, "STRUCTURED_AGENDA_RECORD");
  assert.ok(timeline.records.some((record) => record.kind === "MEETING_ACTION" && /approved 3-2/.test(record.text)), "the recorded action reaches the evidence pack");
  assert.ok(timeline.unreadSittings.some((sitting) => sitting.localDay === "2026-09-22" && sitting.past), "the unread September 22 sitting is named");

  const composed = composeTopicAnswer(timeline, NOW);
  assert.ok(composed);
  assert.match(composed.answer, /^On August 11th, 2026, the Pima County Board Of Supervisors passed agenda item 2 \(File ID 20637\)/);
  assert.match(composed.answer, /approved 3-2, Supervisors Christy and Scott voted nay/);
  assert.match(composed.answer, /We have not read the agenda of the September 22nd, 2026 meeting yet/);
  assert.doesNotMatch(composed.answer, /no record|still looking|data center racks/i, "no false absence, no false progress claim, no off-subject lead");
  assert.equal(overLengthBudget(composed.answer), null, "inside the one length contract");
  assert.ok(composed.citedUrls.every((url) => timeline.records.some((record) => record.sourceUrl === url)), "cites only held records");
});

test("PIMA, after the September 22 read: the adopted moratorium leads, from the official record, with its tally", () => {
  const sittings = [september22Sitting(), ...pimaSittings];
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors",
    meetings: pimaMeetings, documents: pimaDocuments, sittings, now: NOW,
  });
  assert.equal(timeline.unreadSittings.some((sitting) => sitting.localDay === "2026-09-22"), false, "a sitting whose structured agenda was read is not unread");
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /^On September 22nd, 2026, the Pima County Board Of Supervisors passed agenda item 18 \(File ID 20801\), "Moratorium on Data Center Development" \(recorded action: "approve as amended"\)/);
  assert.match(composed.answer, /approved as amended with 2 conditions 3-2, Supervisors Christy and Scott voted nay/);
  assert.match(composed.answer, /Earlier, on August 11th, 2026, the board passed agenda item 2/);
  assert.ok(composed.citedUrls.includes("https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394"), "the reader link is the sitting's public page");
  assert.equal(overLengthBudget(composed.answer), null);
});

test("an agenda line with no recorded outcome says exactly that, never that nothing happened", () => {
  const meetings = [{ id: "legistar:pima:1824", bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-08-11T17:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: "https://example.gov/a.pdf", provenance: { collectedAt: "2026-09-24T10:00:00Z" } }];
  const documents = [{ meetingId: "legistar:pima:1824", documentUrl: "https://example.gov/a.pdf", sourceUrl: "https://example.gov/a.pdf", sourceOrg: "Clerk", retrievedAt: "2026-09-24T10:00:00Z", text: "2. Establishing a 120-day Moratorium on Data Centers in Unincorporated Pima County Discussion/Direction/Action", extraction: "text" }];
  const timeline = buildTopicTimeline({ topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors", meetings, documents, sittings: [], now: NOW });
  assert.equal(timeline.entries[0]?.status, "OUTCOME_NOT_READ");
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /was on the Pima County Board Of Supervisors' agenda for August 11th, 2026; we have not read the recorded outcome of that item/);
});

test("ANOTHER STATE, ANOTHER PLATFORM: a New Hampshire town calendar (iCal/schedule page) with a scheduled solar item and an unread recent sitting", () => {
  const body = "ocd-division/country:us/state:nh/county:merrimack/place:newbury_town#planning-board";
  const meetings = [
    { id: "ical:newbury-planning:2026-10-06", bodyName: "Newbury Planning Board", title: "Planning Board", startsAt: "2026-10-06T19:00:00-04:00", timeZone: "America/New_York", agendaUrl: "https://www.newbury.nh.gov/planning-board/agenda-10-06.pdf", provenance: { collectedAt: "2026-09-10T15:00:00Z" } },
    { id: "ical:newbury-planning:2026-09-15", bodyName: "Newbury Planning Board", title: "Planning Board", startsAt: "2026-09-15T19:00:00-04:00", timeZone: "America/New_York", agendaUrl: null, provenance: { collectedAt: "2026-09-10T15:00:00Z" } },
  ];
  const documents = [{ meetingId: "ical:newbury-planning:2026-10-06", documentUrl: "https://www.newbury.nh.gov/planning-board/agenda-10-06.pdf", sourceUrl: "https://www.newbury.nh.gov/planning-board", sourceOrg: "Town of Newbury", retrievedAt: "2026-09-10T15:00:00Z", text: "3. Site plan review: 5 MW solar array off Route 103, continued public hearing", extraction: "text" }];
  const timeline = buildTopicTimeline({ topic: SOLAR, bodyId: body, bodyName: "Newbury Planning Board", meetings, documents, sittings: [], now: NOW });
  assert.equal(timeline.entries.length, 1);
  assert.equal(timeline.entries[0]!.status, "SCHEDULED");
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /^The Newbury Planning Board has an agenda item, "3\. Site plan review: 5 MW solar array off Route 103, continued public hearing" on its agenda for October 6th, 2026/);
  assert.match(composed.answer, /The board's upcoming meetings shown here were last read from its calendar on September 10th, 2026/, "a two-week-old read of the upcoming listings is dated, not presented as current");
  assert.equal(overLengthBudget(composed.answer), null);
});

test("ANOTHER STATE, ANOTHER PLATFORM, HELD DATA: Rockaway Township (NJ, CivicPlus AgendaCenter) quotes the data-center ordinance, not its neighbour", () => {
  const body = "ocd-division/country:us/state:nj/county:morris/place:rockaway_township#governing";
  const meetings = seed.meetings.filter((meeting) => meeting.bodyId === body);
  const documents = seed.agendaDocuments.filter((document) => meetings.some((meeting) => meeting.id === document.meetingId));
  assert.ok(meetings.length > 0 && documents.length > 0, "the recorded Rockaway calendar and agendas are in the fixture");
  const timeline = buildTopicTimeline({ topic: DATA_CENTER, bodyId: body, bodyName: "Rockaway Township Council", meetings, documents, sittings: [], now: NOW });
  const days = timeline.entries.map((entry) => entry.localDay);
  assert.ok(days.includes("2026-06-09") && days.includes("2026-07-14"), `introduction and adoption sittings both held: ${days.join(", ")}`);
  for (const entry of timeline.entries) {
    assert.match(entry.itemText, /DATA CENTERS/i, "every quote carries the phrase the reader asked about");
    assert.equal(entry.status, "OUTCOME_NOT_READ", "no structured outcome is held for this body, and none is implied");
  }
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /July 14th, 2026/);
  assert.match(composed.answer, /DESIGNATE DATA CENTERS AS A PROHIBITED USE/);
  assert.doesNotMatch(composed.answer, /ADA IMPROVEMENTS/, "the neighbouring ordinance on the same line is not quoted as the answer");
  assert.match(composed.answer, /we have not read the recorded outcome of that item/);
  assert.equal(overLengthBudget(composed.answer), null);
});

test("an unreadable outcome store is named as our holding failure, never as 'no action'", () => {
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors",
    meetings: pimaMeetings, documents: pimaDocuments, sittings: [], now: NOW, outcomesUnavailable: true,
  });
  assert.ok(timeline.gaps.some((gap) => gap.whose === "OURS" && /could not be read for this answer.*not evidence that the body took no action/.test(gap.statement)));
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /the recorded outcomes could not be read for this answer/);
  assert.doesNotMatch(composed.answer, /we have not read the recorded outcome/, "a failed read is not an unread record");
});

test("held agendas that never mention the topic say what was searched, and what was not read", () => {
  const meetings = [
    { id: "x:1", bodyName: "Council", title: "Council", startsAt: "2026-09-01T18:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: "https://example.gov/1.pdf", provenance: { collectedAt: "2026-09-24T10:00:00Z" } },
    { id: "x:2", bodyName: "Council", title: "Council", startsAt: "2026-09-15T18:00:00-07:00", timeZone: "America/Phoenix", provenance: { collectedAt: "2026-09-24T10:00:00Z" } },
  ];
  const documents = [{ meetingId: "x:1", documentUrl: "https://example.gov/1.pdf", sourceUrl: "https://example.gov/1.pdf", sourceOrg: "Clerk", retrievedAt: "2026-09-02T00:00:00Z", text: "1. Call to order. 2. Budget amendment for parks.", extraction: "text" }];
  const timeline = buildTopicTimeline({ topic: DATA_CENTER, bodyId: "b", bodyName: "Example City Council", meetings, documents, sittings: [], now: NOW });
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /^No mention of a data center in the 1 agenda we hold for Example City Council\./);
  assert.match(composed.answer, /We have not read the agenda of the September 15th, 2026 meeting yet/);
});

test("a canceled sitting is not named as an unread agenda, and a sitting beyond the window is not either", () => {
  const meetings = [
    { id: "x:1", bodyName: "Council", title: "Council", startsAt: "2026-09-20T18:00:00-07:00", timeZone: "America/Phoenix", status: "CANCELED", provenance: { collectedAt: "2026-09-24T10:00:00Z" } },
    { id: "x:2", bodyName: "Council", title: "Council", startsAt: "2026-06-01T18:00:00-07:00", timeZone: "America/Phoenix", provenance: { collectedAt: "2026-09-24T10:00:00Z" } },
  ];
  const timeline = buildTopicTimeline({ topic: DATA_CENTER, bodyId: "b", bodyName: "Council", meetings, documents: [], sittings: [], now: NOW });
  assert.deepEqual(timeline.unreadSittings, []);
  assert.equal(
    composeTopicAnswer(timeline, NOW)?.answer,
    "We don't hold any readable agendas for Council yet, so nothing was searched for a data center.",
    "nothing searched is said as nothing searched, never as nothing found",
  );
});

test("TWO ROUTES, ONE STALE: the upcoming listings are dated by their own read, not by a fresh route that carries none of them", () => {
  // The API route was read today and carries only the September 22 sittings; every upcoming sitting came from an older portal read.
  const meetings = [
    { id: "legistar:pima:1828", bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-09-22T17:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf", provenance: { collectedAt: "2026-09-24T11:14:30.415Z" } },
    { id: "legistar-insite:pima:1381579", bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-10-13T17:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: null, provenance: { collectedAt: "2026-09-08T21:40:43.908Z" } },
    { id: "legistar-insite:pima:1381580", bodyName: "Board of Supervisors", title: "Board of Supervisors", startsAt: "2026-10-27T17:00:00-07:00", timeZone: "America/Phoenix", agendaUrl: null, provenance: { collectedAt: "2026-09-08T21:40:43.908Z" } },
  ];
  const timeline = buildTopicTimeline({ topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors", meetings, documents: [], sittings: [], now: NOW });
  assert.equal(timeline.calendarLastReadAt, "2026-09-08T21:40:43.908Z", "the upcoming listings' own read, not the fresh route's");
  assert.equal(timeline.calendarReadBoundsUpcoming, true);
  assert.ok(timeline.gaps.some((gap) => /The upcoming Pima County Board Of Supervisors meetings in this answer were last read from its calendar on September 8th, 2026/.test(gap.statement)), JSON.stringify(timeline.gaps));

  // With nothing upcoming, the body is dated by its newest read, and a fresh read states nothing.
  const pastOnly = buildTopicTimeline({ topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors", meetings: meetings.slice(0, 1), documents: [], sittings: [], now: NOW });
  assert.equal(pastOnly.calendarReadBoundsUpcoming, false);
  assert.equal(pastOnly.calendarLastReadAt, "2026-09-24T11:14:30.415Z");
  assert.ok(!pastOnly.gaps.some((gap) => /last read|most recent read/.test(gap.statement)), "a read from this morning is not dated as old");
});

/** The September 22 agenda as read from the county portal: the extracted text around item 18. */
const SEPT22_PORTAL_AGENDA = {
  meetingId: "legistar:pima:1828",
  documentUrl: "https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=00EFD752-6A28-42D3-B329-E717E49891D0&G=7B470E9E-E35C-4698-8FA6-D778FB28F394",
  sourceUrl: "https://pima.legistar.com/View.ashx?M=A&ID=1381577&GUID=00EFD752-6A28-42D3-B329-E717E49891D0&G=7B470E9E-E35C-4698-8FA6-D778FB28F394",
  sourceOrg: "Pima County Clerk of the Board",
  retrievedAt: "2026-09-24T13:19:36.340Z",
  extraction: "pdf",
  text: "17. County Administrator Hiring Process Discussion/Direction/Action regarding the County Administrator Hiring Process. (District 3) COUNTY ADMINISTRATOR 18. Moratorium on Data Center Development RESOLUTION NO. 2026 - 56 , of the Board of Supervisors, implementing a moratorium on data center development. 19. Call to the Public",
};
const SEPT22_ROW = {
  id: "legistar:pima:1828", bodyId: PIMA_BOARD, bodyName: "Board of Supervisors", title: "Board of Supervisors",
  startsAt: "2026-09-22T17:00:00-07:00", timeZone: "America/Phoenix",
  agendaUrl: "https://legistar.granicus.com/pima/meetings/2026/9/1828_A_Board_of_Supervisors_26-09-22_Online_Agenda.pdf",
  provenance: { sourceUrl: "https://pima.legistar.com/MeetingDetail.aspx?LEGID=1828&GID=243&G=7B470E9E-E35C-4698-8FA6-D778FB28F394", sourceOrg: "Pima County Clerk of the Board", collectedAt: "2026-09-24T13:19:29.153Z" },
};

test("PIMA, agenda text and recorded outcome both held: September 22 is stated once, led by the recorded decision", () => {
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors",
    meetings: [...pimaMeetings, SEPT22_ROW], documents: [...pimaDocuments, SEPT22_PORTAL_AGENDA], sittings: [september22Sitting(), ...pimaSittings], now: NOW,
  });
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /^On September 22nd, 2026, the Pima County Board Of Supervisors passed agenda item 18 \(File ID 20801\)/);
  assert.equal((composed.answer.match(/September 22nd/g) ?? []).length, 1, `September 22 is stated once: ${composed.answer}`);
  assert.match(composed.answer, /Earlier, on August 11th, 2026, the board passed agenda item 2/);
  assert.equal(overLengthBudget(composed.answer), null);
});

test("PIMA, agenda text held and the outcome not yet read: September 22 leads as on the agenda with its outcome unread, and August 11 follows", () => {
  const timeline = buildTopicTimeline({
    topic: DATA_CENTER, bodyId: PIMA_BOARD, bodyName: "Pima County Board Of Supervisors",
    meetings: [...pimaMeetings, SEPT22_ROW], documents: [...pimaDocuments, SEPT22_PORTAL_AGENDA], sittings: pimaSittings, now: NOW,
  });
  const sept22 = timeline.entries.find((entry) => entry.localDay === "2026-09-22");
  assert.ok(sept22, "the portal agenda's item 18 is on the timeline");
  assert.equal(sept22.status, "OUTCOME_NOT_READ");
  const composed = composeTopicAnswer(timeline, NOW)!;
  assert.match(composed.answer, /Moratorium on Data Center Development/);
  assert.match(composed.answer, /September 22nd, 2026; we have not read the recorded outcome of that item/);
  assert.match(composed.answer, /Earlier, on August 11th, 2026, the board passed agenda item 2/);
  assert.doesNotMatch(composed.answer, /no record|still looking/i);
  assert.equal(overLengthBudget(composed.answer), null);
});
