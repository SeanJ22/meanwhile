import { assignmentSpendQueries, type AssignmentBudgetSpec, type AssignmentMembership } from "../../lib/control-plane/expansion/assignment-budget.ts";
import { scopeSpendQueries, type ExpansionPlan } from "../../lib/control-plane/expansion/membership.ts";
import type { PricedCharge } from "../../lib/control-plane/fleet-safety.ts";
import { summarizeCharges } from "../../lib/control-plane/spend-window.ts";

export function assignmentHistoryOf(charges: readonly PricedCharge[] | null, now: string, specs: readonly AssignmentBudgetSpec[], membership: AssignmentMembership) {
  return charges === null ? null : new Map([...assignmentSpendQueries(now, specs, membership)].map(([key, query]) => [key, summarizeCharges(charges, query)]));
}

export function scopeHistoryOf(charges: readonly PricedCharge[] | null, plan: ExpansionPlan, now: string) {
  return charges === null ? null : new Map([...scopeSpendQueries(plan, now)].map(([key, query]) => [key,
    { day: summarizeCharges(charges, query.day), week: summarizeCharges(charges, query.week), budget: summarizeCharges(charges, query.budget) }]));
}
