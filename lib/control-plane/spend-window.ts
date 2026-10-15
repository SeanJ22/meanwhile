import type { CostEntry } from "./cost.ts";
import type { PricedCharge } from "./fleet-safety.ts";
import { fingerprint } from "./ids.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import type { ModelSpendQuery } from "./repository/model-charges.ts";
import { RESEARCH_BOUNDS } from "./scheduler/research-policy.ts";

export function costRecordId(entry: Pick<CostEntry, "attemptId" | "routeTaskId" | "recordedAt">): string {
  return `ce-${fingerprint([entry.attemptId, entry.routeTaskId, entry.recordedAt])}`;
}

export async function readSpendWindow(repos: Pick<ControlPlaneRepositories, "modelCharges">, now: string): Promise<readonly PricedCharge[]> {
  return repos.modelCharges.readSince(new Date(Date.parse(now) - (RESEARCH_BOUNDS.windowHours + 6) * 3_600_000).toISOString());
}

export async function readModelSpendTotals(repos: Pick<ControlPlaneRepositories, "modelCharges">, query: ModelSpendQuery) {
  return repos.modelCharges.totals(query);
}

export function readRollingModelSpend(repos: Pick<ControlPlaneRepositories, "modelCharges">, now: string) {
  return readModelSpendTotals(repos, { since: new Date(Date.parse(now) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString(), until: now });
}
