/**
 * THE PIPELINE'S RULES — pure, over records; and the one append path.
 *
 *   validateTransition   decides, and returns either the accepted record or
 *                        a REFUSED record carrying the offered one
 *   appendTransition     validates against the item's log and appends
 *                        whichever it decided; a refusal is history too
 *   deriveItemState      replays an item's records in append order
 *   map*                 the honest mapping of EXISTING evidence into SCOUTED
 *
 * Nothing here reads a clock or a disk. Lookups the rules need (an artifact
 * by id, an Attempt's role) are handed in as functions.
 */

import type { WorkerRole } from "../attempt.ts";
import { INDEPENDENT_BASES } from "../audit.ts";
import { fingerprint } from "../ids.ts";
import { canonicalJson, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { MethodCandidate } from "../../method/candidate.ts";
import { loadWorkerCompletionEvidence } from "../repository/worker-completion.ts";
import { assertFleetResult } from "../workers/types.ts";
import type { WorkerResultRecord } from "../workers/types.ts";
import { readPromotionRows } from "./evidence-reads.ts";
import {
  PIPELINE_STAGES,
  PRECEDING_STAGE,
  PROMOTION_PIPELINE_FORMAT_VERSION,
  VERIFICATION_CHECKS,
  sameActor,
  type ApprovedRecord,
  type ConfirmedRecord,
  type PipelineActor,
  type PipelineItemState,
  type PipelineRefusalReason,
  type PipelineStage,
  type PromotionPipelineRecord,
  type RefusedRecord,
  type ScoutedRecord,
  type StageRecordMap,
  type TransitionRecord,
  type VerificationCheck,
  type VerificationCheckName,
} from "./types.ts";

export const PROMOTION_PIPELINE_LOG = "promotion_pipeline";

/** The lookups a decision needs. Absent is null, never a default. */
export interface PipelineContext {
  readonly workerResultById?: (id: string) => import("../workers/types.ts").WorkerResultRecord | null;
  readonly workerAuditBlocks?: (artifactIds: readonly string[]) => boolean;
  readonly workerFactAuditBlocks?: (artifactIds: readonly string[], auditorResultId: string) => boolean;
  readonly artifactById: (artifactId: string) => ArtifactRecord | null;
  readonly attemptRoleById: (attemptId: string) => WorkerRole | null;
  /**
   * PRDY-3 (2026-09-06): the artifact ids a COMPLETED Attempt recorded. An
   * Attempt that retrieved byte-identical content re-observes the artifact
   * the log already holds (the artifact log is idempotent on content), so a
   * second acquisition of the same representation is evidenced by the second
   * Attempt naming the same artifact id, not by a second artifact row.
   */
  readonly attemptArtifactIds?: (attemptId: string) => readonly string[] | null;
}

/* ---------------------------------------------------------------- state */

/** A record this module wrote, as opposed to a foreign row under the same log. */
export function isPipelineRecord(value: unknown): value is PromotionPipelineRecord {
  if (value === null || typeof value !== "object") return false;
  const r = value as { formatVersion?: unknown; stage?: unknown; itemId?: unknown };
  return (
    r.formatVersion === PROMOTION_PIPELINE_FORMAT_VERSION &&
    typeof r.itemId === "string" &&
    (r.stage === "REFUSED" || (PIPELINE_STAGES as readonly string[]).includes(r.stage as string))
  );
}

export function deriveItemState(itemId: string, records: readonly PromotionPipelineRecord[]): PipelineItemState {
  const byStage: StageRecordMap = {};
  let refused: RefusedRecord | null = null;
  let refusals = 0;
  let recordClass: string | null = null;
  let subjectId: string | null = null;
  for (const r of records) {
    if (r.stage === "REFUSED") {
      refused = r;
      refusals += 1;
      continue;
    }
    if (byStage[r.stage] !== undefined) continue;
    switch (r.stage) {
      case "SCOUTED":
        byStage.SCOUTED = r;
        recordClass = r.recordClass;
        subjectId = r.subjectId;
        break;
      case "CONFIRMED":
        byStage.CONFIRMED = r;
        break;
      case "VERIFIED":
        byStage.VERIFIED = r;
        break;
      case "AUDITED":
        byStage.AUDITED = r;
        break;
      case "APPROVED_FOR_PROMOTION":
        byStage.APPROVED_FOR_PROMOTION = r;
        break;
    }
  }
  let stage: PipelineStage | null = null;
  for (const s of PIPELINE_STAGES) if (byStage[s] !== undefined) stage = s;
  return { itemId, recordClass, subjectId, stage, refused, refusals, records, byStage };
}

/* ------------------------------------------------------------ decisions */

function refuse(offered: TransitionRecord, reasons: readonly PipelineRefusalReason[]): RefusedRecord {
  /*
   * PRDY-3 (2026-09-06): the refusal id is derived from the OFFER'S CONTENT as
   * well as the reason codes. An approval re-offered after its measured
   * burdens moved (a class that was NOT_SCHEDULED and is now STALE) is a
   * different refusal, appended beside the first; an identical re-offer is the
   * same refusal, deduped. Deriving from codes alone made the second offer a
   * history rewrite the append-only log rightly threw on.
   */
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${offered.recordId}:refused:${fingerprint([offered.at, ...reasons.map((r) => r.code), canonicalJson(offered)])}`,
    itemId: offered.itemId,
    at: offered.at,
    actor: offered.actor,
    stage: "REFUSED",
    atStage: offered.stage,
    reasons,
    offered,
  };
}

function confirmationReasons(
  state: PipelineItemState,
  offered: ConfirmedRecord,
  ctx: PipelineContext,
): PipelineRefusalReason[] {
  const scouted = state.byStage.SCOUTED;
  const reasons: PipelineRefusalReason[] = [];
  if (offered.confirmingArtifactIds.length === 0) {
    reasons.push({
      code: "CONFIRMATION_WITHOUT_ARTIFACT",
      detail: "a confirmation cites no artifact; model prose never confirms model prose",
    });
    return reasons;
  }
  if (offered.basis === "SECOND_ROUTE" && (offered.sameFact === null || offered.sameFact.trim() === "")) {
    reasons.push({
      code: "CONFIRMATION_SECOND_ROUTE_UNNAMED",
      detail: "a second route must name the fact it shares with the scouted representation",
    });
  }
  /* PRDY-3: a second acquisition that states a different fact confirms nothing; the item holds. */
  if (offered.factAgreement !== undefined && !offered.factAgreement.sameFact) {
    reasons.push({ code: "CONFIRMATION_FACT_CONFLICT", detail: offered.factAgreement.detail });
  }
  for (const id of offered.confirmingArtifactIds) {
    const artifact = ctx.artifactById(id);
    if (artifact === null) {
      reasons.push({ code: "CONFIRMATION_ARTIFACT_UNKNOWN", detail: `artifact ${id} is not in the artifact log` });
      continue;
    }
    /*
     * PRDY-3: byte-identical re-acquisition. The artifact log keeps ONE row per
     * content, attributed to the first observer, so a second Attempt that
     * retrieved the same bytes is evidenced by that Attempt's own recorded
     * artifact ids. The offered actor must be that Attempt, and it is the
     * Attempt whose role is then judged.
     */
    const reobservedBy =
      scouted !== undefined &&
      artifact.attemptId === scouted.scoutAttemptId &&
      offered.actor.instance !== scouted.scoutAttemptId &&
      ctx.attemptRoleById(offered.actor.instance) === "ACQUIRER" &&
      (ctx.attemptArtifactIds?.(offered.actor.instance)?.includes(id) ?? false)
        ? offered.actor.instance
        : null;
    if (scouted !== undefined && artifact.attemptId === scouted.scoutAttemptId && reobservedBy === null) {
      reasons.push({
        code: "CONFIRMATION_SAME_ATTEMPT",
        detail: `artifact ${id} was vaulted by the Scout's own Attempt ${artifact.attemptId}`,
      });
    }
    const acquiringAttempt = reobservedBy ?? artifact.attemptId;
    const role = ctx.attemptRoleById(acquiringAttempt);
    if (role === null) {
      reasons.push({
        code: "CONFIRMATION_ATTEMPT_UNKNOWN",
        detail: `artifact ${id} names Attempt ${acquiringAttempt}, which the attempts aggregate does not hold`,
      });
    } else if (role === "SCOUT") {
      reasons.push({
        code: "CONFIRMATION_BY_SCOUT_ROLE",
        detail: `artifact ${id} was vaulted by SCOUT-role Attempt ${acquiringAttempt}`,
      });
    }
    if (offered.basis === "SECOND_ACQUISITION" && scouted !== undefined) {
      if (scouted.canonicalUrl === null || artifact.canonicalUrl !== scouted.canonicalUrl) {
        reasons.push({
          code: "CONFIRMATION_URL_MISMATCH",
          detail:
            `a second acquisition must be of the same representation; artifact ${id} is ` +
            `${artifact.canonicalUrl} and the scouted representation is ${scouted.canonicalUrl ?? "(none)"}`,
        });
      }
    }
  }
  return reasons;
}

function verificationReasons(checks: readonly VerificationCheck[]): PipelineRefusalReason[] {
  const reasons: PipelineRefusalReason[] = [];
  const seen = new Map<VerificationCheckName, VerificationCheck>();
  for (const c of checks) seen.set(c.name, c);
  for (const name of VERIFICATION_CHECKS) {
    const c = seen.get(name);
    if (c === undefined) {
      reasons.push({ code: "VERIFICATION_CHECK_MISSING", detail: `${name} is not on the record` });
    } else if (c.result === "FAIL") {
      reasons.push({ code: "VERIFICATION_CHECK_FAILED", detail: `${name}: ${c.detail}` });
    } else if (c.result === "NOT_IMPLEMENTED") {
      reasons.push({ code: "VERIFICATION_CHECK_NOT_IMPLEMENTED", detail: `${name}: ${c.detail}` });
    }
  }
  return reasons;
}

function auditReasons(state: PipelineItemState, offered: Extract<TransitionRecord, { stage: "AUDITED" }>): PipelineRefusalReason[] {
  const reasons: PipelineRefusalReason[] = [];
  const scouted = state.byStage.SCOUTED;
  const verified = state.byStage.VERIFIED;
  if (scouted !== undefined && sameActor(offered.actor, scouted.actor)) {
    reasons.push({ code: "AUDIT_NOT_INDEPENDENT", detail: "the auditor is the Scout" });
  }
  if (verified !== undefined && sameActor(offered.actor, verified.actor)) {
    reasons.push({ code: "AUDIT_NOT_INDEPENDENT", detail: "the auditor is the validator" });
  }
  if (!offered.startedFrom.some((b) => INDEPENDENT_BASES.includes(b))) {
    reasons.push({
      code: "AUDIT_STARTING_POINT_NOT_INDEPENDENT",
      detail: `startedFrom [${offered.startedFrom.join(", ")}] holds none of ${INDEPENDENT_BASES.join(", ")}`,
    });
  }
  if (offered.controls === null) {
    reasons.push({
      code: "AUDIT_CONTROLS_NOT_MEASURED",
      detail: "the batch carried no injected controls, so recall and the false-absence and false-presence rates are NOT MEASURED",
    });
  }
  if (!offered.survived) {
    reasons.push({ code: "AUDIT_DID_NOT_SURVIVE", detail: offered.findings.join("; ") || "the auditor broke the claim" });
  }
  return reasons;
}

function approvalReasons(state: PipelineItemState, offered: ApprovedRecord): PipelineRefusalReason[] {
  const reasons: PipelineRefusalReason[] = [];
  const expect: readonly (readonly [PipelineStage, string])[] = [
    ["SCOUTED", offered.chain.scouted],
    ["CONFIRMED", offered.chain.confirmed],
    ["VERIFIED", offered.chain.verified],
    ...(offered.recordClass === "candidate-enrichment" && offered.field === "campaignSite" && offered.chain.audited === undefined
      ? [] : [["AUDITED", offered.chain.audited ?? ""] as const]),
  ];
  for (const [stage, id] of expect) {
    const held: TransitionRecord | undefined = state.byStage[stage];
    if (held === undefined || held.recordId !== id) {
      reasons.push({
        code: "APPROVAL_CHAIN_INCOMPLETE",
        detail: `chain.${stage.toLowerCase()} names ${id}; the item's ${stage} record is ${held?.recordId ?? "absent"}`,
      });
    }
  }
  /* PRDY-3/5: the burdens the offer measured travel on the record; a FAIL refuses. */
  for (const burden of offered.burdens ?? []) {
    if (burden.result === "FAIL") reasons.push({ code: "APPROVAL_BURDEN_FAILED", detail: `${burden.name}: ${burden.detail}` });
  }
  return reasons;
}

/**
 * Decide one offered transition against the item's current state.
 *
 * Returns the accepted record, or a REFUSED record that carries the offered
 * one and every reason at once — a refusal that reported only the first
 * defect would send the next attempt back one defect at a time.
 */
export function validateTransition(
  state: PipelineItemState,
  offered: TransitionRecord,
  ctx: PipelineContext,
): { readonly ok: true; readonly record: TransitionRecord } | { readonly ok: false; readonly record: RefusedRecord } {
  const reasons: PipelineRefusalReason[] = [];
  const preceding = offered.stage === "APPROVED_FOR_PROMOTION" && offered.recordClass === "candidate-enrichment" &&
    offered.field === "campaignSite" && offered.chain.audited === undefined && state.stage === "VERIFIED"
    ? "VERIFIED" : PRECEDING_STAGE[offered.stage];
  const held: TransitionRecord | undefined = state.byStage[offered.stage];
  if (held !== undefined) {
    if (held.recordId === offered.recordId && canonicalJson(held) === canonicalJson(offered)) {
      return { ok: true, record: held };
    }
    reasons.push({ code: "STAGE_ALREADY_REACHED", detail: `the item already holds ${offered.stage} record ${held.recordId}` });
    return { ok: false, record: refuse(offered, reasons) };
  }
  if (preceding !== null && state.stage !== preceding) {
    reasons.push({
      code: "STAGE_OUT_OF_ORDER",
      detail: `${offered.stage} follows ${preceding}; the item is at ${state.stage ?? "nothing"}`,
    });
    return { ok: false, record: refuse(offered, reasons) };
  }
  if (preceding !== null) {
    const prior: TransitionRecord | undefined = state.byStage[preceding];
    if (prior !== undefined && sameActor(prior.actor, offered.actor)) {
      reasons.push({
        code: "SELF_CERTIFICATION",
        detail: `${offered.actor.role}/${offered.actor.instance} performed ${preceding} and may not perform ${offered.stage}`,
      });
    }
  }
  switch (offered.stage) {
    case "SCOUTED":
      break;
    case "CONFIRMED":
      reasons.push(...confirmationReasons(state, offered, ctx));
      break;
    case "VERIFIED":
      reasons.push(...verificationReasons(offered.checks));
      if (offered.workerResultId) {
        const worker = ctx.workerResultById?.(offered.workerResultId);
        if (!worker || worker.result.role !== "VALIDATOR" || worker.result.verdict !== "PASS" || worker.worker.instance !== offered.actor.instance ||
            !state.byStage.SCOUTED?.artifactIds.some(id => worker.inputArtifactIds.includes(id))) {
          reasons.push({ code: "WORKER_RESULT_NOT_VERIFIED", detail: "The offered verification does not bind an exact completed independent Validator result and its source artifact." });
        }
      }
      break;
    case "AUDITED":
      reasons.push(...auditReasons(state, offered));
      if (offered.workerResultId) {
        const worker = ctx.workerResultById?.(offered.workerResultId);
        const verification = state.byStage.VERIFIED?.workerResultId;
        if (!worker || worker.result.role !== "ADVERSARIAL_AUDITOR" || worker.result.verdict !== "SURVIVED" || worker.worker.instance !== offered.actor.instance ||
            !verification || !worker.inputResultIds.includes(verification)) reasons.push({ code: "WORKER_RESULT_NOT_VERIFIED", detail: "The offered audit does not bind the exact Validator and Parser result chain." });
      }
      break;
    case "APPROVED_FOR_PROMOTION":
      reasons.push(...approvalReasons(state, offered));
      {
        const ids = state.byStage.SCOUTED?.artifactIds ?? [];
        const auditorId = state.byStage.AUDITED?.workerResultId;
        const scopedFact = state.byStage.SCOUTED?.source.kind === "FLEET_EXTRACTION" &&
          ["meeting-times", "agendas"].includes(state.recordClass ?? "") && auditorId;
        const blocked = scopedFact && ctx.workerFactAuditBlocks
          ? ctx.workerFactAuditBlocks(ids, auditorId!) : ctx.workerAuditBlocks?.(ids);
        if (blocked) reasons.push({ code: "WORKER_AUDIT_BLOCKS_PROMOTION", detail: "A durable worker finding reopened or blocked this artifact's dependent work." });
      }
      break;
  }
  return reasons.length === 0 ? { ok: true, record: offered } : { ok: false, record: refuse(offered, reasons) };
}

/* ---------------------------------------------------------------- append */

export interface AppendTransitionOutcome {
  readonly accepted: boolean;
  /** False when the identical record was already in the log. */
  readonly appended: boolean;
  readonly record: PromotionPipelineRecord;
  readonly state: PipelineItemState;
}

async function readItemRecords(repos: ControlPlaneRepositories, itemId: string): Promise<PromotionPipelineRecord[]> {
  /* A foreign row under this log (the conformance suite writes one per run) is not a transition. */
  return (await repos.promotionPipeline.read(itemId)).filter(isPipelineRecord);
}

/**
 * Validate against the log, then append what was decided. A refusal is
 * appended too. An identical re-offer of a held record is a no-op success.
 */
export async function appendTransition(
  repos: ControlPlaneRepositories,
  offered: TransitionRecord,
  ctx: PipelineContext,
  now: string,
): Promise<AppendTransitionOutcome> {
  const before = deriveItemState(offered.itemId, await readItemRecords(repos, offered.itemId));
  const decided = validateTransition(before, offered, ctx);
  const outcome = await repos.promotionPipeline.append(offered.itemId, decided.record.recordId, decided.record, now);
  const after = deriveItemState(offered.itemId, await readItemRecords(repos, offered.itemId));
  return { accepted: decided.ok, appended: outcome.appended, record: decided.record, state: after };
}

/**
 * Every item's derived state, by item id order. Keys holding no pipeline record are not items.
 *
 * The log is read whole in bounded pages and grouped by item: `appendTransition`
 * appends every record, held, offered or refused, under its own `itemId`, so
 * an item's group is exactly what reading its key returns. One read per key
 * issued 629 sequential requests on 2026-09-24, and a research cycle reached
 * its 15-minute wall waiting on them.
 */
export async function readPipelineStates(repos: ControlPlaneRepositories): Promise<PipelineItemState[]> {
  const [keys, records] = await Promise.all([repos.promotionPipeline.keys(), repos.promotionPipeline.readAll()]);
  const byItem = new Map<string, PromotionPipelineRecord[]>();
  for (const record of records) {
    /* A foreign row under this log (the conformance suite writes one per run) is not a transition. */
    if (!isPipelineRecord(record)) continue;
    const itemRecords = byItem.get(record.itemId);
    if (itemRecords) itemRecords.push(record);
    else byItem.set(record.itemId, [record]);
  }
  const out: PipelineItemState[] = [];
  for (const key of keys) {
    const itemRecords = byItem.get(key);
    if (itemRecords === undefined || itemRecords.length === 0) continue;
    out.push(deriveItemState(key, itemRecords));
  }
  return out;
}

/** A fresh context over this job's evidence. Legacy unscoped callers retain
 * arbitrary artifact/Attempt lookups until they provide their evidence set. */
export async function contextFromRepositories(repos: ControlPlaneRepositories, evidence?: {
  readonly artifacts: readonly ArtifactRecord[];
  readonly results?: readonly WorkerResultRecord[];
  readonly attemptIds?: readonly string[];
}): Promise<PipelineContext> {
  const artifacts = new Map<string, ArtifactRecord>();
  const artifactRecords = evidence?.artifacts ?? await repos.artifacts.readAll();
  for (const a of artifactRecords) artifacts.set(a.artifactId, a);
  const roles = new Map<string, WorkerRole>();
  const results = evidence?.results ?? await repos.workerResults.readAll();
  const [attempts, workItems] = await Promise.all([
    evidence === undefined ? repos.attempts.list().then(rows => new Map(rows.map(row => [row.id, row.value])))
      : readPromotionRows(repos.attempts, artifactRecords.map(a => a.attemptId)
        .concat(results.map(r => r.attemptId), evidence.attemptIds ?? [])),
    readPromotionRows(repos.workItems, results.map(r => r.workItemId)),
  ]);
  for (const [id, attempt] of attempts) roles.set(id, attempt.worker.role);
  const resultsById = new Map(results.map(r => [r.id, r]));
  const completion = new Map(await Promise.all([...new Set(results.map(r => r.workItemId))].map(async id => [id, await loadWorkerCompletionEvidence(repos, id)] as const)));
  return {
    artifactById: (id) => artifacts.get(id) ?? null,
    attemptRoleById: (id) => roles.get(id) ?? null,
    attemptArtifactIds: (id) => {
      const attempt = attempts.get(id);
      return attempt === undefined || attempt.outcome !== "COMPLETED" ? null : attempt.artifactIds;
    },
    workerResultById: (id) => {
      const result = resultsById.get(id);
      if (!result || attempts.get(result.attemptId)?.outcome !== "COMPLETED" ||
          canonicalJson(attempts.get(result.attemptId)) !== canonicalJson(result.completion.closedAttempt)) return null;
      try { assertFleetResult(result.result, result.completion.completedTask.workerTask!.role, result.attemptId); return result; }
      catch { return null; }
    },
    workerAuditBlocks: (ids) => results.some(r => r.inputArtifactIds.some(id => ids.includes(id)) &&
      (completion.get(r.workItemId)?.validations.some(v => !v.passed) ||
        !completion.get(r.workItemId)?.audits.some(a => a.survived) ||
        completion.get(r.workItemId)?.audits.some(a => !a.survived && a.resolvedAt === null) ||
        ["REOPENED", "BLOCKED"].includes(workItems.get(r.workItemId)?.state ?? ""))),
    workerFactAuditBlocks: (ids, auditorId) => {
      const audits = results.filter(record => record.result.role === "ADVERSARIAL_AUDITOR" &&
        record.inputArtifactIds.some(id => ids.includes(id))).sort((a, b) => b.endedAt.localeCompare(a.endedAt));
      // A captured-fact audit does not close the source-universe obligation.
      // It may certify only its exact current validated facts. Actual breaks
      // remain blocking; a later captured-only run cannot erase them.
      return audits[0]?.id !== auditorId || audits[0]?.result.verdict !== "SURVIVED" ||
        audits.some(record => record.result.verdict === "BROKE");
    },
  };
}

/* --------------------------------------------------------------- mapping */

export const SCOUTED_OUTCOMES = ["ROUTE_CANDIDATE", "EVIDENCE_FOUND"] as const;

/** The item id is derived from what the item IS, so a re-map collides instead of duplicating. */
export function scoutResultItemId(result: Pick<ScoutResult, "attemptId">, routeId: string | null): string {
  return `pp-${fingerprint(["scout-result", result.attemptId, routeId])}`;
}

export function methodCandidateItemId(candidateId: string): string {
  return `pp-${fingerprint(["method-candidate", candidateId])}`;
}

function scoutActor(result: ScoutResult): PipelineActor {
  return { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: result.attemptId };
}

/**
 * SCOUTED items from one persisted Scout result: one per candidate for a
 * ROUTE_CANDIDATE, one for the findings of an EVIDENCE_FOUND. A refused
 * result maps to nothing — its outcome was never a finding.
 */
export function scoutedFromScoutResult(result: ScoutResult): ScoutedRecord[] {
  if (result.refusal !== null) return [];
  if (!(SCOUTED_OUTCOMES as readonly string[]).includes(result.outcome)) return [];
  const outcome = result.outcome as "ROUTE_CANDIDATE" | "EVIDENCE_FOUND";
  const base = (itemId: string, routeId: string | null, canonicalUrl: string | null, artifactIds: readonly string[], summary: string): ScoutedRecord => ({
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${itemId}:scouted`,
    itemId,
    at: result.recordedAt,
    actor: scoutActor(result),
    stage: "SCOUTED",
    source: { kind: "SCOUT_RESULT", attemptId: result.attemptId, obligationId: result.obligationId, outcome, routeId },
    recordClass: result.recordClass,
    subjectId: result.subjectId,
    canonicalUrl,
    artifactIds,
    scoutAttemptId: result.attemptId,
    summary,
  });
  if (outcome === "ROUTE_CANDIDATE") {
    return result.candidates.map((c) =>
      base(scoutResultItemId(result, c.routeId), c.routeId, c.url, c.evidenceArtifactIds, `${c.title} — ${c.url}`),
    );
  }
  const artifactIds = [...new Set(result.findings.flatMap((f) => f.artifactIds))];
  return [
    base(
      scoutResultItemId(result, null),
      null,
      null,
      artifactIds,
      result.findings.map((f) => `${f.kind}: ${f.summary}`).join(" | "),
    ),
  ];
}

/**
 * A VALIDATED (or PROPOSED) method candidate is a SCOUTED item: method-store
 * validation checks the store's shape, which is not the pipeline's VERIFIED.
 */
export function scoutedFromMethodCandidate(
  candidate: MethodCandidate,
  resultsByAttempt: ReadonlyMap<string, ScoutResult>,
): ScoutedRecord | null {
  if (candidate.lifecycle !== "VALIDATED" && candidate.lifecycle !== "PROPOSED") return null;
  const result = resultsByAttempt.get(candidate.attemptId) ?? null;
  const proposal = candidate.proposal;
  const scoutCandidate = result?.candidates.find((c) => c.routeId === proposal.id) ?? null;
  const itemId = methodCandidateItemId(candidate.id);
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${itemId}:scouted`,
    itemId,
    at: candidate.submittedAt,
    actor: { role: "SCOUT", lane: "BOUNDED_MODEL_WORKER", instance: candidate.attemptId },
    stage: "SCOUTED",
    source: { kind: "METHOD_CANDIDATE", candidateId: candidate.id, attemptId: candidate.attemptId, lifecycle: candidate.lifecycle, routeId: proposal.id },
    recordClass: result?.recordClass ?? scoutCandidate?.recordClass ?? proposal.fields[0] ?? "unknown",
    subjectId: result?.subjectId ?? proposal.outcome.jurisdiction,
    canonicalUrl: scoutCandidate?.url ?? null,
    artifactIds: scoutCandidate?.evidenceArtifactIds ?? [],
    scoutAttemptId: candidate.attemptId,
    summary: `method candidate ${candidate.id} (${candidate.lifecycle}): ${proposal.title}`,
  };
}

/**
 * The one CONFIRMED record the evidence could honestly support: artifacts at
 * the scouted URL vaulted by an ACQUIRER-role Attempt other than the Scout's.
 * Returns null when no such artifact exists — which is the measured case.
 */
export function confirmationFromArtifacts(
  scouted: ScoutedRecord,
  artifacts: readonly ArtifactRecord[],
  attemptRoleById: (attemptId: string) => WorkerRole | null,
  now: string,
): ConfirmedRecord | null {
  if (scouted.canonicalUrl === null) return null;
  const confirming = artifacts.filter(
    (a) =>
      a.canonicalUrl === scouted.canonicalUrl &&
      a.attemptId !== scouted.scoutAttemptId &&
      attemptRoleById(a.attemptId) === "ACQUIRER",
  );
  if (confirming.length === 0) return null;
  const instance = confirming[0].attemptId;
  return {
    formatVersion: PROMOTION_PIPELINE_FORMAT_VERSION,
    recordId: `${scouted.itemId}:confirmed:${fingerprint(confirming.map((a) => a.artifactId))}`,
    itemId: scouted.itemId,
    at: now,
    actor: { role: "ACQUIRER", lane: "DETERMINISTIC", instance },
    stage: "CONFIRMED",
    basis: "SECOND_ACQUISITION",
    confirmingArtifactIds: confirming.map((a) => a.artifactId),
    sameFact: null,
  };
}

/* ---------------------------------------------------------------- counts */

export interface StageCounts {
  readonly items: number;
  readonly byStage: Readonly<Record<PipelineStage, number>>;
  readonly refused: number;
  readonly byRecordClass: readonly { readonly recordClass: string; readonly items: number; readonly byStage: Readonly<Record<PipelineStage, number>>; readonly refused: number }[];
}

/** Counts by furthest stage reached. Every number's denominator is `items`. */
export function stageCounts(states: readonly PipelineItemState[]): StageCounts {
  const zero = (): Record<PipelineStage, number> => ({ SCOUTED: 0, CONFIRMED: 0, VERIFIED: 0, AUDITED: 0, APPROVED_FOR_PROMOTION: 0 });
  const total = zero();
  let refused = 0;
  const classes = new Map<string, { items: number; byStage: Record<PipelineStage, number>; refused: number }>();
  for (const s of states) {
    const cls = s.recordClass ?? "unknown";
    const row = classes.get(cls) ?? { items: 0, byStage: zero(), refused: 0 };
    row.items += 1;
    if (s.stage !== null) {
      total[s.stage] += 1;
      row.byStage[s.stage] += 1;
    }
    if (s.refusals > 0) {
      refused += 1;
      row.refused += 1;
    }
    classes.set(cls, row);
  }
  return {
    items: states.length,
    byStage: total,
    refused,
    byRecordClass: [...classes.entries()]
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([recordClass, row]) => ({ recordClass, ...row })),
  };
}
