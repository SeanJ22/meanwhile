import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");

test("a wake reconciles the deployed release before admitting another research cycle", () => {
  const loop = source.slice(source.indexOf("while (cycle < CYCLES) {"));
  const held = loop.indexOf("const owner = await holdWhilePaused();");
  const reconciled = loop.indexOf("const wakeReleaseExit = await reconcileRuntimeReleaseAtBoundary();");
  const releaseExit = loop.indexOf("if (wakeReleaseExit !== null) {", reconciled);
  const breakOnRelease = loop.indexOf("break;", releaseExit);
  const incremented = loop.indexOf("cycle += 1;", held);
  const child = loop.indexOf("const result = await runOneCycle(owner)", incremented);
  const slept = loop.indexOf("await sleepUnlessRunNow(await nextCycleWaitMs(result.ok));", child);
  assert.ok(held >= 0 && held < reconciled);
  assert.ok(reconciled < releaseExit && releaseExit < breakOnRelease && breakOnRelease < incremented);
  assert.ok(incremented < child && child < slept);
});
