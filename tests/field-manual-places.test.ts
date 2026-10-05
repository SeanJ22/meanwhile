import assert from "node:assert/strict";
import test from "node:test";

import { emptyFieldManual, newFieldManualEntry, projectFieldManual, upsertEntries, type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

const NOW = "2026-10-04T10:00:00Z";
const entry = (over: Partial<FieldManualEntry>): FieldManualEntry => ({
  ...newFieldManualEntry("test", "route-1", { role: "SCOUT", kind: "ROUTE", title: "calendar feed", summary: "read the feed", outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" }),
  id: "fm-route-1", ...over,
});

test("a route that worked in one state and failed in another keeps both results", () => {
  const a = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" });
  const b = entry({ states: ["nh"], outcome: "FAILED", observedAt: "2026-10-03T00:00:00Z" });
  const merged = upsertEntries(upsertEntries(emptyFieldManual(), [a], NOW), [b], NOW).entries[0]!;
  assert.equal(merged.outcome, "FAILED", "latest anywhere, for display");
  assert.deepEqual(merged.placeResults!.map((r) => [r.place, r.outcome]), [["state:az", "YIELDED"], ["state:nh", "FAILED"]]);
});

test("a newer result replaces only the older one for the same place, and names the observation it superseded", () => {
  const first = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" });
  const second = entry({ states: ["az"], outcome: "FAILED", observedAt: "2026-10-04T00:00:00Z" });
  const stale = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-09-01T00:00:00Z" });
  let store = upsertEntries(emptyFieldManual(), [first], NOW);
  store = upsertEntries(store, [second], NOW);
  store = upsertEntries(store, [stale], NOW);
  const [az] = store.entries[0]!.placeResults!;
  assert.deepEqual([az!.place, az!.outcome, az!.supersedes], ["state:az", "FAILED", "2026-10-01T00:00:00Z"]);
});

test("a tie at the same instant keeps the failure", () => {
  const ok = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" });
  const bad = entry({ states: ["az"], outcome: "FAILED", observedAt: "2026-10-01T00:00:00Z" });
  const store = upsertEntries(upsertEntries(emptyFieldManual(), [ok], NOW), [bad], NOW);
  assert.equal(store.entries[0]!.placeResults![0]!.outcome, "FAILED");
});

const row = (methodId: string, state: FixMapRow["state"], cause: string | null = null): FixMapRow =>
  ({ methodId, placeId: "ocd-division/country:us/state:az/place:x", state, triedAt: NOW, attemptId: "a", cause, updatedAt: NOW });

test("a brief for a place marks what works there, what is untried there, and leaves out what fails there", () => {
  const store = upsertEntries(emptyFieldManual(), [
    entry({ id: "works", title: "works one" }), entry({ id: "fails", title: "fails one" }), entry({ id: "new", title: "new one" }),
    entry({ id: "note", kind: "STATE_NOTE", title: "a plain note" }),
  ], NOW);
  const rows = [row("works", "WORKS"), row("fails", "FAILS", "the listing now sits behind a login")];
  const here = projectFieldManual(store, { fixMapRows: rows });
  const text = here.lines.join("\n");
  assert.match(text, /works one.*\[works here\]/);
  assert.match(text, /new one.*\[untried here: try it and record the result\]/);
  assert.doesNotMatch(text, /fails one/);
  assert.match(text, /a plain note/);
  assert.doesNotMatch(here.lines.find((l) => l.includes("a plain note"))!, /\[/);
  assert.equal(here.leftOutFailingHere, 1);
  assert.equal(here.entryIds.includes("fails"), false);
  // Without the fix map the projection is what it always was.
  const plain = projectFieldManual(store, {});
  assert.equal(plain.lines.length, 4);
  assert.equal(plain.leftOutFailingHere, undefined);
});
