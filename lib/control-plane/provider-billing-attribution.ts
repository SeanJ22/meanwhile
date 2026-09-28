import type { CostEntry } from "./cost.ts";
import type { SpendHold } from "./budget.ts";
import type { ExpansionScopeDecision } from "./expansion/scopes.ts";
import type { ProviderReading, ReportingProvider } from "./provider-billing.ts";

export interface BillingAttribution {
  readonly readAt: string;
  readonly hunts: readonly { key: string; label: string; startedAt: string; budgetUsd: number; anthropicUsd: number | null; otherUsd: number | null; anthropicKnownUsd: number; otherKnownUsd: number; knownCombinedUsd: number; reservedUsd: number | null; availableUsd: number | null; unpriced: number }[] | null;
  readonly providers: readonly { provider: ReportingProvider; huntUsd: number | null; otherRecordedUsd: number | null; huntKnownUsd: number; otherKnownUsd: number; providerUsd: number | null; differenceUsd: number | null; unpriced: number }[];
}

/** Recorded attribution, never guessed from an account bill or split across shared hunts. */
export function providerBillingAttribution(input: {
  now: string; costs: readonly CostEntry[]; attempts: readonly { id: string; worker: { version: string; provider: string } }[];
  scopes: readonly ExpansionScopeDecision[] | null; holds: Readonly<Record<string, SpendHold>> | null;
  /** Exact subject links recorded on durable obligations for each scope+receipt. */
  scopeMembers?: ReadonlyMap<string, ReadonlySet<string>>;
  readings: readonly ProviderReading[];
}): BillingAttribution {
  const modelIds = new Set(input.attempts.filter(a => a.worker.provider === "anthropic" || a.worker.version.startsWith("claude-")).map(a => a.id));
  const providerOf = (c: CostEntry): ReportingProvider | null => c.source === "api.exa.ai" ? "exa" : c.source === "api.search.brave.com" ? "brave" : modelIds.has(c.attemptId) || c.byModel?.some(m => m.model.startsWith("claude-")) || c.source === "api.anthropic.com" ? "anthropic-api" : null;
  const scopes = input.scopes?.filter(s => s.budgetStartedAt) ?? [];
  const belongs = (c: CostEntry, s: ExpansionScopeDecision) =>
    Date.parse(c.recordedAt) >= Date.parse(s.budgetStartedAt!) &&
    (c.assignmentKeys?.includes(s.key) === true ||
      (c.jurisdiction !== null && input.scopeMembers?.get(s.key)?.has(c.jurisdiction) === true));
  const sum = (rows: readonly CostEntry[]) => rows.some(c => c.cost.usd === null) ? null : rows.reduce((n,c) => n + (c.cost.usd ?? 0),0);
  const known = (rows: readonly CostEntry[]) => rows.reduce((n,c) => n + (typeof c.cost.usd === "number" && Number.isFinite(c.cost.usd) ? c.cost.usd : 0),0);
  const hunts = input.scopes === null ? null : scopes.map(s => {
    const rows = input.costs.filter(c => belongs(c,s));
    const anthropicRows = rows.filter(c => providerOf(c) === "anthropic-api");
    const otherRows = rows.filter(c => providerOf(c) !== "anthropic-api");
    const keys = [`send:${s.key}@${s.budgetStartedAt}`, `area:${s.key}@${s.budgetStartedAt}`];
    const holds = input.holds === null ? null : Object.values(input.holds).filter(h => h.settled === null && h.keys.some(k => keys.includes(k)));
    const reservedUsd = holds === null ? null : holds.reduce((n,h) => n+h.usd,0);
    const anthropicKnownUsd = known(anthropicRows);
    const otherKnownUsd = known(otherRows);
    const unpriced = rows.filter(c => c.cost.usd === null).length;
    return { key: s.key, label: s.geography.label, startedAt: s.budgetStartedAt!, budgetUsd: s.budgetUsd,
      anthropicUsd: sum(anthropicRows), otherUsd: sum(otherRows), anthropicKnownUsd, otherKnownUsd,
      knownCombinedUsd: anthropicKnownUsd + otherKnownUsd, reservedUsd,
      availableUsd: reservedUsd === null || anthropicRows.some(c => c.cost.usd === null) ? null : Math.max(0,s.budgetUsd-anthropicKnownUsd-reservedUsd),
      unpriced };
  });
  const providers = input.readings.map(r => {
    const rows = input.costs.filter(c => providerOf(c) === r.provider && Date.parse(c.recordedAt) >= Date.parse(r.periodStart) && Date.parse(c.recordedAt) <= Date.parse(r.periodEnd));
    const hunt = rows.filter(c => scopes.some(s => belongs(c,s))), others = rows.filter(c => !scopes.some(s => belongs(c,s)));
    // Anthropic's account total includes non-token services, so compare the token subtotal only.
    const providerUsd = r.provider === "anthropic-api" ? r.units.find(u => u.label === "Token usage cost (part of total)")?.value ?? null : r.reportedUsd;
    const ledger = sum(rows);
    const requestProvider = ["anthropic-api", "exa", "brave"].includes(r.provider);
    return { provider: r.provider, huntUsd: input.scopes === null || !requestProvider ? null : sum(hunt), otherRecordedUsd: !requestProvider ? null : sum(others),
      huntKnownUsd: known(hunt), otherKnownUsd: known(others), providerUsd,
      differenceUsd: requestProvider && providerUsd !== null && ledger !== null ? providerUsd-ledger : null, unpriced: rows.filter(c => c.cost.usd === null).length };
  });
  return { readAt: input.now, hunts, providers };
}
