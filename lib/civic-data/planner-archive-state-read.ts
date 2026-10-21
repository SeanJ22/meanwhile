import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";

const PACKAGE_RESULT = "\nSELECT EXISTS(";
const ARCHIVE_WHERE = "WHERE $6::boolean AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id";

export function plannerCurrentMeetingSql(text: string): string {
  if (!text.includes(ARCHIVE_WHERE)) throw new Error("PLANNER_ARCHIVE_QUERY_CHANGED");
  return text.replace(ARCHIVE_WHERE, "WHERE false AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id");
}

/** Keep the canonical archive eligibility proof, but unpack one immutable
 * version at a time. Several large old candidates must never share one read. */
export async function readPlannerMeetingArchives(text: string, params: readonly unknown[], query: ReadOnlyQuery) {
  const end = text.indexOf(PACKAGE_RESULT);
  if (end < 0 || !text.includes(ARCHIVE_WHERE)) throw new Error("PLANNER_ARCHIVE_QUERY_CHANGED");
  const [inventory] = await query([{ text: `${text.slice(0, end)} SELECT 'archive' AS kind,id,scope,retrieved_at,
      (SELECT pg_column_size(candidate) FROM civic_data_candidates WHERE id=v.id) AS bytes FROM archived_versions v
    UNION ALL SELECT 'current',current_version_id,scope,NULL,NULL FROM meeting_partitions
    ORDER BY retrieved_at DESC NULLS LAST,id`, params }]);
  const versions = inventory.filter(row => row.kind === "archive");
  const frontier = new Map(inventory.filter(row => row.kind === "current").map(row => [String(row.scope), String(row.id)]));
  // Many routine attempts contain no historical calendar. Pack small versions
  // together without letting several large candidate records share one read.
  const batches: typeof versions[] = [];
  let batch: typeof versions = [], bytes = 0;
  for (const version of versions) {
    const size = Number(version.bytes) || 0;
    if (batch.length && (batch.length >= 32 || bytes + size > 8 * 1024 * 1024)) {
      batches.push(batch); batch = []; bytes = 0;
    }
    batch.push(version); bytes += size;
  }
  if (batch.length) batches.push(batch);
  const rankOf = new Map(versions.map((version, rank) => [String(version.id), rank]));
  const meetings = new Map<string, { rank: number; value: Record<string, unknown> }>();
  const documents = new Map<string, { rank: number; value: Record<string, unknown> }>();
  const held = `WITH held AS MATERIALIZED (
    SELECT id,reader_payload_node(candidate->'readModel') AS root FROM civic_data_candidates WHERE id=ANY($1::text[])
  )`;
  const meetingSql = `${held} SELECT held.id AS candidate_id,m.ordinal_index,reader_payload_value(m.item) AS value FROM held,
    LATERAL reader_payload_members(root->'meetings') m,LATERAL (SELECT reader_payload_node(m.item) AS h) header
    WHERE (held.id,m.ordinal_index)>($3::text,$4::int) AND h->>'bodyId'=ANY($2::text[]) AND h->>'id' IS NOT NULL
      AND CASE WHEN h->>'startsAt' ~ '^\\d{4}-\\d{2}-\\d{2}T'
        THEN (h->>'startsAt')::timestamptz<now()-make_interval(days=>${MEETING_HELD_LOOKBACK_DAYS}) ELSE false END
    ORDER BY held.id,m.ordinal_index LIMIT 64`;
  const documentSql = `${held} SELECT held.id AS candidate_id,d.ordinal_index,reader_payload_value(h-'text')||CASE
      WHEN jsonb_typeof(reader_payload_node(h->'text')) IN ('string','object') THEN jsonb_build_object('text',null,
        '$plannerAgendaText',jsonb_build_object('hash',h#>'{text,$civicPayloadPart}','candidate',held.id,
          'ordinal',d.ordinal_index,'chars',length(reader_payload_value(h->'text')#>>'{}')))
      ELSE jsonb_build_object('text',h->'text') END AS value
    FROM held,LATERAL reader_payload_members(root->'agendaDocuments') d,LATERAL (SELECT reader_payload_node(d.item) AS h) header
    WHERE (held.id,d.ordinal_index)>($3::text,$4::int) AND h->>'meetingId'=ANY($2::text[])
    ORDER BY held.id,d.ordinal_index LIMIT 64`;
  for (const kind of ["meetings", "documents"] as const) {
    if (kind === "documents" && !meetings.size) break;
    const target = kind === "meetings" ? meetings : documents;
    for (let first = 0; first < batches.length; first += 4) await Promise.all(batches.slice(first, first + 4).map(async versions => {
      let afterId = "", afterOrdinal = 0;
      for (;;) {
        const [page] = await query([{ text: kind === "meetings" ? meetingSql : documentSql,
          params: [versions.map(version => version.id), kind === "meetings" ? params[2] : [...meetings.keys()], afterId, afterOrdinal] }]);
        for (const row of page) {
          const value = row.value as Record<string, unknown>, rank = rankOf.get(String(row.candidate_id))!;
          if (!target.has(String(value.id)) || target.get(String(value.id))!.rank > rank) target.set(String(value.id), { rank, value });
        }
        if (page.length < 64) break;
        afterId = String(page.at(-1)!.candidate_id); afterOrdinal = Number(page.at(-1)!.ordinal_index);
      }
    }));
  }
  return { meetings: [...meetings.values()].map(row => row.value), documents: [...documents.values()].map(row => row.value), frontier };
}
