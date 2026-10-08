/**
 * A method that works somewhere is tried, by plain code, wherever the same
 * kind of website is: the free try runs at every matching place, paced for
 * small publishers, with robots.txt recorded and never obeyed as a block. Its
 * result goes into the fix map, the method's standing in Admin and the field
 * manual. A paid try is allowed only where the free try could not decide,
 * inside places the owner has sent money to and within the budget dial.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { DoorRecord } from "../lib/doors/registry.ts";
import type { ProbeFetch } from "../lib/doors/probe.ts";
import type { BudgetScope } from "../lib/control-plane/expansion/membership.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { methodStandings } from "../lib/control-plane/fix-standing.ts";
import { ADMIN_CONFIG_ID, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import { recordScoutMethods, scoutFieldManualQuery } from "../lib/control-plane/scheduler/field-manual-scout.ts";
import { plainTrier, replayUrl } from "../lib/method/method-try.ts";
import { memoryWebsitePacing } from "../lib/control-plane/website-pacing.ts";
import { planSpread, SPREAD_ATTEMPT } from "../lib/method/spread.ts";
import { runSpreadPass, sentMoneyPlaces, spreadLine } from "../lib/method/spread-pass.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

const NOW = "2026-10-07T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const MARICOPA = "ocd-division/country:us/state:az/county:maricopa";
const MORRIS = "ocd-division/country:us/state:nj/county:morris";
const LA = "ocd-division/country:us/state:ca/county:los_angeles";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";

const door = (doorId: string, ocdId: string, kind: string, host: string, config: Record<string, string> = {}): DoorRecord =>
  ({ doorId, kind, ocdId, hosts: [host], status: "OPEN", bodyIds: [], holds: ["meetings"], config }) as unknown as DoorRecord;
const DOORS = [
  door("d-pima", PIMA, "legistar", "pima.legistar.com"), door("d-maricopa", MARICOPA, "legistar", "maricopa.legistar.com"),
  door("d-morris", MORRIS, "legistar", "morris.legistar.com"), door("d-la", LA, "legistar", "lacounty.legistar.com"),
  door("d-tucson", TUCSON, "civicplus", "tucsonaz.gov"),
];
const works = (methodId: string, placeId: string, at = NOW): FixMapRow =>
  ({ methodId, placeId, state: "WORKS", triedAt: at, attemptId: `a-${placeId}`, cause: null, updatedAt: at });
const plainTried = (methodId: string, placeId: string): FixMapRow =>
  ({ methodId, placeId, state: "UNTRIED", triedAt: null, attemptId: SPREAD_ATTEMPT.PLAIN_TRIED, cause: "x", updatedAt: NOW });

/** A website double: each address answers what the table says; anything else is a 404. Every request is kept. */
function websites(table: Record<string, { status: number; body?: string; retryAfter?: string }>) {
  const calls: string[] = [];
  const fetch: ProbeFetch = async (url) => {
    calls.push(url);
    const hit = table[url] ?? { status: 404 };
    return { status: hit.status, headers: { get: (name: string) => (name === "retry-after" ? hit.retryAfter ?? null : null) },
      bytes: async () => new TextEncoder().encode(hit.body ?? "") };
  };
  return { fetch, calls };
}

test("free tries go to every matching place; paid tries only where the free try could not decide, inside a Send and within the dial", () => {
  const first = planSpread({ method: { methodId: "m", doorKind: "legistar", platforms: ["legistar"] }, doors: DOORS,
    fixMapRows: [works("m", PIMA)], sendPlaceIds: new Set([MARICOPA, LA]), paidTriesLeft: 5 });
  assert.equal(first.matching, 4);
  assert.equal(first.alreadyTried, 1, "the place it worked in is not tried again");
  assert.deepEqual(first.plain.map((p) => p.placeId).sort(), [LA, MARICOPA, MORRIS].sort());
  assert.equal(first.paid.length, 0, "nothing is paid for before the free try has run");
  const after = planSpread({ method: { methodId: "m", doorKind: "legistar", platforms: ["legistar"] }, doors: DOORS,
    fixMapRows: [works("m", PIMA), plainTried("m", MARICOPA), plainTried("m", LA), plainTried("m", MORRIS)], sendPlaceIds: new Set([MARICOPA, LA]), paidTriesLeft: 1 });
  assert.equal(after.plain.length, 0, "a free try that ran is not run again");
  assert.equal(after.paid.length, 1);
  assert.ok([MARICOPA, LA].includes(after.paid[0]!.placeId));
  assert.deepEqual(after.paidSkipped.map((s) => s.reason).sort(), ["the budget dial leaves no paid tries this round", "this place is not inside a Send"]);
});

test("the places the owner has sent money to: members of a Send, and of an area with a budget", () => {
  const area = (members: string[], budgetUsd: number, resolved = true) =>
    ({ key: "k", label: "l", budgetUsd, resolved, members: new Set(members), states: ["AZ"], historicalUsd: 0 }) as BudgetScope;
  const sends = { byKey: new Map([["send:1", { created: new Map([["o1", { obligationId: "o1", subjectId: `${MORRIS}#governing`, joinedAt: NOW }]]), reordered: new Map() }]]),
    byInstruction: new Map(), keysOf: new Map(), refsOf: new Map() };
  const places = sentMoneyPlaces({ areas: [area([MARICOPA], 5), area([LA], 0), area([TUCSON], 5, false)], sends });
  assert.deepEqual([...places].sort(), [MARICOPA, MORRIS].sort());
});

test("the replayed request is the procedure's own, at this place's door", () => {
  const d = door("d", MARICOPA, "legistar", "maricopa.legistar.com", { feedUrl: "https://maricopa.legistar.com/Feed.ashx" });
  assert.equal(replayUrl("GET {door}?M=Calendar then read rows", d), "https://maricopa.legistar.com/Feed.ashx?M=Calendar");
  assert.equal(replayUrl("GET https://{host}/api/events.", d), "https://maricopa.legistar.com/api/events");
  assert.equal(replayUrl("GET {door}/<client>/events", d), null, "a part only a worker could fill");
  assert.equal(replayUrl("read the hydration payload, then call the API the page calls", d), null);
});

test("a working method is tried by plain code at every matching place, and every result is recorded where Admin and workers read it", async () => {
  const repos = createMemoryRepositories();
  const method = newFieldManualEntry("door-method", "legistar|meetings|get", { role: "SHARED", kind: "METHOD", title: "legistar: meetings",
    summary: "GET {door}/events", outcome: "YIELDED", platforms: ["legistar"], recordClasses: ["meetings"], observedAt: NOW,
    payload: { platform: "legistar", recordClass: "meetings", procedure: "GET {door}/events", places: [PIMA], doorEntryIds: [] } });
  await writeFieldManual(repos, [method], NOW);
  assert.equal((await repos.fixMap.forPlace(PIMA))[0]!.state, "WORKS", "saving the method recorded where it worked");
  for (const d of DOORS) await repos.doors.put(d.doorId, d, NOW);
  const site = websites({
    "https://maricopa.legistar.com/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n" },
    "https://maricopa.legistar.com/events": { status: 200, body: "<html>Calendar rows</html>" },
    "https://morris.legistar.com/robots.txt": { status: 404 },
    "https://lacounty.legistar.com/robots.txt": { status: 404 },
    "https://lacounty.legistar.com/events": { status: 503, retryAfter: "120" },
  });
  const result = await runSpreadPass({ repos, now: NOW, sendPlaceIds: new Set([MARICOPA, MORRIS]), paidTriesLeft: 5, fetch: site.fetch });
  assert.deepEqual(result.tried, { works: 1, fails: 1, undecided: 0 });
  assert.equal(result.waiting, 1);
  assert.equal(result.robots.DISALLOWED, 1, "robots.txt said no; it is recorded and the request was still made");
  assert.ok(site.calls.includes("https://maricopa.legistar.com/events"));
  assert.equal(site.calls.some((url) => url.includes("tucsonaz.gov")), false, "a different kind of website is not tried");

  const at = async (placeId: string) => (await repos.fixMap.forPlace(placeId)).find((row) => row.methodId === method.id)!;
  assert.equal((await at(MARICOPA)).state, "WORKS");
  assert.equal((await at(MORRIS)).state, "FAILS");
  assert.match((await at(MORRIS)).cause!, /answered 404 here/);
  assert.equal((await at(LA)).state, "UNTRIED");
  assert.equal((await at(LA)).attemptId, SPREAD_ATTEMPT.QUEUED);
  assert.match((await at(LA)).cause!, /answered 503; every reader leaves it alone until /);
  assert.ok(((await repos.websitePacing.heldUntil(Date.now())).get("lacounty.legistar.com") ?? 0) >= Date.now() + 110_000, "its Retry-After holds the website for every reader");

  const saved = (await repos.fieldManual.read(method.id))!.value;
  assert.deepEqual(saved.placeResults!.filter((r) => r.place.startsWith("ocd-division/") && r.place !== PIMA).map((r) => [r.place, r.outcome]).sort(), [[MARICOPA, "YIELDED"], [MORRIS, "FAILED"]].sort());
  const config = (await repos.adminConfig.read(ADMIN_CONFIG_ID))!.value as AdminConfig;
  assert.ok(methodStandings(config).some((s) => s.methodId === method.id), "the method's standing in Admin is re-measured");
  assert.match(spreadLine(result), /^1 working method\(s\) tried elsewhere by plain code: 1 worked, 1 did not fit, 0 left for a worker, 1 waiting/);

  const page = await readFieldManual(repos, { role: "SCOUT", ocdIds: [MORRIS], recordClass: "meetings" });
  assert.equal(page.projection.lines.some((l) => l.includes("legistar: meetings")), false, "a method that failed in this place is skipped here");
  const there = await readFieldManual(repos, { role: "SCOUT", ocdIds: [MARICOPA], recordClass: "meetings" });
  assert.match(there.projection.lines.find((l) => l.includes("legistar: meetings"))!, /\[works here\]/);

  const again = await runSpreadPass({ repos, now: "2026-10-07T13:00:00.000Z", sendPlaceIds: new Set([MARICOPA, MORRIS]), paidTriesLeft: 5, fetch: site.fetch });
  assert.deepEqual(again.tried, { works: 0, fails: 0, undecided: 0 }, "a place with a result is not tried again; the one backing off waits again");
  assert.equal(again.waiting, 1);
});

test("a method that is not a plain request is checked for its platform and left for a worker; a paid try follows only inside a Send", async () => {
  const repos = createMemoryRepositories();
  const method = newFieldManualEntry("route", "hydration", { role: "SCOUT", kind: "ROUTE", title: "read the hydration payload", summary: "read the payload, then call the API",
    outcome: "YIELDED", platforms: ["legistar"], recordClasses: [], observedAt: NOW, payload: { outcomes: [{ jurisdiction: PIMA, outcome: "YIELDED", observedOn: "2026-10-01" }] } });
  await writeFieldManual(repos, [method], NOW);
  for (const d of DOORS.slice(0, 3)) await repos.doors.put(d.doorId, d, NOW);
  const site = websites({ "https://maricopa.legistar.com/": { status: 200, body: "<html>calendar</html>" }, "https://morris.legistar.com/": { status: 200, body: "<html>x</html>" } });
  const first = await runSpreadPass({ repos, now: NOW, sendPlaceIds: new Set([MARICOPA]), paidTriesLeft: 5, fetch: site.fetch });
  assert.deepEqual([first.tried.undecided, first.paid], [2, 0]);
  const row = (await repos.fixMap.forPlace(MARICOPA))[0]!;
  assert.equal(row.attemptId, SPREAD_ATTEMPT.PLAIN_TRIED);
  assert.match(row.cause!, /Tried by plain code: this website is on legistar like where it worked; the method is not a plain request, so it waits for a worker/);
  const second = await runSpreadPass({ repos, now: "2026-10-07T13:00:00.000Z", sendPlaceIds: new Set([MARICOPA]), paidTriesLeft: 5, fetch: site.fetch });
  assert.deepEqual([second.tried.undecided, second.paid, second.paidSkipped], [0, 1, 1]);
  assert.match((await repos.fixMap.forPlace(MARICOPA))[0]!.cause!, /a paid try is allowed here/);
  assert.equal((await repos.fixMap.forPlace(MORRIS))[0]!.attemptId, SPREAD_ATTEMPT.PLAIN_TRIED, "outside a Send, no paid try");
  const page = await readFieldManual(repos, { role: "SCOUT", ocdIds: [MARICOPA] });
  assert.match(page.projection.lines.find((l) => l.includes("hydration"))!, /\[untried here: try it and record the result; worked in pima AZ\]/);
});

test("a Scout whose subject is not a division reads and records at the divisions its obligation covers, so the spread has somewhere to start", async () => {
  const repos = createMemoryRepositories();
  const method = newFieldManualEntry("door-method", "legistar|meetings|get", { role: "SHARED", kind: "METHOD", title: "legistar: meetings", summary: "GET {door}",
    outcome: "YIELDED", platforms: ["legistar"], recordClasses: ["meetings"], observedAt: NOW, payload: { procedure: "GET {door}" } });
  const subjectId = "az:2026:state-az-sldl-7:state-representative-district-7:someone";
  assert.deepEqual(scoutFieldManualQuery({ subjectId, divisions: [MARICOPA, "not-a-division"] }).ocdIds, [MARICOPA]);
  const result = { attemptId: "at-1", outcome: "ROUTE_CANDIDATE", refusal: null, researchRole: "SCOUT", unverified: [], recordedAt: NOW, subjectId,
    knowledgeReads: [{ kind: "MANUAL_ENTRY", id: method.id, contentHash: "h", offset: 0, length: 1 }] } as unknown as ScoutResult;
  assert.equal(await recordScoutMethods(repos, result, { entries: [method] }, [MARICOPA]), null);
  assert.equal((await repos.fixMap.forPlace(MARICOPA))[0]!.state, "WORKS");
  assert.equal(await recordScoutMethods(repos, { ...result, attemptId: "at-2" }, { entries: [method] }), null, "no division, nothing recorded");
  assert.equal((await repos.fixMap.workingMethods(10)).length, 1);
});

test("free tries share the hourly count and the holds every reader uses: across rounds, and with every other reader", async () => {
  const pacing = memoryWebsitePacing();
  let clock = Date.parse(NOW);
  const now = () => clock;
  const small = () => ({ kind: "local-government", population: 4_000 }) as never;
  const site = websites({ "https://smalltown.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /\n" } });
  const method = newFieldManualEntry("m", "m", { role: "SHARED", kind: "METHOD", title: "m", summary: "GET {door}", outcome: "YIELDED", platforms: [], recordClasses: [],
    observedAt: NOW, payload: { procedure: "GET {door}" } });
  const at = (i: number, host = "smalltown.gov") => door(`d${i}`, `${TUCSON}-${i}`, "page", host, { url: `https://${host}/p${i}` });

  // Another reader took four of the website's ten this hour.
  for (let i = 0; i < 4; i += 1) assert.deepEqual(await pacing.take("smalltown.gov", 10, clock), { ok: true });
  const trier = plainTrier({ fetch: site.fetch, sizeFor: small, pacing, now });
  const outcomes: string[] = [];
  for (let i = 0; i < 8; i += 1) outcomes.push((await trier.tryAt(method, at(i), "door kind")).outcome);
  assert.equal(site.calls.length, 6, "robots.txt and five pages: ten in the hour with the other reader's four");
  assert.equal(site.calls.filter((url) => url.endsWith("/robots.txt")).length, 1, "robots.txt is read once per website");
  assert.deepEqual(outcomes.slice(5), ["WAITING", "WAITING", "WAITING"]);
  assert.match((await trier.tryAt(method, at(9), "door kind")).note, /^this small publisher's hourly allowance is used; the try waits until /);
  assert.deepEqual((await pacing.take("smalltown.gov", 10, clock)).ok, false, "and the free tries counted for every other reader");

  // The next round in the same hour makes no request; an hour later it does.
  const nextRound = plainTrier({ fetch: site.fetch, sizeFor: small, pacing, now });
  assert.equal((await nextRound.tryAt(method, at(10), "door kind")).outcome, "WAITING");
  assert.equal(site.calls.length, 6);
  clock += 3_600_000;
  await plainTrier({ fetch: site.fetch, sizeFor: small, pacing, now }).tryAt(method, at(11), "door kind");
  assert.equal(site.calls.length, 8);

  // A 429 a free try gets holds the website for every reader; a hold another reader recorded holds the free tries.
  const busy = websites({ "https://busy.gov/p1": { status: 429, retryAfter: "1800" } });
  const tryBusy = plainTrier({ fetch: busy.fetch, pacing, now });
  const held = await tryBusy.tryAt(method, at(1, "busy.gov"), "door kind");
  assert.equal(held.outcome, "WAITING");
  assert.match(held.note, /^the website answered 429; every reader leaves it alone until /);
  assert.equal((await pacing.heldUntil(clock)).get("busy.gov"), clock + 1_800_000);
  assert.equal((await tryBusy.tryAt(method, at(2, "busy.gov"), "door kind")).outcome, "WAITING");
  assert.equal(busy.calls.filter((u) => !u.endsWith("/robots.txt")).length, 1, "the rest of that website is not asked");
  await pacing.hold("flaky.gov", clock + 60_000, clock);
  const flaky = websites({});
  const out = await plainTrier({ fetch: flaky.fetch, pacing, now }).tryAt(method, at(3, "flaky.gov"), "door kind");
  assert.match(out.note, /^the website asked us to wait; tried again after /);
  assert.equal(flaky.calls.length, 0);
});
