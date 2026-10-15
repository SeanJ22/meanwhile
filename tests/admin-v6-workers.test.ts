import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/admin/v6/workers/route.ts";
import { RUNNER_ID } from "../lib/control-plane/admin-data.ts";
import { DEP_WORKER_ACTIVE_INDEX, readV6WorkersSources, v6WorkersGet, v6WorkersSection, validateWorkersQuery, WORKERS_SOURCE_EVENT_LIMIT,
  type AdminV6WorkersView, type V6WorkersSources } from "../lib/control-plane/admin-view/v6-workers-read.ts";
import type { V6Refusal } from "../lib/control-plane/admin-view/v6-hunts-read.ts";
import type { ExpansionScopeDecision } from "../lib/control-plane/expansion/scopes.ts";
import { HUNT_SOURCE_PROGRESS_LOG_KEY, type HuntSourceProgress } from "../lib/control-plane/owner-surface.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import type { RunningJobRow } from "../lib/control-plane/repository/running-jobs.ts";
import type { StateProgress } from "../lib/control-plane/repository/state-progress.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import { ORIGINAL_LIFETIME_HUNT } from "../lib/control-plane/scheduler/hunt-continuation.ts";
import { RESEARCH_STATE_ID } from "../lib/control-plane/scheduler/research-policy.ts";
import { LiveSync, type SyncFetch } from "../app/(admin)/_mw/admin-v6/live-sync.ts";
import { buildLiveBundle } from "../app/(admin)/_mw/admin-v6/live-data.ts";
import { liveReference } from "../app/(admin)/_mw/admin-v6/reference.ts";
import type { AdminV6Data } from "../app/(admin)/_mw/admin-v6/model.ts";
import { indexPlaces, relation } from "../app/(admin)/_mw/admin-v6/places.ts";
import { ADMIN_HOST, PUBLIC_HOST, adminSessionCookie, withAdminSessionKey } from "./admin-session.ts";

const NOW = "2026-09-28T22:00:00.000Z";
const Z85635 = "geo:az.zcta.85635";
/** One saved hunt. */
const ORIGINAL: ExpansionScopeDecision = {
  key: ORIGINAL_LIFETIME_HUNT.key,
  geography: { type: "zcta", geoid: "85635", version: "zcta:2020", label: "ZIP 85635 (Census ZCTA)", stateAbbr: "AZ" },
  priority: 1, budgetUsd: 50, budgetStartedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, sourceWorkVersion: 1,
  note: null, decidedAt: ORIGINAL_LIFETIME_HUNT.budgetStartedAt, decidedBy: "session:owner", receiptId: ORIGINAL_LIFETIME_HUNT.receiptId, previous: null,
};
/** A synthetic second ZIP hunt in another state (two ZCTA GEOIDs never overlap), to prove "outside" comes from saved Sends. */
const NH: ExpansionScopeDecision = {
  ...ORIGINAL, key: "zcta:2020/03301", receiptId: "expansion.scope.set:scope:03301:test",
  geography: { type: "zcta", geoid: "03301", version: "zcta:2020", label: "ZIP 03301 (Census ZCTA)", stateAbbr: "NH" },
  budgetStartedAt: "2026-09-28T01:00:00.000Z", decidedAt: "2026-09-28T01:00:00.000Z",
};

const mark = (d: ExpansionScopeDecision, at = "2026-09-27T23:10:31.451Z") => ({ assignmentKey: d.key, ref: d.receiptId, relation: "REORDERED", at });

/** A repeating loop on one source: QUEUED → COLLECTING_AND_VERIFYING → FAILED. */
function votingSitesLoop(n: number, lastAt = Date.parse("2026-09-28T21:56:48.000Z")): { id: string; p: HuntSourceProgress }[] {
  const stages: HuntSourceProgress["stage"][] = ["FAILED", "COLLECTING_AND_VERIFYING", "QUEUED"];
  return Array.from({ length: n }, (_, i) => {
    const at = new Date(lastAt - i * 100_000).toISOString();
    const stage = stages[i % 3];
    return { id: `cycle-${n - i}:voting-sites:cochise-2026:${stage}`, p: { instructionIds: [ORIGINAL.receiptId], taskId: "voting-sites:cochise-2026",
      sourceId: "voting-sites", scope: "US:voting-sites", stage, at,
      detail: stage === "FAILED" ? "RECEIPT_COUNT_INVALID: Expected exactly one RCD_RECEIPT line; observed 0." : "", candidateId: null, readerPaths: [] } };
  }).reverse();
}

interface ScoutFixture { attemptId: string; obligationId: string; startedAt: string; outcome?: string | null; endedAt?: string | null;
  lease?: { expiresAt: string; released?: boolean; id?: string } | null; marks?: unknown[] | undefined; assignmentKeys?: string[] }

const LIVE: ScoutFixture = { attemptId: "at-live", obligationId: "ob-live", startedAt: "2026-09-28T21:50:00.000Z",
  lease: { expiresAt: "2026-09-28T22:10:00.000Z" }, marks: [mark(ORIGINAL)], assignmentKeys: [ORIGINAL.key] };
const EXPIRED: ScoutFixture = { attemptId: "at-expired", obligationId: "ob-expired", startedAt: "2026-09-28T20:00:00.000Z",
  lease: { expiresAt: "2026-09-28T20:25:00.000Z" }, marks: [mark(ORIGINAL)], assignmentKeys: [ORIGINAL.key] };
const ENDED: ScoutFixture = { attemptId: "at-ended", obligationId: "ob-ended", startedAt: "2026-09-28T21:00:00.000Z",
  outcome: "COMPLETED", endedAt: "2026-09-28T21:20:00.000Z", lease: { expiresAt: "2026-09-28T21:45:00.000Z", released: true },
  marks: [mark(ORIGINAL)], assignmentKeys: [ORIGINAL.key] };
const NH_SCOUT: ScoutFixture = { attemptId: "at-nh", obligationId: "ob-nh", startedAt: "2026-09-28T21:55:00.000Z",
  lease: { expiresAt: "2026-09-28T22:15:00.000Z" }, marks: [mark(NH, "2026-09-28T02:00:00.000Z")], assignmentKeys: [NH.key] };
const UNSENT: ScoutFixture = { attemptId: "at-unsent", obligationId: "ob-unsent", startedAt: "2026-09-28T21:56:00.000Z",
  lease: { expiresAt: "2026-09-28T22:16:00.000Z" }, marks: undefined, assignmentKeys: [] };

const LANES = { at: "2026-09-28T21:52:41.202Z", final: false, autonomous: null,
  model: { due: 1285, dispatched: 1, active: 0, waiting: 1284, skippedBy: null, oldestWaitingDueAt: "2026-08-27T00:00:00.000Z" },
  deterministic: { due: 1303, dispatched: 3, active: null, waiting: 1300, skippedBy: null, oldestWaitingDueAt: "2026-09-15T17:58:43.000Z" } };

const SENDS = { formatVersion: 1, at: "2026-09-28T21:52:41.202Z", costsReadable: true, intentsReadable: true, rule: "",
  assignments: [{ key: ORIGINAL.key, kind: "SCOPE", label: ORIGINAL.geography.label, ref: ORIGINAL.receiptId,
    members: { created: 0, reordered: 194, createdSample: [], reorderedSample: [] },
    budget: { lifetime: true, budgetUsd: 50, windowHours: 24, since: ORIGINAL.budgetStartedAt, until: NOW, spentUsd: 38.49, heldUsd: 8.16,
      leftUsd: 3.35, measuredRows: 400, unmeasuredRows: 0, bySubjectRows: 0, admitted: 1, refused: 4 },
    budgetWhyNot: null,
    completion: { kind: "NOT_COMPLETE", assignmentKey: ORIGINAL.key, members: 194, settled: 20, exceptions: [], refusedCount: 30, unsettledCount: 144 } }] };

/** One live-lease row as the bounded read returns it; `jobs` and `progress` on `world` stand in for the store's two indexed reads. */
interface JobFixture { id: string; startedAt?: string; expiresAt?: string; released?: boolean; attempt?: "open" | "ended" | "none" | "other-lease"; role?: string;
  obligation?: null | { recordClass?: string; subjectId?: string; marks?: { assignmentKey: string; ref: string; at: string }[]; divisions?: string[] } }
const jobMark = (d: ExpansionScopeDecision, at = "2026-09-27T23:10:31.451Z") => ({ assignmentKey: d.key, ref: d.receiptId, at });
function jobRow(f: JobFixture): RunningJobRow {
  const startedAt = f.startedAt ?? "2026-09-28T21:50:00.000Z";
  const leaseId = `ls-${f.id}`;
  const kind = f.attempt ?? "open";
  const o = f.obligation === undefined ? { marks: [jobMark(ORIGINAL)] } : f.obligation;
  return { leaseId, routeTaskId: `rt-${f.id}`, holder: "runner@test", expiresAt: f.expiresAt ?? "2026-09-28T22:10:00.000Z", released: f.released ?? false,
    attempt: kind === "none" ? null : { id: f.id, leaseId: kind === "other-lease" ? "ls-someone-else" : leaseId, startedAt,
      endedAt: kind === "ended" ? "2026-09-28T21:55:00.000Z" : null, outcome: kind === "ended" ? "COMPLETED" : null,
      role: f.role ?? "ACQUIRER", version: f.role === "SCOUT" ? "claude-haiku-5-5-20261001" : "route-executor/1.0", workItemId: `wi-${f.id}` },
    obligation: o === null ? null : { id: `ob-${f.id}`, recordClass: o.recordClass ?? "meetings", subjectId: o.subjectId ?? "body-x", scopeDivisions: o.divisions ?? [], assignments: o.marks ?? [] } };
}

async function world(opts: { scouts?: ScoutFixture[]; sources?: { id: string; p: HuntSourceProgress }[]; scopes?: ExpansionScopeDecision[];
  research?: Record<string, unknown> | null; heartbeat?: Record<string, unknown> | null;
  jobs?: JobFixture[] | { rows: JobFixture[]; truncated: boolean }; progress?: StateProgress | null | "UNAVAILABLE"; progressAsked?: string[] } = {}): Promise<ControlPlaneRepositories> {
  const repos = createMemoryRepositories();
  if (opts.jobs !== undefined) {
    const read = Array.isArray(opts.jobs) ? { rows: opts.jobs, truncated: false } : opts.jobs;
    (repos as { activeWorkClaims: unknown }).activeWorkClaims = { ...repos.activeWorkClaims,
      readRunningJobs: async ({ nowIso }: { nowIso: string }) => ({ available: true, reason: null, asOf: nowIso, limit: 500, truncated: read.truncated, rows: read.rows.map(jobRow) }) };
  }
  if (opts.progress !== undefined) {
    (repos as { activeWorkClaims: unknown }).activeWorkClaims = { ...repos.activeWorkClaims,
      readLatestStateProgress: async ({ state }: { state: string }) => {
        opts.progressAsked?.push(state);
        return opts.progress === "UNAVAILABLE" ? { available: false, reason: "STATE_PROGRESS_UNAVAILABLE", progress: null } : { available: true, reason: null, progress: opts.progress };
      } };
  }
  await repos.adminConfig.put("current", { expansionScopes: opts.scopes ?? [ORIGINAL] } as never, NOW);
  if (opts.heartbeat !== null) await repos.runnerHeartbeat.put(RUNNER_ID, { beatAt: "2026-09-28T21:59:30.000Z", lastCycleStartedAt: "2026-09-28T21:46:34.342Z",
    lastCycleFinishedAt: "2026-09-28T21:30:00.000Z", lastCycleOk: true, nextCycleDueAt: "2026-09-28T22:30:00.000Z", testedSha: "a".repeat(40),
    ...opts.heartbeat } as never, NOW);
  const scouts = opts.scouts ?? [LIVE, EXPIRED, ENDED];
  if (opts.research !== null) await repos.researchState.put(RESEARCH_STATE_ID, { beatAt: "2026-09-28T21:52:41.202Z", cycleStartedAt: "2026-09-28T21:46:34.342Z",
    cycleFinishedAt: null, pausedByOwner: false, queue: { lanes: LANES }, assignments: SENDS,
    running: scouts.map(s => ({ attemptId: s.attemptId, obligationId: s.obligationId, startedAt: s.startedAt,
      ...(s.assignmentKeys ? { assignmentKeys: s.assignmentKeys } : {}) })), ...opts.research } as never, NOW);
  for (const s of scouts) {
    const task = `rt-${s.attemptId}`;
    await repos.attempts.put(s.attemptId, { id: s.attemptId, routeTaskId: task, workItemId: `wi-${s.attemptId}`, leaseId: `ls-${s.attemptId}`,
      worker: { role: "SCOUT", provider: "anthropic", version: "claude-haiku-5-5-20261001", instance: "i" }, startedAt: s.startedAt,
      endedAt: s.endedAt ?? null, outcome: s.outcome ?? null } as never, NOW);
    if (s.lease) await repos.leases.put(task, { id: s.lease.id ?? `ls-${s.attemptId}`, routeTaskId: task, holder: "cycle@test", claimedAt: s.startedAt,
      expiresAt: s.lease.expiresAt, heartbeatAt: s.startedAt, released: s.lease.released ?? false }, NOW);
    await repos.obligations.put(s.obligationId, { id: s.obligationId, recordClass: "meetings", subjectId: "body-x", routeId: null, active: true,
      ...(s.marks ? { assignments: s.marks } : {}) } as never, NOW);
  }
  for (const { id, p } of opts.sources ?? votingSitesLoop(6)) await repos.ownerDigests.append(HUNT_SOURCE_PROGRESS_LOG_KEY, id,
    { formatVersion: 1, digestId: id, writtenAt: p.at, headline: `${p.taskId}: ${p.stage}`, lines: [p.detail], cycleOk: null, testedSha: null, huntSourceProgress: p }, p.at);
  return repos;
}

async function section(scopeKey: string, repos: ControlPlaneRepositories) {
  const q = validateWorkersQuery(new URLSearchParams({ scope: scopeKey }));
  assert.ok(q.ok);
  return v6WorkersSection({ scopeKey, scope: q.scope, sources: await readV6WorkersSources(repos, NOW, q.scope) });
}
function ok(out: unknown): { data: AdminV6WorkersView; missingParts: readonly string[]; revision: string; asOf: string; scope: string; contract: string } {
  assert.ok(out && typeof out === "object" && !("kind" in out), `expected a section, got ${JSON.stringify(out)}`);
  return out as never;
}
function refused(out: unknown): V6Refusal {
  assert.ok(out && typeof out === "object" && "kind" in out, "expected a refusal");
  return out as V6Refusal;
}

/* ------------------------------------------------ running, expired, ended */

test("only an open attempt with its own live lease is running; an expired lease and an ended attempt are not", async () => {
  const s = ok(await section("us", await world()));
  const events = s.data.events ?? [];
  const started = events.filter(e => e.kind === "Paid research started");
  assert.equal(started.length, 1, "the live Scout alone is running");
  assert.match(started[0].text, /running now with Cheapest AI \(Claude Haiku 5\.5\)\. Work claim holds until/);
  const stopped = events.filter(e => e.kind === "No live work claim");
  assert.equal(stopped.length, 1);
  assert.match(stopped[0].text, /its work claim (ran out|is gone)/);
  assert.equal(stopped[0].tone, "warn");
  const ended = events.filter(e => e.kind === "Paid research ended");
  assert.equal(ended.length, 1);
  assert.match(ended[0].text, /ended \(/);
  assert.equal(s.data.jobs, null, "a store with no live-lease read claims no job list, never an empty one");
  assert.equal(s.data.running, null);
  assert.ok(s.missingParts.includes(`${DEP_WORKER_ACTIVE_INDEX}: —`), "the failed read is a dash");
});

test("a released lease, a lease held under another id, and a missing lease never count as running", async () => {
  const released = { ...LIVE, attemptId: "at-rel", obligationId: "ob-rel", lease: { expiresAt: LIVE.lease!.expiresAt, released: true } };
  const swapped = { ...LIVE, attemptId: "at-swap", obligationId: "ob-swap", lease: { expiresAt: LIVE.lease!.expiresAt, id: "ls-someone-else" } };
  const none = { ...LIVE, attemptId: "at-none", obligationId: "ob-none", lease: null };
  const s = ok(await section("us", await world({ scouts: [released, swapped, none] })));
  assert.equal(s.data.events?.filter(e => e.kind === "Paid research started").length, 0);
  assert.equal(s.data.events?.filter(e => e.kind === "No live work claim").length, 3);
});

test("a heartbeat is not progress: a live check-in with only failures leaves last useful progress unreported", async () => {
  const s = ok(await section(Z85635, await world({ scouts: [] })));
  assert.equal(s.data.status.lastCheckIn, "2026-09-28T21:59:30.000Z");
  assert.equal(s.data.status.runnerState, "ALIVE");
  assert.equal(s.data.status.lastUsefulProgress, null);
  assert.ok(!s.missingParts.some(m => /last useful progress|check-in only/i.test(m)), "no progress is a dash on the page, with no sentence beside it");
  assert.equal(s.data.status.roundStartedAt, "2026-09-28T21:46:34.342Z", "a round started after the last finish is in progress");
});

test("a saved publication for the hunt's exact receipt is the last useful progress", async () => {
  const published = { id: "c9:voting-sites:PUBLISHED", p: { ...votingSitesLoop(1)[0].p, stage: "PUBLISHED" as const, at: "2026-09-28T21:58:00.000Z", detail: "" } };
  const s = ok(await section(Z85635, await world({ scouts: [], sources: [...votingSitesLoop(3), published] })));
  assert.equal(s.data.status.lastUsefulProgress?.at, "2026-09-28T21:58:00.000Z");
  assert.match(s.data.status.lastUsefulProgress?.what ?? "", /voting sites source for the ZIP 85635 \(Census ZCTA\) hunt was checked and published/);
});

test("the saved retry loop is one feed line, and a past-due round is not presented as upcoming", async () => {
  const s = ok(await section(Z85635, await world({ scouts: [], sources: votingSitesLoop(25),
    heartbeat: { nextCycleDueAt: "2026-09-28T21:55:00.000Z" } })));
  const voting = (s.data.events ?? []).filter(e => /voting sites/.test(e.text));
  assert.equal(voting.length, 1, "QUEUED → COLLECTING → FAILED repeats are one line about the newest state");
  assert.match(voting[0].text, /stopped before publishing 9 times since/);
  assert.ok(s.data.next?.includes("Next round was due Sep 28, 5:55 PM ET."));
  assert.ok(!(s.data.next ?? []).some(n => /Next round due/.test(n)));
});

/* ------------------------------------------------------- place binding */

test("the 85635 hunt's work is bound by its exact original receipt; other hunts and unsent work stay out", async () => {
  const repos = await world({ scouts: [LIVE, NH_SCOUT, UNSENT], scopes: [ORIGINAL, NH] });
  const s = ok(await section(Z85635, repos));
  const started = (s.data.events ?? []).filter(e => e.kind === "Paid research started");
  assert.equal(started.length, 1, "only the Scout whose obligation carries the 85635 Send");
  assert.match(started[0].text, /ZIP 85635/);
  assert.ok(s.data.events!.every(e => e.applies.length === 1 && e.applies[0] === Z85635));
  assert.ok(s.missingParts.some(m => /1 listed paid research job could not be placed/.test(m)), "unsent work is unknown here, not dropped silently");
  const nh = ok(await section("st:nh", repos));
  assert.equal(nh.data.events?.filter(e => e.kind === "Paid research started").length, 1);
  assert.ok(!(nh.data.events ?? []).some(e => /voting sites/.test(e.text)), "the 85635 source receipts are outside New Hampshire");
  const whole = ok(await section("us", repos));
  assert.equal(whole.data.events?.filter(e => e.kind === "Paid research started").length, 3);
});

test("a Send mark made after the Scout started, or with a different receipt, does not place it", async () => {
  const late = { ...LIVE, attemptId: "at-late", obligationId: "ob-late", marks: [mark(ORIGINAL, "2026-09-28T21:55:00.000Z")] };
  const other = { ...LIVE, attemptId: "at-other", obligationId: "ob-other", marks: [{ ...mark(ORIGINAL), ref: "expansion.scope.set:scope:85635:someone-else" }] };
  const s = ok(await section(Z85635, await world({ scouts: [late, other] })));
  assert.equal(s.data.events?.filter(e => e.kind === "Paid research started").length ?? 0, 0);
  assert.ok(s.missingParts.some(m => /2 listed paid research jobs could not be placed/.test(m)));
});

test("an unbound place refuses 409 instead of guessing from a breadcrumb or prefix", async () => {
  const repos = await world();
  for (const key of ["body:hereford-nrcd", "geo:az.county.04003"]) {
    const r = refused(await section(key, repos));
    assert.equal(r.status, 409, key);
    assert.equal(r.code, "SCOPE_BINDING_NOT_CONNECTED");
  }
});

/* ---------------------------------------------- waiting, next, and unknowns */

test("waiting explains the hunt's unfinished tasks, its money limit and the failing source in plain words", async () => {
  const s = ok(await section(Z85635, await world({ scouts: [] })));
  const w = s.data.waiting ?? [];
  const unfinished = w.find(x => x.kind === "Not finished");
  assert.equal(unfinished?.title, "ZIP 85635 (Census ZCTA) hunt: 174 of 194 assigned tasks not finished");
  assert.match(unfinished!.why, /30 tasks stopped by a check · 144 tasks unfinished/);
  assert.match(w.find(x => x.kind === "Money limit")?.why ?? "", /\$3\.35 left of the \$50\.00 limit · \$8\.16 held/);
  const failing = w.find(x => x.kind === "Keeps failing");
  assert.match(failing?.title ?? "", /voting sites source .*: 2 failed tries since/);
  assert.match(failing!.why, /No receipt was saved/);
  assert.ok(!w.some(x => x.kind === "In line"), "whole-system queue counts are not presented as this ZIP's waiting work");
  assert.ok(s.missingParts.some(m => /Only work sent to a hunt is split by place/.test(m)));
  assert.ok(s.data.next?.some(n => /174 assigned tasks to finish/.test(n)));
  assert.ok(s.data.next?.some(n => /Next round due Sep 28, 6:30 PM ET/.test(n)));
});

test("the whole country lists queue lanes as waiting, with the oldest due time", async () => {
  const s = ok(await section("us", await world({ scouts: [] })));
  const lanes = (s.data.waiting ?? []).filter(x => x.kind === "In line");
  assert.equal(lanes.length, 2);
  assert.ok(lanes.some(x => /1,284 tasks waiting: paid research \(scout\)/.test(x.title)));
  assert.equal(s.data.status.lanes?.length, 2);
  assert.equal(s.data.status.lanes?.find(l => /Plain-code/.test(l.name))?.active, null, "an unrecorded in-flight count stays unknown");
});

test("missing readings are unknown, never zero or an empty list", async () => {
  const empty = ok(await section("us", await world({ research: { running: undefined, queue: undefined, assignments: undefined }, sources: [], scouts: [] })));
  assert.equal(empty.data.status.lanes, null);
  assert.equal(empty.data.waiting, null, "without queue counts, nothing-waiting is not proven");
  assert.equal(empty.data.events, null, "no recorded changes is never claimed");
  assert.ok(empty.data.status.unread.includes("the queue counts"));
  const noState = ok(await section("us", await world({ research: null, heartbeat: null, scouts: [] })));
  assert.equal(noState.data.status.lastCheckIn, null);
  assert.equal(noState.data.status.runnerState, "NEVER_BEAT");
  assert.ok(!(noState.data.waiting ?? []).some(x => x.kind === "In line" || x.kind === "Not finished"), "no queue or hunt reading means no such items");
  assert.ok((noState.data.waiting ?? []).some(x => x.kind === "Keeps failing"), "a proven source failure is still shown");
  const place = ok(await section("st:nm", await world({ scouts: [], sources: [] })));
  assert.equal(place.data.waiting, null, "a place with no hunt cannot claim that nothing waits there");
});

test("incomplete reads are named: an unreadable attempt, an oversize running list, a full receipt page, an unread log", async () => {
  const repos = await world();
  const flaky: ControlPlaneRepositories = { ...repos, attempts: { ...repos.attempts,
    readNarrowed: async (id, p) => { if (id === EXPIRED.attemptId) throw Error("postgresql://private"); return repos.attempts.readNarrowed(id, p); } } };
  const one = ok(await section("us", flaky));
  assert.ok(one.missingParts.some(m => /1 listed paid research job could not be checked/.test(m)));
  assert.doesNotMatch(JSON.stringify(one), /postgresql|private/);

  const big = Array.from({ length: 17 }, (_, i) => ({ ...LIVE, attemptId: `at-${i}`, obligationId: `ob-${i}` }));
  const over = ok(await section("us", await world({ scouts: big })));
  assert.ok(over.missingParts.some(m => /not a valid bounded list/.test(m)));
  assert.ok(!(over.data.events ?? []).some(e => e.kind === "Paid research started"));

  const full = ok(await section("us", await world({ scouts: [], sources: votingSitesLoop(40) })));
  assert.ok(full.missingParts.some(m => new RegExp(`Only the newest ${WORKERS_SOURCE_EVENT_LIMIT} source receipts are read`).test(m)));

  const noLog: ControlPlaneRepositories = { ...repos, ownerDigests: { ...repos.ownerDigests, readRecent: async () => { throw Error("down"); } } };
  const unreadLog = ok(await section(Z85635, noLog));
  assert.ok(unreadLog.data.status.unread.includes("the recent source receipts"));
  assert.ok(!(unreadLog.data.waiting ?? []).some(x => x.kind === "Keeps failing"));
});

test("an unreadable research state is 503; an unreadable hunt list is 503 for a place and not needed for the country", async () => {
  const repos = await world();
  const noResearch = { ...repos, researchState: { ...repos.researchState, readNarrowed: async () => { throw Error("x"); } } };
  assert.equal(refused(await section("us", noResearch)).code, "WORKER_STATE_UNREAD");
  const noConfig = { ...repos, adminConfig: { ...repos.adminConfig, read: async () => { throw Error("x"); } } };
  const r = refused(await section("st:az", noConfig));
  assert.equal(r.status, 503);
  assert.equal(r.code, "HUNT_LIST_UNREAD");
  ok(await section("us", noConfig));
});

test("reads stay bounded: no list, no whole-log read, no filtered scan", async () => {
  const repos = await world({ scouts: [LIVE, EXPIRED, ENDED, NH_SCOUT, UNSENT], scopes: [ORIGINAL, NH] });
  const calls: string[] = [];
  const guard = <T extends object>(name: string, store: T): T => new Proxy(store, { get(target, prop, recv) {
    const v = Reflect.get(target, prop, recv);
    if (typeof v !== "function") return v;
    return (...args: unknown[]) => {
      calls.push(`${name}.${String(prop)}`);
      if (["list", "listWhere", "readAll", "keys", "readWhere"].includes(String(prop))) throw Error(`unbounded ${name}.${String(prop)}`);
      if (prop === "readRecentWhere") {
        assert.equal(args[0], "owner-digest");
        if ((args[1] as string[])[0] === "headline") assert.equal(args[2], "Production migrations");
        else { assert.deepEqual(args[1], ["migration", "phase"]); assert.ok(["expand", "contract"].includes(args[2] as string)); }
        assert.equal(args[3], 1);
        assert.deepEqual(args[4], { headline: true, writtenAt: true, migration: ["phase", "state", "summary", "targetHost"] });
      }
      return (v as (...a: unknown[]) => unknown).apply(target, args);
    };
  } });
  const wrapped = Object.fromEntries(Object.entries(repos).map(([k, v]) => [k, v && typeof v === "object" ? guard(k, v) : v])) as unknown as ControlPlaneRepositories;
  ok(await section("us", wrapped));
  assert.ok(calls.filter(c => c.startsWith("attempts.")).length <= 16);
  assert.deepEqual(calls.filter(c => c.startsWith("ownerDigests.")), ["ownerDigests.readRecent", "ownerDigests.readRecentWhere", "ownerDigests.readRecentWhere", "ownerDigests.readRecentWhere"]);
});

test("automatic migration outcomes use the existing deploy card and do not become source delivery", async () => {
  const repos = await world({ sources: [] });
  await repos.ownerDigests.append("owner-digest", "migration-1", { formatVersion: 1, digestId: "migration-1",
    writtenAt: NOW, headline: "Production migrations", lines: [], cycleOk: false, testedSha: "a".repeat(40),
    migration: { phase: "expand", state: "REFUSED", summary: "Committed journal mismatch; old deploy remains serving.",
      targetHost: "ep-dry-river-axwtolzc" } } as never, NOW);
  const result = ok(await section("us", repos));
  assert.equal(result.data.update?.status, "REFUSED");
  assert.equal(result.data.update?.fixId, null);
  assert.equal(result.data.status.lastUsefulProgress, null);
  assert.equal(result.data.update?.what, "The latest database update did not finish: the step that runs before new code goes live was refused.", "the face says what happened in words");
  assert.match(result.data.update?.technical.join("\n") ?? "", /Committed journal mismatch/, "the migration's own output is kept for the details");
  for (let i = 0; i < 3; i++) {
    const writtenAt = new Date(Date.parse(NOW) + (i + 1) * 1000).toISOString();
    await repos.ownerDigests.append("owner-digest", `contract-${i}`, { formatVersion: 1, digestId: `contract-${i}`,
      writtenAt, headline: "Production migrations", lines: [], cycleOk: true, testedSha: "b".repeat(40),
      migration: { phase: "contract", state: "SUCCEEDED", summary: `Contract reading ${i}`,
        targetHost: "ep-dry-river-axwtolzc" } } as never, writtenAt);
  }
  const later = ok(await section("us", repos));
  assert.equal(later.data.update?.status, "REFUSED", "repeated contract success cannot hide an expand refusal");
  assert.match(later.data.update?.technical.join("\n") ?? "", /Committed journal mismatch/);
  assert.match(later.data.update?.technical.join("\n") ?? "", /Contract reading 2/);
  assert.doesNotMatch(later.data.update?.technical.join("\n") ?? "", /Contract reading [01]/);
  await repos.ownerDigests.append("owner-digest", "invalid-phase", { formatVersion: 1, digestId: "invalid-phase",
    writtenAt: new Date(Date.parse(NOW) + 4000).toISOString(), headline: "Production migrations", lines: [], cycleOk: false,
    testedSha: "c".repeat(40), migration: { phase: "all", state: "REFUSED", summary: "Production needs an explicit phase.",
      targetHost: "ep-dry-river-axwtolzc" } } as never, new Date(Date.parse(NOW) + 4000).toISOString());
  const invalid = ok(await section("us", repos));
  assert.match(invalid.data.update?.technical.join("\n") ?? "", /Production needs an explicit phase/);
  assert.match(invalid.data.update?.technical.join("\n") ?? "", /Committed journal mismatch/);
});

test("the revision follows saved sources, not the clock or a lease renewal", async () => {
  const a = ok(await section("us", await world()));
  const b = ok(await section("us", await world()));
  assert.equal(a.revision, b.revision);
  const renewed = ok(await section("us", await world({ scouts: [{ ...LIVE, lease: { expiresAt: "2026-09-28T22:40:00.000Z" } }, EXPIRED, ENDED] })));
  assert.equal(renewed.revision, a.revision, "a renewed claim is a heartbeat, not a change");
  const expiredNow = ok(await section("us", await world({ scouts: [{ ...LIVE, lease: { expiresAt: "2026-09-28T21:59:00.000Z" } }, EXPIRED, ENDED] })));
  assert.notEqual(expiredNow.revision, a.revision, "running → stopped is a change");
});

/* ------------------------------------------------------- jobs running now */

const ids = (out: unknown) => ok(out).data.jobs?.map(j => j.id) ?? null;

test("a job is running only with an open attempt on its own unreleased, unexpired lease", async () => {
  const repos = await world({ scouts: [], jobs: [
    { id: "at-run" },
    { id: "at-lease-expired", expiresAt: "2026-09-28T21:59:59.000Z" },
    { id: "at-lease-released", released: true },
    { id: "at-attempt-closed", attempt: "ended" },
    { id: "at-no-attempt", attempt: "none" },
    { id: "at-other-lease", attempt: "other-lease" },
  ] });
  const out = ok(await section("us", repos));
  assert.deepEqual(out.data.jobs?.map(j => j.id), ["at-run"]);
  assert.deepEqual(out.data.running, { count: 1, system: 1, lowerBound: false });
  const job = out.data.jobs![0];
  assert.equal(job.stage, "collecting");
  assert.equal(job.title, "Plain-code reader · body-x");
  assert.equal(job.model, "No AI (plain code)");
  assert.equal(job.hunt, "ZIP 85635 (Census ZCTA) hunt");
  assert.equal(job.requirement, "meeting list");
  assert.equal(job.elapsed, "10 min so far");
  assert.equal(job.startedAt, "2026-09-28T21:50:00.000Z");
  assert.ok(!out.missingParts.some(m => m.startsWith(DEP_WORKER_ACTIVE_INDEX)), "a read that worked leaves no missing part");
  assert.ok(!JSON.stringify(out.missingParts).includes("plain-code collection jobs run outside"));
});

test("a Scout is a running job too, with its model named", async () => {
  const out = ok(await section("us", await world({ scouts: [], jobs: [{ id: "at-scout", role: "SCOUT" }] })));
  assert.equal(out.data.jobs?.[0].stage, "finding");
  assert.equal(out.data.jobs?.[0].model, "Cheapest AI (Claude Haiku 5.5)");
  assert.equal(out.data.jobs?.[0].title, "Scout · body-x");
});

test("a job is placed on a place only by the exact Send (key and original receipt) its obligation carries", async () => {
  const repos = await world({ scouts: [], scopes: [ORIGINAL, NH], jobs: [
    { id: "at-az", obligation: { marks: [jobMark(ORIGINAL)] } },
    { id: "at-nh", obligation: { marks: [jobMark(NH, "2026-09-28T02:00:00.000Z")] } },
    { id: "at-late-mark", obligation: { marks: [jobMark(ORIGINAL, "2026-09-28T21:55:00.000Z")] } },
    { id: "at-other-receipt", obligation: { marks: [{ ...jobMark(ORIGINAL), ref: "expansion.scope.set:scope:85635:someone-else" }] } },
    { id: "at-no-marks", obligation: { marks: [] } },
    { id: "at-no-obligation", obligation: null },
  ] });
  const zip = ok(await section(Z85635, repos));
  assert.deepEqual(zip.data.jobs?.map(j => j.id), ["at-az"], "only the job whose obligation carries the 85635 Send");
  assert.deepEqual(zip.data.running, { count: 1, system: 6, lowerBound: false }, "unplaced jobs are in the system count, not the ZIP's");
  assert.equal(zip.data.jobs?.[0].placeKey, Z85635);
  assert.deepEqual(ids(await section("st:az", repos)), ["at-az"]);
  assert.deepEqual(ids(await section("st:nh", repos)), ["at-nh"], "a job in another hunt shows only in its own state");
  const whole = ok(await section("us", repos));
  assert.equal(whole.data.jobs?.length, 6, "the whole system lists every running job, placed or not");
  assert.deepEqual(whole.data.running, { count: 6, system: 6, lowerBound: false });
  const unplaced = whole.data.jobs!.filter(j => ["at-late-mark", "at-other-receipt", "at-no-marks", "at-no-obligation"].includes(j.id));
  assert.equal(unplaced.length, 4);
  assert.ok(unplaced.every(j => j.hunt === "—" && j.requirement === (j.id === "at-no-obligation" ? "—" : "meeting list")), "an unplaced job names no hunt");
});

test("a job the Send marks cannot place is counted for the whole system only", async () => {
  const repos = await world({ scouts: [], jobs: [{ id: "at-stray", obligation: { marks: [] } }, { id: "at-none", obligation: null }, { id: "at-az" }] });
  for (const scope of [Z85635, "st:az"]) {
    const out = ok(await section(scope, repos));
    assert.deepEqual(out.data.running, { count: 1, system: 3, lowerBound: false }, scope);
    assert.ok(!out.data.jobs?.some(j => j.id === "at-stray" || j.id === "at-none"), scope);
  }
  assert.equal(ok(await section("us", repos)).data.running?.count, 3);
});

test("declared scope divisions place shared work: the country everywhere, a state in its own state and its ZIPs, a part of a state in the state only", async () => {
  const repos = await world({ scouts: [], jobs: [
    { id: "at-national", obligation: { marks: [], divisions: ["ocd-division/country:us"] } },
    { id: "at-az-wide", obligation: { marks: [], divisions: ["ocd-division/country:us/state:az"] } },
    { id: "at-az-county", obligation: { marks: [], divisions: ["ocd-division/country:us/state:az/county:cochise"] } },
    { id: "at-nh-wide", obligation: { marks: [], divisions: ["ocd-division/country:us/state:nh"] } },
  ] });
  assert.deepEqual(ids(await section("st:az", repos))?.sort(), ["at-az-county", "at-az-wide", "at-national"]);
  assert.deepEqual(ids(await section(Z85635, repos))?.sort(), ["at-az-wide", "at-national"], "a part of a state cannot be placed in a ZIP");
  assert.deepEqual(ids(await section("st:nh", repos))?.sort(), ["at-national", "at-nh-wide"]);
  assert.equal(ok(await section("us", repos)).data.jobs?.length, 4);
  const az = ok(await section("st:az", repos)).data.jobs!;
  assert.equal(az.find(j => j.id === "at-national")?.hunt, "Shared national");
  assert.equal(az.find(j => j.id === "at-az-wide")?.hunt, "Shared statewide");
});

test("a read that reached its row limit says every count is a lower bound; a failed read is a dash, never an empty list", async () => {
  const cut = ok(await section("us", await world({ scouts: [], jobs: { rows: [{ id: "at-1" }, { id: "at-2" }], truncated: true } })));
  assert.deepEqual(cut.data.running, { count: 2, system: 2, lowerBound: true });
  assert.equal(cut.data.jobs?.length, 2);
  const repos = await world({ scouts: [] });
  const broken = { ...repos, activeWorkClaims: { ...repos.activeWorkClaims, readRunningJobs: async () => { throw Error("postgresql://private"); } } } as unknown as ControlPlaneRepositories;
  const out = ok(await section("us", broken));
  assert.equal(out.data.jobs, null);
  assert.equal(out.data.running, null);
  assert.ok(out.missingParts.includes(`${DEP_WORKER_ACTIVE_INDEX}: —`));
  assert.doesNotMatch(JSON.stringify(out), /postgresql|private/);
  const empty = ok(await section("us", await world({ scouts: [], jobs: [] })));
  assert.deepEqual(empty.data.jobs, [], "a read that worked and found nothing running is an empty list");
  assert.deepEqual(empty.data.running, { count: 0, system: 0, lowerBound: false });
});

test("at a state, last useful progress is the latest verified result in that state, else nothing", async () => {
  const progress: StateProgress = { at: "2026-09-27T12:00:00.000Z", kind: "PROMOTION", subject: "az:2026:state-az:governor:hobbs-katie", detail: "candidate-enrichment" };
  const asked: string[] = [];
  const st = ok(await section("st:az", await world({ scouts: [], progress, progressAsked: asked })));
  assert.deepEqual(st.data.status.lastUsefulProgress, { at: progress.at, what: "Approved for promotion · candidate record · az:2026:state-az:governor:hobbs-katie" });
  assert.deepEqual(asked, ["az"]);
  assert.ok(!st.missingParts.some(m => /publication or promotion|last useful progress/i.test(m)), "no sentence beside the figure");
  for (const scope of ["us", Z85635]) {
    const out = ok(await section(scope, await world({ scouts: [], progress, progressAsked: asked })));
    assert.equal(out.data.status.lastUsefulProgress, null, `${scope}: only a state reads state progress`);
  }
  assert.deepEqual(asked, ["az"], "the state read is asked for a state and nowhere else");
  const validated: StateProgress = { at: "2026-09-28T01:00:00.000Z", kind: "WORKER_RESULT", subject: "az:city:phoenix", detail: "VALIDATOR" };
  assert.equal(ok(await section("st:az", await world({ scouts: [], progress: validated }))).data.status.lastUsefulProgress?.what, "Validator passed · az:city:phoenix");
  const none = ok(await section("st:az", await world({ scouts: [], progress: null })));
  assert.equal(none.data.status.lastUsefulProgress, null);
  assert.deepEqual(none.data.status.unread, []);
  const down = ok(await section("st:az", await world({ scouts: [], progress: "UNAVAILABLE" })));
  assert.equal(down.data.status.lastUsefulProgress, null);
  assert.ok(down.data.status.unread.includes("the latest verified result in this state"));
});

test("a newer saved publication beats an older verified result, and the other way round", async () => {
  const published = { id: "c9:voting-sites:PUBLISHED", p: { ...votingSitesLoop(1)[0].p, stage: "PUBLISHED" as const, at: "2026-09-28T21:58:00.000Z", detail: "" } };
  const older: StateProgress = { at: "2026-09-28T10:00:00.000Z", kind: "PROMOTION", subject: "az:2026:x", detail: "candidate-enrichment" };
  const newer: StateProgress = { ...older, at: "2026-09-28T21:59:00.000Z" };
  const a = ok(await section("st:az", await world({ scouts: [], sources: [published], progress: older })));
  assert.equal(a.data.status.lastUsefulProgress?.at, "2026-09-28T21:58:00.000Z");
  const b = ok(await section("st:az", await world({ scouts: [], sources: [published], progress: newer })));
  assert.equal(b.data.status.lastUsefulProgress?.at, "2026-09-28T21:59:00.000Z");
});

test("the revision follows which jobs run, not a lease renewal", async () => {
  const a = ok(await section("us", await world({ scouts: [], jobs: [{ id: "at-1" }] })));
  const renewed = ok(await section("us", await world({ scouts: [], jobs: [{ id: "at-1", expiresAt: "2026-09-28T22:50:00.000Z" }] })));
  assert.equal(renewed.revision, a.revision);
  const more = ok(await section("us", await world({ scouts: [], jobs: [{ id: "at-1" }, { id: "at-2" }] })));
  assert.notEqual(more.revision, a.revision);
});

/* --------------------------------------------------------------- the route */

test("route: public 404, unauthenticated 401, strict query 400, unbound 409, unread 503, private no-store 200", async () => {
  const path = "/api/admin/v6/workers?scope=us";
  assert.equal((await GET(new NextRequest(`https://${PUBLIC_HOST}${path}`, { headers: { host: PUBLIC_HOST } }))).status, 404);
  const anon = await GET(new NextRequest(`https://${ADMIN_HOST}${path}`, { headers: { host: ADMIN_HOST } }));
  assert.equal(anon.status, 401);
  assert.match(anon.headers.get("cache-control") ?? "", /private, no-store/);
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const req = (suffix: string) => new NextRequest(`https://${ADMIN_HOST}${suffix}`, { headers: { host: ADMIN_HOST, cookie } });
    for (const bad of ["?scope=us&period=whole-hunt", "?scope=us&scope=us", "?scope=AZ", "?", `?scope=${"x".repeat(80)}`]) {
      const res = await GET(req(`/api/admin/v6/workers${bad}`));
      assert.equal(res.status, 400, bad);
    }
    const body = await GET(req("/api/admin/v6/workers?scope=body%3Ahereford-nrcd"));
    assert.equal(body.status, 409);
    assert.equal((await body.json()).code, "SCOPE_BINDING_NOT_CONNECTED");
    const saved = process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    delete process.env.WTP_CONTROL_PLANE_DATABASE_URL;
    try {
      const unread = await GET(req(path));
      assert.equal(unread.status, 503, "an unconfigured control plane is unread, never an empty section");
      assert.match(unread.headers.get("cache-control") ?? "", /private, no-store/);
    } finally { if (saved !== undefined) process.env.WTP_CONTROL_PLANE_DATABASE_URL = saved; }
    const repos = await world();
    const res = await v6WorkersGet(req(`/api/admin/v6/workers?scope=${encodeURIComponent(Z85635)}`), { open: async () => ({ ok: true as const, repos }), now: () => NOW });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("cache-control") ?? "", /private, no-store/);
    const json = await res.json();
    assert.equal(json.contract, "admin-v6/workers@1");
    assert.equal(json.scope, Z85635);
    assert.equal(json.asOf, NOW);
    assert.deepEqual(Object.keys(json.data).sort(), ["events", "jobs", "next", "running", "status", "update", "waiting"]);
  });
});

/* ------------------------------------------------ the page reads this section */

test("an open v6 page picks up the Workers section through LiveSync and shows every row for its place", async () => {
  const repos = await world({ scouts: [LIVE, EXPIRED, NH_SCOUT], scopes: [ORIGINAL, NH],
    jobs: [{ id: "at-live-job", obligation: { marks: [jobMark(ORIGINAL)] } }, { id: "at-other-job", obligation: null }] });
  const open = async () => ({ ok: true as const, repos });
  await withAdminSessionKey(async () => {
    const cookie = await adminSessionCookie();
    const fetch: SyncFetch = async (url) => {
      const res = await v6WorkersGet(new NextRequest(`https://${ADMIN_HOST}${url}`, { headers: { host: ADMIN_HOST, cookie } }), { open, now: () => NOW });
      return { status: res.status, json: async () => res.json() };
    };
    for (const [scope, mw] of [[Z85635, { kind: "geo", type: "zcta", geoid: "85635", state: "az" }], ["st:az", { kind: "state", state: "az" }], ["us", { kind: "us" }]] as const) {
      const sync = new LiveSync({ scope, fetch, schedule: () => () => {} });
      sync.onPulse({ revision: "r1", at: NOW, v6: { version: 1, actions: {}, sections: {
        workers: { contract: "admin-v6/workers@1", href: "/api/admin/v6/workers", revision: "w1" } } } });
      for (let i = 0; i < 20 && sync.snapshot().workers.phase !== "live"; i++) await new Promise(r => setTimeout(r, 5));
      assert.equal(sync.snapshot().workers.phase, "live", scope);
      const ref = liveReference({ scope: mw as never, observedAt: NOW });
      const bundle = buildLiveBundle(sync.snapshot(), ref, null as never);
      const w = bundle.workers.data!;
      const index = indexPlaces(bundle.places.data ?? []);
      // The Workers screen filters by `relation(index, applies, scopeKey)`; nothing proven here may vanish.
      assert.equal(w.events?.filter(e => relation(index, e.applies, scope) !== null).length, w.events?.length, scope);
      assert.equal(w.waiting?.filter(x => relation(index, x.applies, scope) !== null).length, w.waiting?.length, scope);
      const expected = scope === "us" ? 2 : 1;
      assert.equal(w.jobs?.length, expected, scope);
      assert.equal(w.jobs?.filter(j => relation(index, [j.placeKey], scope) !== null).length, w.jobs?.length, scope);
      assert.deepEqual(w.running, { count: expected, system: 2, lowerBound: false }, scope);
      assert.ok(!bundle.workers.missingParts?.some(m => m.startsWith(DEP_WORKER_ACTIVE_INDEX)), scope);
    }
  });
});

// Compile-time proof the backend shape is the UI's shape (tsc checks tests).
const _workersFit = (w: AdminV6WorkersView): NonNullable<AdminV6Data["workers"]["data"]> => w;
void _workersFit;
const _sources = (s: V6WorkersSources) => s;
void _sources;

test("an open round with nothing started or reported for ten minutes is stuck since its last sign of life; a source receipt or a running job is life", async () => {
  const stuck = ok(await section("us", await world({ scouts: [], jobs: [], sources: [] }))).data.status;
  assert.equal(stuck.noProgressSince, "2026-09-28T21:46:34.342Z", "no phase, worker or receipt since the round started 13 minutes ago");
  const lastReceipt = votingSitesLoop(1, Date.parse("2026-09-28T21:49:00.000Z"));
  assert.equal(ok(await section("us", await world({ scouts: [], jobs: [], sources: lastReceipt }))).data.status.noProgressSince, "2026-09-28T21:49:00.000Z", "since the newest receipt after the round started");
  assert.equal(ok(await section("us", await world({ scouts: [], jobs: [], sources: votingSitesLoop(1, Date.parse("2026-09-28T21:57:00.000Z")) }))).data.status.noProgressSince, null, "a receipt three minutes ago is progress");
  assert.equal(ok(await section("us", await world())).data.status.noProgressSince, null, "a Scout running now is not a stuck round");
  const idle = ok(await section("us", await world({ scouts: [], jobs: [], sources: [], heartbeat: { lastCycleFinishedAt: "2026-09-28T21:55:00.000Z" } }))).data.status;
  assert.equal(idle.noProgressSince, null, "a finished round is not stuck");
});

test("only paid jobs the safety checks refused are counted (other deferrals are not), with the reason in plain words", async () => {
  const some = ok(await section("us", await world({ research: { fleetSafety: { deferred: [
    { work: "a", code: "UNMEASURED_MODEL_SPEND", why: "rolling-24-hour model spend is unmeasured" }, { work: "b", code: "UNMEASURED_MODEL_SPEND", why: "x" }, { work: "c", code: "OWNER_PAUSED", why: "y" }, { work: "d", code: "awaiting adapter", why: "z" }, { work: "e", code: "lane disabled", why: "z" }] } } }))).data.status;
  assert.deepEqual(some.refused, { count: 3, why: "the spending total is unknown; paid research is paused" });
  assert.equal(ok(await section("us", await world())).data.status.refused, null, "nothing deferred is no line at all");
});
