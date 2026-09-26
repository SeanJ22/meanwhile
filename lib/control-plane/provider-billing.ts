/** Cached reporting facts. These never authorize work or change a spending cap. */
export const REPORTING_PROVIDERS = ["anthropic-api", "neon", "exa", "github", "brave", "netlify"] as const;
export type ReportingProvider = typeof REPORTING_PROVIDERS[number];
export const BILLING_SYNC_MS = 60 * 60_000;
export const BILLING_STALE_MS = 3 * BILLING_SYNC_MS;
export const BILLING_SECRET_NAMES = ["ANTHROPIC_ADMIN_API_KEY", "NEON_BILLING_API_KEY", "EXA_SERVICE_API_KEY", "GITHUB_BILLING_TOKEN", "NETLIFY_BILLING_TOKEN"] as const;

export interface ProviderReading {
  readonly provider: ReportingProvider;
  readonly attemptedAt: string;
  readonly syncedAt: string | null;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly status: "REPORTED" | "ESTIMATED" | "MISSING_ACCESS" | "ERROR";
  /** Provider-reported accrued usage, not an invoice or a final charge. */
  readonly reportedUsd: number | null;
  readonly estimatedUsd: number | null;
  readonly credits: { readonly amount: number; readonly kind: "USED_ESTIMATE" | "INCLUDED" | "REMAINING" | "DISCOUNT_USD"; readonly unit: string } | null;
  readonly units: readonly { readonly label: string; readonly value: number; readonly unit: string }[];
  readonly accountIds: readonly string[];
  readonly existingLimits: readonly string[];
  readonly source: string;
  readonly detail: string;
  readonly error: string | null;
}
export interface ProviderBillingSnapshot {
  readonly formatVersion: 1;
  readonly collectedAt: string;
  readonly readings: readonly ProviderReading[];
}
export function billingStale(reading: ProviderReading, now: string): boolean {
  return reading.syncedAt === null || Date.parse(now) - Date.parse(reading.syncedAt) > BILLING_STALE_MS;
}
/** Failed/partial provider reads never erase a usable report or change its period. */
export function retainBillingReading(candidate: ProviderReading, previous?: ProviderReading): ProviderReading {
  if (candidate.status !== "ERROR" && candidate.status !== "MISSING_ACCESS") return candidate;
  return previous?.syncedAt ? { ...previous, attemptedAt: candidate.attemptedAt, status: candidate.status, error: candidate.error } : candidate;
}
/** Exactly one amount per provider; never add its ledger estimate to its report. */
export function billingTotal(readings: readonly ProviderReading[], since: string, now: string) {
  let reportedUsd = 0, estimatedUsd = 0, missing = 0;
  for (const p of REPORTING_PROVIDERS) {
    const r = readings.find(r => r.provider === p);
    if (!r || r.periodStart !== since || billingStale(r, now) || (r.error && r.status !== "ESTIMATED")) { missing++; continue; }
    if (r.reportedUsd !== null) reportedUsd += r.reportedUsd;
    else if (r.estimatedUsd !== null) estimatedUsd += r.estimatedUsd;
    else missing++;
  }
  return { reportedUsd, estimatedUsd, combinedUsd: reportedUsd + estimatedUsd, missing };
}
/** Billing credentials go only to the server-side owner-snapshot collector. */
export function withoutBillingSecrets<T extends Record<string, string | undefined>>(env: T): T {
  const clean = { ...env };
  for (const name of BILLING_SECRET_NAMES) delete clean[name];
  delete clean.WTP_BILLING_ENV_FILE;
  return clean;
}
