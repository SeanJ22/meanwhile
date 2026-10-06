import { newFieldManualEntry, type FieldManualEntry } from "./field-manual.ts";
import type { ScoutResult } from "./scheduler/scout-result.ts";

export const EXHAUSTED_RUNGS = "EXHAUSTED_RUNGS";

/** A stopped walk is knowledge about this subject, never evidence that its information does not exist. */
export function exhaustedRungEntries(result: ScoutResult, states: readonly string[] = []): FieldManualEntry[] {
  // Historic envelopes may have an empty refusal array and no rung list.
  const refused = Array.isArray(result.refusal) && result.refusal.length > 0;
  if (!refused && result.outcome !== "NO_PROGRESS") return [];
  const role = result.researchRole ?? "SCOUT";
  const nextRungs = result.nextRungs ?? [];
  const reasons = result.refusal?.map(issue => `${issue.code}: ${issue.detail}`) ?? [];
  const tried = (result.rungs ?? []).map(rung => ({ ...rung,
    // A successful HTTP read may still leave the fact blank. Keep transport and progress separate.
    whyNoProgress: rung.ok === false ? rung.observed : rung.note ?? "Tool returned; progress was not established by an accepted finish",
  }));
  return [newFieldManualEntry("exhausted-rungs", result.attemptId, {
    role: "SHARED", kind: EXHAUSTED_RUNGS, title: "Exhausted on these rungs",
    summary: `${role} ${result.stoppedBy ?? "stop not recorded"}; ${reasons.length ? "finish refused" : "no progress"}. ${tried.length} rungs tried. Resume with ${nextRungs.join("; ") || "a different route or changed evidence"}; read the saved rung reasons.`,
    states, recordClasses: [result.recordClass],
    ...(result.subjectId.startsWith("ocd-division/") ? { ocdIds: [result.subjectId.split("#")[0]!] } : {}),
    foundBy: role, observedAt: result.recordedAt, outcome: "REFERENCE",
    payload: { subjectId: result.subjectId, obligationId: result.obligationId, attemptId: result.attemptId,
      recordClass: result.recordClass, role, stoppedBy: result.stoppedBy, refusal: result.refusal,
      rungs: tried, nextRungs, unverified: result.unverified,
      instruction: "Use the saved evidence and continue beyond these attempts. Revisit only with changed evidence or conditions; this is not an absence finding.",
    },
  })];
}
