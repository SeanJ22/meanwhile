import type { CardSource } from "../../officials/card-sources.ts";
import type { FederalFact } from "./types.ts";

/** Regulations.gov returns closing instants in UTC; its displayed agency dates are Eastern. */
export function federalCalendarDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const part = (type: string) => parts.find(part => part.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export const federalDeadlineDate = (row: FederalFact): string | null => row.closesAt ? federalCalendarDate(row.closesAt) : null;

/** Browser-safe presentation of facts already read through the promoted source store. */
export function federalCardSources(records: readonly FederalFact[]): CardSource[] {
  return records.map(row => ({ what: `${row.title}${row.publishedAt ? ` · Published ${row.publishedAt.slice(0, 10)}` : " · Publication date not supplied"}`,
    provenance: { sourceUrl: row.sourceUrl, sourceOrg: row.publisher, collectedAt: row.checkedAt, verifiedAt: row.checkedAt,
      ...(row.source === "senate-lda" ? { quote: "Senate Office of Public Records cannot vouch for the data or analyses derived from these data after the data have been retrieved from LDA.gov." } : {}) } }));
}
