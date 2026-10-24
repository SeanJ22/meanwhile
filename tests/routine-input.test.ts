import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { saveVotingSourceDoor } from "../lib/ballot/voting-source-publication.ts";
import type { VotingSourceDoor } from "../lib/ballot/voting-source-types.ts";
import { readRoutineInput, recordRoutineInput, routineInputChanged, routineInputStamp } from "../lib/civic-data/routine-input.ts";
import { ROUTINE_SOURCE_TASKS, routineTaskDue, routineTaskNextDueMs } from "../lib/civic-data/runner.ts";
import { AUTOMATIC_REFRESH_TASKS } from "../lib/civic-data/automatic-refresh.ts";

const at = "2026-10-24T10:00:00.000Z";
const door = (state: string): VotingSourceDoor => ({ id: `test-${state}`, publisher: "Election office",
  url: `https://${state.toLowerCase()}.gov/vote`, shape: "list-page", covers: ["ELECTION_DAY"],
  scope: { state, ocdId: `ocd-division/country:us/state:${state.toLowerCase()}`, name: state }, electionDate: "2026-11-03",
  electionPageUrl: `https://${state.toLowerCase()}.gov/vote` });

test("one changed registration file makes only that state due and a subsequent scheduled pass reuses the stamp", async t => {
  const root = await mkdtemp(resolve(tmpdir(), "rn03-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, "data/derived/registration");
  await mkdir(directory, { recursive: true });
  const repos = createMemoryRepositories();
  const states = ["or", "nc", "az"];
  const clock = { lastAttemptedAt: at, lastSucceededObservedAt: at };
  for (const state of states) {
    await writeFile(resolve(directory, `${state}.json`), JSON.stringify({ state, districts: [] }));
    const taskId = `registration-${state}`;
    const inputStamp = (await routineInputStamp(root, taskId, repos))!;
    assert.equal(routineInputChanged(inputStamp, await readRoutineInput(repos, taskId)), true, "no stamp is due");
    await recordRoutineInput(repos, { taskId, inputStamp, at }, { cycleId: "first-pass", testedSha: null });
  }
  await writeFile(resolve(directory, "or.json"), JSON.stringify({ state: "or", districts: ["Metro"] }));
  const due = [];
  for (const state of states) {
    const taskId = `registration-${state}`, task = ROUTINE_SOURCE_TASKS.find(row => row.id === taskId)!;
    assert.ok(task);
    assert.equal(routineTaskDue(task, clock, Date.parse(at) + 300_000), false);
    const inputStamp = (await routineInputStamp(root, taskId, repos))!;
    if (routineInputChanged(inputStamp, await readRoutineInput(repos, taskId))) {
      due.push(taskId);
      await recordRoutineInput(repos, { taskId, inputStamp, at: "2026-10-24T10:05:00.000Z" }, { cycleId: "second-pass", testedSha: null });
    }
  }
  assert.deepEqual(due, ["registration-or"]);
  await writeFile(resolve(root, "unrelated-code.ts"), "export const version = 2;");
  for (const state of states) {
    const taskId = `registration-${state}`;
    assert.equal(routineInputChanged(await routineInputStamp(root, taskId, repos), await readRoutineInput(repos, taskId)), false);
  }
});

test("voting inputs follow each state's seed and registered doors without cycling on source health", async t => {
  const root = await mkdtemp(resolve(tmpdir(), "rn03-voting-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = resolve(root, "data/reference");
  await mkdir(directory, { recursive: true });
  const repos = createMemoryRepositories(), nc = door("NC"), az = door("AZ");
  await writeFile(resolve(directory, "voting-source-doors.json"), JSON.stringify([nc, az]));
  await writeFile(resolve(directory, "voting-legacy-doors.json"), "[]");
  const initialNC = await routineInputStamp(root, "voting-sites:NC", repos);
  const initialAZ = await routineInputStamp(root, "voting-sites:AZ", repos);
  await writeFile(resolve(directory, "voting-legacy-doors.json"), JSON.stringify([{ ...nc, id: "nc-legacy" }]));
  assert.notEqual(await routineInputStamp(root, "voting-sites:NC", repos), initialNC);
  assert.equal(await routineInputStamp(root, "voting-sites:AZ", repos), initialAZ);
  await saveVotingSourceDoor(repos.doors, nc, at);
  const registered = await routineInputStamp(root, "voting-sites:NC", repos);
  const [row] = await repos.doors.listWhere(["config", "votingState_NC"], "true");
  await repos.doors.compareAndSet(row.id, row.revision, { ...row.value, lastSuccessAt: at, updatedAt: at }, at);
  assert.equal(await routineInputStamp(root, "voting-sites:NC", repos), registered);
  await saveVotingSourceDoor(repos.doors, { ...nc, url: `${nc.url}/new` }, at);
  assert.notEqual(await routineInputStamp(root, "voting-sites:NC", repos), registered);
  assert.equal(await routineInputStamp(root, "voting-sites:AZ", repos), initialAZ);
});

test("the reported next check is the exact cadence or failure retry boundary", () => {
  const task = ROUTINE_SOURCE_TASKS.find(row => row.id === "registration-or")!;
  for (const clock of [{ lastAttemptedAt: at, lastSucceededObservedAt: at },
    { lastAttemptedAt: at, failureStreak: 4 }]) {
    const next = routineTaskNextDueMs(task, clock, Date.parse(at) + 1);
    assert.equal(routineTaskDue(task, clock, next - 1), false);
    assert.equal(routineTaskDue(task, clock, next), true);
  }
});

test("the next voting check anticipates the final-week cadence starting and ending", () => {
  const task = AUTOMATIC_REFRESH_TASKS.find(row => row.id === "voting-sites:NC")!;
  for (const [checked, observed, expected] of [
    ["2026-10-26T21:00:00.000Z", "2026-10-26T21:05:00.000Z", "2026-10-27T00:00:00.000Z"],
    ["2026-11-04T11:30:00.000Z", "2026-11-04T11:35:00.000Z", "2026-11-04T23:30:00.000Z"],
  ]) {
    const clock = { lastAttemptedAt: checked, lastSucceededObservedAt: checked };
    const next = routineTaskNextDueMs(task, clock, Date.parse(observed));
    assert.equal(new Date(next).toISOString(), expected);
    assert.equal(routineTaskDue(task, clock, next - 1), false);
    assert.equal(routineTaskDue(task, clock, next), true);
  }
});
