import assert from "node:assert/strict";
import test from "node:test";

import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact, readForParser } from "../lib/control-plane/evidence/store.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "../lib/control-plane/repository/memory.ts";
import { readFieldManual } from "../lib/control-plane/field-manual.ts";
import { researchSpendInWindow } from "../lib/control-plane/scheduler/research-policy.ts";
import { MODEL_FOR_CLASS } from "../lib/control-plane/scheduler/model-routing.ts";
import type { ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { modelParseReasoner } from "../lib/control-plane/workers/model-parser.ts";
import { dispatchWorkerTask, enqueueWorkerTask, FLEET_POLICY_VERSION, type FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import type { GeneralizedCivicExtractionContract } from "../lib/control-plane/workers/types.ts";

const START = "2026-09-29T04:00:00.000Z";
const PROJECT = "model-parser-runtime";
const URL = "https://www.exampletonaz.gov/agendas/pc.txt";
const TEXT = [
  "[Page 1]",
  "CITY OF EXAMPLETON — PLANNING COMMISSION",
  "Regular Meeting: Tuesday, October 14, 2026 at 6:00 PM",
  "Special Meeting: Thursday, October 23, 2026 at 5:30 PM",
].join("\n");

test("a record type with no parsing rule runs through the real fleet: Haiku quotes, code confirms, the ledger shows the spend, the Validator passes it", async () => {
  const repos = createMemoryRepositories();
  const store = new MemoryEvidenceStore();
  let clock = Date.parse(START);
  const now = () => new Date(clock += 1_000).toISOString();
  const subject = "az:city:exampleton";
  const item = createWorkItem({ project: PROJECT, subject, obligation: "Parse the planning commission agenda", why: "A resident sees when the commission meets.",
    contract: { requiresValidation: true, requiresAudit: false }, now: START });
  await registerWorkItem(repos, item, START);

  const at = now();
  const acquisition = createRouteTask({ workItemId: item.id, routeId: "route-agenda", routeLabel: "agenda", target: URL, inherited: false, now: at });
  await registerRouteTask(repos, acquisition, at);
  const holder = "acquirer-1";
  const claim = await claimRouteTask(repos, { routeTaskId: acquisition.id, holder, now: at, ttlMs: 60_000 });
  const attempt = await beginAttemptFor(repos, { routeTaskId: acquisition.id, workItemId: item.id,
    worker: { role: "ACQUIRER", provider: "fixture", version: "1", instance: holder }, lease: claim.lease.value, now: at, methodVersion: 61, policyVersion: FLEET_POLICY_VERSION });
  const { artifact } = recordAcquisition({ canonicalUrl: URL, retrievedAt: at, httpStatus: 200, contentType: "text/plain", sourceId: "exampleton",
    methodRouteId: "route-agenda", workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, TEXT);
  await putArtifact(store, PROJECT, artifact, Buffer.from(TEXT));
  await recordArtifactMetadata(repos, { artifactId: artifact.id, workItemId: item.id, routeTaskId: acquisition.id, attemptId: attempt.id, tier: artifact.tier,
    contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: at }, at);
  await disposeRouteTask(repos, { routeTaskId: acquisition.id, attemptId: attempt.id, expectedTaskRevision: (await repos.routeTasks.mustRead(acquisition.id)).revision,
    artifactIds: [artifact.id], now: at, disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
      permission: "ALLOWED", transport: "REACHABLE", note: "fixture" } });

  const contract: GeneralizedCivicExtractionContract = {
    schemaVersion: 2, recordClass: "PLANNING_MEETING", subjectId: subject, requiredFields: ["title", "when"],
    identity: { namespace: `${subject}:planning`, keyFields: ["when"] }, jurisdiction: { country: "US", state: "AZ", canonicalId: subject },
    completenessScope: "Meetings listed in this agenda.", expectedSourceDate: null, methodVersion: 61,
    sourceScope: { sourceId: "exampleton", publisher: "City of Exampleton", routeIds: ["route-agenda"], canonicalUrls: [URL], observationArtifactIds: [artifact.id] },
    extraction: { format: "UNSUPPORTED", mediaType: "text/plain", fields: {}, reason: "No parsing rule exists for this record type." },
    verification: { required: false, authorities: [] },
  };

  const calls: string[] = [];
  const transport: ModelTransport = async (request) => {
    calls.push(request.model);
    const f = (name: string, value: string) => ({ name, value, quote: value });
    return { model: request.model, stop_reason: "tool_use", usage: { input_tokens: 900, output_tokens: 200 },
      content: [{ type: "tool_use", id: "t", name: "record_extraction", input: { records: [
        { fields: [f("title", "Regular Meeting"), f("when", "Tuesday, October 14, 2026 at 6:00 PM")] },
        { fields: [f("title", "Special Meeting"), f("when", "Thursday, October 23, 2026 at 5:30 PM")] },
      ] } }] };
  };
  const readEvidence: FleetRuntime["readEvidence"] = async () => (await readForParser(store, PROJECT, artifact as Artifact)).input;
  const runtime: FleetRuntime = { repos, methodVersion: 61, now, readEvidence, parseReasoner: modelParseReasoner(repos, transport, now),
    independentContext: async () => { throw new Error("not used"); } };

  const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: "PARSER", artifactId: artifact.id, contract, now: now() });
  const dispatch = await dispatchWorkerTask(runtime, task);
  assert.equal(dispatch.outcome, "WORKED", dispatch.detail);
  const [parser] = (await repos.workerResults.readAll()).filter((r) => r.attemptId === dispatch.attemptId);
  assert.equal(parser.result.role, "PARSER");
  assert.equal(parser.result.verdict, "EXTRACTED");
  assert.equal(parser.result.actualRowCount, 2);
  assert.equal(parser.executionMode, "MODEL_ASSISTED");
  assert.deepEqual(calls, [MODEL_FOR_CLASS.haiku], "one call, on the cheapest tier");
  assert.equal(parser.modelParse?.confirmed, 2);
  assert.equal(parser.modelParse?.tier, "haiku");
  assert.ok(parser.grant.capabilities.includes("NETWORK_PUBLIC_READ"), "the parser holds the network capability only when it reaches the model");
  assert.equal(parser.cost.requestCount, 1);
  assert.ok(parser.cost.usd !== null && parser.cost.usd > 0);

  // The spend is on the ledger the rolling ceiling reads.
  const spend = researchSpendInWindow(await repos.costs.readAll(), now());
  assert.ok(spend.windowUsd !== null && spend.windowUsd > 0, "parser model spend counts toward the ceiling");

  // The Validator replays the quotes against the immutable artifact with no rule for this record type.
  const vtask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "VALIDATOR", artifactId: artifact.id, contract, producerResultId: parser.id, now: now() });
  const vdispatch = await dispatchWorkerTask(runtime, vtask);
  assert.equal(vdispatch.outcome, "WORKED", vdispatch.detail);
  const validator = (await repos.workerResults.readAll()).find((r) => r.attemptId === vdispatch.attemptId)!;
  assert.equal(validator.result.verdict, "PASS", JSON.stringify(validator.result));

  // And the manual now says what worked here.
  const manual = await readFieldManual(repos, { role: "PARSER", state: "az", recordClass: "PLANNING_MEETING" });
  assert.ok(manual.projection.lines.some((l) => /PARSE_OUTCOME YIELDED/.test(l)));
});
