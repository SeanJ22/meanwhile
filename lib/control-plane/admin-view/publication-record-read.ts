import { sql } from "drizzle-orm";
import { getDb } from "../../db/index.ts";
import { sanitizedErrorDiagnostic } from "../../ops/error-diagnostic.ts";
import {
  PUBLICATION_PROTECTED_KEY_PATTERN, PUBLICATION_RECORD_PAGE_SIZE, PUBLICATION_RECORD_TEXT_SLICE,
  parsePublicationRecordPath, sanitizePublicationRecordNode, type PublicationRecordNode,
} from "./publication-record.ts";

if (typeof window !== "undefined") throw new Error("Saved publication records are a server-only read.");

export interface PublicationRecordRead {
  readonly state: "READ" | "UNAVAILABLE";
  readonly path: readonly string[];
  readonly page: number;
  readonly node: PublicationRecordNode | null;
  readonly reason: string | null;
}

/** Navigate the complete immutable JSON without aggregating whole documents.
 * A list contains only scalar previews and container sizes; opening a container
 * is an exact version/key/path read. Secret-bearing keys never leave the DB. */
export async function readPublicationRecord(input: {
  version: string; recordKey: string; serializedPath?: string; page?: number; asOf: string;
}): Promise<PublicationRecordRead> {
  const path = parsePublicationRecordPath(input.serializedPath ?? "[]");
  const page = Number.isSafeInteger(input.page) && input.page! > 0 && input.page! <= 1_000_000 ? input.page! : 1;
  const unavailable = (reason: string): PublicationRecordRead => ({ state: "UNAVAILABLE", path: path ?? [], page, node: null, reason });
  if (!path) return unavailable("This saved-record path is invalid or contains a protected field.");
  if (!process.env.DATABASE_URL) return unavailable("Saved records are not connected. Their contents are unknown.");
  if (!Number.isFinite(Date.parse(input.asOf))) return unavailable("The publication-history cutoff is invalid.");
  try {
    const offset = (page - 1) * PUBLICATION_RECORD_PAGE_SIZE;
    const textOffset = (page - 1) * PUBLICATION_RECORD_TEXT_SLICE;
    const response = await getDb().execute(sql`
      WITH selected AS MATERIALIZED (
        SELECT record #> ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(path)}::jsonb)) AS node
        FROM civic_data_publication_search
        WHERE version_id = ${input.version} AND record_key = ${input.recordKey}
          AND promoted_at <= ${input.asOf}::timestamptz
      ), described AS MATERIALIZED (
        SELECT node, coalesce(jsonb_typeof(node), 'missing') AS kind,
          CASE jsonb_typeof(node)
            WHEN 'object' THEN (SELECT count(*) FROM jsonb_object_keys(node))
            WHEN 'array' THEN jsonb_array_length(node)
            WHEN 'string' THEN char_length(node #>> '{}') ELSE 0 END AS total
        FROM selected
      ), child_keys AS (
        SELECT keys.key, keys.ordinal FROM described d
        CROSS JOIN LATERAL (
          SELECT key, 0::bigint AS ordinal FROM jsonb_object_keys(
            CASE WHEN d.kind = 'object' THEN d.node ELSE '{}'::jsonb END) AS k(key)
          ORDER BY key LIMIT ${PUBLICATION_RECORD_PAGE_SIZE} OFFSET ${offset}
        ) keys WHERE d.kind = 'object'
        UNION ALL
        SELECT index::text, index::bigint FROM described d
        CROSS JOIN LATERAL generate_series(${offset},
          least(d.total - 1, ${offset + PUBLICATION_RECORD_PAGE_SIZE - 1})::integer) AS index
        WHERE d.kind = 'array'
      ), children AS MATERIALIZED (
        SELECT k.key, k.ordinal,
          CASE WHEN k.key ~* ${PUBLICATION_PROTECTED_KEY_PATTERN} THEN NULL
            WHEN d.kind = 'array' THEN d.node -> k.key::integer ELSE d.node -> k.key END AS value,
          k.key ~* ${PUBLICATION_PROTECTED_KEY_PATTERN} AS protected
        FROM described d CROSS JOIN child_keys k
      ), child_previews AS (
        SELECT key, ordinal, jsonb_strip_nulls(jsonb_build_object(
          'key', CASE WHEN char_length(key) > 300 THEN left(key, 297) || '...' ELSE key END,
          'pathUnavailable', char_length(key) > 300,
          'kind', CASE WHEN protected THEN 'missing' ELSE jsonb_typeof(value) END,
          'value', CASE WHEN protected THEN to_jsonb('[redacted]'::text)
            WHEN jsonb_typeof(value) = 'string' THEN to_jsonb(left(value #>> '{}', 500))
            WHEN jsonb_typeof(value) IN ('number','boolean','null') THEN value ELSE NULL END,
          'size', CASE jsonb_typeof(value)
            WHEN 'object' THEN (SELECT count(*) FROM jsonb_object_keys(value))
            WHEN 'array' THEN jsonb_array_length(value)
            WHEN 'string' THEN char_length(value #>> '{}') ELSE NULL END,
          'endsMidToken', CASE WHEN jsonb_typeof(value) = 'string' THEN
            CASE WHEN char_length(value #>> '{}') > 500 THEN substr(value #>> '{}', 500, 2) !~ '[[:space:]]' ELSE false END
            ELSE NULL END)) AS preview
        FROM children
      )
      SELECT jsonb_strip_nulls(jsonb_build_object('kind', kind, 'total', total,
        'children', coalesce((SELECT jsonb_agg(preview ORDER BY ordinal, key) FROM child_previews), '[]'::jsonb),
        'text', CASE WHEN kind = 'string' THEN substr(node #>> '{}', ${textOffset + 1}, ${PUBLICATION_RECORD_TEXT_SLICE}) ELSE NULL END,
        'startsMidToken', CASE WHEN kind = 'string' THEN
          CASE WHEN ${textOffset} > 0 THEN substr(node #>> '{}', ${textOffset}, 2) !~ '[[:space:]]' ELSE false END ELSE NULL END,
        'endsMidToken', CASE WHEN kind = 'string' THEN
          CASE WHEN total > ${textOffset + PUBLICATION_RECORD_TEXT_SLICE}
          THEN substr(node #>> '{}', ${textOffset + PUBLICATION_RECORD_TEXT_SLICE}, 2) !~ '[[:space:]]' ELSE false END ELSE NULL END,
        'value', CASE WHEN kind IN ('number','boolean','null') THEN node ELSE NULL END)) AS result
      FROM described
    `);
    const node = sanitizePublicationRecordNode(response.rows[0]?.result);
    if (!node) return unavailable("This exact saved record could not be read. An empty or complete result cannot be claimed.");
    if (node.kind === "missing") return unavailable("This path is not present in the saved record. Return to its parent to inspect the available fields.");
    return { state: "READ", path, page, node, reason: null };
  } catch (error) {
    console.error("ADMIN_PUBLICATION_RECORD_UNAVAILABLE", sanitizedErrorDiagnostic(error instanceof Error && error.cause ? error.cause : error));
    return unavailable("This saved record could not be read. Its contents remain unknown.");
  }
}
