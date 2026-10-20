import { neon } from "@neondatabase/serverless";
import { AGGREGATE_LIST_READ_PAGE, controlPlaneUrlFromEnv } from "../repository/pg-store.ts";
import { boundedQuery, type BoundableSql } from "../repository/request-bounds.ts";
import type { RecordProjection } from "../repository/types.ts";
import type { RouteTask } from "../route-task.ts";

export const HELD_DIGGER_GAP_ROUTES = ["AGENDA_NOT_HELD", "CALENDAR_STALE", "OUTCOME_NOT_READ", "OUTCOMES_UNREADABLE", "MEETINGS_NOT_HELD"] as const;
export const HELD_DIGGER_CLASSES = ["HELD_MEETING_DETAILS", "HELD_SUBJECT_DETAILS"] as const;
export const HELD_DIGGER_SOURCE_FIELDS: RecordProjection = { id: true, workItemId: true, routeId: true, state: true,
  workerTask: ["role"], disposition: ["disposition", "artifactIds"] };
export type HeldDiggerSourceChange = Pick<RouteTask, "id" | "workItemId" | "routeId" | "state"> & {
  readonly workerTask?: { readonly role: string };
  readonly disposition: Pick<NonNullable<RouteTask["disposition"]>, "disposition" | "artifactIds"> | null;
};
export interface HeldDiggerSourceRow { readonly id: string; readonly value: HeldDiggerSourceChange }
export interface HeldDiggerReads {
  sourceChanges(since: string | null, page: (rows: readonly HeldDiggerSourceRow[]) => Promise<void>): Promise<{ readonly through: string }>;
  pendingTaskIds(): Promise<readonly string[]>;
}

export const HELD_DIGGER_READ_CLOCK_SQL = "SELECT clock_timestamp() AS read_at";
export const HELD_DIGGER_SOURCES_SQL = `SELECT id,jsonb_build_object('id',id,'workItemId',value->>'workItemId',
    'routeId',value->>'routeId','state',value->>'state',
    'disposition',jsonb_build_object('disposition','INGESTED','artifactIds',value#>'{disposition,artifactIds}')) value
  FROM cp_route_tasks WHERE ($1::timestamptz IS NULL OR changed_at>=$1::timestamptz) AND changed_at<=$2::timestamptz
    AND ($3::text IS NULL OR id>$3::text) AND value->>'state'='DISPOSED'
    AND coalesce(jsonb_typeof(value->'workerTask'),'null')='null'
    AND value#>>'{disposition,disposition}'='INGESTED'
    AND CASE WHEN jsonb_typeof(value#>'{disposition,artifactIds}')='array'
      THEN jsonb_array_length(value#>'{disposition,artifactIds}')>0 ELSE false END
    AND (value->>'routeId'=ANY($4::text[]) OR value->>'routeId' LIKE 'held-subject-details:%')
  ORDER BY id LIMIT $5::int`;
export const HELD_DIGGER_PENDING_SQL = `SELECT id FROM cp_route_tasks
  WHERE value#>>'{workerTask,contract,recordClass}'=ANY($1::text[])
    AND value#>>'{workerTask,role}'='ACQUIRER' AND value#>'{workerTask,contract,schemaVersion}'='2'::jsonb
    AND value->>'state' IN ('PENDING','RECLAIMABLE') AND ($2::text IS NULL OR id>$2::text)
  ORDER BY id LIMIT $3::int`;

/** Narrow metadata pages only; the caller advances its durable cursor after all pages and enqueues succeed. */
export function createHeldDiggerReads(sql: BoundableSql, pageSize = AGGREGATE_LIST_READ_PAGE): HeldDiggerReads {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > AGGREGATE_LIST_READ_PAGE) throw new Error("HELD_DIGGER_PAGE_SIZE_INVALID");
  const run = async (operation: string, text: string, params: readonly unknown[] = []) =>
    await boundedQuery(sql, { operation: `cp_route_tasks.heldDiggers:${operation}`, callClass: operation === "clock" ? "POINT" : "PAGE" }, text, params) as Record<string, unknown>[];
  return {
    async sourceChanges(since, page) {
      if (since !== null && !Number.isFinite(Date.parse(since))) throw new Error("HELD_DIGGER_SOURCE_CURSOR_INVALID");
      const [clock] = await run("clock", HELD_DIGGER_READ_CLOCK_SQL);
      if (clock?.read_at == null) throw new Error("HELD_DIGGER_SOURCE_CLOCK_UNAVAILABLE");
      const observed = new Date(clock?.read_at as string | Date).getTime();
      if (!Number.isFinite(observed)) throw new Error("HELD_DIGGER_SOURCE_CLOCK_UNAVAILABLE");
      const through = new Date(observed).toISOString();
      let after: string | null = null;
      for (;;) {
        const rows = await run("sources", HELD_DIGGER_SOURCES_SQL, [since, through, after, HELD_DIGGER_GAP_ROUTES, pageSize]);
        const selected = rows.map(row => ({ id: String(row.id),
          value: (typeof row.value === "string" ? JSON.parse(row.value) : row.value) as HeldDiggerSourceChange }));
        if (selected.length) await page(selected);
        if (selected.length < pageSize) break;
        after = selected[selected.length - 1]!.id;
      }
      return { through };
    },
    async pendingTaskIds() {
      const ids: string[] = [];
      let after: string | null = null;
      for (;;) {
        const rows = await run("pending", HELD_DIGGER_PENDING_SQL, [HELD_DIGGER_CLASSES, after, pageSize]);
        ids.push(...rows.map(row => String(row.id)));
        if (rows.length < pageSize) return ids;
        after = String(rows[rows.length - 1]!.id);
      }
    },
  };
}

/** A production pass never falls back to scanning an in-memory or whole-table repository history. */
export function configuredHeldDiggerReads(env: NodeJS.ProcessEnv = process.env): HeldDiggerReads {
  const url = controlPlaneUrlFromEnv(env);
  if (!url) throw new Error("HELD_DIGGER_SOURCE_DATABASE_UNCONFIGURED");
  return createHeldDiggerReads(neon(url));
}
