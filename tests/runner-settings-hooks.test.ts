import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("the round's heartbeat carries the settings echo", () => {
  const shadow = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(shadow, /settings: runnerSettingsEcho\(settingsConfig, NOW\)/);
});

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
