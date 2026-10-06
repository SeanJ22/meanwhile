import { createHash } from "node:crypto";
import { GOVERNMENT_FINANCE_KINDS, governmentFinanceIssue, type GovernmentFinanceFact } from "./government-finance-contract.ts";
import type { BudgetSource } from "./government-budget-contract.ts";

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

export * from "./government-finance-contract.ts";
