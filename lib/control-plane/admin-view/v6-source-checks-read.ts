import { meetingPartitionId } from "../../civic-data/meeting-partitions.ts";

export const SOURCE_CHECK_PAGE_SIZE = 100;
export const SOURCE_CHECK_DAYS = 14;

type Query = (text: string, params: readonly unknown[]) => Promise<readonly Record<string, unknown>[]>;
export interface SourceChecksView {
  readonly observedAt: string;
  readonly state: string;
  readonly next: string | null;
  readonly rows: readonly { readonly key: string; readonly name: string; readonly url: string | null; readonly checkedAt: string | null;
    readonly result: string; readonly nextDueAt: string | null }[];
  readonly days: readonly { readonly day: string; readonly checks: number; readonly unchanged: number; readonly unchangedShare: number | null }[];
}

function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function sourceUrl(value: unknown): string | null {
  try {
    const url = new URL(String(value));
    if (!["https:", "http:"].includes(url.protocol)) return null;
    url.username = ""; url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:api[-_]?key|key|access[-_]?token|token|auth|authorization|password|secret)$/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch { return null; }
}

async function registeredSources(query: Query, state: string, after: string, now: string): Promise<readonly Record<string, unknown>[]> {
  const cursor: [string, number] = after ? JSON.parse(Buffer.from(after.slice(2), "base64url").toString()) : ["", 0];
  if (!Array.isArray(cursor) || cursor.length !== 2 || typeof cursor[0] !== "string" || !Number.isSafeInteger(cursor[1])) throw new Error("Invalid source cursor");
  const rows = await query(`SELECT d.id, body.ordinality, body.id AS body_id, d.value->>'kind' AS kind,
      d.value->>'status' AS status, d.value #>> '{config,contractId}' AS contract_id,
      d.value->'meeting' IS NOT NULL AND d.value->'meeting' <> 'null'::jsonb AS is_meeting,
      coalesce(d.value #>> '{meeting,publishingOrg}',d.value #>> '{meeting,jurisdiction}',d.value #>> '{hosts,0}','Source') AS source_name,
      coalesce(d.value #>> '{config,feedUrl}',d.value #>> '{config,icalUrl}',d.value #>> '{config,pageUrl}',
        d.value #>> '{config,schedulePage}',d.value #>> '{config,agendaCenterUrl}',d.value #>> '{config,documentsUrl}',
        d.value #>> '{config,portalUrl}',d.value #>> '{config,serviceBase}',d.value #>> '{config,apiBase}',
        d.value #>> '{config,baseUrl}',d.value #>> '{config,base}',d.value #>> '{config,url}',
        'https://' || (d.value #>> '{hosts,0}')) AS url
    FROM cp_doors d CROSS JOIN LATERAL jsonb_array_elements_text(CASE
      WHEN jsonb_array_length(coalesce(d.value->'bodyIds','[]'::jsonb)) > 0 THEN d.value->'bodyIds' ELSE '[null]'::jsonb END)
      WITH ORDINALITY AS body(id,ordinality)
    WHERE d.value #>> '{scopeState}' = $1 AND d.id >= $2 AND (d.id,body.ordinality) > ($2,$3::bigint)
    ORDER BY d.id,body.ordinality LIMIT $4`, [state, cursor[0], cursor[1], SOURCE_CHECK_PAGE_SIZE + 1]);
  const identities = rows.map(row => row.contract_id ? String(row.contract_id) : row.is_meeting === true && row.body_id
    ? meetingPartitionId(String(row.kind), String(row.body_id)) : String(row.id));
  const checks = identities.length ? await query(`SELECT DISTINCT ON (source_id) source_id,url,checked_at,http_status,unchanged,next_due_at
    FROM cp_source_checks WHERE state = $1 AND source_id = ANY($2::text[]) ORDER BY source_id,checked_at DESC`, [state, identities]) : [];
  const bySource = new Map(checks.map(row => [String(row.source_id), row]));
  return rows.map((row, index) => {
    const checked = bySource.get(identities[index]!);
    const body = row.body_id ? String(row.body_id).split("#").at(-1)!.split("/").at(-1)!.replace(/[-_]/g, " ") : undefined;
    return { ...checked, cache_key: `r:${Buffer.from(JSON.stringify([row.id, Number(row.ordinality)])).toString("base64url")}`,
      source_name: [String(row.source_name), body].filter(Boolean).join(" — "), url: checked?.url ?? row.url,
      checked_at: checked?.checked_at ?? null, next_due_at: row.status === "OPEN" ? checked?.next_due_at ?? now : null,
      result: row.status === "SUSPENDED" ? "Set aside" : row.status === "SHUT" ? "Source unavailable" : checked ? null : "Not checked yet" };
  });
}

export async function readSourceChecks(query: Query, state: string, after: string, now: string, view: "registered" | "responses" = "registered"): Promise<SourceChecksView> {
  const [sources, days] = await Promise.all([
    view === "registered" ? registeredSources(query, state, after, now) : query(`SELECT cache_key, source_id, url, checked_at, http_status, unchanged, next_due_at
      FROM cp_source_checks WHERE state = $1 AND cache_key > $2 ORDER BY cache_key LIMIT $3`, [state, after, SOURCE_CHECK_PAGE_SIZE + 1]),
    query(`SELECT day::text, sum(checks) AS checks, sum(unchanged) AS unchanged FROM cp_source_check_days
      WHERE state = $1 AND day >= ($2::timestamptz AT TIME ZONE 'America/New_York')::date - $3::int
        AND day <= ($2::timestamptz AT TIME ZONE 'America/New_York')::date GROUP BY day ORDER BY day DESC`, [state, now, SOURCE_CHECK_DAYS - 1]),
  ]);
  const rows = sources.slice(0, SOURCE_CHECK_PAGE_SIZE).map(row => {
    const status = Number(row.http_status);
    let name = "Source";
    try { name = new URL(String(row.url)).hostname; } catch { /* The saved URL remains available for inspection. */ }
    return { key: String(row.cache_key), name: row.source_name ? String(row.source_name) : name, url: sourceUrl(row.url), checkedAt: timestamp(row.checked_at),
      result: row.result ? String(row.result) : row.unchanged === true ? "Unchanged without a download" : status >= 200 && status < 300 ? "Downloaded" : "Could not read",
      nextDueAt: timestamp(row.next_due_at) };
  });
  return { observedAt: now, state, rows, next: sources.length > SOURCE_CHECK_PAGE_SIZE ? rows.at(-1)!.key : null,
    days: days.map(row => { const checks = Number(row.checks), unchanged = Number(row.unchanged);
      return { day: String(row.day), checks, unchanged, unchangedShare: checks > 0 ? unchanged / checks : null }; }) };
}
