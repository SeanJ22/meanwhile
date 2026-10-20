import type { CacheHitRate } from "./research-metrics.ts";
import type { SpendHold } from "./budget.ts";
import type { CostEntry } from "./cost.ts";
import { aggregatePricedSpend, pricedModelCharge, type PricedCharge } from "./fleet-safety.ts";
import { fingerprint } from "./ids.ts";
import type { ControlPlaneRepositories } from "./repository/types.ts";
import { RESEARCH_BOUNDS } from "./scheduler/research-policy.ts";

export type SpendTotals = ReturnType<typeof aggregatePricedSpend>;
export interface SpendQuery {
  readonly since: string;
  readonly until: string;
  readonly jurisdictions?: readonly string[];
  readonly assignment?: {
    readonly key: string;
    readonly ref: string;
    readonly obligations: readonly { readonly id: string; readonly since: string }[];
    readonly subjects: readonly { readonly id: string; readonly since: string }[];
  };
  readonly excludeTasks?: readonly { readonly id: string; readonly since: string }[];
  readonly holds?: readonly SpendHold[];
}
export interface SpendSummary extends SpendTotals { readonly bySubject: number }
export interface SpendMetrics {
  readonly scout: { readonly usd: number; readonly measured: number; readonly unmeasured: number };
  readonly cache: readonly CacheHitRate[];
}
export interface SpendRepository {
  record(charge: PricedCharge): Promise<void>;
  aggregate(query: SpendQuery): Promise<SpendSummary>;
  metrics(query: Pick<SpendQuery, "since" | "until">): Promise<SpendMetrics>;
}

export const EMPTY_SPEND: SpendTotals = Object.freeze({ usd: 0, knownUsd: 0, measured: 0, unmeasured: 0, worstCaseCharges: 0 });

export function costRecordId(entry: Pick<CostEntry, "attemptId" | "routeTaskId" | "recordedAt">): string {
  return `ce-${fingerprint([entry.attemptId, entry.routeTaskId, entry.recordedAt])}`;
}

export function chargeMatches(charge: PricedCharge, query: SpendQuery): boolean {
  const at = Date.parse(charge.at);
  if (at < Date.parse(query.since) || at > Date.parse(query.until)) return false;
  if (query.jurisdictions && (charge.jurisdiction === null || !query.jurisdictions.includes(charge.jurisdiction))) return false;
  if (query.excludeTasks?.some(task => task.id === charge.routeTaskId && at >= Date.parse(task.since))) return false;
  const assignment = query.assignment;
  if (assignment) {
    if (charge.assignmentRefs && !charge.assignmentRefs.some(mark => mark.key === assignment.key && mark.ref === assignment.ref)) return false;
    const member = charge.obligationId === null
      ? assignment.subjects.find(row => row.id === charge.jurisdiction)
      : assignment.obligations.find(row => row.id === charge.obligationId);
    if (!member || at < Date.parse(member.since)) return false;
  }
  return true;
}

export function summarizeCharges(charges: readonly PricedCharge[], query: SpendQuery): SpendSummary {
  const matched = charges.filter(charge => chargeMatches(charge, query));
  return { ...aggregatePricedSpend(matched, query.since, query.until, query.holds),
    bySubject: matched.filter(charge => charge.obligationId === null).length };
}

export async function readSpendWindow(repos: Pick<ControlPlaneRepositories, "spend">, now: string,
  options: Pick<SpendQuery, "holds" | "excludeTasks"> = {}): Promise<SpendSummary & { readonly windowUsd: number }> {
  const spend = await repos.spend.aggregate({ since: new Date(Date.parse(now) - RESEARCH_BOUNDS.windowHours * 3_600_000).toISOString(), until: now, ...options });
  return { ...spend, windowUsd: spend.usd };
}

export async function countCharge(repos: Pick<ControlPlaneRepositories, "spend">, entry: CostEntry): Promise<void> {
  const charge = pricedModelCharge(entry, costRecordId(entry));
  if (charge !== null) await repos.spend.record(charge);
}
