import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { publishNowDoorTasks } from "@/lib/civic-data/publish-now.ts";
import type { RoutineSourceTask } from "@/lib/civic-data/runner.ts";
import { createMemoryRepositories } from "@/lib/control-plane/repository/memory.ts";
import { doorProbesOn, planProbes, PROBE_HOST_HOURLY_LIMIT, runHourlyProbes } from "@/lib/doors/hourly-check.ts";
import { pacedProbeFetch } from "@/lib/doors/probe-fetch.ts";
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

test("DB-26: a small government is never asked for more than ten requests an hour", () => {
  const doors = Array.from({ length: 14 }, (_, i) => door(`hot-${i}`, `https://city.example.gov/${i}.ics`));
  const hot = new Set(doors.map((d) => d.doorId));
  const first = planProbes(doors, hot, AT(0));
  assert.equal(first.doors.length, PROBE_HOST_HOURLY_LIMIT);
  assert.equal(first.deferred, 4);
  // Those ten are now looked at; the next minute spends nothing more until the hour turns.
  const after = doors.map((d, i) => i < PROBE_HOST_HOURLY_LIMIT ? { ...d, validators: { etag: null, lastModified: null, contentHash: "h", checkedAt: AT(0), changedAt: null } } : d);
  assert.equal(planProbes(after, hot, AT(1)).doors.length, 0);
  // Two doors behind one feed are one request.
  const shared = [door("hot-a", "https://city.example.gov/x.ics"), door("hot-b", "https://city.example.gov/x.ics")];
  assert.equal(planProbes(shared, HOT, AT(0)).doors.length, 2);
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

test("DB-26: the paced fetch identifies itself, waits between looks at one host, and the switch is off by default", async () => {
  const seen: { url: string; ua: string | null }[] = [];
  const slept: number[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    seen.push({ url, ua: (init?.headers as Record<string, string>)["User-Agent"] ?? null });
    return new Response("ok", { status: 200 });
  }) as unknown as typeof fetch;
  const paced = pacedProbeFetch(fetchImpl, async (ms) => { slept.push(ms); });
  await Promise.all([paced("https://a.example.gov/1", {}), paced("https://a.example.gov/2", {}), paced("https://b.example.gov/1", {})]);
  assert.equal(seen.length, 3);
  assert.ok(seen.every((s) => /we-the-people civic meeting index/.test(s.ua ?? "")));
  assert.equal(slept.length, 3);
  assert.equal(doorProbesOn({}), false);
  assert.equal(doorProbesOn({ WTP_DOOR_PROBES: "on" }), true);
  assert.match(readFileSync("scripts/routine-civic-data-runner.mts", "utf8"), /if \(doorProbesOn\(\)\)[\s\S]*runHourlyProbes/);
});
