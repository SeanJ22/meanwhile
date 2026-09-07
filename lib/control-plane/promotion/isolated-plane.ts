/**
 * **AN ISOLATED CONTROL PLANE FOR THE SHADOW CANARY AND THE CHAIN SUITES.**
 * (Fleet Promotion Readiness, PRDY-6, 2026-09-06.)
 *
 * Memory repositories, a durable vault in a directory of the caller's
 * choosing, and the REAL worker procedures — PARSER, VALIDATOR and
 * ADVERSARIAL_AUDITOR running in their isolated processes through the real
 * dispatcher — over bytes the caller holds as genuine acquisitions (a fresh
 * ACQUIRER Attempt per hold, disposed through the coordinator). Nothing here
 * touches the live control plane, the live vault, or the committed snapshot.
 *
 * The independent audit context is built the way the standing runtime builds
 * one: from the plane's own artifacts and the method registry's route floor
 * (`computeRouteFloor`), before any producer or validator output exists. A
 * model reasoner may be attached so the audit is the standing runner's audit,
 * model review included; without one the audit is the deterministic attack
 * set and says so.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordAcquisition, type Artifact } from "../evidence/artifact.ts";
import { DurableEvidenceStore } from "../evidence/durable-store.ts";
import { putArtifact, readForParser } from "../evidence/store.ts";
import { computeRouteFloor } from "../preflight.ts";
import { beginAttemptFor, claimRouteTask, disposeRouteTask, recordArtifactMetadata, registerRouteTask, registerWorkItem } from "../repository/coordinator.ts";
import { createMemoryRepositories } from "../repository/memory.ts";
import type { ArtifactRecord, ControlPlaneRepositories } from "../repository/types.ts";
import { createRouteTask } from "../route-task.ts";
import { createWorkItem } from "../work-item.ts";
import { dispatchWorkerTask, enqueueWorkerTask, evidenceProjection, FLEET_POLICY_VERSION, type FleetRuntime } from "../workers/runtime.ts";
import type { CivicExtractionContract, FleetRole, IndependentAuditContext, OfficialRouteExpectation, WorkerResultRecord, WorkerTaskSpec } from "../workers/types.ts";

/** The real Pima County Legistar events contract the chain suites and the canary use. */
export const PIMA_LEGISTAR_CONTRACT: CivicExtractionContract = {
  recordClass: "LEGISTAR_EVENTS", schemaVersion: 1,
  subjectId: "ocd-division/country:us/state:az/county:pima#governing",
  sourceBodyId: 138, sourceBodyName: "Board of Supervisors", publisherSlug: "pima",
  requiredFields: ["EventId", "EventBodyId", "EventBodyName", "EventDate", "EventTime"],
  completenessScope: "Every event in this captured representation; no all-future-meetings claim.",
  expectedSourceDate: null,
};
export const PIMA_LEGISTAR_FEED_URL = "https://webapi.legistar.com/v1/pima/events";
export const ISOLATED_PLANE_PROJECT = "freshness";

export interface IsolatedPlaneOptions {
  /** The repository root, for `data/method/knowledge.json`. */
  readonly root?: string;
  readonly vaultRoot?: string;
  /** The plane's first clock reading; every later reading is one second on. */
  readonly startAt?: string;
  readonly contract?: CivicExtractionContract;
  readonly feedUrl?: string;
  readonly publisherSurfaces?: readonly string[];
  /** A reasoner, or a factory that builds one over the plane's own repositories (the reasoner meters spend there). */
  readonly auditReasoner?: FleetRuntime["auditReasoner"] | ((repos: ControlPlaneRepositories) => FleetRuntime["auditReasoner"]);
  readonly requireModelAudit?: boolean;
}

export interface IsolatedPlane {
  readonly repos: ControlPlaneRepositories;
  readonly vaultRoot: string;
  readonly itemId: string;
  readonly contract: CivicExtractionContract;
  readonly feedUrl: string;
  readonly methodVersion: number;
  readonly runtime: FleetRuntime;
  readonly now: () => string;
  /** Vault bytes as one acquisition by a fresh Attempt of the given role. */
  readonly hold: (text: string, options?: { canonicalUrl?: string; role?: "ACQUIRER" | "SCOUT"; contentType?: string }) => Promise<ArtifactRecord>;
  /** Run one worker role over a held artifact through the real dispatcher. */
  readonly run: (artifact: ArtifactRecord, role: FleetRole, options?: { producerResultId?: string; validatorResultId?: string; auditScope?: WorkerTaskSpec["auditScope"]; contract?: CivicExtractionContract }) => Promise<WorkerResultRecord>;
  /** PARSER → VALIDATOR → ADVERSARIAL_AUDITOR (SOURCE_UNIVERSE) over one artifact. */
  readonly chain: (artifact: ArtifactRecord, options?: { auditScope?: WorkerTaskSpec["auditScope"] }) => Promise<{ parser: WorkerResultRecord; validator: WorkerResultRecord; auditor: WorkerResultRecord }>;
  readonly readArtifactText: (artifactId: string) => Promise<string | null>;
  readonly heldArtifacts: () => readonly Artifact[];
}

function jurisdictionFor(contract: CivicExtractionContract, feedUrl: string): { state: string; governmentType?: string; platform?: string; publisher?: string } {
  const state = /state:([a-z]{2})/i.exec(contract.subjectId)?.[1]?.toLowerCase() ?? "az";
  const governmentType = /county:/.test(contract.subjectId) ? "county" : /place:/.test(contract.subjectId) ? "city" : /school_district:/.test(contract.subjectId) ? "school_district" : undefined;
  const platform = contract.schemaVersion === 1 ? (contract.recordClass === "LEGISTAR_EVENTS" ? "legistar" : "civicclerk") : undefined;
  let publisher: string | undefined;
  try { publisher = new URL(feedUrl).hostname.toLowerCase(); } catch { publisher = undefined; }
  return { state, ...(governmentType ? { governmentType } : {}), ...(platform ? { platform } : {}), ...(publisher ? { publisher } : {}) };
}

export async function isolatedFactPlane(options: IsolatedPlaneOptions = {}): Promise<IsolatedPlane> {
  const root = options.root ?? process.cwd();
  const knowledge = JSON.parse(readFileSync(join(root, "data/method/knowledge.json"), "utf8"));
  const methodVersion: number = knowledge.version;
  const contract = options.contract ?? PIMA_LEGISTAR_CONTRACT;
  const feedUrl = options.feedUrl ?? PIMA_LEGISTAR_FEED_URL;
  const repos = createMemoryRepositories();
  const vaultRoot = options.vaultRoot ?? mkdtempSync(join(tmpdir(), "wtp-isolated-plane-"));
  const store = new DurableEvidenceStore(vaultRoot);
  let clock = Date.parse(options.startAt ?? new Date().toISOString());
  const now = () => new Date(clock += 1_000).toISOString();
  const item = createWorkItem({ project: ISOLATED_PLANE_PROJECT, subject: contract.subjectId,
    obligation: "Extract and independently verify the captured event representation",
    why: "The evidence owed to readers must survive disposable worker execution.",
    contract: { requiresValidation: true, requiresAudit: true }, now: now() });
  await registerWorkItem(repos, item, now());
  const artifacts = new Map<string, Artifact>();
  let captures = 0;

  const hold: IsolatedPlane["hold"] = async (text, holdOptions = {}) => {
    const canonicalUrl = holdOptions.canonicalUrl ?? feedUrl;
    const role = holdOptions.role ?? "ACQUIRER";
    const at = now();
    const routeId = `held-acquisition-${++captures}`;
    const task = createRouteTask({ workItemId: item.id, routeId, routeLabel: "Held acquisition", target: canonicalUrl, inherited: false, now: at });
    await registerRouteTask(repos, task, at);
    const holder = `isolated-${role.toLowerCase()}-${captures}`;
    const claim = await claimRouteTask(repos, { routeTaskId: task.id, holder, now: at, ttlMs: 60_000 });
    const attempt = await beginAttemptFor(repos, { routeTaskId: task.id, workItemId: item.id,
      worker: { role, provider: "isolated-plane", version: "isolated-plane/1", instance: holder },
      lease: claim.lease.value, now: at, methodVersion, policyVersion: FLEET_POLICY_VERSION });
    const { artifact } = recordAcquisition({ canonicalUrl, retrievedAt: at, httpStatus: 200, contentType: holdOptions.contentType ?? "application/json",
      sourceId: contract.schemaVersion === 1 && contract.recordClass === "CIVICCLERK_EVENTS" ? "civicclerk" : "legistar", methodRouteId: routeId,
      workItemId: item.id, attemptId: attempt.id, permission: "ALLOWED", transport: "REACHABLE" }, text);
    await putArtifact(store, ISOLATED_PLANE_PROJECT, artifact, Buffer.from(text));
    const record: ArtifactRecord = { artifactId: artifact.id, workItemId: item.id, routeTaskId: task.id, attemptId: attempt.id,
      tier: artifact.tier, contentHash: artifact.contentHash, byteLength: artifact.byteLength, contentType: artifact.contentType,
      canonicalUrl, partial: false, recordedAt: at };
    await recordArtifactMetadata(repos, record, at);
    await disposeRouteTask(repos, { routeTaskId: task.id, attemptId: attempt.id, expectedTaskRevision: (await repos.routeTasks.mustRead(task.id)).revision,
      artifactIds: [artifact.id], now: at,
      disposition: { disposition: "INGESTED", attemptId: attempt.id, at, artifactIds: [artifact.id], observation: null,
        permission: "ALLOWED", transport: "REACHABLE", note: "Held bytes recorded on an isolated plane; the live control plane is untouched." } });
    artifacts.set(artifact.id, artifact);
    return record;
  };

  /* One lookup for both readers: the fleet runtime refuses an unknown id, the text reader answers null. */
  const heldArtifact = (artifactId: string): Artifact => {
    const artifact = artifacts.get(artifactId);
    if (!artifact) throw new Error("ISOLATED_PLANE_ARTIFACT_MISSING");
    return artifact;
  };
  const readEvidence: FleetRuntime["readEvidence"] = async (artifactId) => (await readForParser(store, ISOLATED_PLANE_PROJECT, heldArtifact(artifactId))).input;
  const independentContext: FleetRuntime["independentContext"] = async (scope) => {
    const held = [...artifacts.values()];
    const routes: OfficialRouteExpectation[] = held.map((artifact) => ({ routeId: artifact.methodRouteId, canonicalUrl: artifact.canonicalUrl, applicable: true,
      status: "HELD" as const, artifactIds: [artifact.id], reason: "Independently inventoried held evidence route on the isolated plane." }));
    const floor = computeRouteFloor({ knowledge, jurisdiction: jurisdictionFor(scope.contract, feedUrl), fields: ["meeting", "agenda"],
      adapterRoutes: routes.map((route) => ({ routeId: route.routeId, label: route.reason, target: route.canonicalUrl })) });
    for (const route of floor.routes) {
      if (routes.some((r) => r.routeId === route.routeId && r.canonicalUrl === route.target)) continue;
      routes.push({ routeId: route.routeId, canonicalUrl: route.target, applicable: route.obligation === "REQUIRED", status: "OPEN", artifactIds: [],
        reason: `Current method projection: ${route.obligation}; ${route.proof}; ${route.label}. The inherited target is not a newly observed endpoint.` });
    }
    const context: IndependentAuditContext = {
      subjectId: scope.contract.subjectId, contract: scope.contract, methodVersion: scope.methodVersion,
      publisherSurfaces: [...new Set([feedUrl, ...(options.publisherSurfaces ?? []), ...held.map((a) => a.canonicalUrl)])],
      routes,
      evidence: await Promise.all(held.map(async (artifact) => evidenceProjection(await readEvidence(artifact.id)))),
      startedFrom: ["CANONICAL_SUBJECT_IDENTITY", "PUBLISHER_SOURCE_UNIVERSE", "METHOD_REGISTRY", "EVIDENCE_VAULT"],
      scope: scope.auditScope,
    };
    return context;
  };
  const reasoner = typeof options.auditReasoner === "function" ? options.auditReasoner(repos) : options.auditReasoner;
  const runtime: FleetRuntime = {
    repos, methodVersion, now, readEvidence, independentContext,
    ...(options.requireModelAudit ? { requireModelAudit: true } : {}),
    ...(reasoner ? { auditReasoner: reasoner } : {}),
  };

  const run: IsolatedPlane["run"] = async (artifact, role, runOptions = {}) => {
    const task = await enqueueWorkerTask(repos, { workItemId: item.id, role, artifactId: artifact.artifactId, contract: runOptions.contract ?? contract, now: now(),
      ...(runOptions.producerResultId ? { producerResultId: runOptions.producerResultId } : {}),
      ...(runOptions.validatorResultId ? { validatorResultId: runOptions.validatorResultId } : {}),
      ...(runOptions.auditScope ? { auditScope: runOptions.auditScope } : {}) });
    const dispatch = await dispatchWorkerTask(runtime, task);
    if (dispatch.outcome !== "WORKED") throw new Error(`ISOLATED_PLANE_DISPATCH_${dispatch.outcome}: ${dispatch.detail}`);
    const records = (await repos.workerResults.readAll()).filter((record) => record.attemptId === dispatch.attemptId);
    if (records.length !== 1) throw new Error("ISOLATED_PLANE_RESULT_NOT_RECORDED");
    return records[0];
  };

  const chain: IsolatedPlane["chain"] = async (artifact, chainOptions = {}) => {
    const parser = await run(artifact, "PARSER");
    const validator = await run(artifact, "VALIDATOR", { producerResultId: parser.id });
    /* SOURCE_UNIVERSE: the scope whole-obligation completion and promotion require; a captured-artifact audit stays diagnostic. */
    const auditor = await run(artifact, "ADVERSARIAL_AUDITOR", { producerResultId: parser.id, validatorResultId: validator.id, auditScope: chainOptions.auditScope ?? "SOURCE_UNIVERSE" });
    return { parser, validator, auditor };
  };

  const readArtifactText = async (artifactId: string): Promise<string | null> =>
    artifacts.has(artifactId) ? (await readForParser(store, ISOLATED_PLANE_PROJECT, heldArtifact(artifactId))).input.text : null;

  return { repos, vaultRoot, itemId: item.id, contract, feedUrl, methodVersion, runtime, now, hold, run, chain, readArtifactText, heldArtifacts: () => [...artifacts.values()] };
}
