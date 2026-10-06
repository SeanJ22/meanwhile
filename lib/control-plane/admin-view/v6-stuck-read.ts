import { plainWords } from "./plain-words.ts";
import type { Sql } from "../repository/pg-store.ts";
import { boundedQuery } from "../repository/request-bounds.ts";
import { US_STATES } from "../readiness/catalog.ts";
import { ageOf, causeOf, NEED_WORDS, placeKeyOfRow, sendWordsFor, stateOfRow, type BlockerLane, type Cause, type StuckRowLike } from "./blocker-causes.ts";
import { parseV6PlaceKey, type V6PlaceScope } from "./v6-hunts-read.ts";

/**
 * **admin-v6/stuck@1 and admin-v6/sameCause@1 — EVERY STUCK ITEM, GROUPED BY CAUSE.**
 *
 * The published owner snapshot holds the full assignment index (the runner
 * writes it every cycle). It is several megabytes, so nothing here loads it:
 * one statement unpacks the index inside the database and returns only the rows
 * that are stuck, with the few fields this view reads. A row is stuck when it
 * failed, is blocked or unknown, or is waiting past its due time. Nothing is
 * inferred about rows outside those states.
 */
export const ADMIN_V6_STUCK_CONTRACT = "admin-v6/stuck@1" as const;
export const ADMIN_V6_SAME_CAUSE_CONTRACT = "admin-v6/sameCause@1" as const;
/** The most items one response carries; the cause groups count every stuck row. */
export const STUCK_ITEM_LIMIT = 300;

export const STUCK_INDEX_SQL = `SELECT x->>'id' AS id, x->>'state' AS state, x->>'lane' AS lane, x->>'owner' AS owner,
  left(x->>'blocker', 400) AS blocker, left(x->>'label', 200) AS label, left(x->>'subjectName', 160) AS subject_name,
  x->>'stateCode' AS state_code, (x->>'overdue')::boolean AS overdue, (x->>'band')::int AS band,
  x->>'waitingSince' AS waiting_since, x->>'eligibleAt' AS eligible_at, x->>'lastActivityAt' AS last_activity_at,
  left(x->>'nextAction', 240) AS next_action, x->'assignmentKeys' AS assignment_keys, s.updated_at AS published_at
  FROM cp_owner_snapshots s, jsonb_array_elements(s.value->'assignments'->'view'->'allRowsIndex') AS x
  WHERE s.id = 'current' AND (x->>'state' IN ('FAILED', 'BLOCKED', 'UNKNOWN') OR (x->>'state' = 'WAITING' AND x->>'overdue' = 'true'))`;

export interface StuckPopulation {
  readonly state: "READ";
  readonly rows: readonly StuckRowLike[];
  readonly publishedAt: string | null;
}

export async function readStuckPopulation(sql: Sql): Promise<StuckPopulation> {
  const raw = await boundedQuery(sql, { operation: "cp_owner_snapshots.stuck_index", callClass: "PAGE" }, STUCK_INDEX_SQL, []) as readonly Record<string, unknown>[];
  let publishedAt: string | null = null;
  const rows = raw.map((r): StuckRowLike => {
    publishedAt = typeof r.published_at === "string" ? r.published_at : r.published_at instanceof Date ? r.published_at.toISOString() : publishedAt;
    const text = (v: unknown) => (typeof v === "string" ? v : null);
    return { id: String(r.id), state: String(r.state), lane: text(r.lane), owner: text(r.owner), blocker: text(r.blocker), label: text(r.label),
      subjectName: text(r.subject_name), stateCode: text(r.state_code), overdue: typeof r.overdue === "boolean" ? r.overdue : null,
      band: typeof r.band === "number" ? r.band : null, waitingSince: text(r.waiting_since), eligibleAt: text(r.eligible_at),
      lastActivityAt: text(r.last_activity_at), nextAction: text(r.next_action),
      assignmentKeys: Array.isArray(r.assignment_keys) ? r.assignment_keys.filter((k): k is string => typeof k === "string") : [] };
  });
  return { state: "READ", rows, publishedAt };
}

/* ------------------------------------------------------------- the views */

export interface StuckActionRef { readonly kind: "send-agents"; readonly target: string; readonly label: string; readonly payload: Readonly<Record<string, string>> }
/** Structurally `StuckItem` in app/(admin)/_mw/admin-v6/model.ts. */
export interface AdminV6StuckItem {
  readonly id: string; readonly title: string; readonly applies: readonly string[]; readonly lane: BlockerLane; readonly cause: string;
  readonly age: string; readonly ageRank: number; readonly tried: string; readonly helped: string; readonly next: string; readonly owner: string;
  readonly technical?: readonly string[];
  readonly readersAffected?: boolean; readonly group: string; readonly actions: readonly StuckActionRef[];
}
/** Structurally `SameCause` in model.ts. */
export interface AdminV6SameCause {
  readonly key: string; readonly cause: string; readonly lane: BlockerLane; readonly count: string;
  readonly itemIds: readonly string[]; readonly action?: StuckActionRef;
}

const stateNameOf = (code: string | null) => (code ? US_STATES.find((s) => s.code === code.toLowerCase())?.name ?? null : null);

/** Is this row this scope's own (`local`), a wider place's that covers it (`shared`), or neither? */
export function relationOfRow(scope: V6PlaceScope | null, row: StuckRowLike): "local" | "shared" | null {
  if (scope === null || scope.kind === "country") return "local";
  const code = stateOfRow(row);
  if (scope.kind === "state") return code === scope.state ? "local" : null;
  const key = placeKeyOfRow(row);
  if (key === `geo:${scope.state}.${scope.type}.${scope.geoid}`) return "local";
  return code === scope.state ? "shared" : null;
}

function sendAction(target: string, label: string, words: string): StuckActionRef {
  return { kind: "send-agents", target, label, payload: { words } };
}

export function stuckViews(rows: readonly StuckRowLike[], scopeKey: string, nowIso: string, shutDoors: readonly AdminV6StuckItem[] = []): {
  readonly items: readonly AdminV6StuckItem[]; readonly sameCause: readonly AdminV6SameCause[]; readonly total: number;
} {
  const scope = parseV6PlaceKey(scopeKey);
  const inScope = rows.filter((row) => relationOfRow(scope, row) !== null);
  const scored = inScope.map((row) => {
    const cause = causeOf(row);
    const age = ageOf(row, nowIso);
    const urgency = row.overdue === true ? 3 : row.state === "BLOCKED" || row.state === "FAILED" ? 2 : 1;
    const harm = row.band === null ? 0 : 4 - row.band;
    return { row, cause, age, score: urgency * 100 + harm * 30 + Math.min(age.rank, 60) };
  }).sort((a, b) => b.score - a.score || a.row.id.localeCompare(b.row.id));
  const place = (row: StuckRowLike) => placeKeyOfRow(row);
  // DB-34: shut doors rank first in every scope (the door is already live), longest shut first.
  const items = [...shutDoors, ...scored.slice(0, STUCK_ITEM_LIMIT - shutDoors.length).map(({ row, cause, age }): AdminV6StuckItem => {
    const at = place(row);
    const title = plainWords([row.label, row.subjectName && row.label && !row.label.includes(row.subjectName) ? row.subjectName : null].filter(Boolean).join(" — ") || "Work waiting for repair", "Work waiting for repair");
    const state = stateNameOf(stateOfRow(row));
    const words = sendWordsFor({ stateNames: state ? [state] : [], subject: row.subjectName, label: row.label, zip: /^geo:[a-z]{2}.zcta.(\d{5})$/.exec(at)?.[1] ?? null });
    return { id: row.id, title, applies: [at], lane: cause.lane, cause: cause.needs ? `${NEED_WORDS[cause.needs]}: ${cause.words}` : cause.words, ...(cause.needs ? { needs: cause.needs } : {}), age: age.words, ageRank: age.rank,
      tried: row.blocker === null ? "—" : cause.words, helped: "—", next: row.nextAction ? plainWords(row.nextAction, cause.next) : cause.next,
      technical: [row.id, ...(row.blocker ? [row.blocker] : []), ...(row.nextAction ? [row.nextAction] : [])],
      owner: cause.owner, readersAffected: row.band === 1 ? true : undefined, group: cause.key,
      actions: words === null ? [] : [sendAction(at, "Send agents", words)] };
  })];
  const groups = new Map<string, { cause: Cause; rows: StuckRowLike[]; states: Set<string> }>();
  for (const { row, cause } of scored) {
    const g = groups.get(cause.key) ?? { cause, rows: [], states: new Set<string>() };
    g.rows.push(row);
    const st = stateOfRow(row);
    if (st) g.states.add(st);
    groups.set(cause.key, g);
  }
  const shownIds = new Set(items.map((i) => i.id));
  const sameCause = [...groups.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length || a[0].localeCompare(b[0]))
    .map(([key, g]): AdminV6SameCause => {
      // A group is sent to the state(s) it sits in; the words name those states so the runner's target reading finds them.
      const states = [...g.states].sort();
      const target = states.length === 1 ? `st:${states[0]}` : "us";
      const names = states.map((s) => stateNameOf(s)).filter((n): n is string => n !== null);
      const words = sendWordsFor({ stateNames: names, zip: null, subject: null, label: null });
      return { key, cause: g.cause.words, lane: g.cause.lane, count: String(g.rows.length),
        itemIds: g.rows.filter((r) => shownIds.has(r.id)).map((r) => r.id),
        ...(words === null ? {} : { action: sendAction(target, `Send agents to all ${g.rows.length}`, words) }) } as AdminV6SameCause;
    });
  return { items, sameCause, total: scored.length + shutDoors.length };
}
