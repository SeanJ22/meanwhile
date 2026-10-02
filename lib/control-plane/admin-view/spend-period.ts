/**
 * **PAID AI SPEND BY MODEL TIER FOR ONE PERIOD.** From the cost ledger's daily and monthly aggregates (`v6-spend-read.ts`), cut to
 * the period Admin's picker holds: Today, Last 7 days and Last 30 days are summed from the Eastern days, a month is that month's own
 * line. A period with no priced rows has no figure (null), never zero. PURE; client-safe.
 */
import { periodDays } from "./periods.ts";

export interface SpendByDay { readonly day: string; readonly byModel: readonly { readonly name: string; readonly usd: number }[] }
export interface SpendByMonth { readonly month: string; readonly byTier: readonly { readonly name: string; readonly usd: number }[] }
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
