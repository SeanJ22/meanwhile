import { actionsFor, actionText, executiveActionStore, type ExecutiveAction } from "./executive-actions.ts";
import { candidacyOfficialIdentityStatus, currentOfficialIdentity, currentOfficialIdentityStatus, officialIdsForCandidacy } from "../funding/campaign-money.ts";
import { azLineupReconciliation, reconciledCandidacyIdForCard } from "../identity/az-2026.ts";
import { currentStatewideExecutives } from "./statewide-executives.ts";
import { stateExecutiveActionsFor } from "./executive-action-reader.ts";
import type { PromotedCivicDataReadOptions } from "../civic-data/read-model.ts";

/** The exact held executive slot and source name select only that state's
 * independent action family. A successor never inherits a predecessor's acts. */
export async function generalActionsForOfficial(officialId: string, name: string, options: PromotedCivicDataReadOptions = {}) {
  const held = currentStatewideExecutives().filter(row => row.holder.id === officialId && row.holder.name === name);
  if (held.length !== 1) return [];
  return stateExecutiveActionsFor({ division: held[0].stateOcdId, officialId, name }, options);
}

export async function generalOfficialActionsForTarget(subjectId: string): Promise<ReaderOfficialActions | null> {
  const officialIds = subjectId.startsWith("ballot-") ? officialIdsForCandidacy(subjectId)
    : [subjectId];
  const records: ReaderOfficialAction[] = [];
  for (const id of officialIds) {
    const held = currentStatewideExecutives().filter(row => row.holder.id === id);
    if (held.length !== 1) continue;
    for (const row of await generalActionsForOfficial(id, held[0].holder.name)) records.push({ id: row.id, officialId: id, kind: row.kind,
      text: row.sourceSentence, sourceUrl: row.sourceUrl, documentUrl: row.documentUrl, sourceOrg: row.sourceOrg, collectedAt: row.collectedAt,
      sourceKind: row.sourceKind });
  }
  return records.length ? { subjectId, officialIds, resolvedTargetId: subjectId, status: "RESOLVED", withheldRecords: [], count: records.length, records } : null;
}

export interface ReaderOfficialAction {
  id: string;
  officialId: string;
  kind: ExecutiveAction["kind"];
  text: string;
  sourceUrl: string;
  documentUrl: string | null;
  sourceOrg: string;
  collectedAt: string;
  sourceKind?: string;
}
export interface ReaderOfficialActions {
  subjectId: string;
  officialIds: string[];
  resolvedTargetId: string | null;
  status: "RESOLVED" | "IDENTITY_UNRESOLVED" | "NO_APPLICABLE_OFFICIAL" | "NOT_HELD";
  withheldRecords: { id: string; reason: string }[];
  count: number;
  records: ReaderOfficialAction[];
}

/** Same held selection and factual sentence as Ask; never match a person by name. */
export function officialActionsForTarget(subjectId: string): ReaderOfficialActions {
  let resolvedTargetId: string | null = subjectId;
  if (subjectId.startsWith("ballot-az-") && subjectId.includes("|")) {
    if (!azLineupReconciliation()) throw new Error("The certified candidacy identity holding is unavailable");
    resolvedTargetId = reconciledCandidacyIdForCard(subjectId);
  }
  const officialIds = resolvedTargetId?.startsWith("ballot-")
    ? officialIdsForCandidacy(resolvedTargetId)
    : resolvedTargetId && currentOfficialIdentity(resolvedTargetId) ? [resolvedTargetId] : [];
  const result: ReaderOfficialActions = { subjectId, resolvedTargetId, officialIds,
    status: resolvedTargetId === null || (resolvedTargetId.startsWith("ballot-") ? candidacyOfficialIdentityStatus(resolvedTargetId) : currentOfficialIdentityStatus(resolvedTargetId)) === "IDENTITY_UNRESOLVED" ? "IDENTITY_UNRESOLVED" : "NO_APPLICABLE_OFFICIAL",
    count: 0, records: [], withheldRecords: [] };
  if (!officialIds.length) return result;
  if (!executiveActionStore()) throw new Error("The held official-action store is unavailable");
  for (const officialId of officialIds) {
    const current = currentOfficialIdentity(officialId);
    for (const action of actionsFor(officialId)) {
      // Slot identity alone cannot give a successor a predecessor's actions.
      // Exact source identity agreement validates a committed join; no search.
      if (!current || action.officeholderName !== current.name) {
        result.withheldRecords.push({ id: action.id, reason: "The current person identity does not agree with the held action's official identity" });
        continue;
      }
      if (!action.sourceUrl || !action.sourceOrg || !action.collectedAt) throw new Error("Held official-action provenance is unavailable");
      result.records.push({ id: action.id, officialId, kind: action.kind,
        text: actionText(action), sourceUrl: action.sourceUrl, documentUrl: action.documentUrl,
        sourceOrg: action.sourceOrg, collectedAt: action.collectedAt });
    }
  }
  result.count = result.records.length;
  result.status = result.status === "IDENTITY_UNRESOLVED" || result.withheldRecords.length ? "IDENTITY_UNRESOLVED" : result.count ? "RESOLVED" : "NOT_HELD";
  return result;
}
