/**
 * THE HONEST MAPPING of existing evidence into the pipeline. (RULING 242.)
 *
 *   every persisted Scout result with outcome ROUTE_CANDIDATE or
 *   EVIDENCE_FOUND     -> SCOUTED (one item per candidate, one per finding set)
 *   every PROPOSED or VALIDATED method candidate -> SCOUTED (method-store
 *   validation is not the pipeline's VERIFIED, which needs CONFIRMED first)
 *   CONFIRMED          only where the artifact log holds an ACQUIRER-role
 *                      artifact at the same canonical URL from another Attempt
 *   nothing beyond     without an audit record, which no worker writes yet
 *
 * Idempotent: item and record ids are derived, so a re-map is a no-op.
 */

import type { ControlPlaneRepositories } from "../repository/types.ts";
import { canonicalJson } from "../repository/types.ts";
import type { ScoutResult } from "../scheduler/scout-result.ts";
import { readMethodCandidateStore } from "../scheduler/scout-candidates.ts";
import { readPromotionArtifacts } from "./evidence-reads.ts";
import {
  appendTransition,
  confirmationFromArtifacts,
  contextFromRepositories,
  readPipelineStates,
  scoutedFromMethodCandidate,
  scoutedFromScoutResult,
  stageCounts,
  type StageCounts,
} from "./pipeline.ts";
import type { PipelineItemState, ScoutedRecord } from "./types.ts";

/** Method-store lifecycle is not a new acquisition. Preserve the original
 * SCOUTED receipt when that is the only change; any evidence, identity or
 * source change still goes through the unchanged strict transition gate. */
function sameScoutedEvidence(held: ScoutedRecord, offered: ScoutedRecord): boolean {
  if (held.source.kind !== "METHOD_CANDIDATE" || offered.source.kind !== "METHOD_CANDIDATE") return canonicalJson(held) === canonicalJson(offered);
  return canonicalJson(held) === canonicalJson({ ...offered,
    source: { ...offered.source, lifecycle: held.source.lifecycle },
    summary: offered.summary.replace(`(${offered.source.lifecycle}):`, `(${held.source.lifecycle}):`),
  });
}

export interface MappingReport {
  readonly scoutResults: { readonly total: number; readonly refused: number; readonly eligible: number; readonly byOutcome: Readonly<Record<string, number>> };
  readonly methodCandidates: { readonly total: number; readonly eligible: number; readonly byLifecycle: Readonly<Record<string, number>>; readonly storeRead: boolean; readonly storeNote: string | null };
  readonly scouted: { readonly offered: number; readonly appended: number; readonly alreadyHeld: number; readonly refused: number };
  readonly confirmed: { readonly offered: number; readonly appended: number; readonly alreadyHeld: number; readonly refused: number; readonly candidatesWithUrl: number };
  readonly counts: StageCounts;
  readonly states: readonly PipelineItemState[];
}

export async function mapEvidenceIntoPipeline(
  repos: ControlPlaneRepositories,
  _root: string,
  now: string,
): Promise<MappingReport> {
  const results = await repos.scoutResults.readAll();
  const byOutcome: Record<string, number> = {};
  let refusedResults = 0;
  for (const r of results) {
    if (r.refusal !== null) refusedResults += 1;
    const k = r.refusal !== null ? `${r.outcome} (REFUSED)` : r.outcome;
    byOutcome[k] = (byOutcome[k] ?? 0) + 1;
  }
  const heldStates = new Map((await readPipelineStates(repos)).map(state => [state.itemId, state]));

  const scoutedOffers = results.flatMap(scoutedFromScoutResult);
  const eligibleResults = results.filter((r) => scoutedFromScoutResult(r).length > 0).length;

  const byLifecycle: Record<string, number> = {};
  let storeRead = false;
  let storeNote: string | null = null;
  let candidateTotal = 0;
  const resultsByAttempt = new Map<string, ScoutResult>(results.map((r) => [r.attemptId, r]));
  try {
    const store = await readMethodCandidateStore(repos);
    storeRead = true;
    candidateTotal = store.candidates.length;
    for (const c of store.candidates) {
      byLifecycle[c.lifecycle] = (byLifecycle[c.lifecycle] ?? 0) + 1;
      const offered = scoutedFromMethodCandidate(c, resultsByAttempt);
      if (offered !== null) scoutedOffers.push(offered);
    }
  } catch (error) {
    storeNote = `the canonical candidate store could not be read: ${error instanceof Error ? error.message : String(error)}`;
  }
  const eligibleCandidates = scoutedOffers.filter((o) => o.source.kind === "METHOD_CANDIDATE").length;

  // Held confirmations keep their durable evidence/date. Only unresolved
  // offers need same-URL acquisitions; no worker audit is evaluated by these
  // SCOUTED/CONFIRMED transitions.
  const pending = scoutedOffers.filter(offer => !heldStates.get(offer.itemId)?.byStage.CONFIRMED);
  const artifacts = await readPromotionArtifacts(repos, pending.flatMap(offer => offer.artifactIds),
    pending.flatMap(offer => offer.canonicalUrl === null ? [] : [offer.canonicalUrl]));
  const ctx = await contextFromRepositories(repos, { artifacts, results: [] });

  let scoutedAppended = 0;
  let scoutedHeld = 0;
  let scoutedRefused = 0;
  for (const offer of scoutedOffers) {
    const held = heldStates.get(offer.itemId)?.byStage.SCOUTED;
    if (held && sameScoutedEvidence(held, offer)) { scoutedHeld += 1; continue; }
    const out = await appendTransition(repos, offer, ctx, now);
    heldStates.set(offer.itemId, out.state);
    if (!out.accepted) scoutedRefused += 1;
    else if (out.appended) scoutedAppended += 1;
    else scoutedHeld += 1;
  }

  let confirmedOffered = 0;
  let confirmedAppended = 0;
  let confirmedHeld = 0;
  let confirmedRefused = 0;
  let withUrl = 0;
  for (const offer of scoutedOffers) {
    if (offer.canonicalUrl !== null) withUrl += 1;
    // Rebuilding a confirmation with today's clock changed its bytes while
    // retaining its id, creating STAGE_ALREADY_REACHED on every later pass.
    // The accepted confirmation is already durable evidence; keep its date.
    if (heldStates.get(offer.itemId)?.byStage.CONFIRMED) {
      confirmedOffered += 1;
      confirmedHeld += 1;
      continue;
    }
    const confirmation = confirmationFromArtifacts(offer, artifacts, ctx.attemptRoleById, now);
    if (confirmation === null) continue;
    confirmedOffered += 1;
    const out = await appendTransition(repos, confirmation, ctx, now);
    heldStates.set(offer.itemId, out.state);
    if (!out.accepted) confirmedRefused += 1;
    else if (out.appended) confirmedAppended += 1;
    else confirmedHeld += 1;
  }

  const states = [...heldStates.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
  return {
    scoutResults: { total: results.length, refused: refusedResults, eligible: eligibleResults, byOutcome },
    methodCandidates: { total: candidateTotal, eligible: eligibleCandidates, byLifecycle, storeRead, storeNote },
    scouted: { offered: scoutedOffers.length, appended: scoutedAppended, alreadyHeld: scoutedHeld, refused: scoutedRefused },
    confirmed: { offered: confirmedOffered, appended: confirmedAppended, alreadyHeld: confirmedHeld, refused: confirmedRefused, candidatesWithUrl: withUrl },
    counts: stageCounts(states),
    states,
  };
}

/** Lines for a console or a digest, every number with its denominator. */
export function mappingLines(report: MappingReport): string[] {
  const c = report.counts;
  const out = [
    `  scout results      ${report.scoutResults.eligible} of ${report.scoutResults.total} map to SCOUTED (ROUTE_CANDIDATE or EVIDENCE_FOUND, not refused); ` +
      `${report.scoutResults.refused} refused; by outcome ${Object.entries(report.scoutResults.byOutcome).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}`,
    `  method candidates  ${report.methodCandidates.eligible} of ${report.methodCandidates.total} map to SCOUTED` +
      (report.methodCandidates.storeRead
        ? ` (by lifecycle ${Object.entries(report.methodCandidates.byLifecycle).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`
        : ` — ${report.methodCandidates.storeNote}`),
    `  SCOUTED            ${report.scouted.offered} offered: ${report.scouted.appended} appended, ${report.scouted.alreadyHeld} already held, ${report.scouted.refused} refused`,
    `  CONFIRMED          ${report.confirmed.offered} of ${report.confirmed.candidatesWithUrl} scouted representations with a URL have a deterministic-lane artifact at the same canonical URL from another Attempt: ` +
      `${report.confirmed.appended} appended, ${report.confirmed.alreadyHeld} already held, ${report.confirmed.refused} refused`,
    `  by furthest stage  of ${c.items} item(s): SCOUTED ${c.byStage.SCOUTED}, CONFIRMED ${c.byStage.CONFIRMED}, VERIFIED ${c.byStage.VERIFIED}, ` +
      `AUDITED ${c.byStage.AUDITED}, APPROVED_FOR_PROMOTION ${c.byStage.APPROVED_FOR_PROMOTION}; ${c.refused} carry at least one refused offer`,
  ];
  for (const row of c.byRecordClass) {
    out.push(
      `      ${row.recordClass}: ${row.items} item(s) — SCOUTED ${row.byStage.SCOUTED}, CONFIRMED ${row.byStage.CONFIRMED}, VERIFIED ${row.byStage.VERIFIED}, ` +
        `AUDITED ${row.byStage.AUDITED}, APPROVED ${row.byStage.APPROVED_FOR_PROMOTION}, with a refused offer ${row.refused}`,
    );
  }
  return out;
}
