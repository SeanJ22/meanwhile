/**
 * Hooks for admin BR-05 and BR-16/BR-37 in the hunters' runner files:
 * the round reads Admin's shut-door threshold and echoes what it applied into
 * the heartbeat, and the parent runner fires scheduled orders on its own clock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { plainRereadSlot, sourceFailureRecovery } from "../lib/control-plane/workers/detective.ts";
import { DETECTIVE_SHUT_THRESHOLD_SETTING, readSetting, runnerSettingsEcho } from "../lib/control-plane/settings.ts";
import type { AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import type { FreshnessDebt } from "../lib/control-plane/scheduler/debt.ts";

const decision = { kind: "DETERMINISTIC" as const, why: "Known HTTP_GET shape", disagreement: null };
const debt = { obligationId: "owed", cause: "UPSTREAM_ERROR", target: "host", detail: "HTTP 504",
  lastFailedAt: "2026-10-05T01:00:00Z", consecutiveFailures: 3, retryAt: "2026-10-05T01:15:00Z" } as FreshnessDebt;
const config = (value: unknown) => ({ settings: { [DETECTIVE_SHUT_THRESHOLD_SETTING]: value } }) as unknown as AdminConfig;

test("the saved shut-door threshold decides when a door goes to a detective, and the round echoes it", () => {
  const five = readSetting(config(5), DETECTIVE_SHUT_THRESHOLD_SETTING, 3);
  assert.equal(five, 5);
  assert.equal(sourceFailureRecovery(decision, debt, five), decision, "three failures is not shut at a threshold of five");
  assert.equal(sourceFailureRecovery(decision, { ...debt, consecutiveFailures: 5 }, five).kind, "BOUNDED_MODEL_WORKER");
  assert.equal(plainRereadSlot(debt, 3_600_000, five), false, "no alternation for a door that is not shut");
  assert.equal(readSetting(config(0), DETECTIVE_SHUT_THRESHOLD_SETTING, 3), 3, "an invalid saved value reads as the code default");
  assert.equal(readSetting(null, DETECTIVE_SHUT_THRESHOLD_SETTING, 3), 3, "an unreadable config reads as the code default");
  const echo = runnerSettingsEcho(config(5), "2026-10-05T18:00:00Z");
  assert.equal(echo.values[DETECTIVE_SHUT_THRESHOLD_SETTING], 5);
  assert.equal(echo.appliedAt, "2026-10-05T18:00:00Z");
});

test("the round passes the threshold everywhere it decides, and the heartbeat carries the echo", () => {
  const shadow = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(shadow, /const shutThreshold = readSetting\(settingsConfig, DETECTIVE_SHUT_THRESHOLD_SETTING, DETECTIVE_SHUT_THRESHOLD\)/);
  assert.match(shadow, /sourceFailureRecovery\(decision, debt, shutThreshold\)/);
  assert.match(shadow, /plainRereadSlot\(debt, nowMs, shutThreshold\)/);
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
