import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { foldNewWorkIntoRound, sameRoundFirstHuntEnabled } from "../lib/control-plane/scheduler/same-round-work.ts";
import type { StandingObligation } from "../lib/control-plane/scheduler/durable.ts";

const NOW = "2026-10-04T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const row = (id: string, over: Partial<StandingObligation> = {}): StandingObligation => ({
  id,
  recordClass: "officeholders",
  subjectId: "ocd-division/country:us/state:xx/county:example",
  routeId: "r",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: null,
  nextDueAt: null,
  occurrenceCount: 0,
  openOccurrenceId: null,
  absentUntil: null,
  updatedAt: NOW,
  ...over,
});

test("a row nobody has worked is due in the round that wrote it, and its next-due is written like any other row's", () => {
  const fold = foldNewWorkIntoRound({ rows: [row("a"), row("b")], nowMs: NOW_MS });
  assert.deepEqual(fold.due.map(d => d.obligation.id), ["a", "b"]);
  assert.deepEqual(fold.nextDueWrites, ["a", "b"]);
  assert.deepEqual(fold.unscheduled, []);
});

test("a row already on a future clock waits for its time; an inactive row owes nothing", () => {
  const later = "2026-10-05T12:00:00.000Z";
  const fold = foldNewWorkIntoRound({ rows: [row("later", { nextDueAt: later, lastWorkedAt: NOW, declaredCycleHours: 24 }), row("off", { active: false })], nowMs: NOW_MS });
  assert.deepEqual(fold.due, []);
  assert.deepEqual(fold.notYetDue, ["later"]);
  assert.deepEqual(fold.unscheduled, ["off"]);
});

test("the old one-round lag stays behind a switch in the runner's environment", () => {
  assert.equal(sameRoundFirstHuntEnabled({}), true);
  assert.equal(sameRoundFirstHuntEnabled({ WTP_FIRST_HUNT_NEXT_ROUND: "1" }), false);
});

test("the runner folds the rows the Send just wrote into this round's due list, before the lanes start", () => {
  const source = readFileSync(join(process.cwd(), "scripts/freshness-shadow.mts"), "utf8");
  const applied = source.indexOf("await applyDispatchWork(repos, plan");
  const fold = source.indexOf("foldNewWorkIntoRound(");
  const lanes = source.indexOf("const cycle = await runCycle(");
  assert.ok(applied > 0 && fold > applied && lanes > fold, "dispatch work is written, then folded in, then the lanes run");
  assert.match(source, /sameRoundFirstHuntEnabled\(process\.env\)/);
});
