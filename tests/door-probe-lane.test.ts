import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

import { MEETING_PARTITION_CONTRACTS } from "@/lib/civic-data/meeting-partitions.ts";
import { admitJobLaunch, JOB_BREAKER_PATH_ENV } from "@/lib/control-plane/job-breaker-local.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { pgAggregateRepository } from "@/lib/control-plane/repository/pg-store.ts";
import { routineProcessSlots } from "@/lib/control-plane/workers/worker-slots.ts";
import { countNeonBytes, processNeonBytes } from "@/lib/db/transfer-by-caller.ts";
import type { Query } from "@/lib/facts/publish.ts";
import { IndependentRuntimeLaneScheduler } from "@/lib/ops/independent-runtime-pass.ts";
import { PendingRestart } from "@/lib/ops/pending-restart.ts";
import { memoryWebsitePacing, WEBSITE_WINDOW_MS } from "@/lib/control-plane/website-pacing.ts";
import { PROBE_RETRY_MS, runHourlyProbes } from "@/lib/doors/hourly-check.ts";
import { DOOR_PROBE_REFRESH_MS, DOOR_PROBES_JOB, doorProbesLane, runDoorProbeTurn, runStandingDoorProbes,
  type StandingDoorProbeInput } from "@/lib/doors/probe-lane.ts";
import { pacedProbeFetch } from "@/lib/doors/probe-fetch.ts";
import { applyManualEdit, checkDoorDraft, type DoorRecord } from "@/lib/doors/registry.ts";

const START = Date.parse("2026-10-28T21:00:00.000Z");
const MINUTE = 60_000;

function door(id: string, url: string): DoorRecord {
  const host = new URL(url).hostname;
  const meeting = { agendaSourceType: "ICAL", jurisdiction: "Example", publishingOrg: "Example", timeZone: "America/Phoenix", verifiedAt: "2026-09-01" };
  const draft = checkDoorDraft({ doorId: id, kind: "ical", hosts: [host], config: { feedUrl: url }, holds: ["meetings"], meeting });
  if (!draft.ok) throw new Error(draft.why);
  return applyManualEdit(null, draft.value, new Date(START - 600 * MINUTE).toISOString());
}

/** Websites behind the shared paced fetch, on the test's clock, recording every request and how many were in flight. */
function websites(options: { small?: (url: string) => boolean; status?: (url: string) => number; delayMs?: number; clock: () => number }) {
  const pacing = memoryWebsitePacing();
  const asked: { url: string; host: string; at: number }[] = [];
  const inFlight = new Map<string, number>();
  let most = 0, mostOneHost = 0, now = 0;
  const fetchImpl = (async (url: string) => {
    const host = new URL(url).hostname;
    asked.push({ url, host, at: options.clock() });
    inFlight.set(host, (inFlight.get(host) ?? 0) + 1); now += 1;
    most = Math.max(most, now); mostOneHost = Math.max(mostOneHost, inFlight.get(host)!);
    await new Promise((resolve) => setTimeout(resolve, options.delayMs ?? 0));
    inFlight.set(host, inFlight.get(host)! - 1); now -= 1;
    return new Response(`page ${url} at ${options.clock()}`, { status: options.status?.(url) ?? 200 });
  }) as unknown as typeof fetch;
  const fetchFn = pacedProbeFetch({ pacing, fetchImpl, clock: options.clock,
    sizeFor: (url) => (options.small?.(url) ? { kind: "local-government", population: 4_000 } : { kind: "local-government", population: 500_000 }) });
  return { pacing, fetchFn, asked, most: () => most, mostOneHost: () => mostOneHost };
}

async function registry(doors: readonly DoorRecord[]) {
  const repos = createMemoryRepositories();
  for (const d of doors) await repos.doors.put(d.doorId, d, new Date(START - 600 * MINUTE).toISOString());
  let reads = 0;
  return { repo: repos.doors, reads: () => reads,
    readDoors: async () => { reads += 1; return (await repos.doors.list()).map((row) => row.value); } };
}

test("door probes look at several websites side by side, never two requests at once to one website", async () => {
  const hosts = ["a.example.gov", "b.example.gov", "c.example.gov", "d.example.gov", "e.example.gov"];
  const doors = hosts.flatMap((host) => Array.from({ length: 6 }, (_, i) => door(`${host}-${i}`, `https://${host}/${i}.ics`)));
  const { repo } = await registry(doors);
  const site = websites({ clock: () => START, delayMs: 5 });
  const report = await runHourlyProbes(repo, doors, new Set(doors.map((d) => d.doorId)), site.fetchFn, new Date(START).toISOString(), { websites: 3, clock: () => START });
  assert.equal(report.looked, 30);
  assert.equal(site.asked.length, 30, "every hot page asked once");
  assert.equal(site.mostOneHost(), 1, "one request in flight per website");
  assert.equal(site.most(), 3, "three websites side by side, never more than the bound");
  const one = websites({ clock: () => START, delayMs: 1 });
  await runHourlyProbes(repo, doors.slice(0, 6), new Set(doors.map((d) => d.doorId)), one.fetchFn, new Date(START).toISOString(), { websites: 8, clock: () => START });
  assert.equal(one.most(), 1, "one website's pages go one after another however many websites may run at once");
});

test("a turn looks at every hot due door, waits for the next one, and never asks a small publisher more than ten times an hour", async () => {
  let now = START;
  const clock = () => now;
  const smallPages = Array.from({ length: 14 }, (_, i) => door(`small-${i}`, `https://town.example.gov/${i}.ics`));
  const bigPages = Array.from({ length: 40 }, (_, i) => door(`big-${i}`, `https://county.example.gov/${i}.ics`));
  const cold = door("cold-0", "https://county.example.gov/cold.ics");
  const shared = [door("shared-a", "https://county.example.gov/shared.ics"), door("shared-b", "https://county.example.gov/shared.ics")];
  const all = [...smallPages, ...bigPages, cold, ...shared];
  const hot = new Set(all.filter((d) => d !== cold).map((d) => d.doorId));
  const held = await registry(all);
  const site = websites({ clock, small: (url) => new URL(url).hostname === "town.example.gov" });
  await site.pacing.take("town.example.gov", 10, START - 30 * MINUTE);
  const lines: string[] = [];
  const report = await runDoorProbeTurn({ repo: held.repo, readDoors: held.readDoors, readHot: async () => hot, fetchFn: site.fetchFn,
    websites: 8, admitted: () => true, deadlineMs: START + 3 * 60 * MINUTE, log: (line) => lines.push(line), clock,
    sleep: async (ms) => { now += ms; } });
  assert.equal(report.ended, "DEADLINE");

  const first = site.asked.filter((ask) => ask.at === START);
  assert.equal(new Set(first.filter((ask) => ask.host === "county.example.gov").map((ask) => ask.url)).size, 41, "every larger publisher's hot page in the first round, the shared feed once");
  assert.equal(first.filter((ask) => ask.host === "town.example.gov").length, 9, "another reader's request leaves the small publisher nine");
  assert.ok(!site.asked.some((ask) => ask.url.endsWith("/cold.ics")), "a cold door waits for its twice-daily check");
  for (const ask of site.asked.filter((row) => row.host === "town.example.gov")) {
    const inHour = site.asked.filter((row) => row.host === "town.example.gov" && row.at <= ask.at && ask.at - row.at < WEBSITE_WINDOW_MS).length
      + (ask.at - (START - 30 * MINUTE) < WEBSITE_WINDOW_MS ? 1 : 0);
    assert.ok(inHour <= 10, `at most ten requests in any hour to the small publisher (${inHour} at ${new Date(ask.at).toISOString()})`);
  }
  const smallLooks = new Map<string, number[]>();
  for (const ask of site.asked.filter((row) => row.host === "town.example.gov")) smallLooks.set(ask.url, [...smallLooks.get(ask.url) ?? [], ask.at]);
  assert.equal(smallLooks.size, 14, "every small publisher's hot page is looked at once its hour allows");
  for (const [url, times] of new Map([...site.asked.filter((row) => row.host === "county.example.gov")
    .reduce((by, ask) => by.set(ask.url, [...by.get(ask.url) ?? [], ask.at]), new Map<string, number[]>())])) {
    for (let i = 1; i < times.length; i += 1) {
      assert.ok(times[i]! - times[i - 1]! >= 55 * MINUTE, `${url}: looked at once an hour, never sooner than its lead`);
      assert.ok(times[i]! - times[i - 1]! <= 60 * MINUTE, `${url}: looked at again within the hour`);
    }
    assert.equal(times.length, 4, `${url}: four looks in three hours`);
  }
  for (const d of [...bigPages, ...shared]) assert.ok((await held.repo.read(d.doorId))!.value.validators?.checkedAt, `${d.doorId}: its look is stored`);
  assert.equal(held.reads(), Math.ceil(3 * 60 * MINUTE / DOOR_PROBE_REFRESH_MS), "the open-door list is read once per refresh, not once per round");
  assert.ok(lines.some((line) => /up to 8 websites at once/.test(line)));
});

test("a failed page waits before it is asked again, and a website's Retry-After holds every page on it", async () => {
  let now = START;
  const clock = () => now;
  const doors = [door("broken", "https://broken.example.gov/a.ics"), door("busy-0", "https://busy.example.gov/0.ics"), door("busy-1", "https://busy.example.gov/1.ics")];
  const held = await registry(doors);
  const site = websites({ clock, status: (url) => url.includes("broken") ? 404 : url.includes("busy") && clock() < START + 20 * MINUTE ? 429 : 200 });
  await runDoorProbeTurn({ repo: held.repo, readDoors: held.readDoors, readHot: async () => new Set(doors.map((d) => d.doorId)), fetchFn: site.fetchFn,
    websites: 8, admitted: () => true, deadlineMs: START + 30 * MINUTE, log: () => undefined, clock, sleep: async (ms) => { now += ms; } });
  const broken = site.asked.filter((ask) => ask.host === "broken.example.gov").map((ask) => ask.at);
  for (let i = 1; i < broken.length; i += 1) assert.ok(broken[i]! - broken[i - 1]! >= PROBE_RETRY_MS, "a broken page is never asked every round");
  assert.equal(broken.length, 3);
  const busy = site.asked.filter((ask) => ask.host === "busy.example.gov");
  assert.equal(busy.filter((ask) => ask.at === START).length, 1, "after the 429 the website's other page waits");
  for (let i = 1; i < busy.length; i += 1) assert.ok(busy[i]!.at - busy[i - 1]!.at >= MINUTE, "the website is left alone for its wait");
});

test("a small town's used hour on a shared vendor host holds only the town's pages, never a larger government's beside it", async () => {
  const town = Array.from({ length: 12 }, (_, i) => door(`a-town-${i}`, `https://vendor.example.com/town/${i}.ics`));
  const city = Array.from({ length: 6 }, (_, i) => door(`b-city-${i}`, `https://vendor.example.com/city/${i}.ics`));
  const doors = [...town, ...city];
  const { repo } = await registry(doors);
  const site = websites({ clock: () => START, small: (url) => url.includes("/town/") });
  const report = await runHourlyProbes(repo, doors, new Set(doors.map((d) => d.doorId)), site.fetchFn, new Date(START).toISOString(), { websites: 8, clock: () => START });
  assert.equal(site.asked.filter((ask) => ask.url.includes("/town/")).length, 10, "the town's ten an hour");
  assert.equal(site.asked.filter((ask) => ask.url.includes("/city/")).length, 6, "every city page on the same host is still asked");
  assert.equal(report.waiting, 2);
});

test("a breaker pause stops the turn within it, and a drained turn starts no new look", async () => {
  const root = mkdtempSync(join(tmpdir(), "door-probes-")), path = join(root, "breaker.json");
  try {
    const env = { ...process.env, [JOB_BREAKER_PATH_ENV]: path };
    writeFileSync(path, JSON.stringify({ checkedAt: new Date(START).toISOString(), states: {} }));
    let now = START;
    const clock = () => now;
    const doors = Array.from({ length: 12 }, (_, i) => door(`hot-${i}`, `https://city.example.gov/${i}.ics`));
    const held = await registry(doors);
    const site = websites({ clock });
    const fetchFn: typeof site.fetchFn = async (url, headers) => {
      const answer = await site.fetchFn(url, headers);
      if (site.asked.length === 3) writeFileSync(path, JSON.stringify({ checkedAt: new Date(now).toISOString(),
        states: { [DOOR_PROBES_JOB.id]: { job: DOOR_PROBES_JOB.id, mode: "PAUSED", at: new Date(now).toISOString(), hour: new Date(now).toISOString(), offsetBytes: 0 } } }));
      return answer;
    };
    const report = await runDoorProbeTurn({ repo: held.repo, readDoors: held.readDoors, readHot: async () => new Set(doors.map((d) => d.doorId)), fetchFn,
      websites: 8, admitted: () => admitJobLaunch(DOOR_PROBES_JOB.id, env), deadlineMs: START + 60 * MINUTE, log: () => undefined, clock,
      sleep: async (ms) => { now += ms; } });
    assert.equal(report.ended, "HELD");
    assert.equal(site.asked.length, 3, "no look starts after the pause");
    let drained = false;
    const drainedReport = await runDoorProbeTurn({ repo: held.repo, readDoors: held.readDoors, readHot: async () => new Set(doors.map((d) => d.doorId)),
      fetchFn: async (url, headers) => { drained = true; return site.fetchFn(url, headers); }, websites: 8, admitted: () => !drained,
      deadlineMs: START + 60 * MINUTE, log: () => undefined, clock, sleep: async (ms) => { now += ms; } });
    assert.equal(drainedReport.ended, "HELD");
    assert.equal(site.asked.length, 4, "the look in flight finishes; none starts after");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/** A meeting partition whose sittings decide its doors' checks. */
const PARTITION = MEETING_PARTITION_CONTRACTS.find((contract) => contract.schedule?.kind === "SITTING_WINDOW")!.id;
/** An hour of its own, so the meter rows this file counts are not mixed with any other test's. */
const METER_HOUR = Date.parse("2031-01-01T05:00:00.000Z");

function partitionDoor(id: string, url: string): DoorRecord {
  const d = door(id, url);
  return { ...d, meeting: { ...d.meeting!, family: PARTITION } };
}

/** The reader's hot-partition statement, answering that no partition is cold, metered like a real read. */
const readerQuery: Query = async () => {
  countNeonBytes("reader", 100, METER_HOUR, { requests: 1, bytes: 10 }, undefined, "hot-partition-test");
  return [{ cold: "", undecided: {} }];
};

/** The production repositories' Admin settings read (Postgres), over a statement double that answers the owner's row. */
function postgresAdminConfig(settings: Record<string, unknown>) {
  const statements: string[] = [];
  const sql = {
    async query(text: string, params: readonly unknown[] = []): Promise<unknown> {
      statements.push(text);
      countNeonBytes("control-plane", 50, METER_HOUR, { requests: 1, bytes: 5 }, undefined, "admin-config-test");
      return [{ id: params[0], revision: 3, updated_at: new Date(START).toISOString(), __unchanged: false, value: { settings } }];
    },
  };
  return { statements, adminConfig: pgAggregateRepository(sql, "AdminConfig", "cp_admin_config") as StandingDoorProbeInput["repos"]["adminConfig"] };
}

test("a standing turn reads the owner's dotted settings from Postgres and looks at every due hot door", async () => {
  // Release 143's turn ended at this read: the Postgres projection refused "fetch.hostConcurrency" before any request.
  const doors = ["a", "b", "c"].flatMap((host) => [0, 1].map((i) => partitionDoor(`${host}-${i}`, `https://${host}.example.gov/${i}.ics`)));
  const held = await registry(doors);
  const owner = postgresAdminConfig({ "fetch.hostConcurrency": 2, "meetings.hotEveryMinutes": 60, "unrelated.secret": "never read" });
  let now = START;
  const clock = () => now;
  const site = websites({ clock });
  const lines: string[] = [];
  const report = await runStandingDoorProbes({ repos: { adminConfig: owner.adminConfig, doors: held.repo, websitePacing: site.pacing }, readerQuery,
    deadlineMs: START + 30 * MINUTE, admitted: () => true, log: (line) => lines.push(line), clock, sleep: async (ms) => { now += ms; },
    fetchImpl: (async (url: string) => new Response(`page ${url}`)) as unknown as typeof fetch });
  assert.equal(owner.statements.length, 1);
  assert.match(owner.statements[0]!, /'fetch\.hostConcurrency'/, "the setting is narrowed in the database");
  assert.doesNotMatch(owner.statements[0]!, /unrelated/);
  assert.equal(report.ended, "DEADLINE");
  assert.equal(report.looked, 6, "every due hot door is looked at");
  for (const d of doors) assert.ok((await held.repo.read(d.doorId))!.value.validators?.checkedAt, `${d.doorId}: its look is stored`);
  assert.ok(lines.some((line) => /up to 2 websites at once/.test(line)), "the owner's in-flight bound is used");
  assert.ok(lines.some((line) => /^RCD_PROBE turn ended \(its hour is up\): .* 6 door\(s\) looked at/.test(line)));
  const meter = processNeonBytes().find((hour) => Date.parse(hour.hour) === METER_HOUR)?.reads ?? {};
  const metered = (prefix: string) => Object.keys(meter).some((key) => key.startsWith(prefix));
  assert.ok(metered("reader\tdoor-probes\thot-partition-test"), "the reader read is metered under door-probes");
  assert.ok(metered("control-plane\tdoor-probes\tadmin-config-test"), "the settings read is metered under door-probes");
});

const runnerSource = readFileSync("scripts/pilot-runner.mts", "utf8");
const { stripTypeScriptTypes } = nodeModule as typeof nodeModule & { stripTypeScriptTypes(source: string): string };
function runnerFunction(name: string): string {
  const fn = runnerSource.match(new RegExp(`\\n(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))?.[0];
  assert.ok(fn, `pilot-runner.mts has no ${name}()`);
  return fn;
}

test("the runner's door-probes lane looks at due hot doors while bulk work holds all the host's memory, and a release drain ends it", async () => {
  const doors = Array.from({ length: 8 }, (_, i) => partitionDoor(`hot-${i}`, `https://${i % 4}.example.gov/${i}.ics`));
  const held = await registry(doors);
  const owner = postgresAdminConfig({ "fetch.hostConcurrency": 8 });
  const pacing = memoryWebsitePacing();
  // Other work holds every byte: a bulk worker asking now gets no memory before its deadline.
  const bulk = routineProcessSlots({ availableBytes: () => 0 });
  const bulkWait = bulk.acquire("promote-manual-civic-projection.mts", Date.now() + 200).then(() => "ADMITTED", (error: Error) => error.message);
  let now = Date.now();
  const asked: string[] = [];
  const log: string[] = [];
  const context = createContext({
    provider: "postgres", canary: false, runtimeAdmissionsHeld: false, admitJobLaunch, DOOR_PROBES_JOB,
    pendingRestart: new PendingRestart(), researchCycleActive: false, researchCycleChild: null, drainHunterLane: () => {},
    ownerRepositories: async () => ({ adminConfig: owner.adminConfig, doors: held.repo, websitePacing: pacing }),
    readerFactDb: () => ({ query: readerQuery }),
    // The runner's own turn, on the test's clock so an hour passes at once.
    runStandingDoorProbes: (input: StandingDoorProbeInput) => runStandingDoorProbes({ ...input, clock: () => now, sleep: async (ms) => { now += ms; },
      fetchImpl: (async (url: string) => {
        asked.push(url);
        if (asked.length === doors.length + 1) context.holdForRestart("a".repeat(40));
        return new Response(`page ${url} ${asked.length}`);
      }) as unknown as typeof fetch }),
    console: { log: (line: string) => log.push(line), error: (line: string) => log.push(line) },
  });
  runInContext(stripTypeScriptTypes(["jobLaunchAllowed", "runDoorProbes", "holdForRestart"].map(runnerFunction).join("\n")), context);
  assert.doesNotMatch(runnerFunction("runDoorProbes"), /acquire\(|runRuntimeChildren/, "the turn waits for no host memory and starts no child");
  context.standingRuntimeScheduler = new IndependentRuntimeLaneScheduler([doorProbesLane(context.runDoorProbes)], (outcome) => {
    if (outcome.state === "FAILED") log.push(`FAILED ${outcome.error}`);
  });
  assert.deepEqual(context.standingRuntimeScheduler.tick(Date.now()), ["door-probes"]);
  // Within the hour every door is due again; the release drain lands with the first look of that round.
  await context.standingRuntimeScheduler.waitForIdle();
  assert.match(await bulkWait, /WORKER_MEMORY_DEADLINE/, "bulk work found no memory the whole time");
  assert.deepEqual(log.filter((line) => line.startsWith("FAILED")), []);
  assert.ok(new Set(asked).size === doors.length, "every due hot door's page was asked");
  for (const d of doors) assert.ok((await held.repo.read(d.doorId))!.value.validators?.checkedAt, `${d.doorId}: its look is stored`);
  assert.equal(context.runtimeAdmissionsHeld, true);
  assert.ok(log.some((line) => /^RCD_PROBE turn ended \(paused or drained\)/.test(line)), "the release drain ends the turn");
  assert.ok(asked.length > doors.length && asked.length <= doors.length + 4, "only looks already started (one per website) finish after the drain");
  const reads = owner.statements.length, looks = asked.length;
  context.standingRuntimeScheduler.tick(Date.now() + 2 * MINUTE);
  await context.standingRuntimeScheduler.waitForIdle();
  assert.deepEqual([owner.statements.length, asked.length], [reads, looks], "while admissions are held a new turn reads and asks nothing");
});

test("door probes run in their own standing lane, not inside the publish-now pass", () => {
  const lane = doorProbesLane(async () => undefined);
  assert.equal(lane.id, "door-probes", "the breaker, Admin's pause and release and the meter rows keep the name");
  assert.ok(lane.budgetMs >= 60 * MINUTE && lane.everyMs <= MINUTE);
  assert.match(runnerSource, /doorProbesLane\(runDoorProbes\)/);
  assert.match(runnerFunction("runDoorProbes"), /if \(!jobLaunchAllowed\(DOOR_PROBES_JOB\.id\)\) return;/);
  assert.match(runnerFunction("runDoorProbes"), /admitted: \(\) => !runtimeAdmissionsHeld && admitJobLaunch\(DOOR_PROBES_JOB\.id\)/);
  const turn = readFileSync("lib/doors/probe-lane.ts", "utf8");
  assert.match(turn, /withDatabaseJob\(DOOR_PROBES_JOB\.id/);
  assert.match(turn, /readRunnerDoors\(repos\.doors, \["status"\], "OPEN", "probes"\)/);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.doesNotMatch(runner, /runHourlyProbes|ROUTINE_JOBS\.doorProbes|hotMeetingPartitions/);
});
