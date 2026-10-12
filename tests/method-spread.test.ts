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
import { pacedProbeFetch } from "../lib/doors/probe-fetch.ts";
import { memoryWebsitePacing, type WebsitePacing } from "../lib/control-plane/website-pacing.ts";
import type { WebsiteSizeForUrl } from "../lib/control-plane/scheduler/host-supervision.ts";
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

/**
 * A website double behind the shared paced fetch: each address answers what the table says; anything else is a 404.
 * Every request that reached the website is kept.
 */
function websites(table: Record<string, { status: number; body?: string; retryAfter?: string }>,
  options: { readonly pacing?: WebsitePacing; readonly sizeFor?: WebsiteSizeForUrl } = {}) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    const hit = table[url] ?? { status: 404 };
    return new Response(hit.body ?? "", { status: hit.status, headers: hit.retryAfter ? { "retry-after": hit.retryAfter } : {} });
  }) as typeof globalThis.fetch;
  const paced: ProbeFetch = pacedProbeFetch({ pacing: options.pacing ?? memoryWebsitePacing(), ...(options.sizeFor ? { sizeFor: options.sizeFor } : {}),
    fetchImpl, sleep: async () => {}, clock: () => Date.parse(NOW) });
  return { fetch: paced, calls };
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
  assert.deepEqual(after.paidSkipped.map((s) => s.reason).sort(), ["the budget dial leaves no paid tries this round", "the owner has sent no money to this place (it is in no Send and no budgeted area)"]);
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
  assert.match((await at(LA)).cause!, /the website answered 503, so every reader leaves it alone for now/);

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

test("a small publisher gets at most ten requests an hour, counted with every other reader; robots.txt is read once per website", async () => {
  const pacing = memoryWebsitePacing();
  for (let i = 0; i < 4; i += 1) await pacing.take("smalltown.gov", 10, Date.parse(NOW));
  const site = websites({ "https://smalltown.gov/robots.txt": { status: 200, body: "User-agent: *\nAllow: /\n" } },
    { pacing, sizeFor: () => ({ kind: "local-government", population: 4_000 }) as never });
  const trier = plainTrier({ fetch: site.fetch });
  const method = newFieldManualEntry("m", "m", { role: "SHARED", kind: "METHOD", title: "m", summary: "GET {door}", outcome: "YIELDED", platforms: [], recordClasses: [],
    observedAt: NOW, payload: { procedure: "GET {door}" } });
  const outcomes: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const d = door(`d${i}`, `${TUCSON}-${i}`, "page", "smalltown.gov", { url: `https://smalltown.gov/p${i}` });
    outcomes.push((await trier.tryAt(method, d, "door kind")).outcome);
  }
  assert.equal(site.calls.length, 6, "four requests another reader made leave six: robots.txt and five pages");
  assert.equal(site.calls.filter((url) => url.endsWith("/robots.txt")).length, 1);
  assert.deepEqual(outcomes.slice(5), Array(7).fill("WAITING"));
});
