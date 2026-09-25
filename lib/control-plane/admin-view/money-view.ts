/**
 * **WHERE THE MONEY GOES.** (Admin redesign, 2026-09-23 — Fleet · Money and
 * Readiness · Cost; COST-ACCOUNTING.md.)
 *
 * Two views that answer different questions and are never merged into one
 * figure:
 *
 * ```
 *   overall spending   what the operation costs: three kinds of ceiling, every
 *                      provider with its amount, kind, period and how it is
 *                      read, AI usage by model, and the reconciliation rules
 *   cost of work       what a result cost: paid work split by what each attempt
 *                      itself recorded it produced, plain-code work that needs
 *                      no model, and the assignments that cost the most
 * ```
 *
 * The rules, each enforced here rather than in markup:
 *
 * ```
 *   unknown is never zero       a provider with no reading says so; a total over
 *                               unread providers is a floor and says so
 *   bill ≠ ledger               the provider's bill and our measured ledger are two
 *                               routes to the same money and are never added
 *   credit ≠ usage              a balance or a purchase is not consumption
 *   search ≠ model              a search API request's charge is its own line,
 *                               per host, never inside model spend
 *   windows are named           a UTC month, a rolling 24 hours and a billing
 *                               period never share one sum
 *   shared stays shared         the databases and the host serve the reader site
 *                               too; no split is invented
 * ```
 *
 * PURE. No store, no clock, no environment.
 */

import {
  PROVIDER_DEFINITIONS,
  factAmountWords,
  factPeriodWords,
  providerDefinition,
  type BillingFact,
} from "../billing-facts.ts";
import { SEARCH_PRICES } from "../../hunt/discovery-search.ts";
import { DISCOVERY_SEARCH_ROLE, SEARCH_SOURCE_NOT_ON_RECORD } from "../cost.ts";
import { DEFAULT_SEARCH_BUDGET } from "../discovery/search-runtime.ts";
import { modelName } from "../plain-words.ts";
import { WORK_QUESTION_WORDS, isWorkQuestion } from "../work-question.ts";

export type Tone = "teal" | "gold" | "amber" | "cyan" | "slate" | "stone";

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

const FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
export function eastern(iso: string): string {
  const t = Date.parse(iso);
  return Number.isFinite(t) ? `${FMT.format(new Date(t))} ET` : iso;
}

/* ==================================================================== *
 * THE INPUTS, AS THE SCREEN HANDS THEM IN
 * ==================================================================== */

export interface LedgerRow {
  readonly key: string;
  readonly usd: number | null;
  readonly measuredRows: number;
  readonly unmeasuredRows: number;
}

/** The UTC month from the published snapshot (`monthlySpend`). */
export interface LedgerMonth {
  readonly label: string;
  readonly since: string;
  readonly asOf: string;
  readonly resetsAt: string;
  readonly measuredUsd: number | null;
  readonly measuredRows: number;
  /** Charges from work that could reach a paid model and reported no dollars; null when not published. */
  readonly unpricedModelRows: number | null;
  readonly byModel: readonly LedgerRow[];
  readonly byRole: readonly LedgerRow[];
  /** Search charges by API host; null when the snapshot predates the breakdown (not broken down — never "none"). */
  readonly bySearchSource: readonly LedgerRow[] | null;
}

/** The month's search charges, as the ledger's role breakdown carries them; null when none are on the ledger. */
function searchCharges(month: LedgerMonth): LedgerRow | null {
  return month.byRole.find((r) => r.key === DISCOVERY_SEARCH_ROLE) ?? null;
}

/**
 * Model money this month: the ledger's measured total less search charges,
 * which are not model spend and are counted on their own line. Null when the
 * ledger's total is not measured.
 */
export function modelSpendUsd(month: LedgerMonth): number | null {
  if (month.measuredUsd === null) return null;
  return Math.round((month.measuredUsd - (searchCharges(month)?.usd ?? 0)) * 100) / 100;
}

const SEARCH_HOSTS: Readonly<Record<string, string>> = { "api.search.brave.com": "Brave Search", "api.exa.ai": "Exa" };

const READ_ON = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" });

/** The caps the runner last said it enforced (its heartbeat's discovery-search acknowledgement), or null before it has said. */
export interface SearchCapsApplied {
  readonly perCycle: number;
  readonly perDay: number;
  readonly appliedAt: string;
}

/**
 * What one search request costs and how many the runner may send: the
 * published prices the charges are written at, and the caps the runner last
 * acknowledged enforcing. Before its first acknowledgement, the caps in the code
 * it starts with, said as such. The day's count lives in its budget ledger,
 * which this page does not read.
 */
function searchLimits(applied: SearchCapsApplied | null): string {
  const prices = Object.values(SEARCH_PRICES);
  const each = prices
    .map((p) => `${SEARCH_HOSTS[p.host] ?? p.host} ${p.usdPerRequest === null ? "has no published price" : `$${p.usdPerRequest.toFixed(3)} a request`} (its pricing page, read ${READ_ON.format(new Date(`${p.readOn}T12:00:00Z`))})`)
    .join("; ");
  const known = prices.every((p) => p.usdPerRequest !== null);
  const perCycle = applied?.perCycle ?? DEFAULT_SEARCH_BUDGET.perCycle;
  const perDay = applied?.perDay ?? DEFAULT_SEARCH_BUDGET.perDay;
  const most = known ? ` — at most ${usd(Math.max(...prices.map((p) => p.usdPerRequest ?? 0)) * perDay)} a day` : " — the most a day is unknown while a price is unpublished";
  return (
    ` Prices: ${each}.` +
    (applied === null
      ? ` The runner starts with ${plural(perCycle, "request")} a cycle and ${perDay} a day across both${most}.` +
        " It has not yet said which limits it enforces, and it keeps the day's count in its budget ledger, which this page does not read."
      : ` The runner enforces ${plural(perCycle, "request")} a cycle and ${perDay} a day across both${most}, as it said at ${eastern(applied.appliedAt)}.` +
        " It keeps the day's count in its budget ledger, which this page does not read.")
  );
}

/** The search line: measured per host, a request with no published price named as unknown, and a month with no request a measured zero. */
function searchLine(month: LedgerMonth | null, applied: SearchCapsApplied | null): { readonly amount: string | null; readonly how: string } {
  const line = searchSpend(month);
  return { amount: line.amount, how: `${line.how}${searchLimits(applied)}` };
}

function searchSpend(month: LedgerMonth | null): { readonly amount: string | null; readonly how: string } {
  if (month === null) return { amount: null, how: "The published snapshot was not read, so search spend is not shown. Not a zero." };
  const all = searchCharges(month);
  if (all === null) return { amount: usd(0), how: "No search request is on the ledger this month. The search rung writes one row per request, so this is a count, not a gap." };
  const requests = all.measuredRows + all.unmeasuredRows;
  const unpriced = all.unmeasuredRows > 0 ? ` ${plural(all.unmeasuredRows, "request")} had no published price — unknown, not free, so the figure is a floor.` : "";
  const hosts =
    month.bySearchSource === null
      ? "Not broken down by provider in this snapshot."
      : month.bySearchSource
          .map((r) => `${r.key === SEARCH_SOURCE_NOT_ON_RECORD ? "Host not recorded" : SEARCH_HOSTS[r.key] ?? r.key} ${r.usd === null ? "no price" : usd(r.usd)} · ${plural(r.measuredRows + r.unmeasuredRows, "request")}`)
          .join("; ") + ".";
  return { amount: all.usd === null ? null : usd(all.usd), how: `${plural(requests, "request")}, one ledger row each, never counted as model spend. ${hosts}${unpriced}` };
}

/** Who the month's paid model calls went to, from the model rows themselves. */
export function modelProviderWords(month: LedgerMonth): string {
  const paid = month.byModel.filter((r) => r.key !== NO_MODEL && r.usd !== null && r.usd > 0);
  const providers = [...new Set(paid.map((r) => (r.key.startsWith("claude") || r.key === NOT_ON_RECORD ? "Anthropic" : "a provider not recorded on the charge")))];
  if (providers.length === 0) return "No paid model call is on the ledger this month.";
  return providers.length === 1 ? `Every paid model call so far went to one provider: ${providers[0]}.` : `Paid model calls went to ${providers.join(" and ")}.`;
}

export interface RollingSpend {
  readonly usd: number | null;
  readonly asOf: string;
}

export interface CeilingSetting {
  readonly settingUsd: number;
  readonly source: "OVERRIDE" | "FALLBACK";
  readonly setAt: string | null;
  readonly previousUsd: number | null;
  /** The ceiling the runner last enforced, from its own snapshot; null when not read. */
  readonly enforcedUsd: number | null;
}

export interface MapTilerReading {
  readonly used: number | null;
  readonly allowance: number | null;
  readonly allowanceAssumed: boolean;
  readonly since: string | null;
  readonly until: string | null;
  readonly collectedAt: string | null;
  readonly says: string;
}

/* ==================================================================== *
 * THREE CEILINGS
 * ==================================================================== */

export interface CeilingCard {
  readonly amount: string | null;
  readonly label: string;
  readonly note: string;
  readonly source: string;
}

function latest(facts: readonly BillingFact[], pick: (f: BillingFact) => boolean): BillingFact | null {
  return facts.filter(pick).sort((a, b) => (a.asOf === b.asOf ? b.decidedAt.localeCompare(a.decidedAt) : a.asOf < b.asOf ? 1 : -1))[0] ?? null;
}

export function ceilingCards(input: { readonly ceiling: CeilingSetting; readonly rolling: RollingSpend | null; readonly facts: readonly BillingFact[] }): CeilingCard[] {
  const c = input.ceiling;
  const pending = c.enforcedUsd !== null && Math.abs(c.enforcedUsd - c.settingUsd) >= 0.005;
  const cap = latest(input.facts, (f) => f.provider === "anthropic-api" && f.kind === "LIMIT");
  const subs = input.facts.filter((f) => f.kind === "SUBSCRIPTION");
  const monthly = subs.filter((f) => f.cadence === "MONTHLY").reduce((n, f) => n + f.amountUsd, 0);
  const yearly = subs.filter((f) => f.cadence === "ANNUAL");
  return [
    {
      amount: usd(c.settingUsd),
      label: "Rolling 24-hour ceiling inside the application",
      note:
        "Paid model work in any rolling 24 hours. Enforced — work is refused when it is reached, not merely reported." +
        (input.rolling === null || input.rolling.usd === null
          ? " What has been spent in the window is not measured right now."
          : ` ${usd(input.rolling.usd)} spent in the window as of ${eastern(input.rolling.asOf)}.`) +
        (pending ? ` The runner last enforced ${usd(c.enforcedUsd!)}; this setting takes effect at its next cycle.` : ""),
      source:
        c.source === "OVERRIDE"
          ? `SOURCE your spend dial${c.setAt ? ` · set ${eastern(c.setAt)}` : ""}${c.previousUsd !== null ? ` · was ${usd(c.previousUsd)}` : ""}`
          : "SOURCE the built-in fallback · no dial set",
    },
    {
      amount: cap ? usd(cap.amountUsd) : null,
      label: `Your Anthropic account cap${cap ? (cap.cadence === "DAILY" ? ", per day" : ", per month") : ""}`,
      note: "Set in the provider's console. The application does not read it and cannot enforce it." + (cap ? "" : " No figure has been entered, so it is not shown as a number."),
      source: cap ? `SOURCE entered by you · read ${cap.asOf} from ${cap.source}` : "SOURCE provider console · not entered",
    },
    {
      amount: subs.length === 0 ? null : usd(monthly),
      label: "Fixed subscriptions, per month",
      note:
        subs.length === 0
          ? "The Claude and ChatGPT subscriptions the delegated-work bridge runs on, and the development tools. No amount has been entered. Not spend the runner can stop, and never added to usage."
          : `${subs.map((f) => `${f.label ?? providerDefinition(f.provider).name} ${factAmountWords(f)}`).join("; ")}.` +
            (yearly.length > 0 ? " Yearly charges are listed, not divided into months." : "") +
            " Not spend the runner can stop, and never added to usage.",
      source: subs.length === 0 ? "SOURCE invoices · not entered" : `SOURCE entered by you · ${plural(subs.length, "subscription")}`,
    },
  ];
}

/* ==================================================================== *
 * EVERY PROVIDER
 * ==================================================================== */

export interface ProviderRow {
  readonly key: string;
  readonly name: string;
  /** Null renders the dashed NO READING pill. */
  readonly amount: string | null;
  readonly amountTone: "text" | "accent";
  readonly kind: string;
  readonly period: string;
  readonly how: string;
  readonly shared: boolean;
  readonly controllable: boolean;
  /** The entered figure behind the row, so the row can offer to remove it. */
  readonly factId: string | null;
}

const FACT_KIND_WORDS: Readonly<Record<BillingFact["kind"], string>> = {
  BILLED: "Billed — final",
  MONTH_TO_DATE: "Billed so far — not final",
  SUBSCRIPTION: "Subscription",
  BALANCE: "Prepaid credit left",
  PURCHASE: "Prepaid credit bought",
  USAGE_IMPORT: "Usage, from an export",
  LIMIT: "Account limit",
};

function factRow(f: BillingFact, name: string): Omit<ProviderRow, "key" | "shared" | "controllable"> {
  return {
    name,
    amount: factAmountWords(f),
    amountTone: f.kind === "BALANCE" ? "accent" : "text",
    kind: FACT_KIND_WORDS[f.kind],
    period: factPeriodWords(f),
    how: `Entered by you · read ${f.asOf} from ${f.source}${f.imported ? ` · summed from ${f.imported.fileName}, ${plural(f.imported.rows, "row")}` : ""}.`,
    factId: f.id,
  };
}

/**
 * One row per provider slot. A provider with figures shows its newest figure
 * of each kind; one with none shows NO READING with the reason and the manual
 * path. The system's own measurements (the ledger, MapTiler's requests) are
 * their own rows, never merged into a bill's row.
 */
export function providerRows(input: {
  readonly month: LedgerMonth | null;
  readonly rolling: RollingSpend | null;
  readonly maptiler: MapTilerReading | null;
  readonly facts: readonly BillingFact[];
  /** The discovery-search caps the runner last acknowledged; null (or absent) before it has. */
  readonly searchCaps?: SearchCapsApplied | null;
}): ProviderRow[] {
  const m = input.month;
  const modelUsd = m ? modelSpendUsd(m) : null;
  const search = searchLine(m, input.searchCaps ?? null);
  const rows: ProviderRow[] = [
    {
      key: "ledger-month",
      name: "Anthropic — measured here",
      amount: modelUsd !== null ? usd(modelUsd) : null,
      amountTone: "text",
      kind: "Our own ledger",
      period: m ? `${m.label} (UTC), to ${eastern(m.asOf)}` : "Unknown",
      how: m
        ? `Per charge, written by the runner.${m.unpricedModelRows !== null && m.unpricedModelRows > 0 ? ` ${plural(m.unpricedModelRows, "model charge")} reported no cost — unknown, not free work.` : ""}${searchCharges(m) !== null ? " Search requests are on their own line." : ""}`
        : "The published snapshot was not read, so the ledger is not shown. Not a zero.",
      shared: false,
      controllable: true,
      factId: null,
    },
    {
      key: "ledger-rolling",
      name: "Anthropic — measured here",
      amount: input.rolling && input.rolling.usd !== null ? usd(input.rolling.usd) : null,
      amountTone: "text",
      kind: "Our own ledger",
      period: "Rolling 24 hours",
      how: input.rolling ? `The window the ceiling is enforced over, as the runner last measured it (${eastern(input.rolling.asOf)}).` : "The runner's spend window was not read.",
      shared: false,
      controllable: true,
      factId: null,
    },
    {
      key: "ledger-search",
      name: "Search APIs — measured here",
      amount: search.amount,
      amountTone: "text",
      kind: "Our own ledger",
      period: m ? `${m.label} (UTC), to ${eastern(m.asOf)}` : "Unknown",
      how: search.how,
      shared: false,
      controllable: true,
      factId: null,
    },
  ];
  for (const def of PROVIDER_DEFINITIONS) {
    const mine = input.facts.filter((f) => f.provider === def.key && f.kind !== "LIMIT");
    if (mine.length === 0) {
      if (def.key === "other") continue;
      rows.push({
        key: def.key,
        name: def.name,
        amount: null,
        amountTone: "text",
        kind: def.charge,
        period: "Unknown",
        how: def.accessNeeded.startsWith("none")
          ? `Nothing to connect — it is an invoice figure. ${def.fallback} below.`
          : `Not connected — ${def.accessNeeded}. ${def.fallback} below.`,
        shared: def.shared,
        controllable: def.controllable,
        factId: null,
      });
      continue;
    }
    // Newest figure per product and kind: a closed month's bill and a balance
    // read today are different facts and both stay visible.
    const newest = new Map<string, BillingFact>();
    for (const f of [...mine].sort((a, b) => (a.asOf < b.asOf ? 1 : a.asOf > b.asOf ? -1 : 0))) {
      const slot = `${f.label ?? ""}|${f.kind}${f.kind === "BILLED" ? `|${f.periodStart}` : ""}`;
      if (!newest.has(slot)) newest.set(slot, f);
    }
    for (const f of [...newest.values()].slice(0, 4)) {
      rows.push({ key: f.id, shared: def.shared, controllable: def.controllable, ...factRow(f, f.label ? `${def.name} — ${f.label}` : def.name) });
    }
  }
  const mt = input.maptiler;
  rows.push({
    key: "maptiler-requests",
    name: "MapTiler — map requests",
    amount: mt && mt.used !== null ? `${mt.used.toLocaleString("en-US")} requests` : null,
    amountTone: "text",
    kind: "Usage, in requests — not dollars",
    period: mt && mt.since && mt.until ? `${mt.since} to ${mt.until}` : "Current billing period",
    how:
      mt && mt.used !== null
        ? `Read by the runner from MapTiler's own analytics${mt.collectedAt ? ` (${eastern(mt.collectedAt)})` : ""}${mt.allowance !== null ? `, against ${mt.allowance.toLocaleString("en-US")} included${mt.allowanceAssumed ? " (assumed, not confirmed)" : ""}` : ""}.`
        : `Not read: ${mt?.says ?? "no reading was published"}.`,
    shared: true,
    controllable: false,
    factId: null,
  });
  return rows;
}

/** How many provider slots have no reading at all. A total over them is a floor. */
export function unreadProviders(rows: readonly ProviderRow[]): number {
  return rows.filter((r) => r.amount === null).length;
}

/* ==================================================================== *
 * AI USAGE BY PROVIDER AND MODEL
 * ==================================================================== */

export interface ModelUsageRow {
  readonly model: string;
  readonly provider: string;
  readonly tier: string;
  readonly charges: number;
  readonly usd: number | null;
  readonly unpriced: number;
  readonly share: number | null;
}

const NO_MODEL = "no model (deterministic work)";
const NOT_ON_RECORD = "(attempt not on record)";

export function tierOf(key: string): string {
  const k = key.toLowerCase();
  if (key === NO_MODEL) return "No AI — plain code";
  if (key === NOT_ON_RECORD) return "Not recorded on the charge";
  if (k.includes("haiku")) return "Cheapest AI";
  if (k.includes("sonnet")) return "Mid AI";
  if (k.includes("opus")) return "Most capable AI";
  return "AI";
}

export function modelUsageRows(month: LedgerMonth): ModelUsageRow[] {
  const total = modelSpendUsd(month) ?? 0;
  return month.byModel.map((r) => ({
    model: r.key === NO_MODEL ? "Plain code" : r.key === NOT_ON_RECORD ? "Model not recorded — the hourly cache pre-warm" : modelName(r.key),
    provider: r.key === NO_MODEL ? "None" : r.key.startsWith("claude") || r.key === NOT_ON_RECORD ? "Anthropic" : "Not recorded",
    tier: tierOf(r.key),
    charges: r.measuredRows + r.unmeasuredRows,
    usd: r.key === NO_MODEL ? null : r.usd,
    unpriced: r.key === NO_MODEL ? 0 : r.unmeasuredRows,
    share: r.key !== NO_MODEL && r.usd !== null && total > 0 ? r.usd / total : null,
  }));
}

/* ==================================================================== *
 * RECONCILIATION
 * ==================================================================== */

export interface ReconLine {
  readonly pill: string;
  readonly tone: Tone;
  readonly text: string;
}

export function reconciliation(input: {
  readonly month: LedgerMonth | null;
  readonly facts: readonly BillingFact[];
  readonly unread: number;
  readonly proofAssignments: number | null;
}): ReconLine[] {
  const m = input.month;
  const modelUsd = m ? modelSpendUsd(m) : null;
  const bill = latest(input.facts, (f) => f.provider === "anthropic-api" && (f.kind === "MONTH_TO_DATE" || f.kind === "BILLED"));
  return [
    {
      pill: "NEVER ADDED",
      tone: "slate",
      text:
        "The provider's bill and our own measured ledger cover the same model spend by two routes. " +
        (m && modelUsd !== null && bill
          ? `The ledger's ${usd(modelUsd)} of model spend (${m.label}, to ${eastern(m.asOf)}) and the ${factAmountWords(bill)} you read on ${bill.asOf} (${factPeriodWords(bill)}) are never summed. ` +
            (bill.periodStart === m.since.slice(0, 10)
              ? `They cover the same month; the gap between them, ${usd(Math.abs(bill.amountUsd - modelUsd))}, is spend the ledger does not carry — development and the reader's Ask are billed to the same account — plus anything after the day you read it.`
              : "They cover different periods, so the difference between them is not a discrepancy.")
          : "They are never summed, and the bill also carries development and the reader's Ask, which the ledger does not."),
    },
    {
      pill: "SHARED STAYS SHARED",
      tone: "slate",
      text: "The databases, the host, the code host and the map provider serve the reader site as well as the fleet. They stay shared unless an allocation has a documented basis; a split without one would be invention.",
    },
    {
      pill: "UNKNOWN IS NOT ZERO",
      tone: "gold",
      text:
        input.unread === 0
          ? "Every provider has a reading. The readings still cover different periods, so they are shown provider by provider rather than as one total."
          : `${plural(input.unread, "provider row")} ${input.unread === 1 ? "has" : "have"} no reading. The operating cost of this system therefore has a floor, not a total${modelUsd !== null ? ` — at least ${usd(modelUsd)} this month in model usage alone` : ""} — and every rate computed against it is a ceiling.`,
    },
    {
      pill: "CREDIT IS NOT USAGE",
      tone: "cyan",
      text: "A prepaid balance and a purchase of credit are recorded as what they are. Neither is consumption, and neither is added to a bill or to the ledger.",
    },
    {
      pill: "TEST SPEND",
      tone: "cyan",
      text:
        "Test and proof runs stay inside actual spending and inside the ceilings — they are real money, and every total above includes them. " +
        "They are left out of what paid work produced and what a result cost: their charges are marked as test runs, and Cost of work shows them on a line of their own." +
        (input.proofAssignments !== null
          ? ` ${plural(input.proofAssignments, "proof assignment")} ${input.proofAssignments === 1 ? "is" : "are"} kept in their own lane so they never count as production work.`
          : "") +
        " Proof runs recorded before test runs were marked charged under the production project, so those still count as production.",
    },
    {
      pill: "CANNOT STOP",
      tone: "stone",
      text: "The ceiling and a geography's budget are controllable. Subscriptions, the databases and the host are charges the application cannot instantly stop, and they are shown apart from money a decision of yours can change.",
    },
  ];
}

/* ==================================================================== *
 * COST OF WORK
 * ==================================================================== */

export interface OutcomeFacts {
  readonly outcome: string;
  readonly attempts: number;
  readonly usd: number;
  readonly unpriced: number;
  readonly first: string | null;
  readonly last: string | null;
  readonly topRefusal: { readonly code: string; readonly count: number; readonly detail: string | null } | null;
}

/**
 * The paid outcomes for a scope: every state together, or one state. A
 * refusal's reason is counted within the same scope, so a state never borrows
 * another state's count.
 */
export function outcomesInScope(
  rows: readonly { readonly state: string; readonly outcome: string; readonly attempts: number; readonly usd: number; readonly unpriced: number; readonly first: string | null; readonly last: string | null }[],
  refusals: readonly { readonly state: string; readonly code: string; readonly count: number; readonly detail: string | null }[],
  state: string | null,
): OutcomeFacts[] {
  const by = new Map<string, OutcomeFacts>();
  for (const r of rows) {
    if (state !== null && r.state !== state) continue;
    const held = by.get(r.outcome);
    const first = [held?.first ?? null, r.first].filter((x): x is string => x !== null).sort()[0] ?? null;
    const last = [held?.last ?? null, r.last].filter((x): x is string => x !== null).sort().slice(-1)[0] ?? null;
    by.set(r.outcome, {
      outcome: r.outcome,
      attempts: (held?.attempts ?? 0) + r.attempts,
      usd: (held?.usd ?? 0) + r.usd,
      unpriced: (held?.unpriced ?? 0) + r.unpriced,
      first,
      last,
      topRefusal: null,
    });
  }
  const codes = new Map<string, { count: number; detail: string | null }>();
  for (const f of refusals) {
    if (state !== null && f.state !== state) continue;
    const held = codes.get(f.code);
    codes.set(f.code, { count: (held?.count ?? 0) + f.count, detail: held?.detail ?? f.detail });
  }
  const top = [...codes.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const refused = by.get("REFUSED");
  if (refused && top) by.set("REFUSED", { ...refused, topRefusal: { code: top[0], count: top[1].count, detail: top[1].detail } });
  return orderOutcomes([...by.values()]);
}

/* ==================================================================== *
 * WHAT THE PAID CHARGES WERE FOR (MW-013), AND TEST RUNS (MW-024)
 * ==================================================================== */

/** One group of paid charges as the store reads them (`PurposeRow`). */
export interface PurposeFacts {
  readonly state: string;
  readonly kept: "KEPT" | "BEFORE" | "NOT_KEPT";
  readonly recordClass: string | null;
  readonly question: string | null;
  readonly assigned: boolean;
  readonly resultKind: string | null;
  readonly test: boolean;
  readonly role: string;
  readonly charges: number;
  readonly usd: number;
  readonly unpriced: number;
  readonly first: string | null;
  readonly last: string | null;
}

export interface PurposeLine {
  readonly key: string;
  readonly label: string;
  readonly detail: string;
  readonly charges: number;
  readonly usd: number;
  readonly unpriced: number;
  readonly tone: "text" | "muted" | "gold";
}

export interface PurposeSplit {
  /** Production charges that recorded their purpose, by purpose, most dollars first. */
  readonly lines: readonly PurposeLine[];
  /** Charges written before any charge recorded its purpose. */
  readonly before: PurposeLine | null;
  /** Charges written since by a path that does not record purpose (search requests, the cache pre-warm). */
  readonly notKept: PurposeLine | null;
  /** Proof and test runs: inside every total, apart from what production produced. */
  readonly test: PurposeLine | null;
  readonly totalUsd: number;
  readonly totalCharges: number;
  /** The span of charges it covers, in words. */
  readonly window: string;
}

const RESULT_WORDS: Readonly<Record<string, string>> = {
  INGESTED: "acquired",
  WALKED_NO_YIELD: "walked, nothing there",
  POINTER_ONLY: "found a pointer",
  NO_DISPOSITION: "no conclusion reached",
  SIMULATED: "simulated, nothing run",
  DISPOSITION_REFUSED: "conclusion refused",
  LANE_MISMATCH: "refused: ran as the wrong worker",
};

const ROLE_PATH_WORDS: Readonly<Record<string, string>> = {
  [DISCOVERY_SEARCH_ROLE]: "search requests",
  SCOUT: "Scout charges outside an attempt (the cache pre-warm)",
};

function sumLine(rows: readonly PurposeFacts[]): { charges: number; usd: number; unpriced: number } {
  return rows.reduce((n, r) => ({ charges: n.charges + r.charges, usd: n.usd + r.usd, unpriced: n.unpriced + r.unpriced }), { charges: 0, usd: 0, unpriced: 0 });
}

function unpricedWords(n: number): string {
  return n > 0 ? ` ${plural(n, "charge")} reported no dollar figure — unknown, not free, so the amount is a floor.` : "";
}

/**
 * Paid charges split by what each recorded it was for — record class,
 * question, whether an owner Send reached the work, and what it came to — in
 * one scope (every state, or one). Nothing is inferred for a charge that did
 * not record it: rows from before purpose was kept are one line saying so, and
 * so are rows from paths that still do not record it. Proof and test runs are
 * their own line: in the total, never in a purpose.
 */
export function purposeSplit(rows: readonly PurposeFacts[], state: string | null): PurposeSplit {
  const mine = rows.filter((r) => state === null || r.state === state);
  const test = mine.filter((r) => r.test);
  const prod = mine.filter((r) => !r.test);
  const groups = new Map<string, PurposeFacts[]>();
  for (const r of prod.filter((x) => x.kept === "KEPT")) {
    const key = `${r.recordClass ?? ""}|${r.question ?? ""}|${r.assigned ? "A" : "S"}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const lines: PurposeLine[] = [...groups.entries()].map(([key, g]) => {
    const s = sumLine(g);
    const head = g[0];
    const question = head.question !== null && isWorkQuestion(head.question) ? WORK_QUESTION_WORDS[head.question] : null;
    const results = new Map<string, number>();
    for (const r of g) results.set(r.resultKind ?? "NOT_RECORDED", (results.get(r.resultKind ?? "NOT_RECORDED") ?? 0) + r.charges);
    const came = [...results.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${n} ${k === "NOT_RECORDED" ? "result not recorded" : (RESULT_WORDS[k] ?? k.toLowerCase().replace(/_/g, " "))}`)
      .join(", ");
    return {
      key,
      label:
        `${head.recordClass === null ? "Record class not recorded" : head.recordClass.replace(/[-_]+/g, " ").replace(/^./, (c) => c.toUpperCase())} · ` +
        `${question ?? "question not recorded"} · ${head.assigned ? "work an instruction of yours reached" : "standing work no instruction reached"}`,
      detail: `${plural(s.charges, "charge")}; what each came to: ${came}.${unpricedWords(s.unpriced)}`,
      charges: s.charges,
      usd: s.usd,
      unpriced: s.unpriced,
      tone: "text",
    };
  });
  lines.sort((a, b) => b.usd - a.usd || a.key.localeCompare(b.key));

  const beforeRows = prod.filter((r) => r.kept === "BEFORE");
  const b = sumLine(beforeRows);
  const beforeLast = beforeRows.map((r) => r.last ?? "").sort().slice(-1)[0] ?? "";
  const notKeptRows = prod.filter((r) => r.kept === "NOT_KEPT");
  const n = sumLine(notKeptRows);
  const roles = new Map<string, number>();
  for (const r of notKeptRows) roles.set(r.role, (roles.get(r.role) ?? 0) + r.charges);
  const t = sumLine(test);
  const all = sumLine(mine);
  const first = mine.map((r) => r.first ?? "").filter((x) => x !== "").sort()[0] ?? null;
  const last = mine.map((r) => r.last ?? "").sort().slice(-1)[0] ?? null;
  return {
    lines,
    before:
      b.charges === 0
        ? null
        : {
            key: "before",
            label: "Recorded before purpose was kept",
            detail:
              `${plural(b.charges, "charge")}${beforeLast ? `, the last on ${eastern(beforeLast)}` : ""}. These charges did not say what their work was for, so they are not split — never guessed into a purpose.` +
              unpricedWords(b.unpriced),
            charges: b.charges,
            usd: b.usd,
            unpriced: b.unpriced,
            tone: "muted",
          },
    notKept:
      n.charges === 0
        ? null
        : {
            key: "not-kept",
            label: "Written by a path that does not record purpose",
            detail:
              `${plural(n.charges, "charge")}: ${[...roles.entries()].sort((x, y) => y[1] - x[1]).map(([role, c]) => `${c} ${ROLE_PATH_WORDS[role] ?? `${role.toLowerCase().replace(/_/g, " ")} charges`}`).join(", ")}. ` +
              "Only the dispatcher's charges say what their work was for yet." +
              unpricedWords(n.unpriced),
            charges: n.charges,
            usd: n.usd,
            unpriced: n.unpriced,
            tone: "gold",
          },
    test:
      t.charges === 0
        ? null
        : {
            key: "test",
            label: "Test and proof runs",
            detail:
              `${plural(t.charges, "charge")}. Real money: inside this total, the ledger's totals and the ceilings. ` +
              "Left out of what paid work produced and of what a result cost." +
              unpricedWords(t.unpriced),
            charges: t.charges,
            usd: t.usd,
            unpriced: t.unpriced,
            tone: "gold",
          },
    totalUsd: all.usd,
    totalCharges: all.charges,
    window: first && last ? `every paid charge on record, ${eastern(first)} to ${eastern(last)}` : "every paid charge on record",
  };
}

/** What the page says about the proof and test attempts it left out of production's figures. */
export function testAttemptsWords(t: { readonly attempts: number; readonly usd: number } | null): string {
  if (t === null) return "";
  if (t.attempts === 0) return "No proof or test attempt is among them.";
  return `${plural(t.attempts, "proof or test attempt")} (${usd(t.usd)}) ${t.attempts === 1 ? "is" : "are"} left out of these figures — real money, inside every total and ceiling, and not production's result.`;
}

/** A dollar figure per attempt; a fraction of a cent says so rather than rounding to a free-looking $0.00. */
export function perAttempt(usdTotal: number, attempts: number): string {
  if (attempts === 0) return "—";
  const each = usdTotal / attempts;
  return each > 0 && each < 0.005 ? "under $0.01" : usd(each);
}

const OUTCOME_WORDS: Readonly<Record<string, { readonly label: string; readonly means: string }>> = {
  ROUTE_CANDIDATE: { label: "Found a way in", means: "an evidence-backed route to a record we did not have" },
  EVIDENCE_FOUND: { label: "Found the record", means: "evidence of the record itself, acquired and kept" },
  NEEDS_ADAPTER: { label: "Found where it lives — needs engineering", means: "a named adapter is the only thing in the way" },
  BLOCKED: { label: "Hit a wall", means: "every way tried met a refusal, recorded with its reason" },
  HUMAN_REQUIRED: { label: "Needs a person", means: "only an offline or human act remains" },
  NO_PROGRESS: { label: "Produced nothing", means: "the attempt ran and nothing advanced" },
  REFUSED: { label: "Refused — no result", means: "the executor refused the attempt's finish, so it is not a finding" },
};

export function outcomeWords(outcome: string): { readonly label: string; readonly means: string } {
  return OUTCOME_WORDS[outcome] ?? { label: outcome.toLowerCase().replace(/_/g, " "), means: "" };
}

const OUTCOME_ORDER = ["ROUTE_CANDIDATE", "EVIDENCE_FOUND", "NEEDS_ADAPTER", "BLOCKED", "HUMAN_REQUIRED", "NO_PROGRESS", "REFUSED"];

export function orderOutcomes(rows: readonly OutcomeFacts[]): OutcomeFacts[] {
  const rank = (o: string) => {
    const i = OUTCOME_ORDER.indexOf(o);
    return i < 0 ? OUTCOME_ORDER.length : i;
  };
  return [...rows].sort((a, b) => rank(a.outcome) - rank(b.outcome) || b.usd - a.usd);
}

/** Why a refusal happened, in the owner's words. */
export function refusalWords(code: string, detail: string | null): string {
  if (code === "SCOUT_TRANSPORT_FAILED") {
    return /529|overloaded/i.test(detail ?? "") ? "the model provider did not answer — it reported itself overloaded" : "the model provider did not answer the request";
  }
  if (code === "SCOUT_EARLY_ABSENCE") return "it claimed a record does not exist before walking the ways in";
  if (code === "SCOUT_CANDIDATE_WITHOUT_EVIDENCE") return "it proposed a way in without evidence";
  if (code === "SCOUT_NO_TOOL_USED") return "it finished without using a tool";
  return code.toLowerCase().replace(/_/g, " ");
}

export interface ResultTile {
  readonly title: string;
  /** Null renders the dashed CANNOT BE WORKED OUT pill with the reason in `refused`. */
  readonly figure: string | null;
  readonly figureLabel: string | null;
  readonly lines: readonly string[];
  readonly refused: string | null;
}

export interface RoutineDay {
  /** Bodies read in the last 24 hours, of the watched bodies in scope. */
  readonly bodiesRead: number;
  readonly reads: number;
  readonly gotIn: number;
  /** Reads that promoted a version. */
  readonly versions: number;
  /** Of those, reads whose version carried a changed record. */
  readonly changedReads: number;
  /** Reads that got in but found the source listing no meetings. */
  readonly cannotTell: number;
  readonly added: number;
  readonly changed: number;
  readonly removed: number;
}

const SHARED = "Its share of the databases and the host is shared and not read, so it is not priced.";

/**
 * The four kinds of result the design prices apart, each against its own
 * denominator and window. Paid work is priced from what each attempt itself
 * recorded it produced; plain-code work carries no model cost, and its share of
 * the database and host is shared and unread — said, never computed.
 */
export function resultTiles(input: { readonly outcomes: readonly OutcomeFacts[] | null; readonly day: RoutineDay | null; readonly window: string }): ResultTile[] {
  const o = input.outcomes;
  const pick = (names: readonly string[]) => (o ?? []).filter((r) => names.includes(r.outcome));
  const sum = (rows: readonly OutcomeFacts[]) => ({ attempts: rows.reduce((n, r) => n + r.attempts, 0), usd: rows.reduce((n, r) => n + r.usd, 0) });
  const found = sum(pick(["ROUTE_CANDIDATE", "EVIDENCE_FOUND"]));
  const allPaid = sum(o ?? []);
  const wasted = sum(pick(["NO_PROGRESS", "REFUSED"]));
  const d = input.day;
  return [
    {
      title: "Finding something we did not have",
      figure: o === null ? null : found.attempts === 0 ? "None" : usd(found.usd / found.attempts),
      figureLabel: o === null ? null : found.attempts === 0 ? "no paid attempt found anything" : "per paid attempt that found something",
      lines: [
        ...(o === null
          ? []
          : [
              `Paid: ${usd(found.usd)} on the ${plural(found.attempts, "attempt")} that found a way in or the record itself (${input.window}).`,
              found.attempts > 0 && allPaid.attempts > found.attempts
                ? `Counting every paid attempt, including those that found nothing, each find cost ${usd(allPaid.usd / found.attempts)}.`
                : "",
            ]),
        d === null ? "" : `Plain code: ${plural(d.added, "new meeting")} found by routine reads in the last 24 hours, at no model cost. ${SHARED}`,
      ].filter((l) => l !== ""),
      refused: o === null ? "The Scout results were not read, so paid finding is not priced." : null,
    },
    {
      title: "Catching a change",
      figure: d === null ? null : "$0.00",
      figureLabel: d === null ? null : "in model cost — plain code",
      lines:
        d === null
          ? []
          : [
              `${plural(d.changedReads, "read")} in the last 24 hours caught a change, across ${plural(d.bodiesRead, "body", "bodies")} read: ${plural(d.added, "record")} added, ${plural(d.changed, "record")} changed and ${plural(d.removed, "record")} removed (a record is a meeting or one of its agenda documents).`,
              "Some of those count the same content re-read under a new key — a known defect with an owner — so they overstate what actually changed.",
              `Every routine re-read is plain code — AI never touches it. ${SHARED}`,
            ],
      refused: d === null ? "No routine read was recorded in the last 24 hours in this scope, so there is nothing to price." : null,
    },
    {
      title: "Confirming nothing changed",
      figure: d === null ? null : "$0.00",
      figureLabel: d === null ? null : "in model cost — plain code",
      lines:
        d === null
          ? []
          : [
              `${plural(Math.max(0, d.versions - d.changedReads), "read")} in the last 24 hours got in and confirmed nothing had changed.`,
              d.cannotTell > 0
                ? `${plural(d.cannotTell, "more read")} got in but found the source listing no meetings. A zero is not proof there are none, so those confirm nothing and are not counted here.`
                : "",
              "This is the reading that would show money going on re-finding what we already hold. It is zero in model money by construction: routine re-reads never reach a model.",
            ].filter((l) => l !== ""),
      refused: d === null ? "No routine read was recorded in the last 24 hours in this scope." : null,
    },
    {
      title: "Work that produced nothing useful",
      figure: o === null ? null : usd(wasted.usd),
      figureLabel: o === null ? null : `on ${plural(wasted.attempts, "paid attempt")}`,
      lines: [
        ...(o === null
          ? []
          : pick(["NO_PROGRESS", "REFUSED"]).map((r) =>
              r.outcome === "REFUSED" && r.topRefusal
                ? `${usd(r.usd)} on ${plural(r.attempts, "attempt")} whose finish was refused — ${plural(r.topRefusal.count, "time")} because ${refusalWords(r.topRefusal.code, r.topRefusal.detail)}.`
                : `${usd(r.usd)} on ${plural(r.attempts, "attempt")} that ran and produced nothing.`,
            )),
        d === null ? "" : `${plural(Math.max(0, d.reads - d.gotIn), "routine read")} in the last 24 hours could not get in — the site refused or failed the request — at no model cost.`,
        "Real money, no result — kept visible here rather than folded into the other three.",
      ].filter((l) => l !== ""),
      refused: o === null ? "The Scout results were not read, so paid work that produced nothing is not priced." : null,
    },
  ];
}

/* ==================================================================== *
 * WHAT ACTUALLY NEEDED AI
 * ==================================================================== */

export interface LadderTile {
  readonly figure: number;
  readonly label: string;
  readonly note: string;
}

export function ladderTiles(month: LedgerMonth): LadderTile[] {
  const tier = (t: string) => month.byModel.filter((r) => tierOf(r.key) === t);
  const count = (rows: readonly LedgerRow[]) => rows.reduce((n, r) => n + r.measuredRows + r.unmeasuredRows, 0);
  const dollars = (rows: readonly LedgerRow[]) => rows.reduce((n, r) => n + (r.usd ?? 0), 0);
  const names = (rows: readonly LedgerRow[]) => [...new Set(rows.map((r) => modelName(r.key)))].join(" and ");
  const total = modelSpendUsd(month) ?? 0;
  const top = tier("Most capable AI");
  const pre = tier("Not recorded on the charge");
  const cheap = tier("Cheapest AI");
  const mid = tier("Mid AI");
  const topUsd = dollars(top) + dollars(pre);
  return [
    {
      figure: count(tier("No AI — plain code")),
      label: "Charges that needed no AI",
      note: "Fetching pages, checking permissions, reading dates, comparing fingerprints. No model cost — not free, simply never sent to a model.",
    },
    {
      figure: count(cheap),
      label: "Cheapest AI",
      note: count(cheap) === 0 ? "Not used this month: no step ran on the cheapest class." : `${usd(dollars(cheap))} · ${names(cheap)}.`,
    },
    {
      figure: count(mid),
      label: "Mid AI",
      note: count(mid) === 0 ? "Not used this month: nothing moved up from the cheapest class, and nothing starts here." : `${usd(dollars(mid))} · ${names(mid)}.`,
    },
    {
      figure: count(top) + count(pre),
      label: "Most capable AI",
      note:
        `${usd(topUsd)}${total > 0 ? ` · ${Math.round((topUsd / total) * 100)}% of this month's model money` : ""}` +
        (top.length > 0 ? ` · ${names(top)}` : "") +
        (pre.length > 0 ? `, including ${plural(count(pre), "cache pre-warm charge")} whose model is not on the row` : "") +
        ". The Scout's research loop and the audit start here by design.",
    },
  ];
}

/** The ladder's rules, each checked against current code on 2026-09-23 — true, or said to be not yet true. */
export const LADDER_RULES: readonly { readonly holds: boolean; readonly text: string }[] = [
  {
    holds: true,
    text: "If plain code can do it, AI never touches it. Enforced in the step registry: sending a plain-code step to a model throws before any call is made (RULING 244).",
  },
  {
    holds: true,
    text: "The most capable class is the ceiling, and no model named Fable may route. Both are guards now, not observations: a routing edit that points any class above the ceiling or at a Fable fails when the code loads (MW-034).",
  },
  {
    holds: true,
    text: "Cheapest first, moving up only for a recorded reason. Enforced in code since Sep 25: the Scout's research starts on Sonnet 5 and moves up to Opus 5.5 only for one of four recorded reasons, after the spending ceiling holds room for the second try, and the result keeps the reason, the evidence and what both tries cost. The audit stays on Opus by design (MW-035). Checked with a stand-in provider only: no paid call has run under it yet (MW-031, MW-033).",
  },
  {
    holds: true,
    text: "Findings carry forward. A walk inherits the ways in that earlier walks found (the field manual), so the next one starts from them. Real, and not measured over time (MW-027).",
  },
];

/* ==================================================================== *
 * THE ASSIGNMENTS THAT COST THE MOST
 * ==================================================================== */

export interface TopWorkFacts {
  readonly id: string;
  readonly subject: string | null;
  readonly recordClass: string | null;
  readonly attempts: number;
  readonly usd: number;
  readonly refused: number;
  readonly outcomes: Readonly<Record<string, number>>;
  readonly last: string | null;
}

function titleCase(words: string): string {
  return words.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/**
 * A ledger place key in words: `state-nj-county-morris-place-harding-township`
 * reads "Harding Township, Morris County". Only the key's own parts, in their
 * own order; an unrecognised key is its segments as words.
 */
export function placeWords(key: string): string {
  const k = key.replace(/^state-[a-z]{2}-?/, "");
  if (k === "") return "Statewide";
  const county = /^county-([a-z0-9-]+?)(?:-place-([a-z0-9-]+))?$/.exec(k);
  if (county) {
    const c = `${titleCase(county[1].replace(/-/g, " "))} County`;
    return county[2] ? `${titleCase(county[2].replace(/-/g, " "))}, ${c}` : c;
  }
  const district = /^(sldl|sldu|cd)-([0-9a-z]+)$/.exec(k);
  if (district) {
    const kind = district[1] === "sldl" ? "State House district" : district[1] === "sldu" ? "State Senate district" : "Congressional district";
    return `${kind} ${district[2].toUpperCase()}`;
  }
  const place = /^place-([a-z0-9-]+)$/.exec(k);
  if (place) return titleCase(place[1].replace(/-/g, " "));
  return titleCase(k.replace(/-/g, " "));
}

export function topWorkLine(t: TopWorkFacts): string {
  const produced = Object.entries(t.outcomes)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `${n} ${outcomeWords(o).label.toLowerCase()}`)
    .join(", ");
  return (
    `${usd(t.usd)} across ${plural(t.attempts, "attempt")}` +
    (t.refused > 0 ? `, ${t.refused} of them refused and retried` : "") +
    `. Produced: ${produced === "" ? "nothing yet" : produced}.`
  );
}
