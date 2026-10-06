import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MEETING_LANE_QUIET_MS, meetingLanesOn, meetingReadQuietMs } from "../lib/civic-data/meeting-lanes.ts";
import { ROUTINE_CHILD_TIMEOUT_MS, runBoundedChildPass, type BoundedChildCommand } from "../lib/civic-data/bounded-child-pass.ts";

const env = (value: Record<string, string>) => value as unknown as NodeJS.ProcessEnv;

test("DB-58: the meeting lanes are off by default and on only when asked", () => {
  assert.equal(meetingLanesOn(env({})), false);
  assert.equal(meetingReadQuietMs(env({})), undefined);
  assert.equal(meetingLanesOn(env({ WTP_MEETING_LANES: "off" })), false);
  assert.equal(meetingReadQuietMs(env({ WTP_MEETING_LANES: "on" })), MEETING_LANE_QUIET_MS);
});

test("DB-58: a quiet host pauses sooner than the pass's own ceiling", () => {
  assert.ok(MEETING_LANE_QUIET_MS < ROUTINE_CHILD_TIMEOUT_MS);
});

test("DB-58: a host's child carries its own ceiling while the others keep the pass's", async () => {
  const seen = new Map<string, number | undefined>();
  const commands: BoundedChildCommand[] = [
    { id: "slow", failureDomain: "host-a", executable: "x", args: [], timeoutMs: MEETING_LANE_QUIET_MS },
    { id: "fast", failureDomain: "host-b", executable: "x", args: [] },
  ];
  await runBoundedChildPass(commands, { cwd: ".", env: env({}), concurrency: 2 }, async (command, options) => {
    seen.set(command.id, command.timeoutMs ?? options.timeoutMs);
    return { id: command.id, status: 0, signal: null, stdout: "", stderr: "", termination: "EXITED", errorMessage: null };
  });
  assert.equal(seen.get("slow"), MEETING_LANE_QUIET_MS);
  assert.equal(seen.get("fast"), undefined);
});

test("DB-58: the runner applies it to meeting partition reads only, behind the switch", () => {
  const source = readFileSync("scripts/routine-civic-data-runner.mts", "utf8");
  assert.ok(source.includes('pending.kind === "MEETING_PARTITION" && meetingReadQuietMs() !== undefined'));
});
