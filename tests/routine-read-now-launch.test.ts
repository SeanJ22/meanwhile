import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { electionLaunchOrder } from "../lib/civic-data/ballot-publication.ts";
import { dueRequestsFirstInClass, routineDueRequestDeadlineMs, routineDueRequestFor, type RoutineDueRequest } from "../lib/civic-data/routine-due-request.ts";
import { ROUTINE_SOURCE_TASKS, routineFailureDomainFrontier, routinePassLaunchOrder, routineTaskDeadlineMs, type RoutineSourceTask, type RoutineTaskAdmissionCandidate,
  type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { readNowDueRequests, shutFeedsLast } from "../lib/doors/mission-refresh.ts";
import { readRunnerDoors } from "../lib/doors/runner-reads.ts";
import { seedFeedDoors } from "../lib/doors/seed-feeds.ts";

const HOUR = 3_600_000;
const NOW_MS = Date.parse("2026-10-30T05:28:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const VOTING = AUTOMATIC_REFRESH_TASKS.filter(task => /^voting-sites:(?:AK|AL|AZ|CA|CO)$/.test(task.id));
/** Hours since each state's twice-daily read came due: Alaska has waited longest. */
const OWED_HOURS: Record<string, number> = { "voting-sites:AK": 9, "voting-sites:AL": 6, "voting-sites:AZ": 5, "voting-sites:CA": 4, "voting-sites:CO": 3 };

/** One ordinary pass, built the way the runner builds it: due request, frontier, launch order, requests in class, shut feeds last. */
async function pass(repo: ReturnType<typeof createMemoryRepositories>["doors"], nowMs: number, clocks: ReadonlyMap<string, RoutineTaskClock>, due: readonly string[]) {
  const requests: RoutineDueRequest[] = readNowDueRequests(await readRunnerDoors(repo, ["readNow"], "true", "requests"), new Set(VOTING.map(({ id }) => id)), iso(nowMs));
  const asked = new Set<string>();
  const candidates = VOTING.flatMap(task => {
    const clock = clocks.get(task.id), request = routineDueRequestFor(task, clock, nowMs, requests);
    if (!due.includes(task.id) && request === null) return [];
    if (request !== null) asked.add(task.id);
    return [{ task, lastConsideredAt: clock?.lastAttemptedAt ?? null, owedAtMs: nowMs - OWED_HOURS[task.id]! * HOUR,
      deadlineMs: routineDueRequestDeadlineMs(routineTaskDeadlineMs(task, clock), request) }];
  });
  const ordered = dueRequestsFirstInClass(electionLaunchOrder(routinePassLaunchOrder(routineFailureDomainFrontier(candidates), nowMs)), asked);
  return shutFeedsLast(ordered, await readRunnerDoors(repo, ["status"], "SHUT", "requests")).map(({ task }) => task.id.slice(-2));
}

async function setDoor(repo: ReturnType<typeof createMemoryRepositories>["doors"], state: string, change: Record<string, unknown>) {
  const row = await repo.mustRead(`feed:voting-sites:${state}`);
  await repo.compareAndSet(row.id, row.revision, { ...row.value, ...change }, iso(NOW_MS));
}

test("a door marked read now launches ahead of due work, a shut feed waits behind open work, and the next pass keeps both rules", async () => {
  assert.equal(VOTING.length, 5);
  const { doors: repo } = createMemoryRepositories();
  await seedFeedDoors({ repo, deriveInputAt: iso(NOW_MS - 24 * HOUR), at: iso(NOW_MS - 24 * HOUR) });
  const read = (ms: number): RoutineTaskClock => ({ lastAttemptedAt: iso(ms), lastSucceededAt: iso(ms), lastSucceededObservedAt: iso(ms) });
  const clocks = new Map(VOTING.map(task => [task.id, read(NOW_MS - 16 * HOUR)]));
  const allDue = VOTING.map(({ id }) => id);

  // Unmarked and all open: longest owed first.
  assert.deepEqual(await pass(repo, NOW_MS, clocks, allDue), ["AK", "AL", "AZ", "CA", "CO"]);

  // (a, b) Colorado is marked read now an hour ago, after the others came due: it goes first, never behind its old place.
  await setDoor(repo, "CO", { readNow: true, updatedAt: iso(NOW_MS - HOUR) });
  assert.deepEqual(await pass(repo, NOW_MS, clocks, allDue), ["CO", "AK", "AL", "AZ", "CA"]);
  for (const state of ["AL", "AZ", "CA"]) {
    await setDoor(repo, state, { readNow: true, updatedAt: iso(NOW_MS - 90 * 60_000) });
    const order = await pass(repo, NOW_MS, clocks, allDue);
    assert.deepEqual(order.slice(0, 2).sort(), [state, "CO"].sort(), `${state}'s mark moves it ahead of every unmarked due read`);
    await setDoor(repo, state, { readNow: false });
  }

  // (c) Alaska's feed door is shut: every open state launches before it, and it is still offered so a good read can reopen it.
  await setDoor(repo, "AK", { status: "SHUT", shutSince: iso(NOW_MS - 3 * HOUR), shutReason: "the address answers 404" });
  assert.deepEqual(await pass(repo, NOW_MS, clocks, allDue), ["CO", "AL", "AZ", "CA", "AK"]);

  // (d) The next pass: Colorado's read spent its mark, so it keeps its ordinary place; Alaska is still shut and still last.
  const next = NOW_MS + HOUR;
  clocks.set("voting-sites:CO", read(NOW_MS + 5 * 60_000));
  assert.deepEqual(await pass(repo, next, clocks, ["voting-sites:AK", "voting-sites:AL", "voting-sites:AZ", "voting-sites:CA"]), ["AL", "AZ", "CA", "AK"]);
  // Once its door reopens, Alaska takes back its longest-owed place.
  await setDoor(repo, "AK", { status: "OPEN", shutSince: null, shutReason: null, reopenedAt: iso(next) });
  assert.deepEqual(await pass(repo, next, clocks, ["voting-sites:AK", "voting-sites:AL", "voting-sites:AZ", "voting-sites:CA"]), ["AK", "AL", "AZ", "CA"]);
});

test("a request goes first only in its own class: clock work (§4) stays ahead of a requested task of any other kind", () => {
  const find = (id: string) => [...AUTOMATIC_REFRESH_TASKS, ...ROUTINE_SOURCE_TASKS].find(task => task.id === id)!;
  const meeting = ROUTINE_SOURCE_TASKS.find(task => task.contract.schedule?.kind === "SITTING_WINDOW")!;
  const tasks = ["prl", "member-offices", "voting-sites:AL", "voting-sites:AZ", "congress-rollcalls", "voting-sites:CO"].map(find);
  const asked = new Set(["congress-rollcalls", "voting-sites:CO"]);
  const order = (requested: ReadonlySet<string>) => dueRequestsFirstInClass(electionLaunchOrder(routinePassLaunchOrder([meeting, ...tasks].map((task, at) => ({
    task, lastConsideredAt: iso(NOW_MS - 20 * HOUR), owedAtMs: NOW_MS - (9 - at) * HOUR,
    deadlineMs: routineDueRequestDeadlineMs(routineTaskDeadlineMs(task, { lastAttemptedAt: iso(NOW_MS - 20 * HOUR) }),
      requested.has(task.id) ? { dueAt: iso(NOW_MS - HOUR) } as RoutineDueRequest : null),
  })), NOW_MS)), requested).map(({ task }) => task.id);
  const plain = order(new Set()), marked = order(asked);
  const clockWork = [meeting.id, "voting-sites:AL", "voting-sites:AZ", "voting-sites:CO"];
  assert.ok(plain.indexOf("voting-sites:CO") > plain.indexOf("voting-sites:AL"), "unmarked, Colorado waits behind longer-owed clock work");
  assert.equal(marked.filter(id => clockWork.includes(id))[0], "voting-sites:CO", "marked, Colorado goes ahead of the other overdue clock work");
  for (const clock of clockWork) assert.ok(marked.indexOf("congress-rollcalls") > marked.indexOf(clock), `the marked roll calls stay behind ${clock}`);
  assert.ok(plain.indexOf("congress-rollcalls") > plain.indexOf("prl") && marked.indexOf("congress-rollcalls") < marked.indexOf("prl"),
    "the marked roll calls go ahead of longer-owed work of their own kind that follows the clock work");
  assert.deepEqual(marked.filter(id => !clockWork.includes(id) && id !== "congress-rollcalls"), plain.filter(id => !clockWork.includes(id) && id !== "congress-rollcalls"),
    "every other task keeps its order");
});

/** Controlled clock: a day of passes 30 minutes apart, each launching its first 40 reads (production settles 10-57). Due:
 * 54 of 56 voting states at the start, each again `votingEvery` after its read; 30 hourly meeting lanes; 56 daily ballot files. */
function day(votingEvery: number, order: (jobs: RoutineTaskAdmissionCandidate[]) => RoutineTaskAdmissionCandidate[]) {
  const pick = (prefix: string) => AUTOMATIC_REFRESH_TASKS.filter(task => task.id.startsWith(prefix));
  const lanes = [...new Map(ROUTINE_SOURCE_TASKS.filter(task => task.contract.schedule?.kind === "SITTING_WINDOW").map(task => [task.acquisitionFailureDomain, task])).values()].slice(0, 30);
  const every = (task: RoutineSourceTask) => task.id.startsWith("voting-sites:") ? votingEvery : task.id.startsWith("ballot-contests:") ? 24 * HOUR : HOUR;
  const last = new Map(pick("voting-sites:").slice(0, 2).map(task => [task.id, NOW_MS] as const)), runs = new Map<string, number>();
  const voting: number[] = [];
  let ballotWaitMs = 0;
  for (let pass = 0; pass < 48; pass += 1) {
    const now = NOW_MS + pass * HOUR / 2, owed = (task: RoutineSourceTask) => last.has(task.id) ? last.get(task.id)! + every(task) : NOW_MS - HOUR;
    const launched = order(electionLaunchOrder(routinePassLaunchOrder([...pick("voting-sites:"), ...lanes, ...pick("ballot-contests:")].filter(task => owed(task) <= now)
      .map(task => ({ task, lastConsideredAt: null, ...(lanes.includes(task) ? { deadlineMs: owed(task) } : { owedAtMs: owed(task) }) })), now))).slice(0, 40);
    for (const { task } of launched) {
      if (task.id.startsWith("ballot-contests:")) ballotWaitMs = Math.max(ballotWaitMs, now - owed(task));
      runs.set(task.id, (runs.get(task.id) ?? 0) + 1); last.set(task.id, now);
    }
    voting.push(launched.filter(({ task }) => task.id.startsWith("voting-sites:")).length);
  }
  return { voting, ballotWaitHours: ballotWaitMs / HOUR, ballotsRead: pick("ballot-contests:").every(task => runs.has(task.id)), laneRuns: lanes.map(task => runs.get(task.id) ?? 0) };
}

test("where-to-vote reads lead the pass: the backlog clears in two passes, ballot files keep their day, meeting lanes keep their turns", () => {
  const before = day(12 * HOUR, jobs => jobs), after = day(12 * HOUR, jobs => dueRequestsFirstInClass(jobs, new Set()));
  assert.deepEqual(after.voting.slice(0, 3), [40, 14, 0], "all 54 owed voting reads launch in the first two passes (157: 0, 12, 22, 20)");
  assert.deepEqual(before.voting.slice(0, 4), [0, 12, 22, 20]);
  assert.equal(after.voting.reduce((sum, n) => sum + n, 0) / 48, 2.2916666666666665, "twice daily: about 2.3 voting launches a pass, in two bursts a day");
  assert.ok(after.ballotsRead && after.ballotWaitHours === 2 && before.ballotWaitHours === 1.5, "every ballot file is read within its day; worst wait 2 hours (157: 1.5)");
  const lost = after.laneRuns.map((runs, at) => before.laneRuns[at]! - runs);
  assert.deepEqual([Math.min(...before.laneRuns), Math.max(...lost), lost.reduce((sum, n) => sum + n, 0)], [23, 1, 18],
    "each hourly meeting lane keeps 22 or more of its 23-24 daily reads; the two voting bursts cost 18 lane reads of 702");
  // The installed final-week voting cadence is hourly (votingDoorRefreshCadence): then voting takes 28 launches a pass.
  const hourly = day(HOUR, jobs => dueRequestsFirstInClass(jobs, new Set())), hourlyBefore = day(HOUR, jobs => jobs);
  assert.equal(hourly.voting.reduce((sum, n) => sum + n, 0) / 48, 27.958333333333332);
  assert.deepEqual([hourly.ballotWaitHours, hourly.laneRuns.reduce((sum, n) => sum + n, 0), hourlyBefore.laneRuns.reduce((sum, n) => sum + n, 0)], [3.5, 522, 702]);
});
