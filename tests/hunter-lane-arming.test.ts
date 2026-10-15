import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { recordCost } from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import { ADMIN_CONFIG_ID, defaultAdminConfig, withFleetSpendCeiling } from "../lib/control-plane/gateway/admin-config.ts";
import { ModelProviderQueue } from "../lib/control-plane/scheduler/model-lane.ts";
import { backgroundBatchTransport } from "../lib/control-plane/model-batch.ts";
import { SendBudgetRefusal, committedUsd, releaseOpenJobs } from "../lib/control-plane/expansion/spend-holds.ts";
import { modelRequestWorstCaseUsd } from "../lib/control-plane/fleet-safety.ts";
import {
  HUNTER_LANE_ARMING_MAX_AGE_MS,
  LaneOwnSpend,
  armHunterLane,
  hunterLaneArmingPath,
  laneArmingOf,
  laneWorkerTransport,
  readLaneArming,
  type ArmedHunterLane,
} from "../lib/control-plane/workers/hunter-lane-arming.ts";
import { writeLaneArming } from "../lib/control-plane/workers/hunter-lane-arming-writer.ts";
import { openArmingDatabase } from "../lib/control-plane/workers/hunter-lane-arming-index.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import { modelRequestBoundFor, type CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";

const NOW = "2026-10-06T03:00:00.000Z";
const request = { model: MODELS.haiku.model, max_tokens: 1_024, system: [], tools: [], messages: [{ role: "user", content: "x" }] } as unknown as ModelRequest;
const SEND = "county:2020/33011";
const jurisdiction = { subjectId: "ocd-division/country:us/state:nh/county:hillsborough", state: "NH" };

function reading(overrides: { readAt?: string; historicalUsd?: number | null; knownKeys?: string[]; budgetUsd?: number } = {}) {
  return laneArmingOf({
    readAt: overrides.readAt ?? NOW,
    specs: [{ key: SEND, kind: "SCOPE", label: "Hillsborough County", ref: "receipt-1", budgetUsd: overrides.budgetUsd ?? 5, sentAt: "2026-10-05T00:00:00.000Z" }],
    historical: overrides.historicalUsd === null ? null : new Map([[SEND, { usd: overrides.historicalUsd ?? 0 } as never]]),
    knownKeys: overrides.knownKeys ?? [SEND], reached: new Map(), areas: null, lifetimeHuntSubjects: [],
    circuits: [], worstCaseUsd: 1,
  });
}

async function lane(options: { arming?: ReturnType<typeof reading> | "missing" | "garbage"; costs?: CostEntry[]; marks?: string[];
  ceilingUsd?: number; runnerPaused?: boolean; intentsUnreadable?: boolean; measured?: boolean } = {}) {
  const repos = createMemoryRepositories();
  const dir = mkdtempSync(join(tmpdir(), "hunter-lane-"));
  const path = hunterLaneArmingPath(dir, {});
  if (options.arming !== "missing" && options.arming !== "garbage") writeLaneArming(path, options.arming ?? reading());
  if (options.arming === "garbage") { writeLaneArming(path, reading()); writeFileSync(path, "{\"format\":1}"); }
  await repos.adminConfig.put(ADMIN_CONFIG_ID, withFleetSpendCeiling(defaultAdminConfig(NOW),
    { rollingCeilingUsd: options.ceilingUsd ?? 50, previousUsd: 50, decidedAt: NOW, decidedBy: "adm_x", receiptId: "r0" }), NOW);
  if (options.runnerPaused) {
    const intent = buildResearchIntent("PAUSE_RUNNER", NOW, "test", null, "test");
    await repos.researchIntents.append("level-1", intent.intentId, intent, NOW);
  }
  if (options.intentsUnreadable) (repos.researchIntents as { readRecentWhere: unknown }).readRecentWhere = async () => { throw new Error("socket closed"); };
  for (const cost of options.costs ?? []) await repos.costs.append(cost.workItemId, cost.attemptId, cost, cost.recordedAt);
  const task = createRouteTask({ workItemId: "wi-1", routeId: "autonomous:scout:x", routeLabel: "Discover", target: "https://x.example.gov/", inherited: false, now: NOW });
  await repos.routeTasks.put(task.id, task, NOW);
  await repos.occurrences.put("occ-1", { id: "occ-1", obligationId: "ob-1", sequence: 1, dueAt: NOW, workItemId: "wi-1", routeTaskId: task.id,
    openedAt: NOW, closedAt: null, disposition: null, unresolvedReason: null } as never, NOW);
  await repos.obligations.put("ob-1", { id: "ob-1", subjectId: jurisdiction.subjectId,
    recordClass: "OFFICIAL_BOARD_DIRECTORY", readerImpactAt: NOW,
    assignments: (options.marks ?? [SEND]).map(key => ({ assignmentKey: key, ref: "receipt-1", relation: "CREATED", at: NOW })) } as never, NOW);
  const sent: ModelRequest[] = [];
  const messages = async (r: ModelRequest): Promise<ModelResponse> => {
    sent.push(r);
    return { id: `msg-${sent.length}`, model: r.model, role: "assistant", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn",
      usage: options.measured === false ? {} : { input_tokens: 100, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as unknown as ModelResponse;
  };
  const ownSpend = new LaneOwnSpend();
  const conditions: string[] = [];
  const arm = () => armHunterLane({ repos, now: () => NOW, armingPath: path, messages, batch: backgroundBatchTransport({ apiKey: "" }),
    credentialConfigured: true, credentialVar: "WTP_TEST_KEY",
    providerQueue: new ModelProviderQueue(), ownSpend, circuits: null, onCondition: sentence => { conditions.push(sentence); } });
  let armed: ArmedHunterLane = await arm();
  const send = laneWorkerTransport(() => armed, ownSpend, () => NOW)(jurisdiction, task.id);
  return { repos, path, sent, ownSpend, conditions, task, send, get armed() { return armed; }, rearm: async () => { armed = await arm(); return armed; } };
}

const spent = (usd: number, routeTaskId: string | null = "other-task"): CostEntry => ({ attemptId: `spent-${usd}-${routeTaskId}`, workItemId: "wi-x", routeTaskId, routeId: null,
  source: "api.anthropic.com", jurisdiction: null, project: "test", role: "SCOUT", recordedAt: "2026-10-06T02:00:00.000Z",
  cost: { usd, inputTokens: 1, outputTokens: 1, requestCount: 1 } } as unknown as CostEntry);

test("a failed request never hides a later recorded charge for the same place", async () => {
  const h = await lane({ ceilingUsd: 50 });
  const failed = h.ownSpend.begin(h.task.id, "2026-10-06T02:58:00.000Z", 3);
  h.ownSpend.settle(failed, null);
  const succeeded = h.ownSpend.begin(h.task.id, "2026-10-06T02:59:00.000Z", 4);
  h.ownSpend.settle(succeeded, 2);
  await recordCost(h.repos, { ...spent(2, h.task.id), attemptId: "later-success", recordedAt: NOW }, NOW);
  h.ownSpend.recorded(succeeded);
  const armed = await h.rearm();
  assert.equal(armed.fleetSafety!.admissionSpendUsd(), 5);
  assert.equal(h.ownSpend.usd(), 3);
});

test("CH-24 lane: the round's reading round-trips, and a missing, malformed or stale one holds paid work by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-lane-read-"));
  const path = hunterLaneArmingPath(dir, {});
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /no research round has written its budget reading yet/);
  writeLaneArming(path, reading());
  const saved = readLaneArming(path, NOW);
  assert.ok("arming" in saved);
  assert.equal(saved.arming.readAt, NOW);
  assert.deepEqual(saved.arming.assignment(SEND), { known: true, spec: reading().sends.specs[0], usd: 0 });
  assert.deepEqual(saved.arming.reached("missing"), []);
  assert.equal(saved.arming.lifetimeSubject(jurisdiction.subjectId), false);
  assert.deepEqual(saved.arming.scopesFor(jurisdiction.subjectId), []);
  writeFileSync(path, JSON.stringify({ ...reading(), worstCaseUsd: null }));
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /not in the expected form/, "a Scout with no stated worst case is not armed");
  const old = new Date(Date.parse(NOW) - HUNTER_LANE_ARMING_MAX_AGE_MS - 60_000).toISOString();
  writeLaneArming(path, reading({ readAt: old }));
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /61 minutes old/);
  assert.equal(hunterLaneArmingPath(dir, { WTP_HUNTER_LANE_ARMING: "/srv/x.json" }), "/srv/x.json", "the parent names one path for every staged checkout");
});

test("CH-24 lane: open with room, a request is held on its Send from the task's own marks, sent once and settled", async () => {
  const h = await lane();
  assert.equal(h.armed.closed, null);
  await h.send(request);
  assert.equal(h.sent.length, 1);
  const holds = await h.repos.spendHolds.liveAll(NOW);
  const [hold] = Object.values(holds);
  assert.deepEqual(hold?.keys, [`send:${SEND}`], "held on the Send the obligation's own record names");
  assert.ok((hold?.settled?.usd ?? 0) > 0);
});

test("the writer consumes each reading iterable once and retains budget and membership semantics", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-lane-iterables-")), path = hunterLaneArmingPath(dir, {});
  let writing = false;
  const deferred = <T>(rows: Iterable<T>): Iterable<T> => {
    let consumed = false;
    return { *[Symbol.iterator]() {
      assert.ok(writing, "building the reading must not consume its rows");
      assert.equal(consumed, false, "the writer must consume each input only once");
      consumed = true;
      yield* rows;
    } };
  };
  const arming = laneArmingOf({ readAt: NOW, specs: reading().sends.specs,
    historical: deferred([
      [SEND, { usd: 1.25, measured: 1, unmeasured: 0, bySubject: 0 }],
      ["unmeasured", { usd: null, measured: 0, unmeasured: 1, bySubject: 0 }],
    ] as const),
    knownKeys: deferred([SEND, SEND, "unmeasured"]),
    reached: deferred(new Map([["empty", []], ["pending", [SEND]]])),
    areas: { malformedScopes: 0, scopes: [{ key: "county", label: "County", budgetUsd: 5, resolved: true,
      members: deferred([jurisdiction.subjectId, jurisdiction.subjectId]), states: ["NH"], historicalUsd: 1.25, lifetime: true }] },
    lifetimeHuntSubjects: deferred([jurisdiction.subjectId, jurisdiction.subjectId]), circuits: [], worstCaseUsd: 1 });
  try {
    writing = true;
    writeLaneArming(path, arming);
    const saved = readLaneArming(path, NOW);
    assert.ok("arming" in saved);
    assert.equal(saved.arming.costsReadable, true);
    assert.equal(saved.arming.assignment(SEND).usd, 1.25);
    assert.deepEqual(saved.arming.assignment("unmeasured"), { known: true, spec: null, usd: null });
    assert.deepEqual(saved.arming.reached("pending"), [SEND]);
    assert.equal(saved.arming.lifetimeSubject(jurisdiction.subjectId), true);
    assert.equal(saved.arming.areas?.hasSelectedHunts, true);
    assert.deepEqual(saved.arming.scopesFor(jurisdiction.subjectId).map(scope => scope.key), ["county"]);
    const db = openArmingDatabase(join(dir, ".runtime", "hunter-lane", saved.arming.indexFile), true);
    try {
      for (const table of ["reached", "members", "lifetime"]) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count, 1);
    } finally { db.close(); }
    writeLaneArming(path, reading({ historicalUsd: null }));
    const unreadable = readLaneArming(path, NOW);
    assert.ok("arming" in unreadable);
    assert.equal(unreadable.arming.costsReadable, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("CH-24 lane: every owner control holds paid work by name, and nothing is sent", async () => {
  const cases: [Parameters<typeof lane>[0], RegExp][] = [
    [{ runnerPaused: true }, /the owner paused the runner/],
    [{ intentsUnreadable: true }, /research intents could not be read \(socket closed\)/],
    [{ costs: [spent(60)], ceilingUsd: 50 }, /\$50\.00 model ceiling is reached/],
    [{ arming: "missing" }, /no research round has written its budget reading yet/],
    [{ arming: "garbage" }, /not in the expected form/],
    [{ arming: reading({ readAt: "2026-10-06T01:00:00.000Z" }) }, /120 minutes old/],
  ];
  for (const [options, why] of cases) {
    const h = await lane(options);
    assert.ok(h.armed.closed !== null, `closed for ${why}`);
    assert.match(h.armed.closed!.reason, why);
    await assert.rejects(h.send(request), (error: unknown) => error instanceof SendBudgetRefusal && why.test(error.why));
    assert.equal(h.sent.length, 0);
    assert.equal(h.ownSpend.usd(), 0, "a request refused before sending leaves the lane's book");
  }
});

test("CH-24 lane: a Send spent at the round's reading refuses before sending; so does a Send newer than the reading", async () => {
  const full = await lane({ arming: reading({ historicalUsd: 5 }) });
  await assert.rejects(full.send(request), (error: unknown) => error instanceof SendBudgetRefusal);
  assert.equal(full.sent.length, 0);
  const unmeasured = await lane({ arming: reading({ historicalUsd: null }) });
  await assert.rejects(unmeasured.send(request), (error: unknown) => error instanceof SendBudgetRefusal && /cost ledger could not be read/.test(error.why));
  const newer = await lane({ marks: [SEND, "dispatch:intent-new"] });
  await assert.rejects(newer.send(request), (error: unknown) => error instanceof SendBudgetRefusal &&
    /Send dispatch:intent-new, which is newer than the round's budget reading/.test(error.why));
  assert.equal(newer.sent.length, 0);
});

test("CH-24 lane: the lane's own spend is counted once across refreshes, a durably acknowledged row replaces its reservation", async () => {
  const h = await lane({ ceilingUsd: 50, costs: [spent(40)] });
  await h.send(request);
  const own = h.ownSpend.usd();
  assert.ok(own > 0);
  /* The worker writes its cost row for the same task: the next controller must not count it twice. */
  const recorded = { ...spent(own, h.task.id), attemptId: "lane-row", recordedAt: NOW };
  await recordCost(h.repos, recorded, NOW);
  h.ownSpend.recordedCost(recorded);
  const armed = await h.rearm();
  assert.equal(armed.closed, null);
  assert.equal(Math.round(armed.fleetSafety!.admissionSpendUsd() * 1e9), Math.round((40 + own) * 1e9));
});

test("CH-24 lane: a ledger row from earlier work on the same task keeps counting; acknowledging current requests preserves every older ledger row", async () => {
  const h = await lane({ ceilingUsd: 50, costs: [{ ...spent(7, "TASK"), recordedAt: "2026-10-06T01:00:00.000Z" }] });
  await recordCost(h.repos, { ...spent(7, h.task.id), attemptId: "earlier", recordedAt: "2026-10-06T01:00:00.000Z" }, NOW);
  await h.send(request);
  const own = h.ownSpend.usd();
  const recorded = { ...spent(own, h.task.id), attemptId: "lane-row", recordedAt: NOW };
  await recordCost(h.repos, recorded, NOW);
  h.ownSpend.recordedCost(recorded);
  const armed = await h.rearm();
  assert.equal(Math.round(armed.fleetSafety!.admissionSpendUsd() * 1e9), Math.round((7 + 7 + own) * 1e9), "the earlier $7 on this task still counts");
});

test("CH-24 lane: a request in flight across a refresh counts at its worst case in the next controller", async () => {
  const h = await lane({ ceilingUsd: 50, costs: [spent(10)] });
  const worst = modelRequestWorstCaseUsd(request)!;
  h.ownSpend.begin(h.task.id, NOW, worst);
  const armed = await h.rearm();
  assert.equal(Math.round(armed.fleetSafety!.admissionSpendUsd() * 1e9), Math.round((10 + worst) * 1e9));
});

test("CH-24 lane: a sent request whose bill never came back keeps its hold until shutdown releases it", async () => {
  const h = await lane({ measured: false });
  await h.send(request).catch(() => undefined);
  const open = h.armed.guards!.openJobs();
  assert.equal(open.length, 1, "the unmeasured request's job stays open");
  const before = committedUsd(await h.repos.spendHolds.liveAll(NOW), { key: `send:${SEND}`, label: "x", budgetUsd: 5, historicalUsd: 0, historyReadAt: NOW }, NOW);
  assert.ok(before > 0);
  assert.deepEqual(await releaseOpenJobs(h.armed.spendHolds, open, NOW), []);
  const hold = Object.values(await h.repos.spendHolds.liveAll(NOW))[0];
  assert.notEqual(hold?.settled, null, "released at what it held: it still counts, it is no longer open");
});

test("CH-24 lane: the round writes its Send and area reading once its gates are armed, and never in a dry or canary round", async () => {
  const { readFileSync } = await import("node:fs");
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const writeHunterLaneReading = \(\): void => \{\n  if \(dry \|\| canary\) return;/);
  assert.ok(round.indexOf("writeHunterLaneReading();") > round.indexOf("const guards = paidWorkGuards({"), "written after the guards are armed");
  assert.match(round, /writeLaneArming\(hunterLaneArmingPath\(ROOT\), laneArmingOf\(\{ readAt: NOW,/);
});

test("arming reads only the latest owner controls and preserves timestamp and append ordering", async () => {
  const h = await lane();
  const append = async (action: "PAUSE" | "RESUME", at: string, suffix: string) => {
    const intent = { ...buildResearchIntent(action, at, "test"), intentId: suffix };
    await h.repos.researchIntents.append("level-1", suffix, intent, NOW);
  };
  await append("RESUME", NOW, "latest-resume");
  await append("PAUSE", "2026-10-01T00:00:00.000Z", "late-old-pause");
  await h.repos.researchIntents.append("level-1", "honored", { kind: "HONORED", action: "PAUSE", requestedAt: "2099-01-01T00:00:00.000Z" } as never, NOW);
  h.repos.researchIntents.read = async () => { throw new Error("country log read"); };
  h.repos.adminConfig.read = async () => { throw new Error("full Admin configuration read"); };
  assert.equal((await h.rearm()).closed, null);
  await append("PAUSE", NOW, "tied-new-pause");
  assert.match((await h.rearm()).closed!.reason, /paused/);
  await append("RESUME", NOW, "tied-new-resume");
  assert.equal((await h.rearm()).closed, null);
});

test("the indexed reading holds only a subject's scopes and keeps prior snapshots usable during replacement", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-lane-index-")), path = hunterLaneArmingPath(dir, {});
  const scope = (key: string, subject: string, state: string, resolved = true) => ({ key, label: key, budgetUsd: 5,
    resolved, members: [subject], states: [state], historicalUsd: 0, lifetime: true });
  const unrelated = Array.from({ length: 10_000 }, (_, n) => scope(`CA-${n}`, `ocd-division/country:us/state:ca/city:sample_${n}`, "CA"));
  writeLaneArming(path, { ...reading(), lifetimeHuntSubjects: [jurisdiction.subjectId], areas: { malformedScopes: 0,
    scopes: [...unrelated, scope("county", jurisdiction.subjectId, "NH"), scope("district", jurisdiction.subjectId, "NH"),
      scope("unresolved-ca", "", "CA", false), scope("unresolved-nh", "", "NH", false)] } });
  const read = readLaneArming(path, NOW);
  assert.ok("arming" in read);
  assert.equal(read.arming.lifetimeSubject(jurisdiction.subjectId), true);
  assert.deepEqual(read.arming.scopesFor(jurisdiction.subjectId).map(row => row.key).sort(), ["county", "district", "unresolved-nh"]);
  assert.deepEqual(read.arming.scopesFor("unplaced", "NH").map(row => row.key), ["unresolved-nh"]);
  assert.deepEqual(read.arming.scopesFor("unplaced", "ocd-division/country:us/state:nh").map(row => row.key), ["unresolved-nh"]);
  assert.throws(() => read.arming.scopesFor("unplaced"), /state is unknown/);
  assert.ok(JSON.stringify(read.arming).length < 1_024);
  writeLaneArming(path, reading({ historicalUsd: 4 }));
  assert.equal(read.arming.assignment(SEND).usd, 0);
  const replacement = readLaneArming(path, NOW);
  assert.ok("arming" in replacement);
  assert.equal(replacement.arming.assignment(SEND).usd, 4);
});

test("unanswered requests remain counted after completed tasks and exact acknowledgments are idempotent", () => {
  const own = new LaneOwnSpend();
  for (let n = 0; n < 10_000; n++) {
    const request = own.begin(`place-${n}`, NOW, 0.25);
    own.settle(request, null);
    own.finished(`place-${n}`);
  }
  const recorded = own.begin("known", NOW, 1);
  own.settle(recorded, 0.5);
  own.recorded(recorded); own.recorded(recorded);
  assert.equal(own.usd(), 2_500);
  assert.deepEqual(own.totals("2026-10-05T03:00:00.000Z", NOW), { usd: 2_500, knownUsd: 0, measured: 0, unmeasured: 10_000, worstCaseCharges: 10_000 });
  assert.equal(own.totals(NOW, "2026-10-07T03:00:01.000Z").usd, 0);
});


test("a durable bounded error charge acknowledges only its active task's exact reservation", () => {
  const own = new LaneOwnSpend(), bound = modelRequestBoundFor(MODELS.haiku.model, 1_234, 1_024)!;
  const request = own.begin("bounded-task", NOW, bound.usd);
  own.settle(request, null);
  const entry = { ...spent(0, "bounded-task"), recordedAt: NOW, requestedModel: bound.model, modelRequestBound: bound };
  own.recordedCost({ ...entry, routeTaskId: "another-task" });
  assert.equal(own.usd(), bound.usd);
  own.recordedCost(entry);
  assert.equal(own.usd(), 0);
  own.recordedCost(entry);
  assert.equal(own.usd(), 0);
});
