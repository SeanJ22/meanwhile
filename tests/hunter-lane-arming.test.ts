/**
 * The standing hunter lane arms the same paid-work guards the
 * round does, from the owner's live controls and the round's host-local Send
 * and area reading. Every unreadable or stale input holds paid work by name;
 * a task's Send lines come from its own obligation's marks; the lane's own
 * requests are counted once across refreshes, at their worst case until they
 * measure.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
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
  armingNeedsRebuild,
  HUNTER_LANE_LEGACY_BYTES,
  hunterLaneArmingPath,
  laneArmingOf,
  laneWorkerTransport,
  readLaneArming,
  writeLaneArming,
  type ArmedHunterLane,
} from "../lib/control-plane/workers/hunter-lane-arming.ts";
import type { ModelRequest, ModelResponse } from "../lib/control-plane/scheduler/scout-executor.ts";
import type { CostEntry } from "../lib/control-plane/cost.ts";
import { MODELS } from "../lib/models.ts";
import { ScopeBudgetGate } from "../lib/control-plane/expansion/membership.ts";
import { createPlannerSpool, plannerMap } from "../lib/control-plane/scheduler/planner-spool.ts";
import { DiskRows } from "../lib/control-plane/scheduler/disk-rows.ts";
import type { AssignmentBudgetSpec, AssignmentSpend } from "../lib/control-plane/expansion/assignment-budget.ts";
import type { ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";

const NOW = "2026-10-06T03:00:00.000Z";
const request = { model: MODELS.haiku.model, max_tokens: 1_024, system: [], tools: [], messages: [{ role: "user", content: "x" }] } as unknown as ModelRequest;
const SEND = "county:2020/33011";
const jurisdiction = { subjectId: "ocd-division/country:us/state:nh/county:hillsborough", state: "NH" };

function reading(overrides: { readAt?: string; historicalUsd?: number | null; knownKeys?: string[]; budgetUsd?: number } = {}) {
  return laneArmingOf({
    readAt: overrides.readAt ?? NOW,
    specs: [{ key: SEND, kind: "SCOPE", label: "Hillsborough County", ref: "receipt-1", budgetUsd: overrides.budgetUsd ?? 5, sentAt: "2026-10-05T00:00:00.000Z" }],
    historical: overrides.historicalUsd === null ? null : new Map([[SEND, { usd: overrides.historicalUsd ?? 0 } as never]]),
    knownKeys: overrides.knownKeys ?? [SEND], reached: new Map(), areas: null, lifetimeHuntSubjects: [], placeOrder: ["receipt-1"],
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
  if (options.intentsUnreadable) repos.researchIntents.readChangedSince = async () => { throw new Error("socket closed"); };
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
  return { repos, path, sent, ownSpend, conditions, task, send, get armed() { return armed; }, rearm: async () => { const previous = armed; armed = await arm(); previous.arming?.close(); return armed; } };
}

const spent = (usd: number, routeTaskId: string | null = "other-task"): CostEntry => ({ attemptId: `spent-${usd}-${routeTaskId}`, workItemId: "wi-x", routeTaskId, routeId: null,
  source: "api.anthropic.com", jurisdiction: null, project: "test", role: "SCOUT", recordedAt: "2026-10-06T02:00:00.000Z",
  cost: { usd, inputTokens: 1, outputTokens: 1, requestCount: 1 } } as unknown as CostEntry);

test("CH-24 lane: the round's reading round-trips, and a missing, malformed or stale one holds paid work by name", () => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-lane-read-"));
  const path = hunterLaneArmingPath(dir, {});
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /no research round has written its budget reading yet/);
  writeLaneArming(path, reading());
  const saved = readLaneArming(path, NOW); assert.ok("arming" in saved);
  try { assert.deepEqual([...saved.arming.sends.specs], [...reading().sends.specs]); assert.deepEqual([...saved.arming.sends.knownKeys], [SEND]);
    assert.deepEqual([...saved.arming.sends.reached], []); assert.equal(saved.arming.readAt, NOW); assert.equal(saved.arming.worstCaseUsd, 1); }
  finally { saved.arming.close(); }
  writeFileSync(path, JSON.stringify({ ...reading(), worstCaseUsd: null }));
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /not in the expected form/, "a Scout with no stated worst case is not armed");
  const old = new Date(Date.parse(NOW) - HUNTER_LANE_ARMING_MAX_AGE_MS - 60_000).toISOString();
  writeLaneArming(path, reading({ readAt: old }));
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /61 minutes old/);
  assert.equal(hunterLaneArmingPath(dir, { WTP_HUNTER_LANE_ARMING: "/srv/x.json" }), "/srv/x.json", "the parent names one path for every staged checkout");
});

test("hunter arming holds large membership inventories on disk and lets an in-flight request finish on its original reading", context => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-arming-members-"));
  const path = join(dir, "arming.sqlite");
  const members = new Set(Array.from({ length: 20_000 }, (_, i) => `NH:body:${i}`));
  const expected = { ...reading(), sends: { ...reading().sends, reached: new Map(Array.from({ length: 20_000 }, (_, i) => [`ob:${i}`, [SEND]])) },
    areas: { malformedScopes: 0, scopes: [{ key: SEND, label: "Hillsborough", budgetUsd: 5, resolved: true,
      members, states: ["NH"], historicalUsd: 1 }] }, lifetimeHuntSubjects: members };
  writeLaneArming(path, expected);
  const opened = new Set<string>();
  let headerBytes = 0;
  const prepare = DatabaseSync.prototype.prepare;
  context.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    opened.add(String(prepare.call(this, "PRAGMA database_list").get()?.file));
    const statement = prepare.call(this, sql);
    if (sql.startsWith("SELECT json_remove(body")) headerBytes = Buffer.byteLength(String(statement.get()?.body));
    return statement;
  });
  const read = readLaneArming(path, NOW); assert.ok("arming" in read);
  const saved = read.arming;
  const snapshots = [...opened];
  let finishRequest: (() => void) | undefined;
  try {
    assert.equal(opened.has(path), false, "the public arming file stays replaceable while a Windows worker uses an older reading");
    assert.ok(snapshots.length && snapshots.every(file => basename(dirname(file)).startsWith("meanwhile-hunter-arming-")));
    assert.ok(headerBytes < 8_192, "country memberships never enter the metadata payload");
    assert.equal(saved.lifetimeHuntSubjects instanceof Set, false);
    assert.equal(saved.lifetimeHuntSubjects.size, 20_000);
    assert.equal(saved.lifetimeHuntSubjects.has("NH:body:19999"), true);
    assert.equal(saved.lifetimeHuntSubjects.has("AZ:body:19999"), false);
    assert.deepEqual(saved.sends.reached.get("ob:19999"), [SEND]);
    assert.equal(saved.sends.reached.get("foreign:ob"), undefined);
    assert.equal(saved.areas!.scopes[0].members instanceof Set, false);
    const gate = new ScopeBudgetGate({ ...saved.areas!, worstCaseUsd: 1, historyReadAt: saved.readAt });
    const own = gate.linesFor("NH:body:19999"); assert.ok("lines" in own);
    assert.equal(own.lines.length, 1); assert.equal(own.lines[0].historicalUsd, 1);
    assert.deepEqual(gate.linesFor("AZ:body:19999"), { lines: [] });
    finishRequest = saved.retain();
    saved.close();
    writeLaneArming(path, reading());
    assert.equal(saved.lifetimeHuntSubjects.has("NH:body:19999"), true, "the original request keeps its exact budget reading after replacement");
    finishRequest();
    assert.throws(() => saved.lifetimeHuntSubjects.has("NH:body:19999"), /not open|closed|finalized/);
  } finally { finishRequest?.(); saved.close(); }
  for (const snapshot of snapshots) { assert.equal(existsSync(snapshot), false); assert.equal(existsSync(dirname(snapshot)), false); }
});

test("country Send specs and history stream into local detail pages with an exact-key snapshot and bounded header", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-arming-sends-")), path = join(dir, "arming.sqlite");
  const planner = await createPlannerSpool();
  try {
    const specs = planner.table<AssignmentBudgetSpec>("arming-spec-fixture", row => row.key);
    const historical = plannerMap<AssignmentSpend>(planner, "arming-history-fixture");
    for (let n = 0; n < 20_000; n++) {
      const key = `send:${n}`;
      specs.add({ key, kind: "DISPATCH", ref: `receipt:${n}`, label: `Send ${n}`, budgetUsd: 5, sentAt: NOW });
      historical.set(key, { usd: n % 17 === 0 ? null : 1.25 } as AssignmentSpend);
    }
    const snapshot = laneArmingOf({ readAt: NOW, specs: Object.assign(specs.rows, { toJSON() { throw new Error("COUNTRY_SPECS_SERIALIZED"); } }), historical,
      knownKeys: specs.keys, reached: new Map(), areas: null, lifetimeHuntSubjects: [], placeOrder: specs.rows.map(row => row.ref), circuits: [], worstCaseUsd: 1 });
    writeLaneArming(path, snapshot);
    const disk = new DatabaseSync(path, { readOnly: true });
    try {
      const header = String(disk.prepare("SELECT body FROM metadata WHERE key='header'").get()!.body);
      assert.ok(Buffer.byteLength(header) < 4_096);
      const metadata = JSON.parse(header) as { sends: { specs: { rows: number; pages: number }; historical: { rows: number } }; placeOrder: { rows: number } };
      assert.equal(metadata.sends.specs.rows, 20_000);
      assert.equal(metadata.sends.historical.rows, 20_000);
      assert.equal(metadata.placeOrder.rows, 20_000);
      assert.ok(metadata.sends.specs.pages > 1);
      for (const row of disk.prepare("SELECT body FROM metadata WHERE key LIKE 'hunter-arming:%'").iterate()) {
        const page = JSON.parse(String(row.body)) as { freshnessDetails: { rows: unknown[] } };
        assert.ok(page.freshnessDetails.rows.length <= 32);
      }
    } finally { disk.close(); }
    const read = readLaneArming(path, NOW); assert.ok("arming" in read);
    try {
      assert.ok(read.arming.sends.specs instanceof DiskRows);
      assert.equal(read.arming.sends.specs.length, 20_000);
      assert.equal(read.arming.sends.historical instanceof Map, false);
      assert.equal(read.arming.sends.historical!.size, 20_000);
      assert.equal(read.arming.sends.specFor("send:19999")?.ref, "receipt:19999");
      assert.equal(read.arming.sends.specFor("absent"), undefined);
      assert.equal(read.arming.sends.historical!.get("send:19999")?.usd, 1.25);
      assert.equal(read.arming.sends.historical!.get("send:0")?.usd, null);
      assert.equal(read.arming.sends.historical!.get("absent"), undefined);
      assert.deepEqual([...read.arming.sends.historical!.keys().take(2)], ["send:0", "send:1"]);
      assert.deepEqual([...read.arming.sends.historical!.values().take(2)].map(row => row.usd), [null, 1.25]);
      assert.equal(read.arming.placeOrder.length, 20_000);
      assert.equal(read.arming.placeOrder.slice(-1).find(() => true), "receipt:19999");
      const release = read.arming.retain();
      read.arming.close();
      writeLaneArming(path, reading());
      assert.equal(read.arming.sends.specFor("send:19999")?.budgetUsd, 5, "the in-flight request retains the original exact Send reading");
      release();
      assert.throws(() => read.arming.sends.specFor("send:19999"), /not open|closed|finalized/);
    } finally { read.arming.close(); }
  } finally { await planner.close(); }
});

test("bounded legacy arrays preserve exact Send values while projecting unused fields before parsing", context => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-arming-legacy-")), path = join(dir, "arming.sqlite");
  writeLaneArming(path, reading());
  const old = new DatabaseSync(path);
  try {
    old.exec("DROP TABLE metadata; CREATE TABLE metadata(body TEXT NOT NULL)");
    const base = { format: 2, readAt: NOW, sends: { specs: [], historical: [] }, areas: null, placeOrder: [], circuits: [], worstCaseUsd: 1 };
    old.prepare(`WITH RECURSIVE numbers(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM numbers WHERE n<199)
      INSERT INTO metadata SELECT json_set(?, '$.sends.specs', json((SELECT json_group_array(json_object(
        'key','legacy:'||n,'kind','DISPATCH','label','Send '||n,'ref','receipt:'||n,'budgetUsd',5,'sentAt',?,
        'unneeded',replace(hex(zeroblob(10)),'00','UNRELATED_COUNTRY_PAYLOAD'))) FROM numbers)),
        '$.sends.historical', json((SELECT json_group_array(json_object('key','legacy:'||n,'usd',CASE WHEN n=0 THEN NULL ELSE 2.5 END,
          'unneeded',replace(hex(zeroblob(10)),'00','UNRELATED_COUNTRY_PAYLOAD'))) FROM numbers)),
        '$.placeOrder',json((SELECT json_group_array('receipt:'||n) FROM numbers)))`).run(JSON.stringify(base), NOW);
  } finally { old.close(); }
  const parse = JSON.parse;
  context.mock.method(JSON, "parse", (source: string) => {
    assert.ok(Buffer.byteLength(source) < 65_536, "no country's legacy array crosses the SQLite boundary");
    assert.equal(source.includes("UNRELATED_COUNTRY_PAYLOAD"), false);
    return parse(source);
  });
  const prepare = DatabaseSync.prototype.prepare;
  context.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    assert.notEqual(sql, "SELECT body FROM metadata");
    return prepare.call(this, sql);
  });
  const read = readLaneArming(path, NOW); assert.ok("arming" in read);
  try {
    assert.equal(read.arming.sends.specs.length, 200);
    assert.deepEqual(read.arming.sends.specFor("legacy:199"), { key: "legacy:199", kind: "DISPATCH", label: "Send 199",
      ref: "receipt:199", budgetUsd: 5, sentAt: NOW });
    assert.equal(read.arming.sends.historical!.get("legacy:199")?.usd, 2.5);
    assert.equal(read.arming.sends.historical!.get("legacy:0")?.usd, null);
    assert.equal(read.arming.placeOrder.length, 200);
  } finally { read.arming.close(); }
});

test("an oversized legacy handoff requests the existing cycle's rebuild before any JSON parse and the normal writer restores admission", context => {
  const dir = mkdtempSync(join(tmpdir(), "hunter-arming-rebuild-")), path = join(dir, "arming.sqlite");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE metadata(body TEXT NOT NULL)");
  old.prepare("INSERT INTO metadata SELECT CAST(zeroblob(?) AS TEXT)").run(HUNTER_LANE_LEGACY_BYTES + 1);
  old.close();
  const parse = context.mock.method(JSON, "parse", () => { throw new Error("LEGACY_COUNTRY_JSON_PARSED"); });
  const prepare = DatabaseSync.prototype.prepare;
  context.mock.method(DatabaseSync.prototype, "prepare", function(this: DatabaseSync, sql: string) {
    assert.ok(sql === "PRAGMA table_info(metadata)" || sql.includes("octet_length(body)"), "the compatibility decision reads only SQLite cell metadata");
    return prepare.call(this, sql);
  });
  assert.equal(armingNeedsRebuild(path), true);
  assert.match((readLaneArming(path, NOW) as { held: string }).held, /needs a bounded rebuild/);
  assert.equal(parse.mock.callCount(), 0);
  context.mock.restoreAll();
  writeLaneArming(path, reading());
  assert.equal(armingNeedsRebuild(path), false);
  const restored = readLaneArming(path, NOW); assert.ok("arming" in restored);
  try { assert.equal(restored.arming.sends.specFor(SEND)?.budgetUsd, 5); assert.equal(restored.arming.sends.historical?.get(SEND)?.usd, 0); }
  finally { restored.arming.close(); }
});

test("refresh pages Send intents to private disk and folds owner pauses in requested-time order without retaining the country log", async () => {
  const h = await lane();
  const fail = async (): Promise<never> => { throw new Error("COUNTRY_INTENT_LOG_READ"); };
  h.repos.researchIntents.read = fail; h.repos.researchIntents.readAll = fail;
  for (let n = 0; n < 2_000; n++) {
    const intent = { ...buildResearchIntent("DISPATCH", NOW, "test", `Another place ${n}`, "test"), intentId: `dispatch-${n}`, budgetUsd: 5 } as ResearchIntent;
    await h.repos.researchIntents.append("level-1", intent.intentId, intent, NOW);
  }
  const read = h.repos.researchIntents.readChangedSince;
  let pages = 0;
  h.repos.researchIntents.readChangedSince = async (since, held, options) => {
    assert.deepEqual(options?.keys, ["level-1"]);
    assert.ok(options?.page);
    assert.equal(options.projection?.budgetUsd, true);
    return read(since, held, { ...options, page: async rows => {
      for (let at = 0; at < rows.length; at += 64) { pages++; await options.page!(rows.slice(at, at + 64)); }
    } });
  };
  try {
    await h.rearm();
    assert.equal(h.armed.closed, null);
    assert.ok(pages > 1);
    await h.send(request);
    assert.equal(h.sent.length, 1, "unrelated Sends cannot replace or remove this obligation's existing budget");
    const pause = buildResearchIntent("PAUSE", "2026-10-06T03:02:00.000Z", "test", null, "test");
    const olderResume = buildResearchIntent("RESUME", "2026-10-06T03:01:00.000Z", "test", null, "test");
    await h.repos.researchIntents.append("level-1", pause.intentId, pause, NOW);
    await h.repos.researchIntents.append("level-1", olderResume.intentId, olderResume, NOW);
    const paused = await h.rearm();
    assert.ok(paused.closed);
    assert.match(paused.closed.reason, /paused/i, "a later append with an older requested time cannot undo the owner's pause");
  } finally { h.armed.arming?.close(); }
});

test("the exact obligation's unwritten Send mark still holds paid work when reached membership lives on disk", async () => {
  const h = await lane({ marks: [], arming: { ...reading(), sends: { ...reading().sends, reached: new Map([["ob-1", [SEND]]]) } } });
  await assert.rejects(h.send(request), /record.*not written|membership mark/);
  assert.equal(h.sent.length, 0);
  h.armed.arming?.close();
});

test("concurrent requests on one obligation each consume their own prepared Send reading", async () => {
  const h = await lane();
  await Promise.all([h.send(request), h.send(request)]);
  assert.equal(h.sent.length, 2);
  h.armed.arming?.close();
});

test("hunter refresh reads spend policy without transferring owner histories or geographic inventories", async () => {
  const h = await lane();
  const narrow = h.repos.adminConfig.readNarrowed.bind(h.repos.adminConfig);
  h.repos.adminConfig.read = async () => { throw new Error("whole config is not needed for admission"); };
  h.repos.adminConfig.readNarrowed = async (id, projection) => {
    assert.equal(projection.fleetSpendCeiling, true); assert.equal(projection.discoverySearch, true);
    assert.equal(projection.expansionScopes, undefined); assert.equal(projection.settings, undefined); assert.equal(projection.fixList, undefined);
    return narrow(id, projection);
  };
  await h.rearm();
  await h.send(request);
  assert.equal(h.sent.length, 1);
  h.armed.arming?.close();
});

test("CH-24 lane: open with room, a request is held on its Send from the task's own marks, sent once and settled", async () => {
  const h = await lane();
  assert.equal(h.armed.closed, null);
  await h.send(request);
  assert.equal(h.sent.length, 1);
  const holds = (await h.repos.budget.read()).value.spendHolds ?? {};
  const [hold] = Object.values(holds);
  assert.deepEqual(hold?.keys, [`send:${SEND}`], "held on the Send the obligation's own record names");
  assert.ok((hold?.settled?.usd ?? 0) > 0);
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

test("CH-24 lane: the lane's own spend is counted once across refreshes, the ledger's row for the same task is not added again", async () => {
  const h = await lane({ ceilingUsd: 50, costs: [spent(40)] });
  await h.send(request);
  const own = h.ownSpend.usd();
  assert.ok(own > 0);
  /* The worker writes its cost row for the same task: the next controller must not count it twice. */
  await recordCost(h.repos, { ...spent(own, h.task.id), attemptId: "lane-row", recordedAt: NOW }, NOW);
  const armed = await h.rearm();
  assert.equal(armed.closed, null);
  assert.equal(Math.round(armed.fleetSafety!.admissionSpendUsd() * 1e9), Math.round((40 + own) * 1e9));
});

test("CH-24 lane: a ledger row from earlier work on the same task keeps counting; only this lane's own rows are replaced by its book", async () => {
  const h = await lane({ ceilingUsd: 50, costs: [{ ...spent(7, "TASK"), recordedAt: "2026-10-06T01:00:00.000Z" }] });
  await recordCost(h.repos, { ...spent(7, h.task.id), attemptId: "earlier", recordedAt: "2026-10-06T01:00:00.000Z" }, NOW);
  await h.send(request);
  const own = h.ownSpend.usd();
  await recordCost(h.repos, { ...spent(own, h.task.id), attemptId: "lane-row", recordedAt: NOW }, NOW);
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
  const before = committedUsd((await h.repos.budget.read()).value.spendHolds ?? {}, { key: `send:${SEND}`, label: "x", budgetUsd: 5, historicalUsd: 0, historyReadAt: NOW }, NOW);
  assert.ok(before > 0);
  assert.deepEqual(await releaseOpenJobs(h.armed.spendHolds, open, NOW), []);
  const hold = Object.values((await h.repos.budget.read()).value.spendHolds ?? {})[0];
  assert.notEqual(hold?.settled, null, "released at what it held: it still counts, it is no longer open");
});

test("CH-24 lane: the round writes its Send and area reading once its gates are armed, and never in a dry or canary round", async () => {
  const { readFileSync } = await import("node:fs");
  const round = readFileSync(new URL("../scripts/freshness-shadow.mts", import.meta.url), "utf8");
  assert.match(round, /const writeHunterLaneReading = \(\): void => \{\n  if \(dry \|\| canary\) return;/);
  assert.ok(round.indexOf("writeHunterLaneReading();") > round.indexOf("const guards = paidWorkGuards({"), "written after the guards are armed");
  assert.match(round, /writeLaneArming\(hunterLaneArmingPath\(ROOT\), laneArmingOf\(\{ readAt: NOW,/);
});
