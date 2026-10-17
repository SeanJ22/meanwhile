import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { AUTOMATIC_REFRESH_TASKS, automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { ballotInputHash, ballotInputStamp } from "../lib/civic-data/ballot-input.ts";
import { ballotPublicationDue, ballotPublicationSummary, parseBallotPublicationResult, readLatestBallotPublication,
  readLatestBallotPublicationSummary, recordBallotPublication, type BallotPublicationResult, type BallotPublicationSummaries } from "../lib/civic-data/ballot-publication.ts";
import { admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";
import { routineSerialLane } from "../lib/civic-data/runner.ts";
import { parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { workerPublicationTasksFor } from "../lib/civic-data/worker-publication-tasks.ts";
import { routineDueRequestFor } from "../lib/civic-data/routine-due-request.ts";
import { lookupAction } from "../lib/control-plane/gateway/registry.ts";
import { fixtureRepositories } from "./helpers/meeting-doors-fixture.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";
import { REGISTRY_STATES, type BallotState } from "../lib/civic-data/state-scopes.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { createFileRepositories } from "../lib/control-plane/repository/file-store.ts";
import { pgAppendOnlyRepository } from "../lib/control-plane/repository/pg-store.ts";
import { routineCivicDataSupervisorOutcome } from "../lib/control-plane/freshness-cycle-outcome.ts";

const now = "2026-10-14T00:00:00.000Z";
const ballotTask = AUTOMATIC_REFRESH_TASKS.find(task => task.id === "ballot-contests:TX")!;

for (const provider of ["memory", "file", "postgres"] as const) {
  test(`${provider}: all state and territory reports retain every held contest while scheduler and aggregate reads stay summaries`, async () => {
    const reportFor = (state: BallotState): BallotPublicationResult => ({
      kind: "BALLOT_PUBLICATION", state, inputHash: "a".repeat(64), inputStamp: `git:${state}`, at: now,
      status: "PUBLISHED", versionId: `fixture-${state}`, merged: [`${state.toLowerCase()}.json`], skipped: [], reason: null,
      heldContests: Array.from({ length: 256 }, (_, index) => ({ state, contestId: `${state}-${index}`,
        title: `${state} district ${index}`, reason: `${state} official list remains incomplete: ${"source evidence ".repeat(20)}` })),
    });
    let repos = createMemoryRepositories();
    let cleanup = async () => {};
    let transferred: unknown = null;
    try {
      if (provider === "file") {
        const directory = await mkdtemp(resolve(tmpdir(), "ballot-state-reports-"));
        cleanup = () => rm(directory, { recursive: true, force: true });
        repos = await createFileRepositories(directory);
      }
      if (provider === "postgres") {
        const { PGlite } = await import("@electric-sql/pglite");
        const db = new PGlite();
        cleanup = () => db.close();
        await db.exec(`CREATE TABLE cp_log_heads(log_table text,log_key text,next_position bigint,PRIMARY KEY(log_table,log_key));
          CREATE TABLE cp_log_owner_digests(log_key text,record_id text,position bigint,recorded_at timestamptz,record jsonb,
            PRIMARY KEY(log_key,record_id),UNIQUE(log_key,position));`);
        const sql = { query: async (text: string, params?: readonly unknown[]) => {
          const rows = (await db.query(text, params ? [...params] : [])).rows;
          transferred = rows;
          return rows;
        } };
        repos = { ...repos, ownerDigests: pgAppendOnlyRepository(sql, "owner_digests") };
      }
      const repository = repos.ownerDigests;
      let exposed: unknown;
      let writes = 0;
      repos = { ...repos, ownerDigests: { ...repository,
        append: async (key, id, record, at) => {
          assert.equal(key, `ballot-publication:${record.ballotPublication!.state}`);
          assert.equal(record.runtimeOutcome, undefined, "a state publication never embeds a country report");
          assert.equal(record.ballotPublication!.heldContests!.length, 256);
          writes++;
          return repository.append(key, id, record, at);
        },
        readLatest: async (...args) => {
          assert.equal(args[0].length, 1, "a state lookup requests one partition");
          const rows = await repository.readLatest(...args);
          exposed = [...rows];
          return rows;
        },
      } };
      const context = { cycleId: "state-cycle", testedSha: "b".repeat(40) };
      let fullBytes = 0;
      for (const state of REGISTRY_STATES) {
        const report = reportFor(state);
        await recordBallotPublication(repos, report, context);
        fullBytes += JSON.stringify(report).length;
      }
      assert.equal(writes, REGISTRY_STATES.length);
      assert.deepEqual(await repository.keys(), REGISTRY_STATES.map(state => `ballot-publication:${state}`).sort());
      const summaries: BallotPublicationSummaries = {};
      for (const state of REGISTRY_STATES) {
        const summary = await readLatestBallotPublicationSummary(repos, state);
        assert.deepEqual(summary, ballotPublicationSummary(reportFor(state)));
        summaries[state] = summary!;
        const expected = { ballotPublication: summary };
        assert.deepEqual(exposed, [[`ballot-publication:${state}`, expected]]);
        if (provider === "postgres") assert.deepEqual(transferred, [{ log_key: `ballot-publication:${state}`, record: expected }]);
        assert.ok(JSON.stringify(exposed).length < 512, "scheduler reads no named-contest arrays");
        assert.equal(ballotPublicationDue(`ballot-contests:${state}`, summary!.inputStamp!, summary, { lastSucceededAt: now }), false);
      }
      const outcome = routineCivicDataSupervisorOutcome({ ballotPublications: summaries, cycleId: "state-cycle",
        startedAt: now, finishedAt: now, testedSha: context.testedSha, host: "runner", provider, durable: true,
        attemptedTasks: 0, verifiedSourceSuccesses: 0, verifiedSourceFailures: 0, failures: [], taskReceipts: [] });
      assert.ok(JSON.stringify(outcome).length < fullBytes / 100, "the country aggregate retains only scalar summaries");
      assert.doesNotMatch(JSON.stringify(outcome), /heldContests|source evidence|district 255/);
      for (const state of ["TX", "AZ"] as const) {
        const report = reportFor(state);
        const expected = { ...report, heldContestCount: 256 };
        assert.deepEqual(await readLatestBallotPublication(repos, state), expected);
        assert.deepEqual(exposed, [[`ballot-publication:${state}`, { ballotPublication: expected }]]);
        if (provider === "postgres") assert.deepEqual(transferred, [{ log_key: `ballot-publication:${state}`, record: { ballotPublication: expected } }]);
      }
    } finally { await cleanup(); }
  });
}

test("an unwritten state publication rejects and remains due for history retry", async () => {
  const repos = createMemoryRepositories();
  const report: BallotPublicationResult = { kind: "BALLOT_PUBLICATION", state: "TX", inputHash: "a".repeat(64), inputStamp: "git:input",
    at: now, status: "PUBLISHED", versionId: "fixture", merged: ["tx.json"], skipped: [], reason: null };
  const unavailable = { ...repos, ownerDigests: { ...repos.ownerDigests, append: async () => { throw new Error("history unavailable"); } } };
  await assert.rejects(() => recordBallotPublication(unavailable, report, { cycleId: "failed", testedSha: null }), /history unavailable/);
  const prior = await readLatestBallotPublicationSummary(repos, "TX");
  assert.equal(prior, null);
  assert.equal(ballotPublicationDue("ballot-contests:TX", report.inputStamp!, prior, undefined), true);
});

test("all missing state publications run in the first cycle even when old report stamps match", () => {
  for (const state of REGISTRY_STATES) {
    const task = `ballot-contests:${state}`, stamp = `git:${state}`;
    const prior = { state, inputStamp: stamp, status: "PUBLISHED" as const };
    assert.equal(ballotPublicationDue(task, stamp, null, undefined), true);
    assert.equal(ballotPublicationDue(task, stamp, prior, {}), true, "a report cannot stand in for a missing state pointer");
    assert.equal(ballotPublicationDue(task, stamp, prior, { lastSucceededAt: now }), false);
    assert.equal(ballotPublicationDue(task, `${stamp}-changed`, prior, { lastSucceededAt: now }), true);
    assert.equal(ballotPublicationDue(task, stamp, { ...prior, status: "HELD" }, {}), false, "unchanged held work follows the normal retry clock");
  }
});

test("fresh runtime checkouts retain ballot input stamps and only a changed state's blob becomes due", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-checkout-fixture-"));
  const repository = resolve(directory, "source"), checkout = resolve(directory, "runtime");
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", ["-c", "user.name=Ballot test", "-c", "user.email=ballot@example.test", ...args], { cwd, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    await mkdir(repository);
    git(repository, "init", "--quiet");
    const inputs = resolve(repository, "data/ballot");
    await mkdir(inputs, { recursive: true });
    await writeFile(resolve(inputs, "az.json"), '{"state":"AZ","version":1}');
    await writeFile(resolve(inputs, "tx.json"), '{"state":"TX","version":1}');
    git(repository, "add", ".");
    git(repository, "commit", "--quiet", "-m", "Initial state inputs");
    const initial = { AZ: await ballotInputStamp(inputs, "AZ"), TX: await ballotInputStamp(inputs, "TX") };
    assert.match(initial.AZ, /^git:[a-f0-9]{40,64}$/);
    git(directory, "clone", "--quiet", "--no-local", repository, checkout);
    const freshInputs = resolve(checkout, "data/ballot");
    await utimes(resolve(freshInputs, "az.json"), 10, 10);
    await utimes(resolve(freshInputs, "tx.json"), 20, 20);
    assert.equal(await ballotInputStamp(freshInputs, "AZ"), initial.AZ);
    assert.equal(await ballotInputStamp(freshInputs, "TX"), initial.TX);
    await writeFile(resolve(inputs, "az.json"), '{"state":"AZ","version":2}');
    git(repository, "add", "data/ballot/az.json");
    git(repository, "commit", "--quiet", "-m", "Arizona input changes");
    git(checkout, "fetch", "--quiet", "origin");
    git(checkout, "checkout", "--quiet", "--detach", "FETCH_HEAD");
    for (const state of ["AZ", "TX"] as const) {
      const report = { kind: "BALLOT_PUBLICATION", state, inputHash: "a".repeat(64), inputStamp: initial[state], at: now,
        status: "PUBLISHED", versionId: "fixture", merged: [`${state.toLowerCase()}.json`], skipped: [], reason: null } as const;
      assert.equal(ballotPublicationDue(`ballot-contests:${state}`, await ballotInputStamp(freshInputs, state), report, { lastSucceededAt: now }), state === "AZ");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("the runner's ballot child publishes only its state under exact authority and ignores other state files", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-child-fixture-"));
  try {
    const state = JSON.parse(await readFile("tests/fixtures/ballot-national/tx.json", "utf8"));
    const ballot = state.ballots["TX:fixture-2026-general"];
    ballot.contests[0].candidateListComplete = false;
    ballot.candidacies = ballot.candidacies.filter((row: { contestId: string }) => row.contestId !== "fixture-tx-governor");
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
    await writeFile(resolve(directory, "ak.json"), "{");
    const source = await readFile("scripts/routine-civic-data-runner.mts", "utf8");
    const snippet = transpileModule(source.slice(source.indexOf("function sourceChildCommand("), source.indexOf("function recordSourceSettlementFailures")),
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
    const parentEnv = { ...process.env, NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
      DATABASE_URL: "postgresql://local:local@staging.invalid/reader", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control" };
    const commandFor = new Function("admittedRuntimeChildEnvironment", "automaticRefreshContract", "routineSerialLane", "process",
      `${snippet} return sourceChildCommand;`)(admittedRuntimeChildEnvironment, automaticRefreshContract, routineSerialLane, { ...process, env: parentEnv });
    assert.deepEqual(ballotTask.command, ["scripts/assemble-ballot-package.mts", "--state=TX"]);
    const command = commandFor({ id: ballotTask.id, kind: "SOURCE", task: ballotTask, command: ballotTask.command });
    const run = spawnSync(command.executable, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "tests/fixtures/ballot-national/publish-child.mts", directory], { env: command.env, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const report = parseBallotPublicationResult(run.stdout);
    assert.ok(report, run.stderr + run.stdout);
    assert.equal(report.status, "PUBLISHED");
    assert.equal(report.state, "TX");
    assert.equal(report.inputHash, await ballotInputHash(directory, "TX"));
    assert.deepEqual(report.merged, ["tx.json"]);
    assert.deepEqual(report.skipped, []);
    assert.deepEqual(report.heldContests?.map(row => [row.state, row.contestId, row.title]), [["TX", "fixture-tx-governor", "Governor"]]);
    assert.equal(report.heldContests![0].reason, "The official candidate list hasn't been fully checked.");
    assert.equal(parseRoutineRunnerReceipt(run.stdout).ok, true);
    assert.equal(ballotPublicationDue(ballotTask.id, report.inputStamp!, report, { lastSucceededAt: now }), false);
    await writeFile(resolve(directory, "ak.json"), "{}");
    assert.equal(ballotPublicationDue(ballotTask.id, await ballotInputStamp(directory, "TX"), report, { lastSucceededAt: now }), false);
    await writeFile(resolve(directory, "tx.json"), "{");
    assert.equal(ballotPublicationDue(ballotTask.id, await ballotInputStamp(directory, "TX"), report, { lastSucceededAt: now }), true);
    const held = spawnSync(command.executable, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "tests/fixtures/ballot-national/publish-child.mts", directory], { env: command.env, encoding: "utf8", timeout: 60_000 });
    assert.equal(held.status, 2, held.stderr + held.stdout);
    assert.equal(parseBallotPublicationResult(held.stdout)?.skipped[0].file, "tx.json");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Admin's ballot control queues the normal runner task even before its next daily refresh and reads the last report", async () => {
  const worker = workerPublicationTasksFor([{ id: "fixture-candidate-work", contractId: "ballot-contests:TX", requestedAt: now, batch: false }], now);
  assert.deepEqual(worker[0].command, ["scripts/promote-manual-civic-projection.mts", "--contract=ballot-contests:TX", "--worker-results=fixture-candidate-work"]);
  const repos = await fixtureRepositories();
  const action = lookupAction(actionDef("ballot-publish").gateway!.type)!;
  const input = actionInput("ballot-publish", { target: "ballot-contests:TX", scopeKey: "state:TX", option: null, words: "", amount: "", selected: [] });
  assert.equal(action.validate(input).ok, true);
  const result = await action.execute({ repos, now: () => now, currentStateVersion: null, codeSha: null },
    { at: now, receiptId: "fixture-ballot-action", request: { actorRef: "owner" } } as Parameters<typeof action.execute>[1], input);
  assert.equal(result.ok, true);
  const requests = (await repos.adminConfig.mustRead("current")).value.routineDueRequests!;
  assert.equal(requests.length, REGISTRY_STATES.length);
  assert.equal(new Set(requests.map(row => row.contractId)).size, REGISTRY_STATES.length);
  const request = requests.find(row => row.contractId === "ballot-contests:TX")!;
  assert.equal(routineDueRequestFor(ballotTask, { lastAttemptedAt: "2026-10-13T23:59:00.000Z" }, Date.parse(now), [request])?.id, request.id);
  assert.equal(routineDueRequestFor(ballotTask, { lastAttemptedAt: now }, Date.parse(now), [request]), null);
  const report = { kind: "BALLOT_PUBLICATION", state: "TX", inputHash: "a".repeat(64), at: now, status: "PUBLISHED", versionId: "fixture",
    merged: ["tx.json"], skipped: [],
    heldContests: [{ state: "TX", contestId: "fixture-tx-governor", title: "Governor", reason: "Official list is incomplete." }], reason: null } as const;
  const arizona = { ...report, state: "AZ", merged: ["az.json"], heldContests: [] } as const;
  await recordBallotPublication(repos, report, { cycleId: "first", testedSha: null });
  await recordBallotPublication(repos, arizona, { cycleId: "first", testedSha: null });
  const newer = { ...arizona, inputHash: "b".repeat(64) };
  await recordBallotPublication(repos, newer, { cycleId: "second", testedSha: null });
  assert.deepEqual(await readLatestBallotPublication(repos, "TX"), { ...report, heldContestCount: 1 });
  assert.deepEqual(await readLatestBallotPublication(repos, "AZ"), { ...newer, heldContestCount: 0 });
  assert.equal(await readLatestBallotPublication(repos, "AK"), null);
  assert.equal(ballotPublicationDue("ballot-contests:AZ", report.inputHash, report, { lastSucceededAt: now }), true);
  assert.equal(ballotPublicationDue("voting-sites:TX", report.inputHash, null, undefined), false);
  assert.equal(ballotPublicationDue("ballot-contests", report.inputHash, null, undefined), false);
});

test("publication reports reject files and held contests from a different state", () => {
  const report = { kind: "BALLOT_PUBLICATION", state: "TX", inputHash: "a".repeat(64), at: now,
    status: "PUBLISHED", versionId: "fixture", merged: ["tx.json"], skipped: [], heldContests: [], reason: null };
  const parse = (value: unknown) => parseBallotPublicationResult("BALLOT_PUBLICATION_RESULT=" + JSON.stringify(value));
  assert.deepEqual(parse(report), report);
  for (const invalid of [
    { ...report, state: "XX" }, { ...report, state: "tx" }, { ...report, state: undefined },
    { ...report, merged: ["az.json"] }, { ...report, skipped: [{ file: "az.json", reason: "Invalid receipt" }] },
    { ...report, heldContests: [{ state: "AZ", contestId: "race", title: "Governor", reason: "No candidates" }] },
  ]) assert.equal(parse(invalid), null);
});

test("every state has an independent ballot refresh task and failure domain", () => {
  const tasks = AUTOMATIC_REFRESH_TASKS.filter(task => task.id.startsWith("ballot-contests:"));
  assert.equal(tasks.length, REGISTRY_STATES.length);
  assert.equal(new Set(tasks.map(task => task.acquisitionFailureDomain)).size, REGISTRY_STATES.length);
  for (const state of REGISTRY_STATES) {
    const task = tasks.find(row => row.id === `ballot-contests:${state}`)!;
    assert.equal(task.scope, `US-${state}:state-election-ballots`);
    assert.deepEqual(task.command, ["scripts/assemble-ballot-package.mts", `--state=${state}`]);
    assert.equal(automaticRefreshContract(task.id), task.id);
  }
  assert.equal(automaticRefreshContract("ballot-contests"), null);
});


test("a changed national navigation source input is due independently of the ballot input report", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "navigation-publication-input-"));
  try {
    const path = resolve(directory, "sources.json");
    await writeFile(path, JSON.stringify({ electionDate: "2026-11-03", states: ["OH"] }));
    const inputHash = await ballotInputHash(path);
    const report = { kind: "BALLOT_PUBLICATION", inputHash, at: now, status: "PUBLISHED", versionId: "national-navigation",
      merged: [], skipped: [], reason: null } as const;
    const repos = await fixtureRepositories();
    await repos.ownerDigests.append("owner-digest", "fixture-navigation-report", { runtimeOutcome: {
      ballotPublication: { ...report, inputHash: "a".repeat(64), versionId: "national-ballots" }, ballotNavigationPublications: { OH: report },
    } } as never, now);
    assert.equal((await readLatestBallotPublication(repos))?.versionId, "national-ballots");
    await repos.ownerDigests.append("ballot-navigation:OH", "fixture-state-report", report as never, now);
    const prior = await readLatestBallotPublication(repos, "OH");
    assert.deepEqual(prior, report);
    assert.equal(ballotPublicationDue("ballot-navigation-oh", inputHash, prior), false);
    await writeFile(path, JSON.stringify({ electionDate: "2026-11-03", states: ["OH", "MI"] }));
    assert.equal(ballotPublicationDue("ballot-navigation-oh", await ballotInputHash(path), prior), true);
    assert.equal(ballotPublicationDue("state-people", await ballotInputHash(path), null), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
