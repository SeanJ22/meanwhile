import { createHash } from "node:crypto";
import { campaignFinanceSource, type CampaignFinanceResource } from "./state-sources.ts";
import { campaignFinanceStateScope } from "./campaign-scopes.ts";

export interface CampaignSourceCapture {
  readonly storage: "CHUNK" | "ARCHIVE";
  readonly url: string;
  readonly rawHash: string;
  readonly vaultKey: string;
  readonly byteLength: number;
  readonly retrievedAt: string;
  readonly publicationDate: string | null;
  readonly archiveId?: string;
}
type Provenance = CampaignSourceCapture & { readonly publisher: string; readonly official: true; readonly sourcePublicationDate: string | null };

export interface CampaignSourceRecord {
  readonly id: string;
  readonly state: string;
  readonly resource: string;
  readonly nativeId: string | null;
  readonly projectionOrdinal: number;
  readonly committeeId: string | null;
  readonly committeeName: string | null;
  readonly candidateName: string | null;
  readonly organizationName: string | null;
  readonly filingUrl: string;
  readonly office: string | null;
  readonly period: string | null;
  readonly transactionDate: string | null;
  readonly nativeGovernmentId: string | null;
  readonly governmentOcdId: string | null;
  readonly amounts: readonly { readonly label: string; readonly amount: number; readonly provenance?: Provenance }[];
  readonly invalidAmounts: readonly string[];
  readonly title: string | null;
  readonly qualifiers: readonly { readonly label: string; readonly value: string }[];
  readonly issues: readonly string[];
  readonly unjoinedReason: string | null;
  readonly provenance: Provenance;
}

export const CAMPAIGN_FINANCE_JOIN_REASONS = {
  missingId: "The source row has no mapped native record ID; its captured bytes remain held.",
  missingCommittee: "The filing has no supported source-native committee binding.",
  conflictingCover: "The source cover records conflict for this native filing.",
  unboundGovernment: "The source-native filing has no independently bound local government ID.",
} as const;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const cell = (value: unknown) => typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
function first(row: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) { const value = cell(row[field]); if (value) return value; }
  return null;
}

export function campaignSourceRecord(state: string, resource: CampaignFinanceResource, row: Record<string, unknown>, capture: CampaignSourceCapture, projectionOrdinal = 0): CampaignSourceRecord {
  const source = campaignFinanceSource(state);
  const keys = resource.identity.map(field => cell(row[field]));
  const nativeId = keys.length && keys.every(Boolean) ? keys.length === 1 ? keys[0] : JSON.stringify(keys) : null;
  const committeeId = first(row, resource.committee);
  const provenance: Provenance = { ...capture, publicationDate: first(row, resource.publicationDate), sourcePublicationDate: capture.publicationDate, publisher: resource.publisher ?? source.publisher, official: true };
  const amounts: CampaignSourceRecord["amounts"][number][] = [];
  const invalidAmounts: string[] = [];
  const issues: string[] = [];
  if (typeof row.__sourceRowIssue === "string") issues.push(row.__sourceRowIssue);
  if (row.__ambiguousLookup === true) issues.push("Source cover records disagree for this filing; its native rows remain held.");
  for (const { field, label } of resource.amounts) {
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    if (!cell(value)) continue;
    const text = cell(value).replace(/^\$/, "").replaceAll(",", "");
    if (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) { issues.push(`The filed ${field} amount is unreadable; its source bytes remain held.`); invalidAmounts.push(label); continue; }
    amounts.push({ label, amount: Number(text) });
  }
  const governmentOcdId = resource.governmentOcdId ?? null;
  const summary = resource.summaryLine;
  const organization = resource.organization;
  let filingUrl = resource.landingUrl ?? capture.url;
  if (resource.filingUrl && cell(row[resource.filingUrl.field])) {
    try {
      const url = new URL(cell(row[resource.filingUrl.field]));
      if (url.protocol === "https:" && resource.filingUrl.hosts.includes(url.hostname)) filingUrl = url.href;
    } catch { issues.push("The filed document link is unreadable; the source extract remains linked."); }
  }
  if (governmentOcdId && campaignFinanceStateScope(governmentOcdId) !== `US-${state}:campaign-finance`) throw new Error("The campaign resource crosses its state's boundary.");
  return {
    id: `${state}:${resource.id}:${hash(nativeId ?? JSON.stringify([capture.url, capture.archiveId, projectionOrdinal, row]))}`,
    state, resource: resource.id, nativeId, projectionOrdinal, committeeId,
    committeeName: resource.committeeNameParts?.map(field => cell(row[field])).filter(Boolean).join(" ") || first(row, resource.committeeName),
    candidateName: resource.candidateCondition && !resource.candidateCondition.values.includes(cell(row[resource.candidateCondition.field])) ? null
      : resource.candidateParts?.map(field => cell(row[field])).filter(Boolean).join(" ") || first(row, resource.candidate),
    organizationName: organization?.types.includes(cell(row[organization.typeField])) ? first(row, organization.nameFields) : null,
    filingUrl,
    office: first(row, resource.office), period: resource.periodParts?.map(field => cell(row[field])).filter(Boolean).join(" – ") || first(row, resource.period),
    transactionDate: first(row, resource.transactionDate), nativeGovernmentId: first(row, resource.government),
    governmentOcdId, amounts, invalidAmounts, issues,
    title: summary?.labels[cell(row[summary.formField])]?.[cell(row[summary.lineField])] ?? null,
    qualifiers: (resource.qualifiers ?? []).flatMap(({ field, label }) => {
      const value = typeof row[field] === "boolean" ? String(row[field]) : cell(row[field]);
      return value ? [{ label, value }] : [];
    }),
    unjoinedReason: !nativeId ? CAMPAIGN_FINANCE_JOIN_REASONS.missingId
      : row.__ambiguousLookup === true ? CAMPAIGN_FINANCE_JOIN_REASONS.conflictingCover
      : !committeeId ? CAMPAIGN_FINANCE_JOIN_REASONS.missingCommittee
      : !governmentOcdId ? CAMPAIGN_FINANCE_JOIN_REASONS.unboundGovernment : null,
    provenance,
  };
}

export function campaignSourceRecordHash(row: CampaignSourceRecord): string {
  const { provenance, amounts, projectionOrdinal: _projectionOrdinal, ...native } = row;
  return hash(JSON.stringify({ ...native, amounts: amounts.map(({ provenance: own, ...amount }) => ({ ...amount,
    publicationDate: (own ?? provenance).publicationDate, publisher: (own ?? provenance).publisher })), publicationDate: provenance.publicationDate, publisher: provenance.publisher }));
}
