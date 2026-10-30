import { createHash } from "node:crypto";
import { assignmentPartOf, mergeAssignmentParts, type AssignmentPart, type IndexSegment } from "../assignment-view.ts";
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

/** Small membership and fingerprints; source bodies and saved panels stay in Postgres. */
export interface OwnerAssignmentHead {
  readonly id: string;
  readonly state: string;
  readonly members: readonly string[];
  readonly clause: string | null;
  readonly subjectId: string | null;
  readonly versions: Readonly<Record<string, string>>;
}

const READBACK_CONTRACTS=["official-filings","comment-access","everyday-routing","ballot-navigation"];
export const ownerReadbackItem=(item:WorkItem):boolean=>!!item.publicationOutcome&&item.publicationOutcome.status!=="HELD"&&(
  READBACK_CONTRACTS.includes(item.autonomousPlan?.publication?.contractId??"")||
  (/^registry-runtime:[A-Z]{2}$/.test(item.autonomousPlan?.publication?.contractId??"")&&item.autonomousPlan?.contract?.recordClass==="OFFICIAL_ROSTER"));
export const ownerReadbackWhere=(value:string):string=>`${value} #>> '{publicationOutcome,status}' <> 'HELD' AND (
  ${value} #>> '{autonomousPlan,publication,contractId}' IN (${READBACK_CONTRACTS.map(id=>`'${id}'`).join(",")}) OR
  (${value} #>> '{autonomousPlan,publication,contractId}' ~ '^registry-runtime:[A-Z]{2}$' AND ${value} #>> '{autonomousPlan,contract,recordClass}'='OFFICIAL_ROSTER'))`;

export interface OwnerStateWrite {
  readonly id: string;
  readonly expectedRevision: number | null;
  readonly value: StateTotals;
}

export interface OwnerAssignmentRows {
  read(ids: readonly string[]): Promise<readonly OwnerAssignmentRow[]>;
  heads(ids: readonly string[]): Promise<readonly OwnerAssignmentHead[]>;
  contributions(ids: readonly string[]): Promise<ReadonlyMap<string, AssignmentPart>>;
  find(input: { readonly members?: readonly string[]; readonly clauses?: readonly string[]; readonly dueAt?: string }): Promise<readonly string[]>;
  save(rows: readonly OwnerAssignmentRow[], removed: readonly string[], states?: readonly OwnerStateWrite[], prior?: readonly OwnerAssignmentHead[]): Promise<void>;
  scopeMembers(identities: readonly { readonly key: string; readonly ref: string }[]): Promise<ReadonlyMap<string, readonly string[]>>;
  publications(): Promise<readonly WorkItem[]>;
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

const ROW_FIELDS = `jsonb_build_object('id',id,'state',state_code,'builtAt',value->'builtAt',
  'group',value->'group','indexSegments',index_segments,'part',value->'part','nextAt',value->'nextAt')`;

/** PostgreSQL jsonb text for count rows: strings, booleans, nulls and integer counts. */
export function ownerRowJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(ownerRowJson).join(", ")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).filter(key => (value as Record<string, unknown>)[key] !== undefined)
    .sort((a,b) => Buffer.byteLength(a)-Buffer.byteLength(b) || Buffer.compare(Buffer.from(a),Buffer.from(b)))
    .map(key => `${JSON.stringify(key)}: ${ownerRowJson((value as Record<string, unknown>)[key])}`).join(", ")}}`;
  return JSON.stringify(value) ?? "null";
}
const digest = (value: unknown): string => createHash("md5").update(ownerRowJson(value)).digest("hex");
const fieldsOf = (row: OwnerAssignmentRow): Record<string, unknown> => ({
  g: Object.fromEntries(Object.entries(row.group).filter(([key]) => key !== "members" && key !== "publications")),
  m: row.group.members, p: row.group.publications,
  s: row.indexSegments.map(({lastActivityAt: _activity,...segment}) => segment),
  a: row.indexSegments.map(segment => segment.lastActivityAt), c: row.part,
});
export function ownerAssignmentHeadOf(row: OwnerAssignmentRow): OwnerAssignmentHead {
  return {id:row.id,state:row.state,members:row.group.members,clause:row.group.clause,subjectId:row.group.obligation?.subjectId??null,
    versions:Object.fromEntries(Object.entries(fieldsOf(row)).map(([key,value])=>[key,digest(value)]))};
}
export function ownerAssignmentContributions(rows: readonly OwnerAssignmentRow[]): ReadonlyMap<string,AssignmentPart> {
  const states = new Map<string,OwnerAssignmentRow[]>();
  for (const row of rows) states.set(row.state,[...(states.get(row.state)??[]),row]);
  return new Map([...states].map(([state,items])=>[state,mergeAssignmentParts(items.map(row=>({...row.part,usd:null,candidates:[]})),"1970-01-01T00:00:00.000Z")]));
}
function rowPatch(row: OwnerAssignmentRow, before: OwnerAssignmentHead | undefined): Record<string,unknown> {
  if (!before) return {...row};
  const fields = fieldsOf(row), changed = (key: string) => digest(fields[key]) !== before.versions[key];
  const group = {...(changed("g") ? fields.g as Record<string,unknown> : {}),...(changed("m")?{members:fields.m}:{}),...(changed("p")?{publications:fields.p}:{})};
  return {id:row.id,state:row.state,builtAt:row.builtAt,nextAt:row.nextAt,...(Object.keys(group).length?{group}:{}),
    ...(changed("c")?{part:row.part}:{}),...(changed("s")?{indexSegments:row.indexSegments}:changed("a")?{indexActivity:fields.a}:{})};
}

export function pgOwnerAssignmentRows(sql: Sql): OwnerAssignmentRows {
  const rows = async (text: string, args: readonly unknown[]) =>
    (await sql.query(text, args) as { value: unknown }[]).map(row => row.value as OwnerAssignmentRow);
  return {
    read: async ids => ids.length ? rows(`SELECT ${ROW_FIELDS} AS value FROM cp_owner_assignment_rows WHERE id=ANY($1::text[]) ORDER BY id`, [ids]) : [],
    async heads(ids) {
      if (!ids.length) return [];
      return await sql.query(`SELECT id,state_code AS state,members,clause,value #>> '{group,obligation,subjectId}' AS "subjectId",
        jsonb_build_object('g',md5(((value->'group')-'members'-'publications'-'usd'-'items'-'scoutKeys')::text),'m',md5(members::text),
          'p',md5((value #> '{group,publications}')::text),'s',md5((SELECT jsonb_agg(segment-'lastActivityAt'-'assignmentRefs'-'lastAttemptAt'-'directDependentCount'-'readyAfterThisSettlesCount' ORDER BY ordinal)
            FROM jsonb_array_elements(index_segments) WITH ORDINALITY s(segment,ordinal))::text),
          'a',md5((SELECT jsonb_agg(segment->'lastActivityAt' ORDER BY ordinal)
            FROM jsonb_array_elements(index_segments) WITH ORDINALITY s(segment,ordinal))::text),'c',md5(((value->'part')||'{"usd":null,"candidates":[]}'::jsonb)::text)) AS versions
        FROM cp_owner_assignment_rows WHERE id=ANY($1::text[]) ORDER BY id`,[ids]) as OwnerAssignmentHead[];
    },
    async contributions(ids) {
      if (!ids.length) return new Map();
      const found = await sql.query(`WITH RECURSIVE selected AS MATERIALIZED (
        SELECT state_code AS state,value->'part' AS part
        FROM cp_owner_assignment_rows WHERE id=ANY($1::text[])
      ), leaves(state,path,value) AS (
        SELECT state,ARRAY[]::text[],part-'usd'-'candidates' FROM selected
        UNION ALL SELECT state,path||e.key,e.value FROM leaves l
          CROSS JOIN LATERAL jsonb_each(CASE WHEN jsonb_typeof(l.value)='object' THEN l.value ELSE '{}'::jsonb END) e
      ), counts AS (SELECT state,path,sum((value #>> '{}')::bigint) AS n FROM leaves WHERE jsonb_typeof(value)='number' GROUP BY state,path)
      SELECT s.state,
        coalesce((SELECT jsonb_agg(jsonb_build_array(path,n) ORDER BY path) FROM counts c WHERE c.state=s.state),'[]'::jsonb) AS counts,
        (SELECT jsonb_agg(g.value) FROM selected i CROSS JOIN LATERAL jsonb_array_elements(i.part #> '{askGaps,open}') g(value) WHERE i.state=s.state) AS open
      FROM selected s GROUP BY s.state`,[ids]) as {state:string;counts:[string[],number][];open:AssignmentPart["askGaps"]["open"]|null}[];
      return new Map(found.map(row=>{
        const part = structuredClone(assignmentPartOf([],"1970-01-01T00:00:00.000Z"));
        for (const [path,value] of row.counts) {
          let target = part as unknown as Record<string,unknown>;
          for (const key of path.slice(0,-1)) target = (target[key]??={}) as Record<string,unknown>;
          target[path[path.length-1]] = Number(value);
        }
        return [row.state,{...part,askGaps:{...part.askGaps,open:row.open??[]}}];
      }));
    },
    async find(input) {
      const predicates: string[] = [], params: unknown[] = [];
      if (input.members?.length) predicates.push(`members ?| $${params.push(input.members)}::text[]`);
      if (input.clauses?.length) predicates.push(`clause=ANY($${params.push(input.clauses)}::text[])`);
      if (input.dueAt) predicates.push(`next_at <= $${params.push(input.dueAt)}`);
      return predicates.length ? (await sql.query(`SELECT id FROM cp_owner_assignment_rows WHERE ${predicates.join(" OR ")} ORDER BY id`, params) as { id: string }[]).map(row => row.id) : [];
    },
    async save(next, removed, states = [], prior = []) {
      const heads = new Map(prior.map(row=>[row.id,row]));
      const write = async (connection: Sql) => {
        await connection.query("BEGIN");
        try {
          if (removed.length) await connection.query("DELETE FROM cp_owner_assignment_rows WHERE id=ANY($1::text[])", [removed]);
          for (let at = 0; at < next.length; at += 100) {
            const batch = next.slice(at, at + 100).map(row=>rowPatch(row,heads.get(row.id)));
            await connection.query(`WITH incoming AS MATERIALIZED (
              SELECT patch->>'id' AS id,patch->>'state' AS state,patch FROM jsonb_array_elements($1::jsonb) p(patch)
            ), changed AS (
              UPDATE cp_owner_assignment_rows r SET state_code=p.state,value=(r.value || (p.patch-'group'-'indexActivity')) ||
                jsonb_build_object('group',((r.value->'group')-'usd'-'items'-'scoutKeys')||coalesce(p.patch->'group','{}'::jsonb),
                  'part',coalesce(p.patch->'part',r.value->'part')||'{"usd":null,"candidates":[]}'::jsonb,'indexSegments',(
                  SELECT jsonb_agg((segment-'assignmentRefs'-'lastAttemptAt'-'directDependentCount'-'readyAfterThisSettlesCount') ||
                    CASE WHEN p.patch ? 'indexActivity' THEN jsonb_build_object('lastActivityAt',p.patch->'indexActivity'->(ordinal-1)::integer) ELSE '{}'::jsonb END ORDER BY ordinal)
                  FROM jsonb_array_elements(coalesce(p.patch->'indexSegments',r.index_segments)) WITH ORDINALITY s(segment,ordinal)))
              FROM incoming p WHERE r.id=p.id RETURNING r.id
            ) INSERT INTO cp_owner_assignment_rows(id,state_code,value)
              SELECT id,state,patch FROM incoming p WHERE NOT EXISTS(SELECT 1 FROM changed c WHERE c.id=p.id)`,[JSON.stringify(batch)]);
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
    async publications() {
      const rows = await sql.query(`SELECT p.item FROM cp_owner_assignment_rows r
        CROSS JOIN LATERAL jsonb_array_elements(coalesce(r.value #> '{group,publications}','[]'::jsonb)) p(item)
        WHERE ${ownerReadbackWhere("p.item")}
        ORDER BY p.item->>'id'`, []) as {item:WorkItem}[];
      return rows.map(row => row.item);
    },
    async clear() { await sql.query("DELETE FROM cp_owner_assignment_rows"); },
  };
}
