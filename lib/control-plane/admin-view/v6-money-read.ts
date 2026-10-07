import { formatEastern } from "../eastern-time.ts";
import { resolveRollingCeiling } from "../fleet-safety.ts";
import { fleetSpendCeilingOverrideUsd, type AdminConfig } from "../gateway/admin-config.ts";
import { billingStale, REPORTING_PROVIDERS, type ProviderReading, type ReportingProvider } from "../provider-billing.ts";
import type { V6ReadSources } from "./v6-money-hunts-route.ts";
import { dollars, exactHuntAccounting, huntName, rollingWords, scopedHunts, sectionRevision,
  type AdminV6SectionEnvelope, type V6Period, type V6PlaceScope, type V6Refusal } from "./v6-hunts-read.ts";

export const ADMIN_V6_MONEY_CONTRACT = "admin-v6/money@1" as const;

export interface AdminV6MoneyView {
  readonly account: readonly { readonly provider: string; readonly amountUsd: number | null; readonly how: string; readonly old?: boolean }[];
  readonly accountMonth: string;
  readonly monthlyPlans: readonly { readonly name: string; readonly note: string }[];
  readonly limits: readonly { readonly name: string; readonly figure: string; readonly usedUsd: number | null; readonly limitUsd: number | null; readonly fraction: number | null; readonly note: string;
    readonly tone: "hunt" | "warn" | "neutral" }[];
  readonly reconciliation: readonly {
    readonly provider: string; readonly periodStart: string; readonly periodEnd: string;
    readonly requestPriced: boolean;
    readonly huntUsd: number | null; readonly huntKnownUsd: number; readonly otherUsd: number | null; readonly otherKnownUsd: number;
    readonly providerUsd: number | null; readonly differenceUsd: number | null; readonly unpriced: number }[] | null;
  readonly readings: readonly {
    readonly provider: string; readonly status: string; readonly stale: boolean; readonly syncedAt: string | null; readonly attemptedAt: string;
    readonly periodStart: string; readonly periodEnd: string; readonly reportedUsd: number | null; readonly estimatedUsd: number | null;
    readonly error: string | null; readonly detail: string; readonly credits: string | null; readonly accounts: readonly string[]; readonly limits: readonly string[];
    readonly units: readonly { readonly label: string; readonly value: number; readonly unit: string }[] }[];
  readonly otherServices: string;
}

const PROVIDER_NAMES: Readonly<Record<ReportingProvider, string>> = {
  "anthropic-api": "Anthropic (API)", neon: "Neon", exa: "Exa", github: "GitHub", brave: "Brave Search", netlify: "Netlify",
};

/** Providers bill by UTC calendar day, so period edges are shown as UTC dates, not local times. */
const billingDate = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthWords = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });

function monthBounds(month: string): { readonly start: number; readonly end: number } {
  const [y, m] = month.split("-").map(Number);
  return { start: Date.UTC(y, m - 1, 1), end: Date.UTC(y, m, 1) };
}

function periodWithin(reading: ProviderReading, month: string): "whole" | "to-date" | null {
  const { start, end } = monthBounds(month);
  const from = Date.parse(reading.periodStart), to = Date.parse(reading.periodEnd);
  if (!Number.isFinite(from) || !Number.isFinite(to) || from < start || to > end || from > to) return null;
  return from === start && to >= end - 1000 ? "whole" : "to-date";
}

function accountLine(provider: ReportingProvider, reading: ProviderReading | undefined, period: V6Period, now: string) {
  const name = PROVIDER_NAMES[provider];
  if (!reading) return { provider: name, amountUsd: null, how: "No saved reading. This provider's bill is not read by the publisher." };
  const span = `${billingDate(reading.periodStart)} to ${billingDate(reading.periodEnd)}`;
  if (period.kind === "month" && periodWithin(reading, period.month) === null)
    return { provider: name, amountUsd: null, how: `No saved reading for ${monthWords(period.month)}. The saved reading covers ${span}.` };
  const why = reading.status === "MISSING_ACCESS" ? "Access to this bill is not set up"
    : reading.status === "ERROR" ? `The last read failed${reading.syncedAt ? "; this is the earlier reading" : ""}` : null;
  const amount = typeof reading.reportedUsd === "number" && Number.isFinite(reading.reportedUsd) && reading.syncedAt !== null ? reading.reportedUsd : null;
  const what = provider === "anthropic-api" ? "Usage the provider reports for the whole account, including non-token services; not an invoice"
    : "Usage the provider reports for the whole account; not an invoice";
  return {
    provider: name, amountUsd: amount,
    how: amount === null ? `${why ?? (reading.status === "ESTIMATED" && typeof reading.estimatedUsd === "number" && Number.isFinite(reading.estimatedUsd) ? `Only an estimate, ${dollars(reading.estimatedUsd)}, which is not counted as a reading` : "The provider reported no dollar amount")} · ${span}`
      : `${what} · ${span}${why ? ` · ${why}` : ""} · read ${formatEastern(reading.syncedAt)}`,
    ...(amount !== null && billingStale(reading, now) ? { old: true } : {}),
  };
}

function accountPeriodWords(all: readonly ProviderReading[], period: V6Period): string {
  const readings = all.filter(r => r.syncedAt !== null);
  if (period.kind === "month") {
    const partial = readings.some(r => periodWithin(r, period.month) === "to-date");
    return `Whole account · ${monthWords(period.month)}${partial ? " to date" : ""}`;
  }
  const spans = new Set(readings.map(r => `${r.periodStart}|${r.periodEnd}`));
  if (readings.length === 0) return "Whole account · no provider reading saved";
  if (spans.size === 1) return `Whole account · ${billingDate(readings[0].periodStart)} to ${billingDate(readings[0].periodEnd)}`;
  return "Whole account · each provider's own billing period";
}

function fleetLimit(sources: V6ReadSources) {
  const resolved = resolveRollingCeiling(fleetSpendCeilingOverrideUsd(sources.adminConfig as AdminConfig | null));
  const rolling = sources.fleetSafety?.rolling24Hours.modelUsd ?? null;
  const enforced = sources.fleetSafety?.bounds.rolling24HourModelUsd ?? null;
  const fraction = rolling === null || resolved.rollingCeilingUsd <= 0 ? null : rolling / resolved.rollingCeilingUsd;
  return {
    name: "All paid AI · any 24 hours",
    usedUsd: rolling,
    limitUsd: resolved.rollingCeilingUsd,
    figure: rolling === null ? `Spend not reported · limit ${dollars(resolved.rollingCeilingUsd)}` : `${dollars(rolling)} of ${dollars(resolved.rollingCeilingUsd)}`,
    fraction,
    note: [
      `One account-wide limit over every hunt and all other work, set by ${resolved.source === "OVERRIDE" ? "your setting" : "the built-in default"}.`,
      rolling === null ? (sources.fleetSafetyGap ?? "The rolling 24-hour spend is not reported.") : `Our own ledger, read ${formatEastern(sources.fleetSafety!.rolling24Hours.asOf)}.`,
      enforced !== null && enforced !== resolved.rollingCeilingUsd ? `The workers are still enforcing ${dollars(enforced)} until they read the new setting.` : "",
    ].filter(Boolean).join(" "),
    tone: fraction !== null && fraction >= 0.8 ? "warn" as const : "neutral" as const,
  };
}

/** Hunt figures are never summed into an account total, so a charge shared by two hunts is never counted twice. */
export function v6MoneySection(input: { readonly scopeKey: string; readonly scope: V6PlaceScope | null; readonly period: V6Period;
  readonly sources: V6ReadSources }): AdminV6SectionEnvelope<AdminV6MoneyView> | V6Refusal {
  const { sources, period } = input;
  if (period.kind === "whole-hunt" || period.kind === "last-24h") return { kind: "refused", status: 409, code: "PERIOD_NOT_AVAILABLE",
    says: period.kind === "whole-hunt"
      ? "Provider bills cover billing periods, not a hunt's lifetime. Whole-hunt money is in the hunts section."
      : "Only paid AI has a rolling 24-hour reading (shown under limits). No provider reports a 24-hour bill.",
    dependency: "DEP-PERIOD" };
  const scoped = scopedHunts(input.scope, input.scopeKey, sources);
  if ("kind" in scoped) return scoped;
  const readings = sources.providerBilling?.readings ?? [];
  const inPeriod = period.kind === "month" ? readings.filter(r => periodWithin(r, period.month) !== null) : readings;
  const account = REPORTING_PROVIDERS.map(p => accountLine(p, readings.find(r => r.provider === p), period, sources.readAt));
  const hunts = scoped.lifetime.map(decision => ({ decision, row: exactHuntAccounting(sources.attribution, decision) }));
  const otherServices = period.kind === "month"
    ? `Other-service costs by hunt are published only as whole-hunt totals, so they are not shown for ${monthWords(period.month)}.`
    : hunts.length === 0 ? "Other-service costs are for the whole account and are not split by place."
      : hunts.map(({ decision, row }) => row === null
        ? `${huntName(decision)}: other-service costs are not published for this exact receipt, so they are unknown.`
        : `${huntName(decision)}: ${dollars(row.otherKnownUsd)} known from search and data services${row.otherUsd === null ? ", but some of their charges have no price, so the full amount is unknown" : ""}. Combined with Anthropic, ${dollars(row.knownCombinedUsd)} is known${row.anthropicUsd === null || row.otherUsd === null ? "; the full combined cost is unknown" : ""}. Each charge is counted once here, even when overlapping hunts share it. These don't count against the Anthropic limit.`).join(" ");
  const limits = [
    fleetLimit(sources),
    ...scoped.rolling.map(d => ({ name: `${d.geography.label} · any 24 hours`, usedUsd: null, limitUsd: d.budgetUsd, figure: `${dollars(d.budgetUsd)} per rolling 24 hours`, fraction: null,
      note: "An older kind of place limit, not a lifetime hunt. Its spend over the last 24 hours is not reported here.", tone: "neutral" as const })),
  ];
  const spanOf = new Map(readings.map(r => [r.provider, r] as const));
  const reconciliation = sources.attribution === null || sources.attribution === undefined ? null
    : sources.attribution.providers.flatMap(p => {
      const reading = spanOf.get(p.provider);
      if (!reading || (period.kind === "month" && periodWithin(reading, period.month) === null)) return [];
      return [{ provider: PROVIDER_NAMES[p.provider], periodStart: reading.periodStart, periodEnd: reading.periodEnd,
        requestPriced: ["anthropic-api", "exa", "brave"].includes(p.provider), huntUsd: p.huntUsd, huntKnownUsd: p.huntKnownUsd,
        otherUsd: p.otherRecordedUsd, otherKnownUsd: p.otherKnownUsd, providerUsd: p.providerUsd, differenceUsd: p.differenceUsd, unpriced: p.unpriced }];
    });
  const detail = inPeriod.map(r => ({ provider: PROVIDER_NAMES[r.provider], status: r.status, stale: billingStale(r, sources.readAt), syncedAt: r.syncedAt, attemptedAt: r.attemptedAt,
    periodStart: r.periodStart, periodEnd: r.periodEnd, reportedUsd: r.reportedUsd, estimatedUsd: r.estimatedUsd, error: r.error, detail: r.detail,
    credits: r.credits ? `${r.credits.kind.replaceAll("_", " ").toLowerCase()}: ${r.credits.amount.toLocaleString("en-US")} ${r.credits.unit}` : null,
    accounts: r.accountIds, limits: r.existingLimits, units: r.units }));
  const data: AdminV6MoneyView = { account, accountMonth: accountPeriodWords(inPeriod, period), monthlyPlans: [], limits, reconciliation, readings: detail, otherServices };
  const missing = account.filter(a => a.amountUsd === null).length;
  const missingParts = [
    ...(missing > 0 ? [`${missing} of ${account.length} providers have no dollar reading${period.kind === "month" ? ` for ${monthWords(period.month)}` : ""}. The account total is unknown, not the sum of the others.`] : []),
    "Account readings are for the whole account. They are not split by place or by hunt.",
    "Monthly plans and subscriptions are not connected to this section yet.",
    "Map usage is counted in requests, not dollars, and is not listed here.",
    ...(hunts.some(h => h.row === null) ? ["At least one hunt's other-service costs are not published for its exact receipt."] : []),
    ...(rollingWords(scoped.rolling) === null ? [] : [rollingWords(scoped.rolling)!]),
    ...(sources.fleetSafetyGap ? [sources.fleetSafetyGap] : []),
  ];
  const stamps = [sources.fleetSafety?.rolling24Hours.asOf, ...inPeriod.map(r => r.syncedAt), hunts.length > 0 ? sources.attribution?.readAt : undefined]
    .filter((s): s is string => typeof s === "string" && Number.isFinite(Date.parse(s)));
  const asOf = stamps.length > 0 ? stamps.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : sources.readAt;
  return { contract: ADMIN_V6_MONEY_CONTRACT, scope: input.scopeKey,
    revision: sectionRevision("money", { data, missingParts, stamps }), asOf, data, missingParts };
}
