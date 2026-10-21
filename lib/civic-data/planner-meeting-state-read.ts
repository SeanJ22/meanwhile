import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { readPlacePackage } from "../reader/place.ts";
import { readReaderMeetingSettings } from "../meetings/reader-settings.ts";
import { snapshotCounts } from "../meetings/snapshot.ts";
import { readPlannerMeetingArchives, plannerCurrentMeetingSql } from "./planner-archive-state-read.ts";
import type { StateMeetingBody } from "../meetings/edge-serving.ts";

/** Reuse the canonical merge, history, cancellation and fact-overlay rules.
 * Selecting only the meeting columns lets Postgres discard reader-only joins
 * (people, money, geography, inventories and routing) before doing their work. */
export async function* readPlannerMeetingBodies(state: string, query: ReadOnlyQuery, now: string): AsyncGenerator<StateMeetingBody> {
  if (!/^[a-z]{2}$/i.test(state)) throw new Error(`PLANNER_MEETING_STATE_INVALID:${state}`);
  const [[bodies], settings] = await Promise.all([
    query([{ text: `SELECT id FROM entity WHERE state=$1 AND kind='body'
      UNION SELECT reader_payload_node(b.item)->>'id' AS id FROM civic_data_promotions p,
        LATERAL reader_payload_members(reader_payload_node(reader_payload_node(p.payload)->'registry')->'bodies') b
        WHERE p.key='REGISTRY_RUNTIME_BINDING:US-'||$1||':reader-registry-runtime'
          AND p.record_class='REGISTRY_RUNTIME_BINDING' ORDER BY id`, params: [state.toUpperCase()] }]),
    readReaderMeetingSettings(),
  ]);
  let archives: ReturnType<typeof readPlannerMeetingArchives> | undefined;
  for (let first = 0; first < bodies.length; first += 16) {
    const held = await readPlacePackage({ state, divisionIds: [], bodyIds: bodies.slice(first, first + 16).map(body => String(body.id)),
      includeHistory: true, includeAgenda: true }, async (text, params) => {
      const [archive, [current]] = await Promise.all([archives ??= readPlannerMeetingArchives(text,
        [...params!.slice(0, 2), bodies.map(body => String(body.id)), ...params!.slice(3)], query),
        query([{ text: `WITH RECURSIVE planner_input AS MATERIALIZED (
        SELECT entities,sittings,meeting_rows,archived_meetings,archived_documents FROM (${plannerCurrentMeetingSql(text)}) planner_meetings
      ), planner_rows AS MATERIALIZED (
        SELECT entry-'payload'||jsonb_build_object('payload',((entry->'payload')-'agendaDocuments')||jsonb_build_object(
          'agendaDocuments',COALESCE((SELECT jsonb_agg(document ORDER BY ordinal_index) FROM (
            SELECT DISTINCT ON (header->'meetingId',header->'documentUrl',header->'sourceOrg',header->'extraction',header->'extractionNote',header->'text')
              CASE WHEN jsonb_typeof(reader_payload_node(header->'text')) IN ('string','object') THEN
                (header-'text')||jsonb_build_object('text',null,'$plannerAgendaText',jsonb_build_object(
                  'hash',header#>'{text,$civicPayloadPart}',
                  'scope',entry->'scope','version',entry->'current_version_id','ordinal',d.ordinal_index,
                  'chars',length(reader_payload_value(header->'text')#>>'{}')))
                ELSE header END AS document,d.ordinal_index FROM reader_payload_members(entry#>'{payload,agendaDocuments}') d,
              LATERAL (SELECT reader_payload_node(d.item) AS header) h
            ORDER BY header->'meetingId',header->'documentUrl',header->'sourceOrg',header->'extraction',header->'extractionNote',header->'text',d.ordinal_index
          ) unique_documents),'[]'::jsonb))) AS value
        FROM planner_input,LATERAL jsonb_array_elements(meeting_rows) e(entry)
      ), planner_hashes(hash) AS (
        SELECT ref#>>'{}' FROM (SELECT value FROM planner_rows UNION ALL
          SELECT value FROM planner_input,LATERAL jsonb_array_elements(archived_meetings) e(value)) roots,
          LATERAL jsonb_path_query(value,'strict $.**."$civicPayloadPart"','{}',true) ref
        UNION SELECT ref#>>'{}' FROM planner_hashes JOIN civic_data_payload_parts part USING(hash),
          LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref
      ) SELECT entities,sittings,archived_meetings,archived_documents,'[]'::jsonb AS archived_document_links,
        COALESCE((SELECT jsonb_agg(value) FROM planner_rows),'[]'::jsonb) AS meeting_rows,
        COALESCE((SELECT jsonb_object_agg(hash,payload) FROM planner_hashes JOIN civic_data_payload_parts USING(hash)),'{}'::jsonb) AS parts
        FROM planner_input`, params: params ?? [] }])]);
      const selected = new Set(bodies.slice(first, first + 16).map(body => String(body.id)));
      const archived = archive.meetings.filter(meeting => selected.has(String(meeting.bodyId)));
      const archivedIds = new Set(archived.map(meeting => String(meeting.id)));
      const rows: Record<string, unknown>[] = current.map(row => ({ ...row, archived_meetings: archived,
        archived_documents: archive.documents.filter(document => archivedIds.has(String(document.meetingId))) }));
      for (const row of rows) for (const entry of row.meeting_rows as {scope: string; current_version_id: string}[]) {
        if (archive.frontier.get(entry.scope) !== entry.current_version_id) throw new Error(`PLANNER_MEETING_CHANGED:${state}:${entry.scope}`);
      }
      const documents = rows.flatMap(row => (row.meeting_rows as { payload: { agendaDocuments: Record<string, unknown>[] } }[])
        .flatMap(entry => entry.payload.agendaDocuments).concat(row.archived_documents as Record<string, unknown>[]));
      // Restore original text in bounded chunks before the canonical composer
      // sees it. Repeated captures share one read; no text is shortened or guessed.
      const pending = documents.filter(document => document.$plannerAgendaText);
      for (let at = 0; at < pending.length; at += 4) await Promise.all(pending.slice(at, at + 4).map(async document => {
        const text = document.$plannerAgendaText as { hash?: string; candidate?: string; scope: string; version: string; ordinal: number; chars: number };
        const chunks: string[] = [];
        for (let offset = 0; offset < text.chars; offset += 32768) {
          const [[chunk]] = await query([text.hash ? {
            text: `SELECT substring(reader_payload_value(jsonb_build_object('$civicPayloadPart',$1::text))#>>'{}' FROM $2::int FOR 32768) AS value`,
            params: [text.hash, offset + 1],
          } : text.candidate ? {
            text: `SELECT substring(reader_payload_value(reader_payload_node(d.item)->'text')#>>'{}' FROM $3::int FOR 32768) AS value
              FROM civic_data_candidates c,LATERAL reader_payload_members(reader_payload_node(c.candidate->'readModel')->'agendaDocuments') d
              WHERE c.id=$1 AND d.ordinal_index=$2`, params: [text.candidate,text.ordinal,offset+1],
          } : { text: `SELECT substring(reader_payload_value(reader_payload_node(d.item)->'text')#>>'{}'
            FROM $4::int FOR 32768) AS value FROM civic_data_promotions p,
            LATERAL reader_payload_members(reader_payload_node(p.payload)->'agendaDocuments') d
            WHERE p.key=$1 AND p.current_version_id=$2 AND d.ordinal_index=$3`,
            params: [`MEETING:${text.scope}`, text.version, text.ordinal, offset + 1] }]);
          if (typeof chunk?.value !== "string") throw new Error(`PLANNER_MEETING_CHANGED:${state}:${text.scope}`);
          chunks.push(chunk.value);
        }
        document.text = chunks.join("");
        delete document.$plannerAgendaText;
      }));
      return rows.map(row => ({ registration_held: false, division_ids: [], fields: [], rosters: [], comments: [],
        governments: [], divisions: [], publication_attempts: [], agenda_texts: [], registry: null, everyday_routing: null, ...row }));
    });
  const upper = Date.parse(now) + settings.shownAheadDays * 86_400_000;
  for (const body of held.bodies) yield { state, bodyId: body.id, load: async () => {
    const snapshot = held.bodySnapshots[body.id];
    const meetings = snapshot.meetings.filter(meeting => !Number.isFinite(Date.parse(meeting.startsAt)) || Date.parse(meeting.startsAt) <= upper);
    const ids = new Set(meetings.map(meeting => meeting.id));
    return { snapshot: { ...snapshot, meetings, counts: snapshotCounts(meetings, 0),
      agendaDocuments: snapshot.agendaDocuments.filter(document => ids.has(document.meetingId)) } };
  } };
  }
}
