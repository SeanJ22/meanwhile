import { lookupCivicAddress, recordCivicReaderOutcome, type CivicReadOptions } from "./acquisition.ts";
import { divisionsByOcdIds } from "../../registry/server.ts";

export async function readerCivicLookup(address: string, options: CivicReadOptions = {}) {
  const lookup = await lookupCivicAddress(address, new Set(), { signal: AbortSignal.timeout(2500), ...options });
  const ids = [...new Set(lookup.rows.flatMap(row => row.ocdId ? [row.ocdId] : []))];
  const matches = ids.length ? await divisionsByOcdIds(ids).catch(() => []) : [];
  const held = new Set(matches.map(row => row.ocdId));
  lookup.rows = lookup.rows.map(row => ({ ...row, joinedDivisionId: row.ocdId && held.has(row.ocdId) ? row.ocdId : null }));
  lookup.counts.joined = lookup.rows.filter(row => row.joinedDivisionId !== null).length;
  lookup.counts.unjoined = lookup.counts.loaded - lookup.counts.joined;
  return lookup;
}
export { recordCivicReaderOutcome };
