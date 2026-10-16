import test from "node:test";
import assert from "node:assert/strict";
import { applyRoutineClockSettings, readHeldFinanceCalendars } from "../lib/civic-data/clock-settings.ts";
import { defaultAdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { registerSetting, withSetting } from "../lib/control-plane/settings.ts";
import { routineAdmissionClock, routineCalendarDueAtMs, routineTaskDeadlineMs, routineTaskDueAtMs, type RoutineSourceTask } from "../lib/civic-data/runner.ts";
import { MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { IndependentRuntimeLaneScheduler } from "../lib/ops/independent-runtime-pass.ts";
import { routineScopeState } from "../lib/civic-data/state-scope.ts";
import { doorScopeState } from "../lib/doors/registry.ts";
const now = "2026-10-15T12:00:00.000Z", at = Date.parse(now), day = 86400000;
const task = (recordClass: RoutineSourceTask["recordClass"]): RoutineSourceTask => ({ id: "test", sourceId: "test", recordClass,
  scope: "US-AZ", requestedUrl: "https://example.gov", authorityMode: "SINGLE_ROUTE", acquisitionFailureDomain: "test",
  parserVersion: "test/1", command: [], cadenceMs: 7 * day, retryMs: 3600000,
  contract: { cadence: { defaultEveryMs: 7 * day, description: "weekly" }, readerProjection: null } });

test("encoded meeting bodies, feed scopes and route hints use their own state worker", () => {
  assert.equal(routineScopeState("source:ical:body:ocd-division%2Fcountry%3Aus%2Fstate%3Atx%2Fplace%3Aa%23council"), "US-TX");
  assert.equal(routineScopeState("US:meeting-doors"), "US");
  assert.equal(routineScopeState("US:registry-runtime", ["--state=TX"]), "US-TX");
  assert.equal(routineScopeState("US-AZ+US-NH+US-NJ:2026-general:supported-jurisdictions"), "US");
  assert.equal(routineScopeState("US-AZ%2BUS-NH%2BUS-NJ:2026-general", ["--state=NJ"]), "US");
  assert.equal(doorScopeState({ ocdId: null, bodyIds: [], config: { scope: "US-AZ:members" } }), "US-AZ");
  assert.equal(doorScopeState({ ocdId: null, bodyIds: [], config: { jurisdictionId: "nh:city:town-of-newbury" } }), "US-NH");
});

test("source clocks default members and unknown session/election calendars to daily", () => {
  for (const kind of ["STATE_LEGISLATOR", "STATE_BILL", "BALLOT_FILING"] as const) {
    assert.equal(applyRoutineClockSettings(task(kind), null, at).cadenceMs, day);
  }
  assert.equal(applyRoutineClockSettings(task("FEC_FUNDING"), null, at).cadenceMs, 7 * day);
});

test("filing deadline interrupts the weekly clock and a session returns to weekly outside its dates", () => {
  const config = withSetting(defaultAdminConfig(now), { id: "dates", key: "sources.calendars", at: now, why: "",
    after: [{ scope: "US-AZ", kind: "filing", startsAt: now, endsAt: "2026-10-16T11:59:59.999Z" },
      { scope: "US-AZ", kind: "session", startsAt: "2026-01-01T00:00:00Z", endsAt: "2026-06-01T00:00:00Z" }] });
  const money = applyRoutineClockSettings(task("FEC_FUNDING"), config, at);
  assert.equal(money.cadenceMs, day);
  assert.equal(routineTaskDueAtMs(money, { lastAttemptedAt: "2026-10-15T06:00:00Z", lastSucceededObservedAt: "2026-10-15T06:00:00Z" }, at), at);
  assert.equal(applyRoutineClockSettings(task("STATE_BILL"), config, at).cadenceMs, 7 * day);
  assert.equal(applyRoutineClockSettings(task("FEC_FUNDING"), config, at + 2 * day).cadenceMs, 7 * day);
});

test("Admin meeting clocks override the source contract while preserving following bodies", () => {
  const config = withSetting(defaultAdminConfig(now), { id: "faster", key: "meetings.hotEveryMinutes", after: 15, at: now, why: "" });
  const meeting = { ...task("MEETING"), contract: { ...task("MEETING").contract,
    schedule: { ...MEETING_SITTING_WINDOW, follows: [{ meetingSource: "legistar", bodyId: "one" }] } } };
  const scheduled = applyRoutineClockSettings(meeting, config, at);
  assert.equal(scheduled.contract.schedule.hotEveryMs, 15 * 60000);
  assert.deepEqual(scheduled.contract.schedule.follows, meeting.contract.schedule.follows);
});

test("independent lanes wake at the earliest source due time and never overlap", async () => {
  let due = 1250, runs = 0;
  const scheduler = new IndependentRuntimeLaneScheduler([{ id: "sources", everyMs: 300000, nextDueAt: () => due,
    run: async () => { runs += 1; due = 2250; } }, { id: "other", everyMs: 10000, run: async () => undefined }]);
  assert.deepEqual(scheduler.tick(1000), ["other"]);
  await scheduler.waitForIdle();
  assert.equal(scheduler.nextDueAt(1000), 1250);
  assert.deepEqual(scheduler.tick(1249), []);
  assert.deepEqual(scheduler.tick(1250), ["sources"]);
  assert.deepEqual(scheduler.tick(1250), []);
  await scheduler.waitForIdle();
  assert.equal(runs, 1);
  assert.equal(scheduler.nextDueAt(1250), 2250);
});

test("document retries wake a body without advancing or failing its verified calendar clock", () => {
  const meeting = { ...task("MEETING"), contract: { ...task("MEETING").contract, schedule: MEETING_SITTING_WINDOW } };
  const clock = { lastAttemptedAt: "2026-10-15T11:50:00Z", lastSucceededAt: "2026-10-15T11:50:00Z",
    lastSucceededObservedAt: "2026-10-15T11:50:00Z", sittingStarts: [now],
    lastDocumentAttemptedAt: "2026-10-15T12:00:00Z", nextDocumentDueAt: "2026-10-15T12:05:00Z", pendingDocumentCount: 2 };
  const admitted = routineAdmissionClock(clock, "2026-10-15T11:59:59Z", at);
  assert.deepEqual(admitted, clock);
  assert.equal(routineTaskDueAtMs(meeting, admitted, at, true), Date.parse(clock.nextDocumentDueAt));
  assert.equal(routineTaskDeadlineMs(meeting, admitted, true, at), Date.parse(clock.nextDocumentDueAt));
  assert.equal(routineCalendarDueAtMs(meeting, admitted, at, true), Date.parse("2026-10-15T12:25:00Z"));
  const laterDocument = { ...clock, nextDocumentDueAt: "2026-10-15T13:00:00Z", pendingDocumentCount: 0 };
  assert.equal(routineTaskDueAtMs(meeting, laterDocument, at, true), routineCalendarDueAtMs(meeting, clock, at, true));
});

test("a calendar publisher's precise retry time survives ordinary failure and changed-source admission", () => {
  const meeting = { ...task("MEETING"), sourceChangedAt: "2026-10-15T11:59:00Z",
    contract: { ...task("MEETING").contract, schedule: MEETING_SITTING_WINDOW } };
  const clock = { lastAttemptedAt: now, calendarRetryAt: "2026-10-15T12:07:13Z", nextDocumentDueAt: "2026-10-15T12:03:00Z" };
  assert.equal(routineCalendarDueAtMs(meeting, clock, at, true), Date.parse(clock.calendarRetryAt));
  assert.equal(routineTaskDueAtMs(meeting, clock, at, true), Date.parse(clock.nextDocumentDueAt));
  assert.equal(routineTaskDueAtMs(meeting, { ...clock, nextDocumentDueAt: undefined }, at, true), Date.parse(clock.calendarRetryAt));
});


test("held finance deadlines are selected from exact state pointers without returning finance records", async () => {
  const calls: { text: string; params: readonly unknown[] }[] = [];
  const calendars = await readHeldFinanceCalendars(async (text, params) => {
    calls.push({ text, params });
    return [{ deadline: "2026-10-16" }, { deadline: "not a date" }];
  }, [{ recordClass: "STATE_CAMPAIGN_FINANCE", scope: "US-AZ:campaign-finance:2026" }], now);
  assert.equal(calendars.length, 1);
  assert.equal(calendars[0]!.scope, "US-AZ");
  assert.match(calls[0]!.text, /p.record_class = \$1 AND p.scope = \$2/);
  assert.match(calls[0]!.text, /ORDER BY deadline LIMIT 32/);
  assert.doesNotMatch(calls[0]!.text, /SELECT p.payload(?:,|\sFROM)/);
  const scheduled = applyRoutineClockSettings(task("STATE_CAMPAIGN_FINANCE"), null, at, calendars);
  assert.equal(scheduled.clockBoundaryAt, "2026-10-16T00:00:00.000Z");
});


test("re-evaluating an unchanged setting after a development reload keeps its definition", () => {
  const definition = { key: "test.hotReloadClock", label: "Reload clock", defaultValue: 5, readerFacing: false,
    validate: (value: unknown): value is number => typeof value === "number" && value > 0 };
  registerSetting(definition);
  assert.doesNotThrow(() => registerSetting({ ...definition, validate: (value: unknown): value is number => typeof value === "number" && value > 0 }));
  assert.throws(() => registerSetting({ ...definition, defaultValue: 6 }), /already registered/);
});
