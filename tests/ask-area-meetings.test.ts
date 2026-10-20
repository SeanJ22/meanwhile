import assert from "node:assert/strict";
import test from "node:test";

import { AREA_MEETINGS_LISTED, areaMeetingsQuestion, composeAreaMeetings, type AreaSitting } from "../lib/ask/area-meetings.ts";
import type { EvidencePack } from "../lib/ask/evidence.ts";
import { validateAnswer } from "../lib/ask/validate.ts";

const sitting = (id: string, startsAt: string, body = "Vail Unified School District Governing Board", title = "Governing Board Meeting", extra: Partial<AreaSitting> = {}): AreaSitting => ({
  id, title, bodyName: body, bodyId: `${id}#body`, startsAt, timeZone: "America/Phoenix", status: "SCHEDULED",
  provenance: { sourceUrl: `https://example.gov/${id}`, sourceOrg: "Example", collectedAt: "2026-09-28" }, ...extra,
});

/* Noon Phoenix time on Wednesday September 30th, 2026. */
const NOW = Date.parse("2026-09-30T19:00:00Z");

test("the meetings-in-my-area questions are read with their window; a named body or a person is not this", () => {
  const accepted: [string, string][] = [
    ["What meetings are happening this week?", "THIS_WEEK"],
    ["What meetings are happening today?", "TODAY"],
    ["Are there any meetings tomorrow?", "TOMORROW"],
    ["What meetings are happening next week?", "NEXT_WEEK"],
    ["What meetings are scheduled this month?", "THIS_MONTH"],
    ["What meetings are coming up?", "SOON"],
    ["What government meetings are happening near me this week", "THIS_WEEK"],
    ["When is the next meeting near me?", "SOON"],
    ["Upcoming meetings near me", "SOON"],
    ["Is there a meeting soon?", "SOON"],
  ];
  for (const [question, window] of accepted) assert.equal(areaMeetingsQuestion(question)?.window, window, question);
  for (const question of [
    "When is the next Vail school board meeting?",
    "What meetings does the Pima County Board of Supervisors have this week?",
    "What is on the agenda this week?",
    "Who is my state senator?",
    "What meetings are happening this week about the budget?",
  ]) assert.equal(areaMeetingsQuestion(question), null, question);
});

test("a window is calendar days from today in each sitting's own zone, and only sittings that have not started", () => {
  const sittings = [
    sitting("earlier-today", "2026-09-30T16:00:00Z"), // 9 AM: already started
    sitting("tonight", "2026-10-01T02:00:00Z"), // 7 PM Wednesday in Phoenix
    sitting("tomorrow", "2026-10-01T16:00:00Z"),
    sitting("day-6", "2026-10-06T18:00:00Z"),
    sitting("day-7", "2026-10-07T18:00:00Z"),
    sitting("canceled", "2026-10-02T18:00:00Z", "Some Board", "Meeting", { status: "CANCELED" }),
  ];
  const ids = (window: "TODAY" | "TOMORROW" | "THIS_WEEK" | "NEXT_WEEK") => composeAreaMeetings({ ask: { window }, sittings, now: NOW }).inWindow.map((entry) => entry.id);
  assert.deepEqual(ids("TODAY"), ["tonight"], "7 PM Phoenix is still Wednesday, though it is Thursday in UTC");
  assert.deepEqual(ids("TOMORROW"), ["tomorrow"]);
  assert.deepEqual(ids("THIS_WEEK"), ["tonight", "tomorrow", "day-6"]);
  assert.deepEqual(ids("NEXT_WEEK"), ["day-7"]);
});

test("the answer lists the next few with their bodies and their own times, counts the rest, and passes the same validator", () => {
  const sittings = Array.from({ length: 7 }, (_, index) => sitting(`m${index}`, `2026-10-0${index + 1}T17:00:00Z`, `Board ${index}`, `Board ${index}`));
  const composed = composeAreaMeetings({ ask: { window: "THIS_WEEK" }, sittings, now: NOW });
  assert.equal(composed.inWindow.length, 6, "seven sittings, one past the window");
  assert.equal(composed.answer, "We hold 6 meetings in the next 7 days for the governments in your area: Board 0, Thursday, October 1st, 2026 at 10:00 AM MST; Board 1, Friday, October 2nd, 2026 at 10:00 AM MST; Board 2, Saturday, October 3rd, 2026 at 10:00 AM MST; Board 3, Sunday, October 4th, 2026 at 10:00 AM MST; and 2 more, listed below.");
  assert.equal(composed.records.length, AREA_MEETINGS_LISTED);
  assert.deepEqual(composed.citedUrls, ["https://example.gov/m0", "https://example.gov/m1", "https://example.gov/m2", "https://example.gov/m3"]);
  const pack: EvidencePack = { question: "What meetings are happening this week?", intent: "MEETING_TIME", temporal: { kind: "NEXT" }, subject: null, records: composed.records, gaps: composed.gaps, denominators: {}, today: "2026-09-30" };
  assert.equal(validateAnswer(composed.answer, composed.citedUrls, pack).kind, "PASSED");
  const one = composeAreaMeetings({ ask: { window: "TODAY" }, sittings: [sitting("solo", "2026-10-01T02:00:00Z", "Solo Board", "Study Session")], now: NOW });
  assert.equal(one.answer, "We hold 1 meeting today for the governments in your area: Solo Board (Study Session), Wednesday, September 30th, 2026 at 7:00 PM MST.");
  assert.equal(composeAreaMeetings({ ask: { window: "THIS_WEEK" }, sittings: [sitting("x", "2026-10-01T17:00:00Z")], now: NOW, label: () => "Board of Adjustment — Tucson" }).answer.includes("Board of Adjustment — Tucson (Governing Board Meeting), "), true);
});

test("a window with nothing in it is a gap of ours, never 'none are held'", () => {
  const empty = composeAreaMeetings({ ask: { window: "TOMORROW" }, sittings: [], now: NOW });
  assert.equal(empty.answer, "We don't have meeting information tomorrow for your area yet.");
  assert.equal(empty.missingAnswer, true);
  assert.deepEqual(empty.gaps.map((gap) => gap.whose), ["OURS"]);
  assert.deepEqual(empty.records, []);
});
