import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publishNowDoorTasks } from "@/lib/civic-data/publish-now.ts";
import type { RoutineSourceTask } from "@/lib/civic-data/runner.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { planProbes, runHourlyProbes } from "@/lib/doors/hourly-check.ts";
import { pacedProbeFetch } from "@/lib/doors/probe-fetch.ts";
import { memoryWebsitePacing } from "@/lib/control-plane/website-pacing.ts";
import type { ProbeFetch } from "@/lib/doors/probe.ts";
import { applyManualEdit, checkDoorDraft, type DoorRecord } from "@/lib/doors/registry.ts";

const AT = (minutes: number) => new Date(Date.parse("2026-10-06T12:00:00.000Z") + minutes * 60_000).toISOString();

function door(id: string, url: string, host = "city.example.gov"): DoorRecord {
  const meeting = { agendaSourceType: "ICAL", jurisdiction: "Example", publishingOrg: "Example City", timeZone: "America/Phoenix", verifiedAt: "2026-09-01" };
  const c = checkDoorDraft({ doorId: id, kind: "ical", hosts: [host], config: { feedUrl: url }, holds: ["meetings"], meeting });
  if (!c.ok) throw new Error(c.why);
  return applyManualEdit(null, c.value, AT(-600));
}

const HOT = new Set(["hot-a", "hot-b"]);

test("DB-26: only a hot door is looked at, and only when its hour is nearly up", () => {
  const hot = door("hot-a", "https://city.example.gov/a.ics");
  const cold = door("cold-a", "https://city.example.gov/b.ics");
  assert.deepEqual(planProbes([hot, cold], HOT, AT(0)).doors.map((d) => d.doorId), ["hot-a"], "never looked at: due; the cold door waits for its twice-daily check");
  const looked = { ...hot, validators: { etag: null, lastModified: null, contentHash: "h", checkedAt: AT(-30), changedAt: null } };
  assert.equal(planProbes([looked], HOT, AT(0)).doors.length, 0, "looked at 30 minutes ago: not due");
  assert.equal(planProbes([looked], HOT, AT(26)).doors.length, 1, "56 minutes on: due, so the check lands on the hour");
});

/** A website double behind the shared paced fetch, on the test's clock. */
function pacedSite(pacing = memoryWebsitePacing(), small = (_url: string) => true, status = 200) {
  const asked: string[] = [];
  let clock = Date.parse(AT(0));
  const fetchImpl = (async (url: string) => { asked.push(url); return new Response("ok", { status }); }) as unknown as typeof fetch;
  const fetchFn = pacedProbeFetch({ pacing, fetchImpl, sleep: async () => {}, clock: () => clock,
    sizeFor: (url) => (small(url) ? { kind: "local-government", population: 4_000 } : { kind: "local-government", population: 500_000 }) });
  return { fetchFn, asked, at: (minutes: number) => { clock = Date.parse(AT(minutes)); return AT(minutes); } };
}

test("DB-26: a small government is never asked for more than ten requests an hour, counted with every other reader", async () => {
  const repos = createMemoryRepositories();
  const doors = Array.from({ length: 14 }, (_, i) => door(`hot-${i}`, `https://city.example.gov/${i}.ics`));
  for (const d of doors) await repos.doors.put(d.doorId, d, AT(-600));
  const hot = new Set(doors.map((d) => d.doorId));
  const pacing = memoryWebsitePacing();
  await pacing.take("city.example.gov", 10, Date.parse(AT(0)));
  const site = pacedSite(pacing);
  const first = await runHourlyProbes(repos.doors, doors, hot, site.fetchFn, site.at(0));
  assert.equal(site.asked.length, 9, "another reader's request leaves nine");
  assert.equal(first.waiting, 5);
  const listed = (await repos.doors.list()).map((row) => row.value);
  const next = await runHourlyProbes(repos.doors, listed, hot, site.fetchFn, site.at(1));
  assert.equal(next.looked, 0, "the next minute asks nothing more until the hour turns");
  assert.equal(site.asked.length, 9);
  const before = site.asked.length;
  const later = await runHourlyProbes(repos.doors, (await repos.doors.list()).map((row) => row.value), hot, site.fetchFn, site.at(61));
  assert.equal(later.looked, 10, "the hour turned: ten more, never eleven");
  const waited = site.asked.slice(before);
  for (const i of [5, 6, 7, 8, 9]) assert.ok(waited.includes(`https://city.example.gov/${i}.ics`), "the doors that waited go first");
  // Two doors behind one feed are one request.
  const shared = [door("hot-a", "https://city.example.gov/x.ics"), door("hot-b", "https://city.example.gov/x.ics")];
  assert.equal(planProbes(shared, HOT, AT(0)).doors.length, 2);
});

test("DB-26: a larger government is looked at in full, and a 503 holds the website for every reader", async () => {
  const repos = createMemoryRepositories();
  const doors = Array.from({ length: 27 }, (_, i) => door(`hot-${i}`, `https://clerks.example.gov/${i}.ics`, "clerks.example.gov"));
  const hot = new Set(doors.map((d) => d.doorId));
  const big = pacedSite(memoryWebsitePacing(), () => false);
  assert.equal((await runHourlyProbes(repos.doors, doors, hot, big.fetchFn, big.at(0))).waiting, 0);
  assert.equal(big.asked.length, 27, "no cap on a larger government's website");
  const pacing = memoryWebsitePacing();
  const down = pacedSite(pacing, () => false, 503);
  const report = await runHourlyProbes(repos.doors, doors.slice(0, 3), new Set(["hot-0", "hot-1", "hot-2"]), down.fetchFn, down.at(0));
  assert.deepEqual([report.failed, report.waiting, down.asked.length], [1, 2, 1], "after the 503 the website is left alone");
  assert.ok((await pacing.heldUntil(Date.parse(AT(0)))).has("clerks.example.gov"));
});

test("DB-26: a change the look sees is stored and the publish-now lane reads that door at once", async () => {
  const repos = createMemoryRepositories();
  const d = door("hot-a", "https://city.example.gov/a.ics");
  await repos.doors.put(d.doorId, d, AT(-600));
  let body = "agenda v1";
  const requests: string[] = [];
  const fetchFn: ProbeFetch = async (url) => { requests.push(url); return { status: 200, headers: { get: () => null }, bytes: async () => new TextEncoder().encode(body) }; };
  const tasks = [{ id: "hot-a" }] as RoutineSourceTask[];
  const doorsNow = async () => (await repos.doors.list()).map((row) => row.value);

  const first = await runHourlyProbes(repos.doors, await doorsNow(), HOT, fetchFn, AT(0));
  assert.equal(first.looked, 1);
  assert.equal(first.requests, 1);
  assert.equal(publishNowDoorTasks(await doorsNow(), tasks, AT(0)).length, 1, "a first look is a change: read it");
  // The read succeeds.
  const read = (await repos.doors.read("hot-a"))!;
  await repos.doors.compareAndSet("hot-a", read.revision, { ...read.value, lastSuccessAt: AT(2) }, AT(2));

  const quiet = await runHourlyProbes(repos.doors, await doorsNow(), HOT, fetchFn, AT(60));
  assert.equal(quiet.unchanged, 1);
  assert.equal(publishNowDoorTasks(await doorsNow(), tasks, AT(60)).length, 0, "the page is the same: nothing is read");

  // An agenda posted at 3:45 is read by the 4:00 look and is waiting for the publish-now lane that minute.
  body = "agenda v2";
  const found = await runHourlyProbes(repos.doors, await doorsNow(), HOT, fetchFn, AT(120));
  assert.equal(found.changed, 1);
  const pending = publishNowDoorTasks(await doorsNow(), tasks, AT(120));
  assert.equal(pending.length, 1);
  assert.equal(pending[0]!.ownerInvocation?.requestedAt, AT(120));
});

test("DB-26: a look that fails stores nothing and the door is looked at again", async () => {
  const repos = createMemoryRepositories();
  const d = door("hot-a", "https://city.example.gov/a.ics");
  await repos.doors.put(d.doorId, d, AT(-600));
  const failing: ProbeFetch = async () => ({ status: 503, headers: { get: () => null }, bytes: async () => new Uint8Array() });
  const report = await runHourlyProbes(repos.doors, [d], HOT, failing, AT(0));
  assert.equal(report.failed, 1);
  assert.equal((await repos.doors.read("hot-a"))!.value.validators ?? null, null);
  assert.equal(planProbes([d], HOT, AT(1)).doors.length, 1);
});

test("DB-26: the paced fetch identifies itself, waits between looks at one host, and probes always run", async () => {
  const seen: { url: string; ua: string | null }[] = [];
  const slept: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, ua: (init?.headers as Record<string, string>)["User-Agent"] ?? null });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  const paced = pacedProbeFetch({ pacing: memoryWebsitePacing(), fetchImpl, sleep: async (ms) => { slept.push(ms); } });
  await Promise.all([paced("https://a.example.gov/1", {}), paced("https://a.example.gov/2", {}), paced("https://b.example.gov/1", {})]);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => /we-the-people civic meeting index/.test(s.ua ?? "")));
  assert.equal(slept.length, 3);
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.match(runner, /runHourlyProbes\([\s\S]*pacedProbeFetch\(\{ pacing: repos\.websitePacing/);
  assert.doesNotMatch(runner, /WTP_DOOR_PROBES|doorProbesOn/);
});
