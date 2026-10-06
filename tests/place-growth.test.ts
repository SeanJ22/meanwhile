/**
 * SC-10: a blank started being owed on a date. What a place owed when its mission started is the starting list; finds add to the
 * grown list only, so a new find never pulls the starting completeness down. One update per new kind of thing, once.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { owedKindUpdates } from "../lib/control-plane/admin-view/updates-read.ts";
import { missionStartOf } from "../lib/control-plane/admin-view/mission-start.ts";
import { defaultAdminConfig, type AdminConfig } from "../lib/control-plane/gateway/admin-config.ts";
import { buildPlaceOwedList, type HeldPlaceField, type PlaceSubject } from "../lib/coverage/place-owed.ts";
import { onStartingList, placeGrowth } from "../lib/coverage/place-growth.ts";
import { owedListItem } from "../lib/control-plane/admin-view/place-scorecard.ts";

const county = "ocd-division/country:us/state:az/county:cochise";
const now = "2026-10-05T12:00:00Z";
const start = "2026-10-03T00:00:00Z";
const divisions = [{ id: county, label: "Cochise County" }];
const body = (id: string): PlaceSubject => ({ id, kind: "body", divisionIds: [county], label: `Body ${id}` });
const held = (subjectId: string, checklistId: string, checkedAt: string): HeldPlaceField => ({ subjectId, checklistId, state: "published", sourceUrl: "https://x.gov", checkedAt, freshUntil: "2026-10-20T00:00:00Z" });

test("a body first seen after the mission started is dated, and what the place owed from the start is not", () => {
  const rows = buildPlaceOwedList({ divisions, subjects: [body("body:old"), body("body:new")], now,
    held: [held("body:old", "BOD-01", "2026-09-30T00:00:00Z"), held("body:new", "BOD-01", "2026-10-04T08:00:00Z"), held("body:new", "BOD-02", "2026-10-04T09:00:00Z")] });
  const since = (id: string) => [...new Set(rows.filter((r) => r.subject.id === id).map((r) => r.owedSince))];
  assert.deepEqual(since("body:old"), ["2026-09-30T00:00:00Z"]);
  assert.deepEqual(since("body:new"), ["2026-10-04T08:00:00Z"], "the earliest held record dates the subject");
  assert.deepEqual(since(county), [null], "the place itself is owed from the start, never dated");
  assert.ok(rows.filter((r) => r.subject.id.includes("#inventory:")).every((r) => r.owedSince === null));
  assert.equal(rows.filter((r) => r.subject.id === "body:new").length > 0, true);
});

test("the grown list adds blanks without lowering the starting list", () => {
  const before = buildPlaceOwedList({ divisions, subjects: [body("body:old")], now, held: [held("body:old", "BOD-01", "2026-09-30T00:00:00Z")] });
  const after = buildPlaceOwedList({ divisions, subjects: [body("body:old"), body("body:new")], now,
    held: [held("body:old", "BOD-01", "2026-09-30T00:00:00Z"), held("body:new", "BOD-01", "2026-10-04T08:00:00Z")] });
  const a = placeGrowth(before, start)!, b = placeGrowth(after, start)!;
  assert.deepEqual(b.starting, a.starting, "a find adds to the grown list only");
  assert.equal(a.added, 0);
  assert.ok(b.added > 0);
  assert.ok(b.grown.of > a.grown.of);
  assert.equal(after.filter((r) => onStartingList(r, start)).length + b.added, after.length, "added is the grown rows minus the starting rows");
  assert.equal(placeGrowth(after, null), null, "a place never sent has no starting list");
});

test("the owed list marks each blank's date for Admin, and a new kind of thing makes one update, once", () => {
  const rows = buildPlaceOwedList({ divisions, subjects: [body("body:new")], now, held: [held("body:new", "BOD-01", "2026-10-04T08:00:00Z")] });
  assert.equal(rows.some((r) => owedListItem(r).owedSince === "2026-10-04T08:00:00Z"), true);
  const updates = owedKindUpdates({ placeKey: "geo:az.county.04003", placeLabel: "Cochise County", rows, missionStart: start });
  assert.deepEqual(updates.map((u) => u.id), ["owed-kind:geo:az.county.04003:body", "owed-kind:geo:az.county.04003:calendar"], "a body brings its meeting calendar with it; each kind is one update");
  assert.ok(updates.every((u) => u.label === "EXPECTED"), "added work is never shown as a win");
  assert.match(updates[0].what, /found new government bodies/);
  assert.deepEqual(owedKindUpdates({ placeKey: "geo:az.county.04003", placeLabel: "Cochise County", rows, missionStart: null }), []);
  assert.deepEqual(owedKindUpdates({ placeKey: "geo:az.county.04003", placeLabel: "Cochise County", rows, missionStart: "2026-10-05T00:00:00Z" }), [], "found before the mission is not new");
});

test("a mission starts at its lifetime hunt start, else its decision time, and only for exactly that place", () => {
  const scope = (over: Record<string, unknown>) => ({ key: "v/04003", geography: { type: "county", geoid: "04003", stateAbbr: "AZ", label: "Cochise County" }, priority: 1, budgetUsd: 5, note: null, decidedAt: "2026-10-02T00:00:00Z", decidedBy: "x", receiptId: "r", previous: null, ...over });
  const config = { ...defaultAdminConfig(now), expansionScopes: [scope({ budgetStartedAt: "2026-10-01T00:00:00Z" }), scope({ key: "v/04019", geography: { type: "county", geoid: "04019", stateAbbr: "AZ", label: "Pima" } })] } as unknown as AdminConfig;
  assert.equal(missionStartOf(config, "geo:az.county.04003"), "2026-10-01T00:00:00Z");
  assert.equal(missionStartOf(config, "geo:az.county.04019"), "2026-10-02T00:00:00Z");
  assert.equal(missionStartOf(config, "geo:az.county.04021"), null);
  assert.equal(missionStartOf(null, "geo:az.county.04003"), null);
});

import { v6PlaceSection } from "../lib/control-plane/admin-view/v6-place-section.ts";
import type { PlaceOwedRead } from "../lib/control-plane/admin-view/place-owed-read.ts";

test("Admin's place section shows added dates only on blanks added after the start, and both completeness figures", () => {
  const rows = buildPlaceOwedList({ divisions, subjects: [body("body:old"), body("body:new")], now,
    held: [held("body:old", "BOD-01", "2026-09-30T00:00:00Z"), held("body:new", "BOD-01", "2026-10-04T08:00:00Z")] });
  const read: PlaceOwedRead = { state: "READ", placeKey: "geo:az.county.04003", label: "Cochise County", covers: "x", divisions, rows, observedAt: now, readMs: { geography: 0, held: 0 } };
  const query = { group: null, states: null, q: null, offset: 0, limit: 500 };
  const section = v6PlaceSection(read, query, null, [], start);
  const items = section.data.items;
  assert.ok(items.filter((i) => i.subject === "Body body:new").every((i) => i.addedAt === "2026-10-04T08:00:00Z"));
  assert.ok(items.filter((i) => i.subject === "Body body:old").every((i) => i.addedAt === null));
  const g = section.data.score.growth!;
  assert.equal(g.missionStart, start);
  assert.ok(g.added > 0 && g.grown.of > g.starting.of);
  assert.equal(v6PlaceSection(read, query).data.score.growth, null);
  assert.ok(v6PlaceSection(read, query).data.items.every((i) => i.addedAt === null), "no mission start, nothing is called added");
});
