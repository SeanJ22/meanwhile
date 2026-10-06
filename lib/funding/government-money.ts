import { governmentBudgetIssue, type GovernmentBudgetFact } from "../civic-data/government-budget-contract.ts";
import { GOVERNMENT_FINANCE_KINDS } from "../civic-data/government-finance-contract.ts";
import type { CardSource } from "../officials/card-sources.ts";

export interface GovernmentMoneyRow { readonly id: string; readonly label: string; readonly text: string; readonly period: string | null }
/** Preserve each filed category, amount, unit and period in its own source
 * sentence. The reader never adds categories or converts source units. */
export function governmentMoneyView(records: readonly GovernmentBudgetFact[], bodyId: string, divisionId: string) {
  const held = records.filter(row => row.bodyId === bodyId && row.ocdId === divisionId && !governmentBudgetIssue(row));
  const visible = held.filter(row => row.kind !== "BUDGET_RESPONSIBILITY");
  const rows: GovernmentMoneyRow[] = visible.map(row => ({id:row.id,
    label:row.kind === "GOVERNMENT_FINANCE" ? GOVERNMENT_FINANCE_KINDS[row.detailKind].label : row.kind === "ADOPTED_BUDGET" ? "Adopted budget" : "Budget amendment",
    text:row.sourceSentence,period:row.kind === "GOVERNMENT_FINANCE" ? typeof row.details.fiscalPeriod === "string" ? row.details.fiscalPeriod : null : row.fiscalYear }));
  const sources: CardSource[] = visible.map(row => ({what:row.title,
    provenance:{sourceUrl:row.sourceUrl,sourceOrg:row.government,collectedAt:row.capturedAt,verifiedAt:row.capturedAt}}));
  return {rows,sources,records:visible};
}
