import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { registerRouteTask } from "../lib/control-plane/repository/coordinator.ts";
import { createRouteTask } from "../lib/control-plane/route-task.ts";
import { ZERO_COST } from "../lib/control-plane/attempt.ts";
import { defaultGrant, requireCapability } from "../lib/control-plane/capability.ts";
import { recordAcquisition } from "../lib/control-plane/evidence/artifact.ts";
import { DurableEvidenceStore } from "../lib/control-plane/evidence/durable-store.ts";
import { dispatchOne, proofChargeOf, type DeclaredExecutor } from "../lib/control-plane/scheduler/dispatch.ts";
import { hostSpacer } from "../lib/control-plane/scheduler/http-executor.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { autonomousStandingRuntime } from "../lib/control-plane/workers/standing-runtime.ts";
import { dispatchWorkerTask, enqueueWorkerTask, FLEET_POLICY_VERSION } from "../lib/control-plane/workers/runtime.ts";
import { durableResearchTools } from "../lib/control-plane/workers/research-runtime.ts";
import { boundedAuditTransport } from "../lib/control-plane/workers/model-audit.ts";
import type { EngineeringTaskSpec } from "../lib/control-plane/workers/engineering-types.ts";
import { today } from "./doc-dates.mjs";
import { writeAutonomousFleetProof } from "./autonomous-fleet-proof-output.ts";

const root = resolve(import.meta.dirname, "..");
const vaultRoot = process.argv.find(a => a.startsWith("--vault-root="))?.slice(13);
const itemId = process.argv.find(a => a.startsWith("--item="))?.slice(7);
const artifactId = process.argv.find(a => a.startsWith("--artifact="))?.slice(11);
if (!vaultRoot || !itemId || !artifactId) throw new Error("FLEET_ADVANCE_EXACT_INPUTS_REQUIRED");
const url = controlPlaneUrlFromEnv(); if (!url) throw new Error("FLEET_ADVANCE_NOT_CONFIGURED");
const repos = await createPgRepositories(url);
const now = () => new Date().toISOString();
let item = (await repos.workItems.mustRead(itemId)).value;
let contract = item.autonomousPlan?.contract;
if (!contract) throw new Error("FLEET_ADVANCE_PLAN_MISSING");
const key = process.env[WORKER_CREDENTIAL_VAR];
const runtime = await autonomousStandingRuntime({ root, repos, vaultRoot: resolve(vaultRoot), now, ...(key ? { transport: boundedAuditTransport(key) } : {}) });
const primary = await runtime.readEvidence(artifactId);
if (contract.schemaVersion === 2 && !contract.sourceScope.routeIds.includes(primary.methodRouteId)) {
  // Correct the planned source binding from the actually held artifact's machine provenance.
  // Prior failed WorkerResults retain their original contracts and outcomes unchanged.
  contract = { ...contract, sourceScope: { ...contract.sourceScope, routeIds: [...contract.sourceScope.routeIds, primary.methodRouteId] } };
  const current = await repos.workItems.mustRead(item.id);
  item = (await repos.workItems.compareAndSet(item.id, current.revision, { ...current.value, autonomousPlan: { ...current.value.autonomousPlan!, contract } }, now())).value;
}
const dispatches = [];
const parserTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "PARSER", artifactId, contract, now: now() });
if (["PENDING", "RECLAIMABLE"].includes(parserTask.state)) dispatches.push(await dispatchWorkerTask(runtime, parserTask));
let records = await repos.workerResults.read(item.id);
const parser = records.findLast(r => r.routeTaskId === parserTask.id && r.result.role === "PARSER" && r.result.verdict === "EXTRACTED");
if (parser) {
  const validatorTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "VALIDATOR", artifactId, contract, producerResultId: parser.id, now: now() });
  if (["PENDING", "RECLAIMABLE"].includes(validatorTask.state)) dispatches.push(await dispatchWorkerTask(runtime, validatorTask));
  records = await repos.workerResults.read(item.id);
  const validation = records.findLast(r => r.routeTaskId === validatorTask.id && r.result.role === "VALIDATOR" &&
    (r.result.verdict === "PASS" || (r.result.verdict === "INCONCLUSIVE" && r.result.extractionVerdict === "PASS")));
  if (validation) {
    const auditorTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ADVERSARIAL_AUDITOR", artifactId, contract,
      producerResultId: parser.id, validatorResultId: validation.id, auditScope: "CAPTURED_ARTIFACT", now: now() });
    if (["PENDING", "RECLAIMABLE"].includes(auditorTask.state)) dispatches.push(await dispatchWorkerTask(runtime, auditorTask));
    if (process.argv.includes("--engineering") && validation.result.role === "VALIDATOR") {
      const methodText = readFileSync(join(root, "data/method/knowledge.json"), "utf8");
      const methodVersion = JSON.parse(methodText).version;
      const route = createRouteTask({ workItemId: item.id, routeId: `INTERNAL_METHOD_SNAPSHOT:${methodVersion}`, routeLabel: "Vault exact current method input for review-only Engineering replay",
        target: "repository://data/method/knowledge.json", inherited: false, now: now() });
      const methodTask = (await repos.routeTasks.read(route.id))?.value ?? (await registerRouteTask(repos, route, now())).value;
      const tools = { repos, store: new DurableEvidenceStore(resolve(vaultRoot)), spaceOut: hostSpacer(), now };
      if (["PENDING", "RECLAIMABLE"].includes(methodTask.state)) {
        const executor: DeclaredExecutor = { lane: "DETERMINISTIC", workerFor: ({ holder }) => ({ role: "ACQUIRER", provider: "we-the-people", version: "internal-method-snapshot/1", instance: holder }),
          run: async ctx => {
            const row = await repos.attempts.mustRead(ctx.attemptId);
            const grant = { ...defaultGrant({ role: "ACQUIRER", project: item.project, policyVersion: FLEET_POLICY_VERSION, grantedAt: row.value.startedAt }), capabilities: ["VAULT_WRITE" as const] };
            await repos.attempts.compareAndSet(row.id, row.revision, { ...row.value, capabilityGrant: grant }, now());
            requireCapability(grant, "VAULT_WRITE");
            const artifact = recordAcquisition({ canonicalUrl: "repository://data/method/knowledge.json", retrievalUrl: "repository://data/method/knowledge.json", retrievedAt: now(),
              httpStatus: 200, contentType: "application/json", sourceId: "project-method-knowledge", methodRouteId: "INTERNAL_METHOD_SNAPSHOT", workItemId: item.id,
              attemptId: ctx.attemptId, permission: "NOT_APPLICABLE", transport: "REACHABLE" }, methodText).artifact;
            await durableResearchTools(tools, { project: item.project, ...ctx }).vault(artifact, methodText);
            return { kind: "DISPOSED", ranAs: "DETERMINISTIC", artifacts: [{ artifactId: artifact.id, tier: artifact.tier, contentHash: artifact.contentHash,
              byteLength: artifact.byteLength, contentType: artifact.contentType, canonicalUrl: artifact.canonicalUrl, partial: false, recordedAt: artifact.retrievedAt }],
              disposition: { disposition: "INGESTED", observation: null, permission: "NOT_APPLICABLE", transport: "REACHABLE", note: "Internal method procedure snapshot, never external civic authority." },
              cost: ZERO_COST, detail: "Exact internal method knowledge vaulted as Engineering input; no source network." };
          } };
        dispatches.push(await dispatchOne(repos, { obligation: { obligation: { id: methodTask.id, recordClass: "INTERNAL_METHOD_KNOWLEDGE", subjectId: item.subject,
          routeId: methodTask.routeId, active: true, readerImpactAt: null, observedChangeRateHours: null, lastWorkedAt: null }, nextDueAt: methodTask.createdAt,
          cadenceHours: 24, cadenceSource: "DEFAULT_NO_SIGNAL", basis: "Engineering requires actual versioned method bytes." }, routeTaskId: methodTask.id,
          holder: `method-proof:${process.pid}`, now: now(), leaseTtlMs: 300_000, maturity: () => "GRADUATED", executor, methodVersion, policyVersion: FLEET_POLICY_VERSION, ...proofChargeOf(item.project) }));
      }
      const method = (await repos.artifacts.readAll()).find(a => a.workItemId === item.id && a.routeTaskId === methodTask.id);
      if (!method) throw new Error("FLEET_METHOD_SNAPSHOT_MISSING");
      const engineering: EngineeringTaskSpec = { schemaVersion: 1, methodRouteId: "streamline-sitemap-is-a-dated-meeting-inventory", methodVersion,
        methodArtifactId: method.artifactId, validation: { resultId: validation.id, attemptId: validation.attemptId, verdict: validation.result.verdict as "PASS" | "INCONCLUSIVE", validatedAspect: "SOURCE_EXTRACTION" },
        supportingArtifactIds: [artifactId], existingInterface: { id: "streamline-sitemap-inventory", version: 1 },
        expectedBehavior: ["Inventory dated same-publisher page routes with exact source spans; require page verification."], proof: { timeoutMs: 2000,
          cases: [{ artifactId, subjectId: item.subject, publisherOrigin: "https://www.coronafire.org", minimumRows: 1,
            expectedEntries: [{ sourceUrl: "https://www.coronafire.org/2026-08-26-board-meeting", dateFromPath: "2026-08-26" },
              { sourceUrl: "https://www.coronafire.org/2026-07-22-board-meeting", dateFromPath: "2026-07-22" }] }] } };
      const engineeringTask = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ENGINEERING", artifactId: method.artifactId, contract, engineering, now: now() });
      if (["PENDING", "RECLAIMABLE"].includes(engineeringTask.state)) dispatches.push(await dispatchWorkerTask(runtime, engineeringTask));
      const current = await repos.workItems.mustRead(item.id);
      await repos.workItems.compareAndSet(item.id, current.revision, { ...current.value, autonomousPlan: { ...current.value.autonomousPlan!, engineering: [engineering] } }, now());
    }
  }
}
records = await repos.workerResults.read(item.id);
const proof = { formatVersion: 1, observedAt: now(), itemId: item.id, subject: item.subject, artifactId, dispatches,
  results: records.map(r => ({ id: r.id, attemptId: r.attemptId, role: r.result.role, verdict: r.result.verdict, cost: r.cost,
    recordCount: r.result.role === "PARSER" ? r.result.actualRowCount : null, result: r.result })), promotion: "OFF" };
const dir = join(root, "data/health/autonomous-agent-fleet");
const path = join(dir, `${today()}-${item.id}-pipeline.json`); writeAutonomousFleetProof(root, path, proof);
console.log(JSON.stringify({ proofPath: path, itemId: item.id, results: proof.results.map(({ result: _result, ...summary }) => summary), dispatches }, null, 2));
