import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { MEETING_PARTITION_CONTRACTS } from "../lib/civic-data/meeting-partitions.ts";
import { requestRoutineRefresh, reserveRoutineRefresh, finishRoutineRefresh, routineRefreshSelection } from "../lib/civic-data/owner-refresh.ts";
import { installedRuntimeChildPlan, parseInstalledRuntimePayload } from "../scripts/installed-runtime-dispatch.mts";

const contractId = MEETING_PARTITION_CONTRACTS[0].id;
const NOW = "2026-09-15T20:00:00.000Z";

test("owner refresh accepts one exact registered partition and at most two attempts; no direct source child", () => {
  assert.deepEqual(routineRefreshSelection([`--contract=${contractId}`, "--attempts=2"]), { contractId, maximumAttempts: 2 });
  for (const args of [[], ["--contract=all"], [`--contract=${contractId}`, "--attempts=3"],
    [`--contract=${contractId}`, "--force"], [`--contract=${contractId}`, `--contract=${contractId}`]]) {
    assert.throws(() => routineRefreshSelection(args), /OWNER_REFRESH_/);
  }
  const payload = parseInstalledRuntimePayload(Buffer.from(JSON.stringify({ mode: "routine-refresh", args: [`--contract=${contractId}`] })).toString("base64"));
  assert.throws(() => installedRuntimeChildPlan(payload), /OWNER_REFRESH_HAS_NO_CHILD_COMMAND/);
});

test("standing parent consumes durable bounded refresh requests independently of ordinary source due time", async () => {
  const repos = createMemoryRepositories();
  assert.equal(await reserveRoutineRefresh(repos, NOW), null);
  const request = await requestRoutineRefresh(repos, [`--contract=${contractId}`, "--attempts=2"], NOW);
  await assert.rejects(requestRoutineRefresh(repos, [`--contract=${contractId}`], NOW), /ALREADY_PENDING/);
  const first = await reserveRoutineRefresh(repos, NOW);
  assert.ok(first);
  assert.equal(first.ordinal, 0);
  assert.deepEqual(first.args, ["--force", `--only=${contractId}`]);
  const stored = (await repos.adminConfig.mustRead("current")).value;
  assert.equal(stored.routineRefreshRequests?.[0].attempts[0].finishedAt, null, "reservation is not a success claim");
  await finishRoutineRefresh(repos, first, "2026-09-15T20:01:00.000Z", 0);
  const second = await reserveRoutineRefresh(repos, "2026-09-15T20:02:00.000Z");
  assert.ok(second);
  assert.equal(second.ordinal, 1);
  await finishRoutineRefresh(repos, second, "2026-09-15T20:03:00.000Z", 2);
  assert.equal(await reserveRoutineRefresh(repos, "2026-09-15T20:04:00.000Z"), null);
  const attempts = (await repos.adminConfig.mustRead("current")).value.routineRefreshRequests?.find(row => row.id === request.id)?.attempts;
  assert.deepEqual(attempts?.map(row => row.exitCode), [0, 2], "failure remains a failure and does not create an unbounded retry");
});

test("a crash after reservation cannot restart the same attempt indefinitely", async () => {
  const repos = createMemoryRepositories();
  await requestRoutineRefresh(repos, [`--contract=${contractId}`, "--attempts=1"], NOW);
  assert.ok(await reserveRoutineRefresh(repos, NOW));
  assert.equal(await reserveRoutineRefresh(repos, NOW), null);
  assert.equal((await repos.adminConfig.mustRead("current")).value.routineRefreshRequests?.[0].attempts[0].exitCode, null);
});
