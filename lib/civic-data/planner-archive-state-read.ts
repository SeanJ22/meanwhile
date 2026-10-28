import type { ReadOnlyQuery } from "../control-plane/admin-view/promoted-slices.ts";
import { MEETING_HELD_LOOKBACK_DAYS } from "../meetings/constants.ts";
import { readCivicCandidateRows, readCivicCandidateText } from "./candidate-vault.ts";
import { rawCaptureVault } from "./raw-capture-remote.ts";
import type { EvidenceStore } from "../control-plane/evidence/store.ts";

const PACKAGE_RESULT = "\n, page AS MATERIALIZED (\nSELECT EXISTS(";
const ARCHIVE_WHERE = "WHERE $6::boolean AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id";

export function plannerCurrentMeetingSql(text: string): string {
  if (!text.includes(ARCHIVE_WHERE)) throw new Error("PLANNER_ARCHIVE_QUERY_CHANGED");
  return text.replace(ARCHIVE_WHERE, "WHERE false AND right(p.scope,8)<>':history' AND c.id<>p.current_version_id");
}

/** Keep the canonical archive eligibility proof, but unpack one immutable
 * version at a time. Several large old candidates must never share one read. */
export async function readPlannerMeetingArchives(text: string, params: readonly unknown[], query: ReadOnlyQuery,
  vault: EvidenceStore | (() => EvidenceStore) = rawCaptureVault) {
  const end = text.indexOf(PACKAGE_RESULT);
  if (end < 0 || !text.includes(ARCHIVE_WHERE)) throw new Error("PLANNER_ARCHIVE_QUERY_CHANGED");
  // The inventory stops before the page's own result, so it binds only the parameters its selection reads.
  const selection = text.slice(0, end), bound = Math.max(0, ...[...selection.matchAll(/\$(\d+)/g)].map(match => Number(match[1])));
  const [inventory] = await query([{ text: `${selection} SELECT 'archive' AS kind,id,scope,retrieved_at,
      (extract(epoch FROM now()) * 1000)::bigint AS clock_ms FROM archived_versions v
    UNION ALL SELECT 'current',current_version_id,scope,NULL,(extract(epoch FROM now()) * 1000)::bigint FROM meeting_partitions
    ORDER BY retrieved_at DESC NULLS LAST,id`, params: params.slice(0, bound) }]);
  const versions = inventory.filter(row => row.kind === "archive");
  const cutoff = Number(inventory[0]?.clock_ms) - MEETING_HELD_LOOKBACK_DAYS * 86_400_000;
  const frontier = new Map(inventory.filter(row => row.kind === "current").map(row => [String(row.scope), String(row.id)]));
  const rankOf = new Map(versions.map((version, rank) => [String(version.id), rank]));
  const meetings = new Map<string, { rank: number; value: Record<string, unknown> }>();
  const documents = new Map<string, { rank: number; value: Record<string, unknown> }>();
  const read = async (text: string, params: readonly unknown[]) => (await query([{ text, params }]))[0] ?? [];
  for (const kind of ["meetings", "documents"] as const) {
    if (kind === "documents" && !meetings.size) break;
    const target = kind === "meetings" ? meetings : documents;
    for (let first = 0; first < versions.length; first += 4) await Promise.all(versions.slice(first, first + 4).map(async version => {
      const id = String(version.id), rank = rankOf.get(id)!;
      let afterOrdinal = 0;
      for (;;) {
        const rows = await readCivicCandidateRows(read, vault, id, [kind === "meetings" ? "meetings" : "agendaDocuments"], {
          match: { path: [kind === "meetings" ? "bodyId" : "meetingId"],
            values: kind === "meetings" ? params[2] as string[] : [...meetings.keys()] },
          ...(kind === "documents" ? { omit: ["text"] } : {}), afterOrdinal, limit: 64,
        });
        for (const row of rows) {
          const value = row.value;
          if (kind === "meetings") {
            if (typeof value.id !== "string" || typeof value.startsAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value.startsAt)) continue;
            const startsAt = Date.parse(value.startsAt);
            if (!Number.isFinite(startsAt)) throw new Error(`PLANNER_ARCHIVE_TIME_INVALID:${id}`);
            if (!(startsAt < cutoff)) continue;
          }
          if (kind === "documents") {
            const window = await readCivicCandidateText(read, vault, id, ["agendaDocuments", String(row.ordinal - 1), "text"], { count: 0 });
            value.text = null;
            if (window) value.$plannerAgendaText = { candidate: id, ordinal: row.ordinal, chars: window.totalLength };
          }
          const key = String(value.id);
          if (!target.has(key) || target.get(key)!.rank > rank) target.set(key, { rank, value });
        }
        if (rows.length < 64) break;
        afterOrdinal = rows.at(-1)!.ordinal;
      }
    }));
  }
  return { meetings: [...meetings.values()].map(row => row.value), documents: [...documents.values()].map(row => row.value), frontier };
}
