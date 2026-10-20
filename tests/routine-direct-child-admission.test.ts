import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("both direct routine child groups acquire and settle the shared native memory reservation", () => {
  const source = readFileSync(new URL("../scripts/routine-civic-data-runner.mts", import.meta.url), "utf8");
  const admissionReady = source.indexOf("const routineMemorySlots = routineProcessSlots();");
  const markers = ["const [published] = await runBoundedChildPass([{", "const [run] = await runBoundedChildPass([{ id: FEDERAL_PEOPLE_SPLIT_LOG_KEY"];
  for (const marker of markers) {
    const start = source.indexOf(marker), end = source.indexOf("});", start);
    assert.ok(start > admissionReady && admissionReady >= 0, "the actual reservation handle is initialized before the direct command");
    const options = source.slice(start, end);
    assert.match(options, /onStarting:\s*acquireChildMemory/);
    assert.match(options, /onSettled:\s*run\s*=>\s*releaseChildMemory\(run\.id\)/);
  }
});
