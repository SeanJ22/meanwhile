import { createHash } from "node:crypto";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { scopedManualContractScope } from "./scoped-manual-contracts.ts";
import { governmentBudgetIssue, BUDGET_RESPONSIBILITY_ROLES as ROLES, type GovernmentBudgetFact, type BudgetResponsibility, type AdoptedBudget, type BudgetAmendment } from "./government-budget-contract.ts";
export * from "./government-budget-contract.ts";

export function governmentBudgetRecordId(parts: readonly string[]) {
  return `government-budget:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

export async function readGovernmentBudgets(ocdId: string, options: PromotedCivicDataReadOptions = {}) {
  const read = await readPromotedCivicData<{ kind: "government-budgets"; records: readonly GovernmentBudgetFact[] }>("CURATED_READER_RECORD",
    scopedManualContractScope("government-budgets", ocdId), options);
  if (read.kind === "PROMOTED" && (read.value.kind !== "government-budgets" || !Array.isArray(read.value.records) ||
    read.value.records.some(row => governmentBudgetIssue(row) || row.ocdId !== ocdId))) throw new Error("Published budget facts have invalid source or government identity.");
  return read;
}

/** Fiscal years and exact version links control what is current, never acquisition order or an inferred total. */
export function currentBudgetFacts(records: readonly GovernmentBudgetFact[], bodyId: string, today: string) {
  const held = records.filter(row => row.bodyId === bodyId && !governmentBudgetIssue(row));
  const budgets = held.filter((row): row is AdoptedBudget => row.kind === "ADOPTED_BUDGET" &&
    row.fiscalStart !== null && row.fiscalEnd !== null && row.fiscalStart <= today && today <= row.fiscalEnd);
  return budgets.map(budget => ({ budget, responsibilities: held.filter((row): row is BudgetResponsibility => row.kind === "BUDGET_RESPONSIBILITY"),
    amendments: held.filter((row): row is BudgetAmendment => row.kind === "BUDGET_AMENDMENT" && row.fiscalYear === budget.fiscalYear && row.budgetVersion === budget.version) }));
}

export function budgetChecklistEvidence(records: readonly GovernmentBudgetFact[], bodyId: string, today: string) {
  const current = currentBudgetFacts(records, bodyId, today);
  const unique = current.filter(({ budget }) => current.filter(other => other.budget.title === budget.title &&
    other.budget.fiscalYear === budget.fiscalYear).length === 1);
  const budgets = unique.map(row => row.budget);
  const responsibilities = unique.flatMap(row => row.responsibilities);
  const allRoles = (Object.keys(ROLES) as BudgetResponsibility["role"][]).every(role => responsibilities.some(row => row.role === role));
  return {
    "FIN-01": budgets,
    "FIN-02": budgets,
    "FIN-03": budgets,
    "FIN-04": allRoles ? [...new Map(responsibilities.map(row => [row.id, row])).values()] : [],
    "FIN-05": unique.flatMap(row => row.amendments),
  } as const;
}
