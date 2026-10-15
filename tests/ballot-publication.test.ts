import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { transpileModule, ScriptTarget, ModuleKind } from "typescript";
import { AUTOMATIC_REFRESH_TASKS, automaticRefreshContract } from "../lib/civic-data/automatic-refresh.ts";
import { ballotInputHash, ballotPublicationDue, parseBallotPublicationResult, readLatestBallotPublication } from "../lib/civic-data/ballot-publication.ts";
import { admittedRuntimeChildEnvironment } from "../lib/civic-data/runtime-authority.ts";
import { routineSerialLane } from "../lib/civic-data/runner.ts";
import { parseRoutineRunnerReceipt } from "../lib/civic-data/runner-receipt.ts";
import { workerPublicationTasksFor } from "../lib/civic-data/worker-publication-tasks.ts";
import { routineDueRequestFor } from "../lib/civic-data/routine-due-request.ts";
import { lookupAction } from "../lib/control-plane/gateway/registry.ts";
import { fixtureRepositories } from "./helpers/meeting-doors-fixture.ts";
import { actionInput } from "../app/(admin)/_mw/admin-v6/contract.ts";
import { actionDef } from "../app/(admin)/_mw/admin-v6/actions.ts";

const now = "2026-10-14T00:00:00.000Z";
const ballotTask = AUTOMATIC_REFRESH_TASKS.find(task => task.id === "ballot-contests")!;

test("the runner's ballot child assembles outside the checkout, publishes under its exact manual authority, and reports skipped states", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "ballot-child-fixture-"));
  try {
    const state = JSON.parse(await readFile("tests/fixtures/ballot-national/tx.json", "utf8"));
    state.ballots["TX:fixture-2026-general"].contests[0].candidateListComplete = false;
    await writeFile(resolve(directory, "tx.json"), JSON.stringify(state));
    await writeFile(resolve(directory, "ak.json"), "{");
    const source = await readFile("scripts/routine-civic-data-runner.mts", "utf8");
    const snippet = transpileModule(source.slice(source.indexOf("function sourceChildCommand("), source.indexOf("function recordSourceSettlementFailures")),
      { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.None } }).outputText;
    const parentEnv = { ...process.env, NODE_ENV: "development", WTP_RUNTIME_MODE: "staging", WTP_DB_ROLE: "local",
      DATABASE_URL: "postgresql://local:local@staging.invalid/reader", WTP_CONTROL_PLANE_DATABASE_URL: "postgresql://local:local@staging.invalid/control" };
    const commandFor = new Function("admittedRuntimeChildEnvironment", "automaticRefreshContract", "routineSerialLane", "process",
      `${snippet} return sourceChildCommand;`)(admittedRuntimeChildEnvironment, automaticRefreshContract, routineSerialLane, { ...process, env: parentEnv });
    assert.deepEqual(ballotTask.command, ["scripts/assemble-ballot-package.mts"]);
    const command = commandFor({ id: ballotTask.id, kind: "SOURCE", task: ballotTask, command: ballotTask.command });
    const run = spawnSync(command.executable, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "tests/fixtures/ballot-national/publish-child.mts", directory], { env: command.env, encoding: "utf8", timeout: 60_000 });
    assert.equal(run.status, 0, run.stderr + run.stdout);
    const report = parseBallotPublicationResult(run.stdout)!;
    assert.equal(report.status, "PUBLISHED");
    assert.equal(report.inputHash, await ballotInputHash(directory));
    assert.deepEqual(report.merged, ["tx.json"]);
    assert.equal(report.skipped[0].file, "ak.json");
    assert.ok(report.skipped[0].reason.length > 0);
    assert.deepEqual(report.heldContests?.map(row => [row.state, row.contestId, row.title]), [["TX", "fixture-tx-governor", "Governor"]]);
    assert.match(report.heldContests![0].reason, /fully checked/);
    assert.equal(parseRoutineRunnerReceipt(run.stdout).ok, true);
    assert.equal(ballotPublicationDue(ballotTask.id, report.inputHash, report), false);
    await writeFile(resolve(directory, "ak.json"), "{}");
    assert.equal(ballotPublicationDue(ballotTask.id, await ballotInputHash(directory), report), true);
    await rm(resolve(directory, "tx.json"));
    const held = spawnSync(command.executable, ["--experimental-strip-types", "--import", "./scripts/register-test-loader.mjs",
      "tests/fixtures/ballot-national/publish-child.mts", directory], { env: command.env, encoding: "utf8", timeout: 60_000 });
    assert.equal(held.status, 2, held.stderr + held.stdout);
    assert.equal(parseBallotPublicationResult(held.stdout)?.skipped[0].file, "ak.json");
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("Admin's ballot control queues the normal runner task even before its next daily refresh and reads the last report", async () => {
  const worker = workerPublicationTasksFor([{ id: "fixture-candidate-work", contractId: "ballot-contests", requestedAt: now, batch: false }], now);
  assert.deepEqual(worker[0].command, ["scripts/promote-manual-civic-projection.mts", "--contract=ballot-contests", "--worker-results=fixture-candidate-work"]);
  const repos = await fixtureRepositories();
  const action = lookupAction(actionDef("ballot-publish").gateway!.type)!;
  const input = actionInput("ballot-publish", { target: "ballot-contests", scopeKey: "us", option: null, words: "", amount: "", selected: [] });
  assert.equal(action.validate(input).ok, true);
  const result = await action.execute({ repos, now: () => now, currentStateVersion: null, codeSha: null },
    { at: now, receiptId: "fixture-ballot-action", request: { actorRef: "owner" } } as Parameters<typeof action.execute>[1], input);
  assert.equal(result.ok, true);
  const request = (await repos.adminConfig.mustRead("current", { routineDueRequests: true })).value.routineDueRequests![0];
  assert.equal(routineDueRequestFor(ballotTask, { lastAttemptedAt: "2026-10-13T23:59:00.000Z" }, Date.parse(now), [request])?.id, request.id);
  assert.equal(routineDueRequestFor(ballotTask, { lastAttemptedAt: now }, Date.parse(now), [request]), null);
  const report = { kind: "BALLOT_PUBLICATION", inputHash: "a".repeat(64), at: now, status: "PUBLISHED", versionId: "fixture",
    merged: ["tx.json"], skipped: [{ file: "ak.json", reason: "Source receipt is missing." }],
    heldContests: [{ state: "TX", contestId: "fixture-tx-governor", title: "Governor", reason: "Official list is incomplete." }], reason: null } as const;
  await repos.ownerDigests.append("owner-digest", "fixture-ballot-report", { runtimeOutcome: { ballotPublication: report } } as never, now);
  assert.deepEqual(await readLatestBallotPublication(repos), report);
});
