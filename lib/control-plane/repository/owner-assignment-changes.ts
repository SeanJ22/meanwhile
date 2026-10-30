import type { LogCursor } from "../owner-snapshot-totals.ts";
import { stateCodeOf } from "../unit-state.ts";
import type { Sql } from "./pg-store.ts";
import { boundedQuery } from "./request-bounds.ts";

export interface OwnerAssignmentChangeInput {
  readonly through: string | null;
  readonly cursors: Readonly<Record<string, LogCursor>>;
  readonly slackMs: number;
}
export interface OwnerAssignmentChangeBatch {
  readonly through: string;
  readonly cursors: Record<string, LogCursor>;
  readonly groups: readonly { readonly id: string; readonly state: string }[];
  readonly items: readonly string[];
  readonly changedAttempts: readonly string[];
  readonly changedWorkItems: readonly string[];
  readonly links: readonly { readonly id: string; readonly parent: string | null }[];
}
export interface OwnerAssignmentChanges {
  read(input: OwnerAssignmentChangeInput): Promise<OwnerAssignmentChangeBatch>;
}

const sources = [
  ["obligations", "cp_obligations", "t.id", "NULL", "NULL", "NULL"],
  ["occurrences", "cp_occurrences_history", "t.value#>>'{obligationId}'", "t.value#>>'{workItemId}'", "NULL", "NULL"],
  ["debts", "cp_debts", "t.value#>>'{obligationId}'", "NULL", "NULL", "NULL"],
  ["askGapObservations", "cp_ask_gap_observations", "'freshness:ask-gap:'||(t.value#>>'{bodyId}')||'#'||(t.value#>>'{code}')", "NULL", "NULL", "NULL"],
  ["workItems", "cp_work_items_history", "NULL", "t.id", "NULL", "coalesce(t.value#>>'{directoryParent,workItemId}',t.value#>>'{planRepair,parentWorkItemId}')"],
  ["routeTasks", "cp_route_tasks_history", "NULL", "t.value#>>'{workItemId}'", "NULL", "NULL"],
  ["attempts", "cp_attempts", "NULL", "t.value#>>'{workItemId}'", "t.id", "NULL"],
  ["leases", "cp_leases", "NULL", "(SELECT value#>>'{workItemId}' FROM cp_route_tasks_history WHERE id=t.value#>>'{routeTaskId}' LIMIT 1)", "NULL", "NULL"],
  ["artifacts", "cp_log_artifacts", "NULL", "t.record#>>'{workItemId}'", "NULL", "NULL"],
  ["workerResults", "cp_log_worker_results", "NULL", "t.record#>>'{workItemId}'", "NULL", "NULL"],
  ["scoutResults", "cp_log_scout_results", "NULL", "coalesce(nullif(t.record#>>'{workItemId}',''),(SELECT value#>>'{workItemId}' FROM cp_attempts WHERE id=t.record#>>'{attemptId}'))", "NULL", "NULL"],
] as const;

const changed = sources.map(([name, table, group, item, attempt, parent]) => {
  const log = table.startsWith("cp_log_"), key = log ? "t.log_key" : "t.id";
  const version = log ? "t.position" : name === "leases" ? "coalesce(t.owner_revision,t.revision)" : "t.revision";
  const at = name === "leases" ? "coalesce(t.owner_changed_at,t.changed_at)" : "t.changed_at";
  return `SELECT '${name}'::text AS name,${key} AS key,${version}::bigint AS version,${at} AS changed_at,
    (${group})::text AS group_id,(${item})::text AS work_item_id,(${attempt})::text AS attempt_id,(${parent})::text AS parent
    FROM ${table} t WHERE ${at}>=($1::jsonb#>>'{${name},since}')::timestamptz AND NOT EXISTS
      (SELECT 1 FROM held h WHERE h.name='${name}' AND h.key=${key} AND h.version=${version})`;
}).join("\nUNION ALL\n");

/** Source bodies and per-record versions stay beside the rows; only distinct affected assignments cross the connection. */
export const OWNER_ASSIGNMENT_CHANGES_SQL = `WITH
windows AS MATERIALIZED (SELECT key AS name,value->'held' AS held FROM jsonb_each($1::jsonb)),
held AS MATERIALIZED (SELECT w.name,s->>0 AS key,(s->>1)::bigint AS version FROM windows w CROSS JOIN LATERAL jsonb_array_elements(w.held) s),
changes AS MATERIALIZED (${changed}),
items AS MATERIALIZED (SELECT DISTINCT work_item_id FROM changes WHERE work_item_id IS NOT NULL AND work_item_id<>''),
owners AS MATERIALIZED (SELECT id,state_code,members FROM cp_owner_assignment_rows WHERE members ?| ARRAY(SELECT work_item_id FROM items)),
owned AS MATERIALIZED (SELECT i.work_item_id,r.id,r.state_code FROM owners r
  CROSS JOIN LATERAL jsonb_array_elements_text(r.members) member(id) JOIN items i ON i.work_item_id=member.id),
groups AS MATERIALIZED (
  SELECT c.group_id AS id,r.state_code FROM (SELECT DISTINCT group_id FROM changes WHERE group_id IS NOT NULL) c
    LEFT JOIN cp_owner_assignment_rows r ON r.id=c.group_id
  UNION SELECT id,state_code FROM owned
),
probes AS MATERIALIZED (SELECT i.work_item_id FROM items i WHERE NOT EXISTS(SELECT 1 FROM owned o WHERE o.work_item_id=i.work_item_id) AND (
  EXISTS(SELECT 1 FROM cp_work_items_history w WHERE w.id=i.work_item_id OFFSET 0) OR
  EXISTS(SELECT 1 FROM cp_occurrences_history o WHERE o.value#>>'{workItemId}'=i.work_item_id OFFSET 0) OR
  EXISTS(SELECT 1 FROM cp_route_tasks_history t WHERE t.value#>>'{workItemId}'=i.work_item_id OFFSET 0) OR
  EXISTS(SELECT 1 FROM cp_attempts a WHERE a.value#>>'{workItemId}'=i.work_item_id OFFSET 0) OR
  EXISTS(SELECT 1 FROM cp_log_worker_results r WHERE r.log_key=i.work_item_id OFFSET 0)
)),
links AS MATERIALIZED (SELECT DISTINCT ON(work_item_id) work_item_id,parent FROM changes WHERE name='workItems' ORDER BY work_item_id,version DESC)
SELECT coalesce((SELECT jsonb_agg(jsonb_build_array(id,state_code) ORDER BY id) FROM groups),'[]'::jsonb) AS groups,
  ARRAY(SELECT work_item_id FROM probes ORDER BY work_item_id) AS items,
  ARRAY(SELECT DISTINCT attempt_id FROM changes WHERE attempt_id IS NOT NULL ORDER BY attempt_id) AS changed_attempts,
  ARRAY(SELECT work_item_id FROM items ORDER BY work_item_id) AS changed_work_items,
  coalesce((SELECT jsonb_agg(jsonb_build_array(work_item_id,parent) ORDER BY work_item_id) FROM links),'[]'::jsonb) AS links,
  coalesce((SELECT jsonb_agg(jsonb_build_array(name,key,version,changed_at)) FROM changes
    WHERE changed_at >= $2::timestamptz - $3::double precision * interval '1 millisecond'),'[]'::jsonb) AS held`;

export function pgOwnerAssignmentChanges(sql: Sql): OwnerAssignmentChanges {
  return { async read(input) {
    const [clock] = await boundedQuery(sql, { operation: "cp_owner_assignment_rows.changes:clock", callClass: "POINT" }, "SELECT now() AS through") as { through: string }[];
    const through = new Date(clock.through).toISOString(), cutoff = Date.parse(through) - input.slackMs;
    const windows = Object.fromEntries(sources.map(([name]) => {
      const prior = input.cursors[name], since = input.through === null ? null : new Date(Date.parse(prior?.through ?? input.through) - input.slackMs).toISOString();
      return [name, { since: since ?? "-infinity", held: (prior?.held ?? []).filter(([, , at]) => since === null || at >= since).map(([key, version]) => [key, version]) }];
    }));
    const [row] = await boundedQuery(sql, { operation: "cp_owner_assignment_rows.changes", callClass: "PAGE" }, OWNER_ASSIGNMENT_CHANGES_SQL,
      [JSON.stringify(windows), through, input.slackMs]) as { groups: [string, string | null][]; items: string[]; changed_attempts: string[];
        changed_work_items: string[]; links: [string, string | null][]; held: [string, string, number, string][] }[];
    const cursors: Record<string, LogCursor> = {};
    for (const [name] of sources) {
      const slots = [...(input.cursors[name]?.held ?? []).filter(([, , at]) => Date.parse(at) >= cutoff),
        ...row.held.filter(([source]) => source === name).map(([, key, version, at]) => [key, Number(version), new Date(at).toISOString()] as const)];
      cursors[name] = { through, held: [...new Map(slots.map(slot => [JSON.stringify(slot.slice(0, 2)), slot])).values()] };
    }
    return { through, cursors, groups: row.groups.map(([id, state]) => ({ id, state: state ?? stateCodeOf(id, "") ?? "other" })),
      items: row.items, changedAttempts: row.changed_attempts, changedWorkItems: row.changed_work_items, links: row.links.map(([id, parent]) => ({ id, parent })) };
  } };
}
