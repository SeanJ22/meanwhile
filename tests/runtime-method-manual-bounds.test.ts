import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgFieldManualRepository, AGGREGATE_LIST_READ_PAGE, type Sql } from "../lib/control-plane/repository/pg-store.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { projectAggregate } from "../lib/control-plane/repository/types.ts";
import type { FieldManualEntry, FieldManualRepos } from "../lib/control-plane/field-manual.ts";
import { newFieldManualEntry, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { computeRouteFloor } from "../lib/control-plane/preflight.ts";
import { methodFixture, knowledgeEntries, methodVersionEntry } from "./method-store-fixture.ts";
import { KNOWLEDGE_SOURCE, methodVersionFromManual, methodKnowledgeFromManual } from "../lib/method/manual-bridge.ts";
import { unknownApplicability } from "../lib/method/portability.ts";
import { startWorkerToolsHost } from "../lib/control-plane/workers/process-pool.ts";
import { openRuntimeMethod, readRuntimeMethodVersion, requireRuntimeMethodVersion, readRuntimeMaturity,
  readMethodProgressionSnapshot, methodCatalogRequest, closeMethodCatalogHost } from "../lib/method/runtime-manual.ts";
import { observeCyclePhases } from "../lib/control-plane/scheduler/cycle-phases.ts";
import { PendingOperations, trackStoreCalls } from "../lib/control-plane/scheduler/cycle-stall.ts";
import { closeAuditHistoryIndex, withIndexedAuditSample } from "../lib/control-plane/workers/audit-history-index.ts";

const at = "2026-10-20T00:00:00.000Z";
const request = { jurisdiction: { state: "az", governmentType: "county", platform: "legistar", publisher: "own.example.gov" },
  fields: ["meeting", "agenda"], adapterRoutes: [{ routeId: "adapter:own", label: "Own observed route", target: "https://own.example.gov/agenda" }] };
const route = (id: string) => ({ ...methodFixture().routes[0]!, id, title: id, fields: ["meeting"],
  applicability: unknownApplicability(), outcomes: [], subBranches: [] });
const entry = (id: string, payload: unknown, source = "learned") => newFieldManualEntry(source, id, {
  kind: "ROUTE", role: "SHARED", title: id, summary: "Procedure retained", outcome: "REFERENCE", payload });

for (const tracked of [false, true]) test(`native ${tracked ? "nested tracked" : "phase-observed"} method catalog keeps its token through floors and worker shutdown`, async () => {
  const stores = createMemoryRepositories();
  await writeFieldManual(stores, [methodVersionEntry({ ...methodFixture(), version: 23 }), entry("own", route("own"))], at);
  const observer = observeCyclePhases(stores), pending = new PendingOperations();
  const repos = tracked ? trackStoreCalls(observer.repos, pending) : observer.repos;
  const first = await openRuntimeMethod(repos);
  let second: Awaited<ReturnType<typeof openRuntimeMethod>> | undefined;
  try {
    assert.deepEqual((await first.floorFor(request)).routes.map(row => row.routeId), ["own", "adapter:own"]);
    second = await openRuntimeMethod(repos);
    await first.close();
    assert.deepEqual((await second.floorFor(request)).routes.map(row => row.routeId), ["own", "adapter:own"],
      "closing one worker token must preserve the same shared snapshot held by another");
    assert.equal(repos.fieldManual, repos.fieldManual, "instrumentation preserves logical repository identity");
    assert.notEqual(repos.fieldManual, stores.fieldManual, "calls still pass through their instrumentation");
    assert.equal(second.version, 24);
    assert.equal(observer.finish("runtime").repositoryCalls, 2, "the two actual projected reads remain counted");
    assert.equal(pending.snapshot().storeInFlight, 0);
  } finally {
    await first.close(); await second?.close(); await closeMethodCatalogHost(repos);
  }
});

test("nested repository observation reuses the shared audit index and preserves each sampler's counted history", async () => {
  const stores = createMemoryRepositories(), read = stores.workerResults.readChangedSince;
  let scans = 0;
  stores.workerResults.readChangedSince = async (...args) => { scans++; return read(...args); };
  const observer = observeCyclePhases(stores), pending = new PendingOperations();
  const repos = trackStoreCalls(observer.repos, pending);
  const input = { samplerId: "one-burst", stratum: "MEETING|own.example.gov", producerResultId: null };
  const sample = (samplerId = input.samplerId) => withIndexedAuditSample(repos, { ...input, samplerId }, history => ({ value: history ?? null, count: true }));
  try {
    assert.equal(await sample(), null);
    assert.deepEqual(await sample(), { reviewed: 1, survivedSinceBreak: 0, everBroken: false });
    assert.equal(scans, 1, "the second sample reuses the burst's durable disk snapshot");
    assert.equal(await sample("new-burst"), null, "a distinct burst still takes a genuine new source snapshot");
    assert.equal(scans, 2);
    assert.equal(repos.workerResults, repos.workerResults);
    assert.equal(observer.finish("audit").repositoryCalls, 4, "both source refreshes and exact manual fallback reads are observed");
    assert.equal(pending.snapshot().storeInFlight, 0);
  } finally { await closeAuditHistoryIndex(repos); }
});

for (const count of [3, 2000]) test(`shared method host offers the same own-place floor with ${count} foreign routes and no country payload transfer`, async () => {
  const repos = createMemoryRepositories();
  let visited = 0;
  const source = (id: string, payload: unknown) => entry(id, payload);
  const portable = route("portable"), speculative = { ...route("speculative"), applicability: { ...unknownApplicability(), states: ["ny"] } };
  const base = methodVersionEntry({ ...methodFixture(), version: 56 });
  const generated = function* (): Iterable<FieldManualEntry> {
    yield base; yield source(portable.id, portable); yield source(speculative.id, speculative);
    for (let i = 0; i < count; i++) yield source(`foreign:${i}`, { ...route(`foreign:${i}`),
      applicability: { ...unknownApplicability(), portability: "PUBLISHER_SPECIFIC", publishers: [`foreign-${i}.example.gov`] },
      // Projected before transfer; neither field can enter the live catalog or the worker RPC.
      outcomes: [{ jurisdiction: `place:${i}`, note: "COUNTRY_OUTCOME_".repeat(4096) }],
      claims: [{ statement: "COUNTRY_CLAIM_".repeat(4096), restsOn: [] }] });
  };
  repos.fieldManual.visitSlice = async (query, visit, projection) => {
    assert.deepEqual(query.kinds, ["ROUTE", "METHOD_VERSION"]); assert.equal(query.everywhere, true);
    assert.ok(projection, "the store must project route definitions before any country histories leave it");
    assert.ok(!JSON.stringify(projection).includes("claims")); assert.ok(!JSON.stringify(projection).includes("outcomes"));
    for (const original of generated()) {
      const value: FieldManualEntry = { ...(projectAggregate(original, projection) as FieldManualEntry),
        ...(query.methodRouteShape ? { methodRouteShape: { outcomesArray: Array.isArray((original.payload as { outcomes?: unknown } | null)?.outcomes) } } : {}) };
      assert.equal((value.payload as { outcomes?: unknown })?.outcomes, undefined);
      assert.equal((value.payload as { claims?: unknown })?.claims, undefined);
      visited++; await visit({ id: original.id, revision: 1, updatedAt: at, value });
    }
  };
  const host = await startWorkerToolsHost({ repos, browse: async () => { throw new Error("unused"); } });
  const worker: FieldManualRepos = { fieldManual: { ...repos.fieldManual,
    visitSlice: async () => { throw new Error("worker must read the shared method service"); } } };
  try {
    const method = await openRuntimeMethod(worker);
    try {
      assert.equal(method.version, 56 + count + 2, "all global new identities still advance version, including excluded routes");
      const actual = await method.floorFor(request);
      const expected = computeRouteFloor({ ...request, knowledge: { version: method.version, routes: [portable, speculative] } });
      assert.deepEqual(actual, { routes: expected.routes, methodVersion: expected.methodVersion });
      assert.equal(actual.routes.find(row => row.routeId === "speculative")?.obligation, "EXPLORATORY", "a route learned in another state remains offered under UNKNOWN portability");
      assert.ok(actual.routes.some(row => row.routeId === "adapter:own" && row.obligation === "REQUIRED"));
      assert.ok(!JSON.stringify(actual).includes("foreign:"));
      assert.ok(!JSON.stringify(actual).includes("COUNTRY_"));
      assert.ok(JSON.stringify(actual).length < 4000, "the own-place RPC shape is independent of foreign place count");
    } finally { await method.close(); }
    assert.equal(await readRuntimeMethodVersion(worker), 56 + count + 2);
    assert.equal(visited, 2 * (count + 3), "only the requested definition and identity projections were scanned");
  } finally { await host.close(); }
});

test("native method snapshots preserve frozen precedence, global duplicate versioning and version-pinned route floors", async () => {
  const repos = createMemoryRepositories(), fixture = methodFixture();
  const frozen = { ...route("same"), title: "Frozen procedure", applicability: { ...unknownApplicability(), portability: "NATIONWIDE" as const } };
  const learned = { ...route("same"), title: "Learned duplicate must not replace frozen" };
  const entries = [methodVersionEntry(fixture), entry("frozen", frozen, KNOWLEDGE_SOURCE), entry("duplicate", learned), entry("pointer", { routeId: "new-pointer" }),
    entry("invalid-string", { ...route("invalid-string"), outcomes: "not an array" }),
    entry("invalid-object", { ...route("invalid-object"), outcomes: {} }),
    entry("invalid-missing", { ...route("invalid-missing"), outcomes: undefined })];
  await writeFieldManual(repos, entries, at);
  const old = await openRuntimeMethod(repos);
  try {
    const canonical = methodKnowledgeFromManual({ entries: [...entries].sort((a, b) => a.id.localeCompare(b.id)) })!;
    assert.equal(old.version, methodVersionFromManual({ entries }));
    assert.deepEqual(await old.floorFor(request), (() => { const floor = computeRouteFloor({ ...request, knowledge: canonical }); return { routes: floor.routes, methodVersion: floor.methodVersion }; })());
    assert.equal((await old.floorFor(request)).routes.find(row => row.routeId === "same")?.label, frozen.title);
    assert.ok(!(await old.floorFor(request)).routes.some(row => row.routeId.startsWith("invalid-")), "malformed records remain IDs for global versioning but never become full route records");
    await writeFieldManual(repos, [entry("new", route("new"))], at);
    const next = await openRuntimeMethod(repos), shared = await openRuntimeMethod(repos);
    try {
      assert.equal(next.version, old.version + 1);
      assert.ok(!(await old.floorFor(request)).routes.some(row => row.routeId === "new"), "an in-flight audit keeps its original method snapshot");
      assert.ok((await next.floorFor(request)).routes.some(row => row.routeId === "new"));
      await next.close();
      assert.ok((await shared.floorFor(request)).routes.some(row => row.routeId === "new"), "closing one reference cannot invalidate a second reader");
    } finally { await next.close(); await shared.close(); }
  } finally { await old.close(); await closeMethodCatalogHost(repos); }
});

test("method version and exact disk maturity include bare route pointers, and unreadable/unseeded reads stay refused", async () => {
  const repos = createMemoryRepositories();
  assert.equal(await readRuntimeMethodVersion(repos), null);
  await assert.rejects(requireRuntimeMethodVersion(repos), /has not been seeded/);
  await assert.rejects(readRuntimeMaturity(repos), /holds no learned routes/);
  await writeFieldManual(repos, [entry("one", { routeId: "one" })], at);
  const before = await readRuntimeMaturity(repos);
  await writeFieldManual(repos, [entry("two", { routeId: "two" })], at);
  const after = await readRuntimeMaturity(repos);
  try {
    assert.equal(before("one"), "GRADUATED"); assert.equal(before("two"), "UNGRADUATED");
    assert.equal(after("two"), "GRADUATED"); assert.equal(after(null), "UNGRADUATED");
  } finally { await before.close(); await after.close(); }
  repos.fieldManual.visitSlice = async () => { throw new Error("store unavailable"); };
  await assert.rejects(openRuntimeMethod(repos), /store unavailable/);
  await assert.rejects(readRuntimeMaturity(repos), /could not be read/);
});

test("file method reads bypass full histories and reporting receives repeatable disk applicability rows", async () => {
  const root = await mkdtemp(join(tmpdir(), "rh01-method-catalog-"));
  try {
    const repos = await createFileRepositories(root), fixture = methodFixture();
    await writeFieldManual(repos, [...knowledgeEntries(fixture), methodVersionEntry(fixture)], at);
    const original = repos.fieldManual.readArrayPage;
    repos.fieldManual.readArrayPage = async () => { throw new Error("method floor has no use for country history arrays"); };
    const method = await openRuntimeMethod(repos);
    try {
      const canonical = methodKnowledgeFromManual({ entries: [...knowledgeEntries(fixture), methodVersionEntry(fixture)].sort((a, b) => a.id.localeCompare(b.id)) })!;
      const expected = computeRouteFloor({ ...request, knowledge: canonical });
      assert.deepEqual(await method.floorFor(request), { routes: expected.routes, methodVersion: fixture.version });
    } finally { await method.close(); }
    repos.fieldManual.readArrayPage = original;
    const own = entry("invalid-file", { ...route("invalid-file"), outcomes: "COUNTRY_INVALID_FILE_".repeat(4096) });
    await writeFieldManual(repos, [own], at);
    assert.equal(await repos.fieldManual.readArrayType!(own.id, ["payload", "outcomes"]), false);
    const narrowed = await openRuntimeMethod(repos);
    try { assert.ok(!(await narrowed.floorFor(request)).routes.some(row => row.routeId === "invalid-file")); }
    finally { await narrowed.close(); }
    const snapshot = await readMethodProgressionSnapshot(repos, [fixture.routes[0]!.id, "unknown", fixture.routes[0]!.id]);
    try {
      assert.equal(snapshot.routes.length, 1);
      assert.deepEqual(snapshot.routes.find(row => row.id === fixture.routes[0]!.id), { id: fixture.routes[0]!.id, applicability: fixture.routes[0]!.applicability });
      assert.equal(snapshot.routes.length, 1);
    } finally { await snapshot.close(); }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("the shared catalog releases a killed process's pinned snapshots and refuses an incomplete floor capability", async () => {
  const repos = createMemoryRepositories();
  await writeFieldManual(repos, [methodVersionEntry(methodFixture()), ...knowledgeEntries(methodFixture())], at);
  const opened = await methodCatalogRequest(repos, { operation: "open", mode: "IDENTITIES", ownerPid: process.pid }) as { token: string };
  await assert.rejects(methodCatalogRequest(repos, { operation: "floor", token: opened.token, input: request }), /FLOOR_NOT_LOADED/);
  await methodCatalogRequest(repos, { operation: "release-process", ownerPid: process.pid });
  await assert.rejects(methodCatalogRequest(repos, { operation: "floor", token: opened.token, input: request }), /SNAPSHOT_NOT_HELD/);
  await closeMethodCatalogHost(repos);
});

test("Postgres projects raw method shape in the existing catalog pages without outcome transfer or per-route queries", async () => {
  const pg = new PGlite();
  try {
    await pg.exec("CREATE TABLE cp_field_manual_entries(id text PRIMARY KEY,revision bigint,updated_at timestamptz,value jsonb,changed_at timestamptz DEFAULT now())");
    let calls = 0, transferred = "";
    const sql: Sql = { query: async (text, params) => {
      calls++;
      const rows = (await pg.query(text, params ? [...params] : [])).rows;
      transferred += JSON.stringify(rows);
      return rows;
    } };
    const fieldManual = pgFieldManualRepository(sql), fixture = methodFixture();
    const own = entry("own", { ...route("own"), outcomes: [{ jurisdiction: "az:own", note: "COUNTRY_HISTORY_".repeat(8192) }] });
    const invalid = entry("malformed", { ...route("malformed"), outcomes: "COUNTRY_INVALID_".repeat(8192) });
    const entries = [methodVersionEntry(fixture), own, invalid, ...Array.from({ length: 120 }, (_, i) => entry(`foreign:${i}`, {
      ...route(`foreign:${i}`), applicability: { ...unknownApplicability(), portability: "PUBLISHER_SPECIFIC", publishers: [`foreign-${i}.example.gov`] },
    }))];
    for (const row of entries) await fieldManual.put(row.id, row, at);
    calls = 0; transferred = "";
    const repos = { fieldManual }, method = await openRuntimeMethod(repos);
    try {
      assert.equal(calls, Math.floor(entries.length / AGGREGATE_LIST_READ_PAGE) + 1, "shape is computed in each existing page, without one new query for each route");
      assert.equal(method.version, fixture.version + entries.length - 1, "even malformed raw records remain globally learned identities");
      const floor = await method.floorFor(request);
      assert.deepEqual(floor.routes.map(row => row.routeId), ["own", "adapter:own"]);
      assert.equal(calls, Math.floor(entries.length / AGGREGATE_LIST_READ_PAGE) + 1, "the pinned floor consults its shared disk catalog");
      assert.ok(!transferred.includes("COUNTRY_HISTORY_"));
      assert.ok(!transferred.includes("COUNTRY_INVALID_"));
    } finally { await method.close(); await closeMethodCatalogHost(repos); }
  } finally { await pg.close(); }
});
