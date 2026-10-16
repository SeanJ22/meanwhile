import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { runInNewContext } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { stateBallotContractId, stateBallotScope, type StateBallotFamily } from "../lib/ballot/state-scopes.ts";
import type { BoundedChildCommand, BoundedChildLauncher, BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { restoreStateBuckets } from "../lib/civic-data/state-bucket-dispatch.ts";
import type { StateBootstrapQuery, StateBootstrapUnit } from "../lib/civic-data/state-bucket-bootstrap.ts";
import { CONTROL_PLANE_READS_DIR_ENV, databaseIdentity } from "../lib/control-plane/repository/incremental-reads.ts";
import type { WorkerMemoryRelease, WorkerProcessSlots } from "../lib/control-plane/workers/worker-slots.ts";

function unit(family: StateBallotFamily, state: string): StateBootstrapUnit {
  const recordClass = { "ballot-contests": "BALLOT_CANDIDACY", "candidate-profiles": "CANDIDATE_PROFILE",
    "candidate-corpus": "CANDIDATE_PUBLICATION", "voting-sites": "VOTING_SITE", "candidate-campaign-sites-derived": "CURATED_READER_RECORD" } as const;
  return { family, state, contractId: stateBallotContractId(family, state), recordClass: recordClass[family],
    scope: stateBallotScope(family, state), originVersionId: `national-${family}`, inputFile: `/tmp/${family}-${state}.json`,
    inputHash: `input-${family}-${state}`, fileSha256: "a".repeat(64) };
}
function exited(command: BoundedChildCommand, stdout: string): BoundedChildResult {
  return { id: command.id, status: 0, signal: null, termination: "EXITED", stderr: "", errorMessage: null, stdout };
}
async function fixture(t: TestContext, units: readonly StateBootstrapUnit[], unassigned: readonly unknown[] = []) {
  const directory = await mkdtemp(join(tmpdir(), "state-bucket-dispatch-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = { NODE_ENV: "test", DATABASE_URL: "postgresql://fixture:fixture@state-buckets.invalid/reader",
    [CONTROL_PLANE_READS_DIR_ENV]: directory, WTP_RUNTIME_AUTHORITY_REPO: process.cwd(), WTP_RUNTIME_AUTHORITY_SHA: "a".repeat(40) };
  const planDirectory = join(directory, databaseIdentity(env.DATABASE_URL!), "state-buckets");
  const rows = new Map<string, Record<string, unknown>>(), queries: { text: string; params: readonly unknown[] }[] = [];
  const active = new Set<string>(), released: string[] = [], observed: number[] = [], launched: BoundedChildCommand[] = [];
  const slots: WorkerProcessSlots = { async acquire(id = "") {
    assert.ok(!active.has(id)); active.add(id);
    const release: WorkerMemoryRelease = () => { assert.ok(active.delete(id)); released.push(id); };
    release.observe = pid => { observed.push(pid); }; return release;
  } };
  const query: StateBootstrapQuery = async (text, params) => {
    assert.match(text, /^SELECT p\.current_version_id,e\.detail/);
    assert.doesNotMatch(text, /INSERT|UPDATE|DELETE|payload|read_model/i);
    assert.equal(params.length, 2);
    queries.push({ text, params }); return rows.has(String(params[1])) ? [rows.get(String(params[1]))!] : [];
  };
  const launch: BoundedChildLauncher = async (command, options) => {
    launched.push(command);
    assert.equal(command.executable, process.execPath);
    assert.equal(command.args[0], "--experimental-strip-types");
    assert.equal(command.args[1], resolve("scripts/restore-state-buckets.mts"));
    assert.equal(options.maxBufferBytes, 64 * 1024);
    assert.equal(options.discardOutputAfterSettlement, true);
    assert.ok(active.has(`${command.id}/restore-state-buckets.mts`));
    command.onStarted?.(1000 + launched.length);
    if (command.id === "state-bucket-prepare") {
      assert.equal(active.size, 1);
      assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CONTRACT, "registry-runtime-bindings");
      assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CAPABILITY, "MANUAL_CONTRACT");
      assert.equal(command.args[2], `--prepare=${planDirectory}`);
      await mkdir(planDirectory, { recursive: true });
      const manifestPath = join(planDirectory, "manifest.json");
      await writeFile(manifestPath, JSON.stringify({ units, unassigned }));
      return exited(command, `STATE_BUCKET_PREPARED=${JSON.stringify({ manifestPath })}\n`);
    }
    const selected = units.find(row => command.id === `${row.contractId}:state-restore`)!;
    assert.ok(selected);
    assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CONTRACT, selected.contractId);
    assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_CAPABILITY, selected.family === "candidate-campaign-sites-derived" ? "ROUTINE_CONTRACT" : "MANUAL_CONTRACT");
    assert.equal(command.env?.WTP_RUNTIME_AUTHORITY_PARENT_PID, String(process.pid));
    assert.deepEqual(command.args.slice(2), [`--unit=${selected.inputFile}`, `--sha256=${selected.fileSha256}`, `--contract=${selected.contractId}`]);
    return exited(command, `STATE_BUCKET_RESULT=${JSON.stringify({ family: selected.family, state: selected.state,
      versionId: `state-${selected.family}-${selected.state}`, status: "PUBLISHED" })}\n`);
  };
  return { env, rows, queries, active, released, observed, launched, slots, query, launch,
    run: (child: BoundedChildLauncher = launch) => restoreStateBuckets({ env, query, slots, launch: child }) };
}

test("the automatic state prepass prepares once then admits only missing and changed units", async t => {
  const missing = unit("ballot-contests", "CA"), changed = unit("candidate-campaign-sites-derived", "IL");
  const same = unit("candidate-profiles", "NH"), current = unit("voting-sites", "NJ");
  const f = await fixture(t, [missing, changed, same, current]);
  f.rows.set(changed.scope, { current_version_id: "older-bootstrap", detail: 'STATE_BUCKET_RESTORE_V1 {"inputHash":"old"}' });
  f.rows.set(same.scope, { current_version_id: "same-bootstrap", detail: `STATE_BUCKET_RESTORE_V1 ${JSON.stringify({ inputHash: same.inputHash })}` });
  f.rows.set(current.scope, { current_version_id: "ordinary-published", detail: "Normal source publication" });
  assert.deepEqual(await f.run(), { published: 2, unchanged: 2, failures: [] });
  assert.deepEqual(f.launched.map(row => row.id), ["state-bucket-prepare", `${missing.contractId}:state-restore`, `${changed.contractId}:state-restore`]);
  assert.deepEqual(f.queries.map(row => row.params), [missing, changed, same, current].map(row => [row.recordClass, row.scope]));
  assert.equal(f.active.size, 0); assert.equal(f.released.length, 3); assert.deepEqual(f.observed, [1001, 1002, 1003]);
});

test("unchanged bootstrap and ordinary current publications need no unit child or parent mutation", async t => {
  const units = [unit("ballot-contests", "AZ"), unit("candidate-corpus", "NH"), unit("voting-sites", "NJ")];
  const f = await fixture(t, units);
  f.rows.set(units[0].scope, { current_version_id: "same", detail: `STATE_BUCKET_RESTORE_V1 ${JSON.stringify({ inputHash: units[0].inputHash })}` });
  f.rows.set(units[1].scope, { current_version_id: "ordinary", detail: null });
  f.rows.set(units[2].scope, { current_version_id: "ordinary", detail: "Worker source publication" });
  assert.deepEqual(await f.run(), { published: 0, unchanged: 3, failures: [] });
  assert.deepEqual(f.launched.map(row => row.id), ["state-bucket-prepare"]);
  assert.equal(f.queries.length, 3); assert.equal(f.active.size, 0); assert.equal(f.released.length, 1);
});

test("an unassigned preserved identity blocks every unit before pointer reads", async t => {
  const f = await fixture(t, [unit("ballot-contests", "AZ")], [{ family: "registry-runtime", id: "unresolved-holder" }]);
  await assert.rejects(f.run(), /STATE_BUCKET_UNASSIGNED:.*unresolved-holder/);
  assert.deepEqual(f.launched.map(row => row.id), ["state-bucket-prepare"]);
  assert.equal(f.queries.length, 0); assert.equal(f.active.size, 0); assert.equal(f.released.length, 1);
});

test("a failed unit names its own family and state, releases memory, and leaves its sibling publishing", async t => {
  const failed = unit("candidate-profiles", "IL"), sibling = unit("ballot-contests", "CA");
  const f = await fixture(t, [failed, sibling]);
  const outcome = await f.run(async (command, options) => {
    if (command.id === `${failed.contractId}:state-restore`) throw new Error("state fixture launch failed");
    return f.launch(command, options);
  });
  assert.equal(outcome.published, 1); assert.equal(outcome.unchanged, 0);
  assert.equal(outcome.failures.length, 1); assert.match(outcome.failures[0], /^candidate-profiles:IL .*state fixture launch failed/);
  assert.equal(f.active.size, 0); assert.equal(f.released.length, 3);
});

test("a failed preparation preserves its diagnostic and releases the preparation reservation", async t => {
  const f = await fixture(t, [unit("ballot-contests", "IL")]);
  await assert.rejects(f.run(async command => ({ ...exited(command, ""), status: 1, stderr: "origin source unavailable" })), /origin source unavailable/);
  assert.equal(f.queries.length, 0); assert.equal(f.active.size, 0); assert.equal(f.released.length, 1);
});

test("a unit cannot claim another state's successful receipt", async t => {
  const f = await fixture(t, [unit("ballot-contests", "IL")]);
  const outcome = await f.run(async (command, options) => {
    const result = await f.launch(command, options);
    return command.id === "state-bucket-prepare" ? result : { ...result, stdout: result.stdout.replace('"state":"IL"', '"state":"CA"') };
  });
  assert.equal(outcome.published, 0); assert.equal(outcome.failures.length, 1);
  assert.match(outcome.failures[0], /^ballot-contests:IL .*STATE_BUCKET_RECEIPT_INVALID/);
  assert.equal(f.active.size, 0);
});

test("normal runner cycles await automatic restore and retain named failures without changing manual publication mode", async () => {
  const source = await readFile("scripts/routine-civic-data-runner.mts", "utf8");
  const start = source.indexOf("if (!PUBLISH_NOW && ONLY === null) {");
  const end = source.indexOf("\nconst crashedTasks:", start);
  assert.ok(start >= 0 && end > start);
  const block = transpileModule(source.slice(start, end), { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.CommonJS } }).outputText;
  for (const [publishNow, only, expected] of [[false, null, 1], [true, null, 0], [false, "ballot-contests:IL", 0]] as const) {
    let calls = 0, finished = false;
    const failures: unknown[] = [];
    const context = { PUBLISH_NOW: publishNow, ONLY: only, step: "", process: { env: { DATABASE_URL: "local" } },
      neon: () => ({ query: async () => [] }), supervisorFailures: failures, safeFailure: (value: string) => value,
      sanitizedErrorDiagnostic: String, console: { log() {} }, restoreStateBuckets: async () => {
        calls++; await Promise.resolve(); finished = true;
        return { published: 1, unchanged: 2, failures: ["candidate-profiles:IL held source"] };
      } };
    await runInNewContext(`(async () => { ${block} })()`, context);
    assert.equal(calls, expected); assert.equal(finished, Boolean(expected));
    assert.equal(failures.length, expected);
    if (expected) assert.deepEqual(JSON.parse(JSON.stringify(failures)), [{ taskId: "state-bucket-restore", code: "STATE_BUCKET_RESTORE_FAILED", detail: "candidate-profiles:IL held source" }]);
  }
});
