/** The quote is already proven on the saved page; this decides whose words they are, whether the page may speak for that person, and the topic and date. */
import { createHash } from "node:crypto";
import { SOURCE_KINDS } from "../corpus/source-kinds.ts";
import { requirePublication } from "./worker-publication-evidence.ts";
import type { FieldValue } from "../control-plane/workers/types.ts";

export const STANCE_FIELDS = ["personId", "personName", "quote", "date", "topicId", "sourceKind", "statementSummary", "positionSummary"] as const;
export const MAX_STANCE_QUOTE_CHARS = 600;

export type StanceRow = {
  readonly id: string;
  readonly personId: string;
  readonly personName: string | null;
  readonly topicId: string;
  readonly quote: string;
  /** The AI's summary of the quote; Sources links the statement it summarizes (`sourceUrl`). */
  readonly summary: string | null;
  /** The day it was said (YYYY-MM-DD), as the page states it. */
  readonly date: string;
  readonly sourceKind: string;
  readonly sourceUrl: string;
  readonly collectedAt: string;
  readonly verifiedAt: string;
};

const text = (value: FieldValue | undefined) => typeof value === "string" ? value.trim() : "";
const hostOf = (url: string): string | null => { try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ""); } catch { return null; } };
const isoDay = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export function stanceId(personId: string, topicId: string, quote: string): string {
  return `stance:${createHash("sha256").update(JSON.stringify([personId, topicId, quote.replace(/\s+/g, " ")])).digest("hex").slice(0, 24)}`;
}

export function stanceRowFrom(input: {
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly pageUrl: string; readonly collectedAt: string; readonly now: string;
  readonly topicIds: readonly string[];
  readonly ownSiteHosts: (personId: string) => readonly string[];
}): StanceRow {
  const f = input.fields;
  requirePublication(Object.keys(f).every(field => (STANCE_FIELDS as readonly string[]).includes(field)), "STANCE_FIELD_UNSUPPORTED");
  const personId = text(f.personId), quote = text(f.quote), date = text(f.date), topicId = text(f.topicId), sourceKind = text(f.sourceKind);
  requirePublication(personId && quote && quote.length <= MAX_STANCE_QUOTE_CHARS, "STANCE_QUOTE_INVALID");
  requirePublication(isoDay(date) && date <= input.now.slice(0, 10), "STANCE_DATE_INVALID");
  requirePublication(input.topicIds.includes(topicId), "STANCE_TOPIC_UNKNOWN");
  requirePublication(SOURCE_KINDS.some(k => k.kind === sourceKind), "STANCE_SOURCE_KIND_UNKNOWN");
  requirePublication(/^https:\/\//.test(input.pageUrl), "STANCE_SOURCE_NOT_HTTPS");
  if (sourceKind === "CAMPAIGN_SITE") {
    const host = hostOf(input.pageUrl);
    requirePublication(host !== null && input.ownSiteHosts(personId).some(own => own === host), "STANCE_CAMPAIGN_PAGE_NOT_OWN");
  }
  return { id: stanceId(personId, topicId, quote), personId, personName: text(f.personName) || null, topicId, quote,
    summary: text(f.statementSummary) || text(f.positionSummary) || null, date, sourceKind,
    sourceUrl: input.pageUrl, collectedAt: input.collectedAt, verifiedAt: input.now };
}

export function stanceRowIssue(row: Readonly<Record<string, unknown>>): string | null {
  const s = (v: unknown) => typeof v === "string" ? v : "";
  const bad = !s(row.personId) || !s(row.topicId) || !s(row.quote) || s(row.quote).length > MAX_STANCE_QUOTE_CHARS ||
    !isoDay(s(row.date)) || !SOURCE_KINDS.some(k => k.kind === s(row.sourceKind)) || !/^https:\/\//.test(s(row.sourceUrl)) ||
    !Number.isFinite(Date.parse(s(row.collectedAt))) || s(row.id) !== stanceId(s(row.personId), s(row.topicId), s(row.quote));
  return bad ? `${s(row.id)} lacks its exact person, topic, quote, date, source kind or HTTPS source.` : null;
}
