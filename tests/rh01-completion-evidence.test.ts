import assert from "node:assert/strict";
import test from "node:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { COMPLETION_EVIDENCE_BYTES, COMPLETION_LINE_BYTES, readCompletionLogEvidence } from "../scripts/rh01-completion-evidence.mts";
import { measuredCompletion } from "../scripts/rh01-completion.mts";

async function logs(run: (paths: { stdoutFile: string; stderrFile: string }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "rh01-completion-log-"));
  const paths = { stdoutFile: join(root, "stdout.log"), stderrFile: join(root, "stderr.log") };
  try { await Promise.all([writeFile(paths.stdoutFile, ""), writeFile(paths.stderrFile, "")]); await run(paths); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const marker = 'RH01_NATIONAL_RESULT {"zip":"85535","completed":true}\n';
const receipt = 'RCD_RECEIPT={"acquisitionSucceeded":true,"decision":"GOOD","state":"PROMOTED"}\n';
const complete = (evidence: Awaited<ReturnType<typeof readCompletionLogEvidence>>, script = "scripts/promote-registry-runtime.mts") =>
  measuredCompletion({ script, stdout: evidence.stdout, stderr: evidence.stderr, receipt: evidence.receipt, code: 0, timedOut: false });

test("a completed national marker before large irrelevant output remains proved without retaining source records", async () => logs(async paths => {
  await writeFile(paths.stdoutFile, marker + receipt + JSON.stringify({ sourceRecords: "x".repeat(COMPLETION_LINE_BYTES + 65536) }) + "\n");
  const evidence = await readCompletionLogEvidence(paths);
  assert.equal(complete(evidence).complete, true);
  assert.equal(evidence.failures.length, 0);
  assert.ok(evidence.scannedBytes > COMPLETION_LINE_BYTES);
  assert.ok(evidence.retainedBytes < 256);
  assert.doesNotMatch(evidence.stdout, /sourceRecords/);
}));

test("early refusal and hunter failures cannot be evicted by later source floods or repeated successful statuses", async () => logs(async paths => {
  await writeFile(paths.stdoutFile, marker + receipt + "hunter lane: refresh failed; original state retained\n" +
    "hunter lane: armed; model on\n" + "hunter lane: ended after 1 wave(s), 2 task result(s): its life ended; the runner starts a fresh lane\n");
  await writeFile(paths.stderrFile, "RH01_REMOTE_WRITE_BLOCKED:POST\n" + "x".repeat(300000));
  const evidence = await readCompletionLogEvidence(paths);
  assert.equal(complete(evidence).complete, false);
  assert.equal(evidence.refusedOperation, true);
  assert.match(evidence.stdout, /refresh failed/);
  assert.equal(complete({ ...evidence, receipt: null }, "scripts/hunter-lane.mts").complete, false);
}));

test("normal hunter repetition folds to finite status evidence and preserves its latest lifecycle", async () => logs(async paths => {
  const armed = "hunter lane: armed; paid work available\n", task = "hunter lane: task done: task-a; WORKED\n";
  await writeFile(paths.stdoutFile, (armed + task).repeat(20000) +
    "hunter lane: ended after 3 wave(s), 20000 task result(s): its life ended; the runner starts a fresh lane\n");
  const evidence = await readCompletionLogEvidence(paths);
  assert.equal(complete(evidence, "scripts/hunter-lane.mts").complete, true);
  assert.ok(evidence.retainedBytes < 256);
  assert.deepEqual(evidence.failures, []);
  await appendFile(paths.stdoutFile, "hunter lane: task done: failed-task; NOT_RUN\n" + (armed + task).repeat(20000));
  const later = await readCompletionLogEvidence(paths);
  assert.equal(complete(later, "scripts/hunter-lane.mts").complete, false);
  assert.ok(later.retainedBytes < 512);
}));

test("oversized controls and selected evidence fail closed, while source fields inside valid controls are discarded", async () => logs(async paths => {
  await writeFile(paths.stdoutFile, marker + receipt + 'RH01_NATIONAL_RESULT {"completed":true,"sourceRecords":"' + "x".repeat(COMPLETION_LINE_BYTES) + '"}\n');
  const oversized = await readCompletionLogEvidence(paths);
  assert.equal(complete(oversized).complete, false);
  assert.ok(oversized.failures.includes("CONTROL_LINE_LIMIT"));
  await writeFile(paths.stdoutFile, marker + receipt + 'RH01_REPLAY {"complete":true,"taskId":"' + "x".repeat(COMPLETION_EVIDENCE_BYTES) + '"}\n');
  const full = await readCompletionLogEvidence(paths);
  assert.equal(complete(full).complete, false);
  assert.ok(full.failures.includes("SELECTED_EVIDENCE_LIMIT"));
  assert.ok(full.retainedBytes <= COMPLETION_EVIDENCE_BYTES);
  await writeFile(paths.stdoutFile, marker + 'RCD_RECEIPT={"acquisitionSucceeded":true,"decision":"GOOD","sourceRecords":[' + '"x",'.repeat(70000) + '"x"]}\n');
  const compact = await readCompletionLogEvidence(paths);
  assert.equal(complete(compact).complete, true);
  assert.ok(compact.retainedBytes < 256);
}));

test("boundary refusal detection spans read buffers and arbitrarily long same-line details", async () => logs(async paths => {
  await writeFile(paths.stdoutFile, marker + receipt);
  await writeFile(paths.stderrFile, "x".repeat(65530) + "RuntimeAuthorityRefused\nRH01_REMOTE_" + "detail".repeat(900000) + "_BLOCKED\n");
  const evidence = await readCompletionLogEvidence(paths);
  assert.equal(evidence.refusedOperation, true);
  assert.equal(complete(evidence).complete, false);
}));

test("native audit and supervisor evidence preserves statuses and monotone failure observations", async () => logs(async paths => {
  for (const [script, success, failure] of [
    ["loss-study-pass.mts", "loss study: 2 lessons from 5 losses", "not read: one source"],
    ["claim-audit-pass.mts", "claim audit: 2 claims checked; 2 confirmed, 0 wrong, 0 could not be checked", "lessons not saved: refused"],
    ["live-audit-pass.mts", "live audit: 2 sampled in 1 areas;", "lessons not kept: refused"],
    ["publish-owner-snapshot.mts", "owner-snapshot · published: snapshot;", "incomplete control-plane inputs"],
  ]) {
    await writeFile(paths.stdoutFile, success + "\n" + "source-json".repeat(40000) + "\n");
    assert.equal(complete(await readCompletionLogEvidence(paths), script).complete, true, script);
    await appendFile(paths.stdoutFile, failure + "\n" + success.repeat(10000));
    assert.equal(complete(await readCompletionLogEvidence(paths), script).complete, false, script);
  }
  await writeFile(paths.stdoutFile, 'RCD_OPERATIONAL_OUTCOME={"state":"SUCCEEDED","durable":true}\nRCD_RUN={"denominator":5,"attempted":5,"failed":0,"skipped":0}\n' + "source-json".repeat(40000));
  assert.equal(complete(await readCompletionLogEvidence(paths), "scripts/routine-civic-data-runner.mts").complete, true);
  await rm(paths.stderrFile);
  const missing = await readCompletionLogEvidence(paths);
  assert.equal(complete(missing, "scripts/routine-civic-data-runner.mts").complete, false);
  assert.ok(missing.failures.includes("UNREADABLE_STDERR_LOG"));
}));
