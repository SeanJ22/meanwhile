import assert from "node:assert/strict";
import test from "node:test";
import { autonomousHarness } from "./helpers/autonomous-fleet.ts";
import { nextAutonomousOperation } from "../lib/control-plane/workers/coordinator.ts";
import { dispatchWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { projectFleetPipeline } from "../lib/control-plane/workers/pipeline.ts";
import { scoutedFromScoutResult } from "../lib/control-plane/promotion/pipeline.ts";
import { readPipelineStates } from "./helpers/pipeline.ts";
import { workItemTrace } from "../lib/control-plane/workers/live-audit-run.ts";
import { readSourceReliability, reduceSourceReliability } from "../lib/control-plane/scheduler/scout-reliability.ts";
import type { ControlPlaneRepositories } from "../lib/control-plane/repository/types.ts";
import type { ScoutResult } from "../lib/control-plane/scheduler/scout-result.ts";
import type { WorkerResultRecord } from "../lib/control-plane/workers/types.ts";

const fail = async (): Promise<never> => { throw new Error("country history was materialized"); };
function bounded(repos: ControlPlaneRepositories): ControlPlaneRepositories {
  const scan = <T>(log: import("../lib/control-plane/repository/types.ts").AppendOnlyRepository<T>) => ({...log,
    readChangedSince: (...args: Parameters<typeof log.readChangedSince>) => {
      if (!args[2]?.keys) assert.ok(args[2]?.projection, "country history transfers only a selection projection");
      return log.readChangedSince(...args);
    },
  });
  return {...repos,
    workItems: {...repos.workItems, list: fail, listNarrowed: fail},
    attempts: {...repos.attempts, list: fail},
    artifacts: {...repos.artifacts, readAll: fail},
    scoutResults: {...scan(repos.scoutResults), readAll: fail},
    workerResults: {...scan(repos.workerResults), readAll: fail, readAllNarrowed: fail},
    promotionPipeline: {...scan(repos.promotionPipeline), readAll: fail, keys: fail},
  };
}
async function completed(roles: number) {
  const h = await autonomousHarness();
  for (let index = 0; index < roles; index++) {
    const next = await nextAutonomousOperation(h.runtime, h.item.id);
    assert.ok(next.task, next.reason);
    const outcome = await dispatchWorkerTask(h.runtime, next.task);
    assert.equal(outcome.outcome, "WORKED", outcome.detail);
  }
  return {...h, results: await h.repos.workerResults.read(h.item.id)};
}

test("fleet pipeline streams history and keeps the first item for a shared artifact", async () => {
  const h = await completed(3);
  const validator = h.results.find(row => row.result.role === "VALIDATOR")!;
  const artifactId = validator.inputArtifactIds[0];
  const scouts = ["first-scout", "second-scout"].map(attemptId => ({
    attemptId, recordedAt: h.now(), refusal: null, outcome: "EVIDENCE_FOUND", subjectId: h.item.subject,
    obligationId: "roster", recordClass: "OFFICIAL_ROSTER", candidates: [], findings: [{kind: "RECORD", summary: "Clerk roster", artifactIds: [artifactId]}],
  } as unknown as ScoutResult));
  for (const scout of scouts) await h.repos.scoutResults.append(scout.attemptId, scout.attemptId, scout, scout.recordedAt);
  await h.repos.promotionPipeline.append("foreign", "foreign", {itemId: "foreign"} as never, h.now());
  const repos = bounded(h.repos);
  await projectFleetPipeline(repos);
  const states = await readPipelineStates(h.repos);
  const itemIds = scouts.map(scout => scoutedFromScoutResult(scout)[0].itemId).sort();
  assert.deepEqual(states.map(state => [state.itemId, state.stage]), [[itemIds[0], "VERIFIED"], [itemIds[1], "SCOUTED"]]);
  assert.equal(states[0].byStage.VERIFIED?.workerResultId, validator.id);
  const before = await h.repos.promotionPipeline.readAll();
  await projectFleetPipeline(repos);
  assert.deepEqual(await h.repos.promotionPipeline.readAll(), before, "unchanged history remains idempotent");
});

test("audit trace streams publication bindings, reads only the exact committed parser and does not retain an old cycle snapshot", async () => {
  const h = await completed(2);
  const parser = h.results.find(row => row.result.role === "PARSER")!;
  const trace = workItemTrace(bounded(h.repos), () => "clerk.example.gov");
  assert.equal(await trace.originOf("officials:member-1"), null);
  const current = await h.repos.workItems.mustRead(h.item.id);
  await h.repos.workItems.compareAndSet(h.item.id, current.revision, {...current.value, publicationOutcome: {
    at: h.now(), workerResultId: parser.id, status: "PUBLISHED", code: "PUBLISHED", detail: "Fixture publication",
    candidateId: "candidate", versionId: "version", recordChanges: [{recordId: "source-1", readerId: "member-1", change: "NEW",
      previousVersionId: null, previousFactsHash: null, factsHash: "hash"}],
  }}, h.now());
  const origin = await trace.originOf("officials:member-1");
  assert.deepEqual(origin, {workItemId: h.item.id, parserResultId: parser.id, parserAttemptId: parser.attemptId,
    extractionRecordIds: ["source-1"], platform: null, recordClass: "OFFICIAL_ROSTER", state: "nh", host: "clerk.example.gov"});
  const invalid = {...parser, completion: {...parser.completion, closedAttempt: {...parser.completion.closedAttempt, endedAt: "2020-01-01T00:00:00Z"}}};
  const uncommitted = {...bounded(h.repos), workerResults: {...h.repos.workerResults, readAll: fail, readWhere: async () => [invalid]}};
  assert.equal(await workItemTrace(uncommitted, () => null).originOf("officials:member-1"), null);
});

test("a source reliability read transfers only its publisher's full results and preserves chronological backoff", async () => {
  const h = await completed(1);
  const acquisition = h.results[0];
  assert.equal(acquisition.result.role, "ACQUIRER");
  if (acquisition.result.role !== "ACQUIRER") throw new Error("wrong role");
  const acquired = acquisition.result;
  const make = (id: string, url: string, endedAt: string, success: boolean): WorkerResultRecord => ({...acquisition, id, endedAt,
    result: {...acquired, source: {...acquired.source, url},
      artifacts: acquired.artifacts.map(artifact => ({...artifact, canonicalUrl: url})), verdict: success ? "ACQUIRED" : "BLOCKED"}});
  const rows = [make("later-failure", "https://webapi.legistar.com/v1/pima/Bodies", "2026-09-30T03:00:00Z", false),
    make("recovery", "https://webapi.legistar.com/v1/pima/Events", "2026-09-30T02:00:00Z", true),
    make("earlier-failure", "https://webapi.legistar.com/v1/pima/Events", "2026-09-30T01:00:00Z", false)];
  for (const [index, row] of rows.entries()) await h.repos.workerResults.append(`source-${index}`, row.id, row, h.now());
  for (let index = 0; index < 200; index++) {
    const row = make(`unrelated-${index}`, `https://town-${index}.gov/calendar`, "2026-09-30T04:00:00Z", false);
    await h.repos.workerResults.append(`town-${index}`, row.id, row, h.now());
  }
  const corrupt = {...rows[0], id: "uncommitted", attemptId: "absent"};
  await h.repos.workerResults.append("uncommitted", corrupt.id, corrupt, h.now());
  let fullReads = 0;
  const narrow = bounded(h.repos);
  const repos: ControlPlaneRepositories = {...narrow, workerResults: {...narrow.workerResults, readWhere: async (key, path, id) => {
    assert.ok(!key.startsWith("town-") && key !== h.item.id, "unrelated evidence never leaves its log");
    fullReads++;
    return h.repos.workerResults.readWhere(key, path, id);
  }}};
  const actual = await readSourceReliability(repos, "https://webapi.legistar.com/v1/pima/Minutes");
  const expected = reduceSourceReliability(rows.map(row => ({url: (row.result as typeof acquisition.result).source.url,
    endedAt: row.endedAt, verdict: row.result.verdict, blockerText: []})));
  assert.deepEqual(actual, expected);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].consecutiveFailures, 1);
  assert.equal(actual[0].retryAt, "2026-09-30T03:15:00.000Z");
  assert.equal(fullReads, 4, "only matching acquisitions, including the rejected uncommitted result, are opened");
});
