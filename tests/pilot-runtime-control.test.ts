import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import { runnerControlReader } from "../scripts/pilot-runtime-control.mts";

test("runner control reads coalesce polls and retain later-committed lower positions", async () => {
  const repos = createMemoryRepositories();
  let now = 0;
  let calls = 0;
  let configReads = 0;
  let stateReads = 0;
  let fail = false;
  let revision = "1";
  const high = buildResearchIntent("PAUSE_RUNNER", "2026-09-30T01:00:00.000Z", "test", null, "test");
  const low = buildResearchIntent("RESUME_RUNNER", "2026-09-30T02:00:00.000Z", "test", null, "test");
  let rows = [{ id: high.intentId, position: "2", record: high }];
  repos.adminConfig.read = async () => { configReads++; return null; };
  repos.researchState.readNarrowed = async () => { stateReads++; return null; };
  repos.researchIntents.read = async () => { throw new Error("whole log should never be transferred"); };
  const reader = runnerControlReader("unused", repos, {
    now: () => now,
    query: async (_sql, params) => {
      calls++;
      if (fail) throw new Error("unreachable");
      return [{ research: rows.filter(row => !(params[4] as string[]).includes(row.id)), windows: [], config: revision, state: "same relevant fields" }];
    },
  });
  const first = await reader.read();
  assert.deepEqual(first.research, [high]);
  const [same, concurrent] = await Promise.all([reader.read(), reader.read()]);
  assert.strictEqual(same.research, first.research);
  assert.strictEqual(concurrent.research, first.research);
  assert.equal(calls, 1);
  now = 60_000;
  rows = [...rows, { id: low.intentId, position: "1", record: low }];
  const late = await reader.read();
  assert.deepEqual(late.research, [low, high]);
  assert.equal(configReads, 1);
  assert.equal(stateReads, 1);
  revision = "2";
  await reader.read(true);
  assert.equal(configReads, 2);
  assert.equal(stateReads, 1, "heartbeat-only revisions do not transfer assignments again");
  now += 60_000;
  fail = true;
  await assert.rejects(reader.read(), /unreachable/);
  fail = false;
  const recovered = await reader.read();
  assert.strictEqual(recovered.research, late.research);
  assert.equal(calls, 5, "failed reads are retried without waiting for the cache period");
});
