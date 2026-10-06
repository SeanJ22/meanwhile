/** FE-23: the Scoreboard's look row counts the week's red and green screens, shows the newest reds with their screenshots, and each red's fix and re-look. */
import assert from "node:assert/strict";
import test from "node:test";

import { lookRow, type LookReading } from "../lib/control-plane/admin-view/scoreboard-read.ts";
import type { LookPass, LookScreen } from "../lib/frontend/look-pass.ts";

const NOW = "2026-10-06T12:00:00.000Z";
const screen = (over: Partial<LookScreen>): LookScreen => ({
  surface: "ballot", zip: "85701", profile: "phone", label: "ballot page, phone (390 wide)", shot: "resident-tasks/look/2026-10-05/abc/ballot-85701-phone.png",
  issues: {}, issueLines: [], failed: null, verdict: "green", element: null, answers: {}, fixId: null, ...over,
});
const pass = (at: string, screens: LookScreen[]): LookPass => {
  const red = screens.filter((s) => s.verdict === "red").length, green = screens.filter((s) => s.verdict === "green").length;
  return { sha: at.slice(0, 7), at, runId: "r", zips: ["85701"], screens, red, green, notReviewed: screens.length - red - green, reviewerSays: null, verdict: red > 0 ? "red" : "green" };
};
const reading = (passes: LookPass[], fixes: [string, "OPEN" | "FIXING" | "FIXED" | "CAME_BACK"][] = []): LookReading => ({
  now: NOW, passes, fixStates: new Map(fixes), imageUrl: (k) => `/shot/${k.replace(/^resident-tasks\//, "")}`,
});

test("counts red and green this week, shows the newest red with its screenshot, its fix and that it was not looked at again", () => {
  const red = screen({ verdict: "red", element: "the Vote button is cut off", fixId: "fix-1" });
  const r = lookRow(reading([pass("2026-10-05T10:00:00.000Z", [red, screen({ surface: "home", label: "home page and map, phone (390 wide)" })])], [["fix-1", "OPEN"]]));
  assert.equal(r.value, "1 of 2");
  assert.match(r.counts!, /1 green · 1 red · 1 deploy looked at this week/);
  assert.equal(r.items!.length, 1);
  assert.match(r.items![0], /Wrong Oct 5: the ballot page, phone \(390 wide\), the Vote button is cut off\. Fix not started; not looked at again yet\./);
  assert.deepEqual(r.images, [{ label: red.label, src: "/shot/look/2026-10-05/abc/ballot-85701-phone.png" }]);
  assert.equal(r.notMeasured, null);
});

test("a later pass that sees the screen right shows it as now right, and the fix as fixed", () => {
  const red = screen({ verdict: "red", element: "the map covers the text", fixId: "fix-2" });
  const r = lookRow(reading([
    pass("2026-10-06T09:00:00.000Z", [screen({})]),
    pass("2026-10-05T10:00:00.000Z", [red]),
  ], [["fix-2", "FIXED"]]));
  assert.match(r.items![0], /Fixed; looked at again: now right\./);
});

test("a red that is still red on the next look says so; a screen not judged is not counted as a re-look", () => {
  const red = (id: string) => screen({ verdict: "red", element: "text too small", fixId: id });
  const r = lookRow(reading([
    pass("2026-10-06T09:00:00.000Z", [screen({ verdict: "not reviewed", shot: null })]),
    pass("2026-10-05T10:00:00.000Z", [red("fix-3")]),
  ], [["fix-3", "FIXING"]]));
  assert.match(r.items![0], /Being fixed; not looked at again yet\./);
  const again = lookRow(reading([pass("2026-10-06T09:00:00.000Z", [red("fix-3")]), pass("2026-10-05T10:00:00.000Z", [red("fix-3")])]));
  assert.equal(again.items!.length, 1, "the same red on two deploys is one line");
  const old = lookRow(reading([pass("2026-10-05T10:00:00.000Z", [red("fix-3")]), pass("2026-10-04T10:00:00.000Z", [screen({})])]));
  assert.match(old.items![0], /not looked at again yet/);
});

test("nothing this week, unreadable and not read show — and say why, never a zero", () => {
  assert.equal(lookRow(reading([pass("2026-09-20T10:00:00.000Z", [screen({})])])).notMeasured, "No look check of the live site has run in the last week.");
  assert.equal(lookRow(null).notMeasured, "The look checks could not be read just now.");
  assert.equal(lookRow(undefined).value, null);
  assert.ok(lookRow(undefined).notMeasured);
});
