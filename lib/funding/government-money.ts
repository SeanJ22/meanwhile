import { governmentBudgetIssue, type GovernmentBudgetFact } from "../civic-data/government-budget-contract.ts";
import { GOVERNMENT_FINANCE_KINDS } from "../civic-data/government-finance-contract.ts";
import type { CardSource } from "../officials/card-sources.ts";

/** A filed amount stays with its units and report category. No conversion or sums. */
export function governmentMoneyText(row: GovernmentBudgetFact): string {
  if (row.kind !== "GOVERNMENT_FINANCE") return row.sourceSentence;
  const details = row.details;
  const filed = Object.entries(details).filter(([key,value]) => value !== null && value !== undefined && value !== "" && key !== "documentUrl");
  const extra = filed.filter(([,value]) => !row.sourceSentence.includes(String(value))).map(([key,value]) => `${key.replace(/([A-Z])/g, " $1").toLowerCase()}: ${value}`);
  return extra.length ? `${row.sourceSentence.replace(/[.!?]$/, "")} — ${extra.join("; ")}.` : row.sourceSentence;
}
export interface GovernmentMoneyRow { readonly id: string; readonly label: string; readonly text: string; readonly period: string | null }
/** Preserve each filed category, amount, unit and period in its own source
 * sentence. The reader never adds categories or converts source units. */
export function governmentMoneyView(records: readonly GovernmentBudgetFact[], bodyId: string, divisionId: string, options: {latestAudit?: boolean} = {}) {
  const held = records.filter(row => row.bodyId === bodyId && row.ocdId === divisionId && !governmentBudgetIssue(row));
  const auditYear = (row: GovernmentBudgetFact) => row.kind === "GOVERNMENT_FINANCE" && row.detailKind === "AUDIT" && typeof row.details.fiscalPeriod === "string"
    ? /^(?:FY\s*)?((?:19|20)\d{2})$/.exec(row.details.fiscalPeriod.trim())?.[1] ?? null : null;
  const knownAudits = held.map(auditYear).filter((year): year is string => year !== null);
  const latestAudit = knownAudits.sort().at(-1);
  const visible = held.filter((row): row is Exclude<GovernmentBudgetFact, {kind:"BUDGET_RESPONSIBILITY"}> => row.kind !== "BUDGET_RESPONSIBILITY" && (options.latestAudit === false || !auditYear(row) || auditYear(row) === latestAudit));
  const rows: GovernmentMoneyRow[] = visible.map(row => ({id:row.id,
    label:row.kind === "GOVERNMENT_FINANCE" ? GOVERNMENT_FINANCE_KINDS[row.detailKind].label : row.kind === "ADOPTED_BUDGET" ? "Adopted budget" : "Budget amendment",
    text:governmentMoneyText(row),period:row.kind === "GOVERNMENT_FINANCE" ? typeof row.details.fiscalPeriod === "string" ? row.details.fiscalPeriod : null : row.fiscalYear }));
  const sources: CardSource[] = visible.map(row => ({what:row.title,
    provenance:{sourceUrl:row.sourceUrl,sourceOrg:row.government,collectedAt:row.capturedAt,verifiedAt:row.capturedAt}}));
  return {rows,sources,records:visible};
}
