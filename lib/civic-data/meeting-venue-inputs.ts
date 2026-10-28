import type { Query } from "../facts/publish.ts";
import { recordsWithOwnerChoiceRows } from "../facts/owner-flags.ts";
import { venueResolutionRecordId, type VenueEntry } from "../meetings/venue-cache.ts";

/** Match the reader's latest applicable choice, preserving its actual approval id, time and source. */
const choices = `WITH choices AS MATERIALIZED (
  SELECT DISTINCT ON (reader_id) id,reader_id,resolved,owner_values,owner_source_url,resolved_at FROM owner_flag
    WHERE reader_family='venue-resolutions' AND resolved IN ('REMOVE','TYPED_VALUE')
    ORDER BY reader_id,resolved_at DESC,id DESC
), digest AS (SELECT md5(coalesce(string_agg(jsonb_build_array(reader_id,id,resolved,owner_values,owner_source_url,extract(epoch FROM resolved_at))::text,
  '|' ORDER BY reader_id),'[]')) AS hash FROM choices)`;

/** Owner decisions are normalization inputs, independently of source observations or provider dates. */
export async function meetingVenueChoiceHash(query: Query | null): Promise<string> {
  if (!query) return "UNAVAILABLE";
  const [row] = await query(`${choices} SELECT hash FROM digest`);
  if (typeof row?.hash !== "string") throw new Error("MEETING_VENUE_OWNER_INPUT_UNREADABLE");
  return row.hash;
}

/** Selected canonical choices and their input digest come from one database snapshot. */
export async function meetingVenueChoices(query: Query, entries: readonly VenueEntry[], expectedDigest: string): Promise<VenueEntry[]> {
  const records = entries.map(entry => ({ ...entry, id: typeof (entry as VenueEntry & {id?:unknown}).id === "string"
    ? (entry as VenueEntry & {id:string}).id : venueResolutionRecordId(entry) }));
  const [row] = await query(`${choices} SELECT d.hash,coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.reader_id)
    FROM choices c WHERE c.reader_id=ANY($1::text[])),'[]'::jsonb) AS choices FROM digest d`, [records.map(record => record.id)]);
  if (typeof row?.hash !== "string" || !Array.isArray(row.choices)) throw new Error("MEETING_VENUE_OWNER_INPUT_UNREADABLE");
  if (row.hash !== expectedDigest) throw new Error("MEETING_VENUE_OWNER_INPUT_CHANGED: continue with the current canonical owner decisions");
  return recordsWithOwnerChoiceRows(records, row.choices).map(({ id: _id, ...entry }) => entry);
}
