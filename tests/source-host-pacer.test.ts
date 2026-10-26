import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSourceHostPacer, sourceFetch, sourceHost, SourceReadDeferred } from "../lib/sources/http.ts";
import { fileHostState, memoryHostState } from "../lib/sources/host-state.ts";
import { captureSourceAcquisitions } from "../lib/sources/acquisition-trace.ts";
import { sourceTransportRoot, nativeSourceFetch, trackSourceTransport } from "../lib/sources/host-transport.ts";
import { diggerMeasurement } from "../scripts/lib/digger-measurement.ts";
import { retainMeetingFetchBytes } from "../lib/civic-data/retained-meeting-bytes.ts";

test("capture and measurement wrappers retain the production transport and one cooldown across passes", async () => {
  const wrapper = trackSourceTransport(async () => new Response("unused"), nativeSourceFetch);
  assert.equal(sourceTransportRoot(wrapper), nativeSourceFetch);
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 429, headers: { "retry-after": "180" } }); };
  const pass = (url: string) => retainMeetingFetchBytes(() => diggerMeasurement("calendar", true).read(() =>
    captureSourceAcquisitions(run => run("civicplus", () => sourceFetch(url)))));
  try {
    await assert.rejects(pass("https://one.gov/AgendaCenter"), SourceReadDeferred);
    await assert.rejects(pass("https://two.gov/AgendaCenter"), SourceReadDeferred);
    assert.equal(calls, 1, "a new capture pass must not create a new host clock");
  } finally { globalThis.fetch = original; }
});

for (const vendor of ["civicplus", "legistar", "civicclerk", "granicus", "boarddocs"]) test(`${vendor} tenants share one server's pace`, async () => {
  let now = Date.parse("2026-10-26T05:00:00Z");
  const calls: number[] = [];
  const pacer = createSourceHostPacer({ store: memoryHostState(), clock: () => now, sleep: async ms => { now += ms; } });
  const fetchImpl: typeof fetch = async () => { calls.push(now); return new Response("calendar"); };
  await Promise.all([pacer.fetch(`https://one.${vendor}.com/calendar`, {}, fetchImpl), pacer.fetch(`https://two.${vendor}.com/calendar`, {}, fetchImpl)]);
  assert.equal(calls.length, 2);
  assert.ok(calls[1]! - calls[0]! >= (vendor === "legistar" || vendor === "civicplus" ? 2000 : 400));
  assert.equal(sourceHost("https://a.gov/AgendaCenter"), "civicplus");
});

for (const retry of ["180", "Mon, 26 Oct 2026 05:03:00 GMT"]) test(`429 is deferred across readers until Retry-After ${retry}`, async () => {
  let now = Date.parse("2026-10-26T05:00:00Z");
  const store = memoryHostState();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls++; return calls === 1 ? new Response(null, { status: 429, headers: { "retry-after": retry } }) : new Response("calendar"); };
  const options = { store, clock: () => now, sleep: async (ms: number) => { now += ms; } };
  await assert.rejects(createSourceHostPacer(options).fetch("https://one.gov/AgendaCenter", {}, fetchImpl), (e: unknown) => e instanceof SourceReadDeferred && e.until === now + 180000);
  await assert.rejects(createSourceHostPacer(options).fetch("https://two.gov/AgendaCenter", {}, fetchImpl), SourceReadDeferred);
  assert.equal(calls, 1, "another town did not re-ask the shared server");
  now += 180000;
  const fresh = createSourceHostPacer(options);
  await fresh.fetch("https://two.gov/AgendaCenter", {}, fetchImpl);
  const sent = now;
  await fresh.fetch("https://three.gov/AgendaCenter", {}, fetchImpl);
  assert.equal(now - sent, 4000, "the server remains slower after the cooldown");
});

test("a named refusal stops that website; one refused Legistar sitting does not stop the others", async () => {
  const pacer = createSourceHostPacer({ store: memoryHostState(), spacingMs: 0 });
  let calls = 0;
  const fetchImpl: typeof fetch = async () => new Response(String(++calls), { status: calls === 1 ? 403 : 200 });
  await pacer.fetch("https://kearsarge.org/schedule", {}, fetchImpl);
  await assert.rejects(pacer.fetch("https://kearsarge.org/other-page", {}, fetchImpl), SourceReadDeferred);
  assert.equal(calls, 1);
  calls = 0;
  await pacer.fetch("https://webapi.legistar.com/v1/elpasotexas/events/2563/eventitems", {}, fetchImpl);
  await pacer.fetch("https://webapi.legistar.com/v1/elpasotexas/events/2564/eventitems", {}, fetchImpl);
  assert.equal(calls, 2);
  calls = 0;
  await pacer.fetch("https://city.gov/calendar/day/20260917", {}, fetchImpl);
  await pacer.fetch("https://city.gov/calendar/day/20261012", {}, fetchImpl);
  assert.equal(calls, 2, "a refused dated sitting is not a refusal of the whole calendar");
});

test("documented provider quotas use the same host clock and never enter the HTTP request", async () => {
  let now = 0;
  const sent: number[] = [];
  const pacer = createSourceHostPacer({ store: memoryHostState(), clock: () => now, sleep: async ms => { now += ms; } });
  const read: typeof fetch = async (_url, init) => {
    assert.equal('minimumSpacingMs' in (init ?? {}), false);
    sent.push(now); return new Response("calendar");
  };
  await pacer.fetch("https://api.govinfo.gov/one", { minimumSpacingMs: 3600 }, read);
  await pacer.fetch("https://api.govinfo.gov/two", { minimumSpacingMs: 3600 }, read);
  await pacer.fetch("https://api.govinfo.gov/three", { minimumSpacingMs: 720 }, read);
  assert.deepEqual(sent, [0, 3600, 4320]);
});

test("a transport failure still spaces the next tenant's request", async () => {
  let now = 0;
  const pacer = createSourceHostPacer({ store: memoryHostState(), clock: () => now, sleep: async ms => { now += ms; } });
  await assert.rejects(pacer.fetch("https://one.civicplus.com/", {}, async () => { throw new TypeError("connection closed"); }));
  await pacer.fetch("https://two.civicplus.com/", {}, async () => new Response("calendar"));
  assert.equal(now, 2000);
});

test("host cooldown and named refusals survive a reader restart without database requests", async () => {
  const root = await mkdtemp(join(tmpdir(), "mt02-pacer-"));
  try {
    let calls = 0;
    const read: typeof fetch = async () => { calls++; return new Response(null, { status: 429 }); };
    await assert.rejects(createSourceHostPacer({ store: fileHostState(root) }).fetch("https://one.gov/AgendaCenter", {}, read), SourceReadDeferred);
    await assert.rejects(createSourceHostPacer({ store: fileHostState(root) }).fetch("https://two.gov/AgendaCenter", {}, read), SourceReadDeferred);
    assert.equal(calls, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("802 CivicPlus bodies' two calendar reads spread across the hour on one vendor clock", async () => {
  let now = 0;
  const quarters = [0, 0, 0, 0];
  const read: typeof fetch = async () => { quarters[Math.min(3, Math.floor(now / 900000))]!++; return new Response("calendar"); };
  const pacer = createSourceHostPacer({ store: memoryHostState(), clock: () => now, sleep: async ms => { now += ms; } });
  for (let i = 0; i < 802; i++) for (const route of ["/AgendaCenter", "/common/modules/iCalendar/feed.ics"]) {
    await pacer.fetch(`https://town-${i}.gov${route}`, {}, read);
  }
  assert.ok(now <= 3600000);
  assert.ok(quarters.every(n => n > 100), String(quarters));
  assert.equal(quarters.reduce((a,b) => a+b,0), 1604);
});
