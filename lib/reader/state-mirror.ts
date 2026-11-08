import { applyMigrations } from "../db/apply-migrations.ts";
import type { Query } from "../facts/publish.ts";
import { MEMBER_OFFICE_NATIONAL_SCOPE } from "../officials/member-office-data.ts";
import { memberOfficeStateScope } from "../officials/member-office-scope.ts";
import { zipStateSources } from "./state.ts";
import type { StateSeam } from "./state-seam.ts";

/** What a state's answers read, whole or for a ZIP, as the published entries are named by the same function the reader uses. */
export function mirrorScopes(state: string) {
  const { keys, candidates, translations } = zipStateSources(state);
  return { keys: [...keys, ...candidates].sort(), translations, memberOffices: [memberOfficeStateScope(state), MEMBER_OFFICE_NATIONAL_SCOPE] };
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
/**
 * The one statement that reads the source: the published entries once, then, from them, the parts they refer to, their candidates, each candidate's latest
 * confirmation, the member-office rows of the state and Sean's owner choices. Each column is a table of the copy, as rows.
 * It reads civic_data_promotions (the entries), civic_data_payload_parts (their parts), civic_data_candidates and civic_data_candidate_events
 * (their candidates and confirmations), civic_data_rows (member offices) and owner_flag.
 */
const COPY = `WITH RECURSIVE args AS MATERIALIZED (SELECT $1::text[] AS k,$2::text AS t,$3::text[] AS m,$4::text AS s),
  published AS MATERIALIZED (SELECT p.key,p.record_class,p.scope,p.current_version_id,p.payload,p.validation_receipt,to_jsonb(p) AS whole FROM civic_data_promotions p WHERE ${PUBLISHED}),
  hashes(hash) AS (
    SELECT ref#>>'{}' FROM published,LATERAL (VALUES (published.payload),(published.validation_receipt)) roots(value),
      LATERAL jsonb_path_query(roots.value,'strict $.**."$civicPayloadPart"','{}',true) ref
    UNION SELECT ref#>>'{}' FROM hashes CROSS JOIN LATERAL (SELECT payload FROM civic_data_payload_parts WHERE hash=hashes.hash LIMIT 1) part,
      LATERAL jsonb_path_query(part.payload,'strict $.**."$civicPayloadPart"','{}',true) ref)
  SELECT
    (SELECT coalesce(jsonb_agg(to_jsonb(part)),'[]'::jsonb) FROM civic_data_payload_parts part WHERE part.hash IN (SELECT hash FROM hashes)) AS civic_data_payload_parts,
    (SELECT coalesce(jsonb_agg(p.whole||jsonb_build_object('payload',CASE
      WHEN p.record_class='CENSUS_GEOGRAPHY' AND p.payload ? 'scopes' THEN ${GEOGRAPHY}
      WHEN p.record_class='CURATED_READER_RECORD' AND p.scope=(SELECT m[2] FROM args) THEN p.payload-'records'
      ELSE p.payload END)),'[]'::jsonb) FROM published p) AS civic_data_promotions,
    (SELECT coalesce(jsonb_agg(to_jsonb(c)||jsonb_build_object('candidate',${CANDIDATE})),'[]'::jsonb) FROM civic_data_candidates c
      WHERE c.id IN (SELECT current_version_id FROM published)) AS civic_data_candidates,
    (SELECT coalesce(jsonb_agg(e.whole),'[]'::jsonb) FROM (SELECT DISTINCT ON (e.candidate_id) to_jsonb(e) AS whole FROM civic_data_candidate_events e
      WHERE e.candidate_id IN (SELECT current_version_id FROM published) AND left(e.detail,26)='UNCHANGED_CONFIRMATION_V1 '
      ORDER BY e.candidate_id,e.sequence DESC) e) AS civic_data_candidate_events,
    (SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) FROM civic_data_rows r
      WHERE r.promotion_key IN (SELECT key FROM published WHERE record_class='CURATED_READER_RECORD' AND scope=ANY((SELECT m FROM args)::text[]))
        AND r.collection IN ('memberOffices','memberOfficeSources') AND r.state=(SELECT s FROM args)) AS civic_data_rows,
    (SELECT coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) FROM owner_flag o
      WHERE o.reader_family IN ('campaign-sites','member-offices') AND o.resolved IN ('REMOVE','TYPED_VALUE')) AS owner_flag`;

const INSERTS: Readonly<Record<string, string>> = {
  civic_data_payload_parts: "INSERT INTO civic_data_payload_parts SELECT (jsonb_populate_record(null::civic_data_payload_parts, copied.row)).* FROM jsonb_array_elements($1::jsonb) copied(row)",
  civic_data_promotions: "INSERT INTO civic_data_promotions SELECT (jsonb_populate_record(null::civic_data_promotions, copied.row)).* FROM jsonb_array_elements($1::jsonb) copied(row)",
  civic_data_candidates: "INSERT INTO civic_data_candidates SELECT (jsonb_populate_record(null::civic_data_candidates, copied.row)).* FROM jsonb_array_elements($1::jsonb) copied(row)",
  civic_data_candidate_events: "INSERT INTO civic_data_candidate_events SELECT (jsonb_populate_record(null::civic_data_candidate_events, copied.row)).* FROM jsonb_array_elements($1::jsonb) copied(row)",
  civic_data_rows: "INSERT INTO civic_data_rows SELECT (jsonb_populate_record(null::civic_data_rows, copied.row)).* FROM jsonb_array_elements($1::jsonb) copied(row)",
  owner_flag: "INSERT INTO owner_flag SELECT (jsonb_populate_record(null::owner_flag, copied.row)).* FROM jsonb_array_elements($1::jsonb) copied(row)",
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
    const read = (await source(COPY, [keys, translations, memberOffices, state]))[0] as Record<string, unknown> | undefined;
    for (const table of Object.keys(INSERTS)) {
      const rows = read?.[table] as unknown[] | undefined;
      if (rows?.length) await pg.query(INSERTS[table]!, [JSON.stringify(rows)]);
      if (read) delete read[table];
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
