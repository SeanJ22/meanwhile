/**
 * A method that starts working is queued wherever the same kind of website
 * is: free tries everywhere, paid tries only inside places Sean has sent money
 * to and only as many as the budget dial leaves. Every worker in a queued place
 * then sees the method with where it worked.
 */
import assert from "node:assert/strict";
import test from "node:test";

import type { DoorRecord } from "../lib/doors/registry.ts";
import type { BudgetScope } from "../lib/control-plane/expansion/membership.ts";
import { newFieldManualEntry, readFieldManual, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { planSpread } from "../lib/method/spread.ts";
import { runSpreadPass, sentMoneyPlaces } from "../lib/method/spread-pass.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

const NOW = "2026-10-07T12:00:00.000Z";
const PIMA = "ocd-division/country:us/state:az/county:pima";
const MARICOPA = "ocd-division/country:us/state:az/county:maricopa";
const MORRIS = "ocd-division/country:us/state:nj/county:morris";
const LA = "ocd-division/country:us/state:ca/county:los_angeles";
const TUCSON = "ocd-division/country:us/state:az/place:tucson";

const door = (doorId: string, ocdId: string, kind: string, host: string): DoorRecord =>
  ({ doorId, kind, ocdId, hosts: [host], status: "OPEN", bodyIds: [], holds: ["meetings"] }) as unknown as DoorRecord;
const DOORS = [
  door("d-pima", PIMA, "legistar", "pima.legistar.com"), door("d-maricopa", MARICOPA, "legistar", "maricopa.legistar.com"),
  door("d-morris", MORRIS, "legistar", "morris.legistar.com"), door("d-la", LA, "legistar", "lacounty.legistar.com"),
  door("d-tucson", TUCSON, "civicplus", "tucsonaz.gov"),
];
const works = (methodId: string, placeId: string, at = NOW): FixMapRow =>
  ({ methodId, placeId, state: "WORKS", triedAt: at, attemptId: `a-${placeId}`, cause: null, updatedAt: at });

test("free tries go to every matching place; paid tries only inside a Send and within the dial", () => {
  const plan = planSpread({ method: { methodId: "m", doorKind: "legistar", platforms: ["legistar"] }, doors: DOORS,
    fixMapRows: [works("m", PIMA)], sendPlaceIds: new Set([MARICOPA, LA]), paidTriesLeft: 1 });
  assert.equal(plan.matching, 4);
  assert.equal(plan.alreadyTried, 1, "the place it worked in is not queued again");
  assert.deepEqual([...plan.plain.map((p) => p.placeId)].sort(), [LA, MARICOPA, MORRIS].sort());
  assert.equal(plan.paid.length, 1);
  assert.ok([MARICOPA, LA].includes(plan.paid[0]!.placeId));
  assert.deepEqual(plan.paidSkipped.map((s) => s.reason).sort(), ["the budget dial leaves no paid tries this round", "this place is not inside a Send"]);
});

test("the places Sean has sent money to: members of a Send, and of an area with a budget", () => {
  const area = (members: string[], budgetUsd: number, resolved = true) =>
    ({ key: "k", label: "l", budgetUsd, resolved, members: new Set(members), states: ["AZ"], historicalUsd: 0 }) as BudgetScope;
  const sends = { byKey: new Map([["send:1", { created: new Map([["o1", { obligationId: "o1", subjectId: `${MORRIS}#governing`, joinedAt: NOW }]]), reordered: new Map() }]]),
    byInstruction: new Map(), keysOf: new Map(), refsOf: new Map() };
  const places = sentMoneyPlaces({ areas: [area([MARICOPA], 5), area([LA], 0), area([TUCSON], 5, false)], sends });
  assert.deepEqual([...places].sort(), [MARICOPA, MORRIS].sort());
});

test("a method that starts working is queued elsewhere, and a worker there sees it with where it worked", async () => {
  const repos = createMemoryRepositories();
  const method = newFieldManualEntry("door-method", "legistar|meetings|get", { role: "SHARED", kind: "METHOD", title: "legistar: meetings",
    summary: "GET {door}/events", outcome: "YIELDED", platforms: ["legistar"], recordClasses: ["meetings"], observedAt: NOW,
    payload: { platform: "legistar", recordClass: "meetings", procedure: "GET {door}/events", places: [PIMA], doorEntryIds: [] } });
  await writeFieldManual(repos, [method], NOW);
  assert.equal((await repos.fixMap.forPlace(PIMA))[0]!.state, "WORKS", "saving the method recorded where it worked");
  for (const d of DOORS) await repos.doors.put(d.doorId, d, NOW);
  const result = await runSpreadPass({ repos, since: "2026-10-07T00:00:00.000Z", now: NOW, sendPlaceIds: new Set([MARICOPA]), paidTriesLeft: 5 });
  assert.deepEqual(result, { methods: 1, free: 2, paid: 1, paidSkipped: 2 });
  const queued = await repos.fixMap.forPlace(MORRIS);
  assert.equal(queued[0]!.state, "UNTRIED");
  assert.match(queued[0]!.cause!, /Queued: it worked in .*county:pima.*a free try/);
  assert.match((await repos.fixMap.forPlace(MARICOPA))[0]!.cause!, /a paid try is allowed here/);
  assert.equal((await repos.fixMap.forPlace(TUCSON)).length, 0, "a different kind of website is not queued");
  const page = await readFieldManual(repos, { role: "SCOUT", ocdIds: [MORRIS], recordClass: "meetings" });
  assert.match(page.projection.lines.find((l) => l.includes("legistar: meetings"))!, /\[untried here: try it and record the result; worked in pima AZ\]/);
  const again = await runSpreadPass({ repos, since: "2026-10-07T00:00:00.000Z", now: NOW, sendPlaceIds: new Set([MARICOPA]), paidTriesLeft: 5 });
  assert.equal((await repos.fixMap.forPlace(MORRIS)).length, 1, "a second pass queues no second row");
  assert.equal(again.methods, 1);
});
