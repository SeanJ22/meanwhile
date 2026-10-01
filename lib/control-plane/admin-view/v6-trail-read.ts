import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import type { ControlPlaneRepositories } from "../repository/types.ts";
import { PILOT_ZIPS } from "../../health/owner-corpus-compile.ts";
import { readAssignmentSourcesById } from "../assignment-read.ts";
import { assignmentEvidenceTrail, type AssignmentEvidenceTrail } from "./assignment-evidence-trail.ts";
import { workName } from "./v6-spend-read.ts";

/**
 * **admin-v6/trail@1 — WHAT A SEND REACHED, AND THE EVIDENCE BEHIND EACH PIECE OF WORK.**
 *
 * Two reads, both on demand from a click and neither part of the live refresh:
 *
 *   reached   the obligations an instruction (a Send, or a hunt's receipt) marked, newest mark first, from the marks the
 *             runner writes on each row it creates or reorders
 *   trail     one piece of work's source-to-public-result trail: saved documents (with the private original-copy
 *             control for an exact RAW capture), attempts, extraction, checks, publication and the reader's readback
 *
 * The trail is the existing exact-identity projection (`assignmentEvidenceTrail`): every row joins on work, attempt,
 * artifact and result identity, and no raw saved bytes or URL credentials enter it. A saved document is not an accepted
 * fact, and a publication is not a confirmed public result; the trail says so on each step.
 */
export const ADMIN_V6_TRAIL_CONTRACT = "admin-v6/trail@1" as const;
export const REACHED_LIMIT = 12;
export const TRAIL_EVENT_LIMIT = 40;
/** A ref or item id: a receipt, an intent id or an obligation or work item id. Never a free-text field. */
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
  const read = await readAssignmentSourcesById(repos, id, { nowIso, activation: null, pilotZips: PILOT_ZIPS });
  if (read.kind === "NOT_RECORDED") return { kind: "NOT_RECORDED", detail: read.detail };
  if (read.kind !== "HELD") return { kind: "UNREAD", detail: read.detail };
  // The reader's own readback of what was published comes from the published snapshot; without it the trail says so in its gaps.
  const snapshot = await repos.ownerSnapshots.readNarrowed("current", { servedReaderReadback: true }).catch(() => null);
  const servedReader = ((snapshot?.value ?? null) as { servedReaderReadback?: AssignmentSourcesServed } | null)?.servedReaderReadback ?? null;
  return { kind: "HELD", trail: trailView(assignmentEvidenceTrail({ ...read.value, servedReader }, id, null)) };
}
type AssignmentSourcesServed = NonNullable<Parameters<typeof assignmentEvidenceTrail>[0]["servedReader"]>;
