import { neon } from "@neondatabase/serverless";
import type { HeldPlaceField } from "../../../coverage/place-owed.ts";
import { factClocks } from "../../../facts/clocks.ts";
import { officialTermScope } from "./held-subject-fields.ts";
import type { FieldKind } from "../../../facts/check.ts";
import type { Clocks, Query } from "../../../facts/publish.ts";
import type { AdminConfig } from "../../gateway/admin-config.ts";
import { controlPlaneUrlFromEnv } from "../../repository/pg-store.ts";
import { boundedQuery } from "../../repository/request-bounds.ts";
import type { HeldSubjectDetails } from "./held-subject-enrichment.ts";

export const HELD_FACT_CLOCKS_SQL = `SELECT (SELECT value->'settings'->'facts.freshnessHours'
  FROM cp_admin_config WHERE id='current') AS freshness_hours`;

/** One settings value, once per provider pass; neither source bodies nor the full Admin config travel here. */
export async function readHeldFactClocks(query?: Query): Promise<Clocks> {
  if (!query) {
    const url = controlPlaneUrlFromEnv();
    if (!url) throw new Error("HELD_FACT_CLOCKS_CONTROL_PLANE_UNCONFIGURED");
    const sql = neon(url);
    query = async (text, params = []) => await boundedQuery(sql,
      { operation: "held-digger:fact-clocks", callClass: "POINT" }, text, params) as Record<string, unknown>[];
  }
  const [row] = await query(HELD_FACT_CLOCKS_SQL);
  if (!row) throw new Error("HELD_FACT_CLOCKS_UNREADABLE");
  // The fact store has checked_at, not a persisted fresh_until. Use the same per-kind Admin clock as publication.
  return factClocks({ settings: { "facts.freshnessHours": row.freshness_hours } } as unknown as AdminConfig);
}

/** Values stay on the server: the owed list needs only the live field's identity, type, source and clock. */
export const HELD_SUBJECT_PROGRESS_SQL = `WITH held AS (
    SELECT * FROM jsonb_to_recordset($1::jsonb) AS h(subject_id text,entity_id text,kind text,body_id text,term_scope text)
  ), identities AS (
    SELECT h.*,coalesce((SELECT e.id FROM entity e WHERE e.id=h.entity_id AND e.kind=h.kind),
      (SELECT min(x.entity_id) FROM entity_external_id x JOIN entity e ON e.id=x.entity_id AND e.kind=h.kind
        WHERE h.kind='person' AND (x.scheme='roster-member' AND x.value=h.subject_id
          OR x.scheme='bioguide' AND 'congress:'||x.value=h.subject_id)
        HAVING count(DISTINCT x.entity_id)=1)) canonical_id FROM held h
  ) SELECT h.subject_id,f.field,jsonb_typeof(f.value) value_type,
    CASE WHEN jsonb_typeof(f.value)='string' THEN length(trim(f.value#>>'{}'))>0
      WHEN jsonb_typeof(f.value)='object' THEN f.value<>'{}'::jsonb
      WHEN jsonb_typeof(f.value)='array' THEN jsonb_array_length(f.value)>0 ELSE false END nonempty,
    s.final_url source_url,f.checked_at
    FROM identities h JOIN fact f ON f.entity_id=h.canonical_id AND f.status='live'
      AND (h.kind='person' AND h.body_id IS NOT NULL AND EXISTS(SELECT 1 FROM fact membership
        WHERE membership.entity_id=h.body_id AND membership.field='member:'||h.canonical_id AND membership.status='live')
        AND (f.field IN ('email','phone','website')
        OR f.field IN ('term_start:'||h.term_scope,'term_end:'||h.term_scope,'term_note:'||h.term_scope)
        )
      OR h.kind='body' AND f.field IN ('office_phone','office_address','agenda_url','meeting_cadence'))
    JOIN source_copy s ON s.id=f.source_copy_id ORDER BY h.subject_id,f.field`;

export async function readHeldSubjectProgress(query: Query, subjects: readonly HeldSubjectDetails[], clocks: Clocks): Promise<HeldPlaceField[]> {
  if (!subjects.length) return [];
  const bindings = subjects.map(subject => ({ subject_id: subject.subjectId,
    entity_id: subject.subjectKind === "official" ? subject.personId ?? subject.subjectId : subject.subjectId,
    kind: subject.subjectKind === "official" ? "person" : subject.subjectKind, body_id: subject.bodyId,
    term_scope: officialTermScope(subject.bodyId, subject.officeTitle) }));
  const known = new Map(subjects.map(subject => [subject.subjectId, subject]));
  return (await query(HELD_SUBJECT_PROGRESS_SQL, [JSON.stringify(bindings)])).flatMap(row => {
    const subject = known.get(String(row.subject_id));
    if (!subject || row.nonempty !== true || typeof row.field !== "string" || typeof row.source_url !== "string") return [];
    let url: URL;
    try { url = new URL(row.source_url); if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return []; }
    catch { return []; }
    const checked = new Date(row.checked_at as string | Date).getTime();
    if (!Number.isFinite(checked)) return [];
    const field = row.field;
    let checklistId: string | null = null, kind: FieldKind = "contact", subjectId = subject.subjectId;
    if (subject.subjectKind === "official") {
      if (!subject.bodyId) return [];
      if (["email", "phone"].includes(field) && row.value_type === "string") checklistId = "OFF-09";
      else if (field === "website" && row.value_type === "string") checklistId = "OFF-08";
      else if (["term_start", "term_end", "term_note"].some(key => field === `${key}:${officialTermScope(subject.bodyId, subject.officeTitle)}`) && row.value_type === "string") {
        checklistId = "OFF-06"; kind = "officeholder";
      }
    } else if (subject.subjectKind === "body" && ["office_phone", "office_address"].includes(field) && row.value_type === "string") checklistId = "GOV-08";
    else if (subject.subjectKind === "body" && ["agenda_url", "meeting_cadence"].includes(field) && row.value_type === "string") {
      checklistId = field === "agenda_url" ? "MTG-01" : "MTG-04"; kind = "meeting"; subjectId += "#calendar";
    }
    if (!checklistId) return [];
    return [{ subjectId, checklistId, state: "published" as const, sourceUrl: row.source_url,
      checkedAt: new Date(checked).toISOString(), freshUntil: new Date(checked + clocks.windowHours(kind) * 3_600_000).toISOString(),
      value: { liveField: field } }];
  });
}
