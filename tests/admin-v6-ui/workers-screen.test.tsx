/**
 * Workers and Now screens explain the real `admin-v6/workers@1` reading.
 *
 * The section bodies below are the saved production-shaped readback
 * (`workers-readback-2026-09-28T22-12-27-388Z.json`, read-only, commit
 * c50ed417) for `us`, `st:az` and `geo:az.zcta.85635`. They are served to
 * `LiveSync` by a fake fetch: this is test evidence of the page's behaviour,
 * not live production proof.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CommandCenter } from "../../app/(admin)/_mw/admin-v6/command-center.tsx";
import type { View } from "../../app/(admin)/_mw/admin-v6/context.tsx";
import { SECTION_DEP } from "../../app/(admin)/_mw/admin-v6/dependencies.ts";
import type { Access, Connection } from "../../app/(admin)/_mw/admin-v6/eligibility.ts";
import { liveExecutor } from "../../app/(admin)/_mw/admin-v6/executor.ts";
import { buildLiveBundle } from "../../app/(admin)/_mw/admin-v6/live-data.ts";
import { LiveSync, type SyncFetch } from "../../app/(admin)/_mw/admin-v6/live-sync.ts";
import type { WorkerStatus } from "../../app/(admin)/_mw/admin-v6/model.ts";
import { workerStatusFromPulse } from "../../app/(admin)/_mw/admin-v6/pulse-view.ts";
import { liveReference } from "../../app/(admin)/_mw/admin-v6/reference.ts";
import { ageWords, laneTotals, missingByCard, roundReading } from "../../app/(admin)/_mw/admin-v6/screen-workers.tsx";
import type { MwScope } from "../../app/(admin)/_mw/scope.ts";

/* -------------------------------------------------- the saved readback */

const READ_AT = "2026-09-28T22:12:27.388Z";
const Z85635 = "geo:az.zcta.85635";
const STATUS: WorkerStatus = {
  lastCheckIn: "2026-09-28T21:58:46.487Z", lastUsefulProgress: null, roundStartedAt: null,
  lastRoundFinishedAt: "2026-09-28T21:58:46.487Z", nextRoundDueAt: "2026-09-28T22:01:06.064Z", runnerState: "ALIVE",
  lanes: [{ name: "Plain-code reads", active: null, waiting: 1301, blockedBy: null }, { name: "Paid research (Scout)", active: 0, waiting: 1284, blockedBy: null }],
  unread: [],
};
const HUNT = "ZIP 85635 (Census ZCTA) hunt";
const failing = (tries: number) => ({ kind: "Keeps failing",
  title: `The voting sites source for the ${HUNT}: ${tries} failed tries since Sep 28, 5:30 PM ET`,
  why: "The run ended without the one receipt it must save, so nothing from it could be published. (Saved reason code: RECEIPT_COUNT_INVALID.)",
  nextTime: "The workers try it again on their own. The next try time is not saved.", owner: "Engineering (the same failure keeps coming back)" });
const MISSING = (scope: string) => [
  "Only the newest 25 source receipts are read (back to Sep 28, 5:30 PM ET). Older changes are not shown here.",
  `No publication or promotion ${scope === "us" ? "" : `for ${scope} `}is in the saved readings this section can read, so the last useful progress is not reported. A check-in only means the workers are switched on.`,
  ...(scope === "us" ? [] : ["Only work sent to a hunt is split by place. Other queued work is counted for the whole system only, in the lane counts."]),
  "DEP-WORKER-ACTIVE-INDEX: the full list of jobs running now is not shown. Paid research jobs are checked one by one and appear under What changed, but plain-code collection jobs run outside that list and the store has no bounded read of every unexpired work claim yet.",
];

function section(scope: string, tries = 9) {
  const applies = [scope];
  const waiting = [
    { kind: "Not finished", title: `${HUNT}: 51 of 194 assigned tasks not finished`,
      why: "40 tasks were stopped by a check, and 11 tasks have no finished, checked result yet. Counted Sep 28, 6:06 PM ET.",
      nextTime: "The next round (it was due Sep 28, 6:01 PM ET)", owner: "Workers" },
    failing(tries),
    ...(scope === "us" ? [
      { kind: "In line", title: "1,301 tasks waiting: plain-code reads", why: "Why they wait is counted when the current round ends.", nextTime: "The oldest has been due since Sep 15, 1:58 PM ET", owner: "Workers" },
      { kind: "In line", title: "1,284 tasks waiting: paid research (scout)", why: "Why they wait is counted when the current round ends.", nextTime: "The oldest has been due since Aug 26, 8:00 PM ET", owner: "Workers" },
    ] : []),
  ].map((x) => ({ ...x, applies, actions: [] }));
  const events = [
    { at: "Sep 28, 6:11 PM ET", kind: "Failed", tone: "warn", applies,
      text: `The voting sites source for the ${HUNT} stopped before publishing ${tries} times since Sep 28, 5:30 PM ET. The run ended without the one receipt it must save, so nothing from it could be published. (Saved reason code: RECEIPT_COUNT_INVALID.)` },
    ...(scope === "us" ? [{ at: "Sep 28, 2:24 PM ET", kind: "Round results", tone: "info", applies,
      text: "From Sep 28, 2:09 PM ET to Sep 28, 2:24 PM ET: records promoted were not counted; how many readers can see was not counted." }] : []),
  ];
  return { contract: "admin-v6/workers@1", scope, revision: `workers:${scope}:${tries}`, asOf: READ_AT,
    data: { status: STATUS, jobs: null, waiting, events, update: null,
      next: [`${HUNT}: finish the other 51 assigned tasks and pass their checks.`, "The next round was due Sep 28, 6:01 PM ET. No newer start is saved yet."] },
    missingParts: MISSING(scope) };
}

/* ------------------------------------------------------------- the page */

const SCOPES: readonly (readonly [string, MwScope, string])[] = [
  ["us", { kind: "all" }, "United States"],
  ["st:az", { kind: "state", state: "az" }, "Arizona"],
  [Z85635, { kind: "geo", type: "zcta", geoid: "85635", state: "az" }, "ZIP 85635"],
];
const owner: Access = { role: "owner", canSpend: true, outreachAuthorized: false };
const PULSE_AT = "2026-09-28T22:12:30.000Z";
const pulse = (workersRevision: string | null, at = PULSE_AT) => ({
  revision: `p-${workersRevision}-${at}`, at,
  runner: { beatAt: STATUS.lastCheckIn, lastCycleFinishedAt: STATUS.lastRoundFinishedAt, nextCycleDueAt: STATUS.nextRoundDueAt, state: "ALIVE" },
  counts: { decisionsWaiting: null, freshnessDebtRows: null, incidents: null, obligations: null, agentJobsRunning: null },
  lanes: { gauges: STATUS.lanes }, unread: [],
  v6: { version: 1, actions: {}, sections: workersRevision ? { workers: { contract: "admin-v6/workers@1", href: "/api/admin/v6/workers", revision: workersRevision } } : {} },
});

function page(sync: LiveSync, scope: MwScope, scopeKey: string, view: View, connection: Connection = "live", lastPulse: unknown = pulse(null)) {
  const ref = liveReference({ scope, observedAt: READ_AT });
  return renderToStaticMarkup(h(CommandCenter, {
    data: buildLiveBundle(sync.snapshot(), ref, workerStatusFromPulse(lastPulse as never)),
    mode: "live", executor: liveExecutor({ capabilities: () => null }), scopeKey, onScopeChange: () => {},
    connection, lastGoodAt: PULSE_AT, recovered: false, access: owner, initialView: view,
  }));
}

/** A fake Workers backend. `reads` counts every request; `serve` sets the reply. */
function backend() {
  const log: { url: string; method: string }[] = [];
  let serve: (scope: string) => { status: number; body: unknown } = (scope) => ({ status: 200, body: section(scope) });
  const fetch: SyncFetch = async (url, init) => {
    log.push({ url, method: (init as { method?: string }).method ?? "GET" });
    const reply = serve(new URL(url, "https://admin.test").searchParams.get("scope")!);
    return { status: reply.status, json: async () => reply.body };
  };
  return { log, fetch, set(fn: typeof serve) { serve = fn; } };
}
const settle = async (sync: LiveSync) => { for (let i = 0; i < 50 && sync.inFlight() > 0; i++) await new Promise((r) => setTimeout(r, 1)); };
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const occurrences = (hay: string, needle: string) => hay.split(needle).length - 1;

async function livePage(scopeKey: string) {
  const b = backend();
  const sync = new LiveSync({ scope: scopeKey, fetch: b.fetch, schedule: () => () => {} });
  sync.onPulse(pulse("w1"));
  await settle(sync);
  assert.equal(sync.snapshot().workers.phase, "live", scopeKey);
  return { b, sync };
}

/* ---------------------------------------------------------------- tests */

test("the saved readback explains itself on Workers for the country, Arizona and ZIP 85635", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(PULSE_AT) });
  try {
    for (const [key, scope, name] of SCOPES) {
      const { sync } = await livePage(key);
      const t = text(page(sync, scope, key, "workers"));
      // What is waiting and why; the assignment reading is not checklist coverage or delivery.
      assert.match(t, /51 of 194 assigned tasks not finished/, key);
      assert.match(t, /40 tasks were stopped by a check, and 11 tasks have no finished, checked result yet/, key);
      assert.match(t, /isn’t the 325-item checklist, and a finished task isn’t proof readers can see it/, key);
      // One retry loop is one waiting item and one change line, not nine results.
      assert.equal(occurrences(t, "failed tries since"), 1, key);
      assert.equal(occurrences(t, "stopped before publishing 9 times"), 1, key);
      assert.match(t, /It’s one problem, not separate results/, key);
      assert.match(t, /Saved reason code: RECEIPT_COUNT_INVALID/, key);
      // Last useful progress is unknown, with the section's own reason beside it.
      assert.match(t, /Last useful progress[^.]*Unknown No publication or promotion/, key);
      // The round is late, from saved times.
      assert.match(t, /The next round is late It was due 6:01 PM ET, about 10 minutes ago, and no newer start is saved/, key);
      assert.match(t, /Workers last checked in Sep 28, 5:58 PM ET about 10 minutes ago\. A check-in only means they’re switched on, not that they made progress/, key);
      // Jobs: unknown, not zero; the active-index reason sits in the jobs card.
      assert.match(t, /how many are working [^.]*is unknown, not zero/, key);
      assert.match(t, /The full list of jobs running now is not shown\. Paid research jobs are checked one by one/, key);
      assert.match(t, /Supplied by Codex \(worker repository\) · DEP-WORKER-ACTIVE-INDEX/, key);
      assert.doesNotMatch(t, /\b0 running · 2,585 waiting/, `${key}: an unknown lane is not summed as 0`);
      assert.match(t, /Unknown number running · 2,585 waiting/, key);
      // Whole-system counts stay whole-system in a place.
      if (key !== "us") assert.ok(!t.includes(key), `${key}: the place is named, not its key`);
      if (key === "us") assert.match(t, /Whole system/);
      else {
        assert.match(t, new RegExp(`Whole system, not just ${name}`), key);
        assert.match(t, new RegExp(`Across every place, not just ${name}\\. How many are working in ${name} is unknown`), key);
        assert.match(t, /Only work sent to a hunt is split by place/, key);
      }
      // Version: explicitly unavailable.
      assert.match(t, /Are the workers on the latest update\? Unknown\./, key);
      assert.match(t, /DEP-WORKER-VERSION/, key);
      // Arrived data is never covered by the section's generic "not arrived" note.
      assert.doesNotMatch(t, /detailed Workers reading hasn’t arrived/, key);
      assert.doesNotMatch(t, new RegExp(SECTION_DEP.workers.id), key);
      assert.doesNotMatch(t, /Nothing is waiting|No recorded changes|Nothing is running/, key);
      assert.match(t, /Read Sep 28, 6:12 PM ET/, key);
    }
  } finally { mock.timers.reset(); }
});

test("every missing part lands beside a card and none is dropped", () => {
  for (const [key] of SCOPES) {
    const parts = MISSING(key);
    const m = missingByCard(parts);
    assert.equal(m.progress.length + m.jobs.length + m.waiting.length + m.events.length + m.other.length, parts.length, key);
    assert.equal(m.other.length, 0, `${key}: every saved line has a card`);
    assert.equal(m.progress.length, 1);
    assert.equal(m.jobs.length, 1);
    assert.ok(!m.jobs[0].startsWith("DEP-"), "the id is shown as the supplier, not in the sentence");
    assert.equal(m.events.length, 1);
    assert.equal(m.waiting.length, key === "us" ? 0 : 1);
  }
  assert.deepEqual(missingByCard(["Something new the backend says."]).other, ["Something new the backend says."]);
  assert.deepEqual(missingByCard([SECTION_DEP.workers.need]).other, [], "the stand-in's own note is shown by the page, once");
});

test("ages move in five-minute steps and a round turns late without a new worker message", () => {
  const beat = Date.parse(STATUS.lastCheckIn!);
  assert.equal(ageWords(STATUS.lastCheckIn, beat + 4 * 60_000), "less than 5 minutes ago");
  assert.equal(ageWords(STATUS.lastCheckIn, beat + 9 * 60_000), "about 5 minutes ago");
  assert.equal(ageWords(STATUS.lastCheckIn, beat + 10 * 60_000), "about 10 minutes ago");
  assert.equal(ageWords(STATUS.lastCheckIn, beat + 3 * 3_600_000), "about 3 hours ago");
  assert.equal(ageWords(null, beat), null);
  const due = Date.parse(STATUS.nextRoundDueAt!);
  assert.deepEqual(roundReading(STATUS, due - 20 * 60_000), { headline: "Next round due 6:01 PM ET", detail: "That is in about 20 minutes. The last round finished 5:58 PM ET.", overdue: false });
  assert.equal(roundReading(STATUS, due + 3 * 60_000).overdue, false, "a few minutes past due is not yet late");
  assert.match(roundReading(STATUS, due + 3 * 60_000).detail, /It was due less than 5 minutes ago\. No start is saved yet/);
  assert.equal(roundReading(STATUS, due + 6 * 60_000).overdue, true);
  assert.equal(roundReading({ ...STATUS, roundStartedAt: "2026-09-28T22:05:00.000Z" }, due + 20 * 60_000).headline, "Running since 6:05 PM ET");
  assert.equal(roundReading({ ...STATUS, nextRoundDueAt: null, lastRoundFinishedAt: null }, due).headline, "Not reported");
  assert.deepEqual(laneTotals(STATUS.lanes), { running: null, waiting: 2585 });
  assert.deepEqual(laneTotals([{ name: "a", active: 2, waiting: 1, blockedBy: null }]), { running: 2, waiting: 1 });
  assert.equal(laneTotals(null), null);
});

test("an open page: unavailable → live → a later revision → an age step with no revision → disconnect and reconnect", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(PULSE_AT) });
  try {
    const [key, scope] = SCOPES[2];
    const b = backend();
    const sync = new LiveSync({ scope: key, fetch: b.fetch, schedule: () => () => {} });

    // 1. The backend doesn't offer the section yet: the pulse's facts show, lists are unknown, never empty.
    sync.onPulse(pulse(null));
    await settle(sync);
    let t = text(page(sync, scope, key, "workers"));
    assert.equal(b.log.length, 0);
    assert.match(t, /The detailed Workers reading hasn’t arrived/);
    assert.match(t, /Workers last checked in Sep 28, 5:58 PM ET/, "the pulse's check-in still shows");
    assert.match(t, /Whole system, not just ZIP 85635/);
    assert.match(t, /Waiting reasons arrive with the detailed Workers reading\. Unknown doesn’t mean nothing is waiting/);
    assert.doesNotMatch(t, /Nothing is waiting|No recorded changes/);
    let now = text(page(sync, scope, key, "now"));
    assert.match(now, /What’s happening now/);
    assert.match(now, /Waiting reasons haven’t arrived yet/);

    // 2. Announced: exactly one read, and the same page shows the real reading.
    sync.onPulse(pulse("w1"));
    await settle(sync);
    assert.equal(b.log.length, 1);
    t = text(page(sync, scope, key, "workers"));
    assert.match(t, /9 failed tries since/);
    assert.doesNotMatch(t, /detailed Workers reading hasn’t arrived/);
    now = text(page(sync, scope, key, "now"));
    assert.match(now, /2 waiting in ZIP 85635, each with a reason: ZIP 85635 \(Census ZCTA\) hunt: 51 of 194 assigned tasks not finished/);
    assert.match(now, /Unknown jobs working now in ZIP 85635\. The full list of running jobs isn’t available yet, so this isn’t zero/);
    assert.match(now, /Late The next round is late/);
    assert.doesNotMatch(now, /Not connected yet\. This part turns on by itself[^.]*\. You don’t need to reload\. The detailed Workers reading/, "no generic note over arrived data");
    assert.doesNotMatch(now, new RegExp(SECTION_DEP.workers.id));

    // 3. A later source revision: one more read, the new count replaces the old line.
    b.set((s) => ({ status: 200, body: section(s, 10) }));
    sync.onPulse(pulse("w2"));
    await settle(sync);
    assert.equal(b.log.length, 2);
    t = text(page(sync, scope, key, "workers"));
    assert.match(t, /10 failed tries since/);
    assert.doesNotMatch(t, /9 failed tries since/);
    assert.equal(occurrences(t, "failed tries since"), 1, "replaced, not appended");

    // 4. Five minutes on, the same revision: no read, but the ages step on.
    assert.match(t, /about 10 minutes ago\. A check-in only means/);
    mock.timers.setTime(Date.parse(PULSE_AT) + 5 * 60_000);
    sync.onPulse(pulse("w2", new Date(Date.now()).toISOString()));
    await settle(sync);
    assert.equal(b.log.length, 2, "an unchanged revision reads nothing");
    t = text(page(sync, scope, key, "workers"));
    assert.match(t, /about 15 minutes ago\. A check-in only means/);
    assert.match(t, /It was due 6:01 PM ET, about 15 minutes ago/);

    // 5. Disconnected: no pulses, the last good reading stays and says so.
    t = text(page(sync, scope, key, "workers", "reconnecting"));
    assert.match(t, /Reconnecting/);
    assert.match(t, /Nothing new is arriving\. What’s shown is the last good reading/);
    assert.match(t, /10 failed tries since/);
    assert.match(t, /Nothing newer is arriving right now, so this may be out of date/);

    // 6. Reconnected: one catch-up read, no double counting, no action sent.
    sync.catchUp();
    await settle(sync);
    assert.equal(b.log.length, 3, "exactly one catch-up read");
    t = text(page(sync, scope, key, "workers"));
    assert.equal(occurrences(t, "failed tries since"), 1);
    assert.ok(b.log.every((r) => r.method === "GET" && r.url.startsWith("/api/admin/v6/workers?scope=")), "reads only; no action is sent");
    assert.equal(new Set(b.log.map((r) => new URL(r.url, "https://admin.test").searchParams.get("scope"))).size, 1, "the selected place is kept");
  } finally { mock.timers.reset(); }
});

test("an authentication failure is never shown as an empty, successful reading", async () => {
  for (const status of [401, 403]) {
    const b = backend();
    b.set(() => ({ status, body: { says: "Sign in again." } }));
    const sync = new LiveSync({ scope: "us", fetch: b.fetch, schedule: () => () => {} });
    sync.onPulse(pulse("w1"));
    await settle(sync);
    assert.equal(sync.snapshot().workers.phase, "denied");
    for (const view of ["workers", "now"] as const) {
      const t = text(page(sync, { kind: "all" }, "us", view));
      assert.doesNotMatch(t, /Nothing is waiting|No recorded changes|Nothing is running|0 jobs working/, `${status} ${view}`);
      assert.match(t, view === "workers" ? /Unknown doesn’t mean nothing is waiting/ : /Unknown jobs working now/, `${status} ${view}`);
    }
    sync.onPulse(pulse("w1"));
    await settle(sync);
    assert.equal(b.log.length, 1, "a denial is not retried on the same announcement");
  }
});
