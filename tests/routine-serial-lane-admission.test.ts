import assert from "node:assert/strict";
import test from "node:test";
import { runBoundedChildPass, type BoundedChildCommand, type BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { readFileSync } from "node:fs";
import { ROUTINE_SOURCE_TASKS, routineBaselineOwed, routinePassLaunchOrder, routineSerialLane, routineSerialLanesFirst, routineTaskDue,
  routineTaskNextDueMs, type RoutineTaskClock } from "../lib/civic-data/runner.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";
import { electionLaunchOrder } from "../lib/civic-data/ballot-publication.ts";
import { placeSourceLaunchOrder } from "../lib/hunt/place-source-admission.ts";
import { routineProcessSlots, workerMemoryHost, workerProcessSlots, type WorkerMemoryOrder } from "../lib/control-plane/workers/worker-slots.ts";
import { placeMapReservationMiB } from "../lib/place-map/memory.ts";
import { placeMapLaunchOrder } from "../lib/civic-data/place-map-lane.ts";
import { votingAcquisitionDeadline } from "../scripts/fetch-voting-sites.mts";
import { passDeadlineFromEnv, withPassDeadline } from "../lib/ops/independent-runtime-pass.ts";

const mib = 1024 * 1024;
const people = (id: string) => ROUTINE_SOURCE_TASKS.find(task => task.id === id)!;
const meeting = ROUTINE_SOURCE_TASKS.find(task => task.recordClass === "MEETING")!;

test("overdue meetings retain first turn after serial-lane tie ordering, then first reads and steady refreshes", () => {
  const now = Date.parse("2026-10-22T18:26:00.000Z");
  const president = people("people-statewide-executive-sources-us");
  assert.equal(routineSerialLane(president.command), "serial:scripts/national-people-refresh.mts");
  const jobs = [
    { task: meeting, deadlineMs: now - 1, baselineOwed: false, lastConsideredAt: "2026-10-22T17:00:00.000Z" },
    { task: people("people-legiscan-api-de"), deadlineMs: undefined, baselineOwed: true, lastConsideredAt: "2026-10-22T17:30:00.000Z" },
    { task: people("people-wikidata-people-de"), deadlineMs: undefined, baselineOwed: false, lastConsideredAt: "2026-10-21T06:00:00.000Z" },
    { task: president, deadlineMs: undefined, baselineOwed: true, lastConsideredAt: null },
  ];
  const ordered = routinePassLaunchOrder(routineSerialLanesFirst(jobs), now).map(job => job.task.id);
  assert.deepEqual(ordered, [meeting.id, "people-statewide-executive-sources-us", "people-wikidata-people-de", "people-legiscan-api-de"],
    "serial-lane preference cannot move overdue meetings behind national baselines");
  assert.deepEqual(routineSerialLanesFirst([jobs[0]!]), [jobs[0]], "a pass with no serial lane keeps its order");
});

test("memory goes in launch order, and work that waited a full pass is not overtaken by smaller work queued behind it", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const peaks: Record<string, number> = { big: 1500 * mib, small: 300 * mib };
  const slots = workerProcessSlots(() => 10, { host, availableBytes: () => 2500 * mib, peakBytes: entry => peaks[entry.split("#")[0]!]! });
  const running = await slots.acquire("small#running", Date.now() + 10_000);
  const admitted: string[] = [];
  const wait = (entry: string, order?: WorkerMemoryOrder) => slots.acquire(entry, Date.now() + 10_000, order).then(release => { admitted.push(entry); return release; });
  const later = wait("small#later", { priority: 2 });
  const lane = wait("big#lane", { priority: 1, first: true });
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(admitted, [], "768 headroom + 300 running + 1500 does not fit 2500; the waited read keeps the small read out");
  running();
  const laneRelease = await lane;
  assert.deepEqual(admitted, ["big#lane"]);
  laneRelease();
  (await later)();
  assert.deepEqual(admitted, ["big#lane", "small#later"]);

  const unheld = await slots.acquire("small#running", Date.now() + 10_000);
  const order: string[] = [];
  const bigPlain = slots.acquire("big#plain", Date.now() + 10_000, { priority: 1 }).then(release => { order.push("big#plain"); return release; });
  const smallPlain = slots.acquire("small#plain", Date.now() + 10_000, { priority: 2 }).then(release => { order.push("small#plain"); return release; });
  (await smallPlain)();
  assert.deepEqual(order, ["small#plain"], "work that has not waited a pass does not hold the queue");
  unheld();
  (await bigPlain)();
});

test("a pass whose meeting programs fill memory still runs every read of the people lane before its launch deadline", async () => {
  const host = workerMemoryHost({ processes: () => [] });
  const slots = workerProcessSlots(() => 100, { host, availableBytes: () => 4096 * mib, peakBytes: entry => (entry.startsWith("small") ? 342 : 1258) * mib });
  const lane = "serial:scripts/national-people-refresh.mts";
  const command = (id: string, serialLane?: string): BoundedChildCommand => ({ id, executable: "node", args: [], ...(serialLane ? { serialLane } : {}) });
  const calendars = Array.from({ length: 12 }, (_, i) => command(`calendar-${i}`));
  const small = Array.from({ length: 12 }, (_, i) => command(`small-${i}`));
  const peopleReads = ["people-us", "people-az", "people-tx"].map(id => command(id, lane));
  // Keep the same proportions while leaving room for timer scheduling under suite load.
  const durations = (id: string) => id.startsWith("calendar") ? 1_600 : id.startsWith("small") ? 160 : 120;
  // Twelve meetings need at least 9.6 seconds at two concurrent slots;
  // the deadline still requires the people lane to get a turn first.
  const deadline = Date.now() + 7_000;
  const ran: string[] = [];
  const releases = new Map<string, () => void>();
  const ordered = routineSerialLanesFirst([...calendars, ...small, ...peopleReads].map(c => ({ task: { command: c.serialLane ? ["scripts/national-people-refresh.mts"] : ["x"] }, c }))).map(({ c }) => c);
  const results = await runBoundedChildPass(ordered, {
    cwd: ".", env: process.env, concurrency: ordered.length,
    onStarting: async (c, index) => { releases.set(c.id, await slots.acquire(`${c.id}/x.mts`, deadline, { priority: index, ...c.serialLane ? { first: true as const } : {} })); },
    onSettled: async run => { releases.get(run.id)?.(); },
  }, async (c): Promise<BoundedChildResult> => {
    ran.push(c.id);
    await new Promise(resolve => setTimeout(resolve, durations(c.id)));
    return { id: c.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
  });
  assert.deepEqual(peopleReads.map(c => ran.includes(c.id)), [true, true, true], `ran: ${ran.join(" ")}`);
  assert.equal(results.filter(r => r.termination === "EXITED").length, ran.length);
});

test("voting sites and the overdue backlog take turns for memory, so neither holds the other out until the deadline", async () => {
  // Production, Oct 24 20:20:05Z pass: all 56 voting-sites tasks deferred WORKER_MEMORY_DEADLINE. IL had read at 12:29 and was
  // due only by its changed doors (owed "now"), TX had never read (a baseline first read), AK's 12:28 read failed (retry owed
  // 13:28). Fifteen 1,447 MiB state calendar programs held 20,244 MiB of available memory until the pass deadline.
  const now = Date.parse("2026-10-24T20:20:05.706Z"), MIB = 1024 * 1024, HOUR = 3_600_000;
  const site = (state: string) => AUTOMATIC_REFRESH_TASKS.find(task => task.id === `voting-sites:${state}`)!;
  const clocks: Record<string, RoutineTaskClock | undefined> = {
    IL: { lastAttemptedAt: "2026-10-24T12:29:19.703Z", lastSucceededAt: "2026-10-24T12:29:18.917Z",
      lastSucceededObservedAt: "2026-10-24T12:29:19.703Z", lastSucceededParserVersion: site("IL").parserVersion },
    TX: undefined,
    AK: { lastAttemptedAt: "2026-10-24T12:28:11.774Z" },
  };
  // The runner's candidate: cadence work is owed from its due instant, input-only work "now", a first read has no instant.
  const candidate = (task: typeof meeting, clock: RoutineTaskClock | undefined, inputDue: boolean) => {
    const cadenceDue = routineTaskDue(task, clock, now), nextDueMs = routineTaskNextDueMs(task, clock, now);
    assert.ok(cadenceDue || inputDue);
    return { task, baselineOwed: routineBaselineOwed(task, clock), lastConsideredAt: clock?.lastAttemptedAt ?? null,
      owedAtMs: !cadenceDue ? now : nextDueMs < now ? nextDueMs : undefined };
  };
  const campaign = ROUTINE_SOURCE_TASKS.find(task => task.id === "candidate-campaign-sites-derived:IL")!;
  const admitted = [
    ...Array.from({ length: 15 }, (_, index) => ({ task: { ...meeting, id: `meetings:calendar-${index}` },
      deadlineMs: index ? now - (index + 3) * HOUR : Number.NEGATIVE_INFINITY, lastConsideredAt: null })),
    { task: campaign, owedAtMs: now, lastConsideredAt: "2026-10-24T20:00:00.000Z" },
    ...["IL", "TX", "AK"].map(state => candidate(site(state), clocks[state], true)),
  ];
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /for \(const \{ task \} of PLACE_MAPS \? placeMapLaunchOrder\(admitted\)\s+: shutFeedsLast\(electionLaunchOrder\(routinePassLaunchOrder\(routineSerialLanesFirst\(placeSourceLaunchOrder\(admitted\)\), admissionNowMs\)\), shutDoors\)\)/);
  const order = electionLaunchOrder(routinePassLaunchOrder(routineSerialLanesFirst(placeSourceLaunchOrder(admitted)), now));
  assert.deepEqual(order.slice(0, 6).map(job => job.task.id.split(":")[0]), ["voting-sites", "meetings", "voting-sites", "meetings", "voting-sites", "meetings"]);

  const slots = routineProcessSlots({ host: workerMemoryHost({ processes: () => [] }), availableBytes: () => 20_244 * MIB });
  const script = (id: string) => id.startsWith("meetings:") ? "ingest.ts" : id.startsWith("voting-sites:") ? "fetch-voting-sites.mts" : "derive-candidate-campaign-sites.mts";
  const deadline = Date.now() + 200;
  // Nothing releases before the deadline: every started child holds its reservation until the pass's wall.
  const outcomes = await Promise.allSettled(order.map(({ task }, index) => slots.acquire(`${task.id}/${script(task.id)}`, deadline, { priority: index })));
  const started = order.filter((_, index) => outcomes[index]!.status === "fulfilled").map(job => job.task.id);
  for (const state of ["IL", "TX", "AK"]) assert.ok(started.includes(`voting-sites:${state}`), `voting-sites:${state} starts this pass`);
  assert.equal(started.filter(id => id.startsWith("meetings:")).length, 12, "the calendar backlog keeps the rest of the memory");

  // Production, Oct 25 03:10Z pass: 29 voting-sites programs led it and 826 meeting boards in 39 states waited on memory.
  const states = ["AL", "AR", "AZ", "CA", "CO", "CT", "DE", "FL", "GA", "IA", "ID", "IN", "KS", "KY", "LA", "MA", "MD", "ME", "MI", "MN",
    "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV"];
  const crowded = electionLaunchOrder([...admitted.slice(0, 15), ...states.map(state => ({ task: site(state) }))]);
  const crowdedSlots = routineProcessSlots({ host: workerMemoryHost({ processes: () => [] }), availableBytes: () => 20_244 * MIB });
  const crowdedDeadline = Date.now() + 200;
  const admittedNow = await Promise.allSettled(crowded.map(({ task }, index) => crowdedSlots.acquire(`${task.id}/${script(task.id)}`, crowdedDeadline, { priority: index })));
  const crowdedStarted = crowded.filter((_, index) => admittedNow[index]!.status === "fulfilled").map(job => job.task.id);
  assert.ok(crowdedStarted.filter(id => id.startsWith("meetings:")).length >= 8, `calendars start beside voting sites: ${crowdedStarted.join(" ")}`);
  assert.ok(crowdedStarted.filter(id => id.startsWith("voting-sites:")).length >= 8, `voting sites keep half the memory: ${crowdedStarted.join(" ")}`);

  // A voting child told when the pass ends stops reading with time to publish; untold, it reads into the pass's wall.
  assert.match(runner, /function sourceChildCommand[\s\S]*?env: withPassDeadline\(\{[\s\S]*?\.\.\.pending\.env,\s*\}, SOURCE_CHILD_DEADLINE_MS\),/);
  assert.match(runner, /const SOURCE_CHILD_DEADLINE_MS = PLACE_MAPS \? [^;]+ : PASS_LAUNCH_DEADLINE_MS;/, "outside the place-map lane a child is told the launch deadline");
  const wall = now + 20 * 60_000;
  assert.equal(votingAcquisitionDeadline(now, passDeadlineFromEnv({})), wall);
  assert.ok(votingAcquisitionDeadline(now, passDeadlineFromEnv(withPassDeadline({ NODE_ENV: "test" }, wall))) <= wall - 6 * 60_000);
});

test("due explainers, voting sites and meetings each obtain memory before another family holds the pass to its deadline", async () => {
  // AZ, CA and WA were deferred at 2026-10-24T21:53:43Z before a single translation model call.
  const translations = ["AZ", "CA", "WA"].map(state => ({ task: ROUTINE_SOURCE_TASKS.find(task => task.id === `measure-translations:${state}`)! }));
  assert.ok(translations.every(job => job.task));
  const voting = { task: AUTOMATIC_REFRESH_TASKS.find(task => task.id === "voting-sites:IL")! };
  const calendars = Array.from({ length: 4 }, (_, index) => ({ task: { ...meeting, id: `meetings:fixture:${index}` } }));
  const before = [voting, ...calendars, ...translations];
  const after = electionLaunchOrder([...calendars, ...translations, voting]);
  assert.equal(after[0].task.id, voting.task.id, "voting keeps its first turn");
  assert.deepEqual(after.map(job => job.task.id).sort(), before.map(job => job.task.id).sort(), "every admitted job remains in the pool");
  const admitted = async (jobs: typeof before, availableMiB = 3072) => {
    let open = true;
    const slots = routineProcessSlots({ admissionsOpen: () => open, host: workerMemoryHost({ processes: () => [] }),
      availableBytes: () => availableMiB * mib,
      peakBytes: entry => (entry.startsWith("voting-sites:") ? 512 : entry.startsWith("measure-translations:") ? 342 : 1447) * mib });
    const started: string[] = [], releases: (() => void)[] = [];
    const pending = jobs.map(({ task }, priority) => slots.acquire(task.id, Date.now() + 10_000, { priority }).then(release => {
      started.push(task.id); releases.push(release);
    }));
    await new Promise(resolve => setImmediate(resolve));
    // Observe only the initial allocation, with no child releasing its memory. Close and drain every waiter afterward.
    open = false;
    for (const release of releases) release();
    await Promise.allSettled(pending);
    return started;
  };
  const oldStarted = await admitted(before), newStarted = await admitted(after);
  assert.equal(oldStarted.filter(id => id.startsWith("measure-translations:")).length, 1);
  assert.deepEqual(newStarted.map(id => id.split(":")[0]), ["voting-sites", "measure-translations", "meetings"],
    "three GiB admits all three families while preserving the existing 768 MiB margin");

  // The observed production headroom was 20,244 MiB. A long calendar backlog previously left every translator waiting.
  const crowdedVoting = AUTOMATIC_REFRESH_TASKS.filter(task => /^voting-sites:[A-Z]{2}$/.test(task.id)).slice(0, 30).map(task => ({ task }));
  const crowdedTranslations = ROUTINE_SOURCE_TASKS.filter(task => /^measure-translations:[A-Z]{2}$/.test(task.id)).slice(0, 30).map(task => ({ task }));
  const crowdedCalendars = Array.from({ length: 30 }, (_, index) => ({ task: { ...meeting, id: `meetings:fixture:${index}` } }));
  assert.equal(crowdedVoting.length, 30);
  assert.equal(crowdedTranslations.length, 30);
  const crowdedBefore = crowdedVoting.flatMap((job, index) => [job, crowdedCalendars[index]]).concat(crowdedTranslations);
  const crowdedAfter = electionLaunchOrder(crowdedBefore);
  assert.deepEqual(crowdedAfter.map(job => job.task.id).sort(), crowdedBefore.map(job => job.task.id).sort());
  const oldCrowdedStarted = await admitted(crowdedBefore, 20_244), balancedStarted = await admitted(crowdedAfter, 20_244);
  assert.equal(oldCrowdedStarted.filter(id => id.startsWith("measure-translations:")).length, 0);
  const count = (prefix: string) => balancedStarted.filter(id => id.startsWith(prefix)).length;
  assert.deepEqual([count("voting-sites:"), count("measure-translations:"), count("meetings:")], [9, 9, 8]);
  assert.equal(balancedStarted.length, 26);
  assert.ok(20_244 - (count("voting-sites:") * 512 + count("measure-translations:") * 342 + count("meetings:") * 1447) >= 768);
});

test("state place maps run in their own lane smallest first; the routine pass's order holds no map", () => {
  const maps = ROUTINE_SOURCE_TASKS.filter(task => task.id.startsWith("place-map-")).map(task => ({ task }));
  assert.equal(maps.length, 56);
  const order = placeMapLaunchOrder(maps).map(job => job.task.id);
  assert.deepEqual(order, [...maps].sort((left, right) => placeMapReservationMiB(left.task.id.slice(10)) -
    placeMapReservationMiB(right.task.id.slice(10))).map(job => job.task.id), "the smallest reservation goes first");
  assert.equal(order[0], "place-map-as");
  assert.equal(order[55], "place-map-tx");
  const ballot = { task: AUTOMATIC_REFRESH_TASKS.find(task => task.id === "ballot-contests:AZ")! };
  const voting = { task: AUTOMATIC_REFRESH_TASKS.find(task => task.id === "voting-sites:AZ")! };
  const calendars = Array.from({ length: 3 }, (_, index) => ({ task: { ...meeting, id: `meetings:fixture:${index}` } }));
  assert.deepEqual(electionLaunchOrder([...calendars, voting, ballot]).map(job => job.task.id),
    [ballot.task.id, voting.task.id, ...calendars.map(job => job.task.id)], "held ballot files first, then voting sites and reads take turns");
});
