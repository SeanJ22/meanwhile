import assert from "node:assert/strict";
import test from "node:test";
import { meetingDiscoveryInputsDue, readMeetingDiscoveryInputs, runMeetingDiscoveryChain } from "../lib/civic-data/meeting-discovery-due.ts";
const now = Date.parse("2026-10-12T12:00:00Z");
test("a new source discovery brings crosswalk, wiring and its own state family forward", async () => {
  const inputs = await readMeetingDiscoveryInputs(async () => [{ state: "TX", found_at: "2026-10-12T11:50:00Z" }]);
  const previous = { lastAttemptedAt: "2026-10-12T10:00:00Z" };
  for (const id of ["meeting-body-crosswalk-derived:TX", "meeting-source-wiring:TX", "meetings:derived:US-TX"]) assert.equal(meetingDiscoveryInputsDue(id, previous, inputs, now), true);
  assert.equal(meetingDiscoveryInputsDue("meetings:derived:US-ID", previous, inputs, now), false);
  assert.equal(meetingDiscoveryInputsDue("fec-funding", previous, inputs, now), false);
  assert.equal(meetingDiscoveryInputsDue("meeting-source-wiring:TX", { lastAttemptedAt: "2026-10-12T11:55:00Z" }, inputs, now), false, "an attempted discovery input keeps normal failure backoff");
  assert.equal(meetingDiscoveryInputsDue("meeting-source-wiring:TX", previous, new Map([["TX", "2026-10-13T00:00:00Z"]]), now), false);
});
test("the routine pass settles body binding and wiring before its family acquires and publishes", async () => {
  const steps: string[] = [];
  const tasks = ["meetings:derived:US-TX", "meeting-source-wiring:TX", "fec-funding", "meeting-body-crosswalk-derived:TX"].map(id => ({ id }));
  const results = await runMeetingDiscoveryChain(tasks, async batch => {
    for (const task of batch) {
      if (task.id === "meeting-source-wiring:TX") assert.ok(steps.includes("meeting-body-crosswalk-derived:TX"));
      if (task.id.startsWith("meetings:derived:")) assert.ok(steps.includes("meeting-source-wiring:TX"));
      steps.push(task.id);
    }
    return batch.map(task => task.id);
  });
  assert.deepEqual(results, ["fec-funding", "meeting-body-crosswalk-derived:TX", "meeting-source-wiring:TX", "meetings:derived:US-TX"]);
});
