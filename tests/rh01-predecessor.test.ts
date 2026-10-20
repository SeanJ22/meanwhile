import assert from "node:assert/strict";
import test from "node:test";
import { heldReplayParserPredecessor, workloadOffers, type WorkloadJob } from "../scripts/rh01-workload.mts";

test("a concurrently offered validator depends on the actual parser in its exact immutable-source store", () => {
  const job = (id: string, role: string, store: string): WorkloadJob => ({ id, source: "authentic production retained source",
    script: "scripts/rh01-held-worker-replay.mts", command: ["scripts/rh01-held-worker-replay.mts", `--store=${store}`, `--role=${role}`] });
  const validator = job("validator-first", "VALIDATOR", "/private/genuine-held"),
    other = job("another-source-parser", "PARSER", "/private/other-source"),
    acquisition = job("same-source-acquirer", "ACQUIRER", "/private/genuine-held"),
    parser = job("queued-parser", "PARSER", "/private/genuine-held");
  const jobs = [validator, other, acquisition, parser], before = structuredClone(jobs);
  assert.equal(heldReplayParserPredecessor(validator, jobs), parser);
  assert.equal(heldReplayParserPredecessor(validator, jobs.slice(0, 3)), undefined);
  assert.equal(heldReplayParserPredecessor(parser, jobs), undefined);
  assert.equal(heldReplayParserPredecessor(acquisition, jobs), undefined);
  assert.equal(heldReplayParserPredecessor({ ...validator, script: "scripts/some-other-worker.mts" }, jobs), undefined);
  assert.equal(heldReplayParserPredecessor({ ...validator, command: validator.command.filter(argument => !argument.startsWith("--store=")) }, jobs), undefined);
  assert.deepEqual(workloadOffers(jobs).map(row => row.id), jobs.map(row => row.id), "dependency does not remove any initial offer");
  assert.deepEqual(jobs, before, "native commands, roles and authentic input stores are unchanged");
});
