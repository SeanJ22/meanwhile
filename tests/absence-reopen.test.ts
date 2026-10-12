/** A new capability reopens the absences whose stored condition it matches, and only those. */
import assert from "node:assert/strict";
import test from "node:test";

import { newFieldManualEntry } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { absenceUnlockFrom } from "../lib/control-plane/scheduler/absence.ts";
import { capabilitiesFromEntries, reopenAbsencesFor, triggerMatches } from "../lib/control-plane/scheduler/absence-reopen.ts";
import { recordArguedAbsence, type StandingObligation } from "../lib/control-plane/scheduler/durable.ts";

const NOW = "2026-10-05T12:00:00.000Z";
const UNTIL = "2026-11-04T12:00:00.000Z";

function obligation(id: string, recordClass = "meetings"): StandingObligation {
  return { id, recordClass, subjectId: `subject-${id}`, routeId: "r", active: true, readerImpactAt: null, observedChangeRateHours: null,
    lastWorkedAt: null, nextDueAt: null, occurrenceCount: 0, openOccurrenceId: null, updatedAt: NOW } as unknown as StandingObligation;
}
const method = (platform: string, recordClass: string, outcome: "YIELDED" | "FAILED" = "YIELDED") =>
  newFieldManualEntry("test", `${platform}|${recordClass}`, { role: "SHARED", kind: "METHOD", title: `${platform} ${recordClass}`, summary: "s",
    outcome, platforms: [platform], recordClasses: [recordClass], observedAt: NOW, payload: {} });

async function absent(repos: ReturnType<typeof createMemoryRepositories>, id: string, platform: string | null, recordClass = "meetings") {
  await repos.obligations.put(id, obligation(id, recordClass), NOW);
  const unlock = absenceUnlockFrom({ nextRungs: ["a method for this vendor"], narrative: "Nothing.", recordClass, ...(platform ? { platform } : {}) }, UNTIL);
  await recordArguedAbsence(repos, { obligationId: id, absentUntil: UNTIL, now: NOW, unlockWhen: unlock });
}

test("writing a working method for a platform and record class reopens the absences on that platform, and no others", async () => {
  const repos = createMemoryRepositories();
  await absent(repos, "on-platform", "legistar");
  await absent(repos, "other-platform", "civicplus");
  await absent(repos, "other-class", "legistar", "officials");
  const caps = capabilitiesFromEntries([method("legistar", "meetings")]);
  const reopened = await reopenAbsencesFor(repos, caps, NOW);
  assert.deepEqual(reopened.map((r) => r.obligationId), ["on-platform"]);
  const row = (await repos.obligations.mustRead("on-platform")).value;
  assert.equal(row.absentUntil, null);
  assert.equal(row.absenceUnlock, null);
  assert.equal(row.nextDueAt, NOW, "owed in the next round");
  assert.match(row.absenceReopened?.because ?? "", /legistar meetings/);
  assert.ok((await repos.obligations.mustRead("other-platform")).value.absentUntil, "still absent");
  assert.ok((await repos.obligations.mustRead("other-class")).value.absentUntil, "still absent");
  assert.deepEqual(await reopenAbsencesFor(repos, caps, NOW), [], "idempotent");
});

test("a record-class-only absence reopens on a new route for that class; a failed entry reopens nothing", async () => {
  const repos = createMemoryRepositories();
  await absent(repos, "anywhere", null);
  assert.deepEqual(capabilitiesFromEntries([method("legistar", "meetings", "FAILED")]), []);
  assert.deepEqual(await reopenAbsencesFor(repos, [], NOW), []);
  const reopened = await reopenAbsencesFor(repos, capabilitiesFromEntries([method("granicus", "meetings")]), NOW);
  assert.deepEqual(reopened.map((r) => r.obligationId), ["anywhere"]);
});

test("adapter and tool triggers match by platform and tool; the date trigger never matches", () => {
  const cap = { platforms: ["legistar"], recordClasses: [], tools: ["pdf_text"], because: "x" };
  assert.equal(triggerMatches({ kind: "ADAPTER", platform: "Legistar" }, cap), true);
  assert.equal(triggerMatches({ kind: "ADAPTER", platform: "civicplus" }, cap), false);
  assert.equal(triggerMatches({ kind: "TOOL", tool: "pdf_text" }, cap), true);
  assert.equal(triggerMatches({ kind: "DATE", at: UNTIL }, cap), false);
});

test("an absence that has already expired is left to its own clock", async () => {
  const repos = createMemoryRepositories();
  await repos.obligations.put("old", obligation("old"), NOW);
  await recordArguedAbsence(repos, { obligationId: "old", absentUntil: "2026-10-01T00:00:00.000Z", now: NOW,
    unlockWhen: absenceUnlockFrom({ nextRungs: [], narrative: "n", recordClass: "meetings" }, "2026-10-01T00:00:00.000Z") });
  assert.deepEqual(await reopenAbsencesFor(repos, capabilitiesFromEntries([method("legistar", "meetings")]), NOW), []);
});

test("each round, a capability the bank gained after an absence was argued reopens it; one it already had does not", async () => {
  const { reopenAbsencesForRecentCapabilities } = await import("../lib/control-plane/scheduler/absence-reopen.ts");
  const repos = createMemoryRepositories();
  await absent(repos, "on-platform", "legistar");
  const later = new Date(Date.parse(NOW) + 3_600_000).toISOString();
  const before = { ...method("legistar", "meetings"), observedAt: "2026-10-04T12:00:00.000Z" };
  assert.deepEqual(await reopenAbsencesForRecentCapabilities(repos, [before], later), [], "a method the walk already had cannot reopen its own dead end");
  const sameDay = { ...method("legistar", "meetings"), observedAt: "2026-10-05" };
  assert.deepEqual(await reopenAbsencesForRecentCapabilities(repos, [sameDay], later), [], "a bare day counts only from the next day");
  const after = { ...method("legistar", "meetings"), observedAt: later };
  const reopened = await reopenAbsencesForRecentCapabilities(repos, [after], later);
  assert.deepEqual(reopened.map((r) => r.obligationId), ["on-platform"]);
});
