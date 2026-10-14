import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { RUNTIME_NO_PROGRESS_MS, runRuntimeChildren } from "../scripts/pilot-runtime-child.mts";

/*
 * The runner starts the owner-snapshot publisher after every cycle, failed or not, and ends any child that prints no
 * new line for RUNTIME_NO_PROGRESS_MS. Times here are that limit scaled down; the relationship is the production one.
 */
const QUIET_MS = 600;
const STEP_MS = Math.round(QUIET_MS * 0.6);

const publisher = (reportSteps: boolean) => `
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  console.log("owner-snapshot · HEAD fixture");
  for (const step of ["control plane read", "map usage collected", "provider bills collected", "campaign page readback collected"]) {
    await wait(${STEP_MS});
    if (${reportSteps}) console.log("owner-snapshot · " + step);
  }
  console.log("owner-snapshot · published: snapshot");
`;
const run = (reportSteps: boolean) => runRuntimeChildren([{ id: "console-publish:owner snapshot", executable: process.execPath,
  args: ["--input-type=module", "-e", publisher(reportSteps)] }], { cwd: process.cwd(), env: process.env, maxBufferBytes: 1 << 16, noProgressMs: QUIET_MS });

test("a publisher silent for longer than the runner's limit is ended before it writes the snapshot", async () => {
  const [result] = await run(false);
  assert.equal(result!.termination, "TIMED_OUT");
  assert.doesNotMatch(result!.stdout, /published: snapshot/);
});

test("the same publish, printing each finished step, outlasts the limit and writes the snapshot", async () => {
  assert.ok(STEP_MS * 4 > QUIET_MS, "the whole publish is longer than the quiet allowance");
  const [result] = await run(true);
  assert.equal(result!.termination, "EXITED");
  assert.equal(result!.status, 0);
  assert.match(result!.stdout, /published: snapshot/);
});

const COLLECTION_STEPS: readonly (readonly [RegExp, string])[] = [
  [/await readControlPlane\(repos\)/, 'stepDone("control plane read")'],
  [/await collectMapTilerUsage\(/, 'stepDone("map usage collected")'],
  [/await collectProviderBilling\(/, 'stepDone("provider bills collected")'],
  [/await collectPublishedCampaignReadback\(/, 'stepDone("campaign page readback collected")'],
  [/collectPublishedManualReaderReadback\(reads\.assignmentSources/, 'stepDone("worker and help page readbacks collected")'],
  [/readPlaceOwed\(key\)/, "stepDone(`place history read for ${key}`)"],
];

function checkPublisherReportsEachStep(src: string): void {
  assert.ok(Number.isSafeInteger(RUNTIME_NO_PROGRESS_MS) && RUNTIME_NO_PROGRESS_MS > 0);
  let at = src.indexOf("async function main(");
  assert.ok(at > 0, "publish-owner-snapshot.mts has no main()");
  for (const [collector, line] of COLLECTION_STEPS) {
    const found = src.slice(at).search(collector);
    assert.ok(found >= 0, `${collector} is no longer collected in order`);
    const reported = src.indexOf(line, at + found);
    const next = COLLECTION_STEPS.map(([c]) => src.slice(at + found + 1).search(c)).filter((i) => i >= 0).map((i) => i + at + found + 1);
    assert.ok(reported > 0 && next.every((i) => reported < i), `${collector} finishes without printing ${line}`);
    at = reported;
  }
  assert.ok(src.indexOf("repos.ownerSnapshots.compareAndSet(", at) > at, "the snapshot is written after the last reported step");
}

test("the owner snapshot prints a line after every collection step, before the snapshot write", () => {
  checkPublisherReportsEachStep(readFileSync(new URL("../scripts/publish-owner-snapshot.mts", import.meta.url), "utf8"));
});

test("POSITIVE CONTROL: a publisher that goes quiet after the provider bills fails the check", () => {
  const src = readFileSync(new URL("../scripts/publish-owner-snapshot.mts", import.meta.url), "utf8");
  const quiet = src.replace('  stepDone("provider bills collected");\n', "");
  assert.notEqual(quiet, src, "the mutation did not apply; the test would prove nothing");
  assert.throws(() => checkPublisherReportsEachStep(quiet));
});

test("the runner publishes the console after every cycle's digest, including a failed cycle", () => {
  const runner = readFileSync(new URL("../scripts/pilot-runner.mts", import.meta.url), "utf8");
  const failedBeat = runner.indexOf("if (!result.ok) await writeFailedCycleBeat(startedAt);");
  const publish = runner.indexOf("\n  await publishConsole();", failedBeat);
  assert.ok(failedBeat > 0 && publish > failedBeat, "a failed cycle reaches the console publish");
  assert.doesNotMatch(runner.slice(failedBeat, publish), /\bcontinue;|\bbreak;/, "nothing between a failed cycle and the publish skips it");
});
