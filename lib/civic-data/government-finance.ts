import { createHash } from "node:crypto";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import type { BudgetSource } from "./government-budgets.ts";

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
/** Shared by worker and national code readers. Callers supply only fields
 * independently read from this government and the complete original capture. */
export function governmentFinanceFact(input: Omit<BudgetSource, "id"> & Pick<GovernmentFinanceFact, "detailKind" | "title" | "sourceHash" | "details">): GovernmentFinanceFact {
  const row: GovernmentFinanceFact = { ...input, kind: "GOVERNMENT_FINANCE", category: GOVERNMENT_FINANCE_KINDS[input.detailKind].category,
    id: `government-finance:${createHash("sha256").update(JSON.stringify([input.bodyId, input.detailKind, input.title,
      input.details.fiscalPeriod ?? null, input.details.identifier ?? null, input.details.fundScope ?? null, input.details.budgetVersion ?? null,
      input.details.category ?? null, input.sourceUrl])).digest("hex")}` };
  const issue = governmentFinanceIssue(row);
  if (issue) throw new Error(issue);
  return row;
}

/** Existing checklist requirements only. Missing cells never hold the fact
 * back from publication; they remain blank in the corresponding scorecard. */
export function governmentFinanceChecklistEvidence(records: readonly GovernmentFinanceFact[], bodyId: string) {
  const held = records.filter(row => row.bodyId === bodyId && governmentFinanceIssue(row) === null);
  const has = (row: GovernmentFinanceFact, ...keys: GovernmentFinanceField[]) => keys.every(key =>
    typeof row.details[key] === "number" || typeof row.details[key] === "string" && Boolean(String(row.details[key]).trim()));
  const matching = (kinds: readonly GovernmentFinanceKind[], ...fields: GovernmentFinanceField[]) => held.filter(row => kinds.includes(row.detailKind) && has(row, ...fields));
  const budgets = matching(["OPERATING_BUDGET", "CAPITAL_BUDGET"], "amount", "units", "fundScope", "fiscalPeriod", "budgetVersion")
    .filter(row => /\badopted\b/i.test(row.sourceSentence) && !/\b(?:proposed|draft|recommended)\b/i.test(row.sourceSentence));
  // Both kinds must share an explicitly stated period, fund and unit. No addition or share is presented.
  const pairedBudgets = budgets.filter(row => budgets.some(other => other.detailKind !== row.detailKind &&
    ["units", "fundScope", "fiscalPeriod"].every(key => row.details[key as GovernmentFinanceField] === other.details[key as GovernmentFinanceField])));
  const revenues = matching(["REVENUE"], "amount", "units", "fundScope", "fiscalPeriod", "category", "identifier", "publishedTotal");
  const revenueGroups = new Map<string, GovernmentFinanceFact[]>();
  for (const row of revenues) {
    const key = JSON.stringify([row.sourceUrl, row.details.identifier, row.details.units, row.details.fundScope, row.details.fiscalPeriod]);
    revenueGroups.set(key, [...(revenueGroups.get(key) ?? []), row]);
  }
  const reconciled = [...revenueGroups.values()].filter(rows => {
    if (new Set(rows.map(row => row.details.category)).size !== rows.length ||
      new Set(rows.map(row => row.details.publishedTotal)).size !== 1) return false;
    // Decimal comparison checks the publisher's identity; it emits no computed total or share.
    const decimal = (value: number) => {
      const [coefficient, exponent = "0"] = String(value).split("e");
      const fraction = coefficient.split(".")[1]?.length ?? 0;
      return { integer: BigInt(coefficient.replace(".", "")), scale: fraction - Number(exponent) };
    };
    const values = [...rows.map(row => decimal(row.details.amount as number)), decimal(rows[0].details.publishedTotal as number)];
    const scale = Math.max(...values.map(value => value.scale));
    const integers = values.map(value => value.integer * BigInt(10) ** BigInt(scale - value.scale));
    return integers.slice(0, -1).reduce((sum, value) => sum + value, BigInt(0)) === integers.at(-1);
  }).flat();
  return {
    "FIN-06": pairedBudgets,
    "FIN-07": matching(["APPROPRIATION"], "amount", "units", "fiscalPeriod", "authority"),
    "FIN-08": reconciled,
    "FIN-09": matching(["TAX_LEVY"], "rate", "taxBase", "adoptingAuthority", "effectiveDate", "geography"),
    "FIN-10": matching(["EXPENDITURE"], "amount", "units", "fiscalPeriod", "payee", "fundScope", "category"),
    "FIN-11": matching(["PROCUREMENT_NOTICE"], "identifier", "scope", "authority", "deadline", "status"),
    "FIN-12": matching(["CONTRACT_AWARD"], "awardee", "amount", "units", "awardDate", "term", "amendments", "approvingAuthority"),
    "FIN-13": matching(["DEBT_AUTHORIZATION", "DEBT_ISSUANCE", "DEBT_OUTSTANDING"], "amount", "units", "repaymentPeriod", "ballotMeasureId"),
    "FIN-14": matching(["AUDIT"], "fiscalPeriod", "issuingBody", "documentUrl", "findings", "response", "status"),
    "FIN-15": matching(["GRANT_AWARD", "GRANT_EXPENDITURE"], "amount", "units", "fundingSource", "recipient", "fiscalPeriod", "purpose"),
    "FIN-16": held,
  } as const;
}
