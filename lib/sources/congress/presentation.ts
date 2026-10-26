import labels from "../../../data/reference/us-jurisdiction-labels.json" with { type: "json" };
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

const jurisdictionNames = new Map(labels.jurisdictions.map(state => [state.postal, state.name]));

/** Browser-safe presentation of facts already read through the promoted source store. */
export function federalCardSources(records: readonly FederalFact[]): CardSource[] {
  return records.flatMap(row => [{ what: row.kind === "LOBBYING_CONTRIBUTION" ? "Campaign contributions reported by lobbyists" : row.title, publishedAt: row.publishedAt,
    provenance: { sourceUrl: row.sourceUrl, sourceOrg: row.publisher, collectedAt: row.checkedAt, verifiedAt: row.checkedAt } },
    ...(row.honoreeJoin?.status === "JOINED" ? [{ what: `The person named in this record, ${row.honoreeName}, is ${row.honoreeJoin.matchedName}, who serves in the ${row.honoreeJoin.chamber === "senate" ? "U.S. Senate" : "U.S. House of Representatives"} for ${jurisdictionNames.get(row.honoreeJoin.state) ?? row.honoreeJoin.state}`,
      provenance: { sourceUrl: row.honoreeJoin.sourceUrl, sourceOrg: row.honoreeJoin.sourceOrg, collectedAt: row.honoreeJoin.checkedAt, verifiedAt: row.honoreeJoin.checkedAt } }] : [])]);
}
