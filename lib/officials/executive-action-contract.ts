import { jurisdictionFromOcdId } from "../coverage/states.ts";

export const EXECUTIVE_ACTION_KINDS = {
  EXECUTIVE_ORDER: /\bexecutive order\b/i,
  BILL_SIGNED: /\b(?:signed|signs|approved by (?:the )?governor)\b/i,
  VETO: /\bveto(?:ed|es)?\b/i,
  BILL_ENACTED: /\b(?:enacted|chaptered|session law)\b/i,
  PROCLAMATION: /\bproclamation\b/i,
} as const;
export type ExecutiveActionFactKind = keyof typeof EXECUTIVE_ACTION_KINDS;
export interface ExecutiveActionFact {
  readonly id: string; readonly bodyId: string; readonly ocdId: string;
  readonly officeholderId: string; readonly officeholderName: string; readonly officeTitle: string;
  readonly kind: ExecutiveActionFactKind; readonly kindLabel: string; readonly designation: string;
  readonly title: string | null; readonly occurredAt: string | null;
  readonly sourceSentence: string; readonly sourceUrl: string; readonly documentUrl: string | null;
  readonly sourceOrg: string; readonly collectedAt: string; readonly sourceHash: string;
  readonly sourceKind: string;
}
export function executiveActionKind(words: string): ExecutiveActionFactKind | null {
  const kinds = (Object.keys(EXECUTIVE_ACTION_KINDS) as ExecutiveActionFactKind[]).filter(kind => EXECUTIVE_ACTION_KINDS[kind].test(words));
  return kinds.length === 1 ? kinds[0] : null;
}
export function executiveActionFactIssue(value: unknown): string | null {
  const row = value as ExecutiveActionFact;
  const jurisdiction = row && jurisdictionFromOcdId(row.ocdId);
  if (!row || !jurisdiction || row.ocdId !== `ocd-division/country:us/${jurisdiction.prefix}:${jurisdiction.slug}` ||
      !row.id || !row.bodyId || !row.officeholderId || !row.officeholderName?.trim() || !row.officeTitle?.trim() ||
      !row.designation?.trim() || !row.sourceSentence?.trim() || !row.sourceOrg?.trim() || !row.sourceKind ||
      !/^https:\/\//.test(row.sourceUrl) || !(row.documentUrl === null || /^https:\/\//.test(row.documentUrl)) ||
      !/^[a-f0-9]{64}$/.test(row.sourceHash) || !Number.isFinite(Date.parse(row.collectedAt))) return "Executive action lacks its exact state, holder and saved source identity.";
  if (executiveActionKind(row.kindLabel) !== row.kind || !EXECUTIVE_ACTION_KINDS[row.kind]?.test(row.sourceSentence) ||
      ![row.officeholderName, row.designation].every(word => row.sourceSentence.includes(word)) ||
      !(row.title === null || row.title.trim() && row.sourceSentence.includes(row.title))) return "Executive action is not stated in its saved source words.";
  if (row.occurredAt !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(row.occurredAt) || !Number.isFinite(Date.parse(row.occurredAt)) ||
      new Date(row.occurredAt).toISOString().slice(0, 10) !== row.occurredAt || !row.sourceSentence.includes(row.occurredAt))) return "Executive action date is not the valid date stated by its source.";
  return null;
}
