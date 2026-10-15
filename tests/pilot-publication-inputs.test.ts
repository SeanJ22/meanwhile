import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const { stripTypeScriptTypes } = nodeModule as unknown as { stripTypeScriptTypes(source: string): string };
const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
const runSource = source.slice(source.indexOf("async function runPublishNow(state: string)"),
  source.indexOf("async function persistOuterRoutineChildFailure("));

function pilot(input: { owed?: boolean; current?: boolean; paused?: boolean; inputError?: Error; status?: number } = {}) {
  const calls = { owed: [] as string[], fingerprint: [] as string[], children: 0, reservations: 0, releases: 0, failures: 0 };
  const context = {
    provider: "postgres", canary: false, publicationInputStore: undefined,
    ownerRepositories: async () => ({ researchIntents: { read: async () => [] } }),
    controlPlaneUrlFromEnv: () => "fixture", RESEARCH_INTENT_LOG_KEY: "intents",
    readIntents: () => ({ runnerPause: { paused: input.paused ?? false } }),
    PostgresRoutineDataStore: class {}, neon: () => ({ query: async () => [] }),
    hasPendingPublicationWork: async ({ state }: { state: string }) => { calls.owed.push(state); return input.owed ?? false; },
    checkReaderEdgePublicationInputs: async ({ state }: { state: string }) => {
      calls.fingerprint.push(state);
      if (input.inputError) throw input.inputError;
      return { current: input.current === false ? null : { ok: true, readerEdge: "CURRENT" } };
    },
    routineStateMemory: { acquire: async () => { calls.reservations++; return () => { calls.releases++; }; } },
    runRuntimeChildren: async () => { calls.children++; return [{ status: input.status ?? 0, stdout: "", stderr: "" }]; },
    standingChildEnvironment: () => ({}), process, TS_CHILD: [], CODE_ROOT: "/fixture",
    ROUTINE_SUPERVISOR_STARTED_AT_ENV: "started", hostname: () => "fixture",
    routineSupervisorCycleId: () => "cycle",
    persistOuterRoutineChildFailure: async () => { calls.failures++; },
  };
  const run = runInNewContext(stripTypeScriptTypes(`${runSource}\nrunPublishNow;`), context) as (state: string) => Promise<void>;
  return { calls, run };
}

test("a current state with no owed publication starts no process or memory reservation", async () => {
  const { calls, run } = pilot();
  await run("US-IL");
  assert.deepEqual(calls, { owed: ["US-IL"], fingerprint: ["US-IL"], children: 0, reservations: 0, releases: 0, failures: 0 });
});

test("changed source inputs publish even when the worker outbox is empty", async () => {
  const { calls, run } = pilot({ current: false });
  await run("US-IL");
  assert.equal(calls.children, 1);
  assert.equal(calls.reservations, 1);
  assert.equal(calls.releases, 1);
});

test("owed verified work publishes even when the existing reader artifacts are current", async () => {
  const { calls, run } = pilot({ owed: true });
  await run("US-NJ");
  assert.deepEqual(calls.owed, ["US-NJ"]);
  assert.deepEqual(calls.fingerprint, []);
  assert.equal(calls.children, 1);
});

test("owner pause prevents input checks and publication", async () => {
  const { calls, run } = pilot({ paused: true, owed: true });
  await run("US-IL");
  assert.equal(calls.children, 0);
  assert.deepEqual(calls.owed, []);
});

test("an unreadable input check fails instead of declaring an unchanged publication", async () => {
  const { calls, run } = pilot({ inputError: new Error("fixture input unavailable") });
  await assert.rejects(run("US-IL"), /fixture input unavailable/);
  assert.equal(calls.children, 0);
});

test("a failed admitted publication still records its failure and releases memory", async () => {
  const { calls, run } = pilot({ owed: true, status: 2 });
  await run("US-IL");
  assert.equal(calls.failures, 1);
  assert.equal(calls.releases, 1);
});
