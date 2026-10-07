/** Speed comes from our own scheduled test visits; nothing about real readers' timing or errors is collected. */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { CLIENT_EVENT_TYPES } from "../lib/events/wire.ts";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { SPEED_VISITS_EVERY_MS, speedVisitsDue, speedVisitsEnabled, speedVisitsLane } from "../lib/health/speed-visits.ts";

const NOW = "2026-10-06T12:00:00.000Z";

test("a visit is due when none is recorded or the last is older than the interval; off unless switched on", () => {
  assert.equal(speedVisitsDue(null, NOW), true);
  assert.equal(speedVisitsDue("2026-10-06T08:00:00.000Z", NOW), false);
  assert.equal(speedVisitsDue(new Date(Date.parse(NOW) - SPEED_VISITS_EVERY_MS).toISOString(), NOW), true);
  assert.equal(speedVisitsDue("garbage", NOW), true);
  assert.equal(speedVisitsEnabled({}), false);
  assert.equal(speedVisitsEnabled({ WTP_SPEED_VISITS: "on" }), true);
});

test("the lane registers on the runner's scheduler and runs once per tick, never overlapping itself", async () => {
  let runs = 0;
  const scheduler = new IndependentRuntimeLaneScheduler([speedVisitsLane(async () => { runs += 1; })]);
  assert.deepEqual(scheduler.tick(0), ["speed-visits"]);
  assert.deepEqual(scheduler.tick(1_000), [], "not due again yet");
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(runs, 1);
});

test("no reader-side code collects page timing or errors: the wire has no such event and no page imports the measuring code", () => {
  for (const type of CLIENT_EVENT_TYPES) assert.doesNotMatch(type, /TIMING|LOAD|PERF|VITAL|ERROR|SPEED/i, type);
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? (name === "node_modules" || name === ".next" ? [] : walk(path)) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
  const offenders = [...walk("app"), ...walk("components")].filter((file) => {
    const text = readFileSync(file, "utf8");
    return /health\/page-metrics|health\/worst-case-speed|new PerformanceObserver|web-vitals|reportWebVitals/.test(text);
  });
  assert.deepEqual(offenders, []);
  const error = readFileSync("app/error.tsx", "utf8");
  assert.doesNotMatch(error, /fetch\(|sendBeacon|\/api\//, "the error boundary reports nothing about the reader");
});
