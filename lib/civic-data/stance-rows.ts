/**
 * **THE STANCES DOOR'S ROW (CA-11).**
 *
 * A stance is one exact quote a person said, its date, and its topic. It is
 * published only when the quote has already been proven character for
 * character on the saved page (`quotedSourceFindings`), so everything here is
 * the part that proof cannot say: whose words they are, whether this page may
 * speak for that person, and whether the topic and date are ones we show.
 *
 * - A campaign page counts only for its own candidate. A page we cannot tie to
 *   that person's own verified site is never filed under a campaign-site label.
 * - A paraphrase is a judgment call and needs a second, independent source. The
 *   door publishes quotes only, so a summary field is refused here, never
 *   quietly kept.
 * - The topic is one of the ten topics, read from the setting, never a word the
 *   page happens to use.
 *
 * Pure: the caller supplies the topic ids and the person's own site hosts.
 */
import { createHash } from "node:crypto";
import { SOURCE_KINDS } from "../corpus/source-kinds.ts";
import { requirePublication } from "./worker-publication-evidence.ts";
import type { FieldValue } from "../control-plane/workers/types.ts";

export const STANCE_FIELDS = ["personId", "personName", "quote", "date", "topicId", "sourceKind"] as const;
export const MAX_STANCE_QUOTE_CHARS = 600;

export type StanceRow = {
  readonly id: string;
  readonly personId: string;
  readonly personName: string | null;
  readonly topicId: string;
  readonly quote: string;
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

/** One verified record's fields to the row readers show. Throws a coded refusal when the page cannot speak for the person. */
export function stanceRowFrom(input: {
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly pageUrl: string; readonly collectedAt: string; readonly now: string;
  readonly topicIds: readonly string[];
  /** The hosts of the person's own verified campaign or official sites. */
  readonly ownSiteHosts: (personId: string) => readonly string[];
}): StanceRow {
  const f = input.fields;
  requirePublication(Object.keys(f).every(field => (STANCE_FIELDS as readonly string[]).includes(field)),
    Object.keys(f).some(field => ["statementSummary", "positionSummary"].includes(field)) ? "STANCE_PARAPHRASE_NEEDS_SECOND_SOURCE" : "STANCE_FIELD_UNSUPPORTED");
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
  return { id: stanceId(personId, topicId, quote), personId, personName: text(f.personName) || null, topicId, quote, date, sourceKind,
    sourceUrl: input.pageUrl, collectedAt: input.collectedAt, verifiedAt: input.now };
}

/** The shape check the projection applies to every stored row. */
export function stanceRowIssue(row: Readonly<Record<string, unknown>>): string | null {
  const s = (v: unknown) => typeof v === "string" ? v : "";
  const bad = !s(row.personId) || !s(row.topicId) || !s(row.quote) || s(row.quote).length > MAX_STANCE_QUOTE_CHARS ||
    !isoDay(s(row.date)) || !SOURCE_KINDS.some(k => k.kind === s(row.sourceKind)) || !/^https:\/\//.test(s(row.sourceUrl)) ||
    !Number.isFinite(Date.parse(s(row.collectedAt))) || s(row.id) !== stanceId(s(row.personId), s(row.topicId), s(row.quote));
  return bad ? `${s(row.id)} lacks its exact person, topic, quote, date, source kind or HTTPS source.` : null;
}
