import { createHash } from "node:crypto";
import type { Query } from "../../lib/facts/publish.ts";
import type { Meeting } from "../../lib/sources/types.ts";

type Row = Record<string, unknown>;

/** The live facts one sitting holds on the fact store, as its calendar page would have given them. */
export function meetingFactFields(meeting: Meeting): [field: string, value: unknown][] {
  const location = meeting.location ?? (meeting.venueGap?.publishedText ? { name: meeting.venueGap.publishedText, address: null } : null);
  return [
    ["title", meeting.title],
    ["starts_at", { startsAt: meeting.startsAt, timeZone: meeting.timeZone, precision: meeting.startPrecision ?? "MINUTE" }],
    ...(location ? [["location", location] as [string, unknown]] : []),
    ...(meeting.mapPin ? [["map_pin", meeting.mapPin] as [string, unknown]] : []),
    ...(meeting.online ? [["online_access", meeting.online] as [string, unknown]] : []),
    ...(meeting.agendaUrl ? [["agenda_url", meeting.agendaUrl] as [string, unknown]] : []),
    ...(meeting.videoUrl ? [["video_url", meeting.videoUrl] as [string, unknown]] : []),
    ...(meeting.status === "CANCELED" ? [["status", "CANCELED"] as [string, unknown]] : []),
  ];
}

/** Sitting rows as the place read returns them, for a test that builds a raw page row by hand. */
export function sittingRows(meetings: readonly Meeting[]): Row[] {
  return meetings.flatMap(meeting => meeting.bodyId ? meetingFactFields(meeting).map(([field, value]) => ({
    body_id: meeting.bodyId, body_name: meeting.bodyName, entity_id: `meeting:${meeting.id}`, field, value, quote: "Saved official page",
    checked_at: meeting.provenance.collectedAt, status: "live", url: meeting.provenance.sourceUrl ?? "https://example.gov/calendar" })) : []);
}

/** Sittings published on a fact store: a meeting entity under its body, a saved page, and each live fact found on that page. */
export async function insertMeetingFacts(query: Query, meetings: readonly Meeting[], state = "AZ"): Promise<void> {
  for (const meeting of meetings) {
    if (!meeting.bodyId) continue;
    const url = meeting.provenance.sourceUrl ?? "https://example.gov/calendar";
    const [held] = await query("SELECT id FROM source_copy WHERE url=$1 ORDER BY id LIMIT 1", [url]);
    const [copy] = held ? [held] : await query(`INSERT INTO source_copy(url,final_url,fetched_at,sha256,blob_key) VALUES($1,$1,$2,$3,$4) RETURNING id`,
      [url, meeting.provenance.collectedAt, createHash("sha256").update(url).digest("hex"), `fixture:${url}`]);
    await query("INSERT INTO entity(id,kind,name,state,parent_id) VALUES($1,'meeting',$2,$3,$4) ON CONFLICT DO NOTHING",
      [`meeting:${meeting.id}`, meeting.bodyName, state, meeting.bodyId]);
    for (const [field, value] of meetingFactFields(meeting)) {
      await query(`INSERT INTO fact(entity_id,field,value,value_text,status,provenance_kind,source_copy_id,quote,checked_at,produced_by)
        VALUES($1,$2,$3,'saved','live','OFFICIAL',$4,'Saved official page',$5,'fixture')`,
      [`meeting:${meeting.id}`, field, JSON.stringify(value), copy!.id, meeting.provenance.collectedAt]);
    }
  }
}
