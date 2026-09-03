import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { createPgRepositories, controlPlaneUrlFromEnv } from "../lib/control-plane/repository/pg-store.ts";
import { assertDurableRepositories } from "../lib/control-plane/repository/types.ts";
import { auditReasoningContext, boundedAuditTransport } from "../lib/control-plane/workers/model-audit.ts";
import { WORKER_CREDENTIAL_VAR } from "../lib/control-plane/scheduler/research-policy.ts";
import { standingFleetRuntime, heldEventContract, runHeldWorkerFleetCycle } from "../lib/control-plane/workers/standing.ts";
import { dispatchWorkerTask, enqueueWorkerTask } from "../lib/control-plane/workers/runtime.ts";
import { projectFleetPipeline } from "../lib/control-plane/workers/pipeline.ts";
import { readPipelineStates } from "../lib/control-plane/promotion/pipeline.ts";
import { readWorkerFleet } from "../lib/control-plane/workers/readback.ts";
import { today } from "./doc-dates.mjs";
import { findSecrets, loadSecrets } from "../lib/ops/secret-redaction.ts";

const started = performance.now();
const root = resolve(import.meta.dirname, "..");
const now = () => new Date().toISOString();
const beganAt = now();
const connection = controlPlaneUrlFromEnv();
if (!connection) throw new Error("WORKER_PROOF_NOT_CONFIGURED: WTP_CONTROL_PLANE_DATABASE_URL");
const repos = await createPgRepositories(connection);
assertDurableRepositories(repos, "worker fleet real proof");
const artifact = (await repos.artifacts.readAll()).find(a => a.artifactId === "ar-076cafa324f9aefa9dd5096f");
if (!artifact) throw new Error("WORKER_PROOF_REAL_HELD_ARTIFACT_MISSING");
const item = (await repos.workItems.mustRead(artifact.workItemId)).value;
const contract = heldEventContract(root, artifact);
if (!contract || item.subject !== contract.subjectId) throw new Error("WORKER_PROOF_CANONICAL_OBLIGATION_MISMATCH");
const vaultArg = process.argv.find(a => a.startsWith("--vault-root="));
const key = process.env[WORKER_CREDENTIAL_VAR];
const runtime = standingFleetRuntime({ root, repos, now,
  ...(vaultArg ? { vaultRoot: resolve(vaultArg.slice("--vault-root=".length)) } : {}),
  ...(key ? { transport: boundedAuditTransport(key) } : {}) });
// Explicitly verify held bytes before dispatch. Nothing in this proof re-fetches the civic source.
await runtime.readEvidence(artifact.artifactId);
if (process.argv.includes("--preflight-only")) {
  const context = await runtime.independentContext({ artifactId: artifact.artifactId, contract, auditScope: "CAPTURED_ARTIFACT", methodVersion: runtime.methodVersion });
  const representation = auditReasoningContext(context);
  const hits = findSecrets("worker-audit-outbound-representation", representation, loadSecrets(join(root, ".env.local")));
  if (hits.length) throw new Error("WORKER_AUDIT_PREFLIGHT_SECRET_REFUSED");
  const artifactIds = new Set([...context.evidence, ...(context.surfaceEvidence ?? [])].map(e => e.artifactId));
  const inventory = (await repos.artifacts.readAll()).filter(a => artifactIds.has(a.artifactId));
  const attestation = { kind: "READ_ONLY_AUDIT_PREFLIGHT", observedAt: now(), artifactId: artifact.artifactId,
    heldFeeds: context.evidence.length, heldSurfaces: context.surfaceEvidence?.length ?? 0, routes: context.routes.length,
    requiredRoutes: context.routes.filter(r => r.applicable).length, contextBytes: Buffer.byteLength(JSON.stringify(context)),
    modelRepresentationBytes: Buffer.byteLength(representation), civicNetworkRequests: 0, modelRequests: 0,
    outboundSecretScan: "CLEAN: existing by-value secret scanner; values never emitted",
    modelDestination: "https://api.anthropic.com/v1/messages (existing configured worker provider)",
    publicEvidenceSources: inventory.map(a => ({ artifactId: a.artifactId, canonicalUrl: a.canonicalUrl, tier: a.tier })),
    payloadScope: "Public City of Avondale event assertions and excerpts from its public meeting pages; canonical subject and method route metadata. No producer/validator reasoning, restricted raw evidence, credentials, or browser/session data." };
  const dir = join(root, "data/health/worker-fleet-proofs");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "audit-preflight.json"), JSON.stringify(attestation, null, 2) + "\n");
  console.log(JSON.stringify(attestation, null, 2));
  process.exit(0);
}
const priorIds = new Set((await repos.attempts.list()).map(a => a.id));
const auditLabel = process.argv.find(a => a.startsWith("--audit-label="))?.slice("--audit-label=".length);
const dispatches = process.argv.includes("--readback-only") || auditLabel ? [] : [...await runHeldWorkerFleetCycle(root, runtime)];
const recordsBeforeReplay = (await repos.workerResults.read(item.id));
const firstParser = recordsBeforeReplay.find(r => r.result.role === "PARSER" && r.result.artifactId === artifact.artifactId && r.result.verdict === "EXTRACTED");
const exactValidator = firstParser && recordsBeforeReplay.findLast(r => r.result.role === "VALIDATOR" && r.result.verdict === "PASS" &&
  r.result.producerAttemptId === firstParser.attemptId && r.inputResultIds.includes(firstParser.id));
if (auditLabel && !process.argv.includes("--readback-only")) {
  if (!firstParser || !exactValidator) throw new Error("WORKER_PROOF_EXACT_VALIDATED_CHAIN_MISSING");
  const audit = await enqueueWorkerTask(repos, { workItemId: item.id, role: "ADVERSARIAL_AUDITOR", artifactId: artifact.artifactId, contract,
    now: now(), producerResultId: firstParser.id, validatorResultId: exactValidator.id, replayLabel: auditLabel });
  if (["PENDING", "RECLAIMABLE"].includes(audit.state)) dispatches.push(await dispatchWorkerTask(runtime, audit));
}
if (firstParser && !process.argv.includes("--readback-only")) {
  const replay = await enqueueWorkerTask(repos, { workItemId: item.id, role: "PARSER", artifactId: artifact.artifactId, contract,
    now: now(), replayLabel: "immutable-semantic-replay-proof", purpose: "DIAGNOSTIC_REPLAY" });
  if (["PENDING", "RECLAIMABLE"].includes(replay.state)) dispatches.push(await dispatchWorkerTask(runtime, replay));
}
if (!process.argv.includes("--readback-only")) await projectFleetPipeline(repos);
const allAttempts = (await repos.attempts.list()).map(a => a.value);
const records = await repos.workerResults.read(item.id);
const workerAttempts = allAttempts.filter(a => a.workItemId === item.id && ["PARSER", "VALIDATOR", "ADVERSARIAL_AUDITOR"].includes(a.worker.role));
const parsers = records.filter(r => r.result.role === "PARSER" && r.result.artifactId === artifact.artifactId && r.result.verdict === "EXTRACTED");
const auditor = records.findLast(r => r.result.role === "ADVERSARIAL_AUDITOR" && r.result.producerAttemptId === firstParser?.attemptId &&
  r.result.validatorAttemptId === exactValidator?.attemptId && r.inputResultIds.includes(firstParser!.id) && r.inputResultIds.includes(exactValidator!.id));
const surviving = auditor?.result.role === "ADVERSARIAL_AUDITOR" ? auditor.result.survivingRecordCount : 0;
const measured = workerAttempts.filter(a => a.cost.usd !== null);
const measuredUsd = measured.reduce((sum, a) => sum + a.cost.usd!, 0);
const pipeline = (await readPipelineStates(repos)).filter(p => p.byStage.SCOUTED?.artifactIds.includes(artifact.artifactId));
const proof = {
  formatVersion: 1, startedAt: beganAt, observedAt: now(), wallMs: Math.round(performance.now() - started),
  headSha: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  treeStatus: execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim() ? "WORKING_TREE" : "COMMITTED_HEAD",
  exactChain: { parserResultId: firstParser?.id ?? null, validatorResultId: exactValidator?.id ?? null, auditorResultId: auditor?.id ?? null },
  source: repos.describe(), obligation: { id: item.id, subject: item.subject, obligation: item.obligation, why: item.why },
  ownerReadback: await readWorkerFleet(repos, now()),
  artifact, acquisition: allAttempts.find(a => a.id === artifact.attemptId) ?? null,
  dispatches, newAttemptIds: workerAttempts.filter(a => !priorIds.has(a.id)).map(a => a.id), attempts: workerAttempts, results: records,
  replay: { runs: parsers.length, equivalent: parsers.length >= 2 && new Set(parsers.map(p => p.semanticHash)).size === 1,
    definition: "Same immutable artifact, same parser implementation/schema, semantically normalized output; distinct fresh Attempts; no source network." },
  stageCosts: workerAttempts.map(a => ({ attemptId: a.id, role: a.worker.role, provider: a.worker.provider, version: a.worker.version,
    durationMs: a.cost.durationMs, usd: a.cost.usd, usage: records.find(r => r.attemptId === a.id)?.usage ?? null,
    mode: records.find(r => r.attemptId === a.id)?.executionMode ?? "NO_RESULT" })),
  costPerSurvivingRecord: { survivingVerifiedRecords: surviving, measuredAttempts: measured.length, totalAttempts: workerAttempts.length,
    measuredProviderUsd: measured.length ? measuredUsd : null, measuredProviderUsdPerRecord: surviving > 0 && measured.length ? measuredUsd / surviving : null,
    totalCostUsd: workerAttempts.every(a => a.cost.usd !== null) ? measuredUsd : null,
    definition: "Measured provider USD divided by records surviving exact Parser→Validator→Auditor chain. Replay included. Deterministic compute and unexposed cost remain null; metric confers no reader-truth status." },
  pipeline: pipeline.map(p => ({ itemId: p.itemId, stage: p.stage, refusal: p.refused, refusals: p.refusals })),
  remainingWorkItem: (await repos.workItems.mustRead(item.id)).value,
  promotion: "OFF: no worker has canonical promotion; confirmation, rendering and runtime batch-control gates remain in force.",
  civicNetworkRequestsMadeByProof: 0,
};
const dir = join(root, "data/health/worker-fleet-proofs");
mkdirSync(dir, { recursive: true });
const path = join(dir, `${today()}.json`);
if (existsSync(path) && !process.argv.includes("--readback-only")) copyFileSync(path, join(dir, `${today()}-prior-${beganAt.replace(/[:.]/g, "-")}.json`));
writeFileSync(path, JSON.stringify(proof, null, 2) + "\n");
console.log(JSON.stringify({ proof: path, workItem: item.id, artifact: artifact.artifactId,
  attempts: workerAttempts.map(a => ({ id: a.id, role: a.worker.role, outcome: a.outcome, durationMs: a.cost.durationMs, usd: a.cost.usd })),
  results: records.map(r => ({ id: r.id, role: r.worker.role, verdict: r.result.verdict, findings: [...new Set(r.result.role === "PARSER" ? r.result.warnings.map(w => w.code) : r.result.findings.map(f => f.code))] })),
  replay: proof.replay, cost: proof.costPerSurvivingRecord, pipeline: pipeline.map(p => ({ id: p.itemId, stage: p.stage, refused: p.refused?.reasons })),
  state: proof.remainingWorkItem.state }, null, 2));
if (parsers.length < 2 || !proof.replay.equivalent || !records.some(r => r.result.role === "VALIDATOR" && r.result.verdict === "PASS") ||
    !auditor || auditor.result.verdict !== "SURVIVED") process.exitCode = 1;
