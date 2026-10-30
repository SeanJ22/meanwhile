import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { electionLaunchOrder } from "../lib/civic-data/ballot-publication.ts";
import { routineDueRequestDeadlineMs, routineDueRequestFor, type RoutineDueRequest } from "../lib/civic-data/routine-due-request.ts";
import { routineFailureDomainFrontier, routinePassLaunchOrder, routineTaskDeadlineMs, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { readNowDueRequests, shutFeedsLast } from "../lib/doors/mission-refresh.ts";
import { readRunnerDoors } from "../lib/doors/runner-reads.ts";
import { seedFeedDoors } from "../lib/doors/seed-feeds.ts";

const HOUR = 3_600_000;
const NOW_MS = Date.parse("2026-10-30T05:28:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();
const VOTING = AUTOMATIC_REFRESH_TASKS.filter(task => /^voting-sites:(?:AK|AL|AZ|CA|CO)$/.test(task.id));
/** Hours since each state's twice-daily read came due: Alaska has waited longest. */
const OWED_HOURS: Record<string, number> = { "voting-sites:AK": 9, "voting-sites:AL": 6, "voting-sites:AZ": 5, "voting-sites:CA": 4, "voting-sites:CO": 3 };

/** One ordinary pass, built the way the runner builds it: due request, frontier, launch order, shut feeds last. */
async function pass(repo: ReturnType<typeof createMemoryRepositories>["doors"], nowMs: number, clocks: ReadonlyMap<string, RoutineTaskClock>, due: readonly string[]) {
  const requests: RoutineDueRequest[] = readNowDueRequests(await readRunnerDoors(repo, ["readNow"], "true", "requests"), new Set(VOTING.map(({ id }) => id)), iso(nowMs));
  const candidates = VOTING.flatMap(task => {
    const clock = clocks.get(task.id), request = routineDueRequestFor(task, clock, nowMs, requests);
    if (!due.includes(task.id) && request === null) return [];
    return [{ task, lastConsideredAt: clock?.lastAttemptedAt ?? null, owedAtMs: nowMs - OWED_HOURS[task.id]! * HOUR,
      deadlineMs: routineDueRequestDeadlineMs(routineTaskDeadlineMs(task, clock), request) }];
  });
  const ordered = electionLaunchOrder(routinePassLaunchOrder(routineFailureDomainFrontier(candidates), nowMs));
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
