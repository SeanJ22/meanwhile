import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scheduledWorkDue } from "../lib/control-plane/gateway/scheduled-fire.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { ScheduledOrder } from "../lib/control-plane/gateway/scheduled-orders.ts";

test("the parent runner fires scheduled orders on its own clock, opened at start and after a handoff, closed at quiescence", () => {
  const runner = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  assert.match(runner, /await fireDueOrders\(\{ repos,/);
  const start = runner.slice(runner.indexOf("function startStandingRuntimeClock"), runner.indexOf("let standingDrainFailed"));
  assert.match(start, /startScheduledOrderClock\(\);/, "every place the standing clock opens also opens the order clock");
  assert.doesNotMatch(start.slice(start.indexOf("ownerControlTimer = setInterval")), /fireDueOrders/, "separate from the owner-control timer");
  const hold = runner.slice(runner.indexOf("async function holdStandingRuntimeAtQuiescence"));
  assert.match(hold.slice(0, 800), /await stopScheduledOrderClock\(\);/);
  assert.match(runner.slice(runner.indexOf('reason: "runner shutdown"') - 400), /await stopScheduledOrderClock\(\);/);
});


test("unchanged idle controls need no database order pass; time, repeats, dependencies and the brief still wake it", () => {
  const at="2026-11-07T15:00:00Z",config={...defaultAdminConfig(at),legacyFixQueueImportedAt:at};
  assert.equal(scheduledWorkDue(config,at),false);
  const order={id:"one",startAt:"2026-11-07T16:00:00Z",after:null,repeat:null,decidedAt:at} as ScheduledOrder;
  const timed={...config,scheduledOrders:[order]};
  assert.equal(scheduledWorkDue(timed,at),false);
  assert.equal(scheduledWorkDue(timed,"2026-11-07T16:00:00Z"),true);
  assert.equal(scheduledWorkDue({...timed,scheduledOrders:[{...order,repeat:"hourly",lastFiredAt:at}]},at),false);
  assert.equal(scheduledWorkDue({...timed,scheduledOrders:[{...order,after:"earlier"}]},at),true);
  assert.equal(scheduledWorkDue({...config,settings:{"brief.time":"10:00"}},at),true);
});
