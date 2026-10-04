import assert from "node:assert/strict";
import test from "node:test";

import type { DoorRecord } from "../lib/doors/registry.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";
import { planSpread } from "../lib/method/spread.ts";

const door = (n: number, over: Partial<DoorRecord> = {}): DoorRecord => ({
  formatVersion: 1, doorId: `d${n}`, kind: "ical", ocdId: `ocd-division/country:us/state:zz/place:p${n}`, bodyIds: [`b${n}`], hosts: [`h${n}.example.gov`], config: {}, holds: ["meetings"],
  checkEveryMinutes: null, notes: "", meeting: null, status: "OPEN", readNow: false, lastSuccessAt: null, lastFailureAt: null, validators: null, shutSince: null,
  origin: "DERIVED", editedAt: null, updatedAt: "2026-10-04T00:00:00Z", ...over,
});
const place = (n: number) => `ocd-division/country:us/state:zz/place:p${n}`;
const doors = [1, 2, 3, 4, 5, 6].map((n) => door(n, n === 5 ? { kind: "iqm2" } : n === 6 ? { status: "SHUT" } : {}));
const base = { method: { methodId: "m", doorKind: "ical" }, doors, fixMapRows: [] as FixMapRow[], sendPlaceIds: null, paidTriesLeft: 0 };

test("plain code goes to every open place whose door kind matches, and to no other", () => {
  const plan = planSpread(base);
  assert.deepEqual(plan.plain.map((p) => p.placeId).sort(), [place(1), place(2), place(3), place(4)]);
  assert.equal(plan.matching, 4);
  assert.equal(plan.plain.every((p) => p.why === "door kind"), true);
});

test("a place whose held page names the method's platform is tried too, once", () => {
  const plan = planSpread({ ...base, method: { methodId: "m", doorKind: "ical", platforms: ["civicplus"] }, detectedPlatform: (id) => (id === "d5" ? "CivicPlus" : null) });
  assert.equal(plan.plain.length, 5);
  assert.equal(plan.plain.find((p) => p.placeId === place(5))!.why, "platform detected");
});

test("a place that already has a result for the method is not tried again", () => {
  const row = (placeId: string, state: FixMapRow["state"]): FixMapRow => ({ methodId: "m", placeId, state, triedAt: "2026-10-04T00:00:00Z", attemptId: "a", cause: null, updatedAt: "2026-10-04T00:00:00Z" });
  const plan = planSpread({ ...base, fixMapRows: [row(place(1), "WORKS"), row(place(2), "FAILS"), row(place(3), "UNTRIED"), { ...row(place(4), "WORKS"), methodId: "other" }] });
  assert.deepEqual(plan.plain.map((p) => p.placeId).sort(), [place(3), place(4)]);
  assert.equal(plan.alreadyTried, 2);
});

test("a small publisher's host takes ten a round and the rest wait; hosts shared by many places are one allowance", () => {
  const many = Array.from({ length: 14 }, (_, i) => door(100 + i, { hosts: ["one-town.example.gov"] }));
  const sizeFor = (host: string) => (host === "one-town.example.gov" ? { kind: "local-government" as const, population: 900 } : { kind: "state" as const });
  const plan = planSpread({ ...base, doors: [...many, door(1)], sizeFor });
  assert.equal(plan.plain.filter((p) => p.host === "one-town.example.gov").length, 10);
  assert.equal(plan.plainWaiting.length, 4);
  assert.equal(plan.plain.some((p) => p.host === "h1.example.gov"), true, "a large publisher is not held back");
});

test("paid tries go only to places inside a Send, no more than the dial leaves", () => {
  const sent = new Set([place(1), place(2), place(3)]);
  const plan = planSpread({ ...base, sendPlaceIds: sent, paidTriesLeft: 2 });
  assert.equal(plan.paid.length, 2);
  assert.equal(plan.paid.every((p) => sent.has(p.placeId)), true);
  const reasons = new Set(plan.paidSkipped.map((s) => s.reason));
  assert.deepEqual([...reasons].sort(), ["the budget dial leaves no paid tries this round", "this place is not inside a Send"]);
  assert.equal(planSpread({ ...base, sendPlaceIds: null, paidTriesLeft: 99 }).paid.length, 0, "nothing sent, nothing paid");
});

test("the order inside a round is the same every time and does not follow the list order", () => {
  const a = planSpread({ ...base, sendPlaceIds: new Set(doors.map((d) => d.ocdId!)), paidTriesLeft: 2 });
  const b = planSpread({ ...base, doors: [...doors].reverse(), sendPlaceIds: new Set(doors.map((d) => d.ocdId!)), paidTriesLeft: 2 });
  assert.deepEqual(a.paid.map((p) => p.placeId), b.paid.map((p) => p.placeId));
  assert.deepEqual(a.plain.map((p) => p.placeId), b.plain.map((p) => p.placeId));
});
