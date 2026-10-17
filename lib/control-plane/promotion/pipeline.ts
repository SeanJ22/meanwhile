import type { WorkerRole } from "../attempt.ts";
import { fingerprint } from "../ids.ts";
import { canonicalJson, readByKeys, type ArtifactRecord, type ControlPlaneRepositories } from "../repository/types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import type { MethodCandidate } from "../../method/candidate.ts";
import { assertFleetResult } from "../workers/types.ts";
import {
  PIPELINE_STAGES,
  PRECEDING_STAGE,
  PROMOTION_PIPELINE_FORMAT_VERSION,
  VERIFICATION_CHECKS,
  type ApprovedRecord,
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
  readonly artifactById: (artifactId: string) => ArtifactRecord | null;
  readonly attemptRoleById: (attemptId: string) => WorkerRole | null;
}

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
      case "VERIFIED":
        byStage.VERIFIED = r;
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

function refuse(offered: TransitionRecord, reasons: readonly PipelineRefusalReason[]): RefusedRecord {
  /* The refusal id derives from the offer's content as well as its reason codes, so a changed re-offer is a new refusal and an identical one dedupes. */
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

function approvalReasons(state: PipelineItemState, offered: ApprovedRecord): PipelineRefusalReason[] {
  const reasons: PipelineRefusalReason[] = [];
  const expect: readonly (readonly [PipelineStage, string])[] = [
    ["SCOUTED", offered.chain.scouted],
    ["VERIFIED", offered.chain.verified],
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
  /* The burdens the offer measured travel on the record; a FAIL refuses. */
  for (const burden of offered.burdens ?? []) {
    if (burden.result === "FAIL") reasons.push({ code: "APPROVAL_BURDEN_FAILED", detail: `${burden.name}: ${burden.detail}` });
  }
  return reasons;
}

/** Returns the accepted record, or a REFUSED record carrying every reason at once. */
export function validateTransition(
  state: PipelineItemState,
  offered: TransitionRecord,
  ctx: PipelineContext,
): { readonly ok: true; readonly record: TransitionRecord } | { readonly ok: false; readonly record: RefusedRecord } {
  const reasons: PipelineRefusalReason[] = [];
  const preceding = PRECEDING_STAGE[offered.stage];
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
  switch (offered.stage) {
    case "SCOUTED":
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
    case "APPROVED_FOR_PROMOTION":
      reasons.push(...approvalReasons(state, offered));
      break;
  }
  return reasons.length === 0 ? { ok: true, record: offered } : { ok: false, record: refuse(offered, reasons) };
}

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

/** A refusal is appended too. An identical re-offer of a held record is a no-op success. */
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

/** Keys holding no pipeline record are not items. */
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

/** The same states `readPipelineStates` derives for the matching items, read by key in batches. */
export async function readPipelineStatesWhere(repos: ControlPlaneRepositories,
  matches: readonly { readonly path: readonly string[]; readonly value: string }[]): Promise<PipelineItemState[]> {
  const log = repos.promotionPipeline;
  const keys = new Set<string>();
  for (const match of matches) for (const key of await log.keysWhere(match.path, match.value)) keys.add(key);
  const held = await readByKeys(log, [...keys].sort());
  const out: PipelineItemState[] = [];
  for (const key of [...held.keys()].sort()) {
    const records = held.get(key)!.filter(isPipelineRecord);
    if (records.length > 0) out.push(deriveItemState(key, records));
  }
  return out;
}

export function contextFromRecords(artifactRows: readonly ArtifactRecord[], attemptRows: readonly import("../attempt.ts").Attempt[],
  resultRows: readonly import("../workers/types.ts").WorkerResultRecord[]): PipelineContext {
  const artifacts = new Map(artifactRows.map(row => [row.artifactId, row]));
  const attempts = new Map(attemptRows.map(row => [row.id, row]));
  const results = new Map(resultRows.map(row => [row.id, row]));
  return {
    artifactById: id => artifacts.get(id) ?? null,
    attemptRoleById: id => attempts.get(id)?.worker.role ?? null,
    workerResultById: id => {
      const result = results.get(id);
      if (!result || attempts.get(result.attemptId)?.outcome !== "COMPLETED" ||
          canonicalJson(attempts.get(result.attemptId)) !== canonicalJson(result.completion.closedAttempt)) return null;
      try { assertFleetResult(result.result, result.completion.completedTask.workerTask!.role, result.attemptId); return result; }
      catch { return null; }
    },
  };
}

export async function contextFromRepositories(repos: ControlPlaneRepositories): Promise<PipelineContext> {
  const [artifacts, attempts, results] = await Promise.all([repos.artifacts.readAll(), repos.attempts.list(), repos.workerResults.readAll()]);
  return contextFromRecords(artifacts, attempts.map(row => row.value), results);
}

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

/** Method-store validation checks the store's shape, which is not the pipeline's VERIFIED. */
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

export interface StageCounts {
  readonly items: number;
  readonly byStage: Readonly<Record<PipelineStage, number>>;
  readonly refused: number;
  readonly byRecordClass: readonly { readonly recordClass: string; readonly items: number; readonly byStage: Readonly<Record<PipelineStage, number>>; readonly refused: number }[];
}

/** Counts by furthest stage reached. Every number's denominator is `items`. */
export function stageCounts(states: readonly PipelineItemState[]): StageCounts {
  const zero = (): Record<PipelineStage, number> => ({ SCOUTED: 0, VERIFIED: 0, APPROVED_FOR_PROMOTION: 0 });
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
