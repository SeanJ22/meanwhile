import type { Meeting, Provenance } from "../sources/types.ts";
import type { Query } from "./publish.ts";

export const meetingEntityId = (meetingId: string) => `meeting:${meetingId}`;

const SITTING_FACTS_SQL = `SELECT m.parent_id AS body_id, m.id AS entity_id, f.field, f.value, f.quote, f.checked_at,
  (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url
  FROM entity m JOIN fact f ON f.entity_id = m.id
  WHERE m.parent_id = ANY($1::text[]) AND m.kind = 'meeting' AND f.status = 'live'`;

const FIELD = { title: "title", starts_at: "startsAt", location: "location", agenda_url: "agendaUrl", video_url: "videoUrl" } as const;

function publishedLocation(meeting: Meeting, value: unknown, source: Provenance): Partial<Meeting> {
  if (meeting.online) return {};
  const location = value as { name: string; address: string | null; lat?: number; lng?: number };
  if (Number.isFinite(location.lat) && Number.isFinite(location.lng)) return { location:location as Meeting["location"],venueGap:undefined };
  if (meeting.location && (location.address && meeting.location.address === location.address
    || !location.address && meeting.location.name === location.name))
    return { location:{...meeting.location,...location,address:location.address ?? meeting.location.address} };
  return { location:null,venueGap: { kind:"STATED_NOT_PLACED",publishedText:location.address || location.name,publisher:source.sourceOrg } };
}

/** One live fact about a sitting, citing the saved page it was found on. */
export interface SittingFact {
  readonly meetingId: string;
  readonly field: (typeof FIELD)[keyof typeof FIELD];
  readonly value: unknown;
  readonly source: Provenance;
}

/** The live facts of each given body's sittings, by body. */
export async function readSittingFacts(query: Query, bodyIds: readonly string[]): Promise<Map<string, SittingFact[]>> {
  return sittingFactsFromRows(bodyIds.length ? await query(SITTING_FACTS_SQL, [bodyIds]) : []);
}

/** Sitting facts from already selected rows, grouped by their body. */
export function sittingFactsFromRows(rows: readonly Record<string, unknown>[]): Map<string, SittingFact[]> {
  const byBody = new Map<string, SittingFact[]>();
  for (const row of rows) {
    const field = FIELD[String(row.field) as keyof typeof FIELD];
    if (!field) continue;
    const at = new Date(row.checked_at as string).toISOString();
    const fact: SittingFact = { meetingId: String(row.entity_id).slice("meeting:".length), field, value: row.value,
      source: { sourceUrl: String(row.url), sourceOrg: new URL(String(row.url)).hostname, collectedAt: at, verifiedAt: at, quote: String(row.quote) } };
    const held = byBody.get(String(row.body_id));
    if (held) held.push(fact);
    else byBody.set(String(row.body_id), [fact]);
  }
  return byBody;
}

/** Each sitting with its live facts in place of what its partition carried, every one citing its saved page. */
export function withSittingFacts(meetings: readonly Meeting[], facts: readonly SittingFact[]): Meeting[] {
  const out = [...meetings];
  if (!facts.length) return out;
  const owner = new Map<string, number>();
  meetings.forEach((meeting, index) => { for (const id of [meeting.id, ...meeting.mergedMeetingIds ?? []]) owner.set(id, index); });
  for (const { meetingId, field, value, source } of facts) {
    const index = owner.get(meetingId);
    if (index === undefined) continue;
    const meeting = out[index]!;
    const patch: Partial<Meeting> = field === "startsAt" ? { startsAt: (value as { startsAt: string }).startsAt }
      : field === "location" ? publishedLocation(meeting,value,source)
      : { [field]: value as string };
    out[index] = { ...meeting, ...patch, fieldSources: { ...meeting.fieldSources, [field]: source } };
  }
  return out;
}
