import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSourceHostPacer, sourceHost, SourceReadDeferred } from "../lib/sources/http.ts";
import { fileHostState, memoryHostState } from "../lib/sources/host-state.ts";

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
