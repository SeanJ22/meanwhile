import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { Query } from "./publish.ts";

type CommentField = "commentPeriod" | "commentPeriodDetail" | "signup" | "writtenComment" | "attend" | "timeLimit";
export const COMMENT_FIELDS: readonly (readonly [CommentField, string])[] = [["commentPeriodDetail", "comment:detail"], ["signup", "comment:signup"],
  ["writtenComment", "comment:written"], ["attend", "comment:attend"], ["timeLimit", "comment:time_limit"]];
export const COMMENT_PERIOD = "comment:period";

const KEYS: Readonly<Record<string, CommentField>> = { [COMMENT_PERIOD]: "commentPeriod", ...Object.fromEntries(COMMENT_FIELDS.map(([from, field]) => [field, from])) };

/** Each body's comment rules as readers see them, composed from live facts; a body is listed once it is known to take comment or not. */
export async function readFactCommentAccess(query: Query, bodyIds: readonly string[] | null = null, state?: string | null): Promise<readonly CommentAccess[]> {
  state = typeof state === "string" ? state.replace(/^US-/i, "").toUpperCase() : state;
  const byBody = new Map<string, CommentAccess>();
  const scope = state === undefined ? "TRUE" : state === null || state === "US" ? "b.state IS NULL" : "b.state = $2::char(2)";
  const rows = await query(`SELECT f.entity_id, f.field, f.value, f.quote, f.checked_at, s.url, b.parent_id
    FROM entity b CROSS JOIN LATERAL (
      SELECT entity_id, field, value, quote, checked_at, source_copy_id FROM fact
      WHERE entity_id = b.id AND status = 'live' AND field LIKE 'comment:%' OFFSET 0
    ) f JOIN source_copy s ON s.id = f.source_copy_id
    WHERE ($1::text[] IS NULL OR b.id = ANY($1::text[])) AND ${scope} ORDER BY f.entity_id, f.field`,
  typeof state === "string" && state !== "US" ? [bodyIds, state] : [bodyIds]);
  for (const row of rows) {
    const bodyId = String(row.entity_id), field = KEYS[String(row.field)];
    if (!field) continue;
    const at = new Date(row.checked_at as string).toISOString();
    const held = byBody.get(bodyId) ?? { bodyId, ocdId: /^ocd-division\//.test(String(row.parent_id ?? "")) ? String(row.parent_id) : /^(ocd-division\/[^#]+)#/.exec(bodyId)?.[1] ?? null,
      commentPeriod: "UNKNOWN", commentPeriodDetail: null, signup: null, writtenComment: null, attend: null, timeLimit: null,
      sourceUrl: String(row.url), collectedAt: at.slice(0, 10), verifiedAt: at, fieldSources: {} };
    Object.assign(held, { [field]: row.value });
    held.fieldSources![field] = { quote: String(row.quote), sourceUrl: String(row.url), collectedAt: at.slice(0, 10), verifiedAt: at };
    if (at > (held.verifiedAt ?? "")) Object.assign(held, { sourceUrl: String(row.url), collectedAt: at.slice(0, 10), verifiedAt: at });
    byBody.set(bodyId, held);
  }
  return [...byBody.values()].filter(record => record.commentPeriod !== "UNKNOWN");
}
