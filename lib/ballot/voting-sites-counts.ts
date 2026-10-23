import { neon } from "@neondatabase/serverless";
import { assertWriteAllowed } from "../db/write-guard.ts";

export interface VotingLookupCount { day: string; zip: string; districts: string[] }

/** Accept only coarse geography; this function cannot receive a street or a Google answer. */
export async function recordVotingLookupCount(count: VotingLookupCount, query = async (text: string, params: string[]) => {
  if (!process.env.DATABASE_URL) return;
  assertWriteAllowed("anonymous voting lookup counts");
  await neon(process.env.DATABASE_URL).query(text, params, { fetchOptions: { signal: AbortSignal.timeout(500) } });
}): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(count.day) || count.zip && !/^\d{5}$/.test(count.zip) ||
    count.districts.some(id => !/^ocd-division\/country:us(?:\/[a-z_]+:[a-z0-9_.~-]+)*$/.test(id))) throw new Error("Invalid voting count geography");
  await query(`INSERT INTO reader_event_totals (period, period_start, zip, district, topic, event_type, events, users)
    SELECT 'DAY', $1::date, $2, district, 'Voting locations', 'VOTING_LOOKUP', 1, 0
    FROM jsonb_array_elements_text($3::jsonb) AS district
    ON CONFLICT (period, period_start, zip, district, topic, event_type) DO UPDATE
    SET events = reader_event_totals.events + 1`, [count.day, count.zip, JSON.stringify([...new Set(count.districts.length ? count.districts : [""])].sort())]);
}
