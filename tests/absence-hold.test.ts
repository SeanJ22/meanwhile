/** A dead end waits its source's own pace or the owner's per-class days, never past the longest-wait setting (5 days to start). */
import assert from "node:assert/strict";
import test from "node:test";

import { defaultAdminConfig, ADMIN_CONFIG_ID } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { ABSENCE_HOLD_BY_CLASS_SETTING, ABSENCE_MAX_HOLD_SETTING, absenceHold } from "../lib/control-plane/scheduler/absence-hold.ts";
import { absenceExpiry, absenceUnlockFrom } from "../lib/control-plane/scheduler/absence.ts";
import { recordArguedAbsence, type StandingObligation } from "../lib/control-plane/scheduler/durable.ts";
import type { FreshnessObligation } from "../lib/control-plane/scheduler/obligation.ts";
import { withSetting } from "../lib/control-plane/settings.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(NOW) + days * DAY).toISOString();
const obligation = (over: Partial<FreshnessObligation> = {}): FreshnessObligation => ({ id: "o", recordClass: "officials", subjectId: "s", routeId: "r",
  active: true, readerImpactAt: null, observedChangeRateHours: 72, lastWorkedAt: null, ...over });
const config = (...changes: [string, unknown][]) => changes.reduce((c, [key, after], i) =>
  withSetting(c, { id: `c${i}`, key, after: after as never, at: NOW, why: "" }), defaultAdminConfig(NOW));

test("a dead end waits its source's own pace, capped at the longest wait (5 days by default)", () => {
  assert.equal(absenceHold(obligation({ recordClass: "meetings" }), NOW, null).until, at(0.5), "a meeting source is checked twice a day (§4)");
  assert.equal(absenceHold(obligation(), NOW, null).until, at(3), "a source that changes every three days is rechecked in three");
  assert.equal(absenceHold(obligation({ observedChangeRateHours: 24 * 20 }), NOW, null).until, at(5), "never longer than five days");
  assert.equal(absenceHold(obligation({ observedChangeRateHours: null }), NOW, null).until, at(5), "no signal is not a pace: it waits the longest wait");
});

test("changing either setting changes the next absence's end with no deploy", () => {
  assert.equal(absenceHold(obligation(), NOW, config([ABSENCE_HOLD_BY_CLASS_SETTING, { officials: 1 }])).until, at(1));
  assert.equal(absenceHold(obligation({ observedChangeRateHours: 24 * 20 }), NOW, config([ABSENCE_MAX_HOLD_SETTING, 10])).until, at(10));
  assert.equal(absenceHold(obligation(), NOW, config([ABSENCE_MAX_HOLD_SETTING, 2])).until, at(2));
});

test("recording an argued absence uses the hold, keeps when it was argued, and dates its recheck trigger to match", async () => {
  const repos = createMemoryRepositories();
  await repos.obligations.put("o", { ...obligation({ observedChangeRateHours: 24 * 20 }), nextDueAt: null, occurrenceCount: 0, openOccurrenceId: null, updatedAt: NOW } as unknown as StandingObligation, NOW);
  await repos.adminConfig.put(ADMIN_CONFIG_ID, config([ABSENCE_MAX_HOLD_SETTING, 4]), NOW);
  const legacy = absenceExpiry(NOW);
  await recordArguedAbsence(repos, { obligationId: "o", absentUntil: legacy, now: NOW, unlockWhen: absenceUnlockFrom({ nextRungs: [], narrative: "None.", recordClass: "officials" }, legacy) });
  const row = (await repos.obligations.mustRead("o")).value;
  assert.equal(row.absentUntil, at(4));
  assert.equal(row.nextDueAt, at(4));
  assert.equal(row.absenceUnlock?.recordedAt, NOW);
  assert.deepEqual(row.absenceUnlock?.triggers.find((t) => t.kind === "DATE"), { kind: "DATE", at: at(4) });
});
