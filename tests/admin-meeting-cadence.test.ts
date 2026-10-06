/**
 * **ADMIN STATES THE MEETING CADENCE THE RUNNER KEEPS** (2026-09-25).
 *
 * Production, signed in, 1:40 PM MST: Pima County's Board of Supervisors card
 * said "How often: Daily through the 2026 general election, then weekly" and
 * "Next look: Due Sep 26, 4:30 PM ET" beside "62 of 62 reads got in in the
 * last 24 hours". Both came from the contract's `cadence`, which is how old a
 * Reader may see a record, not when the runner reads. The runner reads every
 * meeting source on its sitting-window `schedule` (C6): twice a day, and within
 * the hour while a sitting is within seven days ahead or behind.
 *
 * These pin the card to the runner: each instant is checked against the
 * runner's own `routineTaskDeadlineMs` / `routineTaskDue` for the same facts,
 * and a body without a sitting window keeps its cadence words unchanged.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MEETING_PARTITION_POLICY, MEETING_SITTING_WINDOW } from "../lib/civic-data/contracts.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDeadlineMs, routineTaskDue, sittingWindowSignals, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { statedSittingEndsByScope } from "../lib/civic-data/sitting-window-admission.ts";
import { trustedLkgImportClock } from "../lib/civic-data/store.ts";
import {
  buildBodyViews,
  sittingClockOf,
  sittingWindowRuleWords,
  type AttemptFacts,
  type BodyStoreFacts,
  type BodyView,
  type SittingFacts,
  type VersionFacts,
  type WatchedContract,
} from "../lib/control-plane/admin-view/bodies.ts";

const NOW = "2026-09-25T20:40:00.000Z"; // 1:40 PM MST, when the defect was seen
const NOW_MS = Date.parse(NOW);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number) => new Date(ms).toISOString();

/* A real registered meeting partition: the runner's task for it is the one the cross-checks ask. */
const PARTITION = MEETING_PARTITION_CONTRACTS.find((c) => c.meetingSource === "legistar" && c.bodyId.includes("county:pima#governing"))!;
const TASK = ROUTINE_SOURCE_TASKS.find((t) => t.id === PARTITION.id)!;

function watched(c: typeof PARTITION): WatchedContract & { readonly schedule: typeof MEETING_SITTING_WINDOW } {
  return {
    id: c.id, scope: c.scope, bodyId: c.bodyId, ocdId: c.ocdId, meetingSource: String(c.meetingSource),
    jurisdiction: "Pima County, AZ", publishingOrg: null, sourceUrl: "https://pima.legistar.com/Calendar.aspx", verifiedAt: null,
    cadence: c.cadence, retry: c.retry, schedule: MEETING_SITTING_WINDOW,
  };
}
const CONTRACT = watched(PARTITION);

const version = (over: Partial<VersionFacts> & { clock?: VersionFacts["clock"] }): VersionFacts => ({
  scope: CONTRACT.scope, versionId: "cv-now", promotedAt: "2026-09-25T20:30:06.939Z", meetings: 15, fresh: 15, carried: 0, docs: 0,
  noAgendaLink: 0, noAgendaAhead: 0, upcoming: 0, furthestAhead: "2026-09-23T00:00:00.000Z", bodyName: "Board of Supervisors",
  jurisdiction: "Pima County, AZ", outcome: "UNCHANGED", added: 0, changed: 0, removed: 0, held: 0, horizon: null, ...over,
});
const attempt = (at: string, state = "PROMOTED", acquisitionSucceeded = true): AttemptFacts => ({
  scope: CONTRACT.scope, candidateId: `cv-${at}`, state, failureCode: state === "SOURCE_BLOCKED" ? "SOURCE_RETRIEVAL_FAILED" : null,
  failureDetail: state === "SOURCE_BLOCKED" ? "HTTP 403" : null, acquisitionSucceeded, attemptedAt: at,
});
const store = (v: VersionFacts | null, attempts: AttemptFacts[]): BodyStoreFacts => ({
  asOf: NOW, versions: v ? [v] : [], attempts, readbacks: v ? [{ candidateId: v.versionId, at: NOW, passed: true }] : [], changes: [],
  day: [{ scope: CONTRACT.scope, reads: 62, gotIn: 62, versions: 62, changedVersions: 0, added: 0, changed: 0, removed: 0 }],
});
const card = (s: BodyStoreFacts, contracts: readonly WatchedContract[] = [CONTRACT]): BodyView => buildBodyViews({ contracts, store: s, nowIso: NOW })[0];
const row = (v: BodyView, key: string) => v.schedule.find(([k]) => k === key)![1];

const LAST_GOOD = "2026-09-25T20:30:06.939Z";
const PIMA_SITTINGS: SittingFacts[] = [
  { startsAt: "2026-09-22T15:00:00-07:00", endsAt: null },
  { startsAt: "2026-09-22T17:00:00-07:00", endsAt: null },
  { startsAt: "2026-10-13T13:00:00-07:00", endsAt: null },
];
const clockFacts = (sittings: SittingFacts[], observedAt: string | null = LAST_GOOD) => ({ observedAt, confirmedAt: null, imported: false, sittings });

/** The runner's own deadline and due test for the same facts. */
function runnerSays(clock: RoutineTaskClock, sittings: readonly SittingFacts[] | undefined) {
  const ends = statedSittingEndsByScope(sittings ? [{ scope: TASK.id, pairs: sittings.map((s) => [s.startsAt, s.endsAt]) }] : []);
  const hot = sittingWindowSignals([{ task: TASK, ok: true, clock }], NOW_MS, ends).get(TASK.id);
  return {
    deadlineMs: routineTaskDeadlineMs(TASK, clock, hot),
    dueAt: (ms: number) => routineTaskDue(TASK, clock, ms, hot),
  };
}

test("the watched meeting partitions all carry the runner's sitting-window schedule, and the loader passes it on", () => {
  assert.ok(MEETING_PARTITION_CONTRACTS.length > 50);
  for (const c of MEETING_PARTITION_CONTRACTS) assert.equal(c.schedule, MEETING_SITTING_WINDOW, c.id);
  assert.ok(PARTITION && TASK, "the Pima Legistar partition and its runner task exist");
  const loader = readFileSync("app/(admin)/_mw/data/load-bodies.ts", "utf8");
  assert.match(loader, /\.\.\.\(c\.schedule \? \{ schedule: c\.schedule \} : \{\}\)/);
  const bodyStore = readFileSync("app/(admin)/_mw/data/body-store.ts", "utf8");
  const versions = bodyStore.slice(bodyStore.indexOf("const VERSIONS"), bodyStore.indexOf("const ATTEMPTS"));
  for (const col of ["observed_at", "confirmed_at", "sittings", "import_kind"]) assert.match(versions, new RegExp(`\\b${col}\\b`), col);
  assert.match(versions, /e\.candidate_id = p\.current_version_id AND e\.sequence = 1\) AS observed_at/, "the success instant is the version's first event, as the runner reads it");
  const full = bodyStore.slice(bodyStore.indexOf("export async function readBodyStore("), bodyStore.indexOf("export async function readBodyStanding("));
  const standing = bodyStore.slice(bodyStore.indexOf("export async function readBodyStanding("));
  // Through the scope-narrowing helper when an opened read asks for one body (claude/ac-admin-first-open).
  assert.match(full, /(?:sql\.query|statement)\(VERSIONS_WITH_CLOCK, \[nowIso, CONFIRMATION_LIKE\]\)/, "the full read carries the clock");
  assert.doesNotMatch(standing, /VERSIONS_WITH_CLOCK|CONFIRMATION_LIKE/, "the preview's standing read never pays for a schedule it does not show");
});

test("the rule is worded from the schedule's own numbers", () => {
  assert.equal(sittingWindowRuleWords(MEETING_SITTING_WINDOW), "twice a day, and within the hour while a sitting is within seven days ahead or behind");
  assert.equal(
    sittingWindowRuleWords({ kind: "SITTING_WINDOW", windowMs: 3 * DAY, hotEveryMs: 2 * HOUR, baseEveryMs: 8 * HOUR }),
    "three times a day, and within two hours while a sitting is within three days ahead or behind",
  );
});

test("Pima's card: hourly while its Sep 22 sitting is within seven days behind, owed within the hour — not daily, not tomorrow", () => {
  const v = card(store(version({ clock: clockFacts(PIMA_SITTINGS) }), [attempt(LAST_GOOD)]));
  const howOften = row(v, "How often");
  const nextLook = row(v, "Next look");
  assert.equal(
    howOften,
    "Hourly now — the Sep 22, 2026 sitting is within seven days behind; the next one listed is Oct 13, 2026. The rule: twice a day, and within the hour while a sitting is within seven days ahead or behind.",
  );
  assert.equal(nextLook, "Owed by Sep 25, 5:30 PM EDT, an hour after the last good read; the runner may read it from Sep 25, 5:05 PM EDT");
  assert.doesNotMatch(`${howOften} ${nextLook}`, /general election|weekly|Due Sep 26/, "the contract's Reader-freshness cadence is not the runner's clock");
  assert.equal(
    v.lanes.find((l) => l.name === "Acquisition")!.note,
    "Runs on the standing runner's clock: twice a day, and within the hour while a sitting is within seven days ahead or behind; a failed read is retried one hour after a failed source/body attempt.",
  );

  const runner = runnerSays({ lastAttemptedAt: LAST_GOOD, lastSucceededObservedAt: LAST_GOOD, sittingStarts: PIMA_SITTINGS.map((s) => s.startsAt) }, PIMA_SITTINGS);
  const clock = sittingClockOf(CONTRACT, version({ clock: clockFacts(PIMA_SITTINGS) }), [attempt(LAST_GOOD)], NOW_MS);
  assert.equal(clock.owed!.deadlineMs, runner.deadlineMs, "the card's deadline is the runner's");
  assert.equal(runner.dueAt(clock.owed!.eligibleAtMs - 1), false);
  assert.equal(runner.dueAt(clock.owed!.eligibleAtMs), true, "the card's 'may read it from' is the instant the runner admits it");
});

test("a sitting ahead within seven days holds it hourly; none within seven days makes it twice a day, owed twelve hours after the last good read", () => {
  const ahead: SittingFacts[] = [{ startsAt: "2026-09-30T17:00:00-07:00", endsAt: null }];
  assert.match(row(card(store(version({ clock: clockFacts(ahead) }), [attempt(LAST_GOOD)])), "How often"), /^Hourly now — the next sitting, Sep 30, 2026, is within seven days\. The rule: /);

  const cold: SittingFacts[] = [{ startsAt: "2026-09-01T17:00:00-07:00", endsAt: null }, { startsAt: "2026-10-13T13:00:00-07:00", endsAt: null }];
  const v = card(store(version({ clock: clockFacts(cold) }), [attempt(LAST_GOOD)]));
  assert.match(row(v, "How often"), /^Twice a day now — no sitting is within seven days ahead or behind; the next one listed is Oct 13, 2026\. The rule: /);
  assert.equal(row(v, "Next look"), "Owed by Sep 26, 4:30 AM EDT, twelve hours after the last good read; the runner may read it from Sep 26, 2:30 AM EDT");
  const runner = runnerSays({ lastAttemptedAt: LAST_GOOD, lastSucceededObservedAt: LAST_GOOD, sittingStarts: cold.map((s) => s.startsAt) }, cold);
  assert.equal(sittingClockOf(CONTRACT, version({ clock: clockFacts(cold) }), [attempt(LAST_GOOD)], NOW_MS).owed!.deadlineMs, runner.deadlineMs);
});

test("a sitting counts as concluded at its stated end, else a day after it starts — the runner's reading, not a second copy", () => {
  const start = iso(NOW_MS - 7.5 * DAY);
  const bound: SittingFacts[] = [{ startsAt: start, endsAt: null }];
  const stated: SittingFacts[] = [{ startsAt: start, endsAt: iso(Date.parse(start) + 2 * HOUR) }];
  assert.match(row(card(store(version({ clock: clockFacts(bound) }), [attempt(LAST_GOOD)])), "How often"), /^Hourly now — /, "without an end, the day bound keeps it within seven days behind");
  assert.match(row(card(store(version({ clock: clockFacts(stated) }), [attempt(LAST_GOOD)])), "How often"), /^Twice a day now — /, "a stated end two hours in ended it 7.4 days ago");
  for (const sittings of [bound, stated]) {
    const runner = runnerSays({ lastAttemptedAt: LAST_GOOD, lastSucceededObservedAt: LAST_GOOD, sittingStarts: sittings.map((s) => s.startsAt) }, sittings);
    assert.equal(sittingClockOf(CONTRACT, version({ clock: clockFacts(sittings) }), [attempt(LAST_GOOD)], NOW_MS).owed!.deadlineMs, runner.deadlineMs);
  }
});

test("a read that published nothing after the last good one is retried an hour after that read", () => {
  const failedAt = "2026-09-25T20:20:00.000Z";
  const good = "2026-09-25T19:30:00.000Z";
  const v = card(store(version({ clock: clockFacts(PIMA_SITTINGS, good) }), [attempt(failedAt, "SOURCE_BLOCKED", false), attempt(good)]));
  assert.equal(row(v, "Next look"), "Owed by Sep 25, 5:20 PM EDT, the retry an hour after a read that published nothing; the runner may read it from Sep 25, 4:55 PM EDT");
  const runner = runnerSays({ lastAttemptedAt: failedAt, lastSucceededObservedAt: good, sittingStarts: PIMA_SITTINGS.map((s) => s.startsAt) }, PIMA_SITTINGS);
  assert.equal(Date.parse("2026-09-25T21:20:00.000Z"), runner.deadlineMs);
});

test("a source with nothing published waits twelve hours between attempts, and every sentence on the card says so (R20)", () => {
  const tried = "2026-09-25T17:19:04.224Z";
  const v = card(store(null, [attempt(tried, "CANNOT_TELL", true)]));
  assert.equal(row(v, "How often"), "Twice a day until something from it is published: with no meeting on record, the runner waits twelve hours after each attempt. The rule: twice a day, and within the hour while a sitting is within seven days ahead or behind.");
  assert.equal(row(v, "Next look"), "Owed by Sep 26, 1:19 AM EDT, twelve hours after the last attempt, since nothing from it is published yet; the runner may read it from Sep 25, 11:19 PM EDT");
  assert.match(v.lanes.find((l) => l.name === "Acquisition")!.note, /a failed read is retried twelve hours after each attempt while nothing from it is published\.$/);
  assert.equal(v.deadEnd!.whoMoves, "The runner reads it again on its clock (twelve hours after each attempt while nothing from it is published). Nothing else is scheduled to change it.");
  const runner = runnerSays({ lastAttemptedAt: tried }, undefined);
  assert.equal(Date.parse("2026-09-26T05:19:04.224Z"), runner.deadlineMs);
});

test("a trusted-LKG import is never a success: only a live read after it counts, and with none the runner owes one at once", () => {
  const imported = "2026-09-14T04:24:35.148Z";
  const importClock = (sittings: SittingFacts[]) => ({ observedAt: imported, confirmedAt: null, imported: true, sittings });
  const importVersion = version({ promotedAt: imported, clock: importClock(PIMA_SITTINGS) });
  assert.match(row(card(store(importVersion, [])), "Next look"), /^Owed now — no read in the last seven days is on record to count from/);

  const live = "2026-09-25T20:10:00.000Z";
  const v = card(store(importVersion, [attempt(live, "SOURCE_BLOCKED", false)]));
  assert.match(row(v, "Next look"), /^Owed by Sep 25, 5:10 PM EDT, the retry an hour after a read that published nothing/);
  const runnerClock: RoutineTaskClock = { ...trustedLkgImportClock(live, imported), sittingStarts: PIMA_SITTINGS.map((s) => s.startsAt) };
  assert.equal(sittingClockOf(CONTRACT, importVersion, [attempt(live, "SOURCE_BLOCKED", false)], NOW_MS).owed!.deadlineMs, runnerSays(runnerClock, PIMA_SITTINGS).deadlineMs);
});

test("an overdue read says overdue, and a reading without the clock facts says so rather than guessing", () => {
  const stale = "2026-09-25T18:00:00.000Z";
  assert.equal(row(card(store(version({ clock: clockFacts(PIMA_SITTINGS, stale) }), [attempt(stale)])), "Next look"), "Overdue — owed by Sep 25, 3:00 PM EDT, an hour after the last good read");
  const unread = card(store(version({}), [attempt(LAST_GOOD)]));
  assert.equal(row(unread, "Next look"), "Not worked out — this reading did not include the runner's clock facts");
  assert.match(row(unread, "How often"), /^Whether it is read hourly now was not read this time\. The rule: twice a day, and within the hour/);
});

test("a body read through two sources names each source's clock when they differ", () => {
  const insite = MEETING_PARTITION_CONTRACTS.find((c) => c.meetingSource === "legistar-insite" && c.bodyId === PARTITION.bodyId)!;
  const second = watched(insite);
  const insiteRead = "2026-09-25T20:45:16.209Z";
  const s: BodyStoreFacts = {
    ...store(version({ clock: clockFacts(PIMA_SITTINGS.slice(0, 2)) }), [attempt(LAST_GOOD)]),
    versions: [
      version({ clock: clockFacts(PIMA_SITTINGS.slice(0, 2)) }),
      version({ scope: second.scope, versionId: "cv-insite", promotedAt: insiteRead, clock: clockFacts(PIMA_SITTINGS, insiteRead) }),
    ],
    attempts: [attempt(LAST_GOOD), { ...attempt(insiteRead), scope: second.scope }],
  };
  const v = card(s, [CONTRACT, second]);
  assert.equal(
    row(v, "How often"),
    "Legistar meeting portal: Hourly now — the Sep 22, 2026 sitting is within seven days behind; no sitting ahead is listed. Legistar InSite portal: Hourly now — the Sep 22, 2026 sitting is within seven days behind; the next one listed is Oct 13, 2026. The rule: twice a day, and within the hour while a sitting is within seven days ahead or behind.",
  );
  assert.equal(
    row(v, "Next look"),
    "Legistar meeting portal: Owed by Sep 25, 5:30 PM EDT, an hour after the last good read; the runner may read it from Sep 25, 5:05 PM EDT; Legistar InSite portal: Owed by Sep 25, 5:45 PM EDT, an hour after the last good read; the runner may read it from Sep 25, 5:20 PM EDT",
  );
});

test("a contract without a sitting window keeps its cadence words, unchanged", () => {
  const plain: WatchedContract = { ...CONTRACT, cadence: MEETING_PARTITION_POLICY.cadence };
  delete (plain as { schedule?: unknown }).schedule;
  const v = card(store(version({ clock: clockFacts(PIMA_SITTINGS) }), [attempt(LAST_GOOD)]), [plain]);
  assert.equal(row(v, "How often"), "Daily through the 2026 general election, then weekly");
  assert.equal(row(v, "Next look"), "Due Sep 26, 4:30 PM EDT");
  assert.equal(v.lanes.find((l) => l.name === "Acquisition")!.note, "Runs on the standing runner's clock (daily through the 2026 general election, then weekly); a failed read is retried one hour after a failed source/body attempt.");
});
