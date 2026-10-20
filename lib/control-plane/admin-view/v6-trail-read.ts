import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { readAssignmentSourcesById } from "../assignment-read.ts";
import { assignmentEvidenceTrail, type AssignmentEvidenceTrail } from "./assignment-evidence-trail.ts";
import { workName } from "./v6-spend-read.ts";

export const ADMIN_V6_TRAIL_CONTRACT = "admin-v6/trail@1" as const;
export const REACHED_LIMIT = 12;
export const TRAIL_EVENT_LIMIT = 40;
export const TRAIL_ID = /^[A-Za-z0-9:._@#+/ -]{1,240}$/;

export interface TrailEventView {
  readonly id: string;
  readonly stage: "SOURCE" | "ATTEMPT" | "SAVED" | "EXTRACTED" | "CHECKED" | "PUBLISHED" | "READER";
  readonly at: string | null;
  readonly title: string;
  readonly says: string;
  readonly nextAction: string | null;
  readonly sourceUrl: string | null;
  readonly publicUrl: string | null;
  readonly privateCopy: { readonly path: string; readonly byteLength: number } | null;
  readonly references: readonly (readonly [string, string])[];
}
/** Structurally `TrailView` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6Trail {
  readonly events: readonly TrailEventView[];
  readonly eventsHidden: number;
  readonly gaps: readonly string[];
}
/** Structurally `ReachedView` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6Reached {
  readonly total: number;
  readonly rows: readonly { readonly id: string; readonly label: string; readonly relation: "created" | "reordered" | "other"; readonly at: string }[];
}

export function trailView(trail: AssignmentEvidenceTrail): AdminV6Trail {
  return {
    events: trail.events.slice(0, TRAIL_EVENT_LIMIT).map((e): TrailEventView => ({ id: e.id, stage: e.stage, at: e.at, title: e.title, says: e.says, nextAction: e.nextAction,
      sourceUrl: e.sourceUrl, publicUrl: e.publicUrl, privateCopy: e.privateCopy ?? null, references: e.references.slice(0, 8) })),
    eventsHidden: Math.max(0, trail.events.length - TRAIL_EVENT_LIMIT),
    gaps: trail.gaps,
  };
}

export const REACHED_SQL = `SELECT o.id AS id, a->>'relation' AS relation, a->>'at' AS at
  FROM cp_obligations o, jsonb_array_elements(o.value->'assignments') a
  WHERE o.value->'assignments' @> $1::jsonb AND a->>'ref' = $2
  ORDER BY a->>'at' DESC, o.id LIMIT $3::int`;
export const REACHED_COUNT_SQL = `SELECT count(*)::int AS n FROM cp_obligations o WHERE o.value->'assignments' @> $1::jsonb`;

export function reachedView(rows: readonly { readonly id: string; readonly relation: string | null; readonly at: string | null }[], total: number): AdminV6Reached {
  return {
    total,
    rows: rows.map((r) => ({ id: r.id, label: workName(r.id, null), at: r.at ?? "",
      relation: r.relation === "CREATED" ? "created" as const : r.relation === "REORDERED" ? "reordered" as const : "other" as const })),
  };
}

export async function readReached(sql: Sql, ref: string): Promise<AdminV6Reached> {
  const contains = JSON.stringify([{ ref }]);
  const op = (operation: string) => ({ operation, callClass: "PAGE" as const });
  const [rows, count] = await Promise.all([
    boundedQuery(sql, op("cp_obligations.reached_by_ref"), REACHED_SQL, [contains, ref, REACHED_LIMIT]) as Promise<readonly Record<string, unknown>[]>,
    boundedQuery(sql, op("cp_obligations.reached_count"), REACHED_COUNT_SQL, [contains]) as Promise<readonly Record<string, unknown>[]>,
  ]);
  return reachedView(rows.map((r) => ({ id: String(r.id), relation: typeof r.relation === "string" ? r.relation : null, at: typeof r.at === "string" ? r.at : null })),
    Number(count[0]?.n) || 0);
}

export type TrailRead = { readonly kind: "HELD"; readonly trail: AdminV6Trail } | { readonly kind: "NOT_RECORDED" | "UNREAD"; readonly detail: string };

export async function readTrail(repos: ControlPlaneRepositories, id: string, nowIso: string): Promise<TrailRead> {
  const read = await readAssignmentSourcesById(repos, id, { nowIso, activation: null, pilotZips: [] });
  if (read.kind === "NOT_RECORDED") return { kind: "NOT_RECORDED", detail: read.detail };
  if (read.kind !== "HELD") return { kind: "UNREAD", detail: read.detail };
  const snapshot = await repos.ownerSnapshots.readNarrowed("current", { servedReaderReadback: true }).catch(() => null);
  const servedReader = ((snapshot?.value ?? null) as { servedReaderReadback?: AssignmentSourcesServed } | null)?.servedReaderReadback ?? null;
  return { kind: "HELD", trail: trailView(assignmentEvidenceTrail({ ...read.value, servedReader }, id, null)) };
}
type AssignmentSourcesServed = NonNullable<Parameters<typeof assignmentEvidenceTrail>[0]["servedReader"]>;
