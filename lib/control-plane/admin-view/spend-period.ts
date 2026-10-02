/**
 * **PAID AI SPEND BY MODEL TIER FOR ONE PERIOD.** From the cost ledger's daily and monthly aggregates (`v6-spend-read.ts`), cut to
 * the period Admin's picker holds: Today, Last 7 days and Last 30 days are summed from the Eastern days, a month is that month's own
 * line. A period with no priced rows has no figure (null), never zero. PURE; client-safe.
 */
import { easternDay, periodDays } from "./periods.ts";

export interface SpendByDay { readonly day: string; readonly searchUsd?: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[] }
export interface SpendByMonth { readonly month: string; readonly searchUsd?: number; readonly byTier: readonly { readonly name: string; readonly usd: number }[] }
export interface TierLine { readonly name: string; readonly usd: number }

const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/;

/** The tiers' spend for the period, biggest first, or null when the ledger holds no priced charge in it. */
export function tierSpendForPeriod(spend: { readonly byDay: readonly SpendByDay[]; readonly byMonth: readonly SpendByMonth[] }, id: string, now: Date): readonly TierLine[] | null {
  const lines = new Map<string, number>();
  if (MONTH.test(id)) {
    const month = spend.byMonth.find((m) => m.month === id);
    for (const t of month?.byTier ?? []) lines.set(t.name, (lines.get(t.name) ?? 0) + t.usd);
  } else {
    const days = periodDays(id, now);
    if (days === null) return null;
    for (const d of spend.byDay) if (d.day >= days.from && d.day <= days.to) for (const m of d.byModel) lines.set(m.name, (lines.get(m.name) ?? 0) + m.usd);
  }
  const out = [...lines].map(([name, usd]) => ({ name, usd: Math.round(usd * 10_000) / 10_000 })).filter((l) => l.usd > 0).sort((a, b) => b.usd - a.usd || a.name.localeCompare(b.name));
  return out.length === 0 ? null : out;
}

/** Search spend (discovery search, apart from model money) for the period, or null when the ledger holds none in it. */
export function searchSpendForPeriod(spend: { readonly byDay: readonly SpendByDay[]; readonly byMonth: readonly SpendByMonth[] }, id: string, now: Date): number | null {
  let usd = 0;
  if (MONTH.test(id)) usd = spend.byMonth.find((m) => m.month === id)?.searchUsd ?? 0;
  else {
    const days = periodDays(id, now);
    if (days === null) return null;
    for (const d of spend.byDay) if (d.day >= days.from && d.day <= days.to) usd += d.searchUsd ?? 0;
  }
  return usd > 0 ? Math.round(usd * 10_000) / 10_000 : null;
}

/** What the Money summary says. Every figure comes from the one ledger read, with one definition each (Sean, 5:55 PM MST, October 1, 2026). */
export interface MoneySummary {
  /** Settled paid-AI charges in the period: exactly the sum of `tiers`. Null when the period holds none. */
  readonly spentUsd: number | null;
  /** Settled search charges in the period. */
  readonly searchUsd: number | null;
  readonly tiers: readonly TierLine[] | null;
  /** Open reservations right now, over every hunt. */
  readonly setAsideUsd: number | null;
  /** Today's settled paid-AI charges. Never more than `spentUsd` when the period includes today. */
  readonly todaySettledUsd: number | null;
  /** Today's settled charges plus what is set aside, against the daily limit. */
  readonly todayUsd: number | null;
  readonly dailyLimitUsd: number | null;
  /** The daily limit minus today's spend; the per-hunt limits are never summed into this. */
  readonly leftUsd: number | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function moneySummary(input: {
  readonly spend: { readonly byDay: readonly SpendByDay[]; readonly byMonth: readonly SpendByMonth[] } | null;
  /** Open reservations right now over every hunt, or null when not read. */
  readonly setAsideUsd: number | null;
  readonly dailyLimitUsd: number | null;
  readonly period: string;
  readonly now: Date;
}): MoneySummary {
  const { spend, now } = input;
  // Whole cents, the way every figure is shown, so the tiers on screen add up to Spent on screen.
  const lines = spend === null ? null : tierSpendForPeriod(spend, input.period, now);
  const tiers = lines === null ? null : lines.map((t) => ({ name: t.name, usd: cents(t.usd) })).filter((t) => t.usd > 0);
  const setAsideUsd = input.setAsideUsd === null ? null : cents(input.setAsideUsd);
  const today = spend === null ? null : spend.byDay.find((d) => d.day === easternDay(now));
  const todaySettledUsd = spend === null ? null : cents((today?.byModel ?? []).reduce((a, m) => a + cents(m.usd), 0));
  const todayUsd = todaySettledUsd === null || setAsideUsd === null ? null : cents(todaySettledUsd + setAsideUsd);
  return {
    spentUsd: tiers === null || tiers.length === 0 ? null : cents(tiers.reduce((a, t) => a + t.usd, 0)),
    searchUsd: spend === null ? null : searchSpendForPeriod(spend, input.period, now),
    tiers: tiers !== null && tiers.length > 0 ? tiers : null, setAsideUsd, todaySettledUsd, todayUsd, dailyLimitUsd: input.dailyLimitUsd,
    leftUsd: todayUsd === null || input.dailyLimitUsd === null ? null : cents(Math.max(0, input.dailyLimitUsd - todayUsd)),
  };
}
