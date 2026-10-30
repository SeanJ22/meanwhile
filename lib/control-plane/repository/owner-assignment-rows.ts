import type { AssignmentPart, IndexSegment } from "../assignment-view.ts";
import type { GroupTotals, StateTotals } from "../owner-snapshot-totals.ts";
import type { Sql } from "./pg-store.ts";
import type { WorkItem } from "../work-item.ts";

/** One work-list entry. Membership and counts change with this assignment, never with another state's row. */
export interface OwnerAssignmentRow {
  readonly id: string;
  readonly state: string;
  readonly builtAt: string;
  readonly group: GroupTotals;
  readonly indexSegments: readonly IndexSegment[];
  readonly part: AssignmentPart;
  readonly nextAt: string | null;
}

export interface OwnerStateWrite {
  readonly id: string;
  readonly expectedRevision: number | null;
  readonly value: StateTotals;
}

export interface OwnerAssignmentRows {
  read(ids: readonly string[]): Promise<readonly OwnerAssignmentRow[]>;
  find(input: { readonly members?: readonly string[]; readonly clauses?: readonly string[]; readonly dueAt?: string }): Promise<readonly string[]>;
  save(rows: readonly OwnerAssignmentRow[], removed: readonly string[], states?: readonly OwnerStateWrite[]): Promise<void>;
  scopeMembers(identities: readonly { readonly key: string; readonly ref: string }[]): Promise<ReadonlyMap<string, readonly string[]>>;
  publications(readbackOnly?: boolean): Promise<readonly WorkItem[]>;
  clear(): Promise<void>;
}

export const OWNER_ASSIGNMENT_ROWS_DDL = [
  `CREATE TABLE IF NOT EXISTS cp_owner_assignment_rows (
    id text PRIMARY KEY, state_code text NOT NULL, value jsonb NOT NULL,
    index_segments jsonb GENERATED ALWAYS AS (value->'indexSegments') STORED,
    members jsonb GENERATED ALWAYS AS (value #> '{group,members}') STORED,
    clause text GENERATED ALWAYS AS (value #>> '{group,clause}') STORED,
    next_at text GENERATED ALWAYS AS (value->>'nextAt') STORED,
    assignment_state text GENERATED ALWAYS AS (value #>> '{part,candidates,0,state}') STORED,
    lane text GENERATED ALWAYS AS (value #>> '{part,candidates,0,lane}') STORED,
    band integer GENERATED ALWAYS AS (coalesce((value #>> '{part,candidates,0,band}')::integer,4)) STORED,
    waiting_since text GENERATED ALWAYS AS (value #>> '{part,candidates,0,waitingSince}') STORED,
    last_activity_at text GENERATED ALWAYS AS (value #>> '{part,candidates,0,lastActivityAt}') STORED
  )`,
  "CREATE INDEX IF NOT EXISTS cp_owner_assignment_members ON cp_owner_assignment_rows USING gin(members)",
  "CREATE INDEX IF NOT EXISTS cp_owner_assignment_clause ON cp_owner_assignment_rows(clause)",
  "CREATE INDEX IF NOT EXISTS cp_owner_assignment_due ON cp_owner_assignment_rows(next_at) WHERE next_at IS NOT NULL",
  "ALTER TABLE cp_owner_assignment_rows ADD COLUMN IF NOT EXISTS marks jsonb GENERATED ALWAYS AS (value #> '{group,obligation,assignments}') STORED",
  "CREATE INDEX IF NOT EXISTS cp_owner_assignment_marks ON cp_owner_assignment_rows USING gin(marks)",
  "CREATE INDEX IF NOT EXISTS cp_owner_assignment_waiting ON cp_owner_assignment_rows(state_code,assignment_state,lane,band,waiting_since,id)",
  "CREATE INDEX IF NOT EXISTS cp_owner_assignment_recent ON cp_owner_assignment_rows(state_code,assignment_state,lane,last_activity_at DESC,id)",
] as const;

const parse = (value: unknown): OwnerAssignmentRow => (typeof value === "string" ? JSON.parse(value) : value) as OwnerAssignmentRow;
const ROW_FIELDS = `jsonb_build_object('id',id,'state',state_code,'builtAt',value->'builtAt',
  'group',value->'group','indexSegments',index_segments,'part',value->'part','nextAt',value->'nextAt')`;

export function pgOwnerAssignmentRows(sql: Sql): OwnerAssignmentRows {
  const rows = async (text: string, args: readonly unknown[]) =>
    (await sql.query(text, args) as { value: unknown }[]).map(row => parse(row.value));
  return {
    read: async ids => ids.length ? rows(`SELECT ${ROW_FIELDS} AS value FROM cp_owner_assignment_rows WHERE id=ANY($1::text[]) ORDER BY id`, [ids]) : [],
    async find(input) {
      const predicates: string[] = [], params: unknown[] = [];
      if (input.members?.length) predicates.push(`members ?| $${params.push(input.members)}::text[]`);
      if (input.clauses?.length) predicates.push(`clause=ANY($${params.push(input.clauses)}::text[])`);
      if (input.dueAt) predicates.push(`next_at <= $${params.push(input.dueAt)}`);
      return predicates.length ? (await sql.query(`SELECT id FROM cp_owner_assignment_rows WHERE ${predicates.join(" OR ")} ORDER BY id`, params) as { id: string }[]).map(row => row.id) : [];
    },
    async save(next, removed, states = []) {
      const write = async (connection: Sql) => {
        await connection.query("BEGIN");
        try {
          if (removed.length) await connection.query("DELETE FROM cp_owner_assignment_rows WHERE id=ANY($1::text[])", [removed]);
          for (let at = 0; at < next.length; at += 100) {
            const batch = next.slice(at, at + 100);
            await connection.query(`INSERT INTO cp_owner_assignment_rows(id,state_code,value)
              SELECT id,state,value FROM unnest($1::text[],$2::text[],$3::jsonb[]) AS r(id,state,value)
              ON CONFLICT(id) DO UPDATE SET state_code=excluded.state_code,value=excluded.value
              WHERE cp_owner_assignment_rows.value IS DISTINCT FROM excluded.value`,
            [batch.map(row => row.id), batch.map(row => row.state), batch.map(row => JSON.stringify(row))]);
          }
          for (const state of states) {
            const found = await connection.query(state.expectedRevision === null
              ? `INSERT INTO cp_owner_snapshots(id,revision,updated_at,value) VALUES($1,1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING id`
              : `UPDATE cp_owner_snapshots SET revision=revision+1,updated_at=$2,value=$3::jsonb WHERE id=$1 AND revision=$4 RETURNING id`,
            state.expectedRevision === null ? [state.id,state.value.builtAt,JSON.stringify(state.value)] : [state.id,state.value.builtAt,JSON.stringify(state.value),state.expectedRevision]) as {id:string}[];
            if (found.length !== 1) throw new Error(`Owner counts changed during publication: ${state.id}`);
          }
          await connection.query("COMMIT");
        } catch (error) { await connection.query("ROLLBACK"); throw error; }
      };
      if (sql.withPinnedConnection) await sql.withPinnedConnection(write);
      else await write(sql);
    },
    async scopeMembers(identities) {
      if (!identities.length) return new Map();
      const rows = await sql.query(`SELECT s.key,s.ref,r.value #>> '{group,obligation,subjectId}' AS subject
        FROM jsonb_to_recordset($1::jsonb) s(key text,ref text) JOIN cp_owner_assignment_rows r
          ON r.marks @> jsonb_build_array(jsonb_build_object('assignmentKey',s.key,'ref',s.ref))`, [JSON.stringify(identities)]) as {key:string;ref:string;subject:string}[];
      const out = new Map<string,string[]>();
      for (const row of rows) { const identity = `${row.key}\n${row.ref}`; out.set(identity,[...(out.get(identity) ?? []),row.subject]); }
      return out;
    },
    async publications(readbackOnly = false) {
      const rows = await sql.query(`SELECT p.item FROM cp_owner_assignment_rows r
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.value #> '{group,publications}','[]'::jsonb)) p(item)
        ${readbackOnly ? `WHERE p.item #>> '{publicationOutcome,status}' <> 'HELD' AND (
          p.item #>> '{autonomousPlan,publication,contractId}' IN ('official-filings','comment-access','everyday-routing','ballot-navigation') OR
          (p.item #>> '{autonomousPlan,publication,contractId}' ~ '^registry-runtime:[A-Z]{2}$' AND p.item #>> '{autonomousPlan,contract,recordClass}'='OFFICIAL_ROSTER'))` : ""}
        ORDER BY p.item->>'id'`, []) as {item:WorkItem}[];
      return rows.map(row => row.item);
    },
    async clear() { await sql.query("DELETE FROM cp_owner_assignment_rows"); },
  };
}
