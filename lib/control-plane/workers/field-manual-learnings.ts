/**
 * **WHAT A DETECTIVE OR ENGINEER LEARNED, TURNED INTO A FIELD-MANUAL ENTRY.**
 * (Owner directive 2026-09-19.)
 *
 * A detective already emits a `learnedProcedure` and an engineer a set of
 * `proposedFiles`, and until now both went only into `cp_log_worker_results` —
 * a result log no worker reads. That is the same write-with-no-read gap the
 * scouts had, one role over. This module maps those emitted learnings onto the
 * common `FieldManualEntry` envelope so the research runtime can write them
 * straight into the one growing manual, live, with no human step. Pure and
 * deterministic so the mapping is tested without a scheduler or a database.
 *
 * Grain and keys:
 * - A DETECTIVE learning is keyed by its **question id**, so re-investigating
 *   the same bounded question refreshes one row rather than forking it. A
 *   SUPPORTED conclusion is a settled fact every role inherits, so it lands
 *   SHARED; an unresolved investigation's reusable procedure stays in the
 *   detective lane.
 * - An ENGINEERING learning is keyed by its **method route id**. The manual
 *   carries the POINTER — the candidate's paths, adoption gate, reproducibility
 *   and risks — never the proposed file bytes, which stay in the candidate
 *   store.
 */

import {
  fieldManualEntryId,
  type FieldManualEntry,
  type FieldManualOutcome,
  type FieldManualRole,
} from "../field-manual.ts";
import type { FleetResult } from "./types.ts";

export const DETECTIVE_LEARNING_SOURCE = "detective-learning";
export const ENGINEERING_CANDIDATE_SOURCE = "engineering-candidate";

const OCD_STATE = /state:([a-z]{2})\b/i;

/** The two-letter state(s) a detective question is about, from its OCD jurisdiction or subject. Empty = portable. */
function statesFor(...values: (string | null | undefined)[]): string[] {
  const out = new Set<string>();
  for (const value of values) {
    if (!value) continue;
    const match = OCD_STATE.exec(value);
    if (match) out.add(match[1]!.toLowerCase());
  }
  return [...out];
}

function observedDay(now: string): string | null {
  return /^\d{4}-\d{2}-\d{2}/.test(now) ? now.slice(0, 10) : null;
}

/**
 * The field-manual entries a completed research result carries forward. Empty
 * for roles that emit no learned artifact (an acquirer's records go through the
 * vault, not here). Never throws — a malformed result yields no entry rather
 * than failing the worker whose result already stands.
 */
export function researchLearningEntries(result: FleetResult, now: string): FieldManualEntry[] {
  const observedAt = observedDay(now);

  if (result.role === "DETECTIVE") {
    const question = result.question;
    if (!question?.id) return [];
    const supported = result.verdict === "SUPPORTED";
    const outcome: FieldManualOutcome =
      supported ? "YIELDED" : result.verdict === "CONTRADICTED" ? "FAILED" : "REFERENCE";
    // A settled jurisdiction/identity fact is shared knowledge (a scout finding
    // helps the parser and validator too); an open question's procedure is the
    // detective's own lane until it settles.
    const role: FieldManualRole = supported ? "SHARED" : "DETECTIVE";
    const canonical = result.identity.state === "CANDIDATE" ? result.identity.canonicalId : null;
    return [
      {
        id: fieldManualEntryId(DETECTIVE_LEARNING_SOURCE, question.id),
        role,
        kind: "DETECTIVE_RESOLUTION",
        title: question.text.slice(0, 200),
        summary: `${result.verdict}${canonical ? ` → ${canonical}` : ""}: ${result.conclusion}`.slice(0, 300),
        states: statesFor(question.jurisdiction, question.subjectId),
        recordClasses: question.recordClass ? [question.recordClass] : [],
        platforms: [],
        foundBy: "DETECTIVE",
        outcome,
        url: null,
        source: DETECTIVE_LEARNING_SOURCE,
        observedAt,
        tier: null,
        payload: {
          questionId: question.id,
          questionKind: question.kind,
          subjectId: question.subjectId,
          jurisdiction: question.jurisdiction,
          recordClass: question.recordClass,
          verdict: result.verdict,
          conclusion: result.conclusion,
          identity: result.identity,
          nextAction: result.nextAction,
          learnedProcedure: result.learnedProcedure,
        },
      },
    ];
  }

  if (result.role === "ENGINEERING") {
    if (!result.methodRouteId) return [];
    const proved = result.verdict === "CANDIDATE_PROVED";
    return [
      {
        id: fieldManualEntryId(ENGINEERING_CANDIDATE_SOURCE, result.methodRouteId),
        role: "ENGINEER",
        kind: "ENGINEERING_CANDIDATE",
        title: result.methodRouteId,
        summary:
          `${result.verdict}; ${result.adoption}; proposes ${result.affectedPaths.length} file(s) held in the candidate store; ` +
          `${result.unresolvedRisks.length} unresolved risk(s)`,
        states: [],
        recordClasses: [],
        platforms: [],
        // A proved candidate is a REFERENCE pointer to code under review, never a live door; a
        // failed or refused proof is a dead door, kept so it is not rebuilt.
        outcome: proved ? "REFERENCE" : "FAILED",
        url: null,
        source: ENGINEERING_CANDIDATE_SOURCE,
        observedAt,
        tier: null,
        payload: {
          methodRouteId: result.methodRouteId,
          methodVersion: result.methodVersion,
          verdict: result.verdict,
          adoption: result.adoption,
          affectedPaths: result.affectedPaths,
          reproducibility: result.reproducibility.verdict,
          unresolvedRisks: result.unresolvedRisks,
          learnedProcedure: result.learnedProcedure,
          // The proposed file bytes stay in the candidate store; the manual holds the pointer.
        },
      },
    ];
  }

  return [];
}
