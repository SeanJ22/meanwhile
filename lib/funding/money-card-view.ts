import type { CardSource } from "../officials/card-sources.ts";
import { plainMoney } from "./plain-money.ts";
import { isSmallDonorTotal, smallDonorSentence } from "./small-donors.ts";

/**
 * What the money card shows for the rebuilt record kinds: one short summary and
 * one table. Pure and client-safe; the reader builds these on the server.
 */

/** A live fact of a money record kind, as the store holds it. */
export interface MoneyFactRow {
  readonly entityId: string;
  readonly field: string;
  readonly value: unknown;
  readonly quote: string;
  readonly checkedAt: string;
}

interface Stated { readonly amount: number; readonly line: string }
interface NamedAmount { readonly name: string; readonly amount: number }

export interface CampaignPeriodView {
  readonly key: string;
  readonly filerName: string;
  readonly seat: string | null;
  readonly label: string;
  readonly cycle: number;
  readonly to: string | null;
  readonly publisher: string;
  readonly filingUrl: string;
  readonly checkedAt: string;
  readonly raised: Stated | null;
  readonly spent: Stated | null;
  readonly individual: Stated | null;
  readonly individualSmall: Stated | null;
  /** Donors over $200 in the cycle, by filed name and this period's amount. */
  readonly donors: readonly NamedAmount[];
  /** PACs, committees and organizations, by filed name and amount. */
  readonly committees: readonly NamedAmount[];
}

export interface CampaignMoneyView {
  readonly subjectId: string;
  readonly summary: string;
  readonly periods: readonly CampaignPeriodView[];
  readonly checkedAt: string;
}

export interface FederalAwardView {
  readonly awardId: string;
  readonly title: string;
  readonly amount: number;
  readonly date: string;
  readonly agency: string;
  readonly recipient: string;
  readonly sourceUrl: string;
  readonly line: string;
  readonly checkedAt: string;
}

export interface FederalAwardsView {
  readonly summary: string;
  readonly thisYear: number;
  readonly sinceYear: number;
  readonly agencies: readonly NamedAmount[];
  readonly awards: readonly FederalAwardView[];
  readonly checkedAt: string;
}

/** Awards from this year on count toward "since" totals. */
export const FEDERAL_MONEY_SINCE_YEAR = 2020;
export const FEDERAL_AWARD_ROWS = 50;

const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const num = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const cents = (amount: number) => Math.round(amount * 100);
const latest = (rows: readonly { readonly checkedAt: string }[]) => rows.map(row => row.checkedAt).sort().at(-1) ?? "";

export function campaignMoneyView(subjectId: string, rows: readonly MoneyFactRow[]): CampaignMoneyView | null {
  interface Part { readonly row: MoneyFactRow; readonly value: Record<string, unknown>; readonly amount: number; readonly full: boolean }
  // The reader sends a period's filing details once; its other donor and committee lines come short. Rows with the details come first.
  const parts: Part[] = rows.flatMap(row => {
    const value = row.value, full = record(value) && text(value.filingUrl);
    if (!record(value) || value.v !== 1 || !num(value.amount) || !record(value.filer) || !text(value.filer.id) || !text(value.periodKey) || !Number.isInteger(value.cycle)
      || (full ? !/^https:\/\//.test(String(value.filingUrl)) : value.measure !== "donor" && value.measure !== "pac")) return [];
    return [{ row, value, amount: value.amount, full }];
  }).sort((a, b) => Number(b.full) - Number(a.full));
  // A donor is named by what the cycle's lines add up to, whatever periods they fall in.
  const cycleCents = new Map<string, number>();
  const donorKey = (value: Record<string, unknown>) => `${(value.filer as Record<string, unknown>).id}|${value.cycle}|${value.partyKey}`;
  for (const { value, amount } of parts) if (value.measure === "donor" && text(value.partyKey))
    cycleCents.set(donorKey(value), (cycleCents.get(donorKey(value)) ?? 0) + cents(amount));
  const periods = new Map<string, { -readonly [K in keyof CampaignPeriodView]: CampaignPeriodView[K] } & { donorSums: Map<string, NamedAmount>; committeeSums: Map<string, NamedAmount> }>();
  for (const { row, value, amount, full } of parts) {
    const filer = value.filer as Record<string, unknown>;
    const key = `${filer.id}|${value.periodKey}`;
    let period = periods.get(key);
    if (!period && !full) continue;
    if (!period) {
      period = { key, filerName: String(filer.name ?? ""), seat: text(value.seat) ? value.seat : null, label: text(value.periodLabel) ? value.periodLabel : String(value.periodKey),
        cycle: Number(value.cycle), to: text(value.to) ? value.to : null, publisher: text(value.publisher) ? value.publisher : "", filingUrl: String(value.filingUrl), checkedAt: row.checkedAt,
        raised: null, spent: null, individual: null, individualSmall: null, donors: [], committees: [], donorSums: new Map(), committeeSums: new Map() };
      periods.set(key, period);
    }
    const stated = { amount, line: row.quote };
    const measure = value.measure;
    if (measure === "raised") period.raised = stated;
    else if (measure === "spent") period.spent = stated;
    else if (measure === "individual") period.individual = stated;
    else if (measure === "individual-small") period.individualSmall = stated;
    else if ((measure === "donor" || measure === "pac") && text(value.name) && text(value.partyKey)) {
      const sums = measure === "donor" ? period.donorSums : period.committeeSums;
      if (measure === "donor" && isSmallDonorTotal((cycleCents.get(donorKey(value)) ?? 0) / 100)) continue;
      sums.set(value.partyKey, { name: value.name, amount: (sums.get(value.partyKey)?.amount ?? 0) + amount });
    }
    if (row.checkedAt < period.checkedAt) period.checkedAt = row.checkedAt;
  }
  const byAmount = (a: NamedAmount, b: NamedAmount) => b.amount - a.amount || a.name.localeCompare(b.name);
  const ordered: CampaignPeriodView[] = [...periods.values()]
    .filter(period => period.raised || period.spent || period.individual || period.individualSmall || period.donorSums.size || period.committeeSums.size)
    .map(({ donorSums, committeeSums, ...period }) => ({ ...period, donors: [...donorSums.values()].sort(byAmount), committees: [...committeeSums.values()].sort(byAmount) }))
    .sort((a, b) => b.cycle - a.cycle || (b.to ?? b.key).localeCompare(a.to ?? a.key));
  if (!ordered.length) return null;
  const cycle = ordered[0].cycle, inCycle = ordered.filter(period => period.cycle === cycle);
  const sum = (pick: (period: CampaignPeriodView) => Stated | null) => {
    const stated = inCycle.map(pick).filter((value): value is Stated => value !== null);
    return stated.length ? stated.reduce((n, value) => n + value.amount, 0) : null;
  };
  const raised = sum(period => period.raised), spent = sum(period => period.spent);
  const both = inCycle.filter(period => period.individual && period.individualSmall);
  const individual = both.reduce((n, period) => n + period.individual!.amount, 0), small = both.reduce((n, period) => n + period.individualSmall!.amount, 0);
  const share = both.length ? smallDonorSentence(individual - small, small) : null;
  const money = [raised === null ? null : `raised ${plainMoney(raised)}`, spent === null ? null : `spent ${plainMoney(spent)}`].filter(Boolean);
  const summary = [money.length ? `${money.join(" and ").replace(/^./, letter => letter.toUpperCase())} in the ${cycle} cycle.` : `${inCycle.length} filing${inCycle.length === 1 ? "" : "s"} in the ${cycle} cycle.`, share].filter(Boolean).join(" ");
  return { subjectId, summary, periods: ordered, checkedAt: latest(ordered) };
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/** One filing period as Ask reads it: the stated totals, donors over $200 and committees; no name the card does not show. */
export function campaignPeriodText(period: CampaignPeriodView): string {
  const named = (title: string, rows: readonly NamedAmount[]) => rows.length ? `${title}: ${rows.map(row => `${row.name} ${dollars.format(row.amount)}`).join("; ")}` : null;
  const { individual, individualSmall } = period;
  return [period.filerName, period.label, `${period.cycle} cycle`,
    ...([["Raised", period.raised], ["Spent", period.spent], ["Individual money", individual]] as const).flatMap(([label, stated]) => stated ? [`${label}: ${dollars.format(stated.amount)}`] : []),
    individual && individualSmall ? smallDonorSentence(individual.amount - individualSmall.amount, individualSmall.amount) : null,
    named("Donors over $200", period.donors), named("Committees and organizations", period.committees),
  ].filter(Boolean).join(" · ");
}

export interface AwardYearSum { readonly year: string; readonly agency: string; readonly amount: number }

/** `sums` are the live awards added up by year and agency; `awards` are the newest rows. Neither holds $0 or negative awards. */
export function federalAwardsView(sums: readonly AwardYearSum[], rows: readonly MoneyFactRow[], now: Date): FederalAwardsView | null {
  const awards: FederalAwardView[] = rows.flatMap(row => {
    const value = row.value;
    if (!record(value) || value.v !== 1 || !text(value.awardId) || !text(value.title) || !num(value.amount) || cents(value.amount) <= 0
      || !text(value.date) || !text(value.agency) || !text(value.recipient) || !text(value.sourceUrl) || !/^https:\/\//.test(value.sourceUrl)) return [];
    return [{ awardId: value.awardId, title: value.title, amount: value.amount, date: value.date, agency: value.agency, recipient: value.recipient, sourceUrl: value.sourceUrl, line: row.quote, checkedAt: row.checkedAt }];
  }).sort((a, b) => b.date.localeCompare(a.date) || a.awardId.localeCompare(b.awardId)).slice(0, FEDERAL_AWARD_ROWS);
  const live = sums.filter(row => num(row.amount) && cents(row.amount) > 0 && /^\d{4}$/.test(row.year) && Number(row.year) >= FEDERAL_MONEY_SINCE_YEAR);
  if (!awards.length && !live.length) return null;
  const year = String(now.getUTCFullYear());
  const total = (rows: readonly AwardYearSum[]) => rows.reduce((n, row) => n + row.amount, 0);
  const thisYear = total(live.filter(row => row.year === year)), sinceYear = total(live);
  const byAgency = new Map<string, number>();
  for (const row of live) byAgency.set(row.agency, (byAgency.get(row.agency) ?? 0) + row.amount);
  const agencies = [...byAgency].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name)).slice(0, 3);
  const summary = [`Received ${plainMoney(thisYear)} this year and ${plainMoney(sinceYear)} since ${FEDERAL_MONEY_SINCE_YEAR}.`,
    agencies.length ? `Top agencies: ${agencies.map(agency => `${agency.name} (${plainMoney(agency.amount)})`).join(", ")}.` : null].filter(Boolean).join(" ");
  return { summary, thisYear, sinceYear, agencies, awards, checkedAt: latest(awards) };
}

/** One source per filing, with the exact line behind each total. */
export function campaignMoneySources(view: CampaignMoneyView): CardSource[] {
  return view.periods.map(period => ({
    verbatim: true as const,
    what: [`Campaign filing · ${period.filerName} · ${period.label}`,
      ...([["Raised", period.raised], ["Spent", period.spent], ["Individual money", period.individual], ["From donors giving $200 or less", period.individualSmall]] as const)
        .flatMap(([label, stated]) => stated ? [`${label}: ${stated.line}`] : [])].join("; "),
    provenance: { kind: "OFFICIAL" as const, sourceOrg: period.publisher || period.filerName, sourceUrl: period.filingUrl, collectedAt: period.checkedAt, verifiedAt: period.checkedAt },
    dataAttrs: { "data-campaign-period": period.key },
  }));
}

export function federalAwardSources(view: FederalAwardsView): CardSource[] {
  return view.awards.map(award => ({
    verbatim: true as const,
    what: `${award.title} — ${award.agency}; ${award.line}`,
    provenance: { kind: "OFFICIAL" as const, sourceOrg: "USAspending.gov", sourceUrl: award.sourceUrl, collectedAt: award.checkedAt, verifiedAt: award.checkedAt },
    dataAttrs: { "data-federal-award": award.awardId },
  }));
}
