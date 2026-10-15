import test from "node:test";
import assert from "node:assert/strict";

import { ownerPauseOf } from "../lib/control-plane/admin-view/v6-hunts-read.ts";
import type { DoorRowView } from "../lib/control-plane/admin-view/v6-doors-read.ts";
import { doorsInWords, shutDoorGroups } from "../app/(admin)/_mw/admin-v6/doors-panel.tsx";
import type { Hunt, Place } from "../app/(admin)/_mw/admin-v6/model.ts";
import { huntsByState, indexPlaces, stateKeyOf } from "../app/(admin)/_mw/admin-v6/places.ts";
import { huntStatus, type QueueRow } from "../app/(admin)/_mw/admin-v6/queue.ts";
import { holdingBand, motionRows } from "../app/(admin)/_mw/admin-v6/screen-now.tsx";
import { roundReading, workersInWords } from "../app/(admin)/_mw/admin-v6/screen-workers.tsx";

const hunt = (zip: string, st: string, over: Partial<Hunt> = {}): Hunt => ({
  id: `h-${zip}`, placeKey: `geo:${st}.zcta.${zip}`, name: `ZIP ${zip} hunt`, startedAt: "2026-10-01T15:00:00.000Z", limitUsd: 25,
  limitSource: "your hunt instruction", spentUsd: 4, heldUsd: 1, unpricedEntries: 0, status: "unreported", researchWorkers: null, ...over,
});

test("a hunt never says 'saved, not reported running': paused says who paused it, when, and how to go on", () => {
  assert.deepEqual(huntStatus(hunt("85701", "az")), { chip: "Active", next: "The runner works on it each round. Whether a worker is on it at this moment is not reported." });
  const paid = huntStatus(hunt("85701", "az", { status: "paused", pause: { kind: "paid-work", since: "2026-10-12T21:40:00.000Z", note: "Holding spend" } }));
  assert.equal(paid.chip, "Paused");
  assert.equal(paid.next, "You paused all paid work Oct 12, 5:40 PM ET. You said: “Holding spend” Resume paid work to go on.");
  assert.match(huntStatus(hunt("85701", "az", { status: "paused", pause: { kind: "runner", since: null, note: null } })).next, /^You paused the runner, so no work runs\. Resume the runner/);
  assert.match(huntStatus(hunt("85701", "az", { status: "paused", pause: { kind: "budget", since: null, note: null } })).next, /^Its budget is set to \$0\./);
  for (const h of [hunt("1", "az"), hunt("2", "az", { status: "paused" }), hunt("3", "az", { status: "stopped" })]) assert.doesNotMatch(huntStatus(h).chip, /not reported/i);
});

test("the owner's latest pause wins until a later resume; a runner pause outranks a paid-work pause", () => {
  const at = (requestedAt: string) => ({ requestedAt, note: null });
  assert.equal(ownerPauseOf(null), null);
  assert.equal(ownerPauseOf({ PAUSE: at("2026-10-02"), RESUME: at("2026-10-03"), PAUSE_RUNNER: null, RESUME_RUNNER: null }), null);
  assert.equal(ownerPauseOf({ PAUSE: at("2026-10-03"), RESUME: at("2026-10-02"), PAUSE_RUNNER: null, RESUME_RUNNER: null })?.kind, "paid-work");
  assert.equal(ownerPauseOf({ PAUSE: at("2026-10-03"), RESUME: null, PAUSE_RUNNER: at("2026-10-01"), RESUME_RUNNER: null })?.kind, "runner");
});

test("ZIP hunts gather under their state, one row per state with a count", () => {
  assert.equal(stateKeyOf("geo:az.zcta.85701"), "st:az");
  assert.equal(stateKeyOf("st:nj"), "st:nj");
  assert.equal(stateKeyOf("us"), null);
  const index = indexPlaces([{ key: "st:az", name: "Arizona", kind: "State", navParent: "us", within: ["us"] }, { key: "st:nj", name: "New Jersey", kind: "State", navParent: "us", within: ["us"] }] as Place[]);
  const groups = huntsByState(index, [hunt("85705", "az"), hunt("08628", "nj"), hunt("85701", "az")]);
  assert.deepEqual(groups.map((g) => [g.name, g.hunts.map((h) => h.name)]), [["Arizona", ["ZIP 85701 hunt", "ZIP 85705 hunt"]], ["New Jersey", ["ZIP 08628 hunt"]]]);
});

test("Orders in motion lists orders one by one and says a shared hunt pause once with a count", () => {
  const row = (key: string, kind: QueueRow["kind"], chip: string, next: string): QueueRow => ({ key, kind, what: key, chip, tone: "neutral", filter: "waiting", owner: "—", due: null, next, progress: null, actions: [], open: null, at: null, receipt: null, sendId: null });
  const rows = [row("order-1", "order", "Received", "Waits for the runner."), ...["a", "b", "c"].map((k) => row(`hunt-${k}`, "hunt", "Paused", "You paused all paid work.")), row("hunt-d", "hunt", "Paused", "Its budget is set to $0.")];
  const out = motionRows(rows);
  assert.deepEqual(out.map((r) => [r.what, r.chip, r.lines.join(" ")]), [
    ["order-1", "Received", "Waits for the runner."], ["3 hunts", "Paused", "You paused all paid work."], ["hunt-d", "Paused", "Its budget is set to $0."],
  ]);
});

test("the country map shades each place by how much readers have", () => {
  assert.deepEqual([null, undefined, 0, 12.5, 40, 74.9, 75].map(holdingBand), ["unknown", "unknown", "none", "some", "half", "half", "most"]);
});

test("identical shut doors are one line with the count and the reason; the doors are said in one sentence", () => {
  const door = (kind: string, why: string | null, since: string, status: DoorRowView["status"] = "Shut"): DoorRowView => ({ name: `${kind} door`, kind, body: "—", status, why, since, lastWorked: null, lastFailed: null });
  const groups = shutDoorGroups([door("Legistar events", "3 reads in a row could not reach it", "2026-10-05"), door("Legistar events", "3 reads in a row could not reach it", "2026-10-01"),
    door("Official page events", "the address answers 404", "2026-10-03"), door("Legistar events", null, "2026-10-04"), door("Legistar events", null, "2026-10-04", "Open")]);
  assert.deepEqual(groups, [
    { kind: "Legistar events", why: "3 reads in a row could not reach it", doors: 2, since: "2026-10-01" },
    { kind: "Legistar events", why: null, doors: 1, since: "2026-10-04" },
    { kind: "Official page events", why: "the address answers 404", doors: 1, since: "2026-10-03" },
  ]);
  assert.equal(doorsInWords({ open: 60, shut: 37, setAside: 2, unreadable: 0 }), "60 doors are open, 37 are shut and 2 are set aside.");
  assert.equal(doorsInWords({ open: 1, shut: 0, setAside: 0, unreadable: 3 }), "1 door is open and 0 are shut. 3 could not be read.");
});

test("Workers leads with plain sentences, and never puts an update's raw output on its face", () => {
  const now = Date.parse("2026-10-13T14:00:00.000Z");
  const status = { cycle: { startedAt: "2026-10-13T13:20:00.000Z", finishedAt: "2026-10-13T13:31:00.000Z", exitCode: 1, signal: null, lastError: "Error: X\n    at y (z.ts:1:1)" },
    lastCheckIn: "2026-10-13T13:56:00.000Z", lastUsefulProgress: { at: "2026-10-13T13:28:00.000Z", what: "Published 14 meetings for Tucson Unified." },
    roundStartedAt: null, lastRoundFinishedAt: "2026-10-13T13:31:00.000Z", nextRoundDueAt: "2026-10-13T14:30:00.000Z", runnerState: "ALIVE",
    refused: { count: 12, why: "paid research is paused" }, lanes: null, unread: [] };
  const lines = workersInWords({ update: { status: "FAILED", title: "The latest database update" }, status, round: roundReading(status, now),
    checkIn: "less than 5 minutes ago", progressAge: "about 30 minutes ago", working: "3", waiting: 49, place: null, live: true });
  assert.deepEqual(lines, [
    "The latest database update did not finish; the card below says who is fixing it.",
    "The workers last checked in less than 5 minutes ago.",
    "Round of work: finished 9:31 AM ET, with an error; the details are on the Round of work tile.",
    "3 jobs are working now, and 49 are waiting.",
    "The last useful progress was about 30 minutes ago: published 14 meetings for Tucson Unified.",
    "12 paid jobs were not sent to the AI because paid research is paused.",
  ]);
  assert.ok(lines.every((line) => !/at y \(|Error: X/.test(line)));
});

test("hidden technical text on Workers and the doors panel opens only from 'Technical details'", async () => {
  const { readFileSync } = await import("node:fs");
  for (const file of ["app/(admin)/_mw/admin-v6/screen-workers.tsx", "app/(admin)/_mw/admin-v6/doors-panel.tsx"]) {
    const src = readFileSync(file, "utf8");
    assert.doesNotMatch(src, /<Technical\b[^>]*\blabel=/, `${file} keeps the one label`);
    for (const [, summary] of src.matchAll(/<details className={s\.details}>\s*<summary>([^<]*)<\/summary>/g)) assert.equal(summary, "Technical details", file);
  }
});
