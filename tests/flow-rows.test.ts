import assert from "node:assert/strict";
import test from "node:test";
import { projectFlow, summarizeFlowWeek, type FlowDay } from "../lib/control-plane/admin-view/flow-read.ts";
import { flowRows, flowStages, spendAnswer } from "../lib/control-plane/admin-view/flow-rows.ts";
import { answerFor } from "../lib/control-plane/operator-chat/read-models.ts";
import { classify } from "../lib/control-plane/operator-chat/router.ts";

const DAY = 86_400_000;
const end = Date.parse("2026-10-06T00:00:00Z");
function day(i: number, live: number, usd: number, unpriced = 0): FlowDay {
  const through = new Date(end - (6 - i) * DAY).toISOString(), from = new Date(end - (7 - i) * DAY).toISOString();
  const hour = new Date(Date.parse(from)).toISOString();
  return { from, through, read: projectFlow({ stages: [{ hour, stage: "liveRecords", count: live }, { hour, stage: "findings", count: live + 3 }], spend: [{ hour, usd, unpriced }] }, from, through) };
}
const week = (days: FlowDay[]) => summarizeFlowWeek(days);

test("facts per hour and cost per fact carry their counts and a seven-day trend", () => {
  const w = week([0, 1, 2, 3, 4, 5, 6].map((i) => day(i, 24, 12)));
  const [[, perHour], [, cost]] = flowRows(w);
  assert.equal(perHour!.value, "1");
  assert.match(perHour!.counts!, /168 new or changed reader records live over 168 recorded hours/);
  assert.equal(perHour!.trend!.length, 7);
  assert.equal(cost!.value, "$0.500");
  assert.match(cost!.counts!, /\$84\.00 settled spend ÷ 168 facts live/);
});

test("days before recording began are gaps, not zeros; no record at all is not measured", () => {
  const w = week([null, null, null, null, null, 0, 1].map((_, i) => (i < 5 ? { ...day(i, 0, 0), read: null } : day(i, 48, 10))));
  const [[, perHour]] = flowRows(w);
  assert.equal(perHour!.trend![0]!.value, null);
  assert.equal(perHour!.trend![6]!.value, 2);
  assert.match(perHour!.counts!, /over 48 recorded hours/);
  for (const [, r] of flowRows(null)) { assert.equal(r.value, null); assert.ok(r.notMeasured); }
  assert.equal(flowStages(null), null);
  assert.equal(flowStages(w)![0]!.live, null);
  assert.equal(flowStages(w)![6]!.live, 48);
});

test("an unpriced charge makes cost unknown, never low; no live facts means no cost per fact", () => {
  const unpriced = week([0, 1, 2, 3, 4, 5, 6].map((i) => day(i, 10, 5, i === 3 ? 1 : 0)));
  const [, [, cost]] = flowRows(unpriced);
  assert.equal(cost!.value, null);
  assert.match(cost!.notMeasured!, /no price/);
  const idle = week([0, 1, 2, 3, 4, 5, 6].map((i) => day(i, 0, 2)));
  assert.equal(flowRows(idle)[1]![1].value, null);
  assert.match(flowRows(idle)[1]![1].notMeasured!, /No fact went live/);
});

test("the spend question routes to its topic and answers in one line from live numbers, with a link", () => {
  const routed = classify("What did we spend yesterday and what did it get us?", []);
  assert.equal(routed.kind, "TOPIC");
  assert.equal(routed.kind === "TOPIC" ? routed.topic : null, "SPEND_AND_FACTS");
  const w = week([0, 1, 2, 3, 4, 5, 6].map((i) => day(i, 30, 6)));
  assert.equal(spendAnswer(w)!.facts, 30);
  const answer = answerFor("SPEND_AND_FACTS", { nowIso: "2026-10-06T00:00:00Z", from: "/admin", stateVersion: null, flow: { kind: "HELD", value: w } }, "spend", null);
  assert.match(answer.says[0]!, /We spent \$6\.00 over the last day and 30 new or changed reader records went live, \$0\.200 per fact/);
  assert.ok(answer.says.some((s) => s.includes("/admin?view=scoreboard")));
  const gapAnswer = answerFor("SPEND_AND_FACTS", { nowIso: "2026-10-06T00:00:00Z", from: "/admin", stateVersion: null, flow: { kind: "NOT_RECORDED", detail: "none yet" } }, "spend", null);
  assert.equal(gapAnswer.denominator.held, false);
});
