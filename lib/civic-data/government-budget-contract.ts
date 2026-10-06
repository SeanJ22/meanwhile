import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { governmentFinanceIssue, type GovernmentFinanceFact } from "./government-finance-contract.ts";

export interface BudgetSource {
  readonly id: string; readonly bodyId: string; readonly ocdId: string; readonly government: string;
  readonly sourceUrl: string; readonly sourceSentence: string; readonly capturedAt: string;
}
export interface AdoptedBudget extends BudgetSource {
  readonly kind: "ADOPTED_BUDGET"; readonly title: string; readonly fiscalYear: string;
  readonly fiscalStart: string | null; readonly fiscalEnd: string | null;
  readonly version: string; readonly documentUrl: string; readonly documentHash: string;
}
export interface BudgetResponsibility extends BudgetSource {
  readonly kind: "BUDGET_RESPONSIBILITY"; readonly role: "PROPOSES" | "ADOPTS" | "RUNS" | "OVERSEES";
  readonly responsible: string;
  readonly authorityKind: "CHARTER" | "CODE" | "LAW";
}
export interface BudgetAmendment extends BudgetSource {
  readonly kind: "BUDGET_AMENDMENT"; readonly title: string; readonly fiscalYear: string;
  readonly budgetVersion: string; readonly documentUrl: string; readonly documentHash: string;
}
export type GovernmentBudgetFact = AdoptedBudget | BudgetResponsibility | BudgetAmendment | GovernmentFinanceFact;
export const BUDGET_RESPONSIBILITY_ROLES = { PROPOSES: /\b(?:propos(?:e|es|al)|prepares?|preparation)\b/i, ADOPTS: /\b(?:adopt(?:s|ion)?|approv(?:e|es|al))\b/i,
  RUNS: /\b(?:administer(?:s)?|administration|executes?|execution|runs?)\b/i, OVERSEES: /\b(?:oversee(?:s)?|oversight|supervis(?:e|es|ion))\b/i };

/** Normalize only the role words the source actually supplies. Mixed roles stay unresolved. */
export function budgetResponsibilityRole(sourceWords: string): BudgetResponsibility["role"] | null {
  const canonical = sourceWords.trim().toUpperCase();
  if (Object.hasOwn(BUDGET_RESPONSIBILITY_ROLES, canonical)) return canonical as BudgetResponsibility["role"];
  const roles = (Object.keys(BUDGET_RESPONSIBILITY_ROLES) as BudgetResponsibility["role"][]).filter(role => BUDGET_RESPONSIBILITY_ROLES[role].test(sourceWords));
  return roles.length === 1 ? roles[0] : null;
}

export function budgetAuthorityKind(sourceWords: string): BudgetResponsibility["authorityKind"] | null {
  const kinds = (["CHARTER", "CODE", "LAW"] as const).filter(kind => new RegExp(`\\b${kind}\\b`, "i").test(sourceWords));
  return kinds.length === 1 ? kinds[0] : null;
}

export function governmentBudgetIssue(value: unknown): string | null {
  const row = value as GovernmentBudgetFact;
  if (row?.kind === "GOVERNMENT_FINANCE") return governmentFinanceIssue(row);
  if (!row || !row.id || !row.bodyId || !row.government?.trim() || !row.sourceSentence?.trim() ||
      !jurisdictionFromOcdId(row.ocdId) && row.ocdId !== "ocd-division/country:us" || !/^https:\/\//.test(row.sourceUrl) ||
      !Number.isFinite(Date.parse(row.capturedAt))) return "Budget fact has no exact government or source identity.";
  if (row.kind === "BUDGET_RESPONSIBILITY") return !["CHARTER", "CODE", "LAW"].includes(row.authorityKind) || !BUDGET_RESPONSIBILITY_ROLES[row.role]?.test(row.sourceSentence) ||
    !row.responsible?.trim() || !row.sourceSentence.includes(row.responsible) ? "Budget responsibility is not stated in the saved government authority." : null;
  if (!["ADOPTED_BUDGET", "BUDGET_AMENDMENT"].includes(row.kind) || !row.title?.trim() || !row.fiscalYear?.trim() ||
      !row.sourceSentence.includes(row.title) || !row.sourceSentence.includes(row.fiscalYear) || !/^https:\/\//.test(row.documentUrl) ||
      !/^[a-f0-9]{64}$/.test(row.documentHash)) return "Budget document has no source-backed fiscal year, title or readable saved document.";
  if (row.kind === "BUDGET_AMENDMENT") return !row.budgetVersion?.trim() || !row.sourceSentence.includes(row.budgetVersion) ||
    !/\b(?:amendment|amended)\b/i.test(row.sourceSentence) ? "Budget amendment does not name the adopted budget version." : null;
  if (!row.version?.trim() || !row.sourceSentence.includes(row.version) || !/\badopted\b/i.test(row.sourceSentence) ||
    /\b(?:proposed|draft|recommended)\b/i.test(row.sourceSentence)) return "The saved sentence does not identify this version as an adopted budget.";
  if ([row.fiscalStart, row.fiscalEnd].some(date => date !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date)) || row.fiscalStart && row.fiscalEnd && row.fiscalStart > row.fiscalEnd) return "Budget fiscal year dates are invalid.";
  return null;
}

