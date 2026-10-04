/**
 * RULING 52/53 enforced for the scout scheduler: a proven absence is recorded
 * and expires on a clock, so a correct negative is not re-walked every cycle.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { scheduleObligation, isScheduled, type FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { ABSENCE_EXPIRY_DAYS, absenceExpiry, isArguedAbsence } from "../lib/control-plane/scheduler/absence.ts";
import { recordArguedAbsence, standing } from "../lib/control-plane/scheduler/durable.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const NOW = "2026-09-19T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);

const BASE: FreshnessObligation = {
  id: "freshness:candidate-enrichment:nj:2026:x:y#candidate-authored-awaits-site",
  recordClass: "positions",
  subjectId: "ocd-division/country:us/state:nj/place:x",
  routeId: "candidate-authored-awaits-site",
  active: true,
  readerImpactAt: null,
  observedChangeRateHours: null,
  lastWorkedAt: new Date(NOW_MS - 48 * 3_600_000).toISOString(),
};

test("a standing (future) absence holds the next reading to the expiry, not the ordinary cadence", () => {
  const until = absenceExpiry(NOW); // NOW + 30 days
  const row = scheduleObligation({ ...BASE, absentUntil: until }, NOW_MS);
  assert.ok(isScheduled(row));
  if (!isScheduled(row)) return;
  assert.equal(row.nextDueAt, until);
  assert.equal(row.cadenceSource, "ARGUED_ABSENT");
  // Without the absence this same row (daily default, worked 48h ago) is due now.
  const plain = scheduleObligation(BASE, NOW_MS);
  assert.ok(isScheduled(plain) && Date.parse(plain.nextDueAt) <= NOW_MS, "the same row is due now without the absence");
});

test("an EXPIRED absence is ignored — the row comes due on its ordinary cadence again (RULING 53)", () => {
  const past = new Date(NOW_MS - 3_600_000).toISOString(); // expired an hour ago
  const row = scheduleObligation({ ...BASE, absentUntil: past }, NOW_MS);
  assert.ok(isScheduled(row));
  if (!isScheduled(row)) return;
  assert.notEqual(row.cadenceSource, "ARGUED_ABSENT");
  assert.ok(Date.parse(row.nextDueAt) <= NOW_MS, "an expired absence does not delay the reading");
});

test("isArguedAbsence: only a finished, floor-clearing NO_PROGRESS is an absence; BLOCKED, a refusal, a find, or a thin walk is not", () => {
  const min = 6;
  const argued = { outcome: "NO_PROGRESS", stoppedBy: "BOUND", distinctEvidenceRungs: 8, refusal: null, researchRole: "DETECTIVE" as const };
  assert.equal(isArguedAbsence(argued, min), true, "the ladder was walked to the floor and nothing is there");
  assert.equal(isArguedAbsence({ ...argued, stoppedBy: "MODEL" }, min), true, "the model's own judgment that nothing is there is an absence too");
  assert.equal(isArguedAbsence({ ...argued, outcome: "BLOCKED", stoppedBy: "MODEL" }, min), false, "BLOCKED is an obstruction (RULING 250), retried on its cadence, never a recorded absence");
  assert.equal(isArguedAbsence({ ...argued, refusal: [{ code: "SCOUT_NO_FINISH" }] }, min), false, "a refusal is debt/retry, not an absence");
  assert.equal(isArguedAbsence({ ...argued, outcome: "EVIDENCE_FOUND" }, min), false, "a find is not an absence");
  assert.equal(isArguedAbsence({ ...argued, distinctEvidenceRungs: min - 1 }, min), false, "below the floor, absence is asserted not argued");
  assert.equal(isArguedAbsence({ ...argued, researchRole: "SCOUT" }, min), false, "a Scout walk that hit its limit goes to a detective before it is called absent (DP-04)");
  assert.equal(isArguedAbsence({ ...argued, researchRole: undefined }, min), false);
  assert.equal(isArguedAbsence({ ...argued, stoppedBy: "GRADUATED" }, min), false, "a route refused before a walk is not an absence");
});

test("recordArguedAbsence sets absentUntil and advances the stored next-due to the expiry", async () => {
  const repos = createMemoryRepositories();
  await repos.obligations.put(BASE.id, standing(BASE, NOW), NOW);
  const until = absenceExpiry(NOW);
  await recordArguedAbsence(repos, { obligationId: BASE.id, absentUntil: until, now: NOW });
  const row = await repos.obligations.mustRead(BASE.id);
  assert.equal(row.value.absentUntil, until);
  assert.equal(row.value.nextDueAt, until, "the stored next-due matches the absence expiry so the durable due-query agrees");
  const scheduled = scheduleObligation(row.value, NOW_MS);
  assert.ok(isScheduled(scheduled) && scheduled.nextDueAt === until && scheduled.cadenceSource === "ARGUED_ABSENT");
  assert.equal(ABSENCE_EXPIRY_DAYS, 30);
});

import { absenceUnlockFrom } from "../lib/control-plane/scheduler/absence.ts";
import { scoutDeadEnd } from "../lib/control-plane/admin-view/dead-ends.ts";

test("an absence stores what would unlock it, built from the detective's next steps (DP-06)", () => {
  const until = "2026-11-01T00:00:00.000Z";
  const unlock = absenceUnlockFrom({ nextRungs: ["a platform adapter for the county's vendor", "a records request"], narrative: "Nothing here.", recordClass: "officials" }, until);
  assert.match(unlock.text, /platform adapter.*records request/);
  assert.deepEqual(unlock.triggers, [{ kind: "ROUTE", recordClass: "officials" }, { kind: "DATE", at: until }]);
  const fromNarrative = absenceUnlockFrom({ nextRungs: [], narrative: "The town posts nothing online. A call would settle it." }, until);
  assert.equal(fromNarrative.text, "The town posts nothing online.");
  assert.deepEqual(fromNarrative.triggers, [{ kind: "DATE", at: until }]);
});

test("a dead end says what would unlock it from the stored condition", () => {
  const base = { rungs: [], nextRungs: ["walk X"], outcome: "NO_PROGRESS", refusal: null, recordedAt: "2026-09-25T12:00:00.000Z" } as never;
  assert.match(scoutDeadEnd(base, { unlockWhen: { text: "a new adapter" } }).wouldSettle ?? "", /^Would unlock: a new adapter\.$/);
  assert.match(scoutDeadEnd(base).wouldSettle ?? "", /walk X/);
});
