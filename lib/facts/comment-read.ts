import type { CommentAccess } from "../registry/comment-access-client.ts";
import type { Query } from "./publish.ts";

type CommentField = "commentPeriod" | "commentPeriodDetail" | "signup" | "writtenComment" | "attend" | "timeLimit";
export const COMMENT_FIELDS: readonly (readonly [CommentField, string])[] = [["commentPeriodDetail", "comment:detail"], ["signup", "comment:signup"],
  ["writtenComment", "comment:written"], ["attend", "comment:attend"], ["timeLimit", "comment:time_limit"]];
export const COMMENT_PERIOD = "comment:period";

const COMMENT_SQL = `SELECT f.entity_id, f.field, f.value, f.quote, f.checked_at, (SELECT s.url FROM source_copy s WHERE s.id = f.source_copy_id) AS url,
  (SELECT b.parent_id FROM entity b WHERE b.id = f.entity_id) AS parent_id
  FROM fact f
  WHERE f.status = 'live' AND f.field LIKE 'comment:%' AND ($1::text[] IS NULL OR f.entity_id = ANY($1::text[]))
  ORDER BY f.entity_id, f.field`;

const KEYS: Readonly<Record<string, CommentField>> = { [COMMENT_PERIOD]: "commentPeriod", ...Object.fromEntries(COMMENT_FIELDS.map(([from, field]) => [field, from])) };

/** Each body's comment rules as readers see them, composed from live facts; a body is listed once it is known to take comment or not. */
export async function readFactCommentAccess(query: Query, bodyIds: readonly string[] | null = null): Promise<readonly CommentAccess[]> {
  return factCommentAccessFromRows(await query(COMMENT_SQL, [bodyIds]));
}

/** Comment rules from already selected live facts. */
export function factCommentAccessFromRows(rows: readonly Record<string, unknown>[]): readonly CommentAccess[] {
  const byBody = new Map<string, CommentAccess>();
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
