import type { Meeting, Provenance } from "../sources/types.ts";
import type { Query } from "./publish.ts";

export const meetingEntityId = (meetingId: string) => `meeting:${meetingId}`;

const MEETING_FACTS_SQL = `SELECT f.entity_id, f.field, f.value, f.quote, f.checked_at, s.url FROM fact f JOIN source_copy s ON s.id = f.source_copy_id
  WHERE f.status = 'live' AND f.entity_id = ANY($1::text[]) AND f.field IN ('title', 'starts_at', 'location', 'agenda_url', 'video_url')`;

const FIELD = { title: "title", starts_at: "startsAt", location: "location", agenda_url: "agendaUrl", video_url: "videoUrl" } as const;

/** Each sitting with its live facts in place of what its partition carried, every one citing its saved page. */
export async function withMeetingFacts(meetings: readonly Meeting[], query: Query | null): Promise<Meeting[]> {
  if (query === null || !meetings.length) return [...meetings];
  const owner = new Map<string, number>();
  meetings.forEach((meeting, index) => { for (const id of [meeting.id, ...meeting.mergedMeetingIds ?? []]) owner.set(meetingEntityId(id), index); });
  const rows = await query(MEETING_FACTS_SQL, [[...owner.keys()]]);
  const out = [...meetings];
  for (const row of rows) {
    const index = owner.get(String(row.entity_id));
    const field = FIELD[String(row.field) as keyof typeof FIELD];
    if (index === undefined || !field) continue;
    const meeting = out[index]!;
    const at = new Date(row.checked_at as string).toISOString();
    const source: Provenance = { sourceUrl: String(row.url), sourceOrg: new URL(String(row.url)).hostname, collectedAt: at, verifiedAt: at, quote: String(row.quote) };
    const value = row.value as unknown;
    const patch: Partial<Meeting> = field === "startsAt" ? { startsAt: (value as { startsAt: string }).startsAt }
      : field === "location" ? (meeting.location ? { location: { ...meeting.location, ...(value as { name: string; address: string | null }) } } : {})
      : { [field]: value as string };
    out[index] = { ...meeting, ...patch, fieldSources: { ...meeting.fieldSources, [field]: source } };
  }
  return out;
}
