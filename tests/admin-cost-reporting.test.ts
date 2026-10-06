import assert from "node:assert/strict";
import test from "node:test";
import { projectFlow } from "../lib/control-plane/admin-view/flow-read.ts";
import { buildFlowSummary, readBatchSpend, yesterdayWindow } from "../lib/control-plane/admin-view/cost-reporting.ts";
import { measuredHuntSpend, moneyTime } from "../lib/control-plane/admin-view/cost-reporting-view.ts";
import { flowRows } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import { openPaidEndingFix, fixItems } from "../lib/control-plane/fix-list.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { topicOf } from "../lib/control-plane/operator-chat/router.ts";
import { requiredReads } from "../lib/control-plane/operator-chat/context.ts";
import { answerFor } from "../lib/control-plane/operator-chat/read-models.ts";
import type { SpendSummary } from "../lib/control-plane/admin-view/spend-summary.ts";

const now = "2026-10-06T04:30:00.000Z", from = "2026-10-05T04:00:00.000Z", through = "2026-10-06T04:00:00.000Z";
const flow = projectFlow({ stages: [{ hour: from, stage: "liveRecords", count: 4 }, { hour: from, stage: "checkedRecords", count: 12 }], spend: [{ hour: from, usd: 2, unpriced: 0 }] }, from, through);

test("the seven-day rates count deliveries rather than rechecks and retain unknown prices", () => {
  const weekly = projectFlow({ stages: [{ hour: from, stage: "liveRecords", count: 4 }, { hour: from, stage: "checkedRecords", count: 100 }], spend: [{ hour: from, usd: 2, unpriced: 0 }] }, "2026-09-29T04:00:00Z", through);
  assert.equal(weekly.hours.length, 168);
  assert.equal(weekly.factsLivePerHour, 4 / 168);
  assert.equal(weekly.costPerFactUsd, .5);
  assert.equal(flowRows(weekly)[1][1].value, "$0.50");
  assert.match(flowRows(weekly)[0][1].counts!, /across the factory/);
  const unknown = projectFlow({ stages: [{ hour: from, stage: "liveRecords", count: 4 }], spend: [{ hour: from, usd: 2, unpriced: 1 }] }, from, through);
  assert.equal(flowRows(unknown)[1][1].value, null);
  assert.equal(flowRows(undefined)[0][1].value, null);
});

test("Eastern yesterday spans the actual daylight-saving day and Money names EDT or EST", () => {
  for (const [at, hours] of [["2026-03-09T12:00:00Z",23],["2026-11-02T12:00:00Z",25]] as const) {
    const w = yesterdayWindow(at);
    assert.equal((Date.parse(w.through)-Date.parse(w.from))/3_600_000, hours);
  }
  assert.match(moneyTime("2026-10-06T02:00:00Z"), /Oct 5.*10:00 PM EDT/);
  assert.match(moneyTime("2026-12-06T02:00:00Z"), /Dec 5.*9:00 PM EST/);
  assert.equal(measuredHuntSpend({reportedSpendUsd:null}),null);
  assert.equal(measuredHuntSpend({}),null,"an old lower-bound allowance is not a measured hunt cost");
  assert.equal(measuredHuntSpend({reportedSpendUsd:1.25}),1.25);
});

test("the runner summary clips uninstrumented days and an unavailable window is unknown", async () => {
  const args: readonly unknown[][] = [];
  const sql = { query: async (_s: string, a?: readonly unknown[]) => { (args as unknown[][]).push([...(a ?? [])]); return []; } };
  const summary = await buildFlowSummary(sql, now, "2026-10-05T16:00:00Z");
  assert.equal(summary.week!.from,"2026-10-05T16:00:00.000Z");
  assert.ok(args.every(a=>Date.parse(String(a[0]))>=Date.parse("2026-10-05T16:00:00Z")));
  assert.deepEqual(await buildFlowSummary(sql,now,null),{week:null,yesterday:null});
  assert.deepEqual(await buildFlowSummary({query:async()=>{throw Error("unread");}},now,from),{week:null,yesterday:null});
});

test("batch pricing is reported from each recorded flag, with no guessed dollars for unpriced charges", async () => {
  const sql = {query:async()=>[{role:"SCOUT",mode:"batch",usd:1,charges:2,unpriced:0},{role:"SCOUT",mode:"standard",usd:2,charges:3,unpriced:1},{role:"CLERK",mode:"unreported",usd:.2,charges:1,unpriced:0}]};
  const rows = (await readBatchSpend(sql,now)).rows;
  assert.deepEqual(rows.map(r=>[r.mode,r.usd]),[["batch",1],["standard",null],["unreported",.2]]);
});

test("a paid NOTHING ending raises one fix per actual cause, never from a legacy missing outcome", async () => {
  const repos = createMemoryRepositories();
  const input = {paid:true,endingKind:"NOTHING",causeKey:"parser-cause",where:"The saved page parser",says:"The saved page could not be read.",at:now};
  const first = await openPaidEndingFix(repos,input);
  assert.equal(await openPaidEndingFix(repos,input),first);
  assert.equal(await openPaidEndingFix(repos,{...input,endingKind:null}),null);
  assert.equal(await openPaidEndingFix(repos,{...input,paid:false}),null);
  assert.equal(await openPaidEndingFix(repos,{...input,causeKey:null}),null);
  assert.equal(fixItems((await repos.adminConfig.read(ADMIN_CONFIG_ID))!.value).length,1);
});

test("yesterday's Ask answer reads just the measured summary and refuses a stale day's answer", () => {
  assert.equal(topicOf("What did we spend yesterday and what did it get us?"),"YESTERDAY_SPEND");
  assert.deepEqual(requiredReads("YESTERDAY_SPEND"),["spendSummary"]);
  const summary = {readAt:now,spend:{flow:{week:flow,yesterday:flow}}} as SpendSummary;
  const context = {nowIso:now,from:"/admin",stateVersion:null,spendSummary:summary};
  const answer = answerFor("YESTERDAY_SPEND",context,"",null);
  assert.deepEqual(answer.says,["Yesterday's measured window: $2.00 settled; 4 new or updated reader records reached readers."]);
  assert.equal(answer.readBackAt,"/admin?view=scoreboard");
  assert.ok(answerFor("YESTERDAY_SPEND",{...context,nowIso:"2026-10-07T12:00:00Z"},"",null).gaps.length);
});
