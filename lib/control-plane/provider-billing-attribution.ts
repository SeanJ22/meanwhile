import type { CostEntry } from "./cost.ts";
import type { SpendHold } from "./budget.ts";
import { addExact, exactSum, exactValue, mergeExact, type ExactSum } from "./exact-sum.ts";
import type { ExpansionScopeDecision } from "./expansion/scopes.ts";
import type { ProviderReading, ReportingProvider } from "./provider-billing.ts";
import { isFundedHunt } from "./scheduler/hunt-continuation.ts";

export interface BillingAttribution {
  readonly readAt: string;
  readonly hunts: readonly { key: string; receiptId?: string; label: string; startedAt: string; budgetUsd: number; anthropicUsd: number | null; otherUsd: number | null; anthropicKnownUsd: number; otherKnownUsd: number; knownCombinedUsd: number; budgetConsumedKnownUsd?: number; budgetUnpriced?: number; reservedUsd: number | null; availableUsd: number | null; unpriced: number }[] | null;
  readonly providers: readonly { provider: ReportingProvider; huntUsd: number | null; otherRecordedUsd: number | null; huntKnownUsd: number; otherKnownUsd: number; providerUsd: number | null; differenceUsd: number | null; unpriced: number }[];
}

/** Charges as the attribution states them: a sum is null once any one of them is unpriced. */
export interface ChargeSums {
  n: number;
  unpriced: number;
  readonly usd: ExactSum;
  readonly known: ExactSum;
}

const chargeSums = (): ChargeSums => ({ n: 0, unpriced: 0, usd: exactSum(), known: exactSum() });

function addCharge(into: ChargeSums, c: CostEntry): void {
  into.n += 1;
  if (c.cost.usd === null) into.unpriced += 1;
  addExact(into.usd, c.cost.usd ?? 0);
  if (typeof c.cost.usd === "number" && Number.isFinite(c.cost.usd)) addExact(into.known, c.cost.usd);
}

const sumOf = (rows: ChargeSums): number | null => rows.unpriced > 0 ? null : exactValue(rows.usd);
const knownOf = (rows: ChargeSums): number => exactValue(rows.known);

/** What one hunt owns, split by whether Anthropic's API billed it, and the Anthropic charges it benefits from. */
export interface HuntTotals {
  readonly anthropic: ChargeSums;
  readonly other: ChargeSums;
  readonly budget: ChargeSums;
}

/** One provider reading's period: its charges, split by whether a hunt owns them. */
export interface WindowTotals {
  readonly hunt: ChargeSums;
  readonly others: ChargeSums;
}

export const windowTotals = (): WindowTotals => ({ hunt: chargeSums(), others: chargeSums() });

export interface BillingContext {
  readonly scopes: readonly ExpansionScopeDecision[] | null;
  /** Exact subject links recorded on durable obligations for each scope+receipt. */
  readonly scopeMembers?: ReadonlyMap<string, ReadonlySet<string>>;
}

export const BILLING_PROVIDERS = ["anthropic-api", "exa", "brave"] as const;
export type BillingProvider = (typeof BILLING_PROVIDERS)[number];

type WorkerRef = { readonly version: string; readonly provider: string };

export function billingProviderOf(c: CostEntry, worker: WorkerRef | null): BillingProvider | null {
  if (c.source === "api.exa.ai") return "exa";
  if (c.source === "api.search.brave.com") return "brave";
  const model = worker !== null && (worker.provider === "anthropic" || worker.version.startsWith("claude-"));
  return model || c.byModel?.some(m => m.model.startsWith("claude-")) || c.source === "api.anthropic.com" ? "anthropic-api" : null;
}

export const scopeKeyOf = (s: Pick<ExpansionScopeDecision, "key" | "receiptId">): string => `${s.key}\n${s.receiptId}`;

/** Recorded attribution, never guessed from an account bill or split across shared hunts. */
function claimsOf(c: CostEntry, ctx: BillingContext): { readonly beneficiaries: readonly ExpansionScopeDecision[]; readonly owner: ExpansionScopeDecision | null } {
  const scopes = ctx.scopes?.filter(s => s.budgetStartedAt) ?? [];
  const eligible = scopes.filter(s => Date.parse(c.recordedAt) >= Date.parse(s.budgetStartedAt!));
  // One charge appears in at most one hunt subtotal: a reporting allocation, never a waiver of another overlapping cap.
  let beneficiaries: readonly ExpansionScopeDecision[] = eligible.filter(s => c.assignmentRefs?.some(mark => mark.key === s.key && mark.ref === s.receiptId));
  if (c.assignmentRefs === undefined) {
    // Rows without exact refs are joined through the funded hunt's receipt and saved member subjects; only a single match is attributed.
    const legacy = eligible.filter(s => isFundedHunt(s) && (c.assignmentKeys?.includes(s.key) === true ||
      (c.jurisdiction !== null && ctx.scopeMembers?.get(s.key)?.has(c.jurisdiction) === true)));
    beneficiaries = legacy.length === 1 ? legacy : [];
  }
  const owner = [...beneficiaries].sort((a, b) => a.key.localeCompare(b.key) || a.receiptId.localeCompare(b.receiptId))[0] ?? null;
  return { beneficiaries, owner };
}

export function foldHunts(hunts: Record<string, HuntTotals>, c: CostEntry, worker: WorkerRef | null, ctx: BillingContext): void {
  const { beneficiaries, owner } = claimsOf(c, ctx);
  const provider = billingProviderOf(c, worker);
  const of = (s: ExpansionScopeDecision): HuntTotals => (hunts[scopeKeyOf(s)] ??= { anthropic: chargeSums(), other: chargeSums(), budget: chargeSums() });
  if (owner !== null) addCharge(provider === "anthropic-api" ? of(owner).anthropic : of(owner).other, c);
  if (provider !== "anthropic-api") return;
  for (const s of new Map(beneficiaries.map(s => [scopeKeyOf(s), s])).values()) addCharge(of(s).budget, c);
}

/** A charge of the reading's provider, stamped inside its period. */
export function foldWindow(window: WindowTotals, c: CostEntry, ctx: BillingContext): void {
  addCharge(claimsOf(c, ctx).owner === null ? window.others : window.hunt, c);
}

export const inReadingPeriod = (c: CostEntry, r: Pick<ProviderReading, "periodStart" | "periodEnd">): boolean =>
  Date.parse(c.recordedAt) >= Date.parse(r.periodStart) && Date.parse(c.recordedAt) <= Date.parse(r.periodEnd);

export function providerBillingAttribution(input: {
  now: string; costs: readonly CostEntry[]; attempts: readonly { id: string; worker: WorkerRef }[];
  scopes: readonly ExpansionScopeDecision[] | null; holds: Readonly<Record<string, SpendHold>> | null;
  scopeMembers?: ReadonlyMap<string, ReadonlySet<string>>;
  readings: readonly ProviderReading[];
}): BillingAttribution {
  const workers = new Map(input.attempts.map(a => [a.id, a.worker]));
  const ctx: BillingContext = { scopes: input.scopes, scopeMembers: input.scopeMembers };
  const hunts: Record<string, HuntTotals> = {};
  for (const c of input.costs) foldHunts(hunts, c, workers.get(c.attemptId) ?? null, ctx);
  return billingAttributionOf({ ...input, hunts, windowOf: r => {
    const window = windowTotals();
    for (const c of input.costs) if (billingProviderOf(c, workers.get(c.attemptId) ?? null) === r.provider && inReadingPeriod(c, r)) foldWindow(window, c, ctx);
    return window;
  } });
}

export function billingAttributionOf(input: {
  now: string; scopes: readonly ExpansionScopeDecision[] | null; holds: Readonly<Record<string, SpendHold>> | null;
  readings: readonly ProviderReading[]; hunts: Readonly<Record<string, HuntTotals>>;
  /** The reading's own charges; a provider no ledger row is billed to has none. */
  windowOf: (reading: ProviderReading) => WindowTotals;
}): BillingAttribution {
  const scopes = input.scopes?.filter(s => s.budgetStartedAt) ?? [];
  const hunts = input.scopes === null ? null : scopes.map(s => {
    const totals = input.hunts[scopeKeyOf(s)] ?? { anthropic: chargeSums(), other: chargeSums(), budget: chargeSums() };
    const keys = [`send:${s.key}@${s.budgetStartedAt}`, `area:${s.key}@${s.budgetStartedAt}`];
    const holds = input.holds === null ? null : Object.values(input.holds).filter(h => h.settled === null && h.keys.some(k => keys.includes(k)));
    const reservedUsd = holds === null ? null : holds.reduce((n,h) => n+h.usd,0);
    const anthropicKnownUsd = knownOf(totals.anthropic);
    const otherKnownUsd = knownOf(totals.other);
    const budgetConsumedKnownUsd = knownOf(totals.budget);
    const budgetUnpriced = totals.budget.unpriced;
    return { key: s.key, receiptId:s.receiptId, label: s.geography.label, startedAt: s.budgetStartedAt!, budgetUsd: s.budgetUsd,
      anthropicUsd: sumOf(totals.anthropic), otherUsd: sumOf(totals.other), anthropicKnownUsd, otherKnownUsd,
      knownCombinedUsd: anthropicKnownUsd + otherKnownUsd, budgetConsumedKnownUsd, budgetUnpriced, reservedUsd,
      availableUsd: reservedUsd === null || budgetUnpriced>0 ? null : Math.max(0,s.budgetUsd-budgetConsumedKnownUsd-reservedUsd),
      unpriced: totals.anthropic.unpriced + totals.other.unpriced };
  });
  const providers = input.readings.map(r => {
    const requestProvider = (BILLING_PROVIDERS as readonly string[]).includes(r.provider);
    const { hunt, others } = requestProvider ? input.windowOf(r) : windowTotals();
    const rows = chargeSums();
    for (const part of [hunt, others]) {
      rows.n += part.n;
      rows.unpriced += part.unpriced;
      mergeExact(rows.usd, part.usd);
    }
    // Anthropic's account total includes non-token services, so compare the token subtotal only.
    const providerUsd = r.provider === "anthropic-api" ? r.units.find(u => u.label === "Token usage cost (part of total)")?.value ?? null : r.reportedUsd;
    const ledger = sumOf(rows);
    return { provider: r.provider, huntUsd: input.scopes === null || !requestProvider ? null : sumOf(hunt), otherRecordedUsd: !requestProvider ? null : sumOf(others),
      huntKnownUsd: knownOf(hunt), otherKnownUsd: knownOf(others), providerUsd,
      differenceUsd: requestProvider && providerUsd !== null && ledger !== null ? providerUsd-ledger : null, unpriced: rows.unpriced };
  });
  return { readAt: input.now, hunts, providers };
}
