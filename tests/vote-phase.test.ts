import assert from "node:assert/strict";
import { test } from "node:test";

import { VOTE_QUESTION_SETTING, voteQuestionPhase, type VoteQuestionSetting } from "../lib/ballot/vote-phase.ts";
import { settingDefinition } from "../lib/control-plane/settings.ts";
import type { ContestResult } from "../lib/ballot/election-results.ts";

const AZ = "ocd-division/country:us/state:az/cd:6";
const TX = "ocd-division/country:us/state:tx";
const NOWHERE = "ocd-division/country:us";
const phase = (input: { setting?: VoteQuestionSetting; ocdId?: string; status?: ContestResult["status"]; date: string | null; now: string }) =>
  voteQuestionPhase({
    setting: input.setting ?? "auto",
    contest: { ocdId: input.ocdId ?? AZ, ...(input.status ? { result: { status: input.status } } : {}) },
    electionDate: input.date,
    now: new Date(input.now),
  });

test("the setting is registered for readers with the three choices and auto by default", () => {
  const definition = settingDefinition(VOTE_QUESTION_SETTING);
  assert.ok(definition);
  assert.equal(definition.defaultValue, "auto");
  assert.equal(definition.readerFacing, true);
  assert.equal(definition.control, "choice");
  assert.deepEqual(definition.choices?.map(choice => choice.value), ["auto", "before", "after"]);
  assert.ok(definition.validate("before") && !definition.validate("later"));
});

test("auto: a contest switches at 9 pm on its own voting day, in its state's clock", () => {
  // Arizona keeps MST all year: 9 pm Nov 3 is 04:00 UTC Nov 4.
  assert.equal(phase({ date: "2026-11-03", now: "2026-11-04T03:59:59Z" }), "before");
  assert.equal(phase({ date: "2026-11-03", now: "2026-11-04T04:00:00Z" }), "after");
  // Texas is on CST in November: 9 pm is 03:00 UTC, an hour earlier than Arizona's.
  assert.equal(phase({ ocdId: TX, date: "2026-11-03", now: "2026-11-04T03:00:00Z" }), "after");
  assert.equal(phase({ ocdId: TX, date: "2026-11-03", now: "2026-11-04T02:59:59Z" }), "before");
  assert.equal(phase({ date: "2026-11-03", now: "2026-10-20T12:00:00Z" }), "before");
});

test("auto: a result that is counting, called or certified means the polls are closed", () => {
  for (const status of ["counting", "called", "certified"] as const) {
    assert.equal(phase({ status, date: "2026-11-03", now: "2026-11-03T15:00:00Z" }), "after", status);
  }
});

test("auto: pending, unopposed and no result follow the clock", () => {
  for (const status of ["pending", "unopposed", undefined] as const) {
    assert.equal(phase({ status, date: "2026-11-03", now: "2026-11-03T15:00:00Z" }), "before", String(status));
    assert.equal(phase({ status, date: "2026-11-03", now: "2026-11-05T15:00:00Z" }), "after", String(status));
  }
});

test("auto: a contest headed to a runoff keeps asking about the runoff", () => {
  assert.equal(phase({ status: "runoff", date: "2026-11-03", now: "2026-11-20T12:00:00Z" }), "before");
  assert.equal(phase({ status: "runoff", date: "2026-11-03", now: "2026-12-20T12:00:00Z" }), "before");
});

test("auto: an unknown date stays on the earlier question, and a place with no state never switches early", () => {
  assert.equal(phase({ date: null, now: "2030-01-01T00:00:00Z" }), "before");
  assert.equal(phase({ date: "", now: "2030-01-01T00:00:00Z" }), "before");
  assert.equal(phase({ ocdId: NOWHERE, date: "2026-11-03", now: "2026-11-04T04:00:00Z" }), "before");
  assert.equal(phase({ ocdId: NOWHERE, date: "2026-11-03", now: "2026-11-04T07:00:00Z" }), "after");
});

test("the Admin override wins over every contest's own clock", () => {
  assert.equal(phase({ setting: "before", status: "certified", date: "2026-11-03", now: "2026-12-30T00:00:00Z" }), "before");
  assert.equal(phase({ setting: "after", date: "2026-11-03", now: "2026-10-01T00:00:00Z" }), "after");
});
