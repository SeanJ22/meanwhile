import type { Query } from "../facts/publish.ts";
import { readerRecordsWithOwnerChoices } from "../facts/owner-flags.ts";
import { venueResolutionRecordId, type VenueEntry } from "../meetings/venue-cache.ts";

/** Owner decisions are normalization inputs, independently of source observations or provider dates. */
export async function meetingVenueChoiceHash(query: Query | null): Promise<string> {
  if (!query) return "UNAVAILABLE";
  const [row] = await query(`SELECT md5(coalesce(string_agg(jsonb_build_array(reader_id,resolved,owner_values,owner_source_url)::text,
    '|' ORDER BY reader_id,id),'[]')) AS hash FROM owner_flag WHERE reader_family='venue-resolutions' AND resolved IN ('REMOVE','TYPED_VALUE')`);
  if (typeof row?.hash !== "string") throw new Error("MEETING_VENUE_OWNER_INPUT_UNREADABLE");
  return row.hash;
}

/** The selected records receive exactly the same owner decisions as the previous complete curated projection. */
export async function meetingVenueChoices(query: Query, entries: readonly VenueEntry[]): Promise<VenueEntry[]> {
  const records = entries.map(entry => ({ ...entry, id: typeof (entry as VenueEntry & {id?:unknown}).id === "string"
    ? (entry as VenueEntry & {id:string}).id : venueResolutionRecordId(entry) }));
  return (await readerRecordsWithOwnerChoices(query, "venue-resolutions", records)).map(({ id: _id, ...entry }) => entry);
}
