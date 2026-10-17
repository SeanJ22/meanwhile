import { createHash } from "node:crypto";
import { withCallerSite } from "../../db/transfer-by-caller.ts";
import { boundedQuery, CONTROL_PLANE_REQUEST_BOUNDS_MS, type ControlPlaneRequestBounds } from "./request-bounds.ts";
import type { RouteTask } from "../route-task.ts";
import type { WorkItem } from "../work-item.ts";
import type { StandingLineage } from "../workers/standing-lineage.ts";
import type { FreshnessOccurrence } from "../scheduler/durable.ts";
import { ConcurrentModification, CorruptPersistedState, UnknownAggregate, type AggregateRepository, type ControlPlaneRepositories, type Persisted } from "./types.ts";
import type { Sql } from "./pg-store.ts";

export interface DispatchSnapshot {
  readonly occurrences: ReadonlyMap<string, Persisted<FreshnessOccurrence>>;
  readonly workItems: ReadonlyMap<string, Persisted<WorkItem>>;
  readonly routeTasks: ReadonlyMap<string, Persisted<RouteTask>>;
  readonly through: string | null;
}
export interface DispatchRead {
  readonly obligationIds?: readonly string[];
  readonly since?: string | null;
}
export interface DispatchStateRepository {
  readOpen(input?: DispatchRead): Promise<DispatchSnapshot>;
  archiveOccurrence(id: string, now: string): Promise<void>;
  prepareLineages(ids: readonly string[]): Promise<void>;
  lineages(obligationId: string, load: () => Promise<readonly StandingLineage[]>, stamp?: string): Promise<readonly StandingLineage[]>;
}

const OPEN_STATES = ["PENDING", "CLAIMED", "RECLAIMABLE", "POLICY_DENIED"];
const byId = <T>(rows: readonly Persisted<T>[]) => new Map(rows.map(row => [row.id, row]));
const ordered = <T>(rows: readonly Persisted<T>[]) => {
  const unique = new Map<string, Persisted<T>>();
  for (const row of rows) if (row.revision >= (unique.get(row.id)?.revision ?? 0)) unique.set(row.id, row);
  return [...unique.values()].sort((a, b) => a.id.localeCompare(b.id));
};

export function archivedAggregateRepository<T>(hot: AggregateRepository<T>, archive: AggregateRepository<T>): AggregateRepository<T> {
  const read = async (id: string) => await hot.read(id) ?? await archive.read(id);
  const readMany = async (ids: readonly string[]) => {
    const current = hot.readMany ? await hot.readMany(ids) : (await Promise.all(ids.map(id => hot.read(id)))).filter(row => row !== null);
    const held = new Set(current.map(row => row.id));
    const missing = ids.filter(id => !held.has(id));
    const old = archive.readMany ? await archive.readMany(missing) : (await Promise.all(missing.map(id => archive.read(id)))).filter(row => row !== null);
    return ordered([...current, ...old]);
  };
  const list = async () => ordered([...(await hot.list()), ...(await archive.list())]);
  return {
    read, readMany, list,
    async mustRead(id) { const row = await read(id); if (!row) throw new UnknownAggregate("ArchivedAggregate", id); return row; },
    async readNarrowed(id, projection) { return await hot.readNarrowed(id, projection) ?? await archive.readNarrowed(id, projection); },
    async put(id, value, now) {
      if (await archive.readNarrowed(id, {})) return archive.put(id, value, now);
      try { return await hot.put(id, value, now); }
      catch (error) {
        if (error instanceof CorruptPersistedState && await archive.readNarrowed(id, {})) return archive.put(id, value, now);
        throw error;
      }
    },
    async compareAndSet(id, revision, value, now) {
      if (!await hot.readNarrowed(id, {})) return archive.compareAndSet(id, revision, value, now);
      try { return await hot.compareAndSet(id, revision, value, now); }
      catch (error) {
        if (error instanceof ConcurrentModification && error.foundRevision === null) return archive.compareAndSet(id, revision, value, now);
        throw error;
      }
    },
    async listNarrowed(projection) { return ordered([...(await hot.listNarrowed(projection)), ...(await archive.listNarrowed(projection))]); },
    async listWhere(path, value) { return ordered([...(await hot.listWhere(path, value)), ...(await archive.listWhere(path, value))]); },
    async listWhereNarrowed(path, value, projection) {
      return ordered([...(await hot.listWhereNarrowed(path, value, projection)), ...(await archive.listWhereNarrowed(path, value, projection))]);
    },
    async listChangedSince(since, held) {
      if (!hot.listChangedSince || !archive.listChangedSince) throw new Error("ARCHIVE_CHANGED_READ_UNAVAILABLE");
      const current = await hot.listChangedSince(since, held), old = await archive.listChangedSince(since, held);
      return { rows: ordered([...current.rows, ...old.rows]), through: [current.through, old.through].filter((at): at is string => at !== null).sort()[0] ?? null };
    },
  };
}

export function createDispatchState(repos: () => ControlPlaneRepositories,
  archive: (occurrence: FreshnessOccurrence, now: string) => Promise<void> = async () => {}): DispatchStateRepository {
  return {
    async readOpen(input = {}) {
      const store = repos();
      const allOccurrences = (input.obligationIds
        ? (await Promise.all(input.obligationIds.map(id => store.occurrences.listWhere(["obligationId"], id)))).flat()
        : await store.occurrences.list());
      const occurrences = allOccurrences.filter(row => row.value.closedAt === null);
      const closedTasks = new Set(allOccurrences.filter(row => row.value.closedAt !== null).map(row => row.value.routeTaskId));
      const routeTasks = input.obligationIds
        ? (await Promise.all(occurrences.map(row => store.routeTasks.read(row.value.routeTaskId)))).filter(row => row !== null)
        : (await Promise.all(OPEN_STATES.map(state => store.routeTasks.listWhere(["state"], state)))).flat();
      const tasks = byId(routeTasks.filter(row => !closedTasks.has(row.id)));
      for (const occurrence of occurrences) if (!tasks.has(occurrence.value.routeTaskId)) {
        const row = await store.routeTasks.read(occurrence.value.routeTaskId); if (row) tasks.set(row.id, row);
      }
      const ids = [...new Set([...occurrences.map(row => row.value.workItemId), ...[...tasks.values()].map(row => row.value.workItemId)])];
      const items = store.workItems.readMany ? await store.workItems.readMany(ids) : (await Promise.all(ids.map(id => store.workItems.read(id)))).filter(row => row !== null);
      return { occurrences: byId(occurrences), routeTasks: tasks, workItems: byId(items), through: new Date().toISOString() };
    },
    async archiveOccurrence(id, now) { const row = await repos().occurrences.read(id); if (row?.value.closedAt !== null && row) await archive(row.value, now); },
    prepareLineages: async () => {},
    lineages: (_id, load) => load(),
  };
}

function persisted<T>(row: Record<string, unknown>): Persisted<T> {
  return { id: String(row.id), revision: Number(row.revision), updatedAt: new Date(row.updated_at as string).toISOString(),
    value: (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as T };
}

export function createPgDispatchState(sql: Sql, repos: () => ControlPlaneRepositories,
  bounds: ControlPlaneRequestBounds = CONTROL_PLANE_REQUEST_BOUNDS_MS, state?: string): DispatchStateRepository {
  const run = (operation: string, text: string, params: readonly unknown[] = [], page = false) =>
    boundedQuery(sql, { operation: `cp_dispatch.${operation}`, callClass: page ? "PAGE" : "POINT" }, text, params, { bounds });
  async function rows<T>(table: string, predicate: string, params: readonly unknown[]): Promise<Persisted<T>[]> {
    const out: Persisted<T>[] = [];
    let after = "";
    for (;;) {
      const page = await run(`readOpen:${table}`, `SELECT id, revision, updated_at, value FROM ${table}
        WHERE ${predicate} ${state ? table === 'cp_route_tasks' ? `AND EXISTS (SELECT 1 FROM cp_work_items_history w WHERE w.id=${table}.value->>'workItemId' AND cp_control_state(w.value)='${state}')` : `AND cp_control_state(value)='${state}'` : ""} AND id > $${params.length + 1} ORDER BY id LIMIT 100`, [...params, after], true) as Record<string, unknown>[];
      out.push(...page.map(row => persisted<T>(row)));
      if (page.length < 100) return out;
      after = String(page[page.length - 1].id);
    }
  }
  const lineageCache=new Map<string,{stamp:string;value:StandingLineage[];dirty:boolean;generation:number}>();
  return {
    async readOpen(input = {}) {
      return withCallerSite(async () => {
      const scope = state ?? (input.obligationIds ? createHash("sha256").update([...input.obligationIds].sort().join("\n")).digest("hex") : "*");
      const clock = await run("readOpen:cursor", "SELECT now() AS at, (SELECT through FROM cp_dispatch_cursors WHERE id=$1) AS since", [scope]) as { at: string; since: string | null }[];
      const through = new Date(clock[0].at).toISOString();
      const since = input.since ?? (clock[0].since ? new Date(Date.parse(String(clock[0].since)) - 120_000).toISOString() : null);
      const selected = input.obligationIds;
      const occurrences = await rows<FreshnessOccurrence>("cp_occurrences", selected
        ? "value->>'closedAt' IS NULL AND value #>> '{obligationId}' = ANY($1::text[])"
        : "value->>'closedAt' IS NULL", selected ? [selected] : []);
      const occurrenceTasks = occurrences.map(row => row.value.routeTaskId);
      const tasks = selected ? [] : await rows<RouteTask>("cp_route_tasks", "value->>'state' = ANY($1::text[])", [OPEN_STATES]);
      const taskMap = byId(tasks);
      const missing = occurrenceTasks.filter(id => !taskMap.has(id));
      for (let at = 0; at < missing.length; at += 100) for (const row of await rows<RouteTask>("cp_route_tasks", "id = ANY($1::text[])", [missing.slice(at, at + 100)])) taskMap.set(row.id, row);
      if (since && !selected) for (const row of await rows<RouteTask>("cp_route_tasks",
        "changed_at >= $1::timestamptz AND value->>'state' IN ('DISPOSED', 'RESULT_RECORDED')", [since])) taskMap.set(row.id, row);
      const workIds = [...new Set([...occurrences.map(row => row.value.workItemId), ...[...taskMap.values()].map(row => row.value.workItemId)])];
      const work = repos().workItems;
      const items = work.readMany ? await work.readMany(workIds) : (await Promise.all(workIds.map(id => work.read(id)))).filter(row => row !== null);
      await run("readOpen:cursor", "INSERT INTO cp_dispatch_cursors (id, through) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET through=GREATEST(cp_dispatch_cursors.through, EXCLUDED.through)", [scope, through]);
      return { occurrences: byId(occurrences), routeTasks: taskMap, workItems: byId(items), through };
      });
    },
    async archiveOccurrence(id) { await withCallerSite(() => run("archiveOccurrence", "SELECT cp_archive_occurrences(ARRAY[$1]::text[])", [id])); },
    async prepareLineages(ids) {
      lineageCache.clear();
      for(let at=0;at<ids.length;at+=100) {
        const rows=await run("lineages:prepare","SELECT id,stamp,value,dirty,generation FROM cp_lineage_cache WHERE id=ANY($1::text[])",[ids.slice(at,at+100)],true) as {id:string;stamp:string;value:StandingLineage[];dirty:boolean;generation:number}[];
        for(const row of rows)lineageCache.set(row.id,{...row,generation:Number(row.generation)});
      }
    },
    async lineages(obligationId,load,stamp) {
      return withCallerSite(async()=>{
        let held=lineageCache.get(obligationId);
        if(stamp===undefined) {
          const rows=await run("lineages:revision","SELECT dirty,generation FROM cp_lineage_cache WHERE id=$1",[obligationId]) as {dirty:boolean;generation:number}[];
          if(rows[0])held=held?{...held,dirty:rows[0].dirty || Number(rows[0].generation)!==held.generation,generation:Number(rows[0].generation)}
            :{stamp:"",value:[],dirty:true,generation:Number(rows[0].generation)};
        }
        const currentStamp=stamp??held?.stamp??"";
        if(held && !held.dirty && held.stamp===currentStamp)return held.value;
        const value=await load();
        const rows=await run("lineages:save",held
          ? "UPDATE cp_lineage_cache SET stamp=$2,value=$3::jsonb,dirty=false WHERE id=$1 AND generation=$4 RETURNING generation"
          : "INSERT INTO cp_lineage_cache(id,stamp,value,dirty,generation) VALUES($1,$2,$3::jsonb,false,$4) ON CONFLICT(id) DO NOTHING RETURNING generation",
        [obligationId,currentStamp,JSON.stringify(value),held?.generation??1],true) as {generation:number}[];
        if(rows.length)lineageCache.set(obligationId,{stamp:currentStamp,value:[...value],dirty:false,generation:Number(rows[0].generation)});
        return value;
      });
    },
  };
}

const ARCHIVED_TABLES = ["occurrences", "route_tasks", "work_items"] as const;
export const DISPATCH_ARCHIVE_TABLES = ARCHIVED_TABLES.map(kind => `cp_${kind}_archive`);
export const DISPATCH_STATE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS cp_dispatch_cursors (id text PRIMARY KEY, through timestamptz NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS cp_lineage_cache (id text PRIMARY KEY,stamp text NOT NULL,value jsonb NOT NULL,dirty boolean NOT NULL DEFAULT true,generation bigint NOT NULL DEFAULT 1);`,
  ...ARCHIVED_TABLES.map(kind => `CREATE TABLE IF NOT EXISTS cp_${kind}_archive (LIKE cp_${kind} INCLUDING ALL);`),
  ...ARCHIVED_TABLES.map(kind => `CREATE OR REPLACE VIEW cp_${kind}_history AS
    SELECT * FROM cp_${kind} UNION ALL SELECT * FROM cp_${kind}_archive;`),
  `CREATE OR REPLACE FUNCTION cp_invalidate_lineage_cache() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE envelope jsonb; body jsonb; work_id text; root_id text; obligations text[];
    BEGIN
      envelope:=coalesce(to_jsonb(NEW),to_jsonb(OLD)); body:=coalesce(envelope->'value',envelope->'record');
      IF TG_TABLE_NAME IN ('cp_occurrences','cp_occurrences_archive') THEN obligations:=ARRAY[body->>'obligationId'];
      ELSE
        work_id:=coalesce(body->>'workItemId',CASE WHEN TG_TABLE_NAME IN ('cp_work_items','cp_work_items_archive') THEN envelope->>'id' END,envelope->>'log_key');
        root_id:=coalesce(body #>> '{planRepair,rootWorkItemId}',work_id);
        SELECT array_agg(value->>'obligationId') INTO obligations FROM cp_occurrences_history
          WHERE value #>> '{workItemId}'=ANY(ARRAY[work_id,root_id]);
      END IF;
      INSERT INTO cp_lineage_cache(id,stamp,value,dirty,generation)
        SELECT DISTINCT id,'','[]'::jsonb,true,1 FROM unnest(obligations) id WHERE id IS NOT NULL
        ON CONFLICT(id) DO UPDATE SET dirty=true,generation=cp_lineage_cache.generation+1;
      RETURN NULL;
    END $$;`,
  ...["cp_occurrences","cp_occurrences_archive","cp_work_items","cp_work_items_archive","cp_route_tasks","cp_route_tasks_archive","cp_attempts","cp_log_artifacts","cp_log_worker_results"]
    .map(table=>`CREATE OR REPLACE TRIGGER ${table}_lineage_changed AFTER INSERT OR UPDATE OR DELETE ON ${table}
      FOR EACH ROW EXECUTE FUNCTION cp_invalidate_lineage_cache();`),
  `CREATE OR REPLACE FUNCTION cp_check_archive_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE archived boolean;
    BEGIN
      PERFORM pg_advisory_xact_lock(hashtext(TG_TABLE_NAME), hashtext(NEW.id));
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id=$1)', TG_TABLE_NAME || '_archive') INTO archived USING NEW.id;
      IF archived THEN RETURN NULL; END IF;
      RETURN NEW;
    END $$;`,
  ...ARCHIVED_TABLES.map(kind => `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_${kind}_archive_insert' AND tgrelid='cp_${kind}'::regclass) THEN
      CREATE TRIGGER cp_${kind}_archive_insert BEFORE INSERT ON cp_${kind} FOR EACH ROW EXECUTE FUNCTION cp_check_archive_insert();
    END IF;
  END $$;`),
  `CREATE OR REPLACE FUNCTION cp_allow_archived_delete() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE preserved boolean;
    BEGIN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id=$1 AND revision=$2 AND value=$3)', TG_TABLE_NAME || '_archive')
        INTO preserved USING OLD.id, OLD.revision, OLD.value;
      IF NOT preserved THEN RAISE EXCEPTION 'deletion requires an exact archived copy' USING ERRCODE='restrict_violation'; END IF;
      RETURN OLD;
    END $$;`,
  ...ARCHIVED_TABLES.map(kind =>
    `CREATE OR REPLACE TRIGGER cp_${kind}_no_rewrite BEFORE DELETE ON cp_${kind} FOR EACH ROW EXECUTE FUNCTION cp_allow_archived_delete();`),
  `CREATE OR REPLACE FUNCTION cp_archive_occurrences(requested_ids text[]) RETURNS integer LANGUAGE plpgsql AS $$
    DECLARE held_ids text[];
    BEGIN
      SELECT array_agg(id) INTO held_ids FROM (
        SELECT id FROM cp_occurrences WHERE id=ANY(requested_ids) AND value->>'closedAt' IS NOT NULL ORDER BY id FOR UPDATE
      ) held;
      IF held_ids IS NULL THEN RETURN 0; END IF;
      PERFORM pg_advisory_xact_lock(hashtext('cp_occurrences'), hashtext(id)) FROM cp_occurrences WHERE id=ANY(held_ids) ORDER BY id;
      PERFORM pg_advisory_xact_lock(hashtext('cp_route_tasks'), hashtext(value->>'routeTaskId')) FROM cp_occurrences WHERE id=ANY(held_ids) ORDER BY value->>'routeTaskId';
      PERFORM pg_advisory_xact_lock(hashtext('cp_work_items'), hashtext(value->>'workItemId')) FROM cp_occurrences WHERE id=ANY(held_ids) ORDER BY value->>'workItemId';
      INSERT INTO cp_route_tasks_archive SELECT * FROM cp_route_tasks
        WHERE id IN (SELECT value->>'routeTaskId' FROM cp_occurrences WHERE id=ANY(held_ids)) FOR UPDATE;
      INSERT INTO cp_work_items_archive SELECT * FROM cp_work_items
        WHERE id IN (SELECT value->>'workItemId' FROM cp_occurrences WHERE id=ANY(held_ids)) FOR UPDATE;
      INSERT INTO cp_occurrences_archive SELECT * FROM cp_occurrences WHERE id=ANY(held_ids);
      DELETE FROM cp_route_tasks WHERE id IN (SELECT value->>'routeTaskId' FROM cp_occurrences WHERE id=ANY(held_ids));
      DELETE FROM cp_work_items WHERE id IN (SELECT value->>'workItemId' FROM cp_occurrences WHERE id=ANY(held_ids));
      DELETE FROM cp_occurrences WHERE id=ANY(held_ids);
      RETURN cardinality(held_ids);
    END $$;`,
  ...ARCHIVED_TABLES.map(kind => `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='cp_${kind}_archive_no_rewrite' AND tgrelid='cp_${kind}_archive'::regclass) THEN
      CREATE TRIGGER cp_${kind}_archive_no_rewrite BEFORE DELETE ON cp_${kind}_archive FOR EACH ROW EXECUTE FUNCTION cp_reject_rewrite();
    END IF;
  END $$;`),
  `CREATE INDEX IF NOT EXISTS cp_occurrences_open ON cp_occurrences (id) WHERE value->>'closedAt' IS NULL;`,
  `CREATE INDEX IF NOT EXISTS cp_occurrences_closed ON cp_occurrences (id) WHERE value->>'closedAt' IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS cp_work_items_repair_root ON cp_work_items ((value #>> '{planRepair,rootWorkItemId}'));`,
  `CREATE INDEX IF NOT EXISTS cp_work_items_archive_repair_root ON cp_work_items_archive ((value #>> '{planRepair,rootWorkItemId}'));`,
];
