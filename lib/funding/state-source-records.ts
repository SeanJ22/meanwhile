import { createHash } from "node:crypto";
import { canonicalCivicDataJson } from "../civic-data/changes.ts";
import { campaignFinanceSource, type CampaignFinanceResource } from "./state-sources.ts";
import { campaignFinanceStateScope } from "./campaign-scopes.ts";

export interface CampaignSourceCapture {
  readonly url: string;
  readonly rawHash: string;
  readonly vaultKey: string;
  readonly byteLength: number;
  readonly retrievedAt: string;
  readonly publicationDate: string | null;
  readonly lookup?: { readonly url: string; readonly rawHash: string; readonly vaultKey: string; readonly byteLength: number; readonly retrievedAt: string; readonly publicationDate: string | null };
}
type Provenance = CampaignSourceCapture & { readonly publisher: string; readonly official: true; readonly sourcePublicationDate: string | null };

export interface CampaignSourceRecord {
  readonly id: string;
  readonly state: string;
  readonly resource: string;
  readonly nativeId: string | null;
  readonly nativeIdScope: "SOURCE" | "PUBLICATION" | null;
  readonly projectionOrdinal: number;
  readonly filerId: string | null;
  readonly filerName: string | null;
  readonly filingState: "FILED" | "UNFILED" | "ACTIVITY_UNCONFIRMED";
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
  missingFiler: "The filing has no supported source-native filer binding.",
  conflictingCover: "The source cover records conflict for this native filing.",
  unboundGovernment: "The source-native filing has no independently bound local government ID.",
} as const;

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const cell = (value: unknown) => typeof value === "string" ? value.trim() : (typeof value === "number" && Number.isFinite(value) || typeof value === "boolean") ? String(value) : "";
function first(row: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const field of fields) { const value = cell(row[field]); if (value) return value; }
  return null;
}
function identity(row: Record<string, unknown>, fields: readonly string[]): string | null {
  const values = fields.map(field => cell(row[field]));
  return values.length && values.every(Boolean) ? values.length === 1 ? values[0] : JSON.stringify(values) : null;
}
function date(row: Record<string, unknown>, fields: readonly string[], resource: CampaignFinanceResource): string | null {
  const value = first(row, fields);
  if (value === null || !resource.dateEncoding) return value;
  const encoded = resource.dateEncoding === "DOTNET_MILLISECONDS" ? /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value)?.[1] : value;
  const numeric = encoded === undefined ? NaN : Number(encoded);
  if (!Number.isFinite(numeric) || !Number.isFinite(new Date(numeric).getTime())) throw new Error("The source date is not a valid epoch timestamp.");
  return new Date(numeric).toISOString();
}

export function campaignSourceRecord(state: string, resource: CampaignFinanceResource, row: Record<string, unknown>, capture: CampaignSourceCapture, projectionOrdinal = 0): CampaignSourceRecord {
  const source = campaignFinanceSource(state);
  if (resource.rowObject) {
    const nested = resource.rowObject.split(".").reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined, row);
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) throw new Error("The source row is missing its declared native field object.");
    row = nested as Record<string, unknown>;
  }
  const nativeId = identity(row, resource.identity);
  const filerId = resource.filerIdentity ? identity(row, resource.filerIdentity) : first(row, resource.filer);
  const provenance: Provenance = { ...capture, publicationDate: date(row, resource.publicationDate, resource),
    sourcePublicationDate: date(row, resource.sourcePublicationDate ?? [], resource) ?? capture.publicationDate, publisher: resource.publisher ?? source.publisher, official: true };
  const amounts: CampaignSourceRecord["amounts"][number][] = [];
  const invalidAmounts: string[] = [];
  const issues: string[] = [];
  if (!nativeId) issues.push(CAMPAIGN_FINANCE_JOIN_REASONS.missingId);
  if (!filerId) issues.push(CAMPAIGN_FINANCE_JOIN_REASONS.missingFiler);
  if (resource.filedCondition && !(resource.filedCondition.field in row)) throw new Error("The source row is missing its filing status column.");
  const filed = !resource.filedCondition || resource.filedCondition.values.includes(cell(row[resource.filedCondition.field]));
  const registrationOnly = Boolean(resource.financialReportCondition && !resource.financialReportCondition.values.includes(cell(row[resource.financialReportCondition.field]))) || !!resource.filedStatementField && !(Number(cell(row[resource.filedStatementField])) > 0) ||
    (resource.registrationTotals?.length ?? 0) > 0 && resource.registrationTotals!.every(field => {
    const value = cell(row[field]).replace(/^\$/, "").replaceAll(",", "");
    return /^-?0+(?:\.0+)?$/.test(value);
  });
  if (!filed) issues.push("The source has not marked this row as filed; its amounts remain in the saved source.");
  if (registrationOnly) issues.push("The index does not establish a filed financial report; its registration details remain held.");
  if (typeof row.__sourceRowIssue === "string") issues.push(row.__sourceRowIssue);
  if (row.__ambiguousLookup === true) issues.push("Source cover records disagree for this filing; its native rows remain held.");
  for (const { field, label } of resource.amounts) {
    if (!filed || registrationOnly) continue;
    const value = row[field];
    if (value === undefined || value === null || value === "") continue;
    if (!cell(value)) continue;
    const text = cell(value).replace(/^\$/, "").replaceAll(",", "");
    if (!/^-?\d+(?:\.\d+)?$/.test(text) || !Number.isFinite(Number(text))) { issues.push(`The filed ${field} amount is unreadable; its source bytes remain held.`); invalidAmounts.push(label); continue; }
    amounts.push({ label, amount: Number(text) });
  }
  const governmentOcdId = resource.governmentOcdId ?? null;
  const period = resource.periodParts?.map(field => cell(row[field])).filter(Boolean).join(" – ") || first(row, resource.period);
  const periodContext = resource.periodQueryParameter ? new URL(capture.url).searchParams.get(resource.periodQueryParameter) : null;
  if (resource.periodQueryParameter && !/^\d{4}$/.test(periodContext ?? "")) throw new Error("The source export is missing its declared report year.");
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
  const publicationScoped = resource.identityScope === "PUBLICATION";
  const contentIdentity = publicationScoped ? Object.fromEntries(Object.entries(row).filter(([field]) =>
    !resource.identity.includes(field) && !resource.sourcePublicationDate?.includes(field))) : row;
  return {
    id: `${state}:${resource.id}:${hash(publicationScoped || nativeId === null ? canonicalCivicDataJson(contentIdentity) : nativeId)}`,
    state, resource: resource.id, nativeId, nativeIdScope: nativeId === null ? null : publicationScoped ? "PUBLICATION" : "SOURCE",
    projectionOrdinal, filerId, filingState: !filed ? "UNFILED" : registrationOnly ? "ACTIVITY_UNCONFIRMED" : "FILED",
    filerName: resource.filerNameParts?.map(field => cell(row[field])).filter(Boolean).join(" ") || first(row, resource.filerName),
    candidateName: resource.candidateCondition && !resource.candidateCondition.values.includes(cell(row[resource.candidateCondition.field])) ? null
      : resource.candidateParts?.map(field => cell(row[field])).filter(Boolean).join(" ") || first(row, resource.candidate),
    organizationName: organization?.types.includes(cell(row[organization.typeField])) ? first(row, organization.nameFields) : null,
    filingUrl,
    office: first(row, resource.office), period: [periodContext, period].filter(Boolean).join(" – ") || null,
    transactionDate: date(row, resource.transactionDate, resource), nativeGovernmentId: first(row, resource.government),
    governmentOcdId, amounts, invalidAmounts, issues,
    title: summary?.labels[cell(row[summary.formField])]?.[cell(row[summary.lineField])] ?? null,
    qualifiers: (resource.qualifiers ?? []).flatMap(({ field, label }) => {
      const value = typeof row[field] === "boolean" ? String(row[field]) : cell(row[field]);
      return value ? [{ label, value }] : [];
    }),
    unjoinedReason: governmentOcdId ? null : !nativeId ? CAMPAIGN_FINANCE_JOIN_REASONS.missingId
      : row.__ambiguousLookup === true ? CAMPAIGN_FINANCE_JOIN_REASONS.conflictingCover
      : !filerId ? CAMPAIGN_FINANCE_JOIN_REASONS.missingFiler
      : !governmentOcdId ? CAMPAIGN_FINANCE_JOIN_REASONS.unboundGovernment : null,
    provenance,
  };
}

export function campaignSourceRecordHash(row: CampaignSourceRecord): string {
  const { provenance, amounts, projectionOrdinal: _projectionOrdinal, ...native } = row;
  return hash(JSON.stringify({ ...native, nativeId: row.nativeIdScope === "PUBLICATION" ? null : row.nativeId, amounts: amounts.map(({ provenance: own, ...amount }) => ({ ...amount,
    publicationDate: (own ?? provenance).publicationDate, publisher: (own ?? provenance).publisher })), publicationDate: provenance.publicationDate, publisher: provenance.publisher }));
}
