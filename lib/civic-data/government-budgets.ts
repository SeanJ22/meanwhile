import { createHash } from "node:crypto";
import { jurisdictionFromOcdId } from "../coverage/states.ts";
import { readPromotedCivicData, type PromotedCivicDataReadOptions } from "./read-model.ts";
import { scopedManualContractScope } from "./scoped-manual-contracts.ts";

interface BudgetSource {
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
export type GovernmentBudgetFact = AdoptedBudget | BudgetResponsibility | BudgetAmendment;
const ROLES = { PROPOSES: /\b(?:propos(?:e|es|al)|prepares?|preparation)\b/i, ADOPTS: /\b(?:adopt(?:s|ion)?|approv(?:e|es|al))\b/i,
  RUNS: /\b(?:administer(?:s)?|administration|executes?|execution|runs?)\b/i, OVERSEES: /\b(?:oversee(?:s)?|oversight|supervis(?:e|es|ion))\b/i };

/** Normalize only the role words the source actually supplies. Mixed roles stay unresolved. */
export function budgetResponsibilityRole(sourceWords: string): BudgetResponsibility["role"] | null {
  const canonical = sourceWords.trim().toUpperCase();
  if (Object.hasOwn(ROLES, canonical)) return canonical as BudgetResponsibility["role"];
  const roles = (Object.keys(ROLES) as BudgetResponsibility["role"][]).filter(role => ROLES[role].test(sourceWords));
  return roles.length === 1 ? roles[0] : null;
}

export function budgetAuthorityKind(sourceWords: string): BudgetResponsibility["authorityKind"] | null {
  const kinds = (["CHARTER", "CODE", "LAW"] as const).filter(kind => new RegExp(`\\b${kind}\\b`, "i").test(sourceWords));
  return kinds.length === 1 ? kinds[0] : null;
}

export function governmentBudgetIssue(value: unknown): string | null {
  const row = value as GovernmentBudgetFact;
  if (!row || !row.id || !row.bodyId || !row.government?.trim() || !row.sourceSentence?.trim() ||
      !jurisdictionFromOcdId(row.ocdId) && row.ocdId !== "ocd-division/country:us" || !/^https:\/\//.test(row.sourceUrl) ||
      !Number.isFinite(Date.parse(row.capturedAt))) return "Budget fact has no exact government or source identity.";
  if (row.kind === "BUDGET_RESPONSIBILITY") return !["CHARTER", "CODE", "LAW"].includes(row.authorityKind) || !ROLES[row.role]?.test(row.sourceSentence) ||
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

/** Evidence for the existing checklist items, without changing scores or filling an unknown. */
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
