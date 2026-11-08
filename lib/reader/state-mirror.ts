import { applyMigrations } from "../db/apply-migrations.ts";
import type { Query } from "../facts/publish.ts";
import { MEMBER_OFFICE_NATIONAL_SCOPE } from "../officials/member-office-data.ts";
import { memberOfficeStateScope } from "../officials/member-office-scope.ts";
import { zipStateSources } from "./state.ts";
import type { StateSeam } from "./state-seam.ts";

/** What a state's ZIP answers read, as the published entries are named by the same function the reader uses. */
export function mirrorScopes(state: string) {
  const { keys, translations } = zipStateSources(state);
  return { keys, translations, memberOffices: [memberOfficeStateScope(state), MEMBER_OFFICE_NATIONAL_SCOPE] };
}

/** The published entries one state's statements read (and the member offices and owner choices beside them), as the rows and columns those statements use. */
const PUBLISHED = `p.key=ANY((SELECT k FROM args)::text[]) OR p.record_class='CURATED_READER_RECORD' AND (p.scope LIKE (SELECT t FROM args) OR p.scope=ANY((SELECT m FROM args)::text[]))`;
/** The Census groupings of every other state are left behind: the statements filter to the state the same way. */
const GEOGRAPHY = `jsonb_set(p.payload,'{scopes}',coalesce((SELECT jsonb_agg(jsonb_set(s.value,'{groupings}',coalesce((SELECT jsonb_agg(g.value) FROM jsonb_array_elements(s.value->'groupings') g
  WHERE g.value->>'stateAbbr'=(SELECT s FROM args) OR g.value->'memberStates' @> to_jsonb((SELECT s FROM args))),'[]'::jsonb)) ORDER BY s.position) FROM jsonb_array_elements(p.payload->'scopes') WITH ORDINALITY s(value,position)),'[]'::jsonb))`;
/** A candidate keeps every small field the statements read; the copies of the read model and of its evidence stay behind. */
const CANDIDATE = `(SELECT coalesce(jsonb_object_agg(k.key,CASE WHEN octet_length(k.value::text)<20000 THEN k.value
    WHEN jsonb_typeof(k.value)='object' THEN (SELECT coalesce(jsonb_object_agg(s.key,s.value),'{}'::jsonb) FROM jsonb_each(k.value) s WHERE octet_length(s.value::text)<20000) END)
    FILTER (WHERE k.key<>'readModel' AND (octet_length(k.value::text)<20000 OR jsonb_typeof(k.value)='object')),'{}'::jsonb) FROM jsonb_each(c.candidate) k)`;
const COPIES: readonly (readonly [table: string, select: string])[] = [
  ["civic_data_payload_parts", `WITH RECURSIVE held AS MATERIALIZED (SELECT p.payload,p.validation_receipt FROM civic_data_promotions p WHERE ${PUBLISHED}),
      hashes(hash) AS (
        SELECT ref#>>'{}' FROM held,LATERAL (VALUES (held.payload),(held.validation_receipt)) roots(value),
          LATERAL jsonb_path_query(roots.value,'strict $.**."$civicPayloadPart"','{}',true) ref
        UNION SELECT ref#>>'{}' FROM hashes CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
          LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref)
    SELECT to_jsonb(part) AS row FROM civic_data_payload_parts part WHERE part.hash IN (SELECT hash FROM hashes)`],
  ["civic_data_promotions", `SELECT to_jsonb(p)||jsonb_build_object('payload',CASE
      WHEN p.record_class='CENSUS_GEOGRAPHY' AND p.payload ? 'scopes' THEN ${GEOGRAPHY}
      WHEN p.record_class='CURATED_READER_RECORD' AND p.scope=(SELECT m[2] FROM args) THEN p.payload-'records'
      ELSE p.payload END) AS row FROM civic_data_promotions p WHERE ${PUBLISHED}`],
  ["civic_data_candidates", `SELECT to_jsonb(c)||jsonb_build_object('candidate',${CANDIDATE}) AS row FROM civic_data_candidates c
    WHERE c.id IN (SELECT p.current_version_id FROM civic_data_promotions p WHERE ${PUBLISHED})`],
  ["civic_data_candidate_events", `SELECT DISTINCT ON (e.candidate_id) to_jsonb(e) AS row FROM civic_data_candidate_events e
    WHERE e.candidate_id IN (SELECT p.current_version_id FROM civic_data_promotions p WHERE ${PUBLISHED}) AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 '
    ORDER BY e.candidate_id,e.sequence DESC`],
  ["civic_data_rows", `SELECT to_jsonb(r) AS row FROM civic_data_rows r
    WHERE r.promotion_key IN (SELECT p.key FROM civic_data_promotions p WHERE p.record_class='CURATED_READER_RECORD' AND p.scope=ANY((SELECT m FROM args)::text[]))
      AND r.collection IN ('memberOffices','memberOfficeSources') AND r.state=(SELECT s FROM args)`],
  ["owner_flag", `SELECT to_jsonb(o) AS row FROM owner_flag o WHERE o.reader_family IN ('campaign-sites','member-offices') AND o.resolved IN ('REMOVE','TYPED_VALUE')`],
];

const INSERTS: Readonly<Record<string, string>> = {
  civic_data_payload_parts: "INSERT INTO civic_data_payload_parts SELECT * FROM jsonb_populate_recordset(null::civic_data_payload_parts, $1::jsonb)",
  civic_data_promotions: "INSERT INTO civic_data_promotions SELECT * FROM jsonb_populate_recordset(null::civic_data_promotions, $1::jsonb)",
  civic_data_candidates: "INSERT INTO civic_data_candidates SELECT * FROM jsonb_populate_recordset(null::civic_data_candidates, $1::jsonb)",
  civic_data_candidate_events: "INSERT INTO civic_data_candidate_events SELECT * FROM jsonb_populate_recordset(null::civic_data_candidate_events, $1::jsonb)",
  civic_data_rows: "INSERT INTO civic_data_rows SELECT * FROM jsonb_populate_recordset(null::civic_data_rows, $1::jsonb)",
  owner_flag: "INSERT INTO owner_flag SELECT * FROM jsonb_populate_recordset(null::owner_flag, $1::jsonb)",
};

export interface StateMirror {
  readonly state: string;
  /** The connections the reader's functions read through while the state's answers are composed. */
  readonly seam: StateSeam;
  close(): Promise<void>;
}

/**
 * Copies, once, the rows the state statements read for one state into an in-process database with the real migrations. The unchanged state
 * statements then run against the copy for every ZIP of the state, and the copy is dropped when the state is done.
 * `source` is the production reader; the copy's rows are the source's, column for column.
 */
export async function openStateMirror(source: Query, state: string): Promise<StateMirror> {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  try {
    await applyMigrations(pg);
    // The copy keeps the source's rows as they are: its own triggers, which derive other rows, stay quiet.
    await pg.exec("SET session_replication_role = replica");
    // Its rows were checked when they were published, and some are copied in part; the table checks stay with the source.
    await pg.exec(`DO $$ DECLARE c record; BEGIN
      FOR c IN SELECT conrelid::regclass AS t,conname FROM pg_constraint WHERE contype='c' AND conrelid::regclass::text = ANY(ARRAY['civic_data_candidates','civic_data_promotions','civic_data_candidate_events','civic_data_rows','civic_data_payload_parts','owner_flag'])
      LOOP EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I',c.t,c.conname); END LOOP; END $$`);
    const { keys, translations, memberOffices } = mirrorScopes(state);
    for (const [table, select] of COPIES) {
      const [read] = await source(`WITH args AS MATERIALIZED (SELECT $1::text[] AS k,$2::text AS t,$3::text[] AS m,$4::text AS s) SELECT coalesce(jsonb_agg(copied.row),'[]'::jsonb) AS rows FROM (${select}) copied`, [keys, translations, memberOffices, state]);
      const rows = read?.rows as unknown[] | undefined;
      if (process.env.MIRROR_DEBUG) console.error(`mirror ${table}: ${rows?.length ?? 0} rows, ${JSON.stringify(rows ?? []).length} bytes`);
      if (rows?.length) await pg.query(INSERTS[table]!, [JSON.stringify(rows)]);
    }
  } catch (error) { await pg.close().catch(() => undefined); throw error; }
  const facts: Query = async (text, params = []) => (await pg.query<Record<string, unknown>>(text, [...params])).rows;
  const reader = async (statements: readonly { readonly text: string; readonly params: readonly unknown[] }[]) => {
    const out: (readonly Record<string, unknown>[])[] = [];
    for (const statement of statements) out.push(await facts(statement.text, statement.params));
    return out;
  };
  return { state, seam: { reader, facts }, close: () => pg.close() };
}
