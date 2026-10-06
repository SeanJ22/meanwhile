/** Runner-maintained Money summary. Admin reads one narrowed snapshot field; it never aggregates raw ledgers. */
import type { ControlPlaneRepositories } from "../repository/types.ts";
import type { Sql } from "../repository/pg-store.ts";
import type { DailyDatabaseTransferRead } from "../../db/transfer.ts";
import type { ProviderBillingSnapshot } from "../provider-billing.ts";
import { readSpend, type AdminV6SpendView } from "./v6-spend-read.ts";
import { readVendorSpend } from "./vendor-spend.ts";

export interface NeonProjectTransfer {
  readonly project: "control-plane" | "we-the-people"; readonly day: string;
  readonly requestBytes: number; readonly responseBytes: number; readonly requests: number;
  /** Only a cause the runner actually measured. Unknown stays null. */
  readonly cause: string | null;
}
export interface SpendSummary { readonly readAt: string; readonly spend: AdminV6SpendView }
/** Called by the existing owner-snapshot publisher, with distinct live holds supplied by River's liveSpendHolds helper. */
export async function buildSpendSummary(input: {
  now: string; sql: Sql; transfer: DailyDatabaseTransferRead | null; billing: ProviderBillingSnapshot | null;
  dailyLimitUsd: number | null; liveSetAsideUsd: number | null; neonProjects: readonly NeonProjectTransfer[] | null;
  env?: Readonly<Record<string,string|undefined>>; fetcher?: typeof fetch;
}): Promise<SpendSummary> {
  const spend=await readSpend(input.sql,input.transfer);
  const vendors=await readVendorSpend({now:input.now,sql:input.sql,billing:input.billing,dailyLimitUsd:input.dailyLimitUsd,transfer:spend.neon,env:input.env,fetcher:input.fetcher});
  return {readAt:input.now,spend:{...spend,readAt:input.now,vendors,setAsideUsd:input.liveSetAsideUsd,dailyLimitUsd:input.dailyLimitUsd,neonProjects:input.neonProjects}};
}
export async function readSpendSummary(repos:Pick<ControlPlaneRepositories,"ownerSnapshots">):Promise<SpendSummary|null> {
  const row=await repos.ownerSnapshots.readNarrowed("current",{spendSummary:true});
  const value=row?.value as {spendSummary?:SpendSummary}|null|undefined;
  const summary=value?.spendSummary;
  if(!summary || !Number.isFinite(Date.parse(summary.readAt)) || !summary.spend || !Array.isArray(summary.spend.byDay) || !Array.isArray(summary.spend.byMonth) || !Array.isArray(summary.spend.byTier))return null;
  return summary;
}
