import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { REGISTRY_STATES, stateRegistryRuntimeScope } from "../lib/civic-data/state-scopes.ts";
import { stateBallotScope } from "../lib/civic-data/state-scopes.ts";
import { publishSupervisorReaderEdge } from "../lib/civic-data/reader-edge-publication.ts";
import { promotedPointerVersion, selectedStateEdgePointers } from "../lib/civic-data/promoted-edge-publication.ts";
import { admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";
import { stateArtifactResultLine } from "../lib/civic-data/state-artifact-dispatch.ts";
import { MemoryRoutineDataStore } from "../lib/civic-data/store.ts";
import type { BoundedChildCommand, BoundedChildLauncher } from "../lib/civic-data/bounded-child-pass.ts";
import type { PromotedPointerIdentity, RoutineRecordClass } from "../lib/civic-data/types.ts";
import type { WorkerMemoryRelease, WorkerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";
import { LocalFileArtifactStore, type ReaderArtifactStore } from "../lib/meetings/edge-store.ts";
import { publishReaderEdgeArtifacts, ensureReaderAuthorityEdge, type PublishedStateAuthority } from "../lib/meetings/edge-serving.ts";
import type { StateAuthorityFamily } from "../lib/meetings/edge-artifacts.ts";

const NOW = "2026-10-16T12:00:00.000Z";
const IL = { recordClass: "BALLOT_CANDIDACY" as const, scope: stateBallotScope("ballot-contests", "IL") };
const ENV = { WTP_READER_EDGE_LOCAL_OK: "1", WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) };
const metadata = { sourceThrough: null, retrievedAt: null, promotedThrough: null };

function pointer(recordClass: RoutineRecordClass, scope: string, versionId: string): PromotedPointerIdentity {
  return { key: `${recordClass}:${scope}`, recordClass, scope, versionId, lastKnownGoodVersionId: versionId,
    sourceId: "fixture", promotedAt: NOW };
}
function ref(versionId: string): PublishedStateAuthority {
  const sha = createHash("sha256").update(versionId).digest("hex");
  return { versionId, artifact: { key: `reader/artifacts/${sha}.json.gz`, sha, version: versionId } };
}
function success(command: BoundedChildCommand) {
  const arg = (name: string) => command.args.find(value => value.startsWith(`--${name}=`))!.slice(name.length + 3);
  return { id: command.id, status: 0, signal: null, termination: "EXITED" as const, stderr: "", errorMessage: null,
    stdout: stateArtifactResultLine(arg("state"), arg("family") as StateAuthorityFamily, ref(arg("version"))) };
}
function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "state-artifact-dispatch-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const artifacts = new LocalFileArtifactStore(directory);
  const rows = new Map<string, PromotedPointerIdentity>();
  const reads: { recordClass: RoutineRecordClass; scopes: readonly string[] }[] = [];
  const store = new Proxy(new MemoryRoutineDataStore(), { get(_target, key) {
    if (key === "readPromotionIdentities") return async (recordClass: RoutineRecordClass, scopes: readonly string[]) => {
      reads.push({ recordClass, scopes }); return scopes.flatMap(scope => rows.get(`${recordClass}:${scope}`) ?? []);
    };
    throw new Error(`Parent attempted a payload read: ${String(key)}`);
  } });
  const boundedArtifacts = new Proxy(artifacts, { get(target, key) {
    if (key === "readBytes") return async () => assert.fail(`State supervisor must not read ${String(key)}`);
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } }) as ReaderArtifactStore;
  const active = new Set<string>(), observations: number[] = [];
  const slots: WorkerProcessSlots = { async acquire(entry = "") {
    assert.ok(!active.has(entry)); active.add(entry);
    const release: WorkerMemoryRelease = () => { assert.ok(active.delete(entry)); };
    release.observe = pid => { observations.push(pid); };
    return release;
  } };
  const put = (recordClass: RoutineRecordClass, scope: string, version: string) => {
    const row = pointer(recordClass, scope, version); rows.set(row.key, row); return promotedPointerVersion(recordClass, scope, row);
  };
  return { directory, artifacts, boundedArtifacts, store, reads, active, observations, slots, put };
}

test("state dispatch uses the same states and territories for registry and ballot units", () => {
  const units = selectedStateEdgePointers(null);
  assert.deepEqual(units.filter(unit => unit.family === "registry-runtime").map(unit => unit.state), [...REGISTRY_STATES]);
  assert.deepEqual(units.filter(unit => unit.family === "ballot-contests").map(unit => unit.state), [...REGISTRY_STATES]);
  assert.deepEqual(selectedStateEdgePointers([{ recordClass: "REGISTRY_RUNTIME_BINDING", scope: stateRegistryRuntimeScope("PR") }])
    .map(({ state, family, pointers }) => ({ state, family, scope: pointers[0].scope })),
  [{ state: "PR", family: "registry-runtime", scope: "US-PR:reader-registry-runtime" }]);
});

test("production state supervisor dispatches zero unchanged children and only Illinois's changed family", async t => {
  const f = fixture(t), first = f.put(IL.recordClass, IL.scope, "il-v1");
  const nh = ref("held-new-hampshire");
  await publishReaderEdgeArtifacts(null, metadata, { store: f.artifacts, now: NOW,
    stateAuthorities: { "ballot-contests": { IL: ref(first), NH: nh } } });
  const launched: BoundedChildCommand[] = [];
  const launch: BoundedChildLauncher = async command => { launched.push(command); command.onStarted?.(123); return success(command); };
  const publish = () => publishSupervisorReaderEdge(f.store, NOW, [IL], {
    artifactStore: f.boundedArtifacts, stateArtifactChildren: { launch, slots: f.slots },
  }, ENV);
  assert.equal((await publish()).ok, true);
  assert.equal(launched.length, 0);
  const next = f.put(IL.recordClass, IL.scope, "il-v2");
  assert.equal((await publish()).ok, true);
  assert.equal(launched.length, 1);
  assert.equal(launched[0].env?.WTP_RUNTIME_AUTHORITY_CONTRACT, "ballot-contests:IL");
  assert.equal(launched[0].env?.WTP_RUNTIME_AUTHORITY_CAPABILITY, "MANUAL_CONTRACT");
  assert.deepEqual(f.observations, [123]);
  assert.equal(f.active.size, 0);
  assert.ok(f.reads.every(read => read.scopes.every(scope => scope.startsWith("US-IL:"))));
  const manifest = (await f.artifacts.readManifest())!.manifest;
  assert.equal(manifest.stateAuthorities?.["ballot-contests"]?.IL.version, next);
  assert.deepEqual(manifest.stateAuthorities?.["ballot-contests"]?.NH, nh.artifact);
  assert.deepEqual(Object.keys(manifest.stateAuthorities!["ballot-contests"]!.IL).sort(), ["key", "sha", "version"]);
});

test("targeted ballot delivery includes the six other state families without reading their payloads", async t => {
  const f = fixture(t), units = selectedStateEdgePointers(null).filter(unit => unit.state === "IL");
  for (const unit of units) for (const p of unit.pointers) f.put(p.recordClass, p.scope, `${unit.family}-v1`);
  const launches: string[] = [];
  const outcome = await publishSupervisorReaderEdge(f.store, NOW, [IL], { artifactStore: f.boundedArtifacts,
    stateArtifactChildren: { slots: f.slots, launch: async command => {
      launches.push(command.id);
      assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CAPABILITY, command.id.startsWith("candidate-campaign-sites-derived:") ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT");
      return success(command);
    } } }, ENV);
  assert.equal(outcome.ok, true);
  assert.equal(launches.length, 7);
  assert.equal(f.active.size, 0);
  assert.equal(Object.keys((await f.artifacts.readManifest())!.manifest.stateAuthorities!).length, 7);
});

test("an unchanged sweep of every state and territory ballot launches no child and reads no payload", async t => {
  const f = fixture(t), units = selectedStateEdgePointers(null).filter(unit => unit.family === "ballot-contests");
  const states: Record<string, PublishedStateAuthority> = {};
  for (const unit of units) {
    const p = unit.pointers[0];
    states[unit.state] = ref(f.put(p.recordClass, p.scope, `${unit.state}-v1`));
  }
  assert.equal(Object.keys(states).length, REGISTRY_STATES.length);
  await publishReaderEdgeArtifacts(null, metadata, { store: f.artifacts, now: NOW, stateAuthorities: { "ballot-contests": states } });
  const outcome = await publishSupervisorReaderEdge(f.store, NOW, units.flatMap(unit => unit.pointers), { artifactStore: f.boundedArtifacts,
    stateArtifactChildren: { slots: f.slots, launch: async () => assert.fail("unchanged sweep must not launch") } }, ENV);
  assert.equal(outcome.ok, true);
  assert.equal(outcome.readerEdge, "CURRENT");
  assert.ok(f.reads.every(row => row.scopes.every(scope => /^US-[A-Z]{2}:/.test(scope))));
  assert.equal(f.active.size, 0);
});

test("independent state children overlap while each holds its own memory admission", { timeout: 2_000 }, async t => {
  const f = fixture(t), nh = { recordClass: IL.recordClass, scope: stateBallotScope("ballot-contests", "NH") };
  f.put(IL.recordClass, IL.scope, "il-v1"); f.put(nh.recordClass, nh.scope, "nh-v1");
  let started = 0, release!: () => void;
  const both = new Promise<void>(resolve => { release = resolve; });
  const outcome = await publishSupervisorReaderEdge(f.store, NOW, [IL, nh], { artifactStore: f.boundedArtifacts,
    stateArtifactChildren: { slots: f.slots, launch: async command => {
      started++;
      if (started === 2) { assert.equal(f.active.size, 2); release(); }
      await both;
      return success(command);
    } } }, ENV);
  assert.equal(outcome.ok, true);
  assert.equal(started, 2);
  assert.equal(f.active.size, 0);
});

test("failed child launch releases admission, retains the served state, and retries", async t => {
  const f = fixture(t), first = f.put(IL.recordClass, IL.scope, "il-v1");
  await publishReaderEdgeArtifacts(null, metadata, { store: f.artifacts, now: NOW, stateAuthorities: { "ballot-contests": { IL: ref(first) } } });
  const next = f.put(IL.recordClass, IL.scope, "il-v2");
  let attempts = 0;
  const launch: BoundedChildLauncher = async command => { if (++attempts === 1) throw new Error("spawn failed"); return success(command); };
  const publish = () => publishSupervisorReaderEdge(f.store, NOW, [IL], { artifactStore: f.boundedArtifacts,
    stateArtifactChildren: { slots: f.slots, launch } }, ENV);
  assert.equal((await publish()).ok, false);
  assert.equal(f.active.size, 0);
  assert.equal((await f.artifacts.readManifest())!.manifest.stateAuthorities!["ballot-contests"]!.IL.version, first);
  assert.equal((await publish()).ok, true);
  assert.equal(attempts, 2);
  assert.equal(f.active.size, 0);
  assert.equal((await f.artifacts.readManifest())!.manifest.stateAuthorities!["ballot-contests"]!.IL.version, next);
});

test("admission failure never launches a child or leaves a reservation", async t => {
  const f = fixture(t); f.put(IL.recordClass, IL.scope, "il-v1");
  const outcome = await publishSupervisorReaderEdge(f.store, NOW, [IL], { artifactStore: f.boundedArtifacts,
    stateArtifactChildren: { slots: { acquire: async () => { throw new Error("admission closed"); } },
      launch: async () => assert.fail("launch must await admission") } }, ENV);
  assert.equal(outcome.ok, false);
  assert.equal(f.active.size, 0);
  assert.equal((await f.artifacts.readManifest())!.manifest.stateAuthorities?.["ballot-contests"]?.IL, undefined);
});

for (const race of ["pointer", "manifest"] as const) test(`a concurrent ${race} change cannot be overwritten by an older child`, async t => {
  const f = fixture(t), first = f.put(IL.recordClass, IL.scope, "il-v1");
  await publishReaderEdgeArtifacts(null, metadata, { store: f.artifacts, now: NOW, stateAuthorities: { "ballot-contests": { IL: ref(first) } } });
  f.put(IL.recordClass, IL.scope, "il-v2");
  const third = promotedPointerVersion(IL.recordClass, IL.scope, pointer(IL.recordClass, IL.scope, "il-v3"));
  const outcome = await publishSupervisorReaderEdge(f.store, NOW, [IL], { artifactStore: f.boundedArtifacts,
    stateArtifactChildren: { slots: f.slots, launch: async command => {
      if (race === "pointer") f.put(IL.recordClass, IL.scope, "il-v3");
      else await publishReaderEdgeArtifacts(null, metadata, { store: f.artifacts, now: NOW, stateAuthorities: { "ballot-contests": { IL: ref(third) } } });
      return success(command);
    } } }, ENV);
  assert.equal(outcome.ok, false);
  assert.equal(f.active.size, 0);
  assert.equal((await f.artifacts.readManifest())!.manifest.stateAuthorities!["ballot-contests"]!.IL.version, race === "pointer" ? first : third);
});

test("the actual state artifact CLI runs with the production TypeScript launcher and only exact-state SQL", async t => {
  const f = fixture(t), preload = join(f.directory, "transport.mjs"), queries = join(f.directory, "queries.jsonl");
  writeFileSync(preload, `import { neonConfig } from ${JSON.stringify(import.meta.resolve("@neondatabase/serverless"))};
import { appendFileSync } from 'node:fs';
neonConfig.fetchFunction = async (_url, init) => {
  const body = JSON.parse(String(init.body));
  appendFileSync(${JSON.stringify(queries)}, JSON.stringify(body) + '\\n');
  if (!/^(?:select\\b|with\\s+recursive\\b)/i.test(body.query.trimStart()) || /\\b(?:insert|update|delete)\\b/i.test(body.query)) throw new Error('Unexpected database write');
  return new Response(JSON.stringify({ command: 'SELECT', rowCount: 0, rowAsArray: true, fields: [], rows: [] }));
};`);
  const version = promotedPointerVersion(IL.recordClass, IL.scope, null);
  const parentEnv = { ...process.env, WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local", WTP_READER_EDGE_LOCAL_OK: "1", WTP_VITAL_SIGNS_REPORT: "1",
    WTP_READER_EDGE_DIR: join(f.directory, "edge"), DATABASE_URL: "postgresql://local:local@staging.invalid/reader",
    WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control" };
  const env = admittedRuntimeChildEnvironment({ parentEnv, capability: "MANUAL_CONTRACT", contract: "ballot-contests:IL" });
  const run = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, resolve("scripts/publish-state-authority.mts"),
    "--state=IL", "--family=ballot-contests", `--version=${version}`, `--observed-at=${NOW}`], { env, encoding: "utf8", timeout: 60_000 });
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split(/\r?\n/).filter(line => line.startsWith("STATE_AUTHORITY_ARTIFACT="));
  assert.equal(lines.length, 1);
  assert.ok(lines[0].startsWith("STATE_AUTHORITY_ARTIFACT="));
  assert.ok(Buffer.byteLength(lines[0]) < 1024);
  const entry = JSON.parse(lines[0].slice("STATE_AUTHORITY_ARTIFACT=".length)) as PublishedStateAuthority;
  assert.equal(entry.versionId, version);
  const edge = await ensureReaderAuthorityEdge({ stateAuthorities: { "ballot-contests": { IL: entry.artifact } } },
    new LocalFileArtifactStore(parentEnv.WTP_READER_EDGE_DIR), ["ballot-contests"]);
  const published = await edge.stateAuthorities?.load("ballot-contests", "IL");
  assert.deepEqual(published?.entries, [{ kind: "NOT_RECORDED", recordClass: IL.recordClass, scope: IL.scope }]);
  const captured = readFileSync(queries, "utf8").trim().split("\n").map(line => JSON.parse(line) as { query: string; params: string[] });
  assert.ok(captured.length >= 3);
  assert.ok(captured.every(row => row.params?.some(value => String(value).includes(IL.scope))), JSON.stringify(captured));
  assert.equal(captured.filter(row => /\bpayload\b/i.test(row.query)).length, 1);
  const derivedVersion = promotedPointerVersion("CURATED_READER_RECORD", stateBallotScope("candidate-campaign-sites-derived", "IL"), null);
  const derived = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, resolve("scripts/publish-state-authority.mts"),
    "--state=IL", "--family=candidate-campaign-sites-derived", `--version=${derivedVersion}`, `--observed-at=${NOW}`], {
    env: admittedRuntimeChildEnvironment({ parentEnv, capability: "ROUTINE_CONTRACT", contract: "candidate-campaign-sites-derived:IL" }),
    encoding: "utf8", timeout: 60_000,
  });
  assert.equal(derived.status, 0, derived.stderr);
  const derivedLine = derived.stdout.split(/\r?\n/).find(line => line.startsWith("STATE_AUTHORITY_ARTIFACT="));
  assert.ok(derivedLine);
  assert.equal(JSON.parse(derivedLine.slice("STATE_AUTHORITY_ARTIFACT=".length)).versionId, derivedVersion);
  const registryScope = stateRegistryRuntimeScope("PR"), registryVersion = promotedPointerVersion("REGISTRY_RUNTIME_BINDING", registryScope, null);
  const registry = spawnSync(process.execPath, ["--experimental-strip-types", "--import", preload, resolve("scripts/publish-state-authority.mts"),
    "--state=PR", "--family=registry-runtime", `--version=${registryVersion}`, `--observed-at=${NOW}`], {
    env: admittedRuntimeChildEnvironment({ parentEnv, capability: "MANUAL_CONTRACT", contract: "registry-runtime:PR" }),
    encoding: "utf8", timeout: 60_000,
  });
  assert.equal(registry.status, 0, registry.stderr);
  const registryLine = registry.stdout.split(/\r?\n/).find(line => line.startsWith("STATE_AUTHORITY_ARTIFACT="));
  assert.ok(registryLine);
  const registryEntry = JSON.parse(registryLine.slice("STATE_AUTHORITY_ARTIFACT=".length)) as PublishedStateAuthority;
  assert.equal(registryEntry.versionId, registryVersion);
  const registryEdge = await ensureReaderAuthorityEdge({ stateAuthorities: { "registry-runtime": { PR: registryEntry.artifact } } },
    new LocalFileArtifactStore(parentEnv.WTP_READER_EDGE_DIR), ["registry-runtime"]);
  assert.deepEqual((await registryEdge.stateAuthorities?.load("registry-runtime", "PR"))?.entries,
  [{ kind: "NOT_RECORDED", recordClass: "REGISTRY_RUNTIME_BINDING", scope: registryScope }]);

});
