import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { BudgetSource } from "./government-budget-contract.ts";

/** Legal authorizations, payments and debt are distinct facts. These names
 * classify the publisher's own words; they never describe campaign money. */
export const GOVERNMENT_FINANCE_KINDS = {
  OPERATING_BUDGET: { label: "Operating budget", category: "BUDGET" },
  CAPITAL_BUDGET: { label: "Capital budget", category: "BUDGET" },
  APPROPRIATION: { label: "Appropriation", category: "BUDGET" },
  REVENUE: { label: "Revenue", category: "REVENUE" },
  TAX_LEVY: { label: "Tax levy", category: "TAX" },
  EXPENDITURE: { label: "Expenditure", category: "SPENDING" },
  PROCUREMENT_NOTICE: { label: "Procurement notice", category: "PROCUREMENT" },
  CONTRACT_AWARD: { label: "Contract award", category: "CONTRACT" },
  DEBT_AUTHORIZATION: { label: "Debt authorization", category: "DEBT" },
  DEBT_ISSUANCE: { label: "Debt issuance", category: "DEBT" },
  DEBT_OUTSTANDING: { label: "Debt outstanding", category: "DEBT" },
  AUDIT: { label: "Audit", category: "AUDIT" },
  GRANT_AWARD: { label: "Grant award", category: "GRANT" },
  GRANT_EXPENDITURE: { label: "Grant expenditure", category: "GRANT" },
} as const;
export type GovernmentFinanceKind = keyof typeof GOVERNMENT_FINANCE_KINDS;
export const GOVERNMENT_FINANCE_FIELDS = ["amount", "units", "fundScope", "fiscalPeriod", "budgetVersion", "rate", "taxBase",
  "adoptingAuthority", "effectiveDate", "geography", "payee", "category", "identifier", "scope", "authority", "deadline", "status",
  "awardee", "awardDate", "term", "amendments", "approvingAuthority", "repaymentPeriod", "ballotMeasureId",
  "issuingBody", "documentUrl", "findings", "response", "fundingSource", "recipient", "purpose", "publishedTotal"] as const;
export type GovernmentFinanceField = typeof GOVERNMENT_FINANCE_FIELDS[number];
export interface GovernmentFinanceFact extends BudgetSource, Readonly<Record<string, unknown>> {
  readonly kind: "GOVERNMENT_FINANCE";
  readonly detailKind: GovernmentFinanceKind;
  readonly category: typeof GOVERNMENT_FINANCE_KINDS[GovernmentFinanceKind]["category"];
  readonly title: string;
  readonly sourceHash: string;
  readonly details: Readonly<Partial<Record<GovernmentFinanceField, string | number | null>>>;
}
export function governmentFinanceKind(label: string): GovernmentFinanceKind | null {
  const normalize = (text: string) => text.toLowerCase().replaceAll("_", " ").replace(/\s+/g, " ").trim();
  return (Object.keys(GOVERNMENT_FINANCE_KINDS) as GovernmentFinanceKind[]).find(key =>
    [key, GOVERNMENT_FINANCE_KINDS[key].label].some(value => normalize(value) === normalize(label))) ?? null;
}
export function governmentFinanceIssue(value: unknown): string | null {
  const row = value as GovernmentFinanceFact;
  if (!row || row.kind !== "GOVERNMENT_FINANCE" || !row.id || !row.bodyId || !row.government?.trim() || !row.title?.trim() ||
    (!jurisdictionFromOcdId(row.ocdId) && row.ocdId !== "ocd-division/country:us") ||
    !/^https:\/\//.test(row.sourceUrl) || !/^[a-f0-9]{64}$/.test(row.sourceHash) || !row.sourceSentence?.trim() ||
    !Number.isFinite(Date.parse(row.capturedAt)) || !Object.hasOwn(GOVERNMENT_FINANCE_KINDS, row.detailKind) ||
    GOVERNMENT_FINANCE_KINDS[row.detailKind].category !== row.category || !row.details || typeof row.details !== "object" || Array.isArray(row.details)) {
    return "Government finance has no exact government, category or saved source identity.";
  }
  for (const [key, value] of Object.entries(row.details)) {
    if (!(GOVERNMENT_FINANCE_FIELDS as readonly string[]).includes(key) ||
      !(value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value)) ||
      ["amount", "rate", "publishedTotal"].includes(key) && value !== null && typeof value !== "number" ||
      key === "documentUrl" && value !== null && (typeof value !== "string" || !/^https:\/\//.test(value))) {
      return "Government finance contains an unsupported or unreadable filed detail.";
    }
  }
  return null;
}
