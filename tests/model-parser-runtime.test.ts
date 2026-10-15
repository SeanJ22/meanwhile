import assert from "node:assert/strict";
import test from "node:test";

import { recordAcquisition, type Artifact } from "../lib/control-plane/evidence/artifact.ts";
import { MemoryEvidenceStore, putArtifact, readForParser } from "../lib/control-plane/evidence/store.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { createWorkItem } from "../lib/control-plane/work-item.ts";
import {
  beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem,
} from "../lib/control-plane/repository/coordinator.ts";
import { createMemoryRepositories } from "./helpers/playbooks.ts";
import { readFieldManual, newFieldManualEntry, writeFieldManual } from "../lib/control-plane/field-manual.ts";
import { researchSpendInWindow } from "../lib/control-plane/scheduler/research-policy.ts";
import { readSpendWindow } from "../lib/control-plane/spend-window.ts";
import { MODEL_FOR_CLASS } from "../lib/control-plane/scheduler/model-routing.ts";
import type { ModelTransport } from "../lib/control-plane/scheduler/scout-executor.ts";
import { modelParseReasoner } from "../lib/control-plane/workers/model-parser.ts";
import { dispatchWorkerTask, enqueueWorkerTask, evidenceProjection, FLEET_POLICY_VERSION, type FleetRuntime } from "../lib/control-plane/workers/runtime.ts";
import { auditCoverageReport } from "../lib/control-plane/workers/audit-sampling.ts";
import type { GeneralizedCivicExtractionContract, IndependentAuditContext } from "../lib/control-plane/workers/types.ts";

const START = "2026-09-29T04:00:00.000Z";
const PROJECT = "model-parser-runtime";
const URL = "https://www.exampletonaz.gov/agendas/pc.txt";
const TEXT = [
  "[Page 1]",
  "CITY OF EXAMPLETON — PLANNING COMMISSION",
  "Regular Meeting: Tuesday, October 14, 2026 at 6:00 PM",
  "Special Meeting: Thursday, October 23, 2026 at 5:30 PM",
].join("\n");

async function parserHarness(text = TEXT, overrideTransport?: ModelTransport) {
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
    methodRouteId: "route-agenda", workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
  await putArtifact(store, PROJECT, artifact, Buffer.from(text));
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
  const runtime: FleetRuntime = { repos, methodVersion: 61, now, readEvidence, parseReasoner: modelParseReasoner(repos, overrideTransport ?? transport, now, { ceilingUsd: 100 }),
    independentContext: async () => { throw new Error("not used"); } };

  return { repos, runtime, item, artifact, contract, now, calls, store };
}

test("a record type with no parsing rule runs through the real fleet: Haiku quotes, code confirms, the ledger shows the spend, the Validator passes it", async () => {
  const { repos, runtime, item, artifact, contract, now, calls } = await parserHarness();
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
  const spend = researchSpendInWindow(await readSpendWindow(repos, now()), now());
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

test("a reply carrying the provider's dated model id is the same model: Haiku stays the tier that parsed", async () => {
  const f = await parserHarness();
  const field = (name: string, value: string) => ({ name, value, quote: value });
  const dated: ModelTransport = async (request) => ({ model: `${request.model}-20251001`, stop_reason: "tool_use", usage: { input_tokens: 900, output_tokens: 200 },
    content: [{ type: "tool_use", id: "t", name: "record_extraction", input: { records: [{ fields: [field("title", "Regular Meeting"), field("when", "Tuesday, October 14, 2026 at 6:00 PM")] }] } }] });
  const runtime: FleetRuntime = { ...f.runtime, parseReasoner: modelParseReasoner(f.repos, dated, f.now, { ceilingUsd: 100 }) };
  const task = await enqueueWorkerTask(f.repos, { workItemId: f.item.id, role: "PARSER", artifactId: f.artifact.id, contract: f.contract, now: f.now() });
  const dispatch = await dispatchWorkerTask(runtime, task);
  assert.equal(dispatch.outcome, "WORKED", dispatch.detail);
  const parser = (await f.repos.workerResults.readAll()).find((r) => r.attemptId === dispatch.attemptId)!;
  assert.equal(parser.modelParse?.tier, "haiku", "no fall-up to Sonnet because of how the provider spells the id");
  assert.equal(parser.modelParse?.confirmed, 1);
});

test("the Auditor runs after the record can publish, samples the model review, and writes what it found where the next agent reads it", async () => {
  const f = await parserHarness();
  const { repos, item, artifact, contract, now } = f;
  const parserTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "PARSER", artifactId: artifact.id, contract, now: now() });
  await dispatchWorkerTask(f.runtime, parserTask);
  const parser = (await repos.workerResults.readAll()).find((r) => r.result.role === "PARSER")!;
  const validatorTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "VALIDATOR", artifactId: artifact.id, contract, producerResultId: parser.id, now: now() });
  await dispatchWorkerTask(f.runtime, validatorTask);
  const validator = (await repos.workerResults.readAll()).find((r) => r.result.role === "VALIDATOR")!;

  const held = (await readForParser(f.store, PROJECT, artifact as Artifact)).input;
  const context: IndependentAuditContext = {
    subjectId: contract.subjectId, contract, publisherSurfaces: [`https://${new globalThis.URL(URL).host}/`], methodVersion: 61,
    routes: [{ routeId: "route-agenda", canonicalUrl: URL, applicable: true, status: "HELD", artifactIds: [artifact.id], reason: "held" },
      { routeId: "route-minutes", canonicalUrl: "https://www.exampletonaz.gov/minutes", applicable: true, status: "OPEN", artifactIds: [], reason: "not fetched yet" }],
    evidence: [evidenceProjection(held)],
    startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"], scope: "CAPTURED_ARTIFACT",
  };
  let reviews = 0;
  const auditReasoner: NonNullable<FleetRuntime["auditReasoner"]> = { workerProvider: "test-double", workerVersion: "review/1", review: async () => {
    reviews += 1;
    return { review: { step: "adversarial-audit", model: "review/1", effort: "low", contextHash: "c", verdict: "SURVIVED", challenges: [], elapsedMs: 0 }, usd: null,
      usage: { inputTokens: null, outputTokens: null, cacheReadInputTokens: null, cacheCreationInputTokens: null, uncachedInputTokens: null } };
  } };
  let sampled = false;
  const audited: FleetRuntime = { ...f.runtime, independentContext: async () => context, auditReasoner, modelAuditSample: async () => sampled };

  // Not sampled: the deterministic audit still runs on the record, with no model call.
  const first = await dispatchWorkerTask(audited, await enqueueWorkerTask(repos, { workItemId: item.id, role: "ADVERSARIAL_AUDITOR", artifactId: artifact.id, contract,
    producerResultId: parser.id, validatorResultId: validator.id, auditScope: "CAPTURED_ARTIFACT", now: now() }));
  assert.equal(first.outcome, "WORKED", first.detail);
  const unsampled = (await repos.workerResults.readAll()).find((r) => r.attemptId === first.attemptId)!;
  assert.equal(unsampled.executionMode, "DETERMINISTIC");
  assert.equal(unsampled.modelReview, undefined);
  assert.equal(reviews, 0);
  assert.equal(unsampled.result.verdict, "SURVIVED", JSON.stringify(unsampled.result));
  if (unsampled.result.role !== "ADVERSARIAL_AUDITOR") throw new Error("role");
  assert.equal(unsampled.result.survivingRecordCount, 2);
  assert.deepEqual([unsampled.result.coverage?.routesApplicable, unsampled.result.coverage?.routesChecked, unsampled.result.coverage?.sourcesPercent], [2, 1, 50], "the unchecked minutes route is a number, not a hold");

  // Sampled: the model reviews it, on the reasoner the runtime was given.
  sampled = true;
  const second = await dispatchWorkerTask(audited, await enqueueWorkerTask(repos, { workItemId: item.id, role: "ADVERSARIAL_AUDITOR", artifactId: artifact.id, contract,
    producerResultId: parser.id, validatorResultId: validator.id, auditScope: "CAPTURED_ARTIFACT", replayLabel: "sampled", now: now() }));
  assert.equal(second.outcome, "WORKED", second.detail);
  const reviewed = (await repos.workerResults.readAll()).find((r) => r.attemptId === second.attemptId)!;
  assert.equal(reviewed.executionMode, "MODEL_ASSISTED");
  assert.equal(reviews, 1);

  // The coverage number: both audited, one model-reviewed.
  const report = auditCoverageReport(await repos.workerResults.readAll());
  assert.equal(report.validated, 1);
  assert.equal(report.audited, 1);
  assert.equal(report.modelReviewed, 1);
  assert.equal(report.sourcesCheckedPercent, 50);

  // And what the audit found is in the manual.
  const manual = await readFieldManual(repos, { role: "AUDITOR", state: "az", recordClass: "PLANNING_MEETING" });
  assert.ok(manual.projection.lines.some((l) => l.includes("AUDITOR/AUDIT_STRATUM YIELDED") && l.includes("50% of applicable official sources checked")), manual.projection.lines.join("\n"));
});

test("partial provider failure commits answered Parser window costs by tier on the aborted Attempt", async () => {
  let calls = 0;
  const h = await parserHarness(TEXT + "\n" + "x".repeat(25_000), async request => {
    calls++;
    if (calls === 1) throw new Error("HTTP 503");
    await new Promise(resolve => setTimeout(resolve, 10));
    return { model: request.model, stop_reason: "tool_use", usage: { input_tokens: 400, output_tokens: 120 },
      content: [{ type: "tool_use", id: "t", name: "record_extraction", input: { records: [] } }] };
  });
  const task = await enqueueWorkerTask(h.repos, { workItemId: h.item.id, role: "PARSER", artifactId: h.artifact.id, contract: h.contract, now: h.now() });
  const result = await dispatchWorkerTask(h.runtime, task);
  assert.equal(result.outcome, "FAILED");
  const costs = (await h.repos.costs.readAll()).filter(row => row.attemptId === result.attemptId);
  assert.equal(costs.length, 1);
  assert.equal(costs[0].cost.requestCount, 2);
  assert.equal(costs[0].cost.usd, null);
  assert.equal(costs[0].byModel?.length, 2);
  assert.ok(costs[0].byModel?.some(share => share.tier === "haiku" && share.usd !== null && share.usd > 0));
  assert.ok(costs[0].byModel?.some(share => share.usd === null));
  assert.equal((await h.repos.workerResults.readAll()).length, 0, "failed extraction publishes no record");
  assert.equal(calls, 2);
});

test('the next parser request uses an edited Bank playbook inside its cached system block', async () => {
  let sawEdited = false;
  const transport: ModelTransport = async request => {
    const system = request.system[0]!;
    assert.match(system.text, /Read the saved heading before listing records/);
    assert.match(system.text, /Never bypass/);
    assert.ok(system.cache_control);
    sawEdited = true;
    return { model: request.model, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: 'tool_use', id: 'edited', name: 'record_extraction', input: { records: [{ fields: [
        { name: 'title', value: 'Regular Meeting', quote: 'Regular Meeting' },
        { name: 'when', value: 'Tuesday, October 14, 2026 at 6:00 PM', quote: 'Tuesday, October 14, 2026 at 6:00 PM' },
      ] }] } }] };
  };
  const { repos, runtime, item, artifact, contract, now } = await parserHarness(TEXT, transport);
  await writeFieldManual(repos, [newFieldManualEntry('role-playbook', 'PARSER', {
    role: 'PARSER', kind: 'PLAYBOOK', title: 'parser', summary: 'current instructions', outcome: 'REFERENCE', portable: true,
    payload: { text: 'Read the saved heading before listing records.' },
  })], now());
  const task = await enqueueWorkerTask(repos, { workItemId: item.id, role: 'PARSER', artifactId: artifact.id, contract, now: now() });
  const dispatched = await dispatchWorkerTask(runtime, task);
  assert.equal(dispatched.outcome, 'WORKED', dispatched.detail);
  assert.ok(sawEdited);
});
