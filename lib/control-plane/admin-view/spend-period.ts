/** A period with no priced rows has no figure (null), never zero. PURE; client-safe. */
import { easternDay, periodDays } from "./periods.ts";

export interface SpendByDay { readonly day: string; readonly searchUsd?: number; readonly byModel: readonly { readonly name: string; readonly usd: number }[] }
export interface SpendByMonth { readonly month: string; readonly searchUsd?: number; readonly byTier: readonly { readonly name: string; readonly usd: number }[] }
export interface NeonDays { readonly kind: "recorded" | "not-recorded"; readonly days: readonly { readonly day: string; readonly responseBytes: number; readonly requestBytes: number }[] }
export interface TierLine { readonly name: string; readonly usd: number }

const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/;

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

export interface MoneySummary {
  readonly spentUsd: number | null;
  readonly searchUsd: number | null;
  readonly tiers: readonly TierLine[] | null;
  readonly setAsideUsd: number | null;
  readonly neonBytes: number | null;
  /** Today's settled paid-AI charges. Never more than `spentUsd` when the period includes today. */
  readonly todaySettledUsd: number | null;
  readonly todayUsd: number | null;
  readonly dailyLimitUsd: number | null;
  /** The daily limit minus today's spend; the per-hunt limits are never summed into this. */
  readonly leftUsd: number | null;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function moneySummary(input: {
  readonly spend: { readonly byDay: readonly SpendByDay[]; readonly byMonth: readonly SpendByMonth[]; readonly neon?: NeonDays } | null;
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
    tiers: tiers !== null && tiers.length > 0 ? tiers : null, setAsideUsd, neonBytes: spend === null ? null : neonBytesForPeriod(spend.neon, input.period, now), todaySettledUsd, todayUsd, dailyLimitUsd: input.dailyLimitUsd,
    leftUsd: todayUsd === null || input.dailyLimitUsd === null ? null : cents(Math.max(0, input.dailyLimitUsd - todayUsd)),
  };
}

const inDays = (day: string, id: string, now: Date) => { const d = periodDays(id, now); return d !== null && day >= d.from && day <= d.to; };

export function neonBytesForPeriod(neon: NeonDays | undefined, id: string, now: Date): number | null {
  if (neon === undefined || neon.kind !== "recorded") return null;
  const days = neon.days.filter((d) => inDays(d.day, id, now));
  return days.length === 0 ? null : days.reduce((a, d) => a + d.responseBytes + d.requestBytes, 0);
}

export interface DayRow { readonly day: string; readonly spentUsd: number | null; readonly searchUsd: number | null; readonly neonBytes: number | null }

export function dailyRows(spend: { readonly byDay: readonly SpendByDay[]; readonly neon?: NeonDays }, id: string, now: Date): readonly DayRow[] {
  const days = new Set<string>();
  for (const d of spend.byDay) if (inDays(d.day, id, now)) days.add(d.day);
  for (const d of spend.neon?.kind === "recorded" ? spend.neon.days : []) if (inDays(d.day, id, now)) days.add(d.day);
  return [...days].sort().reverse().map((day) => {
    const l = spend.byDay.find((d) => d.day === day);
    const n = spend.neon?.kind === "recorded" ? spend.neon.days.find((d) => d.day === day) : undefined;
    return { day, spentUsd: l === undefined ? null : cents(l.byModel.reduce((a, m) => a + cents(m.usd), 0)), searchUsd: l?.searchUsd === undefined || l.searchUsd <= 0 ? null : cents(l.searchUsd),
      neonBytes: n === undefined ? null : n.responseBytes + n.requestBytes };
  });
}
