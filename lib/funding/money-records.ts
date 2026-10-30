import { createHash } from "node:crypto";
import { boundedIndexOf, normalizeText, type SavedCopy } from "../facts/check.ts";
import type { DoorInput } from "../core/door.ts";

/**
 * The money record kinds the Slide accepts. Every fact is one number shown by
 * one exact line of a saved filing or API response: `quote` is that line and
 * `valueText` is the number as the line writes it. Nothing here is a sum.
 *
 * Campaign: one fact per stated total, donor line or PAC line of a filing
 * period, filed to the person (or committee) who holds or runs for the seat.
 * Federal: one fact per award, filed to the government or body that received it.
 */

export type CampaignMeasure = "raised" | "spent" | "individual" | "individual-small";

/** One number and the exact filing text that shows it. */
export interface FiledAmount {
  readonly amount: number;
  /** The number as the line writes it, for example "$1,234.50". */
  readonly amountText: string;
  /** The filing's own line (a CSV row, a report line, a field of the saved response). */
  readonly line: string;
}

export interface FilerIdentity {
  readonly id: string;
  readonly name: string;
  readonly candidateName: string | null;
  /** The office as filed. */
  readonly office: string | null;
  readonly district: string | null;
  readonly jurisdiction: string | null;
}

export interface FilingPeriod {
  /** Stable for the period across amended filings, without ":". */
  readonly key: string;
  /** As filed, for example "Apr 1 – Jun 30, 2026". */
  readonly label: string;
  readonly from: string | null;
  readonly to: string | null;
  readonly cycle: number;
}

/** A named line: a donor over $200 in the cycle, or a PAC or committee. */
export interface NamedLine {
  readonly partyKey: string;
  readonly name: string;
  readonly kind: "individual" | "organization";
  readonly lineId: string;
  readonly amount: FiledAmount;
}

export interface CampaignPeriodRecord {
  readonly filer: FilerIdentity;
  readonly period: FilingPeriod;
  readonly filingUrl: string;
  /** The agency that published the filing, for example "Kentucky Registry of Election Finance". */
  readonly publisher: string;
  readonly raised: FiledAmount | null;
  readonly spent: FiledAmount | null;
  readonly individual: FiledAmount | null;
  /** The filing's own line for money from donors giving $200 or less. */
  readonly individualSmall: FiledAmount | null;
  readonly donors: readonly NamedLine[];
  readonly committees: readonly NamedLine[];
}

export interface FederalAward {
  readonly awardId: string;
  readonly title: string;
  /** The award's stated total, modifications already rolled in by the source. */
  readonly total: FiledAmount;
  readonly date: string;
  readonly agency: string;
  readonly recipientName: string;
  readonly sourceUrl: string;
}

/** What goes through the Slide: one number, one line. */
export interface MoneyClaim {
  readonly subjectId: string;
  readonly field: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly valueText: string;
  readonly quote: string;
  /** Where the line was read; it is the saved copy's address. */
  readonly sourceUrl: string;
}

export const CAMPAIGN_FIELD_PREFIX = "money-campaign:";
export const FEDERAL_FIELD_PREFIX = "money-federal:";
export const MONEY_VALUE_VERSION = 1;

const cents = (amount: number) => Math.round(amount * 100);

export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  const negative = /^\(.*\)$/.test(trimmed) || /^-|-$/.test(trimmed);
  const digits = trimmed.replace(/[$,()\s-]/g, "");
  if (!/^\d+(?:\.\d+)?$/.test(digits)) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? negative ? -value : value : null;
}

/** A number with the line that shows it; null when the line does not carry the number. */
export function filedAmount(line: string, amountText: string): FiledAmount | null {
  const amount = parseAmount(amountText);
  if (amount === null || !line.trim() || boundedIndexOf(normalizeText(line), normalizeText(amountText)) === -1) return null;
  return { amount, amountText, line };
}

const short = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 16);
const slug = (value: string) => value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80);

export const campaignFieldKey = (filerId: string, periodKey: string) => `${CAMPAIGN_FIELD_PREFIX}${slug(filerId)}:${slug(periodKey)}:`;

export function campaignClaims(subjectId: string, record: CampaignPeriodRecord): readonly MoneyClaim[] {
  const base = {
    v: MONEY_VALUE_VERSION, filer: { id: record.filer.id, name: record.filer.name }, seat: record.filer.office,
    periodKey: record.period.key, periodLabel: record.period.label, from: record.period.from, to: record.period.to,
    cycle: record.period.cycle, filingUrl: record.filingUrl, publisher: record.publisher,
  };
  const claim = (suffix: string, measure: string, filed: FiledAmount, extra: Record<string, unknown> = {}): MoneyClaim => ({
    subjectId, field: campaignFieldKey(record.filer.id, record.period.key) + suffix, valueText: filed.amountText, quote: filed.line,
    sourceUrl: record.filingUrl, value: { ...base, measure, amount: filed.amount, ...extra },
  });
  const totals: readonly [CampaignMeasure, FiledAmount | null][] = [["raised", record.raised], ["spent", record.spent],
    ["individual", record.individual], ["individual-small", record.individualSmall]];
  return [
    ...totals.flatMap(([measure, filed]) => filed ? [claim(measure, measure, filed)] : []),
    ...record.donors.map(line => claim(`donor:${short(`${line.partyKey}\0${line.lineId}`)}`, "donor", line.amount, { name: line.name, partyKey: short(line.partyKey) })),
    ...record.committees.map(line => claim(`pac:${short(`${line.partyKey}\0${line.lineId}`)}`, "pac", line.amount, { name: line.name, partyKey: short(line.partyKey) })),
  ];
}

/** $0 and negative-only awards are never published. */
export function federalAwardClaim(subjectId: string, award: FederalAward): MoneyClaim | null {
  if (!(cents(award.total.amount) > 0)) return null;
  return {
    subjectId, field: `${FEDERAL_FIELD_PREFIX}${slug(award.awardId)}`, valueText: award.total.amountText, quote: award.total.line, sourceUrl: award.sourceUrl,
    value: { v: MONEY_VALUE_VERSION, awardId: award.awardId, title: award.title, amount: award.total.amount, date: award.date,
      agency: award.agency, recipient: award.recipientName, sourceUrl: award.sourceUrl },
  };
}

/** The Slide's input for a claim: a loader's filing line, checked against the saved copy. */
export function moneyDoorInput(claim: MoneyClaim, copy: SavedCopy, producedBy: string): DoorInput {
  return { subjectId: claim.subjectId, field: claim.field, value: claim.value, valueText: claim.valueText, quote: claim.quote,
    fieldKind: "money", provenance: "FILING", copy, producedBy, costUsd: 0, acquisition: "loader" };
}
