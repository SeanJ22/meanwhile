import assert from "node:assert/strict";
import test from "node:test";

import { foldEntries, newFieldManualEntry, projectFieldManual, type FieldManualEntry } from "../lib/control-plane/field-manual.ts";
import type { FixMapRow } from "../lib/method/fix-map.ts";

const NOW = "2026-10-04T10:00:00Z";
const entry = (over: Partial<FieldManualEntry>): FieldManualEntry => ({
  ...newFieldManualEntry("test", "route-1", { role: "SCOUT", kind: "ROUTE", title: "calendar feed", summary: "read the feed", outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" }),
  id: "fm-route-1", ...over,
});

test("a route that worked in one state and failed in another keeps both results", () => {
  const a = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" });
  const b = entry({ states: ["nh"], outcome: "FAILED", observedAt: "2026-10-03T00:00:00Z" });
  const merged = foldEntries([a, b])[0]!;
  assert.equal(merged.outcome, "FAILED", "latest anywhere, for display");
  assert.deepEqual(merged.placeResults!.map((r) => [r.place, r.outcome]), [["state:az", "YIELDED"], ["state:nh", "FAILED"]]);
});

test("a newer result replaces only the older one for the same place, and names the observation it superseded", () => {
  const first = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" });
  const second = entry({ states: ["az"], outcome: "FAILED", observedAt: "2026-10-04T00:00:00Z" });
  const stale = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-09-01T00:00:00Z" });
  const [az] = foldEntries([first, second, stale])[0]!.placeResults!;
  assert.deepEqual([az!.place, az!.outcome, az!.supersedes], ["state:az", "FAILED", "2026-10-01T00:00:00Z"]);
});

test("a tie at the same instant keeps the failure", () => {
  const ok = entry({ states: ["az"], outcome: "YIELDED", observedAt: "2026-10-01T00:00:00Z" });
  const bad = entry({ states: ["az"], outcome: "FAILED", observedAt: "2026-10-01T00:00:00Z" });
  assert.equal(foldEntries([ok, bad])[0]!.placeResults![0]!.outcome, "FAILED");
});

const PLACE = "ocd-division/country:us/state:az/place:x";
const row = (methodId: string, state: FixMapRow["state"], cause: string | null = null): FixMapRow =>
  ({ methodId, placeId: PLACE, state, triedAt: NOW, attemptId: "a", cause, updatedAt: NOW });

test("a brief for a place marks what works there, what is untried there, and leaves out what fails there", () => {
  const store = { entries: foldEntries([
    entry({ id: "works", title: "works one" }), entry({ id: "fails", title: "fails one" }), entry({ id: "new", title: "new one" }),
    entry({ id: "note", kind: "STATE_NOTE", title: "a plain note", states: ["az"] }),
  ]) };
  const here = projectFieldManual(store, { ocdIds: [PLACE] }, { here: [row("works", "WORKS"), row("fails", "FAILS", "the listing now sits behind a login")], works: {} });
  const text = here.lines.join("\n");
  assert.match(text, /works one.*\[works here\]/);
  assert.match(text, /new one.*\[untried here: try it and record the result\]/);
  assert.doesNotMatch(text, /fails one/);
  assert.match(text, /a plain note/);
  assert.doesNotMatch(here.lines.find((l) => l.includes("a plain note"))!, /\[/);
  assert.equal(here.entryIds.includes("fails"), false);
  const elsewhere = projectFieldManual(store, { ocdIds: ["ocd-division/country:us/state:nh/place:y"] });
  assert.ok(elsewhere.entryIds.includes("fails"), "a method that fails in one place is still offered in another");
});
