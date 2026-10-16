import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CAPTURE_CONVERSION_LOG_KEY, captureConversionLine, captureConversionRecord, captureConversionRecorded } from "../lib/civic-data/capture-conversion.ts";
import type { BoundedChildResult } from "../lib/civic-data/bounded-child-pass.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";

const AT = "2026-10-15T03:00:00.000Z";
const run = (status: number | null, stdout = ""): BoundedChildResult =>
  ({ id: CAPTURE_CONVERSION_LOG_KEY, status, signal: status === null ? "SIGKILL" : null, stdout, stderr: "", termination: "EXITED", errorMessage: null }) as unknown as BoundedChildResult;

test("a finished conversion is recorded once with every outcome, and a recorded one is never due again", async () => {
  const { ownerDigests } = createMemoryRepositories();
  assert.equal(await captureConversionRecorded(ownerDigests), false);
  const stdout = [
    "fetching held versions",
    captureConversionLine({ scope: "US-NJ:openstates-people:v1", from: "cv-old", to: "cv-new" }),
    captureConversionLine({ scope: "US-DE:people:official-state-people:v1", from: "cv-held", to: null, refusal: "CANNOT_TELL" }),
  ].join("\n");
  const record = captureConversionRecord(run(0, stdout), AT, "b".repeat(40))!;
  assert.equal(record.lines.length, 2);
  assert.equal(record.cycleOk, false, "a refused scope is listed, and the record still stands");
  assert.match(record.headline, /1 held versions now hold vault references; 1 refused/);
  await ownerDigests.append(CAPTURE_CONVERSION_LOG_KEY, record.digestId, record, AT);
  assert.equal(await captureConversionRecorded(ownerDigests), true);
});

test("a child that did not finish leaves nothing recorded, so the next pass runs it again", () => {
  assert.equal(captureConversionRecord(run(1), AT, null), null);
  assert.equal(captureConversionRecord(run(null), AT, null), null);
});

test("the runner launches the conversion under its own capability, and the script runs under no other", () => {
  const runner = readFileSync("scripts/routine-civic-data-runner.mts", "utf8"), script = readFileSync("scripts/convert-embedded-captures.mts", "utf8");
  assert.match(runner, /capability: "CAPTURE_CONVERSION"[^)]*\}\)/);
  assert.match(script, /assertRuntimeAuthority\(\{ capabilities: \["CAPTURE_CONVERSION"\] \}\)/);
  assert.doesNotMatch(script, /--promote/);
});
