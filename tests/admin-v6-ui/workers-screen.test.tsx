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
import { RUNNER_ID } from "../../lib/control-plane/admin-data.ts";
import { readV6WorkersSources, v6WorkersSection } from "../../lib/control-plane/admin-view/v6-workers-read.ts";
import { createMemoryRepositories } from "../../lib/control-plane/repository/memory.ts";
import { liveCycleHeartbeat } from "../../lib/control-plane/runner-standing.ts";
import { runDbApply } from "../../scripts/db-apply.mts";
import { ballotPublicationSummary, type BallotPublicationResult } from "../../lib/civic-data/ballot-publication.ts";
import { CandidateCard } from "../../components/ballot/candidate-card.tsx";

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
  ...(scope === "us" ? [] : ["Only work sent to a hunt is split by place. Other queued work is counted for the whole system only, in the lane counts."]),
];

/** Two jobs running now, as the Workers read returns them for a place: both already placed in `scope`. */
const JOBS = (scope: string) => [
  { id: "at-plain", stage: "collecting", title: "Plain-code reader · az:city:hereford", placeKey: scope, hunt: HUNT, requirement: "meeting list",
    startedAt: "2026-09-28T22:02:00.000Z", elapsed: "10 min so far", method: "Plain-code reader", model: "No AI (plain code)", modelWhy: "—", cost: "—", latest: "—", next: "—" },
  { id: "at-scout", stage: "finding", title: "Scout · az:school:palominas", placeKey: scope, hunt: "Shared statewide", requirement: "meeting list",
    startedAt: "2026-09-28T22:08:00.000Z", elapsed: "4 min so far", method: "Scout", model: "Cheapest AI (claude-haiku-4-5-20251001)", modelWhy: "—", cost: "—", latest: "—", next: "—" },
];

function section(scope: string, tries = 9, withJobs: { count: number; system: number; lowerBound: boolean } | null = null) {
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
    data: { status: STATUS, jobs: withJobs ? JOBS(scope) : null, running: withJobs, waiting, events, update: null,
      next: [`${HUNT}: finish the other 51 assigned tasks and pass their checks.`, "The next round was due Sep 28, 6:01 PM ET. No newer start is saved yet."] },
    missingParts: MISSING(scope) };
}

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

const BALLOT_REPORTS: Record<string, BallotPublicationResult> = Object.fromEntries(([
  { state: "TX", titles: ["Governor", "State Representative, District 7"], reason: null },
  { state: "AK", titles: ["U.S. Representative"], reason: null },
  { state: "CA", titles: [], reason: "The source receipt is missing." },
  { state: "ND", titles: [], reason: "The source records a blocked response." },
] as const).map(({ state, titles, reason }): [string, BallotPublicationResult] => [state, {
  kind: "BALLOT_PUBLICATION", state, inputHash: "a".repeat(64), at: READ_AT,
  status: reason ? "HELD" : "PUBLISHED", versionId: reason ? null : `fixture:${state}`,
  merged: reason ? [] : [`${state.toLowerCase()}.json`],
  skipped: reason ? [{ file: `${state.toLowerCase()}.json`, reason }] : [],
  heldContests: titles.map((title, index) => ({ state, contestId: `fixture:${state}:${index}`, title,
    reason: "No candidates have been verified for this contest yet." })), reason,
}]));

async function ballotPublicationPage(state?: string) {
  const scopeKey = state ? `st:${state.toLowerCase()}` : "us";
  const reports = state ? { [state]: BALLOT_REPORTS[state] }
    : Object.fromEntries(Object.entries(BALLOT_REPORTS).map(([key, report]) => [key, ballotPublicationSummary(report)]));
  const sync = new LiveSync({ scope: scopeKey, schedule: () => () => {}, fetch: async () => ({ status: 200, json: async () => ({
    contract: "admin-v6/publication@1", scope: scopeKey, revision: "fixture-ballots", asOf: READ_AT, missingParts: [],
    data: { total: Object.keys(reports).length, counts: [], latestAttemptFailing: 0, notVisible: [], notVisibleHidden: 0,
      ballotPublications: reports },
  }) }) });
  const p = pulse(null);
  sync.onPulse({ ...p, v6: { ...p.v6, sections: { publication: { contract: "admin-v6/publication@1", href: "/api/admin/v6/publication", revision: "fixture-ballots" } } } });
  await settle(sync);
  assert.equal(sync.snapshot().publication.phase, "live");
  return page(sync, state ? { kind: "state", state: state.toLowerCase() } : { kind: "all" }, scopeKey, "workers");
}

test("national Workers shows ballot publication status, held counts and state controls without loading contest names", async () => {
  const html = await ballotPublicationPage();
  const rendered = text(html);
  assert.match(rendered, /TX: Published.*2 incomplete contests\. View TX contests/);
  assert.match(rendered, /AK: Published.*1 incomplete contests\. View AK contests/);
  assert.match(html, /<button[^>]*>View TX contests<\/button>/);
  assert.match(html, /<button[^>]*>View AK contests<\/button>/);
  assert.match(rendered, /CA: Held.*The source receipt is missing\./);
  assert.match(rendered, /ND: Held.*The source records a blocked response\./);
  assert.match(rendered, /Publish ballots/);
  assert.doesNotMatch(rendered, /Governor:|State Representative, District 7:|U\.S\. Representative:/);
});

test("selected-state Workers lists every held contest and preserves each skipped source reason", async () => {
  for (const state of Object.keys(BALLOT_REPORTS)) {
    const report = BALLOT_REPORTS[state];
    const rendered = text(await ballotPublicationPage(state));
    assert.match(rendered, /Publish ballots/);
    for (const held of report.heldContests ?? []) assert.ok(rendered.includes(`${held.title}: ${held.reason}`), `${state}: ${held.title}`);
    for (const skipped of report.skipped) assert.ok(rendered.includes(skipped.reason), `${state}: ${skipped.file}`);
    assert.ok(!rendered.includes(`View ${state} contests`), "the selected state's complete details are already shown");
    for (const other of Object.values(BALLOT_REPORTS).filter(row => row.state !== state)) {
      for (const held of other.heldContests ?? []) assert.ok(!rendered.includes(`${held.title}:`), `${state} must not load ${other.state} contests`);
    }
  }
});

test("a candidate website's displayed host is lowercase while its filed link is preserved", () => {
  const url = "https://ALICE.Example.org/Campaign";
  const html = renderToStaticMarkup(h(CandidateCard, { name: "Fixture Alice", partyLine: "", card: null, links: null, filedSiteUrl: url }));
  assert.match(html, /href="https:\/\/ALICE.Example.org\/Campaign"/);
  assert.match(text(html), /alice.example.org \(as filed\)/);
});

test("parent cycle metadata reaches the existing Workers round through bounded reads and live sync", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(PULSE_AT) });
  try {
    const repos = createMemoryRepositories();
    const b = backend();
    const sync = new LiveSync({ scope: "us", fetch: b.fetch, schedule: () => () => {} });
    for (const ended of [false, true]) {
      const beat = liveCycleHeartbeat(null, {
        at: READ_AT, startedAt: "2026-09-28T22:05:00.000Z", testedSha: "a".repeat(40), host: "runner",
        ...(ended ? { finishedAt: READ_AT, exitCode: null, signal: "SIGTERM", lastError: "SOURCE_READ_FAILED" } : {}),
      });
      const held = await repos.runnerHeartbeat.read(RUNNER_ID);
      if (held) await repos.runnerHeartbeat.compareAndSet(RUNNER_ID, held.revision, beat, READ_AT);
      else await repos.runnerHeartbeat.put(RUNNER_ID, beat, READ_AT);
      const sources = await readV6WorkersSources(repos, READ_AT);
      const reading = v6WorkersSection({ scopeKey: "us", scope: { kind: "country" }, sources });
      assert.ok("data" in reading);
      assert.equal(reading.data.status.lastUsefulProgress, null, "a beat does not invent useful progress");
      b.set(() => ({ status: 200, body: reading }));
      sync.onPulse(pulse(ended ? "cycle-finished" : "cycle-live"));
      await settle(sync);
      const html = page(sync, { kind: "all" }, "us", "workers");
      const rendered = text(html);
      const face = text(html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, ""));
      if (!ended) {
        assert.match(rendered, /Running since 6:05 PM ET/);
        assert.doesNotMatch(rendered, /stopped from outside|ended with an error|SOURCE_READ_FAILED/);
      } else {
        assert.match(face, /Started Sep 28, 6:05 PM ET; finished Sep 28, 6:12 PM ET; it was stopped from outside\./);
        assert.match(face, /The last round ended with an error\./);
        assert.doesNotMatch(face, /SOURCE_READ_FAILED|SIGTERM/, "the error text is not on the face");
        assert.match(rendered, /SOURCE_READ_FAILED/, "it is kept behind Technical details");
        assert.doesNotMatch(rendered, /Running since/);
      }
    }
    const stale = roundReading({ ...STATUS, runnerState: "SILENT", cycle: {
      startedAt: READ_AT, finishedAt: null, exitCode: null, signal: null, lastError: null,
    } }, Date.parse(PULSE_AT));
    assert.equal(stale.headline, "No finish recorded");
  } finally { mock.timers.reset(); }
});

test("a migration failure reaches the existing Workers card through saved history and LiveSync with secrets removed", async () => {
  const repos = createMemoryRepositories();
  const at = PULSE_AT;
  await repos.researchState.put("research-state", { running: [], paused: false, lanes: {} } as never, at);
  const status = await runDbApply(["--target=production", "--phase=expand"], { PRIVATE_TOKEN: "s13-private-token", NODE_ENV: "test" }, {
    head: () => "a".repeat(40), execute: () => ({ status: 1, stdout: "", stderr: "FAIL s13-private-token postgresql://user:password@invalid/db\n" }),
    record: async record => { await repos.ownerDigests.append("owner-digest", record.digestId, record, record.writtenAt); },
  });
  assert.equal(status, 1);
  const reading = v6WorkersSection({ scopeKey: "us", scope: { kind: "country" }, sources: await readV6WorkersSources(repos, at) });
  assert.ok("data" in reading);
  assert.equal(reading.data.status.lastUsefulProgress, null);
  const b = backend(); b.set(() => ({ status: 200, body: reading }));
  const sync = new LiveSync({ scope: "us", fetch: b.fetch, schedule: () => () => {} });
  sync.onPulse(pulse("migration-failed")); await settle(sync);
  const html = page(sync, { kind: "all" }, "us", "workers");
  const rendered = text(html);
  const face = text(html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g, ""));
  assert.match(face, /The latest database update/);
  assert.match(face, /The latest database update did not finish: the step that runs before new code goes live failed\./);
  assert.match(face, /Engineering repairs the step that runs before new code goes live/);
  assert.doesNotMatch(face, /expand: failed|\[private\]/, "the migration's own output is not on the face");
  assert.match(rendered, /expand: failed/, "the migration output is kept behind Technical details");
  assert.match(rendered, /\[private\]/);
  assert.doesNotMatch(rendered, /s13-private-token|password|postgresql:\/\//);
  assert.doesNotMatch(rendered, /Fix this/);
});

test("the saved readback shows on Workers for the country, Arizona and ZIP 85635 with plain labels and numbers", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(PULSE_AT) });
  try {
    for (const [key, scope] of SCOPES) {
      const { sync } = await livePage(key);
      const t = text(page(sync, scope, key, "workers"));
      // What is waiting and why.
      assert.match(t, /51 of 194 assigned tasks not finished/, key);
      assert.match(t, /40 tasks were stopped by a check, and 11 tasks have no finished, checked result yet/, key);
      // One retry loop is one waiting item and one change line, not nine results.
      assert.equal(occurrences(t, "failed tries since"), 1, key);
      assert.equal(occurrences(t, "stopped before publishing 9 times"), 1, key);
      assert.match(t, /Saved reason code: RECEIPT_COUNT_INVALID/, key);
      // Last useful progress has no value: a dash, with no explanation beside it.
      assert.match(t, /Last useful progress[^—]{0,40}— /, key);
      assert.doesNotMatch(t, /No publication or promotion|A check-in only means|A check-in isn’t progress/, key);
      // The round is late, from saved times.
      assert.match(t, /The next round is late/, key);
      assert.match(t, /Last finished 5:58 PM ET/, key);
      assert.match(t, /Workers last checked in Sep 28, 5:58 PM ET about 10 minutes ago/, key);
      // Jobs: no list, so a dash and the lane counts; no explanation paragraphs or notices.
      assert.doesNotMatch(t, /unknown, not zero|Supplied by|DEP-WORKER-ACTIVE-INDEX|Not shown here, and why|Some of this didn’t arrive/, key);
      assert.doesNotMatch(t, /\b0 running · 2,585 waiting/, `${key}: an unknown lane is not summed as 0`);
      assert.match(t, /— running · 2,585 waiting/, key);
      assert.doesNotMatch(t, /Unknown number/, key);
      // The place is named, never its key; whole-system counts carry a plain label, not a note.
      if (key !== "us") assert.ok(!t.includes(key), `${key}: the place is named, not its key`);
      assert.doesNotMatch(t, /Whole system|Across every place|split by place/, key);
      if (key !== "us") assert.match(t, /Work, all places/, key);
      // Version: a dash.
      assert.match(t, /Are the workers on the latest update\? —/, key);
      assert.doesNotMatch(t, /DEP-WORKER-VERSION/, key);
      // Arrived data shows no generic "not arrived" note.
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
    assert.equal(m.progress.length, 0, "no progress is a dash on the page, with no sentence");
    assert.equal(m.jobs.length, 0, "a read that worked leaves no missing part");
    assert.equal(m.events.length, 1);
    assert.equal(m.waiting.length, key === "us" ? 0 : 1);
  }
  assert.deepEqual(missingByCard(["DEP-WORKER-ACTIVE-INDEX: —"]).jobs, ["—"], "a failed jobs read is a dash beside the jobs card");
  assert.deepEqual(missingByCard(["Something new the backend says."]).other, ["Something new the backend says."]);
  assert.deepEqual(missingByCard([SECTION_DEP.workers.need]).other, [], "the stand-in's own note is shown by the page, once");
});

test("running jobs show as a count and a list on Workers, with no explanation text", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(PULSE_AT) });
  try {
    for (const [key, scope] of SCOPES) {
      const b = backend();
      const running = { count: 2, system: key === "us" ? 2 : 41, lowerBound: false };
      b.set((sc) => ({ status: 200, body: section(sc, 9, running) }));
      const sync = new LiveSync({ scope: key, fetch: b.fetch, schedule: () => () => {} });
      sync.onPulse(pulse("w1"));
      await settle(sync);
      const w = text(page(sync, scope, key, "workers"));
      assert.match(w, key === "us" ? /2 working now · 4 waiting/ : /2 working now · 2 waiting/, key);
      assert.match(w, /Plain-code reader · az:city:hereford/, key);
      assert.match(w, /Scout · az:school:palominas/, key);
      assert.ok(w.includes("Using Plain-code reader AI No AI (plain code)"), key);
      assert.match(w, /Collecting 1/, key);
      assert.match(w, /Finding sources 1/, key);
      assert.doesNotMatch(w, /Stop this job|Cost —|Latest —|Next —/, `${key}: a live job shows only what its lease and attempt record`);
      if (key === "us") assert.doesNotMatch(w, /in the whole system/, key);
      else assert.match(w, /41 in the whole system/, key);
    }
  } finally { mock.timers.reset(); }
});

test("a read that stopped at its row limit shows the count as a lower bound", async () => {
  mock.timers.enable({ apis: ["Date"], now: Date.parse(PULSE_AT) });
  try {
    const b = backend();
    b.set((sc) => ({ status: 200, body: section(sc, 9, { count: 2, system: 2, lowerBound: true }) }));
    const sync = new LiveSync({ scope: "us", fetch: b.fetch, schedule: () => () => {} });
    sync.onPulse(pulse("w1"));
    await settle(sync);
    assert.match(text(page(sync, { kind: "all" }, "us", "workers")), /2\+ working now/);
  } finally { mock.timers.reset(); }
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
    assert.doesNotMatch(t, /The detailed Workers reading hasn’t arrived/);
    assert.match(t, /Workers last checked in Sep 28, 5:58 PM ET/, "the pulse's check-in still shows");
    assert.match(t, /Waiting, and why —/, "a list that has not arrived is a dash");
    assert.match(t, /What changed —/);
    assert.doesNotMatch(t, /Nothing is waiting|No recorded changes/);

    // 2. Announced: exactly one read, and the same page shows the real reading.
    sync.onPulse(pulse("w1"));
    await settle(sync);
    assert.equal(b.log.length, 1);
    t = text(page(sync, scope, key, "workers"));
    assert.match(t, /9 failed tries since/);
    assert.doesNotMatch(t, /detailed Workers reading hasn’t arrived/);
    assert.doesNotMatch(t, /Not connected yet\. This part turns on by itself[^.]*\. You don’t need to reload\. The detailed Workers reading/, "no generic note over arrived data");
    assert.doesNotMatch(t, new RegExp(SECTION_DEP.workers.id));

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
    assert.match(t, /Workers last checked in Sep 28, 5:58 PM ET about 10 minutes ago/);
    mock.timers.setTime(Date.parse(PULSE_AT) + 5 * 60_000);
    sync.onPulse(pulse("w2", new Date(Date.now()).toISOString()));
    await settle(sync);
    assert.equal(b.log.length, 2, "an unchanged revision reads nothing");
    t = text(page(sync, scope, key, "workers"));
    assert.match(t, /Workers last checked in Sep 28, 5:58 PM ET about 15 minutes ago/);
    assert.match(t, /The next round is late/);

    // 5. Disconnected: no pulses, the last good reading stays and says so.
    t = text(page(sync, scope, key, "workers", "reconnecting"));
    assert.match(t, /Reconnecting/);
    assert.match(t, /10 failed tries since/);
    assert.match(t, /Read Sep 28, 6:12 PM ET/);

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
    const t = text(page(sync, { kind: "all" }, "us", "workers"));
    assert.doesNotMatch(t, /Nothing is waiting|No recorded changes|Nothing is running|0 jobs working/, `${status} workers`);
    assert.match(t, /Waiting, and why —/, `${status} workers`);
    sync.onPulse(pulse("w1"));
    await settle(sync);
    assert.equal(b.log.length, 1, "a denial is not retried on the same announcement");
  }
});
