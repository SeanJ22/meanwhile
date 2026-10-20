import assert from "node:assert/strict";
import test from "node:test";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { buildResearchIntent } from "../lib/control-plane/research-view.ts";
import { readIntents, type ResearchIntent } from "../lib/control-plane/scheduler/research-policy.ts";
import { runnerControlReader, runnerWakeReaderFromEnv } from "../scripts/pilot-runtime-control.mts";
import { consoleInputReader, CONSOLE_INPUT_SQL, CONSOLE_READER_INPUT_SQL } from "../scripts/pilot-runtime-publish.mts";

test("console versions remain on the server and failed metadata reads cannot look unchanged", async () => {
  let control = "control-v1", reader = "reader-v1";
  const queries: string[] = [];
  const read = consoleInputReader("unused", "unused", "sha", {
    controlSql: { query: async sql => { queries.push(sql); return [{ signature: control }]; } },
    readerSql: { query: async sql => { queries.push(sql); return [{ signature: reader }]; } },
  });
  const first = await read();
  control = "control-v2";
  assert.notEqual(await read(), first);
  const second = await read();
  reader = "reader-v2";
  assert.notEqual(await read(), second);
  assert.ok(queries.includes(CONSOLE_INPUT_SQL));
  assert.ok(queries.includes(CONSOLE_READER_INPUT_SQL));
  assert.match(CONSOLE_INPUT_SQL, /count\(\*\), max\(position\)/, "late lower-position commits change the count");
  assert.doesNotMatch(CONSOLE_INPUT_SQL, /cp_owner_snapshots|cp_readiness_snapshots|cp_runner_heartbeat/);
  assert.match(CONSOLE_INPUT_SQL, /\['cycleId','startedAt','finishedAt'\]/);
  const unreadable = consoleInputReader("unused", "unused", "sha", {
    controlSql: { query: async () => [] }, readerSql: { query: async () => [{ signature: "ok" }] },
  });
  await assert.rejects(unreadable(), /CONSOLE_INPUTS_UNREADABLE/);
});

test("committed runner acknowledgments are visible during unchanged hint polls", async () => {
  const repos = createMemoryRepositories();
  let now = 0, calls = 0;
  let etag = "pause";
  let positions = "{}";
  let finishQuery: (() => void) | null = null;
  const rows: { id: string; position: string; record: ResearchIntent }[] = [];
  const contains = (position: string) => [...positions.matchAll(/\[(\d+),(\d+)\)/g)]
    .some(([, start, end]) => BigInt(position) >= BigInt(start) && BigInt(position) < BigInt(end));
  const reader = runnerControlReader("unused", repos, {
    now: () => now,
    readWakeEtag: async () => etag,
    query: async (_sql, params) => {
      calls++;
      positions = params[4] as string;
      const research = rows.filter(row => !contains(row.position));
      if (finishQuery !== null) await new Promise<void>(resolve => { finishQuery = resolve; });
      return [{ research, windows: [], config: "same", state: "same" }];
    },
  });
  for (const [i, action] of (["PAUSE_RUNNER", "RESUME_RUNNER"] as const).entries()) {
    const at = `2026-10-01T01:00:0${i}.000Z`;
    const intent = buildResearchIntent(action, at, "test", null, "test");
    const request = await repos.researchIntents.append("level-1", intent.intentId, intent, at);
    rows.push({ id: request.recordId, position: String(request.position), record: request.record });
    etag = action;
    now += 1_000;
    await reader.read();
    const honored: ResearchIntent = { formatVersion: 1, kind: "HONORED", intentId: `${intent.intentId}:honored`,
      honors: intent.intentId, action, honoredAt: at, honoredBy: "pilot-runner@test#1", detail: "applied" };
    const committed = await repos.researchIntents.append("level-1", honored.intentId, honored, at);
    reader.rememberResearchAppend(committed);
    rows.push({ id: committed.recordId, position: String(committed.position), record: committed.record });
    const before = calls;
    for (let poll = 0; poll < 100; poll++) {
      now += 1_000;
      const controls = await reader.read();
      assert.ok(controls.research.some(row => row.kind === "HONORED" && row.honors === intent.intentId));
      const pause = readIntents(controls.research).runnerPause;
      assert.equal(pause.paused, action === "PAUSE_RUNNER");
      if (pause.paused) assert.equal(pause.honored?.intentId, honored.intentId);
    }
    assert.equal(calls, before, "an acknowledgment needs neither a SQL refresh nor another append");
  }
  await reader.read(true);
  assert.equal(positions, "{[0,4)}", "committed local positions are excluded from the next delta read");
  assert.equal((await repos.researchIntents.read("level-1")).length, 4, "immutable history has one acknowledgment per action");

  const intent = buildResearchIntent("PAUSE_RUNNER", "2026-10-01T01:00:02.000Z", "test", null, "test");
  const request = await repos.researchIntents.append("level-1", intent.intentId, intent, intent.requestedAt);
  rows.push({ id: request.recordId, position: String(request.position), record: request.record });
  finishQuery = () => {};
  const refresh = reader.read(true);
  const honored: ResearchIntent = { formatVersion: 1, kind: "HONORED", intentId: `${intent.intentId}:honored`,
    honors: intent.intentId, action: intent.action, honoredAt: intent.requestedAt, honoredBy: "pilot-runner@test#1", detail: "applied" };
  const committed = await repos.researchIntents.append("level-1", honored.intentId, honored, intent.requestedAt);
  reader.rememberResearchAppend(committed);
  finishQuery!();
  finishQuery = null;
  const refreshed = await refresh;
  assert.equal(readIntents(refreshed.research).runnerPause.honored?.intentId, honored.intentId,
    "a SQL read started before the local commit must not discard its acknowledgment");
  await reader.read(true);
  assert.equal(positions, "{[0,6)}", "both the late lower position and local commit remain known");
});

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
  let lastPositions = "{}";
  const contained = (position: string, ranges: string) => [...ranges.matchAll(/\[(\d+),(\d+)\)/g)]
    .some(([, start, end]) => BigInt(position) >= BigInt(start) && BigInt(position) < BigInt(end));
  repos.adminConfig.read = async () => { throw new Error("whole config should never be transferred"); };
  repos.adminConfig.readNarrowed = async (_id, projection) => {
    assert.equal(projection.fixList, undefined);
    assert.equal(projection.latestBrief, undefined);
    configReads++; return null;
  };
  repos.researchState.readNarrowed = async () => { stateReads++; return null; };
  repos.researchIntents.read = async () => { throw new Error("whole log should never be transferred"); };
  const reader = runnerControlReader("unused", repos, {
    now: () => now,
    query: async (sql, params) => {
      calls++;
      if (fail) throw new Error("unreachable");
      assert.match(sql, /position <@ \$5::int8multirange/);
      assert.match(sql, /position <@ \$6::int8multirange/);
      lastPositions = params[4] as string;
      return [{ research: rows.filter(row => !contained(row.position, lastPositions)), windows: [], config: revision, state: "same relevant fields" }];
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
  assert.equal(lastPositions, "{[1,3)}");

  // History length does not put every old intent ID back on the wire. A gap
  // (including a burned allocation) stays open until its row actually arrives.
  rows = Array.from({ length: 10_000 }, (_, i) => ({ id: `history-${i}`, position: String(i + 4), record: high }));
  await reader.read(true);
  await reader.read(true);
  assert.equal(lastPositions, "{[1,3),[4,10004)}");
  rows.push({ id: "late-gap", position: "3", record: low });
  const filled = await reader.read(true);
  assert.strictEqual(filled.research[2], low, "the late row belongs between positions 2 and 4");
  await reader.read(true);
  assert.equal(lastPositions, "{[1,10004)}", "only committed adjacent positions collapse");
});

test("runner wakes on changed etags without minute-by-minute SQL and survives missed hints", async () => {
  const repos = createMemoryRepositories();
  let now = 0, calls = 0, hints = 0;
  let etag: string | null = null;
  let brokenHint = false, brokenSql = false;
  let revision = "1";
  let finishHint: (() => void) | null = null;
  const reader = runnerControlReader("unused", repos, {
    now: () => now,
    readWakeEtag: async () => {
      hints++;
      if (brokenHint) throw new Error("hint unavailable");
      if (finishHint !== null) await new Promise<void>(resolve => { finishHint = resolve; });
      return etag;
    },
    query: async () => {
      calls++;
      if (brokenSql) throw new Error("SQL unavailable");
      return [{ research: [], windows: [], config: revision, state: "unchanged" }];
    },
  });
  const initial = await reader.read();
  for (now = 1_000; now < 15 * 60_000; now += 1_000) {
    const held = await reader.read();
    assert.strictEqual(held.research, initial.research);
  }
  assert.equal(calls, 1, "899 hint polls do not wake Postgres");
  assert.equal(hints, 900);
  await reader.read();
  assert.equal(calls, 2, "an absent/missed hint is recovered on the slow clock");
  now += 1_000;
  etag = "receipt-a";
  revision = "2";
  await Promise.all([reader.read(), reader.read()]);
  assert.equal(calls, 3, "concurrent wake reads fetch controls only once");
  now += 1_000;
  await reader.read();
  assert.equal(calls, 3, "the same etag does not re-read controls");
  etag = "receipt-b";
  brokenSql = true;
  now += 1_000;
  await assert.rejects(reader.read(), /SQL unavailable/);
  brokenSql = false;
  now += 1_000;
  await reader.read();
  assert.equal(calls, 5, "a failed SQL read does not swallow the new etag");
  brokenHint = true;
  now += 1_000;
  await reader.read();
  assert.equal(calls, 5, "hint failures do not force repeated database wakeups");
  now += 15 * 60_000;
  await reader.read();
  assert.equal(calls, 6, "SQL fallback works even while Blobs is unavailable");
  await reader.read(true);
  assert.equal(calls, 7, "cycle boundaries still force their own controls read");
  brokenHint = false;
  now += 1_000;
  finishHint = () => {};
  const pending = reader.read();
  const forced = reader.read(true);
  finishHint!();
  finishHint = null;
  await Promise.all([pending, forced]);
  assert.equal(calls, 8, "a forced boundary coalesces with an in-flight hint read");
  assert.equal(runnerWakeReaderFromEnv({}), null);
  assert.equal(runnerWakeReaderFromEnv({ WTP_VAULT_PROVIDER: "netlify", WTP_BLOBS_SITE_ID: "site" }), null);
});
